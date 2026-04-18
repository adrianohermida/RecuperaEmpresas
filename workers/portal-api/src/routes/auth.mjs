import bcrypt from 'bcryptjs';
import { getBaseUrl } from '../lib/effects.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { json, readJson, methodNotAllowed } from '../lib/http.mjs';
import { signJwt, verifyJwt } from '../lib/jwt.mjs';
import {
  getSupabase,
  getSupabaseAnon,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '../lib/supabase.mjs';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return encodeBase64Url(new Uint8Array(digest));
}

function getAdminEmails(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getAuthRedirects(env) {
  const baseUrl = getBaseUrl(env).replace(/\/+$/, '');
  return {
    confirmSignUp: `${baseUrl}/login?confirmed=1`,
    inviteUser: `${baseUrl}/login?invited=1`,
    magicLink: `${baseUrl}/login?magic=1`,
    changeEmail: `${baseUrl}/login?email_changed=1`,
    resetPassword: `${baseUrl}/reset-password`,
    reauthentication: `${baseUrl}/login?reauthenticated=1`,
  };
}

function getWorkerOrigin(request) {
  return new URL(request.url).origin.replace(/\/+$/, '');
}

function getPortalLoginUrl(env) {
  return `${getBaseUrl(env).replace(/\/+$/, '')}/login`;
}

function getAppSessionCookieName(env) {
  return String(env.APP_SESSION_COOKIE_NAME || 're_session').trim() || 're_session';
}

function getAppSessionMaxAge(env) {
  const configured = Number(env.APP_SESSION_MAX_AGE || 7 * 24 * 60 * 60);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 7 * 24 * 60 * 60;
}

function buildAppSessionCookie(request, env, token, maxAgeSeconds) {
  const parts = [
    `${getAppSessionCookieName(env)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (new URL(request.url).protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

function buildClearedAppSessionCookie(request, env) {
  const parts = [
    `${getAppSessionCookieName(env)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (new URL(request.url).protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

function withSetCookie(response, cookieValue) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookieValue);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withAppSession(response, request, env, token) {
  return withSetCookie(response, buildAppSessionCookie(request, env, token, getAppSessionMaxAge(env)));
}

function clearAppSession(response, request, env) {
  return withSetCookie(response, buildClearedAppSessionCookie(request, env));
}

async function createPortalSessionResponse(request, env, profile, supabaseSession = null, extra = {}) {
  const portalToken = await signJwt({ userId: profile.id, email: profile.email }, env.JWT_SECRET);
  const response = json({
    success: true,
    user: safeUser(profile, env),
    supabase_session: supabaseSession,
    ...extra,
  });
  return withAppSession(response, request, env, portalToken);
}

function getOauthClientId(env) {
  return String(env.OAUTH_CLIENT_ID || '').trim();
}

function getOauthClientSecret(env) {
  return String(env.OAUTH_CLIENT_SECRET || '').trim();
}

function getMissingOauthConfig(env) {
  const missing = [];
  if (!getOauthClientId(env)) missing.push('OAUTH_CLIENT_ID');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!getSupabaseUrl(env)) missing.push('VITE_SUPABASE_URL');
  if (!getSupabaseAnonKey(env)) missing.push('VITE_SUPABASE_ANON_KEY');
  return missing;
}

async function buildOauthState(env, payload) {
  return signJwt({ kind: 'oauth_state', ...payload }, env.JWT_SECRET, { expiresIn: 10 * 60 });
}

async function readOauthState(env, token) {
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.kind !== 'oauth_state') return null;
  return payload;
}

function safeUser(user, env) {
  const adminEmails = getAdminEmails(env);
  return {
    id: user.id,
    member_id: user.member_id || null,
    name: user.name || user.full_name || '',
    email: user.email,
    company: user.company || '',
    company_id: user.company_id || null,
    role: user.role || null,
    isAdmin: Boolean(user.is_admin) || adminEmails.includes(String(user.email || '').toLowerCase()),
    isMember: Boolean(user.is_member),
    credits_balance: user.credits_balance ?? 0,
    freshdeskTicketId: user.freshdesk_ticket_id || null,
    freshdeskContactId: user.freshdesk_contact_id || null,
    createdAt: user.created_at || null,
  };
}

function getIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

function isInvalidCredentialsError(error) {
  const message = String(error?.message || '').toLowerCase();
  return Boolean(
    error && (
      error.status === 400 ||
      error.status === 401 ||
      message.includes('invalid login credentials') ||
      message.includes('email not confirmed') ||
      message.includes('invalid credentials')
    )
  );
}

function getAuthSetupErrorResponse(message) {
  return json({ error: message || 'Erro interno de autenticacao.' }, { status: 503 });
}

async function logAccess(sb, userId, email, event, ip) {
  try {
    await sb.from('re_access_log').insert({
      user_id: userId || null,
      email,
      event,
      ip,
      ts: new Date().toISOString(),
    });
  } catch {
    // Access log must not block auth.
  }
}

async function findUserById(sb, id) {
  const { data } = await sb.from('re_users').select('*').eq('id', id).single();
  return data;
}

async function upsertProfileFromAuth(sb, authUser, env, extra = {}) {
  const email = String(authUser.email || '').trim();
  const normalizedEmail = email.toLowerCase();
  const isAdmin = getAdminEmails(env).includes(normalizedEmail);

  let { data: profile } = await sb.from('re_users').select('*').eq('id', authUser.id).single();
  if (!profile) {
    const byEmail = await sb.from('re_users').select('*').ilike('email', email).limit(1).single();
    profile = byEmail.data || null;
  }

  if (profile) {
    const updates = {};
    if (profile.id !== authUser.id) updates.id = authUser.id;
    if (!profile.is_admin && isAdmin) updates.is_admin = true;
    if (Object.keys(updates).length) {
      if (updates.id) {
        await sb.from('re_users').insert({ ...profile, ...updates }).catch(() => {});
        await sb.from('re_users').delete().eq('id', profile.id).catch(() => {});
      } else {
        await sb.from('re_users').update(updates).eq('id', profile.id);
      }
      profile = { ...profile, ...updates };
    }
    return profile;
  }

  const name = extra.name || authUser.user_metadata?.name || email.split('@')[0] || '';
  const company = extra.company || authUser.user_metadata?.company || '';
  const { data: created, error } = await sb.from('re_users').insert({
    id: authUser.id,
    email,
    name,
    company,
    is_admin: isAdmin,
  }).select().single();

  if (error) throw error;
  return created;
}

async function register(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const company = String(body.company || '').trim();
  const password = String(body.password || '');
  if (!name || !email || !password) return json({ error: 'Preencha todos os campos.' }, { status: 400 });
  if (password.length < 8) return json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400 });

  const sbAnon = getSupabaseAnon(env);
  const redirects = getAuthRedirects(env);
  let authData;
  let signUpErr;

  try {
    const result = await sbAnon.auth.signUp({
      email,
      password,
      options: {
        data: { name, company },
        emailRedirectTo: redirects.confirmSignUp,
      },
    });
    authData = result.data;
    signUpErr = result.error;
  } catch (error) {
    console.error('[worker:register:auth]', error?.message || error);
    return json({ error: 'Erro ao criar conta no provedor de autenticacao.' }, { status: 502 });
  }

  if (signUpErr) {
    const message = String(signUpErr.message || '').toLowerCase();
    if (message.includes('already registered') || message.includes('already been registered') || signUpErr.status === 422) {
      return json({ error: 'Este e-mail já está cadastrado.' }, { status: 409 });
    }
    console.error('[worker:register]', signUpErr.message);
    return json({ error: 'Erro interno ao criar conta.' }, { status: 500 });
  }

  if (!authData?.user) {
    console.error('[worker:register] signup returned without user');
    return json({ error: 'Erro ao criar conta.' }, { status: 500 });
  }

  let sb;
  try {
    sb = getSupabase(env);
  } catch (error) {
    console.error('[worker:register:service-role]', error?.message || error);
    return getAuthSetupErrorResponse('Conta criada, mas a configuracao interna de perfil esta indisponivel.');
  }

  let profile;
  try {
    profile = await upsertProfileFromAuth(sb, authData.user, env, { name, company });
  } catch (error) {
    console.error('[worker:register:profile-sync]', error?.message || error);
    return getAuthSetupErrorResponse('Conta criada, mas nao foi possivel finalizar o perfil agora.');
  }

  await logAccess(sb, profile.id, email, 'register', getIp(request));

  if (!authData.session) {
    return json({ success: true, pending_confirmation: true, email });
  }

  const supabaseSession = {
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    expires_at: authData.session.expires_at,
  };
  return createPortalSessionResponse(request, env, profile, supabaseSession);
}

