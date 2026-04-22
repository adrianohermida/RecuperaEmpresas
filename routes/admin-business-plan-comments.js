'use strict';
const router = require('express').Router();
const { requireAuth } = require('../lib/auth');
const {
  addChapterComment,
  getChapterComments,
  updateChapterComment,
  deleteChapterComment,
  grantChapterPermission,
  hasChapterPermission,
  getChapterPermissions,
  revokeChapterPermission,
  createNotification,
  getUnreadNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  updateChapterVisibility,
  canViewChapter,
} = require('../lib/db-phase3');
const { ADMIN_EMAILS } = require('../lib/config');

// Middleware: Verifica se o usuário é consultor (admin)
function requireConsultor(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado. Apenas consultores.' });
  }
  next();
}

// ─── GET /api/admin/plan/:userId/chapter/:chapterId/comments ────────────────
// Lê todos os comentários de um capítulo (com threads).
router.get('/api/admin/plan/:userId/chapter/:chapterId/comments', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;

    // Validar acesso
    if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const comments = await getChapterComments(userId, parseInt(chapterId));
    res.json({ comments });
  } catch (err) {
    console.error('[admin-business-plan-comments] GET comments', err);
    res.status(500).json({ error: 'Erro ao recuperar comentários.' });
  }
});

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/comments ───────────────
// Adiciona um novo comentário (ou resposta em thread).
router.post('/api/admin/plan/:userId/chapter/:chapterId/comments', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const { content, parentCommentId, mentions } = req.body;

    // Validar acesso
    if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Conteúdo inválido.' });
    }

    const authorRole = ADMIN_EMAILS.includes(req.user.email?.toLowerCase()) ? 'consultor' : 'cliente';
    
    const comment = await addChapterComment(
      userId,
      parseInt(chapterId),
      content,
      req.user.id,
      req.user.name || req.user.email,
      authorRole,
      parentCommentId || null,
      mentions || []
    );

    if (!comment) {
      return res.status(500).json({ error: 'Erro ao criar comentário.' });
    }

    // Criar notificações para menções
    if (mentions && mentions.length > 0) {
      for (const mentionedUserId of mentions) {
        await createNotification(
          mentionedUserId,
          req.user.id,
          parseInt(chapterId),
          'mention',
          `${req.user.name || req.user.email} mencionou você em um comentário`,
          comment.id
        );
      }
    }

    res.json({ success: true, comment });
  } catch (err) {
    console.error('[admin-business-plan-comments] POST comments', err);
    res.status(500).json({ error: 'Erro ao criar comentário.' });
  }
});

// ─── PUT /api/admin/plan/:userId/chapter/:chapterId/comments/:commentId ──────
// Atualiza um comentário.
router.put('/api/admin/plan/:userId/chapter/:chapterId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId, commentId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Conteúdo inválido.' });
    }

    const updatedComment = await updateChapterComment(commentId, content);
    if (!updatedComment) {
      return res.status(404).json({ error: 'Comentário não encontrado.' });
    }

    res.json({ success: true, comment: updatedComment });
  } catch (err) {
    console.error('[admin-business-plan-comments] PUT comments', err);
    res.status(500).json({ error: 'Erro ao atualizar comentário.' });
  }
});

// ─── DELETE /api/admin/plan/:userId/chapter/:chapterId/comments/:commentId ───
// Deleta um comentário (soft delete).
router.delete('/api/admin/plan/:userId/chapter/:chapterId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId, commentId } = req.params;

    const deleted = await deleteChapterComment(commentId);
    if (!deleted) {
      return res.status(404).json({ error: 'Comentário não encontrado.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-business-plan-comments] DELETE comments', err);
    res.status(500).json({ error: 'Erro ao deletar comentário.' });
  }
});

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/permissions ────────────
// Concede permissão a um membro.
router.post('/api/admin/plan/:userId/chapter/:chapterId/permissions', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const { memberId, permissionType, expiresAt } = req.body;

    if (!memberId || !permissionType) {
      return res.status(400).json({ error: 'memberId e permissionType são obrigatórios.' });
    }

    const permission = await grantChapterPermission(
      userId,
      parseInt(chapterId),
      memberId,
      permissionType,
      req.user.id,
      expiresAt || null
    );

    if (!permission) {
      return res.status(500).json({ error: 'Erro ao conceder permissão.' });
    }

    res.json({ success: true, permission });
  } catch (err) {
    console.error('[admin-business-plan-comments] POST permissions', err);
    res.status(500).json({ error: 'Erro ao conceder permissão.' });
  }
});

