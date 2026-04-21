'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const { sbAnon, sb, AUTH_EMAIL_REDIRECTS, SUPABASE_URL, SUPABASE_ANON_KEY, BASE_URL } = require('../lib/config');
const { signToken, requireAuth, requireAdmin, upsertProfileFromAuth, safeUser } = require('../lib/auth');
const { findUserById } = require('../lib/db');
const { logAccess } = require('../lib/logging');
const { createFreshdeskContact, createFreshdeskTicket } = require('../lib/crm');
const { syncFreshsalesContact } = require('../lib/crm');
const { loadPortalUserState, savePortalUserState } = require('../lib/portal-user-state');

// ─── OAuth PKCE store (in-memory, TTL 10 min) ─────────────────────────────────
const _pkceStore = new Map();
function _pkceClean() {
  const now = Date.now();
  for (const [k, v] of _pkceStore) if (v.exp < now) _pkceStore.delete(k);
}
function _b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _codeVerifier() { return _b64url(crypto.randomBytes(32)); }
function _codeChallenge(v) {
  return _b64url(crypto.createHash('sha256').update(v).digest());
}

router.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, company, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });

    // Create Supabase Auth account
    const { data: authData, error: signUpErr } = await sbAnon.auth.signUp({
      email, password,
      options: {
        data: { name, company: company || '' },
        emailRedirectTo: AUTH_EMAIL_REDIRECTS.confirmSignUp,
      }
    });
    if (signUpErr) {
      if (signUpErr.message?.toLowerCase().includes('already registered') ||
          signUpErr.message?.toLowerCase().includes('already been registered') ||
          signUpErr.status === 422) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      }
      throw signUpErr;
    }

    const authUser = authData.user;
    const profile  = await upsertProfileFromAuth(authUser, { name, company: company || '' });

    // Freshdesk contact + ticket + Freshsales CRM (fire and forget)
    Promise.all([
      createFreshdeskContact(email, name),
      createFreshdeskTicket(email, name, company),
      syncFreshsalesContact(email, name, company, null),
    ]).then(async ([contactId, ticketId, fsContactId]) => {
      const updates = {};
      if (contactId)   updates.freshdesk_contact_id  = contactId;
      if (ticketId)    updates.freshdesk_ticket_id   = ticketId;
      if (fsContactId) updates.freshsales_contact_id = fsContactId;
      if (Object.keys(updates).length) {
        await sb.from('re_users').update(updates).eq('id', profile.id);
      }
    }).catch(e => console.warn('[async]', e?.message));

    logAccess(profile.id, email, 'register', req.ip);

    // If Supabase requires email confirmation, session is null.
    // Return pending_confirmation so the frontend shows "check your email".
    if (!authData.session) {
      return res.json({ success: true, pending_confirmation: true, email });
    }

    // When email confirmation is disabled in Supabase, the account is already
    // active and we can continue. We intentionally do not send a parallel auth
    // email here so the Supabase templates remain the single source of truth
    // for sign-up / invite / recovery communications.
    const token = signToken({ userId: profile.id, email: profile.email });
    res.json({ success: true, token, user: safeUser(profile) });
  } catch(e) {
    console.error('[REGISTER]', e.message);
    res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });

    // Validate credentials via Supabase Auth
    const { data: authData, error: signInErr } = await sbAnon.auth.signInWithPassword({ email, password });
    if (signInErr || !authData?.user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Look up / create re_users profile
    const profile = await upsertProfileFromAuth(authData.user);

    logAccess(profile.id, email, 'login', req.ip);

    const token = signToken({ userId: profile.id, email: profile.email });

    // Also return the Supabase session so the browser can store it for the
    // OAuth consent page (supabase.auth.oauth.approveAuthorization requires
    // a live Supabase session in localStorage, not just our custom JWT).
    const supabaseSession = authData.session
      ? { access_token: authData.session.access_token, refresh_token: authData.session.refresh_token, expires_at: authData.session.expires_at }
      : null;

    res.json({ success: true, token, user: safeUser(profile), supabase_session: supabaseSession });
  } catch(e) {
    console.error('[LOGIN]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.get('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const state = await loadPortalUserState(req.user.id);
    res.json({
      success: true,
      user: safeUser(req.user),
      profile: state.profile,
      preferences: state.preferences,
    });
  } catch (error) {
    console.error('[PROFILE GET]', error.message);
    res.status(500).json({ error: 'Erro ao carregar perfil.' });
  }
});

