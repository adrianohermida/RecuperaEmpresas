'use strict';
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ADMIN_EMAILS, sb } = require('./config');
const { findUserById } = require('./db');

// ─── JWT ──────────────────────────────────────────────────────────────────────
function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token inválido ou expirado.' });

  // Support impersonation token (admin viewing as client)
  if (decoded.impersonating) {
    const target = await findUserById(decoded.targetId);
    if (!target) return res.status(401).json({ error: 'Usuário não encontrado.' });
    req.user = target;
    req.isImpersonating = true;
    req.realAdminId = decoded.adminId;
    return next();
  }

  // Member token: has company_id field — look up in re_company_users
  if (decoded.company_id) {
    const { data: member } = await sb.from('re_company_users')
      .select('id,name,email,role,active,company_id,permissions')
      .eq('id', decoded.id)
      .eq('active', true)
      .single();
    if (!member) return res.status(401).json({ error: 'Membro inativo ou não encontrado.' });
    // Expose company owner id as user.id so all routes read the correct data
    req.user = {
      id:          member.company_id,   // data owner = the company owner
      member_id:   member.id,
      name:        member.name,
      email:       member.email,
      role:        member.role,
      company_id:  member.company_id,
      permissions: member.permissions || {},
      is_admin:    false,
      is_member:   true,
    };
    return next();
  }

  const user = await findUserById(decoded.userId || decoded.id);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token inválido.' });
  const user = await findUserById(decoded.userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  if (!user.is_admin && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  req.user = user;
  next();
}

// ─── Helper: find or create re_users profile from a Supabase Auth user ────────
async function upsertProfileFromAuth(authUser, extra = {}) {
  const email   = authUser.email;
  const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

  // Try to find by Supabase Auth UUID first (id column), then by email
  let { data: profile } = await sb.from('re_users').select('*').eq('id', authUser.id).single();
  if (!profile) {
    ({ data: profile } = await sb.from('re_users').select('*').ilike('email', email).limit(1).single());
  }

  if (profile) {
    // Sync id + admin flag if needed
    const updates = {};
    if (profile.id !== authUser.id) updates.id = authUser.id;
    if (!profile.is_admin && isAdmin) updates.is_admin = true;
    if (Object.keys(updates).length) {
      if (updates.id) {
        // id changed — insert new row then delete old
        try { await sb.from('re_users').insert({ ...profile, ...updates }); } catch {}
        try { await sb.from('re_users').delete().eq('id', profile.id); } catch {}
      } else {
        await sb.from('re_users').update(updates).eq('id', profile.id);
      }
      profile = { ...profile, ...updates };
    }
    return profile;
  }

  // Create new profile
  const name    = extra.name || authUser.user_metadata?.name || email.split('@')[0];
  const company = extra.company || authUser.user_metadata?.company || '';
  const { data: newProfile, error } = await sb.from('re_users').insert({
    id:       authUser.id,
    email,
    name,
    company,
    is_admin: isAdmin,
  }).select().single();
  if (error) throw error;
  return newProfile;
}

// Helper: safe public user object
function safeUser(u) {
  return {
    id:              u.id,
    name:            u.name || u.full_name || '',
    email:           u.email,
    company:         u.company || '',
    isAdmin:         u.is_admin || ADMIN_EMAILS.includes((u.email||'').toLowerCase()),
    credits_balance: u.credits_balance ?? 0,
    freshdeskTicketId:  u.freshdesk_ticket_id  || null,
    freshdeskContactId: u.freshdesk_contact_id || null,
    createdAt: u.created_at,
  };
}

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  upsertProfileFromAuth,
  safeUser,
};
