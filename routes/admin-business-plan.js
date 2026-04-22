'use strict';
const router = require('express').Router();
const { requireAuth } = require('../lib/auth');
const DOMPurify = require('isomorphic-dompurify');
const {
  readPlanForConsultor,
  saveChapterContent,
  addChapterComment,
  updateChapterClientAction,
  getChapterAttachment,
  publishChapterForApproval,
} = require('../lib/db');
const { ADMIN_EMAILS } = require('../lib/config');
const {
  publishChapterWithAudit,
  approveChapterWithAudit,
  requestRevisionWithAudit,
  getChapterAuditTrail,
} = require('../lib/audit-helpers');

// BP-BE-03: Sanitize HTML content to prevent XSS attacks
function sanitizeContent(content) {
  if (typeof content !== 'string') return '';
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'img'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target'],
    KEEP_CONTENT: true,
  });
}

// Middleware: Verifica se o usuário é consultor (admin)
function requireConsultor(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado. Apenas consultores.' });
  }
  next();
}

// ─── GET /api/admin/plan/:userId ──────────────────────────────────────────────
// Lê o plano completo de um cliente (para o consultor editar).
router.get('/api/admin/plan/:userId', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId } = req.params;
    const plan = await readPlanForConsultor(userId);
    res.json(plan);
  } catch (err) {
    console.error('[admin-business-plan] GET /api/admin/plan/:userId', err);
    res.status(500).json({ error: 'Erro ao ler plano.' });
  }
});

// ─── PUT /api/admin/plan/:userId/chapter/:chapterId ──────────────────────────
// Salva o conteúdo de um capítulo (redação pelo consultor).
router.put('/api/admin/plan/:userId/chapter/:chapterId', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const { content, attachments } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Conteúdo inválido.' });
    }

    // BP-BE-03: Sanitize HTML content before saving
    content = sanitizeContent(content);

    await saveChapterContent(userId, parseInt(chapterId), content, req.user.id, attachments || []);
    res.json({ success: true, message: 'Capítulo salvo com sucesso.' });
  } catch (err) {
    console.error('[admin-business-plan] PUT /api/admin/plan/:userId/chapter/:chapterId', err);
    res.status(500).json({ error: 'Erro ao salvar capítulo.' });
  }
});

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/publish ──────────────────
// Publica um capítulo para aprovação do cliente (consultor).
router.post('/api/admin/plan/:userId/chapter/:chapterId/publish', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;

    // BP-BE-04: Use centralized audit helper
    await publishChapterWithAudit(userId, parseInt(chapterId), req.user.id);
    res.json({ success: true, message: 'Capítulo publicado para aprovação do cliente.' });
  } catch (err) {
    console.error('[admin-business-plan] POST /publish', err);
    res.status(500).json({ error: 'Erro ao publicar capítulo.' });
  }
});

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/comment ─────────────────
// Adiciona um comentário ao capítulo (thread de discussão).
router.post('/api/admin/plan/:userId/chapter/:chapterId/comment', requireAuth, requireConsultor, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const commentText = req.body.text || req.body.comment;

    if (!commentText || typeof commentText !== 'string') {
      return res.status(400).json({ error: 'Comentário inválido.' });
    }

    await addChapterComment(userId, parseInt(chapterId), commentText, req.user.id, req.user.name || req.user.email);
    res.json({ success: true, message: 'Comentário adicionado.' });
  } catch (err) {
    console.error('[admin-business-plan] POST comment', err);
    res.status(500).json({ error: 'Erro ao adicionar comentário.' });
  }
});

// ─── PUT /api/admin/plan/:userId/chapter/:chapterId/status ──────────────────
// Atualiza o status de aprovação (cliente).
router.put('/api/admin/plan/:userId/chapter/:chapterId/status', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId } = req.params;
    const { clientAction } = req.body;

    // Valida se o usuário é o cliente (userId) ou um consultor
    if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const validActions = ['aprovado', 'revisao_solicitada'];
    if (!validActions.includes(clientAction)) {
      return res.status(400).json({ error: 'Status inválido. Apenas "aprovado" ou "revisao_solicitada".' });
    }

    // BP-BE-04: Use centralized audit helpers for state transitions
    try {
      if (clientAction === 'aprovado') {
        await approveChapterWithAudit(userId, parseInt(chapterId), req.user.id);
      } else if (clientAction === 'revisao_solicitada') {
        const { reason } = req.body;
        if (!reason || typeof reason !== 'string') {
          return res.status(400).json({ error: 'Motivo da revisão é obrigatório.' });
        }
        await requestRevisionWithAudit(userId, parseInt(chapterId), req.user.id, reason);
      }
      res.json({ success: true, message: 'Status atualizado com sucesso.' });
    } catch (auditErr) {
      console.error('[admin-business-plan] Audit error:', auditErr);
      res.status(500).json({ error: auditErr.message || 'Erro ao atualizar status.' });
      return;
    }
  } catch (err) {
    console.error('[admin-business-plan] PUT status', err);
    res.status(500).json({ error: 'Erro ao atualizar status.' });
  }
});

// ─── GET /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId ──
// Retorna metadados de um arquivo anexado.
router.get('/api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId', requireAuth, async (req, res) => {
  try {
    const { userId, chapterId, attachmentId } = req.params;

    // Valida acesso
    if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const attachment = await getChapterAttachment(userId, parseInt(chapterId), attachmentId);
    if (!attachment) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    res.json(attachment);
  } catch (err) {
    console.error('[admin-business-plan] GET attachment', err);
    res.status(500).json({ error: 'Erro ao recuperar arquivo.' });
  }
});

module.exports = router;
