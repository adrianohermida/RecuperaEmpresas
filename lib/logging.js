'use strict';
const { sb } = require('./config');

async function logAccess(userId, email, event, ip, extra = {}) {
  try {
    await sb.from('re_access_log').insert({
      user_id: userId || null,
      email, event,
      ip: ip || 'unknown',
      step: extra.step || null,
      ts: new Date().toISOString()
    });
  } catch {
    // Access log failures must never break auth flows.
  }
}

// ─── Audit log helper (fire-and-forget, never blocks) ────────────────────────
async function auditLog({ actorId, actorEmail, actorRole, entityType, entityId, action, before, after, ip, notes } = {}) {
  try {
    await sb.from('re_audit_log').insert({
      actor_id:    actorId    || null,
      actor_email: actorEmail || null,
      actor_role:  actorRole  || null,
      entity_type: entityType || 'unknown',
      entity_id:   entityId   ? String(entityId) : null,
      action:      action     || 'unknown',
      before_data: before     || null,
      after_data:  after      || null,
      ip:          ip         || null,
      notes:       notes      || null,
    });
  } catch { /* audit failures must never break primary flows */ }
}

// ─── Notification helper (fire-and-forget) ────────────────────────────────────
async function pushNotification(userId, type, title, body, entityType, entityId) {
  try {
    if (!userId) return;
    await sb.from('re_notifications').insert({
      user_id:     userId,
      type:        type        || 'info',
      title:       title       || '',
      body:        body        || null,
      entity_type: entityType  || null,
      entity_id:   entityId ? String(entityId) : null,
    });
  } catch { /* notification failures must never block primary responses */ }
}

module.exports = {
  logAccess,
  auditLog,
  pushNotification,
};
