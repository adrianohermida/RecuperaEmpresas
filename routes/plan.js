'use strict';
const router = require('express').Router();
const { requireAuth } = require('../lib/auth');
const { readPlan, saveChapterStatus } = require('../lib/db');

router.get('/api/plan', requireAuth, async (req, res) => {
  res.json(await readPlan(req.user.id));
});

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

module.exports = router;
