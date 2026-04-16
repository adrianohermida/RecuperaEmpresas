'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog } = require('../lib/logging');

// ─── Helper: resolve company_id for current user ──────────────────────────────
function companyId(user) {
  return user.company_id || user.id;
}

// ─── List departments (flat, with manager info) ───────────────────────────────
async function listDepts(cid) {
  const { data } = await sb.from('re_departments')
    .select('*,re_company_users!re_departments_manager_id_fkey(id,name,job_title)')
    .eq('company_id', cid)
    .order('order_index')
    .order('name');
  return data || [];
}

// Client: list own company departments
router.get('/api/departments', requireAuth, async (req, res) => {
  const depts = await listDepts(companyId(req.user));
  res.json({ departments: depts });
});

// Client: create department
router.post('/api/departments', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode criar departamentos.' });
  const { name, description, parent_id, manager_id, color, order_index } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const cid = req.user.id;
  const { data, error } = await sb.from('re_departments').insert({
    company_id: cid,
    name: name.trim(),
    description: description?.trim() || null,
    parent_id: parent_id || null,
    manager_id: manager_id || null,
    color: color || '#6366f1',
    order_index: order_index ?? 0,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, department: data });
});

// Client: update department
router.put('/api/departments/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar departamentos.' });
  const cid = req.user.id;
  const { name, description, parent_id, manager_id, color, order_index } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (parent_id !== undefined) updates.parent_id = parent_id || null;
  if (manager_id !== undefined) updates.manager_id = manager_id || null;
  if (color !== undefined) updates.color = color;
  if (order_index !== undefined) updates.order_index = order_index;
  const { data, error } = await sb.from('re_departments')
    .update(updates).eq('id', req.params.id).eq('company_id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Departamento não encontrado.' });
  res.json({ success: true, department: data });
});

// Client: delete department
router.delete('/api/departments/:id', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode excluir departamentos.' });
  const cid = req.user.id;
  // Unlink members before deleting
  await sb.from('re_company_users').update({ department_id: null }).eq('department_id', req.params.id);
  await sb.from('re_departments').update({ parent_id: null }).eq('parent_id', req.params.id);
  const { error } = await sb.from('re_departments').delete().eq('id', req.params.id).eq('company_id', cid);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

// Admin: list departments for a client
router.get('/api/admin/client/:id/departments', requireAdmin, async (req, res) => {
  const depts = await listDepts(req.params.id);
  res.json({ departments: depts });
});

// Admin: create department for a client
router.post('/api/admin/client/:id/departments', requireAdmin, async (req, res) => {
  const { name, description, parent_id, manager_id, color, order_index } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const { data, error } = await sb.from('re_departments').insert({
    company_id: req.params.id,
    name: name.trim(),
    description: description?.trim() || null,
    parent_id: parent_id || null,
    manager_id: manager_id || null,
    color: color || '#6366f1',
    order_index: order_index ?? 0,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'department', entityId: data.id, action: 'create', after: { name, company_id: req.params.id } })
    .catch(e => console.warn('[async]', e?.message));
  res.json({ success: true, department: data });
});

// Admin: update department for a client
router.put('/api/admin/client/:id/departments/:deptId', requireAdmin, async (req, res) => {
  const { name, description, parent_id, manager_id, color, order_index } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (parent_id !== undefined) updates.parent_id = parent_id || null;
  if (manager_id !== undefined) updates.manager_id = manager_id || null;
  if (color !== undefined) updates.color = color;
  if (order_index !== undefined) updates.order_index = order_index;
  const { data, error } = await sb.from('re_departments')
    .update(updates).eq('id', req.params.deptId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Departamento não encontrado.' });
  res.json({ success: true, department: data });
});

// Admin: delete department
router.delete('/api/admin/client/:id/departments/:deptId', requireAdmin, async (req, res) => {
  await sb.from('re_company_users').update({ department_id: null }).eq('department_id', req.params.deptId);
  await sb.from('re_departments').update({ parent_id: null }).eq('parent_id', req.params.deptId);
  const { error } = await sb.from('re_departments')
    .delete().eq('id', req.params.deptId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Admin: assign member to department (also sets job_title)
router.put('/api/admin/client/:id/members/:memberId/department', requireAdmin, async (req, res) => {
  const { department_id, job_title } = req.body;
  const updates = {};
  if (department_id !== undefined) updates.department_id = department_id || null;
  if (job_title !== undefined) updates.job_title = job_title?.trim() || null;
  const { data, error } = await sb.from('re_company_users')
    .update(updates).eq('id', req.params.memberId).eq('company_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ success: true, member: data });
});

// Admin: invite new member (generates credentials + sends email)
router.post('/api/admin/client/:id/members/invite', requireAdmin, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { sendMail, emailWrapper } = require('../lib/email');
  const { BASE_URL } = require('../lib/config');
  const { name, email, role, job_title, department_id } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name e email são obrigatórios.' });

  // Check uniqueness
  const { data: existing } = await sb.from('re_company_users')
    .select('id').eq('company_id', req.params.id).eq('email', email.toLowerCase()).single();
  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa.' });

  // Generate temporary password
  const tmpPwd = Math.random().toString(36).slice(2, 10) + 'X1!';
  const hash = await bcrypt.hash(tmpPwd, 10);

  const { data: member, error } = await sb.from('re_company_users').insert({
    company_id: req.params.id,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    role: role || 'operacional',
    password_hash: hash,
    job_title: job_title?.trim() || null,
    department_id: department_id || null,
    active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Get company owner info for email
  const { data: owner } = await sb.from('re_users').select('name,company').eq('id', req.params.id).single();

  sendMail(email.toLowerCase().trim(),
    `Convite: acesso ao portal da ${owner?.company || owner?.name || 'empresa'}`,
    emailWrapper('Você foi convidado!',
      `<p>Olá, <b>${name}</b>!</p>
       <p>Você foi adicionado à equipe de <b>${owner?.company || owner?.name || 'sua empresa'}</b> no portal Recupera Empresas.</p>
       <p><b>Papel:</b> ${role || 'Operacional'}</p>
       <p><b>Seu acesso temporário:</b><br>
          E-mail: <code>${email.toLowerCase().trim()}</code><br>
          Senha temporária: <code>${tmpPwd}</code></p>
       <p>Acesse o portal e altere sua senha no primeiro acesso:</p>
       <p><a href="${BASE_URL}/login.html">Acessar portal</a></p>
       <p style="font-size:12px;color:#9ca3af">Se você não esperava este convite, ignore este e-mail.</p>`
    )
  ).catch(e => console.warn('[async invite]', e?.message));

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'company_member', entityId: member.id, action: 'invite', after: { name, email, role } })
    .catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, member: { ...member, password_hash: undefined } });
});

module.exports = router;