// ─── GET /api/admin/plan/:userId/chapter/:chapterId/permissions ─────────────
// Lista permissões de um capítulo.
router.get('/api/admin/plan/:userId/chapter/:chapterId/permissions', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;

    const permissions = await getChapterPermissions(userId, parseInt(chapterId));
    res.json({ permissions });
  } catch (err) {
    console.error('[admin-business-plan-comments] GET permissions', err);
    res.status(500).json({ error: 'Erro ao recuperar permissões.' });
  }
});

// ─── DELETE /api/admin/plan/:userId/chapter/:chapterId/permissions/:permissionId ──
// Remove uma permissão.
router.delete('/api/admin/plan/:userId/chapter/:chapterId/permissions/:permissionId', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId, permissionId } = req.params;
    const { memberId, permissionType } = req.body;

    if (!memberId || !permissionType) {
      return res.status(400).json({ error: 'memberId e permissionType são obrigatórios.' });
    }

    const revoked = await revokeChapterPermission(userId, parseInt(chapterId), memberId, permissionType);
    if (!revoked) {
      return res.status(404).json({ error: 'Permissão não encontrada.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-business-plan-comments] DELETE permissions', err);
    res.status(500).json({ error: 'Erro ao remover permissão.' });
  }
});

// ─── PUT /api/admin/plan/:userId/chapter/:chapterId/visibility ──────────────
// Atualiza a visibilidade de um capítulo.
router.put('/api/admin/plan/:userId/chapter/:chapterId/visibility', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const { visibility, allowedMembers } = req.body;

    if (!visibility || !['private', 'team', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'Visibilidade inválida.' });
    }

    const updated = await updateChapterVisibility(userId, parseInt(chapterId), visibility, allowedMembers || []);
    if (!updated) {
      return res.status(500).json({ error: 'Erro ao atualizar visibilidade.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-business-plan-comments] PUT visibility', err);
    res.status(500).json({ error: 'Erro ao atualizar visibilidade.' });
  }
});

// ─── GET /api/notifications ────────────────────────────────────────────────
// Lista notificações não lidas do usuário.
router.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await getUnreadNotifications(req.user.id);
    res.json({ notifications });
  } catch (err) {
    console.error('[admin-business-plan-comments] GET notifications', err);
    res.status(500).json({ error: 'Erro ao recuperar notificações.' });
  }
});

// ─── PUT /api/notifications/:notificationId/read ────────────────────────────
// Marca uma notificação como lida.
router.put('/api/notifications/:notificationId/read', requireAuth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const marked = await markNotificationAsRead(notificationId);
    if (!marked) {
      return res.status(404).json({ error: 'Notificação não encontrada.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-business-plan-comments] PUT notifications/read', err);
    res.status(500).json({ error: 'Erro ao marcar notificação como lida.' });
  }
});

// ─── PUT /api/notifications/read-all ───────────────────────────────────────
// Marca todas as notificações como lidas.
router.put('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const marked = await markAllNotificationsAsRead(req.user.id);
    if (!marked) {
      return res.status(500).json({ error: 'Erro ao marcar notificações.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-business-plan-comments] PUT notifications/read-all', err);
    res.status(500).json({ error: 'Erro ao marcar notificações como lidas.' });
  }
});

module.exports = router;