async function login(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) return json({ error: 'Preencha todos os campos.' }, { status: 400 });

  const sbAnon = getSupabaseAnon(env);
  let authData;
  let signInErr;

  try {
    const result = await sbAnon.auth.signInWithPassword({ email, password });
    authData = result.data;
    signInErr = result.error;
  } catch (error) {
    if (isInvalidCredentialsError(error)) {
      return json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }
    console.error('[worker:login:auth]', error?.message || error);
    return json({ error: 'Erro ao autenticar no provedor de login.' }, { status: 502 });
  }

  if (signInErr || !authData?.user) {
    return json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
  }

  let sb;
  try {
    sb = getSupabase(env);
  } catch (error) {
    console.error('[worker:login:service-role]', error?.message || error);
    return getAuthSetupErrorResponse('Login validado, mas a configuracao interna de perfil esta indisponivel.');
  }

  let profile;
  try {
    profile = await upsertProfileFromAuth(sb, authData.user, env);
  } catch (error) {
    console.error('[worker:login:profile-sync]', error?.message || error);
    return getAuthSetupErrorResponse('Login validado, mas nao foi possivel carregar o perfil agora.');
  }

  await logAccess(sb, profile.id, email, 'login', getIp(request));

  const supabaseSession = authData.session
    ? {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
      }
    : null;

  return createPortalSessionResponse(request, env, profile, supabaseSession);
}

