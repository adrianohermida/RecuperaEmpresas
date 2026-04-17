import { json } from './http.mjs';
import { verifyJwt } from './jwt.mjs';
import { getSupabase } from './supabase.mjs';

async function findUserById(sb, id) {
  const { data } = await sb.from('re_users').select('*').eq('id', id).single();
  return data;
}

export async function requireAuth(request, env) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { ok: false, response: json({ error: 'Não autenticado.' }, { status: 401 }) };
  }

  const decoded = await verifyJwt(token, env.JWT_SECRET);
  if (!decoded) {
    return { ok: false, response: json({ error: 'Token inválido ou expirado.' }, { status: 401 }) };
  }

  const sb = getSupabase(env);

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