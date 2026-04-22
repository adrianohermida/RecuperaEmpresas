'use strict';
const router = require('express').Router();
const { requireAuth } = require('../lib/auth');
const { 
  readPlan, 
  saveChapterStatus,
  approveChapter,
  requestChapterRevision,
  getChapterAuditHistory,
} = require('../lib/db');

// ─── GET /api/plan ────────────────────────────────────────────────────────────
// Lê o plano do cliente (visualização no dashboard).
router.get('/api/plan', requireAuth, async (req, res) => {
  res.json(await readPlan(req.user.id));
});

// ─── PUT /api/plan/chapter/:id ────────────────────────────────────────────────
// Atualiza status e adiciona comentários (cliente).
router.put('/api/plan/chapter/:id', requireAuth, async (req, res) => {
  const { clientAction, comment } = req.body;
  const chapterId = parseInt(req.params.id);
  const plan = await readPlan(req.user.id);
  const chapter = plan.chapters.find(c => c.id === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Capítulo não encontrado.' });

  const updates = {};
  if (clientAction) updates.client_action = clientAction;
  if (comment) {
    const comments = [...(chapter.comments || []), {
      text: comment, from: 'client', fromName: req.user.name || req.user.email,
      ts: new Date().toISOString()
    }];
    updates.comments = comments;
  }
  await saveChapterStatus(req.user.id, chapterId, updates);
  res.json({ success: true });
});

// ─── POST /api/plan/chapter/:id/approve ───────────────────────────────────────
// Cliente aprova um capítulo.
router.post('/api/plan/chapter/:id/approve', requireAuth, async (req, res) => {
  try {
    const chapterId = parseInt(req.params.id);
    await approveChapter(req.user.id, chapterId, req.user.id);
    res.json({ success: true, message: 'Capítulo aprovado com sucesso.' });
  } catch (err) {
    console.error('[plan] POST /approve', err);
    res.status(500).json({ error: 'Erro ao aprovar capítulo.' });
  }
});

// ─── POST /api/plan/chapter/:id/request-revision ───────────────────────────────
// Cliente solicita revisão de um capítulo.
router.post('/api/plan/chapter/:id/request-revision', requireAuth, async (req, res) => {
  try {
    const chapterId = parseInt(req.params.id);
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: 'Motivo da revisão é obrigatório.' });
    }

    await requestChapterRevision(req.user.id, chapterId, req.user.id, reason);
    res.json({ success: true, message: 'Solicitação de revisão enviada.' });
  } catch (err) {
    console.error('[plan] POST /request-revision', err);
    res.status(500).json({ error: 'Erro ao solicitar revisão.' });
  }
});

// ─── GET /api/plan/chapter/:id/audit-history ──────────────────────────────────
// Retorna o histórico de auditoria de um capítulo.
router.get('/api/plan/chapter/:id/audit-history', requireAuth, async (req, res) => {
  try {
    const chapterId = parseInt(req.params.id);
    const history = await getChapterAuditHistory(req.user.id, chapterId);
    
    if (!history) {
      return res.status(404).json({ error: 'Capítulo não encontrado.' });
    }

    res.json(history);
  } catch (err) {
    console.error('[plan] GET /audit-history', err);
    res.status(500).json({ error: 'Erro ao recuperar histórico.' });
  }
});

module.exports = router;
