'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth } = require('../lib/auth');
const { readTasks } = require('../lib/db');

router.get('/api/tasks', requireAuth, async (req, res) => {
  res.json({ tasks: await readTasks(req.user.id) });
});

router.put('/api/tasks/:id', requireAuth, async (req, res) => {
  if (!req.body.status) return res.status(400).json({ error: 'status é obrigatório.' });
  const { data, error } = await sb.from('re_tasks')
    .update({ status: req.body.status })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id').single();
  if (error || !data) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json({ success: true });
});

module.exports = router;
