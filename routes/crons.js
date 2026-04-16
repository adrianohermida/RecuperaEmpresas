'use strict';

const express = require('express');

const { EMAIL_TO, JWT_SECRET, sb } = require('../lib/config');
const { findUserById } = require('../lib/db');
const {
  sendMail,
  emailFactRow,
  emailFactTable,
  emailStyle,
  emailWrapper,
} = require('../lib/email');

const router = express.Router();

function isAuthorizedCronRequest(req) {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  return secret === (process.env.CRON_SECRET || JWT_SECRET);
}

router.post('/api/cron/booking-reminders', async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const from = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,title,starts_at,meeting_link')
    .gte('starts_at', from)
    .lte('starts_at', to);

  if (!slots?.length) return res.json({ sent: 0 });

  const slotIds = slots.map((slot) => slot.id);
  const { data: bookings } = await sb.from('re_bookings')
    .select('id,user_id,slot_id,reminder_sent')
    .in('slot_id', slotIds)
    .eq('status', 'confirmed')
    .neq('reminder_sent', true);

  if (!bookings?.length) return res.json({ sent: 0 });

  const { data: externalBookings } = await sb.from('re_bookings')
    .select('id,slot_id,external_contact,reminder_sent')
    .in('slot_id', slotIds)
    .eq('status', 'confirmed')
    .neq('reminder_sent', true)
    .is('user_id', null);

  const allBookings = [...(bookings || []), ...(externalBookings || [])];
  if (!allBookings.length) return res.json({ sent: 0 });

  const slotMap = Object.fromEntries(slots.map((slot) => [slot.id, slot]));
  let sent = 0;

  for (const booking of allBookings) {
    const slot = slotMap[booking.slot_id];
    if (!slot) continue;

    let email;
    let name;
    let company;
    if (booking.user_id) {
      const user = await findUserById(booking.user_id);
      if (!user?.email) continue;
      email = user.email;
      name = user.name || user.email;
      company = user.company || '';
    } else if (booking.external_contact?.email) {
      email = booking.external_contact.email;
      name = booking.external_contact.name || email;
      company = booking.external_contact.company || '';
    } else {
      continue;
    }

    const startsAtFormatted = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const meetingLine = slot.meeting_link ? `<p><b>Link:</b> <a href="${slot.meeting_link}">${slot.meeting_link}</a></p>` : '';

    await sendMail(email, '⏰ Lembrete: sessão amanhã — Recupera Empresas', emailWrapper(
      'Lembrete de sessão — amanhã',
      `<p>Olá, <b>${name}</b>!</p>
       <p>Você tem uma sessão agendada para <b>amanhã</b>:</p>
       ${emailFactTable([
         emailFactRow('Sessão', slot.title || 'Consultoria'),
         emailFactRow('Data e hora', startsAtFormatted),
       ].join(''))}
       ${meetingLine}
       <p ${emailStyle('metaText', 'margin-top:0')}>Em caso de imprevistos, acesse o portal para cancelar com antecedência.</p>`
    )).catch((error) => console.warn('[async]', error?.message));

    sendMail(EMAIL_TO, `⏰ Lembrete: sessão amanhã — ${name}`, emailWrapper(
      'Lembrete de sessão',
      `<p>Lembrete: sessão confirmada para amanhã.</p>
       <p><b>Cliente:</b> ${name}${company ? ` — ${company}` : ''}<br>
          <b>Sessão:</b> ${slot.title || 'Consultoria'}<br>
          <b>Data:</b> ${startsAtFormatted}</p>
       ${meetingLine}`
    )).catch((error) => console.warn('[async]', error?.message));

    await sb.from('re_bookings').update({ reminder_sent: true }).eq('id', booking.id);
    sent += 1;
  }

  console.log(`[CRON] booking-reminders: ${sent} enviados`);
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