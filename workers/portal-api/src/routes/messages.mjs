import { json, readJson } from '../lib/http.mjs';

const adminMsgSeen = new Map();

function getSeenMap(adminId) {
  if (!adminMsgSeen.has(adminId)) adminMsgSeen.set(adminId, {});
  return adminMsgSeen.get(adminId);
}

export async function handleMessages(request, context) {
  if (context.scope === 'admin') {
    if (context.params.action === 'unread' && request.method === 'GET') {
      const seen = getSeenMap(context.user.id);
      const { data: msgs } = await context.sb.from('re_messages')
        .select('user_id, ts, from_role')
        .eq('from_role', 'client')
        .order('ts', { ascending: false });

      const unread = {};
      for (const message of (msgs || [])) {
        const lastSeen = seen[message.user_id] || '1970-01-01T00:00:00.000Z';
        if (message.ts > lastSeen) unread[message.user_id] = (unread[message.user_id] || 0) + 1;
      }
      return json({ unread, warning: 'Best effort: estado de leitura admin ainda está em memória no Worker.' });
    }

    if (context.params.action === 'seen' && request.method === 'POST') {
      const seen = getSeenMap(context.user.id);
      seen[context.params.clientId] = new Date().toISOString();
      return json({ success: true, warning: 'Best effort: estado de leitura admin ainda está em memória no Worker.' });
    }

    if (context.params.clientId && context.params.action === 'poll' && request.method === 'GET') {
      const since = new URL(request.url).searchParams.get('since') || new Date(0).toISOString();
      const { data } = await context.sb.from('re_messages')
        .select('*')
        .eq('user_id', context.params.clientId)
        .gt('ts', since)
        .order('ts');
      return json({ messages: data || [] });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (context.params.action === 'poll' && request.method === 'GET') {
    const since = new URL(request.url).searchParams.get('since') || new Date(0).toISOString();
    const { data } = await context.sb.from('re_messages')
      .select('*')
      .eq('user_id', context.user.id)
      .gt('ts', since)
      .order('ts');
    return json({ messages: data || [] });
  }

  if (request.method === 'GET') {
    const { data } = await context.sb.from('re_messages')
      .select('*')
      .eq('user_id', context.user.id)
      .order('ts');
    return json({ messages: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    if (!body.text?.trim()) return json({ error: 'Mensagem vazia.' }, { status: 400 });

    const { data, error } = await context.sb.from('re_messages').insert({
      user_id: context.user.id,
      from_role: 'client',
      from_name: context.user.name || context.user.email,
      text: body.text.trim(),
    }).select().single();

    if (error) return json({ error: error.message }, { status: 500 });

    return json({
      success: true,
      message: data,
      warning: 'TODO: replicar pushNotification para admins antes de rotear tráfego de produção para este endpoint.',
    });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}