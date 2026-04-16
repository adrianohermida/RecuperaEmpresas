'use strict';

const express = require('express');

const { sb } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

router.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const { entity_type, actor_id, from, to, limit = '50', offset = '0' } = req.query;
    let query = sb.from('re_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10))
      .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);
    if (entity_type) query = query.eq('entity_type', entity_type);
    if (actor_id) query = query.eq('actor_id', actor_id);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { data: rows } = await query;
    res.json({ entries: rows || [] });
  } catch (e) {
    console.error('[AUDIT LOG GET]', e.message);
    res.json({ entries: [] });
  }
});

router.get('/api/admin/audit-log/export', requireAdmin, async (req, res) => {
  try {
    const { entity_type, actor_id, from, to } = req.query;
    let query = sb.from('re_audit_log')
      .select('created_at,actor_id,actor_email,action,entity_type,entity_id,details,before_data,after_data')
      .order('created_at', { ascending: false })
      .limit(10000);
    if (entity_type) query = query.eq('entity_type', entity_type);
    if (actor_id) query = query.eq('actor_id', actor_id);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { data: rows } = await query;

    const header = ['Data/Hora', 'Actor ID', 'E-mail', 'Ação', 'Entidade', 'Entidade ID', 'Detalhes'];
    const csvRows = (rows || []).map((row) => [
      new Date(row.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      row.actor_id || '',
      row.actor_email || '',
      row.action || '',
      row.entity_type || '',
      row.entity_id || '',
      row.after_data ? JSON.stringify(row.after_data) : (row.before_data ? JSON.stringify(row.before_data) : ''),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));

    const csv = [header.join(','), ...csvRows].join('\r\n');
    const filename = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    console.error('[AUDIT LOG EXPORT]', e.message);
    res.status(500).json({ error: 'Erro ao exportar log.' });
  }
});

module.exports = router;