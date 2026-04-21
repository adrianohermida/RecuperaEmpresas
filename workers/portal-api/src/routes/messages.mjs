import { pushNotification, queueSideEffect } from '../lib/effects.mjs';
import { json, readJson } from '../lib/http.mjs';
import { markSeenState, readSeenState } from '../lib/message-state.mjs';

export async function handleMessages(request, context) {
  if (context.scope === 'admin') {
    if (context.params.action === 'unread' && request.method === 'GET') {
      const { state: seen, persistent } = await readSeenState(context.env, context.user.id);
      const { data: msgs } = await context.sb.from('re_messages')
        .select('user_id, ts, from_role')
        .eq('from_role', 'client')
        .order('ts', { ascending: false });

      const unread = {};
      for (const message of (msgs || [])) {
        const lastSeen = seen[message.user_id] || '1970-01-01T00:00:00.000Z';
        if (message.ts > lastSeen) unread[message.user_id] = (unread[message.user_id] || 0) + 1;
      }
      return json(persistent ? { unread } : {
        unread,
        warning: 'Best effort: estado de leitura admin ainda esta em memoria no Worker.',
      });
    }

    if (context.params.action === 'seen' && request.method === 'POST') {
      const result = await markSeenState(context.env, context.user.id, context.params.clientId);
      return json(result.persistent ? { success: true } : {
        success: true,
        warning: 'Best effort: estado de leitura admin ainda esta em memoria no Worker.',
      });
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

    if (context.params.clientId && context.params.action === 'message' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body.text?.trim()) return json({ error: 'Mensagem vazia.' }, { status: 400 });

      const msgPayload = {
        user_id: context.params.clientId,
        from_role: 'admin',
        from_name: context.user.name || context.user.email,
        text: body.text.trim(),
      };
      if (body.to_member_id) msgPayload.to_member_id = body.to_member_id;

      const { data, error } = await context.sb.from('re_messages').insert(msgPayload).select().single();
      if (error) return json({ error: error.message }, { status: 500 });

      queueSideEffect(context, () => pushNotification(
        context.sb,
        context.params.clientId,
        'message',
        'Nova mensagem do consultor',
        body.text.trim().slice(0, 100),
        'message',
        context.params.clientId,
      ), 'admin-message-notification');

      return json({ success: true, message: data });
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

    const { data: admins } = await context.sb.from('re_users')
      .select('id')
      .eq('is_admin', true)
      .limit(20);

    for (const admin of (admins || [])) {
      queueSideEffect(context, () => pushNotification(
        context.sb,
        admin.id,
        'message',
        'Nova mensagem de cliente',
        `${context.user.name || context.user.email}: ${body.text.trim().slice(0, 80)}`,
        'message',
        context.user.id,
      ), 'message-notification');
    }

    return json({ success: true, message: data });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}