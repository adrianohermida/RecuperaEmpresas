'use strict';

/**
 * BP-BE-04: Centralized Audit Logging Helpers
 * Provides consistent audit trail management for Business Plan chapters
 */

const { sb } = require('./config');

/**
 * Record a chapter state transition with audit metadata
 * @param {string} userId - Client user ID
 * @param {number} chapterId - Chapter ID
 * @param {string} action - Action type (publish, approve, request_revision, etc)
 * @param {string} performedBy - User ID who performed the action
 * @param {string} performedByRole - Role of the user (consultor, cliente)
 * @param {object} metadata - Additional metadata to store
 */
async function recordChapterAudit(userId, chapterId, action, performedBy, performedByRole, metadata = {}) {
  const now = new Date().toISOString();
  
  const auditEntry = {
    user_id: userId,
    chapter_id: chapterId,
    action,
    performed_by: performedBy,
    performed_by_role: performedByRole,
    metadata: metadata,
    created_at: now,
  };
  
  const { error } = await sb.from('re_plan_audit_log').insert(auditEntry);
  
  if (error) {
    console.error('[audit-helpers] recordChapterAudit error:', error);
    throw new Error('Erro ao registrar auditoria: ' + error.message);
  }
  
  return auditEntry;
}

/**
 * Publish a chapter for client approval
 * Updates published_at and records audit entry
 */
async function publishChapterWithAudit(userId, chapterId, consultorId) {
  const now = new Date().toISOString();
  
  const { error: updateError } = await sb.from('re_plan_chapters')
    .update({
      status: 'aguardando',
      published_at: now,
      last_editor_id: consultorId,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('chapter_id', chapterId);
  
  if (updateError) {
    throw new Error('Erro ao publicar capítulo: ' + updateError.message);
  }
  
  // Record audit entry
  await recordChapterAudit(userId, chapterId, 'publish', consultorId, 'consultor', {
    status_before: 'rascunho',
    status_after: 'aguardando',
  });
}

/**
 * Approve a chapter
 * Updates approved_at, approved_by and records audit entry
 */
async function approveChapterWithAudit(userId, chapterId, clientId) {
  const now = new Date().toISOString();
  
  // Fetch current status for audit
  const { data: chapter, error: fetchError } = await sb.from('re_plan_chapters')
    .select('status')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .single();
  
  if (fetchError || !chapter) {
    throw new Error('Capítulo não encontrado');
  }
  
  const { error: updateError } = await sb.from('re_plan_chapters')
    .update({
      status: 'aprovado',
      client_action: 'aprovado',
      approved_at: now,
      approved_by: clientId,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('chapter_id', chapterId);
  
  if (updateError) {
    throw new Error('Erro ao aprovar capítulo: ' + updateError.message);
  }
  
  // Record audit entry
  await recordChapterAudit(userId, chapterId, 'approve', clientId, 'cliente', {
    status_before: chapter.status,
    status_after: 'aprovado',
  });
}

/**
 * Request chapter revision
 * Updates revision_requested_at, revision_requested_by and records audit entry
 */
async function requestRevisionWithAudit(userId, chapterId, clientId, reason) {
  const now = new Date().toISOString();
  
  // Fetch current status for audit
  const { data: chapter, error: fetchError } = await sb.from('re_plan_chapters')
    .select('status')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .single();
  
  if (fetchError || !chapter) {
    throw new Error('Capítulo não encontrado');
  }
  
  // Insert revision request as a structured comment
  const { error: commentError } = await sb.from('re_plan_comments').insert({
    user_id: userId,
    chapter_id: chapterId,
    author_id: clientId,
    author_name: 'Cliente',
    author_role: 'cliente',
    content: reason,
    created_at: now,
  });
  
  if (commentError) {
    throw new Error('Erro ao registrar solicitação de revisão: ' + commentError.message);
  }
  
  // Update chapter status
  const { error: updateError } = await sb.from('re_plan_chapters')
    .update({
      status: 'em_revisao',
      client_action: 'revisao_solicitada',
      revision_requested_at: now,
      revision_requested_by: clientId,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('chapter_id', chapterId);
  
  if (updateError) {
    throw new Error('Erro ao solicitar revisão: ' + updateError.message);
  }
  
  // Record audit entry
  await recordChapterAudit(userId, chapterId, 'request_revision', clientId, 'cliente', {
    status_before: chapter.status,
    status_after: 'em_revisao',
    reason: reason,
  });
}

/**
 * Get audit history for a chapter
 */
async function getChapterAuditTrail(userId, chapterId) {
  const { data, error } = await sb.from('re_plan_audit_log')
    .select('*')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[audit-helpers] getChapterAuditTrail error:', error);
    return [];
  }
  
  return data || [];
}

module.exports = {
  recordChapterAudit,
  publishChapterWithAudit,
  approveChapterWithAudit,
  requestRevisionWithAudit,
  getChapterAuditTrail,
};