async function verify(request, env) {
  if (request.method !== 'GET') return methodNotAllowed();
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  await logAccess(auth.sb, auth.user.id, auth.user.email, 'verify', getIp(request));
  const user = safeUser(auth.user, env);
  if (auth.auth?.impersonating) user._impersonating = true;
  return json({ valid: true, user });
}

async function forgotPassword(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const email = String(body.email || '').trim();
  if (!email) return json({ error: 'Informe o e-mail.' }, { status: 400 });

  const sbAnon = getSupabaseAnon(env);
  const redirects = getAuthRedirects(env);
  const { error } = await sbAnon.auth.resetPasswordForEmail(email, { redirectTo: redirects.resetPassword });
  if (error) {
    console.warn('[worker:forgot]', error.message);
    return json({
      error: 'Erro ao solicitar recuperação de senha.',
      details: error.message,
      redirectTo: redirects.resetPassword,
    }, { status: 500 });
  }
  return json({ success: true });
}

async function confirm(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const accessToken = String(body.access_token || '');
  const refreshToken = String(body.refresh_token || body.access_token || '');
  if (!accessToken) return json({ error: 'Token ausente.' }, { status: 400 });

  const sb = getSupabase(env);
  const sbAnon = getSupabaseAnon(env);
  const { data, error } = await sbAnon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error || !data?.user) {
    return json({ error: 'Token de confirmação inválido ou expirado.' }, { status: 401 });
  }

  const profile = await upsertProfileFromAuth(sb, data.user, env);
  await sbAnon.auth.signOut().catch(() => {});
  await logAccess(sb, profile.id, profile.email, 'confirm', getIp(request));
  return createPortalSessionResponse(request, env, profile);
}

async function resendConfirmation(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const email = String(body.email || '').trim();
  if (!email) return json({ error: 'Informe o e-mail.' }, { status: 400 });

  const sbAnon = getSupabaseAnon(env);
  const redirects = getAuthRedirects(env);
  const { error } = await sbAnon.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirects.confirmSignUp },
  });
  if (error) {
    console.error('[worker:resend-confirmation]', error.message);
    return json({ error: 'Erro ao reenviar.' }, { status: 500 });
  }
  return json({ success: true });
}

async function memberLogin(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (!email || !password) return json({ error: 'E-mail e senha obrigatórios.' }, { status: 400 });

  const sb = getSupabase(env);
  const { data: member, error } = await sb.from('re_company_users')
    .select('*')
    .eq('email', email)
    .eq('active', true)
    .single();
  if (error || !member) return json({ error: 'Credenciais inválidas.' }, { status: 401 });

  const ok = await bcrypt.compare(password, member.password_hash);
  if (!ok) return json({ error: 'Credenciais inválidas.' }, { status: 401 });

  await sb.from('re_company_users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', member.id)
    .catch(() => {});

  const owner = await findUserById(sb, member.company_id);
  const token = await signJwt({
    id: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
    company_id: member.company_id,
    is_admin: false,
  }, env.JWT_SECRET, { expiresIn: 12 * 60 * 60 });

  return withAppSession(json({
    success: true,
    user: {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      company_id: member.company_id,
      company: owner?.company || owner?.name || '',
    },
  }), request, env, token);
}

