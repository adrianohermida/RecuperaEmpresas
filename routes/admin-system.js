'use strict';

const express = require('express');

const { sb } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

router.get('/api/admin/logs', requireAdmin, async (req, res) => {
  const { data: logs } = await sb.from('re_access_log')
    .select('*')
    .order('ts', { ascending: false })
    .limit(500);
  res.json({ logs: (logs || []).map((log) => ({
    ts: log.ts,
    email: log.email,
    event: log.event,
    ip: log.ip,
    step: log.step,
  })) });
});

router.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const { data: users } = await sb.from('re_users').select('id').eq('is_admin', false);
  const ids = (users || []).map((user) => user.id);
  const { data: onboarding } = await sb.from('re_onboarding')
    .select('status')
    .in('user_id', ids);

  const stats = { total: ids.length, naoIniciado: 0, emAndamento: 0, concluido: 0 };
  (onboarding || []).forEach((entry) => {
    if (entry.status === 'concluido') stats.concluido += 1;
    else if (entry.status === 'em_andamento') stats.emAndamento += 1;
    else stats.naoIniciado += 1;
  });
  stats.naoIniciado += ids.length - (onboarding || []).length;
  res.json(stats);
});

module.exports = router;