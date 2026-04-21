'use strict';
const router = require('express').Router();
const { sb, GOOGLE_CALENDAR_WEBHOOK_SECRET } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');
const { gcCreateEvent, gcPatchEvent, gcDeleteEvent, gcFreeBusy, computeFreeWindows, _gcAccessToken } = require('../lib/calendar');
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
  'external_contact', 'notes', 'no_show', 'created_at',
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
               reschedule_requested_slot_id,reschedule_requested_at,external_contact,notes,
               no_show,created_at,
               re_users(id,name,email,company),
               re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,duration_min)`)
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
      .select(`*,re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,calendar_event_id,duration_min),re_users(name,email,company)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Já confirmada.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Reserva cancelada.' });

    await sb.from('re_bookings').update({
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }).eq('id', booking.id);

    const slot    = booking.re_agenda_slots || {};
    const user    = booking.re_users        || {};
    const email   = user.email  || booking.external_contact?.email;
    const name    = user.name   || booking.external_contact?.name  || email;
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

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Cancel by admin ──────────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/cancel', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email)`)
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

    const slot  = booking.re_agenda_slots || {};
    const user  = booking.re_users        || {};
    const email = user.email || booking.external_contact?.email;
    const name  = user.name  || booking.external_contact?.name || email;

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

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reschedule by admin ──────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
  try {
    const { new_slot_id, reason } = req.body;
    if (!new_slot_id) return res.status(400).json({ error: 'new_slot_id é obrigatório.' });

    const { data: booking } = await sb.from('re_bookings')
      .select(`*,re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email,company)`)
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
      external_contact: booking.external_contact || null,
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

    const oldSlot = booking.re_agenda_slots || {};
    const user    = booking.re_users        || {};
    const email   = user.email || booking.external_contact?.email;
    const name    = user.name  || booking.external_contact?.name || email;

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

    res.json({ success: true, new_booking: newBooking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Approve client reschedule request ───────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/approve-reschedule', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,calendar_event_id),re_users(name,email,company)`)
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

    const oldSlot  = booking.re_agenda_slots || {};
    const user     = booking.re_users        || {};
    const email    = user.email || booking.external_contact?.email;
    const name     = user.name  || booking.external_contact?.name || email;

    sendBookingRescheduled({
      clientEmail: email, clientName: name,
      oldSlot,
      newSlot:     { ...newSlot, meet_link: newSlot.meet_link || newSlot.meeting_link },
      meetLink:    newSlot.meet_link || newSlot.meeting_link,
      bookerName:  booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reject client reschedule request ────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/reject-reschedule', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,re_agenda_slots(id,starts_at,title),re_users(name,email)`)
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
      clientEmail:  user.email || booking.external_contact?.email,
      clientName:   user.name  || booking.external_contact?.name,
      currentSlot:  booking.re_agenda_slots || { starts_at: booking.created_at },
      reason,
      bookerName:   booking.booker_name,
    }).catch(e => console.warn('[AgendaEmail]', e.message));

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Mark no-show ─────────────────────────────────────────────────────────────
router.put('/api/admin/agenda/bookings/:bookingId/no-show', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select(`*,re_agenda_slots(id,starts_at,title),re_users(name,email)`)
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

    await sb.from('re_bookings').update({
      no_show:    true,
      no_show_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const user = booking.re_users || {};
    sendNoShowAlert({
      clientName:  user.name  || booking.booker_name || booking.external_contact?.name,
      clientEmail: user.email || booking.external_contact?.email,
      slot:        booking.re_agenda_slots || { starts_at: booking.created_at, title: 'Consultoria' },
    }).catch(e => console.warn('[AgendaEmail]', e.message));

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
      user_id:          user_id || null,
      external_contact: !user_id ? external_contact : null,
      status:           'confirmed',
      confirmed_at:     new Date().toISOString(),
      credits_spent:    0,
      notes:            notes || null,
      booker_name:      userInfo?.name  || external_contact?.name  || null,
      booker_email:     userInfo?.email || external_contact?.email || null,
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
 * Logs the sync state so admin can take action.
 */
router.post('/api/admin/agenda/google-webhook', async (req, res) => {
  // Validate secret token
  const token = req.headers['x-goog-channel-token'];
  if (GOOGLE_CALENDAR_WEBHOOK_SECRET && token !== GOOGLE_CALENDAR_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const channelId   = req.headers['x-goog-channel-id'];
  const resourceId  = req.headers['x-goog-resource-id'];
  const state       = req.headers['x-goog-resource-state']; // 'sync' | 'exists' | 'not_exists'
  const expiration  = req.headers['x-goog-channel-expiration'];

  console.info(`[GCAL webhook] state=${state} channel=${channelId} expires=${expiration}`);

  // On 'exists' state → calendar changed, could trigger a re-sync of slots
  if (state === 'exists') {
    // Future: diff DB slots vs Calendar events and flag discrepancies
    // For now, just acknowledge
  }

  // Always respond 200 quickly to avoid Google retrying
  res.status(200).json({ ok: true });
});

// ─── Admin bookings summary per client ───────────────────────────────────────
router.get('/api/admin/agenda/client/:clientId/bookings', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await sb.from('re_bookings')
      .select(`id,slot_id,member_id,booker_name,booker_email,status,credits_spent,
               confirmed_at,cancel_reason,no_show,created_at,
               re_agenda_slots(id,starts_at,ends_at,title,location,meet_link,duration_min)`)
      .eq('user_id', req.params.clientId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ bookings: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
