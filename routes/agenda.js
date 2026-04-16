'use strict';
const router = require('express').Router();
const { sb, EMAIL_TO } = require('../lib/config');
const { requireAuth } = require('../lib/auth');
const { emailWrapper, emailFactTable, emailFactRow, emailStyle, sendMail } = require('../lib/email');
const { gcPatchEvent } = require('../lib/calendar');

// ─── In-memory: calendar event IDs ───────────────────────────────────────────
const _calendarEventIds = new Map(); // slotId → googleCalendarEventId

// ── Credit helpers ────────────────────────────────────────────────────────────
async function getCredits(userId) {
  const { data } = await sb.from('re_users').select('credits_balance').eq('id', userId).single();
  return data?.credits_balance ?? 0;
}

async function adjustCredits(userId, delta, reason, refId = null) {
  const current = await getCredits(userId);
  const newBal  = current + delta;
  await sb.from('re_users').update({ credits_balance: newBal }).eq('id', userId);
  await sb.from('re_credit_transactions').insert({
    user_id: userId, delta, reason, ref_id: refId, balance_after: newBal
  });
  return newBal;
}

// ── Client: view available slots + own balance ────────────────────────────────
router.get('/api/agenda/slots', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const from = req.query.from || new Date().toISOString();
  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings,location,meeting_link')
    .gte('starts_at', from)
    .order('starts_at', { ascending: true })
    .limit(60);

  // Count active bookings per slot (pending + confirmed only)
  const slotIds = (slots||[]).map(s => s.id);
  let bookingCounts = {};
  if (slotIds.length) {
    const { data: counts } = await sb.from('re_bookings')
      .select('slot_id').in('slot_id', slotIds)
      .in('status', ['pending', 'confirmed']);
    (counts||[]).forEach(b => { bookingCounts[b.slot_id] = (bookingCounts[b.slot_id]||0) + 1; });
  }

  // Client's own bookings — full detail for status display
  const { data: myBookings } = await sb.from('re_bookings')
    .select('id,slot_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,notes,created_at')
    .eq('user_id', userId)
    .in('slot_id', slotIds.length ? slotIds : ['00000000-0000-0000-0000-000000000000'])
    .neq('status', 'rescheduled'); // hide superseded bookings
  const myBookingMap = {};
  (myBookings||[]).forEach(b => { myBookingMap[b.slot_id] = b; });

  const credits = await getCredits(userId);

  const enriched = (slots||[]).map(s => ({
    ...s,
    booked_count: bookingCounts[s.id] || 0,
    available: (bookingCounts[s.id] || 0) < s.max_bookings,
    my_booking: !!myBookingMap[s.id],
    my_booking_detail: myBookingMap[s.id] || null,
  }));

  res.json({ slots: enriched, credits_balance: credits });
});