router.patch('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name !== undefined ? String(body.name || '').trim() : null;

    if (name !== null) {
      if (!name) return res.status(400).json({ error: 'Informe o nome.' });
      const { error } = await sb.from('re_users').update({
        name,
        updated_at: new Date().toISOString(),
      }).eq('id', req.user.id);
      if (error) return res.status(500).json({ error: 'Erro ao salvar dados principais.' });
      req.user.name = name;
    }

    const state = await savePortalUserState(req.user.id, {
      profile: body.profile || {
        phone: body.phone,
        bio: body.bio,
        qualifications: body.qualifications,
        competencies: body.competencies,
        social_links: body.social_links || body.socialLinks,
        signature_html: body.signature_html || body.signatureHtml,
        avatar_data_url: body.avatar_data_url || body.avatarDataUrl,
        tenant_links: body.tenant_links || body.tenantLinks,
      },
      preferences: body.preferences,
    });

    res.json({
      success: true,
      user: safeUser(req.user),
      profile: state.profile,
      preferences: state.preferences,
    });
  } catch (error) {
    console.error('[PROFILE PATCH]', error.message);
    res.status(500).json({ error: 'Erro ao salvar perfil.' });
  }
});

router.get('/api/auth/verify', requireAuth, async (req, res) => {
  logAccess(req.user.id, req.user.email, 'verify', req.ip);
  const pub = safeUser(req.user);
  if (req.isImpersonating) pub._impersonating = true;
  res.json({ valid: true, user: pub });
});

router.post('/api/auth/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    // Supabase Auth sends the recovery email with a link pointing to redirectTo
    // The link will contain #access_token=...&type=recovery in the hash fragment
    const resetRedirect = AUTH_EMAIL_REDIRECTS.resetPassword;
    const { error } = await sbAnon.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirect,
    });
    // Always respond success to avoid email enumeration
    if (error) console.warn('[FORGOT]', error.message);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro ao enviar e-mail.' }); }
});

// /api/auth/reset — called by reset-password.html with the Supabase access_token
// from the recovery URL hash fragment.  We validate the token server-side and
// update the password via the Auth admin API so bcrypt is never involved.
router.post('/api/auth/reset', async (req, res) => {
  try {
    const { access_token, refresh_token, password } = req.body;
    if (!access_token || !password) return res.status(400).json({ error: 'Dados inválidos.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres.' });

    // Set session with the recovery tokens
    const { data: sessionData, error: sessionErr } = await sbAnon.auth.setSession({
      access_token,
      refresh_token: refresh_token || access_token,
    });
    if (sessionErr || !sessionData?.user) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }

    // Update password via admin API (service role)
    const userId = sessionData.user.id;
    const { error: updateErr } = await sb.auth.admin.updateUserById(userId, { password });
    if (updateErr) {
      console.error('[RESET]', updateErr.message);
      return res.status(400).json({ error: 'Erro ao atualizar senha. Solicite um novo link.' });
    }

    res.json({ success: true });
  } catch(e) {
    console.error('[RESET]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// /api/auth/confirm — auto-login after user clicks email confirmation / magic-link
// Receives the Supabase access_token from the URL hash fragment and exchanges it for our JWT
router.post('/api/auth/confirm', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Token ausente.' });

    const { data, error } = await sbAnon.auth.setSession({
      access_token,
      refresh_token: refresh_token || access_token,
    });
    if (error || !data?.user) return res.status(401).json({ error: 'Token de confirmação inválido ou expirado.' });

    const profile = await upsertProfileFromAuth(data.user);
    await sbAnon.auth.signOut().catch(e => console.warn('[async]', e?.message)); // clear Supabase session — we use our own JWT
    logAccess(profile.id, profile.email, 'confirm', req.ip);
    const token = signToken({ userId: profile.id, email: profile.email });
    res.json({ success: true, token, user: safeUser(profile) });
  } catch(e) {
    console.error('[CONFIRM]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// /api/auth/resend-confirmation — resend Supabase confirmation email
router.post('/api/auth/resend-confirmation', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });
    await sbAnon.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: AUTH_EMAIL_REDIRECTS.confirmSignUp },
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[RESEND]', e.message);
    res.status(500).json({ error: 'Erro ao reenviar.' });
  }
});

// /api/auth/magic-link — send Supabase magic-link email using the configured
// "Magic link" template in the Supabase dashboard.
router.post('/api/auth/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    const { error } = await sbAnon.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: AUTH_EMAIL_REDIRECTS.magicLink,
      },
    });

    if (error) {
      console.warn('[MAGIC LINK]', error.message);
      return res.status(400).json({ error: 'Não foi possível enviar o magic link.' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[MAGIC LINK]', e.message);
    res.status(500).json({ error: 'Erro ao enviar magic link.' });
  }
});

// /api/admin/invite-user — send Supabase invite email using the configured
// "Invite user" template in the Supabase dashboard.
router.post('/api/admin/invite-user', requireAdmin, async (req, res) => {
  try {
    const { email, name, company } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: AUTH_EMAIL_REDIRECTS.inviteUser,
      data: {
        name: name || email.split('@')[0],
        company: company || '',
      },
    });

    if (error) {
      console.error('[INVITE USER]', error.message);
      return res.status(400).json({ error: 'Não foi possível enviar o convite.' });
    }

    res.json({ success: true, invited: data?.user?.email || email });
  } catch (e) {
    console.error('[INVITE USER]', e.message);
    res.status(500).json({ error: 'Erro ao enviar convite.' });
  }
});

