'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// RecuperaChat — Camada de Dados (db.js)
// Funções de acesso ao banco para conversas, mensagens e tickets
// ═══════════════════════════════════════════════════════════════════════════════

const { sb } = require('../config');

// ─── Conversas ────────────────────────────────────────────────────────────────

/**
 * Cria uma nova conversa de chat para um cliente.
 * @param {object} opts
 * @param {string} opts.client_id
 * @param {string} [opts.consultant_id]
 * @param {string} [opts.subject]
 * @returns {Promise<object>}
 */
/**
 * Cria uma nova conversa de chat.
 * Pode ser iniciada por cliente ou consultor.
 */
async function createConversation({ client_id, consultant_id = null, subject = null, metadata = {} }) {
  const { data, error } = await sb
    .from('re_chat_conversations')
    .insert({ client_id, consultant_id, subject, metadata })
    .select(`
      *,
      re_users!re_chat_conversations_client_id_fkey(name, company, email)
    `)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Retorna conversas visíveis para um consultor (admin).
 * Se consultant_id for null, retorna todas (super-admin).
 * @param {string|null} consultant_id
 * @param {'open'|'resolved'|'snoozed'|null} status
 * @returns {Promise<object[]>}
 */
/**
 * Retorna conversas para o consultor com dados enriquecidos (Freshchat style).
 */
async function listConversationsForConsultant(consultant_id, status = null) {
  let query = sb
    .from('re_chat_conversations')
    .select(`
      *,
      client:re_users!re_chat_conversations_client_id_fkey(id, name, company, email),
      consultant:re_users!re_chat_conversations_consultant_id_fkey(id, name),
      ticket:re_support_tickets(id, ticket_number, status, priority)
    `)
    .order('updated_at', { ascending: false });

  if (consultant_id) {
    query = query.eq('consultant_id', consultant_id);
  }
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Retorna a conversa aberta de um cliente, ou null se não existir.
 * @param {string} client_id
 * @returns {Promise<object|null>}
 */
async function getOpenConversationForClient(client_id) {
  const { data } = await sb
    .from('re_chat_conversations')
    .select('*')
    .eq('client_id', client_id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Retorna todas as conversas de um cliente (histórico).
 * @param {string} client_id
 * @returns {Promise<object[]>}
 */
async function listConversationsForClient(client_id) {
  const { data, error } = await sb
    .from('re_chat_conversations')
    .select('*')
    .eq('client_id', client_id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Atualiza o status de uma conversa.
 * @param {string} conversation_id
 * @param {'open'|'resolved'|'snoozed'} status
 * @param {string|null} resolved_by
 */
async function updateConversationStatus(conversation_id, status, resolved_by = null) {
  const updates = { status };
  if (status === 'resolved') {
    updates.resolved_at = new Date().toISOString();
  }
  const { error } = await sb
    .from('re_chat_conversations')
    .update(updates)
    .eq('id', conversation_id);
  if (error) throw error;
}

/**
 * Atualiza o resumo gerado por IA em uma conversa.
 * @param {string} conversation_id
 * @param {string} ai_summary
 */
async function updateConversationAISummary(conversation_id, ai_summary) {
  const { error } = await sb
    .from('re_chat_conversations')
    .update({ ai_summary })
    .eq('id', conversation_id);
  if (error) throw error;
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

/**
 * Insere uma nova mensagem em uma conversa.
 * Atualiza updated_at da conversa automaticamente via trigger.
 * @param {object} opts
 * @param {string} opts.conversation_id
 * @param {string} opts.sender_id
 * @param {'client'|'admin'|'system'|'ai'} opts.sender_role
 * @param {string} opts.content
 * @param {object} [opts.metadata]
 * @returns {Promise<object>}
 */
async function insertChatMessage({ conversation_id, sender_id, sender_role, content, metadata = {} }) {
  const { data, error } = await sb
    .from('re_chat_messages')
    .insert({ conversation_id, sender_id, sender_role, content, metadata })
    .select()
    .single();
  if (error) throw error;

  // Atualiza updated_at da conversa para refletir última atividade
  await sb
    .from('re_chat_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversation_id);

  return data;
}

/**
 * Retorna mensagens de uma conversa com paginação.
 * @param {string} conversation_id
 * @param {string} [since] - ISO timestamp para polling incremental
 * @returns {Promise<object[]>}
 */
async function listChatMessages(conversation_id, since = null) {
  let query = sb
    .from('re_chat_messages')
    .select('*')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true });

  if (since) {
    query = query.gt('created_at', since);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Marca mensagens de uma conversa como lidas para um usuário.
 * @param {string} conversation_id
 * @param {string} reader_id
 */
async function markMessagesAsRead(conversation_id, reader_id) {
  const { error } = await sb
    .from('re_chat_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversation_id)
    .neq('sender_id', reader_id)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Conta mensagens não lidas por conversa para um usuário.
 * @param {string[]} conversation_ids
 * @param {string} reader_id
 * @returns {Promise<Record<string, number>>}
 */
async function countUnreadByConversation(conversation_ids, reader_id) {
  if (!conversation_ids.length) return {};

  const { data, error } = await sb
    .from('re_chat_messages')
    .select('conversation_id')
    .in('conversation_id', conversation_ids)
    .neq('sender_id', reader_id)
    .is('read_at', null);

  if (error) throw error;

  const counts = {};
  for (const msg of (data || [])) {
    counts[msg.conversation_id] = (counts[msg.conversation_id] || 0) + 1;
  }
  return counts;
}

// ─── Tickets de Suporte ───────────────────────────────────────────────────────

/**
 * Cria um chamado de suporte, opcionalmente vinculado a uma conversa.
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function createSupportTicket({
  client_id,
  creator_id,
  subject,
  description,
  priority = 'normal',
  assigned_to = null,
  source_conversation_id = null,
}) {
  const { data, error } = await sb
    .from('re_support_tickets')
    .insert({
      client_id,
      creator_id,
      subject,
      description,
      priority,
      assigned_to,
      source_conversation_id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Lista tickets de um cliente.
 * @param {string} client_id
 * @returns {Promise<object[]>}
 */
async function listTicketsForClient(client_id) {
  const { data, error } = await sb
    .from('re_support_tickets')
    .select('*')
    .eq('client_id', client_id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Lista todos os tickets (visão admin), com filtros opcionais.
 * @param {object} filters
 * @param {string|null} filters.assigned_to
 * @param {'open'|'pending'|'resolved'|'closed'|null} filters.status
 * @returns {Promise<object[]>}
 */
async function listAllTickets({ assigned_to = null, status = null } = {}) {
  let query = sb
    .from('re_support_tickets')
    .select(`
      *,
      re_users!re_support_tickets_client_id_fkey(name, company)
    `)
    .order('created_at', { ascending: false });

  if (assigned_to) query = query.eq('assigned_to', assigned_to);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Atualiza status, prioridade ou atribuição de um ticket.
 * @param {string} ticket_id
 * @param {object} updates
 */
/**
 * Atualiza um ticket com suporte a metadados de departamento e grupo.
 */
async function updateTicket(ticket_id, updates) {
  const allowed = ['status', 'priority', 'assigned_to', 'resolved_at', 'metadata', 'subject', 'description'];
  const safe = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  
  if (safe.status === 'resolved' && !safe.resolved_at) {
    safe.resolved_at = new Date().toISOString();
  }
  if (safe.status === 'closed' && !safe.resolved_at) {
    safe.resolved_at = new Date().toISOString();
  }

  const { error } = await sb
    .from('re_support_tickets')
    .update(safe)
    .eq('id', ticket_id);
  if (error) throw error;
}

/**
 * Busca departamentos de uma empresa associada a um cliente.
 */
async function listClientDepartments(client_id) {
  // Primeiro buscar a empresa do cliente
  const { data: user } = await sb
    .from('re_users')
    .select('company_id')
    .eq('id', client_id)
    .single();
  
  if (!user?.company_id) return [];

  const { data, error } = await sb
    .from('re_departments')
    .select('id, name, description')
    .eq('company_id', user.company_id)
    .order('name');
  
  if (error) throw error;
  return data || [];
}

/**
 * Busca membros/usuários da organização do cliente.
 */
async function listOrganizationMembers(client_id) {
  const { data: user } = await sb
    .from('re_users')
    .select('company_id')
    .eq('id', client_id)
    .single();
  
  if (!user?.company_id) return [];

  const { data, error } = await sb
    .from('re_company_users')
    .select('id, name, email, role, department_id')
    .eq('company_id', user.company_id)
    .eq('active', true);
  
  if (error) throw error;
  return data || [];
}

/**
 * Adiciona um comentário a um ticket.
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function addTicketComment({ ticket_id, author_id, content, is_internal = false }) {
  const { data, error } = await sb
    .from('re_support_ticket_comments')
    .insert({ ticket_id, author_id, content, is_internal })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Lista comentários de um ticket.
 * Se is_admin = false, filtra notas internas.
 * @param {string} ticket_id
 * @param {boolean} is_admin
 * @returns {Promise<object[]>}
 */
async function listTicketComments(ticket_id, is_admin = false) {
  let query = sb
    .from('re_support_ticket_comments')
    .select('*')
    .eq('ticket_id', ticket_id)
    .order('created_at', { ascending: true });

  if (!is_admin) {
    query = query.eq('is_internal', false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = {
  // Conversas
  createConversation,
  listConversationsForConsultant,
  getOpenConversationForClient,
  listConversationsForClient,
  updateConversationStatus,
  updateConversationAISummary,
  // Mensagens
  insertChatMessage,
  listChatMessages,
  markMessagesAsRead,
  countUnreadByConversation,
  // Tickets
  createSupportTicket,
  listTicketsForClient,
  listAllTickets,
  updateTicket,
  addTicketComment,
  listTicketComments,
  // Integração Clientes/Org
  listClientDepartments,
  listOrganizationMembers,
};
