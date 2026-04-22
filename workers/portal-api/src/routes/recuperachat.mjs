// ═══════════════════════════════════════════════════════════════════════════════
// RecuperaChat — Cloudflare Worker Route
// Espelha as rotas Express para o edge worker (portal-api)
// ═══════════════════════════════════════════════════════════════════════════════

import { json, readJson } from '../lib/http.mjs';
import { pushNotification, queueSideEffect } from '../lib/effects.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errJson(msg, status = 400) {
  return json({ error: msg }, { status });
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function handleRecuperaChat(request, context) {
  const { sb, user, params, scope } = context;
  const method = request.method;
  const url = new URL(request.url);

  // ─── ADMIN SCOPE ──────────────────────────────────────────────────────────

  if (scope === 'admin') {
    // GET /api/admin/chat/conversations
    if (params.resource === 'conversations' && !params.id && method === 'GET') {
      const status = url.searchParams.get('status');
      const all = url.searchParams.get('all') === '1';
      let query = sb
        .from('re_chat_conversations')
        .select('*, re_users!re_chat_conversations_client_id_fkey(name, company)')
        .order('updated_at', { ascending: false });
      if (!all) query = query.eq('consultant_id', user.id);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return errJson(error.message, 500);
      return json({ conversations: data || [] });
    }

    // GET /api/admin/chat/conversations/:id/messages
    if (params.resource === 'conversations' && params.id && params.action === 'messages' && method === 'GET') {
      const since = url.searchParams.get('since');
      let query = sb
        .from('re_chat_messages')
        .select('*')
        .eq('conversation_id', params.id)
        .order('created_at', { ascending: true });
      if (since) query = query.gt('created_at', since);
      const { data, error } = await query;
      if (error) return errJson(error.message, 500);
      return json({ messages: data || [] });
    }

    // POST /api/admin/chat/conversations/:id/messages
    if (params.resource === 'conversations' && params.id && params.action === 'messages' && method === 'POST') {
      const body = await readJson(request);
      if (!body.content?.trim()) return errJson('Conteúdo é obrigatório.');
      const { data: msg, error } = await sb
        .from('re_chat_messages')
        .insert({
          conversation_id: params.id,
          sender_id: user.id,
          sender_role: 'admin',
          content: body.content.trim(),
          metadata: body.metadata || {},
        })
        .select()
        .single();
      if (error) return errJson(error.message, 500);
      // Atualiza updated_at da conversa
      await sb.from('re_chat_conversations').update({ updated_at: new Date().toISOString() }).eq('id', params.id);
      // Notificar cliente
      const { data: conv } = await sb.from('re_chat_conversations').select('client_id').eq('id', params.id).single();
      if (conv?.client_id) {
        queueSideEffect(context, () => pushNotification(
          sb, conv.client_id, 'message',
          'Nova mensagem do consultor',
          body.content.trim().slice(0, 100),
          'chat_conversation', params.id,
        ), 'recuperachat-notify-client');
      }
      return json({ success: true, message: msg });
    }

    // PATCH /api/admin/chat/conversations/:id/status
    if (params.resource === 'conversations' && params.id && params.action === 'status' && method === 'PATCH') {
      const body = await readJson(request);
      const VALID = ['open', 'resolved', 'snoozed'];
      if (!VALID.includes(body.status)) return errJson('Status inválido.');
      const updates = { status: body.status };
      if (body.status === 'resolved') updates.resolved_at = new Date().toISOString();
      const { error } = await sb.from('re_chat_conversations').update(updates).eq('id', params.id);
      if (error) return errJson(error.message, 500);
      return json({ success: true });
    }

    // POST /api/admin/chat/conversations/:id/read
    if (params.resource === 'conversations' && params.id && params.action === 'read' && method === 'POST') {
      await sb.from('re_chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', params.id)
        .neq('sender_id', user.id)
        .is('read_at', null);
      return json({ success: true });
    }

    // POST /api/admin/chat/conversations/:id/convert-to-ticket
    if (params.resource === 'conversations' && params.id && params.action === 'convert-to-ticket' && method === 'POST') {
      const body = await readJson(request);
      if (!body.subject?.trim()) return errJson('Assunto é obrigatório.');
      if (!body.description?.trim()) return errJson('Descrição é obrigatória.');
      const { data: conv } = await sb.from('re_chat_conversations').select('client_id').eq('id', params.id).single();
      if (!conv) return errJson('Conversa não encontrada.', 404);
      const { data: ticket, error } = await sb
        .from('re_support_tickets')
        .insert({
          client_id: conv.client_id,
          creator_id: user.id,
          subject: body.subject.trim(),
          description: body.description.trim(),
          priority: body.priority || 'normal',
          assigned_to: body.assigned_to || user.id,
          source_conversation_id: params.id,
        })
        .select()
        .single();
      if (error) return errJson(error.message, 500);
      // Mensagem de sistema na conversa
      await sb.from('re_chat_messages').insert({
        conversation_id: params.id,
        sender_id: user.id,
        sender_role: 'system',
        content: `Chamado #${ticket.ticket_number} criado: "${body.subject.trim()}"`,
        metadata: { ticket_id: ticket.id, ticket_number: ticket.ticket_number },
      });
      return json({ success: true, ticket });
    }

    // GET /api/admin/chat/tickets
    if (params.resource === 'tickets' && !params.id && method === 'GET') {
      const status = url.searchParams.get('status');
      const assigned_to = url.searchParams.get('assigned_to');
      let query = sb
        .from('re_support_tickets')
        .select('*, re_users!re_support_tickets_client_id_fkey(name, company)')
        .order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      if (assigned_to) query = query.eq('assigned_to', assigned_to);
      const { data, error } = await query;
      if (error) return errJson(error.message, 500);
      return json({ tickets: data || [] });
    }

    // PATCH /api/admin/chat/tickets/:id
    if (params.resource === 'tickets' && params.id && !params.action && method === 'PATCH') {
      const body = await readJson(request);
      const allowed = ['status', 'priority', 'assigned_to', 'resolved_at'];
      const safe = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      if (safe.status === 'resolved' && !safe.resolved_at) safe.resolved_at = new Date().toISOString();
      const { error } = await sb.from('re_support_tickets').update(safe).eq('id', params.id);
      if (error) return errJson(error.message, 500);
      return json({ success: true });
    }

    // GET /api/admin/chat/tickets/:id/comments
    if (params.resource === 'tickets' && params.id && params.action === 'comments' && method === 'GET') {
      const { data, error } = await sb
        .from('re_support_ticket_comments')
        .select('*')
        .eq('ticket_id', params.id)
        .order('created_at', { ascending: true });
      if (error) return errJson(error.message, 500);
      return json({ comments: data || [] });
    }

    // POST /api/admin/chat/tickets/:id/comments
    if (params.resource === 'tickets' && params.id && params.action === 'comments' && method === 'POST') {
      const body = await readJson(request);
      if (!body.content?.trim()) return errJson('Conteúdo é obrigatório.');
      const { data: comment, error } = await sb
        .from('re_support_ticket_comments')
        .insert({
          ticket_id: params.id,
          author_id: user.id,
          content: body.content.trim(),
          is_internal: Boolean(body.is_internal),
        })
        .select()
        .single();
      if (error) return errJson(error.message, 500);
      return json({ success: true, comment });
    }

    return json({ error: 'Rota não encontrada.' }, { status: 404 });
  }

  // ─── CLIENT SCOPE ─────────────────────────────────────────────────────────

  // GET /api/chat/conversation — retorna ou cria conversa aberta
  if (params.resource === 'conversation' && !params.id && method === 'GET') {
    let { data: conv } = await sb
      .from('re_chat_conversations')
      .select('*')
      .eq('client_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conv) {
      const { data: newConv, error } = await sb
        .from('re_chat_conversations')
        .insert({ client_id: user.id })
        .select()
        .single();
      if (error) return errJson(error.message, 500);
      conv = newConv;
    }
    return json({ conversation: conv });
  }

  // GET /api/chat/conversations
  if (params.resource === 'conversations' && !params.id && method === 'GET') {
    const { data, error } = await sb
      .from('re_chat_conversations')
      .select('*')
      .eq('client_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) return errJson(error.message, 500);
    return json({ conversations: data || [] });
  }

  // GET /api/chat/conversations/:id/messages
  if (params.resource === 'conversations' && params.id && params.action === 'messages' && method === 'GET') {
    const since = url.searchParams.get('since');
    let query = sb
      .from('re_chat_messages')
      .select('*')
      .eq('conversation_id', params.id)
      .order('created_at', { ascending: true });
    if (since) query = query.gt('created_at', since);
    const { data, error } = await query;
    if (error) return errJson(error.message, 500);
    return json({ messages: data || [] });
  }

  // POST /api/chat/conversations/:id/messages
  if (params.resource === 'conversations' && params.id && params.action === 'messages' && method === 'POST') {
    const body = await readJson(request);
    if (!body.content?.trim()) return errJson('Conteúdo é obrigatório.');
    const { data: msg, error } = await sb
      .from('re_chat_messages')
      .insert({
        conversation_id: params.id,
        sender_id: user.id,
        sender_role: 'client',
        content: body.content.trim(),
        metadata: body.metadata || {},
      })
      .select()
      .single();
    if (error) return errJson(error.message, 500);
    await sb.from('re_chat_conversations').update({ updated_at: new Date().toISOString() }).eq('id', params.id);
    // Notificar admins
    const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(20);
    for (const admin of (admins || [])) {
      queueSideEffect(context, () => pushNotification(
        sb, admin.id, 'message',
        'Nova mensagem de cliente',
        `${user.name || user.email}: ${body.content.trim().slice(0, 80)}`,
        'chat_conversation', params.id,
      ), 'recuperachat-notify-admin');
    }
    return json({ success: true, message: msg });
  }

  // POST /api/chat/conversations/:id/read
  if (params.resource === 'conversations' && params.id && params.action === 'read' && method === 'POST') {
    await sb.from('re_chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', params.id)
      .neq('sender_id', user.id)
      .is('read_at', null);
    return json({ success: true });
  }

  // GET /api/chat/tickets
  if (params.resource === 'tickets' && !params.id && method === 'GET') {
    const { data, error } = await sb
      .from('re_support_tickets')
      .select('*')
      .eq('client_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return errJson(error.message, 500);
    return json({ tickets: data || [] });
  }

  // GET /api/chat/tickets/:id/comments
  if (params.resource === 'tickets' && params.id && params.action === 'comments' && method === 'GET') {
    const { data, error } = await sb
      .from('re_support_ticket_comments')
      .select('*')
      .eq('ticket_id', params.id)
      .eq('is_internal', false)
      .order('created_at', { ascending: true });
    if (error) return errJson(error.message, 500);
    return json({ comments: data || [] });
  }

  // POST /api/chat/tickets/:id/comments
  if (params.resource === 'tickets' && params.id && params.action === 'comments' && method === 'POST') {
    const body = await readJson(request);
    if (!body.content?.trim()) return errJson('Conteúdo é obrigatório.');
    const { data: comment, error } = await sb
      .from('re_support_ticket_comments')
      .insert({
        ticket_id: params.id,
        author_id: user.id,
        content: body.content.trim(),
        is_internal: false,
      })
      .select()
      .single();
    if (error) return errJson(error.message, 500);
    return json({ success: true, comment });
  }

  return json({ error: 'Rota não encontrada.' }, { status: 404 });
}
