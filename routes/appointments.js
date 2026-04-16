'use strict';
const router = require('express').Router();
const { sb, EMAIL_TO } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { readAppointments, insertAppointment } = require('../lib/db');
const { sendMail, emailWrapper } = require('../lib/email');

// Appointments: list
router.get('/api/appointments', requireAuth, async (req, res) => {
  res.json({ appointments: await readAppointments(req.user.id) });
});

// Appointments: create
router.post('/api/appointments', requireAuth, async (req, res) => {
  const { date, time, type, notes } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'Preencha data e tipo.' });

  const appt = await insertAppointment({
    user_id: req.user.id, date, time: time || null,
    type, notes: notes || '', status: 'pendente',
  });

  const typeLabels = {
    diagnostico:'Diagnóstico Inicial', revisao:'Revisão do Business Plan',
    financeiro:'Análise Financeira', estrategia:'Planejamento Estratégico', outro:'Outro'
  };
  sendMail(EMAIL_TO,
    `[Agenda] ${typeLabels[type]||type} — ${req.user.company || req.user.name || req.user.email}`,
    emailWrapper('Novo agendamento solicitado', `
      <p><b>Cliente:</b> ${req.user.name || ''} (${req.user.email})</p>
      <p><b>Empresa:</b> ${req.user.company || '—'}</p>
      <p><b>Tipo:</b> ${typeLabels[type] || type}</p>
      <p><b>Data/Hora:</b> ${new Date(date+'T12:00:00').toLocaleDateString('pt-BR')}${time ? ' às '+time : ''}</p>
      ${notes ? `<p><b>Observações:</b> ${notes}</p>` : ''}
    `)
  ).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, appointment: appt });
});

// Appointments: cancel
router.delete('/api/appointments/:id', requireAuth, async (req, res) => {
  await sb.from('re_appointments')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Admin: all appointments
router.get('/api/admin/appointments', requireAdmin, async (req, res) => {
  const { data: appts } = await sb.from('re_appointments')
    .select('*, re_users(name, email, company)')
    .order('date');

  const appointments = (appts || []).map(a => ({
    ...a,
    clientName:  a.re_users?.name  || '',
    clientEmail: a.re_users?.email || '',
    userId:      a.user_id,
  }));
  res.json({ appointments });
});

// Admin: update appointment status
router.put('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  const updates = {};
  if (status !== undefined) updates.status = status;
  if (notes  !== undefined) updates.notes  = notes;
  await sb.from('re_appointments').update(updates).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
