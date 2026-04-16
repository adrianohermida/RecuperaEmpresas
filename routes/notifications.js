'use strict';

const express = require('express');
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { pushNotification } = require('../lib/logging');

const router = express.Router();

router.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const { data: rows } = await sb.from('re_notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit);
    const items = rows || [];
    const unread = items.filter((notification) => !notification.read).length;
    res.json({ notifications: items, unread_count: unread });
  } catch (e) {
    console.error('[NOTIF GET]', e.message);
    res.json({ notifications: [], unread_count: 0 });
  }
});

router.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('read', false);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/notifications/send', requireAdmin, async (req, res) => {
  try {
    const { user_id, type, title, body, entity_type, entity_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });

    if (user_id) {
      await pushNotification(user_id, type || 'info', title, body, entity_type, entity_id);
    } else {
      const { data: users } = await sb.from('re_users')
        .select('id')
        .eq('is_admin', false)
        .limit(500);
      for (const user of (users || [])) {
        await pushNotification(user.id, type || 'info', title, body, entity_type, entity_id);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