// ─── OAuth Start — generates PKCE and redirects to Supabase authorize ──────────
router.get('/api/auth/oauth/start', (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID || '';
  if (!clientId) return res.status(500).send('OAUTH_CLIENT_ID não configurado no Render.');

  _pkceClean();
  const verifier  = _codeVerifier();
  const challenge = _codeChallenge(verifier);
  const state     = crypto.randomBytes(16).toString('hex');
  _pkceStore.set(state, { verifier, challenge, exp: Date.now() + 10 * 60 * 1000 });

  res.cookie('_oauth_st', state, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          `${BASE_URL}/api/auth/oauth/callback`,
    scope:                 req.query.scope || 'email profile',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`${SUPABASE_URL}/auth/v1/oauth/authorize?${params}`);
});

// ─── OAuth Decide — server proxies the consent decision to Supabase ───────────
router.get('/api/auth/oauth/decide', (req, res) => {
  const clientId        = process.env.OAUTH_CLIENT_ID || '';
  const authorizationId = req.query.authorization_id  || '';
  const allow           = req.query.allow === 'true' ? 'true' : 'false';

  if (!clientId)        return res.status(500).send('OAUTH_CLIENT_ID não configurado no Render.');
  if (!authorizationId) return res.status(400).send('authorization_id ausente.');

  const state = req.cookies?._oauth_st || '';
  const pkce  = state ? _pkceStore.get(state) : null;

  const params = new URLSearchParams({
    authorization_id: authorizationId,
    client_id:        clientId,
    redirect_uri:     `${BASE_URL}/api/auth/oauth/callback`,
    allow,
  });

  if (pkce?.challenge) {
    params.set('code_challenge',        pkce.challenge);
    params.set('code_challenge_method', 'S256');
  } else {
    console.warn('[OAUTH DECIDE] code_challenge not found — state cookie missing or expired');
  }

  res.redirect(`${SUPABASE_URL}/auth/v1/oauth/authorize?${params}`);
});

// ─── OAuth Callback — exchanges code for tokens using stored PKCE verifier ─────
router.get('/api/auth/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[OAUTH CALLBACK] error:', error, error_description);
    return res.redirect(`/login.html?err=oauth&desc=${encodeURIComponent(error_description || error)}`);
  }
  if (!code) return res.redirect('/login.html?err=oauth&desc=no_code');

  const clientId     = process.env.OAUTH_CLIENT_ID     || '';
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
  const pkce         = state ? _pkceStore.get(state) : null;
  if (pkce) _pkceStore.delete(state);

  try {
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: `${BASE_URL}/api/auth/oauth/callback`,
      client_id:    clientId,
    });

    if (pkce?.verifier) {
      body.set('code_verifier', pkce.verifier);
    } else {
      console.error('[OAUTH CALLBACK] PKCE verifier missing (state expired or mismatch)');
      return res.redirect('/login.html?err=oauth&desc=session_expired_retry');
    }
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const tokenRes  = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: SUPABASE_ANON_KEY },
      body,
    });
    const tokenData = await tokenRes.json();
    console.log('[OAUTH CALLBACK] token response:', JSON.stringify(tokenData).slice(0, 200));

    if (!tokenData.access_token) {
      console.error('[OAUTH CALLBACK] token exchange failed:', tokenData);
      return res.redirect('/login.html?err=oauth&desc=' + encodeURIComponent(tokenData.error_description || tokenData.msg || 'token_exchange_failed'));
    }

    const { data } = await sbAnon.auth.setSession({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token || tokenData.access_token,
    });
    if (!data?.user) return res.redirect('/login.html?err=oauth&desc=no_user');

    const profile     = await upsertProfileFromAuth(data.user);
    const portalToken = signToken({ userId: profile.id, email: profile.email });

    // Pass token to browser via hash — login.html will store and redirect
    return res.redirect(
      `/login.html#oauth_token=${encodeURIComponent(portalToken)}&oauth_user=${encodeURIComponent(JSON.stringify(safeUser(profile)))}`
    );
  } catch (e) {
    console.error('[OAUTH CALLBACK]', e.message);
    return res.redirect('/login.html?err=oauth&desc=' + encodeURIComponent(e.message));
  }
});

// ─── Admin: impersonate a client (view portal as client) ──────────────────────
router.post('/api/admin/impersonate/:clientId', requireAdmin, async (req, res) => {
  const target = await findUserById(req.params.clientId);
  if (!target) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (target.is_admin) return res.status(400).json({ error: 'Não é possível impersonar um administrador.' });

  const token = signToken({
    impersonating: true,
    adminId:       req.user.id,
    targetId:      target.id,
    email:         target.email,
    userId:        target.id,  // needed for requireAuth
  });
  res.json({ success: true, token, user: safeUser(target) });
});

module.exports = router;