async function oauthStart(request, env) {
  if (request.method !== 'GET') return methodNotAllowed();

  const clientId = getOauthClientId(env);
  if (!clientId) return json({ error: 'OAUTH_CLIENT_ID não configurado no Worker.' }, { status: 500 });

  const url = new URL(request.url);
  const scope = String(url.searchParams.get('scope') || 'openid email profile').trim();
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const state = await buildOauthState(env, { verifier, return_to: String(url.searchParams.get('returnTo') || '') });
  const redirectUri = `${getWorkerOrigin(request)}/api/auth/oauth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return Response.redirect(`${getSupabaseUrl(env)}/auth/v1/oauth/authorize?${params.toString()}`, 302);
}

async function oauthStatus(request, env) {
  if (request.method !== 'GET') return methodNotAllowed();

  const missing = getMissingOauthConfig(env);
  const hasServiceRole = Boolean(getSupabaseServiceRoleKey(env));
  return json({
    configured: missing.length === 0,
    missing,
    expected: {
      startRoute: '/api/auth/oauth/start',
      callbackRoute: '/api/auth/oauth/callback',
      consentPage: '/oauth/consent',
      redirectUri: `${getWorkerOrigin(request)}/api/auth/oauth/callback`,
      required: ['OAUTH_CLIENT_ID', 'JWT_SECRET'],
      optionalAliases: {
        supabaseUrl: ['VITE_SUPABASE_URL', 'SUPABASE_URL'],
        supabaseAnonKey: ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']
      }
    },
    identified: {
      workerOrigin: getWorkerOrigin(request),
      portalBaseUrl: getBaseUrl(env),
      oauthClientConfigured: Boolean(getOauthClientId(env)),
      authProfileSyncConfigured: hasServiceRole,
      supabaseUrlSource: env.VITE_SUPABASE_URL ? 'VITE_SUPABASE_URL' : (env.SUPABASE_URL ? 'SUPABASE_URL' : 'default'),
      supabaseAnonSource: env.VITE_SUPABASE_ANON_KEY ? 'VITE_SUPABASE_ANON_KEY' : (env.SUPABASE_ANON_KEY ? 'SUPABASE_ANON_KEY' : 'default'),
      supabaseServiceRoleSource: env.VITE_SUPABASE_SERVICE_ROLE
        ? 'VITE_SUPABASE_SERVICE_ROLE'
        : (env.SUPABASE_SERVICE_ROLE_KEY
          ? 'SUPABASE_SERVICE_ROLE_KEY'
          : (env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : 'missing'))
    }
  });
}

async function oauthCallback(request, env) {
  if (request.method !== 'GET') return methodNotAllowed();

  const portalLoginUrl = getPortalLoginUrl(env);
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '');
  const state = String(url.searchParams.get('state') || '');
  const error = String(url.searchParams.get('error') || '');
  const errorDescription = String(url.searchParams.get('error_description') || '');

  if (error) {
    return Response.redirect(`${portalLoginUrl}?err=oauth&desc=${encodeURIComponent(errorDescription || error)}`, 302);
  }

  if (!code) {
    return Response.redirect(`${portalLoginUrl}?err=oauth&desc=no_code`, 302);
  }

  const oauthState = await readOauthState(env, state);
  if (!oauthState?.verifier) {
    return Response.redirect(`${portalLoginUrl}?err=oauth&desc=session_expired_retry`, 302);
  }

  const clientId = getOauthClientId(env);
  if (!clientId) {
    return Response.redirect(`${portalLoginUrl}?err=oauth&desc=missing_oauth_client_id`, 302);
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${getWorkerOrigin(request)}/api/auth/oauth/callback`,
    client_id: clientId,
    code_verifier: oauthState.verifier,
  });

  const clientSecret = getOauthClientSecret(env);
  if (clientSecret) body.set('client_secret', clientSecret);

  try {
    const sb = getSupabase(env);
    const sbAnon = getSupabaseAnon(env);
    const tokenRes = await fetch(`${getSupabaseUrl(env)}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apikey: getSupabaseAnonKey(env),
      },
      body,
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return Response.redirect(`${portalLoginUrl}?err=oauth&desc=${encodeURIComponent(tokenData.error_description || tokenData.msg || 'token_exchange_failed')}`, 302);
    }

    const { data, error: sessionErr } = await sbAnon.auth.setSession({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || tokenData.access_token,
    });

    if (sessionErr || !data?.user) {
      return Response.redirect(`${portalLoginUrl}?err=oauth&desc=${encodeURIComponent(sessionErr?.message || 'no_user')}`, 302);
    }

    const profile = await upsertProfileFromAuth(sb, data.user, env);
    const hash = new URLSearchParams({
      oauth: '1',
      oauth_user: JSON.stringify(safeUser(profile, env)),
      oauth_access_token: tokenData.access_token,
      oauth_refresh_token: tokenData.refresh_token || tokenData.access_token,
    });
    const returnTo = String(oauthState.return_to || '').trim();
    const target = `${portalLoginUrl}${returnTo && returnTo.startsWith('/') ? '?returnTo=' + encodeURIComponent(returnTo) : ''}#${hash.toString()}`;
    return withAppSession(Response.redirect(target, 302), request, env, await signJwt({ userId: profile.id, email: profile.email }, env.JWT_SECRET));
  } catch (workerError) {
    return Response.redirect(`${portalLoginUrl}?err=oauth&desc=${encodeURIComponent(workerError?.message || 'oauth_callback_failed')}`, 302);
  }
}

