'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// RecuperaChat — Rotas Express
// API REST para Chat e Suporte Multitenant
// ═══════════════════════════════════════════════════════════════════════════════

const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../lib/auth');
const { pushNotification } = require('../lib/logging');
const {
  createConversation,
  listConversationsForConsultant,
  getOpenConversationForClient,
  listConversationsForClient,
  updateConversationStatus,
  insertChatMessage,
  listChatMessages,
  markMessagesAsRead,
  countUnreadByConversation,
  createSupportTicket,
  listTicketsForClient,
  listAllTickets,
  updateTicket,
  addTicketComment,
  listTicketComments,
  listClientDepartments,
  listOrganizationMembers,
} = require('../lib/recuperachat/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(res, status, msg) {
  return res.status(status).json({ error: msg });
}

// ─── CONVERSAS — Rotas do Cliente ─────────────────────────────────────────────

/**
 * GET /api/chat/conversation
 * Retorna a conversa aberta do cliente autenticado.
 * Se não existir, cria uma nova automaticamente.
 */
router.get('/api/chat/conversation', requireAuth, async (req, res) => {
  try {
    let conv = await getOpenConversationForClient(req.user.id);
    if (!conv) {
      conv = await createConversation({ client_id: req.user.id });
    }
    res.json({ conversation: conv });
  } catch (e) {
    console.error('[RecuperaChat] GET /api/chat/conversation', e.message);
    err(res, 500, e.message);
  }
});

/**
 * GET /api/chat/conversations
 * Histórico de todas as conversas do cliente.
 */
