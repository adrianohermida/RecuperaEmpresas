'use strict';
const router = require('express').Router();
const { sb, GOOGLE_CALENDAR_WEBHOOK_SECRET } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');
const { gcCreateEvent, gcPatchEvent, gcDeleteEvent, gcFreeBusy, gcListEvents, computeFreeWindows, _gcAccessToken } = require('../lib/calendar');
const { selectWithColumnFallback, insertWithColumnFallback, isSchemaCompatibilityError, buildRouteDiagnostic } = require('../lib/schema');
const { auditLog } = require('../lib/logging');
const { adjustCredits } = require('./agenda');
const {
  sendBookingConfirmed,
  sendBookingCancelledByAdmin,
  sendBookingRescheduled,
  sendRescheduleRejected,
  sendNoShowAlert,
} = require('../lib/agenda-emails');
const {
  buildStatusEntry,
  appendStatusHistory,
  appendAttendee,
  recordConflict,
  updateMetrics,
} = require('../lib/agenda-helpers');

// ─── helper: get calendar_event_id from DB ────────────────────────────────────
async function getCalEventId(slotId) {
  const { data } = await sb.from('re_agenda_slots')
    .select('calendar_event_id').eq('id', slotId).maybeSingle();
  return data?.calendar_event_id || null;
}

// ─── helper: save calendar_event_id to DB ────────────────────────────────────
async function saveCalEventId(slotId, eventId) {
  if (!slotId || !eventId) return;
  await sb.from('re_agenda_slots')
    .update({ calendar_event_id: eventId }).eq('id', slotId);
}

