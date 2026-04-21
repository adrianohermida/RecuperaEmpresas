import { json } from '../lib/http.mjs';

const FRESHCHAT_ADMIN_BY_EMAIL = {
  'adrianohermida@gmail.com': '127000492713',
  'camilagbhmaia@gmail.com': '127000525188',
};

function resolveFreshchatExternalId(user) {
  const email = String(user?.email || '').toLowerCase().trim();
  return FRESHCHAT_ADMIN_BY_EMAIL[email] || String(user?.id || user?.email || '').trim();
}

export async function handleAdminSystem(request, context) {
  if (context.params.resource === 'freshchat' && context.params.action === 'identity' && request.method === 'GET') {
    const email = String(context.user?.email || '').toLowerCase().trim();
    const configuredSecret = Boolean(String(context.env.FRESHCHAT_JWT_WIDGET || context.env.FRESHCHAT_JWT_SECRET || '').trim());
    return json({
      ok: true,
      email,
      freshchatExternalId: resolveFreshchatExternalId(context.user),
      mappedAdminId: FRESHCHAT_ADMIN_BY_EMAIL[email] || null,
      hasJwtSecret: configuredSecret,
      secretSource: context.env.FRESHCHAT_JWT_WIDGET ? 'FRESHCHAT_JWT_WIDGET' : (context.env.FRESHCHAT_JWT_SECRET ? 'FRESHCHAT_JWT_SECRET' : null),
    });
  }

  if (context.params.resource === 'logs' && request.method === 'GET') {
    const { data: logs } = await context.sb.from('re_access_log')
      .select('*')
      .order('ts', { ascending: false })
      .limit(500);
    return json({
      logs: (logs || []).map((log) => ({
        ts: log.ts,
        email: log.email,
        event: log.event,
        ip: log.ip,
        step: log.step,
      })),
    });
  }

  if (context.params.resource === 'stats' && request.method === 'GET') {
    const { data: users } = await context.sb.from('re_users').select('id').eq('is_admin', false);
    const ids = (users || []).map((user) => user.id);
    const { data: onboarding } = ids.length === 0
      ? { data: [] }
      : await context.sb.from('re_onboarding').select('status').in('user_id', ids);

    const stats = { total: ids.length, naoIniciado: 0, emAndamento: 0, concluido: 0 };
    (onboarding || []).forEach((entry) => {
      if (entry.status === 'concluido') stats.concluido += 1;
      else if (entry.status === 'em_andamento') stats.emAndamento += 1;
      else stats.naoIniciado += 1;
    });
    stats.naoIniciado += ids.length - (onboarding || []).length;
    return json(stats);
  }

  return json({ error: 'Rota não encontrada.' }, { status: 404 });
}