'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth } = require('../lib/auth');
const { gcPatchEvent, gcFreeBusy, computeFreeWindows } = require('../lib/calendar');
const {
  sendBookingCreated,
  sendBookingCancelledByClient,
} = require('../lib/agenda-emails');
const {
  buildStatusEntry,
  appendStatusHistory,
  appendAttendee,
  recordConflict,
  updateMetrics,
} = require('../lib/agenda-helpers');

// ── Credit helpers (exported for use by admin-agenda.js) ─────────────────────
async function getCredits(userId) {
  const { data } = await sb.from('re_users').select('credits_balance').eq('id', userId).single();
  return data?.credits_balance ?? 0;
}

async function adjustCredits(userId, delta, reason, refId = null) {
  const current = await getCredits(userId);
  const newBal  = current + delta;
  await sb.from('re_users').update({ credits_balance: newBal }).eq('id', userId);
  await sb.from('re_credit_transactions').insert({
    user_id: userId, delta, reason, ref_id: refId, balance_after: newBal,
  });
  return newBal;
}

// ─── helper: resolve booker identity (owner or member) ───────────────────────
function bookerMeta(req) {
  // If the request comes from a company member, track their identity
  return {
    member_id:    req.user.member_id    || null,
    booker_name:  req.user.member_name  || req.user.name  || null,
    booker_email: req.user.member_email || req.user.email || null,
  };
}

// ─── GET /api/agenda/slots — list available slots for the client ──────────────
router.get('/api/agenda/slots', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const from   = req.query.from || new Date().toISOString();

  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings,location,meet_link,description')
    .gte('starts_at', from)
    .order('starts_at', { ascending: true })
    .limit(60);

  const slotIds = (slots || []).map(s => s.id);

  // Booking counts (pending + confirmed occupy a spot)
  let bookingCounts = {};
  if (slotIds.length) {
    const { data: counts } = await sb.from('re_bookings')
      .select('slot_id').in('slot_id', slotIds).in('status', ['pending', 'confirmed']);
    (counts || []).forEach(b => { bookingCounts[b.slot_id] = (bookingCounts[b.slot_id] || 0) + 1; });
  }

  // Client's own bookings for these slots (show pending/confirmed/reschedule states)
  const { data: myBookings } = await sb.from('re_bookings')
    .select(`id,slot_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,
             reschedule_reason,rescheduled_to_slot_id,reschedule_requested_slot_id,
             reschedule_requested_at,notes,member_id,booker_name,booker_email,created_at`)
    .eq('user_id', userId)
    .in('slot_id', slotIds.length ? slotIds : ['00000000-0000-0000-0000-000000000000'])
    .neq('status', 'rescheduled');

  const myBookingMap = {};
  (myBookings || []).forEach(b => { myBookingMap[b.slot_id] = b; });

  const credits = await getCredits(userId);

  const enriched = (slots || []).map(s => ({
    ...s,
    booked_count:      bookingCounts[s.id] || 0,
    available:         (bookingCounts[s.id] || 0) < s.max_bookings,
    my_booking:        !!myBookingMap[s.id],
    my_booking_detail: myBookingMap[s.id] || null,
  }));

  res.json({ slots: enriched, credits_balance: credits });
});

// ─── GET /api/agenda/available-slots — freebusy-filtered slots ───────────────
// Returns only slots that are both in re_agenda_slots AND free in Google Calendar
router.get('/api/agenda/available-slots', requireAuth, async (req, res) => {
  const from = req.query.from || new Date().toISOString();
  const days = Math.min(parseInt(req.query.days || '30'), 90);
  const to   = new Date(Date.now() + days * 86400_000).toISOString();

  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings,location,meet_link')
    .gte('starts_at', from).lte('starts_at', to)
    .order('starts_at', { ascending: true })
    .limit(100);

  const slotIds = (slots || []).map(s => s.id);
  let bookingCounts = {};
  if (slotIds.length) {
    const { data: counts } = await sb.from('re_bookings')
      .select('slot_id').in('slot_id', slotIds).in('status', ['pending', 'confirmed']);
    (counts || []).forEach(b => { bookingCounts[b.slot_id] = (bookingCounts[b.slot_id] || 0) + 1; });
  }

  // Fetch busy intervals from Google Calendar
  let busyIntervals = [];
  try { busyIntervals = await gcFreeBusy(from, to); } catch (_) {}

  const available = (slots || []).filter(s => {
    if ((bookingCounts[s.id] || 0) >= s.max_bookings) return false; // full
    // Check if slot overlaps a busy interval
    const ss = new Date(s.starts_at).getTime();
    const se = new Date(s.ends_at).getTime();
    const blocked = busyIntervals.some(b => {
      const bs = new Date(b.start).getTime();
      const be = new Date(b.end).getTime();
      return ss < be && se > bs; // overlap
    });
    return !blocked;
  });

  const credits = await getCredits(req.user.id);
  res.json({ slots: available, credits_balance: credits });
});

