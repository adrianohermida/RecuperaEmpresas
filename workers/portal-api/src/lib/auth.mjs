import { json, parseCookies } from './http.mjs';
import { verifyJwt } from './jwt.mjs';
import { getSupabase, getSupabaseAnon } from './supabase.mjs';

function getAppSessionCookieName(env) {
  return String(env.APP_SESSION_COOKIE_NAME || 're_session').trim() || 're_session';
}

function getTokenCandidates(request, env) {
  const candidates = [];
  const authHeader = request.headers.get('authorization') || '';
  if (/^Bearer\s+/i.test(authHeader)) {
    candidates.push(authHeader.replace(/^Bearer\s+/i, '').trim());
  }

  const cookies = parseCookies(request);
  const cookieToken = String(cookies[getAppSessionCookieName(env)] || '').trim();
  if (cookieToken) candidates.push(cookieToken);

  const url = new URL(request.url);
  const queryToken = String(url.searchParams.get('token') || '').trim();
  if (queryToken) candidates.push(queryToken);

  return candidates.filter(Boolean);
}

async function findUserById(sb, id) {
  const { data } = await sb.from('re_users').select('*').eq('id', id).single();
  return data;
}

export async function requireAuth(request, env) {
  const tokens = getTokenCandidates(request, env);
  if (!tokens.length) {
    return { ok: false, response: json({ error: 'Não autenticado.' }, { status: 401 }) };
  }

  let decoded = null;
  for (const token of tokens) {
    decoded = await verifyJwt(token, env.JWT_SECRET);
    if (decoded) break;
  }
  if (!decoded) {
    return { ok: false, response: json({ error: 'Token inválido ou expirado.' }, { status: 401 }) };
  }

  const sb = getSupabase(env);

  if (decoded.supabase_access_token) {
    try {
      const sbAnon = getSupabaseAnon(env);
      const { data, error } = await sbAnon.auth.getUser(decoded.supabase_access_token);
      if (error || !data?.user) {
        return { ok: false, response: json({ error: 'Sessão encerrada ou revogada.' }, { status: 401 }) };
      }
    } catch (error) {
      return { ok: false, response: json({ error: 'Não foi possível validar a sessão atual.' }, { status: 503 }) };
    }
  }

  if (decoded.impersonating) {
    const target = await findUserById(sb, decoded.targetId);
    if (!target) {
      return { ok: false, response: json({ error: 'Usuário não encontrado.' }, { status: 401 }) };
    }
    return { ok: true, user: target, sb, auth: decoded };
  }

  if (decoded.company_id) {
    const { data: member } = await sb.from('re_company_users')
      .select('id,name,email,role,active,company_id,permissions')
      .eq('id', decoded.id)
      .eq('active', true)
      .single();

    if (!member) {
      return { ok: false, response: json({ error: 'Membro inativo ou não encontrado.' }, { status: 401 }) };
    }

    return {
      ok: true,
      sb,
      auth: decoded,
      user: {
        id: member.company_id,
        member_id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        company_id: member.company_id,
        permissions: member.permissions || {},
        is_admin: false,
        is_member: true,
      },
    };
  }

  const user = await findUserById(sb, decoded.userId || decoded.id);
  if (!user) {
    return { ok: false, response: json({ error: 'Usuário não encontrado.' }, { status: 401 }) };
  }

  return { ok: true, user, sb, auth: decoded };
}

export async function requireAdmin(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth;

  const adminEmails = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const email = String(auth.user.email || '').toLowerCase();
  if (!auth.user.is_admin && !adminEmails.includes(email)) {
    return { ok: false, response: json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return auth;
}