// ── Client: book a slot (spend credits) ──────────────────────────────────────
router.post('/api/agenda/book/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { slotId } = req.params;
  const { notes } = req.body;

  const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slotId).single();
  if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
  if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Horário já passou.' });

  // Check capacity
  const { count } = await sb.from('re_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId).neq('status', 'cancelled');
  if ((count||0) >= slot.max_bookings) return res.status(400).json({ error: 'Horário lotado.' });

  // Check duplicate
  const { data: dup } = await sb.from('re_bookings')
    .select('id').eq('slot_id', slotId).eq('user_id', userId).neq('status', 'cancelled').single();
  if (dup) return res.status(409).json({ error: 'Você já tem reserva neste horário.' });

  // Check credits
  const credits = await getCredits(userId);
  if (credits < slot.credits_cost) return res.status(402).json({
    error: `Créditos insuficientes. Necessário: ${slot.credits_cost}, disponível: ${credits}.`,
    credits_needed: slot.credits_cost - credits
  });

  const { data: booking, error } = await sb.from('re_bookings').insert({
    slot_id: slotId, user_id: userId,
    status: 'pending', credits_spent: slot.credits_cost, notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Deduct credits immediately (refunded if consultant rejects)
  const newBal = await adjustCredits(userId, -slot.credits_cost, 'booking_pending', booking.id);

  // Emails
  const startsAtFmt = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const clientName = req.user.name || req.user.email;

  sendMail(req.user.email, 'Solicitação de agendamento recebida — Recupera Empresas', emailWrapper(
    'Solicitação de agendamento recebida',
    `<p>Olá, <b>${clientName}</b>!</p>
     <p>Sua solicitação foi recebida e está <b>aguardando confirmação</b> do consultor.</p>
     ${emailFactTable([
       emailFactRow('Sessão', slot.title || 'Consultoria'),
       emailFactRow('Data e hora', startsAtFmt),
       emailFactRow('Créditos reservados', slot.credits_cost),
     ].join(''))}
     <p ${emailStyle('factValue', 'font-size:13px;color:#F59E0B')}>⏳ Você receberá um e-mail assim que o consultor confirmar.</p>`
  )).catch(e => console.warn('[async]', e?.message));

  sendMail(EMAIL_TO, `[Novo Agendamento] ${clientName} — ${startsAtFmt}`, emailWrapper(
    'Nova solicitação de agendamento',
    `<p><b>${clientName}</b> (${req.user.company || '—'}) solicitou um agendamento.</p>
     <p><b>Sessão:</b> ${slot.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
      <p ${emailStyle('metaText', 'margin-top:0')}>Acesse o painel do consultor → Agenda para confirmar, remarcar ou cancelar.</p>`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, booking, credits_balance: newBal });
});

// ── Client: cancel a booking (refund credits) ────────────────────────────────
router.delete('/api/agenda/book/:bookingId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('id', req.params.bookingId).eq('user_id', userId).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (['cancelled','rescheduled'].includes(booking.status)) return res.status(400).json({ error: 'Reserva já cancelada.' });

  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at,title').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status: 'cancelled', cancelled_by: 'client',
    cancel_reason: reason || null, updated_at: new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  // Restore calendar slot
  const evId = _calendarEventIds.get(booking.slot_id);
  if (evId) {
    gcPatchEvent(evId, {
      summary: `[Disponível] ${slot?.title || 'Consultoria'} — Recupera Empresas`,
      attendees: [],
    }).catch(e => console.warn('[async]', e?.message));
  }

  // Notify admin
  const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  sendMail(EMAIL_TO, `[Cancelamento] ${req.user.name || req.user.email} — ${startsAtFmt}`, emailWrapper(
    'Agendamento cancelado pelo cliente',
    `<p><b>${req.user.name || req.user.email}</b> cancelou o agendamento.</p>
     <p><b>Sessão:</b> ${slot?.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
     ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, credits_balance: newBal });
});

// ── Client: credit history ────────────────────────────────────────────────────
router.get('/api/credits/history', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_credit_transactions')
    .select('*').eq('user_id', req.user.id)
    .order('created_at', { ascending: false }).limit(50);
  const balance = await getCredits(req.user.id);
  res.json({ transactions: data || [], balance });
});

// ── Stripe: create checkout session to purchase credits ───────────────────────
router.post('/api/credits/checkout', requireAuth, async (req, res) => {
  const { STRIPE_SECRET_KEY, BASE_URL: BASE } = require('../lib/config');
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Pagamentos não configurados.' });

  const PACKS = {
    '1':  { credits: 1,  price_brl: 29700 },   // R$ 297
    '3':  { credits: 3,  price_brl: 79700 },   // R$ 797
    '5':  { credits: 5,  price_brl: 119700 },  // R$ 1.197
    '10': { credits: 10, price_brl: 197000 },  // R$ 1.970
  };
  const { pack = '1', success_url, cancel_url } = req.body;
  const chosen = PACKS[String(pack)];
  if (!chosen) return res.status(400).json({ error: 'Pacote inválido. Opções: 1, 3, 5, 10.' });

  const Stripe = require('stripe');
  const stripe = Stripe(STRIPE_SECRET_KEY);
  const user   = req.user;

  // Ensure Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name || user.email });
    customerId = customer.id;
    await sb.from('re_users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer:    customerId,
    mode:        'payment',
    line_items:  [{
      price_data: {
        currency:     'brl',
        unit_amount:  chosen.price_brl,
        product_data: { name: `${chosen.credits} crédito${chosen.credits > 1 ? 's' : ''} de consultoria` },
      },
      quantity: 1,
    }],
    metadata: { user_id: user.id, credits: String(chosen.credits) },
    success_url: success_url || `${BASE}/dashboard.html?credits=success`,
    cancel_url:  cancel_url  || `${BASE}/dashboard.html?credits=cancel`,
  });

  res.json({ url: session.url, session_id: session.id });
});

// Client: cancel booking by slot id (convenience — finds booking then delegates)
router.delete('/api/agenda/cancel-slot/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('slot_id', req.params.slotId).eq('user_id', userId)
    .in('status', ['pending','confirmed']).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at,title').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status: 'cancelled', cancelled_by: 'client',
    cancel_reason: reason || null, updated_at: new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  sendMail(EMAIL_TO, `[Cancelamento] ${req.user.name || req.user.email} — ${startsAtFmt}`, emailWrapper(
    'Agendamento cancelado pelo cliente',
    `<p><b>${req.user.name || req.user.email}</b> cancelou o agendamento.</p>
     <p><b>Sessão:</b> ${slot?.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
     ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, credits_balance: newBal });
});

module.exports = router;
module.exports._calendarEventIds = _calendarEventIds;
module.exports.getCredits = getCredits;
module.exports.adjustCredits = adjustCredits;