// ─── POST /api/agenda/book/:slotId — client books a slot ────────────────────
router.post('/api/agenda/book/:slotId', requireAuth, async (req, res) => {
  const userId  = req.user.id;
  const { slotId } = req.params;
  const { notes }  = req.body;

  const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slotId).single();
  if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
  if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Horário já passou.' });

  const { count } = await sb.from('re_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId).in('status', ['pending', 'confirmed']);
  if ((count || 0) >= slot.max_bookings) return res.status(400).json({ error: 'Horário lotado.' });

  const { data: dup } = await sb.from('re_bookings')
    .select('id').eq('slot_id', slotId).eq('user_id', userId)
    .neq('status', 'cancelled').maybeSingle();
  if (dup) return res.status(409).json({ error: 'Você já tem reserva neste horário.' });

  // ── Check for time-overlap with another confirmed booking of the same user ──
  const { data: userSlots } = await sb.from('re_bookings')
    .select('slot:re_agenda_slots!slot_id(starts_at,ends_at,duration_min)')
    .eq('user_id', userId)
    .in('status', ['pending', 'confirmed']);
  const slotStart = new Date(slot.starts_at).getTime();
  const slotEnd   = new Date(slot.ends_at || new Date(slot.starts_at).getTime() + (slot.duration_min || 60) * 60000).getTime();
  const hasOverlap = (userSlots || []).some(b => {
    if (!b.slot) return false;
    const bs = new Date(b.slot.starts_at).getTime();
    const be = new Date(b.slot.ends_at || bs + (b.slot.duration_min || 60) * 60000).getTime();
    return slotStart < be && slotEnd > bs;
  });
  if (hasOverlap) return res.status(409).json({ error: 'Você já possui uma reserva em horário conflitante.' });

  const credits = await getCredits(userId);
  if (credits < slot.credits_cost) return res.status(402).json({
    error: `Créditos insuficientes. Necessário: ${slot.credits_cost}, disponível: ${credits}.`,
    credits_needed: slot.credits_cost - credits,
  });

  const { member_id, booker_name, booker_email } = bookerMeta(req);

  const { data: booking, error } = await sb.from('re_bookings').insert({
    slot_id:      slotId,
    user_id:      userId,
    status:       'pending',
    credits_spent: slot.credits_cost,
    notes:        notes || null,
    member_id,
    booker_name,
    booker_email,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const newBal = await adjustCredits(userId, -slot.credits_cost, 'booking_pending', booking.id);

  // Email via centralized template
  sendBookingCreated({
    clientEmail: req.user.email,
    clientName:  req.user.name || req.user.email,
    slot,
    bookerName:  booker_name,
  }).catch(e => console.warn('[AgendaEmail]', e.message));

  res.json({ success: true, booking, credits_balance: newBal });
});

// ─── DELETE /api/agenda/book/:bookingId — client cancels a booking ────────────
router.delete('/api/agenda/book/:bookingId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};

  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('id', req.params.bookingId).eq('user_id', userId).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (['cancelled', 'rescheduled'].includes(booking.status))
    return res.status(400).json({ error: 'Reserva já cancelada.' });

  const { data: slot } = await sb.from('re_agenda_slots')
    .select('*').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date())
    return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status:        'cancelled',
    cancelled_by:  'client',
    cancel_reason: reason || null,
    updated_at:    new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  // Restore Google Calendar event label (read event_id from DB)
  if (slot?.calendar_event_id) {
    gcPatchEvent(slot.calendar_event_id, {
      summary:   `[Disponível] ${slot.title || 'Consultoria'} — Recupera Empresas`,
      attendees: [],
    }).catch(e => console.warn('[GCAL cancel]', e.message));
  }

  sendBookingCancelledByClient({
    clientName:  req.user.name || req.user.email,
    clientEmail: req.user.email,
    slot:        slot || { starts_at: booking.created_at, title: 'Consultoria' },
    reason,
    bookerName:  booking.booker_name,
  }).catch(e => console.warn('[AgendaEmail]', e.message));

  res.json({ success: true, credits_balance: newBal });
});