// ─── booking columns used throughout ─────────────────────────────────────────
const BOOKING_COLS = [
  'id', 'slot_id', 'user_id', 'member_id', 'booker_name', 'booker_email',
  'status', 'credits_spent', 'confirmed_at', 'cancel_reason', 'cancelled_by',
  'reschedule_reason', 'rescheduled_to_slot_id',
  'reschedule_requested_slot_id', 'reschedule_requested_at',
  'notes', 'no_show', 'created_at',
  're_users(id,name,email,company)',
];

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const includeBookings = !['0', 'false', 'no'].includes(String(req.query.include_bookings || '1').toLowerCase());

    const { data: slots, error: slotsError } = await selectWithColumnFallback('re_agenda_slots', {
      columns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings',
                'duration_min', 'location', 'meet_link', 'description', 'calendar_event_id', 'created_at'],
      requiredColumns: ['id', 'starts_at', 'ends_at'],
      orderBy: ['starts_at', 'created_at', 'id'],
      apply: (q) => q.gte('starts_at', from).limit(100),
    });

    if (slotsError) {
      if (isSchemaCompatibilityError(slotsError.message, ['re_agenda_slots'])) {
        return res.json({ slots: [] });
      }
      return res.status(500).json({ error: slotsError.message });
    }

    if (!includeBookings) return res.json({ slots: slots || [] });

    const slotIds = (slots || []).map(s => s.id);
    let bookings  = [];

    if (slotIds.length) {
      const { data, error } = await selectWithColumnFastFallback(slotIds);
      if (!error) bookings = data || [];
      else console.warn('[ADMIN AGENDA BOOKINGS]', error.message);
    }

    const bySlot = {};
    bookings.forEach(b => { (bySlot[b.slot_id] = bySlot[b.slot_id] || []).push(b); });

    res.json({ slots: (slots || []).map(s => ({ ...s, bookings: bySlot[s.id] || [] })) });
  } catch (e) {
    console.error('[ADMIN AGENDA SLOTS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function selectWithColumnFastFallback(slotIds) {
  return selectWithColumnFallback('re_bookings', {
    columns: BOOKING_COLS,
    requiredColumns: ['id', 'slot_id', 'status'],
    orderBy: ['created_at', 'id'],
    apply: (q) => q.in('slot_id', slotIds),
  });
}

router.post('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const { starts_at, ends_at, title, credits_cost, max_bookings, duration_min, location, meet_link, description } = req.body;
    if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at e ends_at são obrigatórios.' });
    const dtStart = new Date(starts_at);
    const dtEnd   = new Date(ends_at);
    if (isNaN(dtStart.getTime()) || isNaN(dtEnd.getTime()))
      return res.status(400).json({ error: 'starts_at e ends_at devem ser datas ISO válidas.' });
    if (dtStart < new Date())
      return res.status(400).json({ error: 'starts_at não pode ser no passado.' });
    if (dtEnd <= dtStart)
      return res.status(400).json({ error: 'ends_at deve ser posterior a starts_at.' });
    if ((dtEnd - dtStart) < 15 * 60 * 1000)
      return res.status(400).json({ error: 'A duração mínima de um slot é 15 minutos.' });

    const attempts = [
      { starts_at, ends_at, title: title || 'Consultoria', credits_cost: credits_cost || 1,
        max_bookings: max_bookings || 1, duration_min: duration_min || 60,
        location: location || 'online', meet_link: meet_link || null,
        description: description || null, created_by: req.user.id },
      { starts_at, ends_at, title: title || 'Consultoria', credits_cost: credits_cost || 1,
        max_bookings: max_bookings || 1, duration_min: duration_min || 60, location: location || 'online' },
      { starts_at, ends_at, title: title || 'Consultoria', credits_cost: credits_cost || 1, max_bookings: max_bookings || 1 },
      { starts_at, ends_at, title: title || 'Consultoria' },
      { starts_at, ends_at },
    ];

    let slotInsert = null;
    for (const payload of attempts) {
      slotInsert = await insertWithColumnFallback('re_agenda_slots', payload, {
        requiredColumns: ['starts_at', 'ends_at'],
        returningColumns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings',
                           'duration_min', 'location', 'meet_link', 'description', 'created_at'],
        requiredReturningColumns: ['id', 'starts_at', 'ends_at'],
      });
      if (!slotInsert.error) break;
    }

    const { data, error } = slotInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_agenda_slots'])) {
        return res.status(503).json({ error: 'Agenda indisponível — aguardando migração do banco.', diagnostic: buildRouteDiagnostic('/api/admin/agenda/slots', error, attempts) });
      }
      return res.status(500).json({ error: error.message });
    }

    // Create Google Calendar event and persist the event ID
    gcCreateEvent({
      summary:         `[Disponível] ${title || 'Consultoria'} — Recupera Empresas`,
      description:     `Slot disponível.\nVagas: ${max_bookings || 1} | Créditos: ${credits_cost || 1}${meet_link ? '\nLink: ' + meet_link : ''}`,
      start:           starts_at,
      end:             ends_at,
      attendeeEmails:  [],
    }).then(async event => {
      if (event?.id) {
        await saveCalEventId(data.id, event.id);
        // If Meet link was auto-generated, persist it back
        if (event.hangoutLink && !meet_link) {
          await sb.from('re_agenda_slots').update({ meet_link: event.hangoutLink }).eq('id', data.id);
        }
      }
    }).catch(e => console.warn('[GCAL create]', e.message));

    // ── Métricas: slot criado ─────────────────────────────────────────────────
    updateMetrics(sb, req.user.id, { total_slots_created: 1 })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true, slot: data });
  } catch (e) {
    console.error('[ADMIN AGENDA CREATE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/agenda/slots/:slotId', requireAdmin, async (req, res) => {
  const { slotId } = req.params;
  const evId = await getCalEventId(slotId);
  await sb.from('re_agenda_slots').delete().eq('id', slotId);
  if (evId) gcDeleteEvent(evId).catch(e => console.warn('[GCAL delete]', e.message));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AVAILABILITY (freebusy from Google Calendar)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agenda/camila-availability
 * Returns Camila's free windows (not created as slots yet) for the next N days.
 * Useful for admin to pick times when creating new slots.
 */
router.get('/api/admin/agenda/camila-availability', requireAdmin, async (req, res) => {
  try {
    // ── Check credentials before computing "free" windows ────────────────────
    // Without a valid token, gcFreeBusy returns [] which looks like a fully-free
    // calendar — indistinguishable from a real empty calendar. We detect this
    // upfront and return a clear error so the UI can show the right message.
    const token = await _gcAccessToken();
    if (!token) {
      return res.status(503).json({
        error:         'Google Calendar não configurado. Verifique as credenciais (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN).',
        unconfigured:  true,
        free_windows:  {},
        busy_intervals: [],
      });
    }

    const days     = Math.min(parseInt(req.query.days || '14'), 60);
    const from     = req.query.from || new Date().toISOString();
    const to       = new Date(Date.now() + days * 86400_000).toISOString();
    const duration = parseInt(req.query.duration_min || '60');

    const busy = await gcFreeBusy(from, to);

    // Group free windows by day (skip weekends)
    const dayMap = {};
    const cursor = new Date(from);
    const end    = new Date(to);
    while (cursor < end) {
      const dow     = cursor.getDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && dow !== 6) {   // skip weekends
        const dateStr = cursor.toISOString().slice(0, 10);
        const windows = computeFreeWindows(busy, dateStr, duration);
        if (windows.length) dayMap[dateStr] = windows;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ free_windows: dayMap, busy_intervals: busy, calendar_connected: true });
  } catch (e) {
    console.error('[AVAILABILITY]', e.message);
    res.status(500).json({ error: e.message, free_windows: {}, busy_intervals: [] });
  }
});

/**
 * GET /api/admin/agenda/check-availability?date=YYYY-MM-DD
 * Quick check: is a specific date/time available?
 */
router.get('/api/admin/agenda/check-availability', requireAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date é obrigatório (YYYY-MM-DD).' });

    const from = `${date}T00:00:00.000Z`;
    const to   = `${date}T23:59:59.000Z`;
    const busy = await gcFreeBusy(from, to);

    const windows = computeFreeWindows(busy, date, 60);
    res.json({ date, busy_intervals: busy, free_windows: windows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/api/admin/agenda/bookings', requireAdmin, async (req, res) => {
  try {
    const from   = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const status = req.query.status;

    let query = sb.from('re_bookings')
      .select(`id,slot_id,user_id,member_id,booker_name,booker_email,status,credits_spent,
               confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,
               reschedule_requested_slot_id,reschedule_requested_at,notes,
               no_show,created_at,
               re_users(id,name,email,company),
               slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,duration_min)`)
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(300);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ bookings: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Confirm ──────────────────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/confirm', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,calendar_event_id,duration_min),re_users(name,email,company)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Já confirmada.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Reserva cancelada.' });

    await sb.from('re_bookings').update({
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }).eq('id', booking.id);

    const slot    = booking.slot || {};
    const user    = booking.re_users        || {};
    const email   = user.email  || booking.booker_email || null;
    const name    = user.name   || booking.booker_name || email;
    const company = user.company || booking.booker_name || name;
    const meetLink = slot.meet_link || null;

    // Update Google Calendar event with attendee
    const evId = slot.calendar_event_id;
    if (evId && email) {
      gcPatchEvent(evId, {
        summary:   `${slot.title || 'Consultoria'} — ${company}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[GCAL confirm]', e.message));
    }

    sendBookingConfirmed({
      clientEmail: email,
      clientName:  name,
      slot,
      meetLink,
      bookerName:  booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history, attendees e métricas ────────────────────
    appendStatusHistory(sb, booking.id, buildStatusEntry('confirmed', 'admin', { admin_id: req.user.id }))
      .catch(e => console.warn('[agenda-helpers]', e.message));
    if (email) {
      appendAttendee(sb, booking.id, { email, name, role: 'client' })
        .catch(e => console.warn('[agenda-helpers]', e.message));
    }
    updateMetrics(sb, req.user.id, { confirmed_bookings: 1 })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Cancel by admin ──────────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/cancel', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Já cancelada.' });

    await sb.from('re_bookings').update({
      status:        'cancelled',
      cancelled_by:  'admin',
      cancel_reason: reason || null,
      updated_at:    new Date().toISOString(),
    }).eq('id', booking.id);

    // Refund credits
    if (booking.user_id && booking.credits_spent) {
      adjustCredits(booking.user_id, booking.credits_spent, 'refund_admin_cancel', booking.id)
        .catch(e => console.warn('[credits refund]', e.message));
    }

    const slot  = booking.slot || {};
    const user  = booking.re_users        || {};
    const email = user.email || booking.booker_email || null;
    const name  = user.name  || booking.booker_name || email;

    // Restore Google Calendar event
    const evId = slot.calendar_event_id;
    if (evId) {
      gcPatchEvent(evId, {
        summary:   `[Disponível] ${slot.title || 'Consultoria'} — Recupera Empresas`,
        attendees: [],
      }).catch(e => console.warn('[GCAL cancel]', e.message));
    }

    sendBookingCancelledByAdmin({
      clientEmail:      email,
      clientName:       name,
      slot,
      reason,
      creditsRefunded:  booking.credits_spent || 0,
      bookerName:       booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history e métricas ───────────────────────────────
    appendStatusHistory(sb, booking.id, buildStatusEntry('cancelled', 'admin', {
      admin_id: req.user.id,
      reason: reason || null,
    })).catch(e => console.warn('[agenda-helpers]', e.message));
    updateMetrics(sb, req.user.id, { cancelled_bookings: 1 })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reschedule by admin ──────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
  try {
    const { new_slot_id, reason } = req.body;
    if (!new_slot_id) return res.status(400).json({ error: 'new_slot_id é obrigatório.' });

    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email,company)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (['cancelled', 'rescheduled'].includes(booking.status))
      return res.status(400).json({ error: 'Reserva não pode ser remarcada.' });

    const { data: newSlot } = await sb.from('re_agenda_slots').select('*').eq('id', new_slot_id).single();
    if (!newSlot) return res.status(404).json({ error: 'Novo slot não encontrado.' });

    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', new_slot_id).in('status', ['pending', 'confirmed']);
    if ((count || 0) >= newSlot.max_bookings) return res.status(400).json({ error: 'Novo slot lotado.' });

    // Create new confirmed booking on new slot
    const { data: newBooking } = await sb.from('re_bookings').insert({
      slot_id:          new_slot_id,
      user_id:          booking.user_id,
      member_id:        booking.member_id        || null,
      booker_name:      booking.booker_name      || null,
      booker_email:     booking.booker_email     || null,
      status:           'confirmed',
      confirmed_at:     new Date().toISOString(),
      credits_spent:    booking.credits_spent,
      notes:            booking.notes || null,
    }).select().single();

    // Mark original as rescheduled
    await sb.from('re_bookings').update({
      status:                   'rescheduled',
      reschedule_reason:        reason || null,
      rescheduled_to_slot_id:   new_slot_id,
      updated_at:               new Date().toISOString(),
    }).eq('id', booking.id);

    const oldSlot = booking.slot || {};
    const user    = booking.re_users        || {};
    const email   = user.email || booking.booker_email || null;
    const name    = user.name  || booking.booker_name || email;

    // Update new slot's Google Calendar event
    const newEvId = await getCalEventId(new_slot_id);
    if (newEvId && email) {
      gcPatchEvent(newEvId, {
        summary:   `${newSlot.title || 'Consultoria'} — ${user.company || name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[GCAL reschedule]', e.message));
    }
    // Restore old slot
    const oldEvId = oldSlot.calendar_event_id;
    if (oldEvId) {
      gcPatchEvent(oldEvId, {
        summary:   `[Disponível] ${oldSlot.title || 'Consultoria'} — Recupera Empresas`,
        attendees: [],
      }).catch(e => console.warn('[GCAL old slot restore]', e.message));
    }

    sendBookingRescheduled({
      clientEmail: email,
      clientName:  name,
      oldSlot,
      newSlot:     { ...newSlot, meet_link: newSlot.meet_link || newSlot.meeting_link },
      meetLink:    newSlot.meet_link || newSlot.meeting_link,
      bookerName:  booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history nos dois bookings ─────────────────────────
    if (newBooking?.id) {
      appendStatusHistory(sb, newBooking.id, buildStatusEntry('confirmed', 'admin', {
        admin_id: req.user.id, rescheduled_from: booking.id,
      })).catch(e => console.warn('[agenda-helpers]', e.message));
      if (email) {
        appendAttendee(sb, newBooking.id, { email, name, role: 'client' })
          .catch(e => console.warn('[agenda-helpers]', e.message));
      }
    }
    appendStatusHistory(sb, booking.id, buildStatusEntry('rescheduled', 'admin', {
      admin_id: req.user.id, new_slot_id, reason: reason || null,
    })).catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true, new_booking: newBooking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Approve client reschedule request ───────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/approve-reschedule', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email,company)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status !== 'pending_reschedule')
      return res.status(400).json({ error: 'Reserva não está aguardando remarcação.' });
    if (!booking.reschedule_requested_slot_id)
      return res.status(400).json({ error: 'Nenhum slot solicitado.' });

    const newSlotId = booking.reschedule_requested_slot_id;
    const { data: newSlot } = await sb.from('re_agenda_slots').select('*').eq('id', newSlotId).single();
    if (!newSlot) return res.status(404).json({ error: 'Slot solicitado não existe mais.' });

    // Check capacity on requested slot
    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', newSlotId).in('status', ['pending', 'confirmed']);
    if ((count || 0) >= newSlot.max_bookings) return res.status(400).json({ error: 'Slot solicitado está lotado.' });

    // Create new booking on requested slot
    await sb.from('re_bookings').insert({
      slot_id:      newSlotId,
      user_id:      booking.user_id,
      member_id:    booking.member_id    || null,
      booker_name:  booking.booker_name  || null,
      booker_email: booking.booker_email || null,
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
      credits_spent: booking.credits_spent,
      notes:        booking.notes || null,
    });

    // Mark original as rescheduled
    await sb.from('re_bookings').update({
      status:                  'rescheduled',
      rescheduled_to_slot_id:  newSlotId,
      updated_at:              new Date().toISOString(),
    }).eq('id', booking.id);

    const oldSlot  = booking.slot || {};
    const user     = booking.re_users        || {};
    const email    = user.email || booking.booker_email || null;
    const name     = user.name  || booking.booker_name || email;

    sendBookingRescheduled({
      clientEmail: email, clientName: name,
      oldSlot,
      newSlot:     { ...newSlot, meet_link: newSlot.meet_link || newSlot.meeting_link },
      meetLink:    newSlot.meet_link || newSlot.meeting_link,
      bookerName:  booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history ───────────────────────────────────────────
    appendStatusHistory(sb, booking.id, buildStatusEntry('rescheduled', 'admin', {
      admin_id: req.user.id, new_slot_id: newSlotId, approved_reschedule: true,
    })).catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reject client reschedule request ────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/reject-reschedule', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,title),re_users(name,email)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

    // Revert to previous confirmed status
    await sb.from('re_bookings').update({
      status:                       'confirmed',
      reschedule_requested_slot_id: null,
      reschedule_requested_at:      null,
      reschedule_reject_reason:     reason || null,
      updated_at:                   new Date().toISOString(),
    }).eq('id', booking.id);

    const user  = booking.re_users || {};
    sendRescheduleRejected({
      clientEmail:  user.email || booking.booker_email || null,
      clientName:   user.name  || booking.booker_name || null,
      currentSlot:  booking.slot || { starts_at: booking.created_at },
      reason,
      bookerName:   booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history ───────────────────────────────────────────
    appendStatusHistory(sb, booking.id, buildStatusEntry('confirmed', 'admin', {
      admin_id: req.user.id, reschedule_rejected: true, reason: reason || null,
    })).catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Mark no-show ─────────────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/no-show', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,slot:re_agenda_slots!slot_id(id,starts_at,title),re_users(name,email)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

    await sb.from('re_bookings').update({
      no_show:    true,
      no_show_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const user = booking.re_users || {};
    sendNoShowAlert({
      clientName:  user.name  || booking.booker_name || null,
      clientEmail: user.email || booking.booker_email || null,
      slot:        booking.slot || { starts_at: booking.created_at, title: 'Consultoria' },
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    // ── Registro de status_history, conflito e métricas ─────────────────────
    appendStatusHistory(sb, booking.id, buildStatusEntry('no_show', 'admin', { admin_id: req.user.id }))
      .catch(e => console.warn('[agenda-helpers]', e.message));
    recordConflict(sb, booking.id, 'no_show', 'Cliente não compareceu à sessão.')
      .catch(e => console.warn('[agenda-helpers]', e.message));
    updateMetrics(sb, req.user.id, { no_show_count: 1 })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Book for client (admin) ──────────────────────────────────────────────────
router.post('/api/admin/agenda/book-for-client', requireAdmin, async (req, res) => {
  try {
    const { slot_id, user_id, external_contact, notes } = req.body;
    if (!slot_id) return res.status(400).json({ error: 'slot_id é obrigatório.' });
    if (!user_id && !external_contact?.name) return res.status(400).json({ error: 'Informe user_id ou external_contact.name.' });

    const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slot_id).single();
    if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
    if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Slot já passou.' });

    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', slot_id).in('status', ['pending', 'confirmed']);
    if ((count || 0) >= slot.max_bookings) return res.status(400).json({ error: 'Slot lotado.' });

    let userInfo = null;
    if (user_id) {
      const { data: u } = await sb.from('re_users').select('id,name,email,company').eq('id', user_id).single();
      userInfo = u;
    }

    const { data: booking, error } = await sb.from('re_bookings').insert({
      slot_id,
      user_id:      user_id || null,
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
      credits_spent: 0,
      notes:        notes || null,
      booker_name:  userInfo?.name  || external_contact?.name  || null,
      booker_email: userInfo?.email || external_contact?.email || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const name     = userInfo?.name  || external_contact?.name  || 'Cliente';
    const email    = userInfo?.email || external_contact?.email;
    const meetLink = slot.meet_link || slot.meeting_link;

    // Update Google Calendar event
    const evId = slot.calendar_event_id || await getCalEventId(slot_id);
    if (evId && email) {
      gcPatchEvent(evId, {
        summary:   `${slot.title || 'Consultoria'} — ${name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[GCAL book-for-client]', e.message));
    }

    const { sendBookingConfirmed: sendConfirmed } = require('../lib/agenda-emails');
    sendConfirmed({
      clientEmail: email,
      clientName:  name,
      slot,
      meetLink,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    auditLog({
      actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'booking', entityId: booking.id, action: 'admin_book',
      after: { slot_id, user_id, name },
    }).catch(e => console.warn('[audit]', e.message));

    res.json({ success: true, booking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Adjust client credits (admin) ───────────────────────────────────────────
router.post('/api/admin/client/:id/credits', requireAdmin, async (req, res) => {
  const { delta, reason } = req.body;
  if (!delta || !reason) return res.status(400).json({ error: 'delta e reason obrigatórios.' });
  const { findUserById } = require('../lib/db');
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const newBal = await adjustCredits(user.id, parseInt(delta), reason, `admin:${req.user.id}`);
  res.json({ success: true, credits_balance: newBal });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR WEBHOOK (push notifications)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/agenda/google-webhook
 * Receives push notifications from Google Calendar when Camila's calendar changes.
 * On 'exists' state: diffs DB slots vs Calendar events and flags discrepancies.
 */
router.post('/api/admin/agenda/google-webhook', async (req, res) => {
  // Validate secret token
  const token = req.headers['x-goog-channel-token'];
  if (GOOGLE_CALENDAR_WEBHOOK_SECRET && token !== GOOGLE_CALENDAR_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const channelId  = req.headers['x-goog-channel-id'];
  const state      = req.headers['x-goog-resource-state']; // 'sync' | 'exists' | 'not_exists'
  const expiration = req.headers['x-goog-channel-expiration'];
  console.info(`[GCAL webhook] state=${state} channel=${channelId} expires=${expiration}`);
  // Always respond 200 quickly to avoid Google retrying
  res.status(200).json({ ok: true });
  // Process asynchronously after responding
  if (state === 'exists') {
    _processCalendarSync().catch(e => console.error('[GCAL webhook sync]', e.message));
  }
});

/**
 * Async helper: diff DB slots vs Google Calendar events.
 * Detects events deleted/cancelled in GCal that still exist as active slots in DB,
 * and flags them as conflicts so the admin can review.
 */
async function _processCalendarSync() {
  try {
    const now  = new Date();
    const from = now.toISOString();
    const to   = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch upcoming slots from DB that have a calendar_event_id
    const { data: dbSlots } = await sb.from('re_agenda_slots')
      .select('id, starts_at, ends_at, title, calendar_event_id')
      .gte('starts_at', from)
      .lte('starts_at', to)
      .not('calendar_event_id', 'is', null)
      .limit(200);

    if (!dbSlots || !dbSlots.length) return;

    // Fetch events from Google Calendar for the same window
    let gcEvents = [];
    try {
      gcEvents = await gcListEvents(from, to, 250);
    } catch (e) {
      console.warn('[GCAL webhook] Could not fetch events:', e.message);
      return;
    }

    // Build a set of active GCal event IDs
    const gcActiveIds = new Set(
      gcEvents
        .filter(ev => ev.status !== 'cancelled')
        .map(ev => ev.id)
    );

    // Find DB slots whose GCal event was deleted or cancelled
    const missingInGCal = dbSlots.filter(s => !gcActiveIds.has(s.calendar_event_id));

    for (const slot of missingInGCal) {
      const { count } = await sb.from('re_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('slot_id', slot.id)
        .in('status', ['pending', 'confirmed']);

      if ((count || 0) > 0) {
        const { data: bookings } = await sb.from('re_bookings')
          .select('id')
          .eq('slot_id', slot.id)
          .in('status', ['pending', 'confirmed']);

        for (const booking of (bookings || [])) {
          const { count: existingConflict } = await sb.from('re_agenda_conflicts')
            .select('id', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('conflict_type', 'overlap')
            .is('resolved_at', null);

          if (!(existingConflict > 0)) {
            await sb.from('re_agenda_conflicts').insert({
              booking_id:    booking.id,
              conflict_type: 'overlap',
              description:   `Evento do Google Calendar (${slot.calendar_event_id}) foi removido/cancelado, mas o slot "${slot.title}" (${new Date(slot.starts_at).toLocaleString('pt-BR')}) ainda possui reservas ativas no sistema.`,
            });
            console.warn(`[GCAL webhook] Conflict registered for booking ${booking.id}`);
          }
        }
      }
    }
    console.info(`[GCAL webhook] Sync done. Checked ${dbSlots.length} slots, ${missingInGCal.length} missing in GCal.`);
  } catch (e) {
    console.error('[GCAL webhook _processCalendarSync]', e.message);
  }
}

/**
 * POST /api/admin/agenda/google-webhook/register
 * Registers (or re-registers) the push notification channel for Camila's calendar.
 */
router.post('/api/admin/agenda/google-webhook/register', requireAdmin, async (req, res) => {
  try {
    const { gcWatchCalendar } = require('../lib/calendar');
    const channelId = `re-agenda-${Date.now()}`;
    const ttl       = parseInt(req.body.ttl_seconds || '604800');
    const result    = await gcWatchCalendar(channelId, ttl);
    if (!result?.id) return res.status(500).json({ error: 'Falha ao registrar webhook no Google Calendar.' });
    console.info(`[GCAL webhook] Channel registered: ${result.id}, expires: ${result.expiration}`);
    res.json({ success: true, channel_id: result.id, expiration: result.expiration, resource_id: result.resourceId });
  } catch (e) {
    console.error('[GCAL webhook register]', e.message);
    res.status(500).json({ error: e.message });
  }
});});

// ─── Admin bookings summary per client ───────────────────────────────────────
router.get('/api/admin/agenda/client/:clientId/bookings', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await sb.from('re_bookings')
      .select(`id,slot_id,member_id,booker_name,booker_email,status,credits_spent,
               confirmed_at,cancel_reason,no_show,created_at,
               slot:re_agenda_slots!slot_id(id,starts_at,ends_at,title,location,meet_link,duration_min)`)
      .eq('user_id', req.params.clientId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ bookings: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── GET /api/admin/agenda/bookings/:bookingId/feedback — view client feedback ─
router.get('/api/admin/agenda/bookings/:bookingId/feedback', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`id, status, feedback_rating, feedback_comment, feedback_submitted_at,
               booker_name, booker_email, re_users(name, email, company),
               slot:re_agenda_slots!slot_id(id, starts_at, ends_at, title)`)
      .eq('id', req.params.bookingId)
      .maybeSingle();

    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

    res.json({
      booking_id:            booking.id,
      status:                booking.status,
      client:                booking.re_users || { name: booking.booker_name, email: booking.booker_email },
      slot:                  booking.slot,
      feedback_submitted:    !!booking.feedback_submitted_at,
      feedback_rating:       booking.feedback_rating || null,
      feedback_comment:      booking.feedback_comment || null,
      feedback_submitted_at: booking.feedback_submitted_at || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/admin/agenda/feedback-summary — aggregate feedback stats ─────────
router.get('/api/admin/agenda/feedback-summary', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb.from('re_bookings')
      .select(`id, feedback_rating, feedback_comment, feedback_submitted_at,
               booker_name, booker_email, re_users(name, email, company),
               slot:re_agenda_slots!slot_id(id, starts_at, title)`)
      .not('feedback_submitted_at', 'is', null)
      .gte('feedback_submitted_at', from)
      .order('feedback_submitted_at', { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });

    const feedbacks = data || [];
    const ratings   = feedbacks.map(f => f.feedback_rating).filter(Boolean);
    const avg       = ratings.length
      ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
      : null;

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach(r => { if (distribution[r] !== undefined) distribution[r]++; });

    res.json({
      total_feedbacks: feedbacks.length,
      average_rating:  avg,
      distribution,
      feedbacks: feedbacks.map(f => ({
        booking_id:            f.id,
        rating:                f.feedback_rating,
        comment:               f.feedback_comment,
        submitted_at:          f.feedback_submitted_at,
        client:                f.re_users || { name: f.booker_name, email: f.booker_email },
        slot:                  f.slot,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA TEMPLATES (re_agenda_templates)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agenda/templates
 * Lista todos os templates do consultor autenticado.
 */
router.get('/api/admin/agenda/templates', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await sb.from('re_agenda_templates')
      .select('*')
      .eq('consultant_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ templates: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/admin/agenda/templates
 * Cria um novo template de agendamento.
 */
router.post('/api/admin/agenda/templates', requireAdmin, async (req, res) => {
  try {
    const { name, description, duration_min, credits_cost, max_bookings, location, color_tag } = req.body;
    if (!name) return res.status(400).json({ error: 'name é obrigatório.' });

    const { data, error } = await sb.from('re_agenda_templates').insert({
      consultant_id: req.user.id,
      name:          name.trim(),
      description:   description || null,
      duration_min:  duration_min  || 60,
      credits_cost:  credits_cost  || 1,
      max_bookings:  max_bookings  || 1,
      location:      location      || 'online',
      color_tag:     color_tag     || null,
      is_active:     true,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, template: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * PUT /api/admin/agenda/templates/:templateId
 * Atualiza um template existente.
 */
router.put('/api/admin/agenda/templates/:templateId', requireAdmin, async (req, res) => {
  try {
    const { name, description, duration_min, credits_cost, max_bookings, location, color_tag, is_active } = req.body;

    const { data: existing } = await sb.from('re_agenda_templates')
      .select('id, consultant_id').eq('id', req.params.templateId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Template não encontrado.' });
    if (existing.consultant_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão para editar este template.' });

    const updates = { updated_at: new Date().toISOString() };
    if (name        !== undefined) updates.name         = name.trim();
    if (description !== undefined) updates.description  = description;
    if (duration_min !== undefined) updates.duration_min = duration_min;
    if (credits_cost !== undefined) updates.credits_cost = credits_cost;
    if (max_bookings !== undefined) updates.max_bookings = max_bookings;
    if (location    !== undefined) updates.location     = location;
    if (color_tag   !== undefined) updates.color_tag    = color_tag;
    if (is_active   !== undefined) updates.is_active    = is_active;

    const { data, error } = await sb.from('re_agenda_templates')
      .update(updates).eq('id', req.params.templateId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, template: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * DELETE /api/admin/agenda/templates/:templateId
 * Remove um template.
 */
router.delete('/api/admin/agenda/templates/:templateId', requireAdmin, async (req, res) => {
  try {
    const { data: existing } = await sb.from('re_agenda_templates')
      .select('id, consultant_id').eq('id', req.params.templateId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Template não encontrado.' });
    if (existing.consultant_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão para remover este template.' });

    const { error } = await sb.from('re_agenda_templates').delete().eq('id', req.params.templateId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/admin/agenda/slots/from-template/:templateId
 * Cria um novo slot a partir de um template existente.
 * Body: { starts_at, ends_at }
 */
router.post('/api/admin/agenda/slots/from-template/:templateId', requireAdmin, async (req, res) => {
  try {
    const { starts_at, ends_at } = req.body;
    if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at e ends_at são obrigatórios.' });
    const dtStart = new Date(starts_at);
    const dtEnd   = new Date(ends_at);
    if (isNaN(dtStart.getTime()) || isNaN(dtEnd.getTime()))
      return res.status(400).json({ error: 'starts_at e ends_at devem ser datas ISO válidas.' });
    if (dtStart < new Date())
      return res.status(400).json({ error: 'starts_at não pode ser no passado.' });
    if (dtEnd <= dtStart)
      return res.status(400).json({ error: 'ends_at deve ser posterior a starts_at.' });
    if ((dtEnd - dtStart) < 15 * 60 * 1000)
      return res.status(400).json({ error: 'A duração mínima de um slot é 15 minutos.' });

    const { data: tmpl } = await sb.from('re_agenda_templates')
      .select('*').eq('id', req.params.templateId).eq('is_active', true).maybeSingle();
    if (!tmpl) return res.status(404).json({ error: 'Template não encontrado ou inativo.' });

    const { data, error } = await sb.from('re_agenda_slots').insert({
      starts_at,
      ends_at,
      title:        tmpl.name,
      description:  tmpl.description || null,
      duration_min: tmpl.duration_min,
      credits_cost: tmpl.credits_cost,
      max_bookings: tmpl.max_bookings,
      location:     tmpl.location,
      created_by:   req.user.id,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Metrics
    updateMetrics(sb, req.user.id, { total_slots_created: 1 })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    // Google Calendar (async, non-blocking)
    const { gcCreateEvent } = require('../lib/calendar');
    gcCreateEvent({
      summary:        `[Disponível] ${tmpl.name} — Recupera Empresas`,
      description:    `Slot disponível.
Vagas: ${tmpl.max_bookings} | Créditos: ${tmpl.credits_cost}`,
      start:          starts_at,
      end:            ends_at,
      attendeeEmails: [],
    }).then(async event => {
      if (event?.id) {
        await sb.from('re_agenda_slots').update({ calendar_event_id: event.id }).eq('id', data.id);
        if (event.hangoutLink) {
          await sb.from('re_agenda_slots').update({ meet_link: event.hangoutLink }).eq('id', data.id);
        }
      }
    }).catch(e => console.warn('[GCAL from-template]', e.message));

    res.json({ success: true, slot: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA CONFLICTS (re_agenda_conflicts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agenda/conflicts
 * Lista conflitos de agenda não resolvidos (ou todos com ?include_resolved=1).
 */
router.get('/api/admin/agenda/conflicts', requireAdmin, async (req, res) => {
  try {
    const includeResolved = ['1', 'true', 'yes'].includes(String(req.query.include_resolved || '0').toLowerCase());

    let query = sb.from('re_agenda_conflicts')
      .select(`id, booking_id, conflict_type, description, detected_at, resolved_at, resolution_notes,
               booking:re_bookings!booking_id(id, status, booker_name, booker_email,
                 re_users(name, email, company),
                 slot:re_agenda_slots!slot_id(id, starts_at, ends_at, title))`)
      .order('detected_at', { ascending: false })
      .limit(200);

    if (!includeResolved) query = query.is('resolved_at', null);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ conflicts: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * PUT /api/admin/agenda/conflicts/:conflictId/resolve
 * Marca um conflito como resolvido.
 * Body: { resolution_notes }
 */
router.put('/api/admin/agenda/conflicts/:conflictId/resolve', requireAdmin, async (req, res) => {
  try {
    const { resolution_notes } = req.body;
    const now = new Date().toISOString();

    const { data: existing } = await sb.from('re_agenda_conflicts')
      .select('id, resolved_at').eq('id', req.params.conflictId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Conflito não encontrado.' });
    if (existing.resolved_at) return res.status(400).json({ error: 'Conflito já resolvido.' });

    const { error } = await sb.from('re_agenda_conflicts').update({
      resolved_at:      now,
      resolution_notes: resolution_notes || null,
    }).eq('id', req.params.conflictId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA METRICS (re_agenda_metrics)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agenda/metrics
 * Retorna métricas de agenda por período.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
router.get('/api/admin/agenda/metrics', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    const { data, error } = await sb.from('re_agenda_metrics')
      .select('*')
      .gte('period_start', from)
      .lte('period_end', to)
      .order('period_start', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Aggregate totals across periods
    const metrics = data || [];
    const totals = metrics.reduce((acc, m) => ({
      total_slots_created:  acc.total_slots_created  + (m.total_slots_created  || 0),
      total_bookings:       acc.total_bookings       + (m.total_bookings       || 0),
      confirmed_bookings:   acc.confirmed_bookings   + (m.confirmed_bookings   || 0),
      cancelled_bookings:   acc.cancelled_bookings   + (m.cancelled_bookings   || 0),
      no_show_count:        acc.no_show_count        + (m.no_show_count        || 0),
      total_credits_earned: acc.total_credits_earned + (m.total_credits_earned || 0),
    }), {
      total_slots_created: 0, total_bookings: 0, confirmed_bookings: 0,
      cancelled_bookings: 0, no_show_count: 0, total_credits_earned: 0,
    });

    const avgRatings = metrics.map(m => m.average_rating).filter(Boolean);
    totals.average_rating = avgRatings.length
      ? parseFloat((avgRatings.reduce((a, b) => a + b, 0) / avgRatings.length).toFixed(2))
      : null;

    res.json({ metrics, totals, period: { from, to } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
