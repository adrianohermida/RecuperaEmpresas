'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { sb, JWT_SECRET } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { findUserById } = require('../lib/db');
const { selectWithColumnFallback, insertWithColumnFallback, updateWithColumnFallback,
        isSchemaCompatibilityError, isCompanyMembersSchemaError } = require('../lib/schema');

// ─── Multi-user companies ─────────────────────────────────────────────────────
// List members of a client company
router.get('/api/company/members', requireAuth, async (req, res) => {
  const companyId = req.user.company_id || req.user.id;
  const { data, error } = await selectWithColumnFallback('re_company_users', {
    columns: ['id', 'name', 'email', 'role', 'active', 'invited_at', 'last_login'],
    requiredColumns: ['id', 'email'],
    orderBy: ['created_at', 'invited_at', 'id'],
    apply: (query) => query.eq('company_id', companyId),
  });
  if (error) {
    if (isSchemaCompatibilityError(error.message, ['re_company_users', 'company_id', 'invited_at', 'last_login', 'role', 'active'])) {
      console.warn('[COMPANY MEMBERS] recurso multiusuário indisponível neste schema:', error.message);
      return res.json({ members: [] });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ members: (data || []).map((member) => ({
    ...member,
    name: member.name || member.email || 'Membro',
    role: member.role || 'visualizador',
    active: member.active !== false,
  })) });
});

// Invite / create a new member
router.post('/api/company/members', requireAuth, async (req, res) => {
  const companyId = req.user.company_id || req.user.id;
  // Only the owner (re_users row) may invite
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode convidar membros.' });
  const { name, email, role, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password são obrigatórios.' });
  const ROLES = ['financeiro','contador','operacional','visualizador'];
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Papel inválido.' });

  // Check uniqueness
  const { data: existing, error: existingError } = await sb.from('re_company_users')
    .select('id').eq('company_id', companyId).eq('email', email.toLowerCase()).single();
  if (existingError && !String(existingError.message || '').toLowerCase().includes('multiple') && !String(existingError.message || '').toLowerCase().includes('json object requested')) {
    if (isCompanyMembersSchemaError(existingError.message)) {
      console.warn('[COMPANY MEMBERS CREATE] recurso multiusuário indisponível neste schema:', existingError.message);
      return res.status(503).json({ error: 'Recurso de equipe indisponível neste ambiente no momento.' });
    }
    return res.status(500).json({ error: existingError.message });
  }
  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa.' });

  const hash = await bcrypt.hash(password, 10);
  const { data: member, error } = await insertWithColumnFallback('re_company_users', {
    company_id:    companyId,
    name:          name.trim(),
    email:         email.toLowerCase().trim(),
    role:          role || 'operacional',
    password_hash: hash,
  }, { requiredColumns: ['company_id', 'name', 'email', 'role', 'password_hash'] });

  if (error) {
    if (isCompanyMembersSchemaError(error.message)) {
      console.warn('[COMPANY MEMBERS CREATE] recurso multiusuário indisponível neste schema:', error.message);
      return res.status(503).json({ error: 'Recurso de equipe indisponível neste ambiente no momento.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true, member });
});

// Update member (role / active)
router.put('/api/company/members/:memberId', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar membros.' });
  const companyId = req.user.id;
  const { role, active, name } = req.body;
  const updates = {};
  if (role   !== undefined) updates.role   = role;
  if (active !== undefined) updates.active = active;
  if (name   !== undefined) updates.name   = name.trim();
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada para atualizar.' });

  const { data, error } = await sb.from('re_company_users')
    .update(updates)
    .eq('id', req.params.memberId)
    .eq('company_id', companyId)
    .select('id,name,email,role,active').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ success: true, member: data });
});

// Remove a member
router.delete('/api/company/members/:memberId', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode remover membros.' });
  const companyId = req.user.id;
  const { error } = await sb.from('re_company_users')
    .delete()
    .eq('id', req.params.memberId)
    .eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Reset member password
router.post('/api/company/members/:memberId/reset-password', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode redefinir senhas.' });
  const companyId = req.user.id;
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres.' });
  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await sb.from('re_company_users')
    .update({ password_hash: hash })
    .eq('id', req.params.memberId)
    .eq('company_id', companyId)
    .select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ success: true });
});

// ─── Auth: login for company members ─────────────────────────────────────────
// Member login — generates a JWT with company_id set (marks them as a sub-user)
router.post('/api/auth/member-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

  const { data: member, error } = await sb.from('re_company_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('active', true)
    .single();

  if (error || !member) return res.status(401).json({ error: 'Credenciais inválidas.' });
  const ok = await bcrypt.compare(password, member.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

  // Update last_login
  const lastLoginUpdate = await updateWithColumnFallback('re_company_users', { id: member.id }, {
    last_login: new Date().toISOString(),
  });
  if (lastLoginUpdate.error) {
    console.warn('[COMPANY MEMBER LOGIN] Não foi possível atualizar last_login:', lastLoginUpdate.error.message);
  }

  // Fetch owner (company) data for context
  const owner = await findUserById(member.company_id);

  const token = jwt.sign({
    id:         member.id,
    email:      member.email,
    name:       member.name,
    role:       member.role,
    company_id: member.company_id,   // ← marks this as a sub-user
    is_admin:   false,
  }, JWT_SECRET, { expiresIn: '12h' });

  res.json({
    token,
    user: {
      id:         member.id,
      name:       member.name,
      email:      member.email,
      role:       member.role,
      company_id: member.company_id,
      company:    owner?.company || owner?.name || '',
    },
  });
});

// ─── Admin: list members for a client ────────────────────────────────────────
router.get('/api/admin/client/:id/members', requireAdmin, async (req, res) => {
  const { data, error } = await selectWithColumnFallback('re_company_users', {
    columns: ['id', 'name', 'email', 'role', 'active', 'invited_at', 'last_login'],
    requiredColumns: ['id', 'email'],
    orderBy: ['created_at', 'invited_at', 'id'],
    apply: (query) => query.eq('company_id', req.params.id),
  });
  if (error) {
    if (isSchemaCompatibilityError(error.message, ['re_company_users', 'company_id', 'invited_at', 'last_login', 'role', 'active'])) {
      console.warn('[ADMIN COMPANY MEMBERS] recurso multiusuário indisponível neste schema:', error.message);
      return res.json({ members: [] });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ members: (data || []).map((member) => ({
    ...member,
    name: member.name || member.email || 'Membro',
    role: member.role || 'visualizador',
    active: member.active !== false,
  })) });
});

module.exports = router;