// ─── DELETE /api/agenda/cancel-slot/:slotId — cancel by slot id (convenience) -
router.delete('/api/agenda/cancel-slot/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};

  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('slot_id', req.params.slotId).eq('user_id', userId)
    .in('status', ['pending', 'confirmed']).maybeSingle();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const { data: slot } = await sb.from('re_agenda_slots')
    .select('*').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date())
    return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status:        'cancelled',
    cancelled_by:  'client',
    cancel_reason: reason || null,
    updated_at:    new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  if (slot?.calendar_event_id) {
    gcPatchEvent(slot.calendar_event_id, {
      summary:   `[Disponível] ${slot.title || 'Consultoria'} — Recupera Empresas`,
      attendees: [],
    }).catch(e => console.warn('[GCAL cancel]', e.message));
  }

  sendBookingCancelledByClient({
    clientName:  req.user.name || req.user.email,
    clientEmail: req.user.email,
    slot:        slot || { starts_at: booking.created_at, title: 'Consultoria' },
    reason,
    bookerName:  booking.booker_name,
  }).catch(e => console.warn('[AgendaEmail]', e.message));

  res.json({ success: true, credits_balance: newBal });
});

// ─── POST /api/agenda/book/:bookingId/request-reschedule ─────────────────────
// Client requests to move to a different slot (admin must approve)
router.post('/api/agenda/book/:bookingId/request-reschedule', requireAuth, async (req, res) => {
  const userId = req.user.id;
  // Accept both snake_case (frontend) and camelCase for compatibility
  const targetSlotId = req.body.new_slot_id || req.body.newSlotId;
  const reason       = req.body.reason || null;
  if (!targetSlotId) return res.status(400).json({ error: 'new_slot_id é obrigatório.' });

  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('id', req.params.bookingId).eq('user_id', userId).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (!['pending', 'confirmed'].includes(booking.status))
    return res.status(400).json({ error: 'Reserva não pode ser remarcada neste status.' });

  const { data: newSlot } = await sb.from('re_agenda_slots').select('*').eq('id', targetSlotId).single();
  if (!newSlot) return res.status(404).json({ error: 'Horário solicitado não encontrado.' });
  if (new Date(newSlot.starts_at) < new Date())
    return res.status(400).json({ error: 'O horário solicitado já passou.' });

  // Store reason in notes if provided (no dedicated column yet)
  const notesUpdate = reason
    ? `${booking.notes ? booking.notes + '\n' : ''}[Motivo remarcação]: ${reason}`
    : booking.notes;

  await sb.from('re_bookings').update({
    status:                        'pending_reschedule',
    reschedule_requested_slot_id:  targetSlotId,
    reschedule_requested_at:       new Date().toISOString(),
    reschedule_reject_reason:      null,
    notes:                         notesUpdate,
    updated_at:                    new Date().toISOString(),
  }).eq('id', booking.id);

  const { data: currentSlot } = await sb.from('re_agenda_slots')
    .select('*').eq('id', booking.slot_id).single();

  const { sendRescheduleRequested } = require('../lib/agenda-emails');
  sendRescheduleRequested({
    clientName:    req.user.name || req.user.email,
    clientEmail:   req.user.email,
    currentSlot:   currentSlot || { starts_at: booking.created_at },
    requestedSlot: newSlot,
    bookerName:    booking.booker_name,
  }).catch(e => console.warn('[AgendaEmail]', e.message));

  res.json({ success: true, status: 'pending_reschedule' });
});


