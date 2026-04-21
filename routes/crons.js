'use strict';

const express = require('express');

const { JWT_SECRET, sb } = require('../lib/config');
const { findUserById } = require('../lib/db');
const {
  sendReminder24h,
  sendReminder1h,
} = require('../lib/agenda-emails');

const router = express.Router();

function isAuthorizedCronRequest(req) {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  return secret === (process.env.CRON_SECRET || JWT_SECRET);
}

// ─── helper: resolve client identity from booking ─────────────────────────────
async function resolveBookingIdentity(booking) {
  if (booking.user_id) {
    const user = await findUserById(booking.user_id);
    if (!user?.email) return null;
    return { email: user.email, name: user.name || user.email };
  }
  if (booking.external_contact?.email) {
    return {
      email: booking.external_contact.email,
      name:  booking.external_contact.name || booking.external_contact.email,
    };
  }
  // booker_email / booker_name stored directly on booking (new schema)
  if (booking.booker_email) {
    return { email: booking.booker_email, name: booking.booker_name || booking.booker_email };
  }
  return null;
}

// ─── helper: fetch confirmed bookings in a time window ────────────────────────
async function fetchConfirmedBookingsInWindow(fromMs, toMs, reminderField) {
  const from = new Date(fromMs).toISOString();
  const to   = new Date(toMs).toISOString();

  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,title,starts_at,meet_link,meeting_link,ends_at')
    .gte('starts_at', from)
    .lte('starts_at', to);

  if (!slots?.length) return { slots: [], bookings: [] };

  const slotIds  = slots.map(s => s.id);
  const notSent  = reminderField === 'reminder_sent'
    ? sb.from('re_bookings').select('id,user_id,slot_id,booker_name,booker_email,external_contact,reminder_sent').in('slot_id', slotIds).eq('status', 'confirmed').neq('reminder_sent', true)
    : sb.from('re_bookings').select('id,user_id,slot_id,booker_name,booker_email,external_contact,reminder_1h_sent').in('slot_id', slotIds).eq('status', 'confirmed').neq('reminder_1h_sent', true);

  const { data: bookings } = await notSent;
  return { slots, bookings: bookings || [] };
}

// ─── POST /api/cron/booking-reminders  (24 h) ─────────────────────────────────
router.post('/api/cron/booking-reminders', async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { slots, bookings } = await fetchConfirmedBookingsInWindow(
    Date.now() + 23 * 3600_000,
    Date.now() + 25 * 3600_000,
    'reminder_sent',
  );

  if (!bookings.length) return res.json({ sent: 0 });

  const slotMap = Object.fromEntries(slots.map(s => [s.id, s]));
  let sent = 0;

  for (const booking of bookings) {
    const slot     = slotMap[booking.slot_id];
    if (!slot) continue;
    const identity = await resolveBookingIdentity(booking);
    if (!identity) continue;

    const slotPayload = {
      title:    slot.title || 'Consultoria',
      startsAt: slot.starts_at,
      endsAt:   slot.ends_at,
      meetLink: slot.meet_link || slot.meeting_link || null,
    };

    await sendReminder24h({
      clientEmail: identity.email,
      clientName:  identity.name,
      slot:        slotPayload,
      meetLink:    slotPayload.meetLink,
    }).catch(e => console.warn('[CRON 24h]', e?.message));

    await sb.from('re_bookings').update({ reminder_sent: true }).eq('id', booking.id);
    sent += 1;
  }

  console.log(`[CRON] booking-reminders (24h): ${sent} enviados`);
  res.json({ sent });
});

// ─── POST /api/cron/booking-reminders-1h  (1 h) ───────────────────────────────
router.post('/api/cron/booking-reminders-1h', async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { slots, bookings } = await fetchConfirmedBookingsInWindow(
    Date.now() + 55 * 60_000,
    Date.now() + 65 * 60_000,
    'reminder_1h_sent',
  );

  if (!bookings.length) return res.json({ sent: 0 });

  const slotMap = Object.fromEntries(slots.map(s => [s.id, s]));
  let sent = 0;

  for (const booking of bookings) {
    const slot     = slotMap[booking.slot_id];
    if (!slot) continue;
    const identity = await resolveBookingIdentity(booking);
    if (!identity) continue;

    const slotPayload = {
      title:    slot.title || 'Consultoria',
      startsAt: slot.starts_at,
      endsAt:   slot.ends_at,
      meetLink: slot.meet_link || slot.meeting_link || null,
    };

    await sendReminder1h({
      clientEmail: identity.email,
      clientName:  identity.name,
      slot:        slotPayload,
      meetLink:    slotPayload.meetLink,
    }).catch(e => console.warn('[CRON 1h]', e?.message));

    await sb.from('re_bookings').update({ reminder_1h_sent: true }).eq('id', booking.id);
    sent += 1;
  }

  console.log(`[CRON] booking-reminders (1h): ${sent} enviados`);
  res.json({ sent });
});

router.post('/api/cron/invoice-overdue', async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: overdueInvoices } = await sb.from('re_invoices')
    .select('id,user_id,description,amount_cents,due_date')
    .eq('status', 'pending')
    .lt('due_date', today);

  let marked = 0;
  for (const invoice of overdueInvoices || []) {
    await sb.from('re_invoices').update({ status: 'overdue' }).eq('id', invoice.id);
    const user = await findUserById(invoice.user_id);
    if (user?.email) {
      const dueFormatted = new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('pt-BR');
      const amountFormatted = 'R$ ' + (invoice.amount_cents / 100).toFixed(2).replace('.', ',');
      sendMail(user.email, 'Fatura vencida — Recupera Empresas', emailWrapper(
        'Fatura em atraso',
        `<p>Olá, <b>${user.name || user.email}</b>!</p>
         <p>Sua fatura está em atraso:</p>
         ${emailFactTable([
           emailFactRow('Descrição', invoice.description),
           emailFactRow('Valor', amountFormatted, 'color:#DC2626'),
           emailFactRow('Vencimento', dueFormatted),
         ].join(''))}
         <p>Entre em contato com nossa equipe para regularizar.</p>`
      )).catch((error) => console.warn('[async]', error?.message));
    }
    marked += 1;
  }

  if (marked > 0) {
    sendMail(EMAIL_TO, `[Financeiro] ${marked} fatura(s) vencida(s) hoje`, emailWrapper(
      'Faturas vencidas',
      `<p>${marked} fatura(s) venceu/venceram hoje (${today}) e foram marcadas como em atraso.</p>`
    )).catch((error) => console.warn('[async]', error?.message));
  }

  console.log(`[CRON] invoice-overdue: ${marked} marcadas`);
  res.json({ marked });
});

module.exports = router;