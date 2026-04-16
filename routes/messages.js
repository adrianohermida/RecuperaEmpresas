'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { readMessages, insertMessage } = require('../lib/db');
const { pushNotification } = require('../lib/logging');

// ─── In-memory: admin message seen tracker ────────────────────────────────────
const _adminMsgSeen = new Map(); // adminId → { clientId: ISO timestamp }

router.get('/api/messages', requireAuth, async (req, res) => {
  res.json({ messages: await readMessages(req.user.id) });
});

router.post('/api/messages', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  const msg = await insertMessage({
    user_id:   req.user.id,
    from_role: 'client',
    from_name: req.user.name || req.user.email,
    text:      text.trim(),
  });
  // Notify admin users that a client sent a message
  const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(20);
  for (const admin of (admins || [])) {
    pushNotification(admin.id, 'message', 'Nova mensagem de cliente',
      `${req.user.name || req.user.email}: ${text.trim().slice(0, 80)}`,
      'message', req.user.id).catch(e => console.warn('[async]', e?.message));
  }
  res.json({ success: true, message: msg });
});

// ─── Mensagens: polling em tempo real ────────────────────────────────────────
// Cliente: busca mensagens novas desde 'since' (ISO timestamp)
router.get('/api/messages/poll', requireAuth, async (req, res) => {
  const since = req.query.since || new Date(0).toISOString();
  const { data } = await sb.from('re_messages')
    .select('*').eq('user_id', req.user.id)
    .gt('ts', since).order('ts');
  res.json({ messages: data || [] });
});

// Admin: conta mensagens de clientes não lidas por agente
router.get('/api/admin/messages/unread', requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const seen    = _adminMsgSeen.get(adminId) || {};

  const { data: msgs } = await sb.from('re_messages')
    .select('user_id, ts, from_role')
    .eq('from_role', 'client')
    .order('ts', { ascending: false });

  const unread = {};
  (msgs || []).forEach(m => {
    const lastSeen = seen[m.user_id] || '1970-01-01T00:00:00.000Z';
    if (m.ts > lastSeen) unread[m.user_id] = (unread[m.user_id] || 0) + 1;
  });
  res.json({ unread });
});

// Admin: marca mensagens de um cliente como vistas
router.post('/api/admin/messages/seen/:clientId', requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  if (!_adminMsgSeen.has(adminId)) _adminMsgSeen.set(adminId, {});
  _adminMsgSeen.get(adminId)[req.params.clientId] = new Date().toISOString();
  res.json({ success: true });
});

// Admin: polling de mensagens de um cliente específico
router.get('/api/admin/client/:id/messages/poll', requireAdmin, async (req, res) => {
  const since = req.query.since || new Date(0).toISOString();
  const { data } = await sb.from('re_messages')
    .select('*').eq('user_id', req.params.id)
    .gt('ts', since).order('ts');
  res.json({ messages: data || [] });
});

module.exports = router;
module.exports._adminMsgSeen = _adminMsgSeen;
