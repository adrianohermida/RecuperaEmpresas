'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog } = require('../lib/logging');

function companyId(user) { return user.company_id || user.id; }

// ─── Suppliers ────────────────────────────────────────────────────────────────
router.get('/api/suppliers', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_suppliers')
    .select('*').eq('company_id', companyId(req.user)).order('name');
  res.json({ suppliers: data || [] });
});

router.post('/api/suppliers', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode gerenciar fornecedores.' });
  const { name, document, category, contact_name, contact_phone, contact_email,
    address, website, payment_terms, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
  const { data, error } = await sb.from('re_suppliers').insert({
    company_id: req.user.id, name: name.trim(),
    document: document || null, category: category || null,
    contact_name: contact_name || null, contact_phone: contact_phone || null,
    contact_email: contact_email || null, address: address || null,
    website: website || null, payment_terms: payment_terms || null,
    notes: notes || null, created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, supplier: data });
});

router.put('/api/suppliers/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar fornecedores.' });
  const allowed = ['name','document','category','contact_name','contact_phone','contact_email',
    'address','website','status','payment_terms','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_suppliers')
    .update(updates).eq('id', req.params.id).eq('company_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  res.json({ success: true, supplier: data });
});

router.delete('/api/suppliers/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode excluir fornecedores.' });
  const { error } = await sb.from('re_suppliers').delete().eq('id', req.params.id).eq('company_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Contracts ────────────────────────────────────────────────────────────────
router.get('/api/suppliers/:supplierId/contracts', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_supplier_contracts')
    .select('*').eq('supplier_id', req.params.supplierId)
    .eq('company_id', companyId(req.user)).order('created_at', { ascending: false });
  res.json({ contracts: data || [] });
});

router.get('/api/contracts', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_supplier_contracts')
    .select('*,re_suppliers(id,name,category)')
    .eq('company_id', companyId(req.user)).order('created_at', { ascending: false });
  res.json({ contracts: data || [] });
});

router.post('/api/suppliers/:supplierId/contracts', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode gerenciar contratos.' });
  const { title, description, value_cents, start_date, end_date, renewal_date,
    payment_terms, notice_period_days, auto_renewal, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título é obrigatório.' });
  const { data, error } = await sb.from('re_supplier_contracts').insert({
    company_id: req.user.id, supplier_id: req.params.supplierId,
    title: title.trim(), description: description || null,
    value_cents: value_cents || null, start_date: start_date || null,
    end_date: end_date || null, renewal_date: renewal_date || null,
    payment_terms: payment_terms || null,
    notice_period_days: notice_period_days || null,
    auto_renewal: !!auto_renewal, notes: notes || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, contract: data });
});

router.put('/api/contracts/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar contratos.' });
  const allowed = ['title','description','value_cents','start_date','end_date','renewal_date',
    'status','payment_terms','notice_period_days','auto_renewal','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_supplier_contracts')
    .update(updates).eq('id', req.params.id).eq('company_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Contrato não encontrado.' });
  res.json({ success: true, contract: data });
});

router.delete('/api/contracts/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode excluir contratos.' });
  const { error } = await sb.from('re_supplier_contracts').delete().eq('id', req.params.id).eq('company_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get('/api/admin/client/:id/suppliers', requireAdmin, async (req, res) => {
  const { data: suppliers } = await sb.from('re_suppliers')
    .select('*').eq('company_id', req.params.id).order('name');
  const { data: contracts } = await sb.from('re_supplier_contracts')
    .select('*,re_suppliers(id,name)').eq('company_id', req.params.id).order('created_at', { ascending: false });
  res.json({ suppliers: suppliers || [], contracts: contracts || [] });
});

router.post('/api/admin/client/:id/suppliers', requireAdmin, async (req, res) => {
  const { name, document, category, contact_name, contact_phone, contact_email,
    address, website, payment_terms, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
  const { data, error } = await sb.from('re_suppliers').insert({
    company_id: req.params.id, name: name.trim(), document: document || null,
    category: category || null, contact_name: contact_name || null,
    contact_phone: contact_phone || null, contact_email: contact_email || null,
    address: address || null, website: website || null,
    payment_terms: payment_terms || null, notes: notes || null, created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, supplier: data });
});

router.put('/api/admin/client/:id/suppliers/:supplierId', requireAdmin, async (req, res) => {
  const allowed = ['name','document','category','contact_name','contact_phone','contact_email',
    'address','website','status','payment_terms','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_suppliers')
    .update(updates).eq('id', req.params.supplierId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  res.json({ success: true, supplier: data });
});

router.delete('/api/admin/client/:id/suppliers/:supplierId', requireAdmin, async (req, res) => {
  const { error } = await sb.from('re_suppliers').delete().eq('id', req.params.supplierId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

router.post('/api/admin/client/:id/suppliers/:supplierId/contracts', requireAdmin, async (req, res) => {
  const { title, description, value_cents, start_date, end_date, renewal_date,
    payment_terms, notice_period_days, auto_renewal, notes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título é obrigatório.' });
  const { data, error } = await sb.from('re_supplier_contracts').insert({
    company_id: req.params.id, supplier_id: req.params.supplierId,
    title: title.trim(), description: description || null,
    value_cents: value_cents || null, start_date: start_date || null,
    end_date: end_date || null, renewal_date: renewal_date || null,
    payment_terms: payment_terms || null, notice_period_days: notice_period_days || null,
    auto_renewal: !!auto_renewal, notes: notes || null, created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, contract: data });
});

router.put('/api/admin/client/:id/contracts/:contractId', requireAdmin, async (req, res) => {
  const allowed = ['title','description','value_cents','start_date','end_date','renewal_date',
    'status','payment_terms','notice_period_days','auto_renewal','notes'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await sb.from('re_supplier_contracts')
    .update(updates).eq('id', req.params.contractId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Contrato não encontrado.' });
  res.json({ success: true, contract: data });
});

router.delete('/api/admin/client/:id/contracts/:contractId', requireAdmin, async (req, res) => {
  const { error } = await sb.from('re_supplier_contracts').delete().eq('id', req.params.contractId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