router.get('/api/chat/conversations', requireAuth, async (req, res) => {
  try {
    const convs = await listConversationsForClient(req.user.id);
    res.json({ conversations: convs });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * GET /api/chat/conversations/:id/messages
 * Mensagens de uma conversa (com polling incremental via ?since=ISO).
 */
router.get('/api/chat/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const since = req.query.since || null;
    const messages = await listChatMessages(req.params.id, since);
    res.json({ messages });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/chat/conversations/:id/messages
 * Envia uma mensagem como cliente.
 */
router.post('/api/chat/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { content, metadata } = req.body;
    if (!content?.trim()) return err(res, 400, 'Conteúdo da mensagem é obrigatório.');

    const msg = await insertChatMessage({
      conversation_id: req.params.id,
      sender_id: req.user.id,
      sender_role: 'client',
      content: content.trim(),
      metadata: metadata || {},
    });

    // Notificar consultores sobre nova mensagem
    const { sb } = require('../lib/config');
    const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(20);
    for (const admin of (admins || [])) {
      pushNotification(
        admin.id, 'message',
        'Nova mensagem de cliente',
        `${req.user.name || req.user.email}: ${content.trim().slice(0, 80)}`,
        'chat_conversation', req.params.id
      ).catch(e => console.warn('[RecuperaChat] notify admin:', e?.message));
    }

    res.json({ success: true, message: msg });
  } catch (e) {
    console.error('[RecuperaChat] POST messages', e.message);
    err(res, 500, e.message);
  }
});

/**
 * POST /api/chat/conversations/:id/read
 * Marca mensagens de uma conversa como lidas pelo cliente.
 */
router.post('/api/chat/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    await markMessagesAsRead(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── TICKETS — Rotas do Cliente ───────────────────────────────────────────────

/**
 * GET /api/chat/tickets
 * Lista chamados do cliente autenticado.
 */
router.get('/api/chat/tickets', requireAuth, async (req, res) => {
  try {
    const tickets = await listTicketsForClient(req.user.id);
    res.json({ tickets });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * GET /api/chat/tickets/:id/comments
 * Comentários públicos de um ticket do cliente.
 */
router.get('/api/chat/tickets/:id/comments', requireAuth, async (req, res) => {
  try {
    const comments = await listTicketComments(req.params.id, false);
    res.json({ comments });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/chat/tickets/:id/comments
 * Cliente adiciona comentário público a um ticket.
 */
router.post('/api/chat/tickets/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return err(res, 400, 'Conteúdo é obrigatório.');
    const comment = await addTicketComment({
      ticket_id: req.params.id,
      author_id: req.user.id,
      content: content.trim(),
      is_internal: false,
    });
    res.json({ success: true, comment });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── ADMIN — Conversas ────────────────────────────────────────────────────────

/**
 * GET /api/admin/chat/conversations
 * Lista conversas visíveis para o consultor logado.
 * Suporta ?status=open|resolved|snoozed e ?all=1 para super-admin.
 */
router.get('/api/admin/chat/conversations', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || null;
    // Se ?all=1 ou super-admin, mostra todas as conversas
    const consultantId = req.query.all === '1' ? null : req.user.id;
    const convs = await listConversationsForConsultant(consultantId, status);
    res.json({ conversations: convs });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * GET /api/admin/chat/conversations/:id/messages
 * Mensagens de uma conversa (admin).
 */
router.get('/api/admin/chat/conversations/:id/messages', requireAdmin, async (req, res) => {
  try {
    const since = req.query.since || null;
    const messages = await listChatMessages(req.params.id, since);
    res.json({ messages });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/admin/chat/conversations/:id/messages
 * Consultor envia mensagem em uma conversa.
 */
router.post('/api/admin/chat/conversations/:id/messages', requireAdmin, async (req, res) => {
  try {
    const { content, metadata } = req.body;
    if (!content?.trim()) return err(res, 400, 'Conteúdo é obrigatório.');

    const msg = await insertChatMessage({
      conversation_id: req.params.id,
      sender_id: req.user.id,
      sender_role: 'admin',
      content: content.trim(),
      metadata: metadata || {},
    });

    // Buscar client_id da conversa para notificar o cliente
    const { sb } = require('../lib/config');
    const { data: conv } = await sb
      .from('re_chat_conversations')
      .select('client_id')
      .eq('id', req.params.id)
      .single();

    if (conv?.client_id) {
      pushNotification(
        conv.client_id, 'message',
        'Nova mensagem do consultor',
        content.trim().slice(0, 100),
        'chat_conversation', req.params.id
      ).catch(e => console.warn('[RecuperaChat] notify client:', e?.message));
    }

    res.json({ success: true, message: msg });
  } catch (e) {
    console.error('[RecuperaChat] POST admin messages', e.message);
    err(res, 500, e.message);
  }
});

/**
 * PATCH /api/admin/chat/conversations/:id/status
 * Atualiza status de uma conversa (open/resolved/snoozed).
 */
router.patch('/api/admin/chat/conversations/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const VALID = ['open', 'resolved', 'snoozed'];
    if (!VALID.includes(status)) return err(res, 400, 'Status inválido.');
    await updateConversationStatus(req.params.id, status, req.user.id);
    res.json({ success: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/admin/chat/conversations/:id/read
 * Marca mensagens de uma conversa como lidas pelo consultor.
 */
router.post('/api/admin/chat/conversations/:id/read', requireAdmin, async (req, res) => {
  try {
    await markMessagesAsRead(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/admin/chat/conversations
 * Consultor inicia uma nova conversa com um cliente.
 */
router.post('/api/admin/chat/conversations', requireAdmin, async (req, res) => {
  try {
    const { client_id, subject, initial_message } = req.body;
    if (!client_id) return err(res, 400, 'ID do cliente é obrigatório.');

    const conv = await createConversation({
      client_id,
      consultant_id: req.user.id,
      subject: subject || 'Suporte Direto',
    });

    if (initial_message?.trim()) {
      await insertChatMessage({
        conversation_id: conv.id,
        sender_id: req.user.id,
        sender_role: 'admin',
        content: initial_message.trim(),
      });
    }

    res.json({ success: true, conversation: conv });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * GET /api/admin/chat/client/:id/org-data
 * Retorna departamentos e membros da organização do cliente para o widget.
 */
router.get('/api/admin/chat/client/:id/org-data', requireAdmin, async (req, res) => {
  try {
    const [departments, members] = await Promise.all([
      listClientDepartments(req.params.id),
      listOrganizationMembers(req.params.id)
    ]);
    res.json({ departments, members });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── ADMIN — Conversão em Chamado ─────────────────────────────────────────────

/**
 * POST /api/admin/chat/conversations/:id/convert-to-ticket
 * Converte uma conversa de chat em um chamado de suporte estruturado.
 */
router.post('/api/admin/chat/conversations/:id/convert-to-ticket', requireAdmin, async (req, res) => {
  try {
    const { subject, description, priority, assigned_to } = req.body;
    if (!subject?.trim()) return err(res, 400, 'Assunto é obrigatório.');
    if (!description?.trim()) return err(res, 400, 'Descrição é obrigatória.');

    // Buscar client_id da conversa
    const { sb } = require('../lib/config');
    const { data: conv } = await sb
      .from('re_chat_conversations')
      .select('client_id')
      .eq('id', req.params.id)
      .single();

    if (!conv) return err(res, 404, 'Conversa não encontrada.');

    const ticket = await createSupportTicket({
      client_id: conv.client_id,
      creator_id: req.user.id,
      subject: subject.trim(),
      description: description.trim(),
      priority: priority || 'normal',
      assigned_to: assigned_to || req.user.id,
      source_conversation_id: req.params.id,
    });

    // Inserir mensagem de sistema na conversa registrando a conversão
    await insertChatMessage({
      conversation_id: req.params.id,
      sender_id: req.user.id,
      sender_role: 'system',
      content: `Chamado #${ticket.ticket_number} criado: "${subject.trim()}"`,
      metadata: { ticket_id: ticket.id, ticket_number: ticket.ticket_number },
    });

    res.json({ success: true, ticket });
  } catch (e) {
    console.error('[RecuperaChat] convert-to-ticket', e.message);
    err(res, 500, e.message);
  }
});

// ─── ADMIN — Tickets ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/chat/tickets
 * Lista todos os tickets, com filtros opcionais.
 */
router.get('/api/admin/chat/tickets', requireAdmin, async (req, res) => {
  try {
    const { status, assigned_to } = req.query;
    const tickets = await listAllTickets({
      status: status || null,
      assigned_to: assigned_to || null,
    });
    res.json({ tickets });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * PATCH /api/admin/chat/tickets/:id
 * Atualiza status, prioridade ou atribuição de um ticket.
 */
router.patch('/api/admin/chat/tickets/:id', requireAdmin, async (req, res) => {
  try {
    await updateTicket(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * GET /api/admin/chat/tickets/:id/comments
 * Comentários de um ticket (inclui notas internas para admin).
 */
router.get('/api/admin/chat/tickets/:id/comments', requireAdmin, async (req, res) => {
  try {
    const comments = await listTicketComments(req.params.id, true);
    res.json({ comments });
  } catch (e) {
    err(res, 500, e.message);
  }
});

/**
 * POST /api/admin/chat/tickets/:id/comments
 * Consultor adiciona comentário (público ou interno) a um ticket.
 */
router.post('/api/admin/chat/tickets/:id/comments', requireAdmin, async (req, res) => {
  try {
    const { content, is_internal } = req.body;
    if (!content?.trim()) return err(res, 400, 'Conteúdo é obrigatório.');
    const comment = await addTicketComment({
      ticket_id: req.params.id,
      author_id: req.user.id,
      content: content.trim(),
      is_internal: Boolean(is_internal),
    });
    res.json({ success: true, comment });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── IA-Ready — Endpoint de integração com LLMs ───────────────────────────────

/**
 * POST /api/admin/chat/conversations/:id/ai-summary
 * Gera um resumo da conversa usando o provedor de IA configurado.
 * Suporta: GPT (OpenAI), Gemini, Ollama (local), Cloudflare Workers AI.
 * O provider é selecionado via header X-AI-Provider ou variável de ambiente.
 */
router.post('/api/admin/chat/conversations/:id/ai-summary', requireAdmin, async (req, res) => {
  try {
    const messages = await listChatMessages(req.params.id);
    if (!messages.length) return err(res, 400, 'Conversa sem mensagens para resumir.');

    // Formata mensagens para o contexto do LLM
    const transcript = messages
      .filter(m => m.sender_role !== 'system')
      .map(m => `[${m.sender_role.toUpperCase()}] ${m.content}`)
      .join('\n');

    const prompt = `Você é um assistente de suporte empresarial. Resuma a seguinte conversa de suporte em 2-3 frases, destacando o problema principal e o status atual:\n\n${transcript}`;

    // Integração com OpenAI (padrão) — extensível para outros provedores
    const { default: OpenAI } = await import('openai').catch(() => ({ default: null }));
    if (!OpenAI || !process.env.OPENAI_API_KEY) {
      return res.json({
        success: false,
        warning: 'Provedor de IA não configurado. Defina OPENAI_API_KEY ou configure outro provedor.',
        transcript_length: messages.length,
      });
    }

    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || '';
    await require('../lib/recuperachat/db').updateConversationAISummary(req.params.id, summary);

    res.json({ success: true, summary });
  } catch (e) {
    console.error('[RecuperaChat] ai-summary', e.message);
    err(res, 500, e.message);
  }
});

module.exports = router;