async function refreshSession(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const accessToken = String(body.access_token || '').trim();
  const refreshToken = String(body.refresh_token || '').trim();
  if (!refreshToken) {
    return json({ error: 'Refresh token ausente.' }, { status: 400 });
  }

  const sbAnon = getSupabaseAnon(env);
  const sb = getSupabase(env);
  const { data, error } = await sbAnon.auth.setSession({
    access_token: accessToken || refreshToken,
    refresh_token: refreshToken,
  });
  if (error || !data?.session || !data?.user) {
    return clearAppSession(json({ error: 'Sessão Supabase inválida ou expirada.' }, { status: 401 }), request, env);
  }

  const profile = await upsertProfileFromAuth(sb, data.user, env);
  const supabaseSession = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
  return createPortalSessionResponse(request, env, profile, supabaseSession);
}

async function logout(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const accessToken = String(body.access_token || '').trim();
  const refreshToken = String(body.refresh_token || '').trim();

  if (accessToken || refreshToken) {
    const sbAnon = getSupabaseAnon(env);
    const { error } = await sbAnon.auth.setSession({
      access_token: accessToken || refreshToken,
      refresh_token: refreshToken || accessToken,
    });
    if (!error) {
      await sbAnon.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  }

  return clearAppSession(json({ success: true }), request, env);
}

async function updateProfile(request, env) {
  if (request.method !== 'PATCH') return methodNotAllowed();
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const updates = {};
  if (body.name !== undefined) updates.name = String(body.name || '').trim();
  if (body.phone !== undefined) updates.phone = String(body.phone || '').trim();
  if (!Object.keys(updates).length) return json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
  const { error } = await auth.sb.from('re_users').update(updates).eq('id', auth.user.id);
  if (error) return json({ error: 'Erro ao salvar perfil.' }, { status: 500 });
  return json({ success: true });
}

async function changePassword(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const newPassword = String(body.new_password || body.newPassword || '');
  if (newPassword.length < 8) return json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400 });
  const sbAnon = getSupabaseAnon(env);
  const { error } = await sbAnon.auth.updateUser({ password: newPassword });
  if (error) return json({ error: 'Erro ao alterar senha. Verifique se está autenticado via Supabase.' }, { status: 400 });
  return json({ success: true });
}

async function revokeSessions(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const accessToken = String(body.access_token || '').trim();
  const refreshToken = String(body.refresh_token || '').trim();
  const sbAnon = getSupabaseAnon(env);
  if (accessToken || refreshToken) {
    const { error } = await sbAnon.auth.setSession({
      access_token: accessToken || refreshToken,
      refresh_token: refreshToken || accessToken,
    });
    if (!error) {
      await sbAnon.auth.signOut({ scope: 'global' }).catch(() => {});
    }
  }
  return clearAppSession(json({ success: true }), request, env);
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  try {
    if (url.pathname === '/api/auth/register') return await register(request, env);
    if (url.pathname === '/api/auth/login') return await login(request, env);
    if (url.pathname === '/api/auth/verify') return await verify(request, env);
    if (url.pathname === '/api/auth/forgot') return await forgotPassword(request, env);
    if (url.pathname === '/api/auth/confirm') return await confirm(request, env);
    if (url.pathname === '/api/auth/session/refresh') return await refreshSession(request, env);
    if (url.pathname === '/api/auth/logout') return await logout(request, env);
    if (url.pathname === '/api/auth/resend-confirmation') return await resendConfirmation(request, env);
    if (url.pathname === '/api/auth/member-login') return await memberLogin(request, env);
    if (url.pathname === '/api/auth/profile') return await updateProfile(request, env);
    if (url.pathname === '/api/auth/change-password') return await changePassword(request, env);
    if (url.pathname === '/api/auth/revoke-sessions') return await revokeSessions(request, env);
    if (url.pathname === '/api/auth/oauth/status') return await oauthStatus(request, env);
    if (url.pathname === '/api/auth/oauth/start') return await oauthStart(request, env);
    if (url.pathname === '/api/auth/oauth/callback') return await oauthCallback(request, env);
  } catch (error) {
    console.error('[worker:auth]', error?.message || error);
    return json({ error: 'Erro interno.' }, { status: 500 });
  }

  return null;
}