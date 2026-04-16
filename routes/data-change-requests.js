'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { sendMail, emailWrapper } = require('../lib/email');
const { BASE_URL } = require('../lib/config');
const { auditLog, pushNotification } = require('../lib/logging');

function companyId(user) { return user.company_id || user.id; }

// ─── Admin: request change to client data (LGPD) ─────────────────────────────
router.post('/api/admin/client/:id/change-request', requireAdmin, async (req, res) => {
  const { entity_type, entity_id, field_changes, reason } = req.body;
  if (!entity_type || !entity_id || !field_changes || !Object.keys(field_changes).length) {
    return res.status(400).json({ error: 'entity_type, entity_id e field_changes são obrigatórios.' });
  }
  const { data: req_row, error } = await sb.from('re_data_change_requests').insert({
    company_id: req.params.id,
    requested_by: req.user.id,
    requester_role: 'admin',
    entity_type, entity_id,
    field_changes,
    reason: reason || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify the client user to confirm
  const { data: owner } = await sb.from('re_users').select('email,name').eq('id', req.params.id).single();
  const confirmUrl = `${BASE_URL}/dashboard.html?change_request=${req_row.token}`;
  const fields = Object.entries(field_changes)
    .map(([k, v]) => `<li><b>${k}:</b> ${v?.from ?? '—'} → ${v?.to ?? '—'}</li>`).join('');

  sendMail(owner?.email, 'Confirmação de alteração de dados — Recupera Empresas',
    emailWrapper('Solicitação de alteração de dados',
      `<p>Olá, <b>${owner?.name || 'Cliente'}</b>!</p>
       <p>O consultor solicitou a alteração dos seguintes dados da sua empresa:</p>
       <ul>${fields}</ul>
       ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
       <p>Esta solicitação expira em <b>48 horas</b>.</p>
       <p>Para confirmar ou recusar, acesse o portal:</p>
       <p><a href="${confirmUrl}">Revisar solicitação</a></p>`
    )
  ).catch(e => console.warn('[async]', e?.message));

  pushNotification(req.params.id, 'info', 'Alteração de dados pendente',
    'O consultor solicitou alterações nos seus dados. Confirme no portal.', 'change_request', req_row.id)
    .catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, request: req_row });
});

// Client: list pending change requests
router.get('/api/change-requests', requireAuth, async (req, res) => {
  const cid = companyId(req.user);
  const { data } = await sb.from('re_data_change_requests')
    .select('*').eq('company_id', cid).eq('status', 'pending')
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  res.json({ requests: data || [] });
});

// Client: approve/reject a change request
router.put('/api/change-requests/:token', requireAuth, async (req, res) => {
  const { action, rejection_reason } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action deve ser "approve" ou "reject".' });

  const cid = companyId(req.user);
  const { data: cr } = await sb.from('re_data_change_requests')
    .select('*').eq('token', req.params.token).eq('company_id', cid).single();
  if (!cr) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (cr.status !== 'pending') return res.status(409).json({ error: 'Solicitação já processada.' });
  if (new Date(cr.expires_at) < new Date()) return res.status(410).json({ error: 'Solicitação expirada.' });

  if (action === 'approve') {
    // Apply the changes to the target entity
    const updates = {};
    Object.entries(cr.field_changes).forEach(([k, v]) => { updates[k] = v?.to; });
    const { error: applyError } = await sb.from(cr.entity_type)
      .update(updates).eq('id', cr.entity_id);
    if (applyError) return res.status(500).json({ error: 'Erro ao aplicar alterações: ' + applyError.message });

    await sb.from('re_data_change_requests').update({
      status: 'approved', confirmed_by: req.user.id, confirmed_at: new Date().toISOString(),
    }).eq('id', cr.id);

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'client',
      entityType: cr.entity_type, entityId: cr.entity_id, action: 'change_approved',
      after: updates }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, message: 'Alterações aplicadas com sucesso.' });
  } else {
    await sb.from('re_data_change_requests').update({
      status: 'rejected', confirmed_by: req.user.id, confirmed_at: new Date().toISOString(),
      rejection_reason: rejection_reason?.trim() || null,
    }).eq('id', cr.id);
    res.json({ success: true, message: 'Solicitação recusada.' });
  }
});

// Admin: list change requests for a client
router.get('/api/admin/client/:id/change-requests', requireAdmin, async (req, res) => {
  const { data } = await sb.from('re_data_change_requests')
    .select('*').eq('company_id', req.params.id)
    .order('created_at', { ascending: false }).limit(50);
  res.json({ requests: data || [] });
});

// Admin: get request by token (for client confirmation page)
router.get('/api/change-requests/:token', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_data_change_requests')
    .select('*').eq('token', req.params.token).single();
  if (!data) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  res.json({ request: data });
});

module.exports = router;
