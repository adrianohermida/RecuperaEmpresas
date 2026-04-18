import bcrypt from 'bcryptjs';
import { getBaseUrl } from '../lib/effects.mjs';
import { requireAuth } from '../lib/auth.mjs';
import { json, readJson, methodNotAllowed } from '../lib/http.mjs';
import { signJwt } from '../lib/jwt.mjs';
import { getSupabase, getSupabaseAnon } from '../lib/supabase.mjs';

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

  const sb = getSupabase(env);
  const sbAnon = getSupabaseAnon(env);
  const redirects = getAuthRedirects(env);
  const { data: authData, error: signUpErr } = await sbAnon.auth.signUp({
    email,
    password,
    options: {
      data: { name, company },
      emailRedirectTo: redirects.confirmSignUp,
    },
  });

  if (signUpErr) {
    const message = String(signUpErr.message || '').toLowerCase();
    if (message.includes('already registered') || message.includes('already been registered') || signUpErr.status === 422) {
      return json({ error: 'Este e-mail já está cadastrado.' }, { status: 409 });
    }
    console.error('[worker:register]', signUpErr.message);
    return json({ error: 'Erro interno ao criar conta.' }, { status: 500 });
  }

  const profile = await upsertProfileFromAuth(sb, authData.user, env, { name, company });
  await logAccess(sb, profile.id, email, 'register', getIp(request));

  if (!authData.session) {
    return json({ success: true, pending_confirmation: true, email });
  }

  const token = await signJwt({ userId: profile.id, email: profile.email }, env.JWT_SECRET);
  return json({ success: true, token, user: safeUser(profile, env) });
}

async function login(request, env) {
  if (request.method !== 'POST') return methodNotAllowed();
  const body = await readJson(request);
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) return json({ error: 'Preencha todos os campos.' }, { status: 400 });

  const sb = getSupabase(env);
  const sbAnon = getSupabaseAnon(env);
  const { data: authData, error: signInErr } = await sbAnon.auth.signInWithPassword({ email, password });
  if (signInErr || !authData?.user) {
    return json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
  }

  const profile = await upsertProfileFromAuth(sb, authData.user, env);
  await logAccess(sb, profile.id, email, 'login', getIp(request));

  const token = await signJwt({ userId: profile.id, email: profile.email }, env.JWT_SECRET);
  const supabaseSession = authData.session
    ? {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
      }
    : null;

  return json({ success: true, token, user: safeUser(profile, env), supabase_session: supabaseSession });
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
  if (error) console.warn('[worker:forgot]', error.message);
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
  const token = await signJwt({ userId: profile.id, email: profile.email }, env.JWT_SECRET);
  return json({ success: true, token, user: safeUser(profile, env) });
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

  return json({
    token,
    user: {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      company_id: member.company_id,
      company: owner?.company || owner?.name || '',
    },
  });
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  try {
    if (url.pathname === '/api/auth/register') return await register(request, env);
    if (url.pathname === '/api/auth/login') return await login(request, env);
    if (url.pathname === '/api/auth/verify') return await verify(request, env);
    if (url.pathname === '/api/auth/forgot') return await forgotPassword(request, env);
    if (url.pathname === '/api/auth/confirm') return await confirm(request, env);
    if (url.pathname === '/api/auth/resend-confirmation') return await resendConfirmation(request, env);
    if (url.pathname === '/api/auth/member-login') return await memberLogin(request, env);
  } catch (error) {
    console.error('[worker:auth]', error?.message || error);
    return json({ error: 'Erro interno.' }, { status: 500 });
  }

  return null;
}