// ─── POST /api/agenda/book/:bookingId/feedback — client submits feedback ──────
router.post('/api/agenda/book/:bookingId/feedback', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rating, comment } = req.body;

    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating deve ser um número entre 1 e 5.' });
    }

    // Only the booking owner can submit feedback
    const { data: booking } = await sb.from('re_bookings')
      .select('id, status, user_id, feedback_submitted_at, slot_id')
      .eq('id', req.params.bookingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (!['confirmed', 'rescheduled', 'no_show'].includes(booking.status) && booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Feedback só pode ser enviado para reservas confirmadas ou encerradas.' });
    }
    if (booking.feedback_submitted_at) {
      return res.status(409).json({ error: 'Feedback já enviado para esta reserva.' });
    }

    // Verify the slot has already passed (only allow feedback after the session)
    const { data: slot } = await sb.from('re_agenda_slots')
      .select('starts_at, ends_at, title').eq('id', booking.slot_id).maybeSingle();
    if (slot && new Date(slot.ends_at || slot.starts_at) > new Date()) {
      return res.status(400).json({ error: 'Feedback só pode ser enviado após o término da sessão.' });
    }

    const now = new Date().toISOString();
    const { error } = await sb.from('re_bookings').update({
      feedback_rating:       rating,
      feedback_comment:      comment ? String(comment).trim().slice(0, 2000) : null,
      feedback_submitted_at: now,
      updated_at:            now,
    }).eq('id', booking.id);

    if (error) return res.status(500).json({ error: error.message });

    // Update metrics with the new rating
    updateMetrics(sb, null, { rating })
      .catch(e => console.warn('[agenda-helpers]', e.message));

    res.json({ success: true });
  } catch (e) {
    console.error('[FEEDBACK]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/agenda/book/:bookingId/feedback — get feedback status ───────────
router.get('/api/agenda/book/:bookingId/feedback', requireAuth, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select('id, status, feedback_rating, feedback_comment, feedback_submitted_at, slot_id')
      .eq('id', req.params.bookingId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

    const { data: slot } = await sb.from('re_agenda_slots')
      .select('starts_at, ends_at, title').eq('id', booking.slot_id).maybeSingle();

    const sessionEnded = slot ? new Date(slot.ends_at || slot.starts_at) < new Date() : true;

    res.json({
      booking_id:            booking.id,
      status:                booking.status,
      feedback_submitted:    !!booking.feedback_submitted_at,
      feedback_rating:       booking.feedback_rating || null,
      feedback_comment:      booking.feedback_comment || null,
      feedback_submitted_at: booking.feedback_submitted_at || null,
      can_submit_feedback:   sessionEnded && !booking.feedback_submitted_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/credits/history ─────────────────────────────────────────────────
router.get('/api/credits/history', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_credit_transactions')
    .select('*').eq('user_id', req.user.id)
    .order('created_at', { ascending: false }).limit(50);
  const balance = await getCredits(req.user.id);
  res.json({ transactions: data || [], balance });
});

// ─── POST /api/credits/checkout — Stripe credit pack purchase ─────────────────
router.post('/api/credits/checkout', requireAuth, async (req, res) => {
  const { STRIPE_SECRET_KEY, BASE_URL: BASE } = require('../lib/config');
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Pagamentos não configurados.' });

  const PACKS = {
    '1':  { credits: 1,  price_brl: 29700 },
    '3':  { credits: 3,  price_brl: 79700 },
    '5':  { credits: 5,  price_brl: 119700 },
    '10': { credits: 10, price_brl: 197000 },
  };
  const { pack = '1', success_url, cancel_url } = req.body;
  const chosen = PACKS[String(pack)];
  if (!chosen) return res.status(400).json({ error: 'Pacote inválido. Opções: 1, 3, 5, 10.' });

  const Stripe   = require('stripe');
  const stripe   = Stripe(STRIPE_SECRET_KEY);
  const user     = req.user;
  let customerId = user.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name || user.email });
    customerId = customer.id;
    await sb.from('re_users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer:   customerId,
    mode:       'payment',
    line_items: [{
      price_data: {
        currency:     'brl',
        unit_amount:  chosen.price_brl,
        product_data: { name: `${chosen.credits} crédito${chosen.credits > 1 ? 's' : ''} de consultoria` },
      },
      quantity: 1,
    }],
    metadata:    { user_id: user.id, credits: String(chosen.credits) },
    success_url: success_url || `${BASE}/dashboard?credits=success`,
    cancel_url:  cancel_url  || `${BASE}/dashboard?credits=cancel`,
  });

  res.json({ url: session.url, session_id: session.id });
});

module.exports = router;
module.exports.getCredits    = getCredits;
module.exports.adjustCredits = adjustCredits;
