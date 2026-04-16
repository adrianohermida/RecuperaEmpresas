'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');
const { emailWrapper, emailFactTable, emailFactRow, emailStyle, sendMail } = require('../lib/email');
const { gcCreateEvent, gcPatchEvent, gcDeleteEvent } = require('../lib/calendar');
const { selectWithColumnFallback, insertWithColumnFallback, isSchemaCompatibilityError, buildRouteDiagnostic } = require('../lib/schema');
const { auditLog } = require('../lib/logging');
const agendaRouter = require('./agenda');
const { _calendarEventIds, adjustCredits } = agendaRouter;

// ── Admin: agenda slots management ───────────────────────────────────────────
router.get('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const includeBookings = !['0', 'false', 'no'].includes(String(req.query.include_bookings || '1').toLowerCase());
    const { data: slots, error: slotsError } = await selectWithColumnFallback('re_agenda_slots', {
      columns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_at'],
      requiredColumns: ['id', 'starts_at', 'ends_at'],
      orderBy: ['starts_at', 'created_at', 'id'],
      apply: (query) => query.gte('starts_at', from).limit(100),
    });
    if (slotsError) {
      if (isSchemaCompatibilityError(slotsError.message, ['re_agenda_slots', 'starts_at', 'ends_at', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description'])) {
        console.warn('[ADMIN AGENDA SLOTS] returning empty list due to schema mismatch:', slotsError.message);
        return res.json({ slots: [] });
      }
      return res.status(500).json({ error: slotsError.message });
    }

    if (!includeBookings) {
      return res.json({ slots: slots || [] });
    }

    const slotIds = (slots || []).map(s => s.id);
    let bookings = [];
    if (slotIds.length) {
      const { data, error } = await selectWithColumnFallback('re_bookings', {
        columns: ['id', 'slot_id', 'user_id', 'status', 'credits_spent', 'confirmed_at', 'cancel_reason', 'cancelled_by', 'reschedule_reason', 'rescheduled_to_slot_id', 'external_contact', 'notes', 'created_at', 're_users(id,name,email,company)'],
        requiredColumns: ['id', 'slot_id', 'status'],
        orderBy: ['created_at', 'id'],
        apply: (query) => query.in('slot_id', slotIds),
      });
      if (error) {
        console.warn('[ADMIN AGENDA BOOKINGS] returning slots without bookings:', error.message);
      } else {
        bookings = data || [];
      }
    }
    const bySlot = {};
    bookings.forEach(b => { (bySlot[b.slot_id] = bySlot[b.slot_id] || []).push(b); });

    res.json({ slots: (slots || []).map(s => ({ ...s, bookings: bySlot[s.id] || [] })) });
  } catch (e) {
    console.error('[ADMIN AGENDA SLOTS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const { starts_at, ends_at, title, credits_cost, max_bookings, duration_min, location, meeting_link, description } = req.body;
    if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at e ends_at são obrigatórios.' });
    const slotAttempts = [
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1, duration_min: duration_min || 60,
          location: location || 'online', meeting_link: meeting_link || null, description: description || null,
          created_by: req.user.id,
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1, duration_min: duration_min || 60,
          location: location || 'online',
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1,
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: { starts_at, ends_at, title: title || 'Consultoria' },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: { starts_at, ends_at },
        requiredColumns: ['starts_at', 'ends_at'],
      },
    ];
    let slotInsert = null;
    for (const attempt of slotAttempts) {
      slotInsert = await insertWithColumnFallback('re_agenda_slots', attempt.payload, {
        requiredColumns: attempt.requiredColumns,
        returningColumns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_at'],
        requiredReturningColumns: ['id', 'starts_at', 'ends_at'],
      });
      if (!slotInsert.error) break;
    }
    const { data, error } = slotInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_agenda_slots', 'starts_at', 'ends_at', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_by'])) {
        return res.status(503).json({
          error: 'Agenda temporariamente indisponível até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/agenda/slots', error, slotAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    gcCreateEvent({
      summary: `[Disponível] ${title || 'Consultoria'} — Recupera Empresas`,
      description: `Slot disponível para reserva.\nVagas: ${max_bookings || 1}  |  Créditos: ${credits_cost || 1}${meeting_link ? '\nLink: ' + meeting_link : ''}`,
      start: starts_at, end: ends_at,
    }).then(evId => { if (evId) _calendarEventIds.set(data.id, evId); }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, slot: data });
  } catch (e) {
    console.error('[ADMIN AGENDA CREATE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/agenda/slots/:slotId', requireAdmin, async (req, res) => {
  const { slotId } = req.params;
  await sb.from('re_agenda_slots').delete().eq('id', slotId);
  const evId = _calendarEventIds.get(slotId);
  if (evId) { gcDeleteEvent(evId).catch(e => console.warn('[async]', e?.message)); _calendarEventIds.delete(slotId); }
  res.json({ success: true });
});

// ── Admin: confirm a booking ──────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/confirm', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,ends_at,title,location,meeting_link),re_users(name,email,company)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Já confirmada.' });
    if (booking.status === 'cancelled')  return res.status(400).json({ error: 'Reserva cancelada.' });

    await sb.from('re_bookings').update({
      status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const slot  = booking.re_agenda_slots;
    const user  = booking.re_users || {};
    const email = user.email || booking.external_contact?.email;
    const name  = user.name  || booking.external_contact?.name || email;
    const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      const linkLine = slot?.meeting_link ? emailFactRow('Link da reunião', `<a href="${slot.meeting_link}">${slot.meeting_link}</a>`) : '';
      sendMail(email, '✅ Agendamento confirmado — Recupera Empresas', emailWrapper(
        'Agendamento confirmado!',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi <b>confirmado</b> pelo consultor.</p>
         ${emailFactTable([
           emailFactRow('Sessão', slot?.title||'Consultoria'),
           emailFactRow('Data e hora', startsAtFmt),
           emailFactRow('Modalidade', slot?.location==='presencial'?'Presencial':'Online'),
           linkLine,
         ].filter(Boolean).join(''))}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes da sessão.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Add to Google Calendar
    const evId = _calendarEventIds.get(slot?.id);
    if (evId && email) {
      gcPatchEvent(evId, {
        summary: `${slot?.title||'Consultoria'} — ${user.company||name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: cancel a booking (with reason) ────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/cancel', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,title),re_users(name,email)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Já cancelada.' });

    await sb.from('re_bookings').update({
      status: 'cancelled', cancelled_by: 'admin',
      cancel_reason: reason || null, updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    // Refund credits if user exists
    if (booking.user_id && booking.credits_spent) {
      await adjustCredits(booking.user_id, booking.credits_spent, 'refund_admin_cancel', booking.id)
        .catch(e => console.warn('[async credits refund]', e?.message));
    }

    const slot  = booking.re_agenda_slots;
    const user  = booking.re_users || {};
    const email = user.email || booking.external_contact?.email;
    const name  = user.name  || booking.external_contact?.name || email;
    const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      sendMail(email, '❌ Agendamento cancelado — Recupera Empresas', emailWrapper(
        'Agendamento cancelado',
        `<p>Olá, <b>${name}</b>!</p>
         <p>Seu agendamento foi <b>cancelado</b> pelo consultor.</p>
         <p><b>Sessão:</b> ${slot?.title||'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
         ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
         ${booking.credits_spent ? `<p ${emailStyle('factValue', 'color:#10B981')}>Seus créditos foram devolvidos.</p>` : ''}
         <p ${emailStyle('metaText', 'margin-top:0')}>Entre em contato para reagendar.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Restore Google Calendar slot
    const evId = _calendarEventIds.get(slot?.id);
    if (evId) {
      gcPatchEvent(evId, {
        summary: `[Disponível] ${slot?.title||'Consultoria'} — Recupera Empresas`, attendees: [],
      }).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: reschedule a booking to a new slot ─────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
  try {
    const { new_slot_id, reason } = req.body;
    if (!new_slot_id) return res.status(400).json({ error: 'new_slot_id é obrigatório.' });

    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,title),re_users(name,email,company)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (['cancelled','rescheduled'].includes(booking.status)) return res.status(400).json({ error: 'Reserva não pode ser remarcada.' });

    // Validate new slot capacity
    const { data: newSlot } = await sb.from('re_agenda_slots').select('*').eq('id', new_slot_id).single();
    if (!newSlot) return res.status(404).json({ error: 'Novo horário não encontrado.' });
    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', new_slot_id).in('status', ['pending','confirmed']);
    if ((count||0) >= newSlot.max_bookings) return res.status(400).json({ error: 'Novo horário lotado.' });

    // Create new confirmed booking
    const { data: newBooking } = await sb.from('re_bookings').insert({
      slot_id: new_slot_id, user_id: booking.user_id,
      external_contact: booking.external_contact || null,
      status: 'confirmed', confirmed_at: new Date().toISOString(),
      credits_spent: booking.credits_spent, notes: booking.notes || null,
    }).select().single();

    // Mark original as rescheduled
    await sb.from('re_bookings').update({
      status: 'rescheduled', reschedule_reason: reason || null,
      rescheduled_to_slot_id: new_slot_id, updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const oldSlot = booking.re_agenda_slots;
    const user    = booking.re_users || {};
    const email   = user.email || booking.external_contact?.email;
    const name    = user.name  || booking.external_contact?.name || email;
    const oldFmt  = new Date(oldSlot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const newFmt  = new Date(newSlot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      const linkLine = newSlot.meeting_link ? emailFactRow('Link', `<a href="${newSlot.meeting_link}">${newSlot.meeting_link}</a>`, 'font-weight:400') : '';
      sendMail(email, '📅 Agendamento remarcado — Recupera Empresas', emailWrapper(
        'Agendamento remarcado',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi <b>remarcado</b>.</p>
         ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
         ${emailFactTable([
           emailFactRow('Data anterior', oldFmt, 'text-decoration:line-through;color:#94A3B8'),
           emailFactRow('Nova data', newFmt, 'font-weight:700;color:#10B981'),
           emailFactRow('Sessão', newSlot.title||'Consultoria'),
           linkLine,
         ].filter(Boolean).join(''))}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes da nova sessão.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true, new_booking: newBooking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: book a slot for an existing client or external contact ──────────────
router.post('/api/admin/agenda/book-for-client', requireAdmin, async (req, res) => {
  try {
    const { slot_id, user_id, external_contact, notes } = req.body;
    if (!slot_id) return res.status(400).json({ error: 'slot_id é obrigatório.' });
    if (!user_id && !external_contact?.name) return res.status(400).json({ error: 'Informe user_id ou external_contact.name.' });

    const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slot_id).single();
    if (!slot) return res.status(404).json({ error: 'Horário não encontrado.' });
    if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Horário já passou.' });

    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', slot_id).in('status', ['pending','confirmed']);
    if ((count||0) >= slot.max_bookings) return res.status(400).json({ error: 'Horário lotado.' });

    // Get user info for email
    let userInfo = null;
    if (user_id) {
      const { data: u } = await sb.from('re_users').select('id,name,email,company').eq('id', user_id).single();
      userInfo = u;
    }

    const { data: booking, error } = await sb.from('re_bookings').insert({
      slot_id, user_id: user_id || null,
      external_contact: !user_id ? external_contact : null,
      status: 'confirmed', confirmed_at: new Date().toISOString(),
      credits_spent: 0, notes: notes || null, // admin bookings don't spend credits
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const name  = userInfo?.name  || external_contact?.name  || 'Cliente';
    const email = userInfo?.email || external_contact?.email;
    const startsAtFmt = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const linkLine = slot.meeting_link ? `<p><b>Link:</b> <a href="${slot.meeting_link}">${slot.meeting_link}</a></p>` : '';

    if (email) {
      sendMail(email, '✅ Agendamento confirmado — Recupera Empresas', emailWrapper(
        'Agendamento confirmado',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi confirmado.</p>
         <p><b>Sessão:</b> ${slot.title||'Consultoria'}<br><b>Data:</b> ${startsAtFmt}<br><b>Modalidade:</b> ${slot.location==='presencial'?'Presencial':'Online'}</p>
         ${linkLine}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Calendar
    const evId = _calendarEventIds.get(slot_id);
    if (evId && email) {
      gcPatchEvent(evId, {
        summary: `${slot.title||'Consultoria'} — ${name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[async]', e?.message));
    }

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'booking', entityId: booking.id, action: 'admin_book',
      after: { slot_id, user_id, name, startsAtFmt } }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, booking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: adjust credits manually
router.post('/api/admin/client/:id/credits', requireAdmin, async (req, res) => {
  const { delta, reason } = req.body;
  if (!delta || !reason) return res.status(400).json({ error: 'delta e reason obrigatórios.' });
  const { findUserById } = require('../lib/db');
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const newBal = await adjustCredits(user.id, parseInt(delta), reason, `admin:${req.user.id}`);
  res.json({ success: true, credits_balance: newBal });
});

module.exports = router;
