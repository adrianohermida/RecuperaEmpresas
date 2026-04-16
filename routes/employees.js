'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog } = require('../lib/logging');

function companyId(user) { return user.company_id || user.id; }

const ALLOWED_FIELDS = [
  'department_id','name','cpf','rg','birth_date','gender','email','phone','address',
  'job_title','employment_type','admission_date','termination_date','status','salary_cents',
  'fgts_rate','inss_rate','irrf_rate',
  'has_vale_transporte','vt_value_cents','has_vale_refeicao','vr_value_cents',
  'has_plano_saude','ps_value_cents','has_plano_odonto','po_value_cents',
  'total_cost_cents','notes',
];

function calcTotalCost(body) {
  const salary = parseInt(body.salary_cents || 0);
  const fgts = Math.round(salary * (parseFloat(body.fgts_rate || 8) / 100));
  const vt = body.has_vale_transporte ? parseInt(body.vt_value_cents || 0) : 0;
  const vr = body.has_vale_refeicao ? parseInt(body.vr_value_cents || 0) : 0;
  const ps = body.has_plano_saude ? parseInt(body.ps_value_cents || 0) : 0;
  const po = body.has_plano_odonto ? parseInt(body.po_value_cents || 0) : 0;
  return salary + fgts + vt + vr + ps + po;
}

async function listEmployees(cid) {
  const { data } = await sb.from('re_employees')
    .select('*,re_departments(id,name)')
    .eq('company_id', cid)
    .order('status').order('name');
  return data || [];
}

// Client: list
router.get('/api/employees', requireAuth, async (req, res) => {
  res.json({ employees: await listEmployees(companyId(req.user)) });
});

// Client: create
router.post('/api/employees', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode gerenciar funcionários.' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const payload = { company_id: req.user.id, created_by: req.user.id, total_cost_cents: calcTotalCost(req.body) };
  ALLOWED_FIELDS.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });
  payload.name = name.trim();
  const { data, error } = await sb.from('re_employees').insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, employee: data });
});

// Client: update
router.put('/api/employees/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar funcionários.' });
  const updates = { updated_at: new Date().toISOString() };
  ALLOWED_FIELDS.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.total_cost_cents = calcTotalCost({ ...req.body });
  const { data, error } = await sb.from('re_employees')
    .update(updates).eq('id', req.params.id).eq('company_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  res.json({ success: true, employee: data });
});

// Client: delete
router.delete('/api/employees/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode excluir funcionários.' });
  const { error } = await sb.from('re_employees').delete().eq('id', req.params.id).eq('company_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get('/api/admin/client/:id/employees', requireAdmin, async (req, res) => {
  const employees = await listEmployees(req.params.id);
  // Summary stats
  const active = employees.filter(e => e.status === 'active');
  const totalPayroll = active.reduce((s, e) => s + (e.salary_cents || 0), 0);
  const totalCost = active.reduce((s, e) => s + (e.total_cost_cents || 0), 0);
  res.json({ employees, stats: { total: employees.length, active: active.length, totalPayroll, totalCost } });
});

router.post('/api/admin/client/:id/employees', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const payload = { company_id: req.params.id, created_by: req.user.id, total_cost_cents: calcTotalCost(req.body) };
  ALLOWED_FIELDS.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });
  payload.name = name.trim();
  const { data, error } = await sb.from('re_employees').insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'employee', entityId: data.id, action: 'create', after: { name, company_id: req.params.id } })
    .catch(e => console.warn('[async]', e?.message));
  res.json({ success: true, employee: data });
});

router.put('/api/admin/client/:id/employees/:empId', requireAdmin, async (req, res) => {
  const updates = { updated_at: new Date().toISOString() };
  ALLOWED_FIELDS.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.total_cost_cents = calcTotalCost({ ...req.body });
  const { data, error } = await sb.from('re_employees')
    .update(updates).eq('id', req.params.empId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  res.json({ success: true, employee: data });
});

router.delete('/api/admin/client/:id/employees/:empId', requireAdmin, async (req, res) => {
  const { error } = await sb.from('re_employees').delete().eq('id', req.params.empId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
