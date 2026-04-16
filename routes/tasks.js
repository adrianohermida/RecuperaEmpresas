'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth } = require('../lib/auth');
const { readTasks } = require('../lib/db');

router.get('/api/tasks', requireAuth, async (req, res) => {
  res.json({ tasks: await readTasks(req.user.id) });
});

router.put('/api/tasks/:id', requireAuth, async (req, res) => {
  if (req.body.status) {
    await sb.from('re_tasks').update({ status: req.body.status }).eq('id', req.params.id).eq('user_id', req.user.id);
  }
  res.json({ success: true });
});

module.exports = router;
