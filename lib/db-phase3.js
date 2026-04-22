/**
 * Business Plan Phase 3 — Comments & Collaboration Functions
 * Funções para gerenciar comentários estruturados e permissões de capítulos.
 */

'use strict';
const { sb } = require('./config');

// ─── Comentários Estruturados ──────────────────────────────────────────────────

/**
 * Adiciona um comentário a um capítulo (com suporte a threads).
 */
async function addChapterComment(userId, chapterId, content, authorId, authorName, authorRole, parentCommentId = null, mentions = []) {
  const { data, error } = await sb.from('re_plan_comments').insert({
    user_id: userId,
    chapter_id: chapterId,
    parent_comment_id: parentCommentId,
    author_id: authorId,
    author_name: authorName,
    author_role: authorRole,
    content: content,
    mentions: mentions,
  }).select().single();

  if (error) {
    console.error('[db-phase3] addChapterComment error:', error);
    return null;
  }

  return data;
}

/**
 * Lê todos os comentários de um capítulo (incluindo threads).
 */
async function getChapterComments(userId, chapterId) {
  const { data, error } = await sb.from('re_plan_comments')
    .select('*')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[db-phase3] getChapterComments error:', error);
    return [];
  }

  // Organizar em threads
  const comments = data || [];
  const threaded = [];
  const childrenMap = {};

  comments.forEach(comment => {
    if (!comment.parent_comment_id) {
      threaded.push({ ...comment, replies: [] });
    } else {
      if (!childrenMap[comment.parent_comment_id]) {
        childrenMap[comment.parent_comment_id] = [];
      }
      childrenMap[comment.parent_comment_id].push(comment);
    }
  });

  // Adicionar respostas aos comentários
  threaded.forEach(comment => {
    if (childrenMap[comment.id]) {
      comment.replies = childrenMap[comment.id];
    }
  });

  return threaded;
}

/**
 * Atualiza um comentário.
 */
async function updateChapterComment(commentId, content) {
  const { data, error } = await sb.from('re_plan_comments')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .select()
    .single();

  if (error) {
    console.error('[db-phase3] updateChapterComment error:', error);
    return null;
  }

  return data;
}

/**
 * Soft-delete de um comentário.
 */
async function deleteChapterComment(commentId) {
  const { error } = await sb.from('re_plan_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId);

  if (error) {
    console.error('[db-phase3] deleteChapterComment error:', error);
    return false;
  }

  return true;
}

// ─── Permissões de Capítulos ───────────────────────────────────────────────────

/**
 * Concede permissão a um membro para um capítulo.
 */
async function grantChapterPermission(userId, chapterId, memberId, permissionType, grantedBy, expiresAt = null) {
  const { data, error } = await sb.from('re_plan_chapter_permissions').upsert({
    user_id: userId,
    chapter_id: chapterId,
    member_id: memberId,
    permission_type: permissionType,  // 'view', 'comment', 'edit', 'approve'
    granted_by: grantedBy,
    granted_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: 'user_id,chapter_id,member_id,permission_type' });

  if (error) {
    console.error('[db-phase3] grantChapterPermission error:', error);
    return null;
  }

  return data;
}

/**
 * Verifica se um membro tem permissão para um capítulo.
 */
async function hasChapterPermission(userId, chapterId, memberId, permissionType) {
  const now = new Date().toISOString();
  
  const { data, error } = await sb.from('re_plan_chapter_permissions')
    .select('id')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .eq('member_id', memberId)
    .eq('permission_type', permissionType)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[db-phase3] hasChapterPermission error:', error);
  }

  return !!data;
}

/**
 * Lista todas as permissões de um capítulo.
 */
async function getChapterPermissions(userId, chapterId) {
  const { data, error } = await sb.from('re_plan_chapter_permissions')
    .select('*')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .order('granted_at', { ascending: false });

  if (error) {
    console.error('[db-phase3] getChapterPermissions error:', error);
    return [];
  }

  return data || [];
}

/**
 * Remove permissão de um membro para um capítulo.
 */
async function revokeChapterPermission(userId, chapterId, memberId, permissionType) {
  const { error } = await sb.from('re_plan_chapter_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .eq('member_id', memberId)
    .eq('permission_type', permissionType);

  if (error) {
    console.error('[db-phase3] revokeChapterPermission error:', error);
    return false;
  }

  return true;
}

// ─── Notificações ──────────────────────────────────────────────────────────────

/**
 * Cria uma notificação de atividade.
 */
async function createNotification(recipientId, actorId, chapterId, notificationType, content, relatedCommentId = null) {
  const { data, error } = await sb.from('re_plan_notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    chapter_id: chapterId,
    notification_type: notificationType,  // 'comment', 'approval', 'revision_request', 'mention'
    content: content,
    related_comment_id: relatedCommentId,
  }).select().single();

  if (error) {
    console.error('[db-phase3] createNotification error:', error);
    return null;
  }

  return data;
}

/**
 * Lista notificações não lidas de um usuário.
 */
async function getUnreadNotifications(recipientId) {
  const { data, error } = await sb.from('re_plan_notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .is('read_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[db-phase3] getUnreadNotifications error:', error);
    return [];
  }

  return data || [];
}

/**
 * Marca uma notificação como lida.
 */
async function markNotificationAsRead(notificationId) {
  const { error } = await sb.from('re_plan_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) {
    console.error('[db-phase3] markNotificationAsRead error:', error);
    return false;
  }

  return true;
}

/**
 * Marca todas as notificações de um usuário como lidas.
 */
async function markAllNotificationsAsRead(recipientId) {
  const { error } = await sb.from('re_plan_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', recipientId)
    .is('read_at', null);

  if (error) {
    console.error('[db-phase3] markAllNotificationsAsRead error:', error);
    return false;
  }

  return true;
}

// ─── Visibilidade de Capítulos ─────────────────────────────────────────────────

/**
 * Atualiza a visibilidade de um capítulo.
 */
async function updateChapterVisibility(userId, chapterId, visibility, allowedMembers = []) {
  const { error } = await sb.from('re_plan_chapters')
    .update({
      visibility: visibility,  // 'private', 'team', 'public'
      allowed_members: allowedMembers,
    })
    .eq('user_id', userId)
    .eq('chapter_id', chapterId);

  if (error) {
    console.error('[db-phase3] updateChapterVisibility error:', error);
    return false;
  }

  return true;
}

/**
 * Verifica se um usuário pode visualizar um capítulo.
 */
async function canViewChapter(userId, chapterId, memberId = null) {
  const { data: chapter, error } = await sb.from('re_plan_chapters')
    .select('visibility, allowed_members')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .single();

  if (error || !chapter) {
    return false;
  }

  // Público
  if (chapter.visibility === 'public') {
    return true;
  }

  // Privado - apenas o proprietário
  if (chapter.visibility === 'private') {
    return !memberId;  // Apenas se não for membro
  }

  // Time - verifica se está na lista de membros permitidos
  if (chapter.visibility === 'team' && memberId) {
    return (chapter.allowed_members || []).includes(memberId);
  }

  return false;
}

module.exports = {
  // Comentários
  addChapterComment,
  getChapterComments,
  updateChapterComment,
  deleteChapterComment,
  // Permissões
  grantChapterPermission,
  hasChapterPermission,
  getChapterPermissions,
  revokeChapterPermission,
  // Notificações
  createNotification,
  getUnreadNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  // Visibilidade
  updateChapterVisibility,
  canViewChapter,
};
