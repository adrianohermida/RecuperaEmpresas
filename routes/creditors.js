'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog } = require('../lib/logging');

function companyId(user) { return user.company_id || user.id; }

async function listCreditors(cid) {
  const { data } = await sb.from('re_creditors')
    .select('*').eq('company_id', cid).order('created_at', { ascending: false });
  return data || [];
}

// Client: list own creditors
router.get('/api/creditors', requireAuth, async (req, res) => {
  res.json({ creditors: await listCreditors(companyId(req.user)) });
});

// Client: create creditor
router.post('/api/creditors', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode gerenciar credores.' });
  const { name, document, creditor_type, debt_type, original_amount, current_balance,
    interest_rate, due_date, last_payment_date, contact_name, contact_phone, contact_email,
    collateral, is_judicial, process_number, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome do credor é obrigatório.' });
  const { data, error } = await sb.from('re_creditors').insert({
    company_id: req.user.id,
    name: name.trim(), document: document || null,
    creditor_type: creditor_type || 'bank', debt_type: debt_type || 'unsecured',
    original_amount: original_amount || null, current_balance: current_balance || null,
    interest_rate: interest_rate || null, due_date: due_date || null,
    last_payment_date: last_payment_date || null,
    contact_name: contact_name || null, contact_phone: contact_phone || null,
    contact_email: contact_email || null, collateral: collateral || null,
    is_judicial: !!is_judicial, process_number: process_number || null, notes: notes || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, creditor: data });
});

// Client: update creditor
router.put('/api/creditors/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar credores.' });
  const allowed = ['name','document','creditor_type','debt_type','original_amount','current_balance',
    'interest_rate','due_date','last_payment_date','status','contact_name','contact_phone',
    'contact_email','collateral','is_judicial','process_number','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_creditors')
    .update(updates).eq('id', req.params.id).eq('company_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Credor não encontrado.' });
  res.json({ success: true, creditor: data });
});

// Client: delete creditor
router.delete('/api/creditors/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode excluir credores.' });
  const { error } = await sb.from('re_creditors')
    .delete().eq('id', req.params.id).eq('company_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get('/api/admin/client/:id/creditors', requireAdmin, async (req, res) => {
  res.json({ creditors: await listCreditors(req.params.id) });
});

router.post('/api/admin/client/:id/creditors', requireAdmin, async (req, res) => {
  const { name, document, creditor_type, debt_type, original_amount, current_balance,
    interest_rate, due_date, last_payment_date, contact_name, contact_phone, contact_email,
    collateral, is_judicial, process_number, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome do credor é obrigatório.' });
  const { data, error } = await sb.from('re_creditors').insert({
    company_id: req.params.id,
    name: name.trim(), document: document || null,
    creditor_type: creditor_type || 'bank', debt_type: debt_type || 'unsecured',
    original_amount: original_amount || null, current_balance: current_balance || null,
    interest_rate: interest_rate || null, due_date: due_date || null,
    last_payment_date: last_payment_date || null,
    contact_name: contact_name || null, contact_phone: contact_phone || null,
    contact_email: contact_email || null, collateral: collateral || null,
    is_judicial: !!is_judicial, process_number: process_number || null, notes: notes || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'creditor', entityId: data.id, action: 'create', after: { name, company_id: req.params.id } })
    .catch(e => console.warn('[async]', e?.message));
  res.json({ success: true, creditor: data });
});

router.put('/api/admin/client/:id/creditors/:creditorId', requireAdmin, async (req, res) => {
  const allowed = ['name','document','creditor_type','debt_type','original_amount','current_balance',
    'interest_rate','due_date','last_payment_date','status','contact_name','contact_phone',
    'contact_email','collateral','is_judicial','process_number','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_creditors')
    .update(updates).eq('id', req.params.creditorId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Credor não encontrado.' });
  res.json({ success: true, creditor: data });
});

router.delete('/api/admin/client/:id/creditors/:creditorId', requireAdmin, async (req, res) => {
  const { error } = await sb.from('re_creditors')
    .delete().eq('id', req.params.creditorId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
