'use strict';
/**
 * lib/agenda-emails.js
 *
 * Centralized email templates for all agenda/booking lifecycle events.
 * All functions return a Promise (fire-and-forget via .catch()).
 *
 * Event types covered:
 *  1. booking_created       — client booked, waiting for confirmation
 *  2. booking_confirmed     — admin confirmed + Google Meet link
 *  3. booking_cancelled_by_client  — client cancelled
 *  4. booking_cancelled_by_admin   — admin cancelled + credit refund
 *  5. booking_rescheduled          — admin rescheduled to new slot
 *  6. booking_reschedule_requested — client requested reschedule
 *  7. booking_reschedule_rejected  — admin rejected client's reschedule request
 *  8. booking_reminder_24h         — 24h reminder
 *  9. booking_reminder_1h          — 1h reminder
 * 10. booking_no_show              — client no-show (admin notification)
 */

const { sendMail, emailWrapper, emailFactRow, emailFactTable } = require('./email');
const { EMAIL_TO, BASE_URL } = require('./config');

const ADMIN_EMAIL = EMAIL_TO || 'contato@recuperaempresas.com.br';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function addToCalendarLink({ title, start, end, description, location }) {
  const fmt = iso => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const p   = new URLSearchParams({
    action:   'TEMPLATE',
    text:     title || 'Reunião Recupera Empresas',
    dates:    `${fmt(start)}/${fmt(end)}`,
    details:  description || '',
    location: location || 'Online',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function meetButton(meetLink) {
  if (!meetLink) return '';
  return `
    <div style="text-align:center;margin:24px 0;">
      <a href="${meetLink}"
         style="background:#1A56DB;color:#fff;padding:12px 28px;border-radius:8px;
                text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Entrar na Reunião (Google Meet)
      </a>
    </div>`;
}

function calButton(calLink) {
  if (!calLink) return '';
  return `
    <div style="text-align:center;margin:12px 0 24px;">
      <a href="${calLink}"
         style="background:#fff;color:#1A56DB;padding:10px 24px;border-radius:8px;
                text-decoration:none;font-weight:500;font-size:14px;display:inline-block;
                border:1.5px solid #1A56DB;">
        + Adicionar ao Google Calendar
      </a>
    </div>`;
}

// ─── 1. booking_created ───────────────────────────────────────────────────────
async function sendBookingCreated({ clientEmail, clientName, slot, bookerName }) {
  const name = bookerName || clientName || 'Cliente';
  const html = emailWrapper('Solicitação de Agendamento Recebida', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Recebemos sua solicitação de reunião. Nossa equipe irá confirmar em breve.</p>
    ${emailFactTable(
      emailFactRow('Assunto',   slot.title || 'Consultoria') +
      emailFactRow('Data',      fmtDate(slot.starts_at)) +
      emailFactRow('Duração',   `${slot.duration_min || 60} minutos`) +
      emailFactRow('Modalidade', slot.location || 'Online') +
      emailFactRow('Status',    '<span style="color:#D97706;font-weight:600;">Aguardando confirmação</span>')
    )}
    <p style="color:#6B7280;font-size:13px;">
      Você receberá uma confirmação por e-mail assim que a reunião for agendada.
    </p>
  `);
  const adminHtml = emailWrapper('Nova Solicitação de Agendamento', `
    <p>Uma nova solicitação foi recebida.</p>
    ${emailFactTable(
      emailFactRow('Cliente',  clientName || clientEmail) +
      emailFactRow('E-mail',   clientEmail) +
      (bookerName && bookerName !== clientName ? emailFactRow('Solicitado por', bookerName) : '') +
      emailFactRow('Assunto',  slot.title || 'Consultoria') +
      emailFactRow('Data',     fmtDate(slot.starts_at))
    )}
    <p><a href="${BASE_URL}/admin">Abrir painel admin →</a></p>
  `);

  await Promise.all([
    clientEmail && sendMail(clientEmail, 'Solicitação de reunião recebida', html).catch(e => console.warn('[AgendaEmail]', e.message)),
    sendMail(ADMIN_EMAIL, `Nova solicitação: ${clientName || clientEmail}`, adminHtml).catch(e => console.warn('[AgendaEmail]', e.message)),
  ]);
}

// ─── 2. booking_confirmed ─────────────────────────────────────────────────────
async function sendBookingConfirmed({ clientEmail, clientName, slot, meetLink, bookerName }) {
  const name    = bookerName || clientName || 'Cliente';
  const calLink = addToCalendarLink({
    title:       slot.title || 'Reunião Recupera Empresas',
    start:       slot.starts_at,
    end:         slot.ends_at,
    description: meetLink ? `Link da reunião: ${meetLink}` : '',
    location:    meetLink || slot.location || 'Online',
  });

  const html = emailWrapper('Reunião Confirmada ✓', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Sua reunião foi <strong style="color:#059669;">confirmada</strong>. Até lá!</p>
    ${emailFactTable(
      emailFactRow('Assunto',   slot.title || 'Consultoria') +
      emailFactRow('Data',      fmtDate(slot.starts_at)) +
      emailFactRow('Duração',   `${slot.duration_min || 60} minutos`) +
      emailFactRow('Modalidade', slot.location || 'Online') +
      (meetLink ? emailFactRow('Link Meet', `<a href="${meetLink}">${meetLink}</a>`) : '')
    )}
    ${meetLink  ? meetButton(meetLink) : ''}
    ${calButton(calLink)}
    <p style="color:#6B7280;font-size:13px;">
      Você receberá um lembrete 24h e 1h antes da reunião.
    </p>
  `);

  const adminHtml = emailWrapper('Reunião Confirmada', `
    <p>Reunião confirmada com sucesso.</p>
    ${emailFactTable(
      emailFactRow('Cliente', clientName || clientEmail) +
      emailFactRow('Data',    fmtDate(slot.starts_at)) +
      (meetLink ? emailFactRow('Meet', `<a href="${meetLink}">${meetLink}</a>`) : '')
    )}
  `);

  await Promise.all([
    clientEmail && sendMail(clientEmail, 'Sua reunião foi confirmada!', html).catch(e => console.warn('[AgendaEmail]', e.message)),
    sendMail(ADMIN_EMAIL, `Reunião confirmada: ${clientName || clientEmail}`, adminHtml).catch(e => console.warn('[AgendaEmail]', e.message)),
  ]);
}

// ─── 3. booking_cancelled_by_client ──────────────────────────────────────────
async function sendBookingCancelledByClient({ clientName, clientEmail, slot, reason, bookerName }) {
  const html = emailWrapper('Reunião Cancelada pelo Cliente', `
    <p>A reunião abaixo foi cancelada pelo cliente.</p>
    ${emailFactTable(
      emailFactRow('Cliente', clientName || clientEmail) +
      emailFactRow('Data',    fmtDate(slot.starts_at)) +
      emailFactRow('Assunto', slot.title || 'Consultoria') +
      (reason ? emailFactRow('Motivo', reason) : '')
    )}
  `);
  await sendMail(ADMIN_EMAIL, `Cancelamento: ${clientName || clientEmail}`, html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 4. booking_cancelled_by_admin ───────────────────────────────────────────
async function sendBookingCancelledByAdmin({ clientEmail, clientName, slot, reason, creditsRefunded, bookerName }) {
  if (!clientEmail) return;
  const name = bookerName || clientName || 'Cliente';
  const html = emailWrapper('Reunião Cancelada', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Infelizmente, a reunião abaixo precisou ser cancelada.</p>
    ${emailFactTable(
      emailFactRow('Assunto', slot.title || 'Consultoria') +
      emailFactRow('Data',    fmtDate(slot.starts_at)) +
      (reason ? emailFactRow('Motivo', reason) : '') +
      (creditsRefunded > 0 ? emailFactRow('Créditos devolvidos', `<strong style="color:#059669;">${creditsRefunded} crédito(s)</strong>`) : '')
    )}
    <p>Pedimos desculpas pelo inconveniente. Se desejar, acesse o portal para agendar um novo horário.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${BASE_URL}/dashboard?section=agenda"
         style="background:#1A56DB;color:#fff;padding:12px 28px;border-radius:8px;
                text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Reagendar
      </a>
    </div>
  `);
  await sendMail(clientEmail, 'Sua reunião foi cancelada', html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 5. booking_rescheduled (by admin) ────────────────────────────────────────
async function sendBookingRescheduled({ clientEmail, clientName, oldSlot, newSlot, meetLink, bookerName }) {
  if (!clientEmail) return;
  const name    = bookerName || clientName || 'Cliente';
  const calLink = addToCalendarLink({
    title:    newSlot.title || 'Reunião Recupera Empresas',
    start:    newSlot.starts_at,
    end:      newSlot.ends_at,
    location: meetLink || newSlot.location || 'Online',
  });
  const html = emailWrapper('Reunião Remarcada', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Sua reunião foi <strong>remarcada</strong> para um novo horário.</p>
    ${emailFactTable(
      emailFactRow('Data anterior', `<s style="color:#9CA3AF;">${fmtDate(oldSlot.starts_at)}</s>`) +
      emailFactRow('Nova data',     `<strong style="color:#059669;">${fmtDate(newSlot.starts_at)}</strong>`) +
      emailFactRow('Duração',       `${newSlot.duration_min || 60} minutos`) +
      (meetLink ? emailFactRow('Link Meet', `<a href="${meetLink}">${meetLink}</a>`) : '')
    )}
    ${meetLink ? meetButton(meetLink) : ''}
    ${calButton(calLink)}
  `);
  await sendMail(clientEmail, 'Sua reunião foi remarcada', html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 6. booking_reschedule_requested (by client) ─────────────────────────────
async function sendRescheduleRequested({ clientName, clientEmail, currentSlot, requestedSlot, bookerName }) {
  const html = emailWrapper('Solicitação de Remarcação', `
    <p>O cliente <strong>${clientName || clientEmail}</strong> solicitou a remarcação da reunião abaixo.</p>
    ${emailFactTable(
      emailFactRow('Cliente',       clientName || clientEmail) +
      (bookerName && bookerName !== clientName ? emailFactRow('Solicitado por', bookerName) : '') +
      emailFactRow('Data atual',    fmtDate(currentSlot.starts_at)) +
      emailFactRow('Nova data pedida', `<strong>${fmtDate(requestedSlot.starts_at)}</strong>`)
    )}
    <p>Acesse o painel para aprovar ou rejeitar.</p>
    <a href="${BASE_URL}/admin">Abrir admin →</a>
  `);
  await sendMail(ADMIN_EMAIL, `Pedido de remarcação: ${clientName || clientEmail}`, html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 7. booking_reschedule_rejected ──────────────────────────────────────────
async function sendRescheduleRejected({ clientEmail, clientName, currentSlot, reason, bookerName }) {
  if (!clientEmail) return;
  const name = bookerName || clientName || 'Cliente';
  const html = emailWrapper('Pedido de Remarcação Não Aprovado', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Infelizmente, não foi possível aprovar sua solicitação de remarcação.</p>
    ${emailFactTable(
      emailFactRow('Reunião mantida em', fmtDate(currentSlot.starts_at)) +
      (reason ? emailFactRow('Motivo', reason) : '')
    )}
    <p>Sua reunião original permanece confirmada no horário indicado.</p>
  `);
  await sendMail(clientEmail, 'Pedido de remarcação não aprovado', html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 8. booking_reminder_24h ──────────────────────────────────────────────────
async function sendReminder24h({ clientEmail, clientName, slot, meetLink, bookerName }) {
  if (!clientEmail) return;
  const name = bookerName || clientName || 'Cliente';
  const html = emailWrapper('Lembrete: Reunião Amanhã', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Você tem uma reunião marcada para <strong>amanhã</strong>.</p>
    ${emailFactTable(
      emailFactRow('Assunto', slot.title || 'Consultoria') +
      emailFactRow('Data',    fmtDate(slot.starts_at)) +
      emailFactRow('Duração', `${slot.duration_min || 60} minutos`) +
      (meetLink ? emailFactRow('Link Meet', `<a href="${meetLink}">${meetLink}</a>`) : '')
    )}
    ${meetLink ? meetButton(meetLink) : ''}
  `);
  const adminHtml = emailWrapper('Lembrete: Reunião Amanhã', `
    <p>Lembrete automático enviado para <strong>${clientName || clientEmail}</strong>.</p>
    ${emailFactTable(emailFactRow('Data', fmtDate(slot.starts_at)))}
  `);
  await Promise.all([
    sendMail(clientEmail, `Lembrete: sua reunião é amanhã às ${new Date(slot.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`, html).catch(e => console.warn('[AgendaEmail]', e.message)),
    sendMail(ADMIN_EMAIL, `Lembrete enviado: ${clientName || clientEmail}`, adminHtml).catch(e => console.warn('[AgendaEmail]', e.message)),
  ]);
}

// ─── 9. booking_reminder_1h ───────────────────────────────────────────────────
async function sendReminder1h({ clientEmail, clientName, slot, meetLink, bookerName }) {
  if (!clientEmail) return;
  const name = bookerName || clientName || 'Cliente';
  const html = emailWrapper('Sua Reunião Começa em 1 Hora', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Sua reunião começa <strong>em 1 hora</strong>. Prepare-se!</p>
    ${emailFactTable(
      emailFactRow('Assunto', slot.title || 'Consultoria') +
      emailFactRow('Início',  fmtDate(slot.starts_at)) +
      (meetLink ? emailFactRow('Link Meet', `<a href="${meetLink}">${meetLink}</a>`) : '')
    )}
    ${meetLink ? meetButton(meetLink) : ''}
  `);
  await sendMail(clientEmail, 'Sua reunião começa em 1 hora!', html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

// ─── 10. booking_no_show ──────────────────────────────────────────────────────
async function sendNoShowAlert({ clientName, clientEmail, slot }) {
  const html = emailWrapper('Não Comparecimento', `
    <p>O cliente <strong>${clientName || clientEmail}</strong> não compareceu à reunião.</p>
    ${emailFactTable(
      emailFactRow('Cliente', clientName || clientEmail) +
      emailFactRow('Data',    fmtDate(slot.starts_at)) +
      emailFactRow('Assunto', slot.title || 'Consultoria')
    )}
    <p>O booking foi marcado como <strong>no-show</strong> automaticamente.</p>
  `);
  await sendMail(ADMIN_EMAIL, `No-show: ${clientName || clientEmail}`, html)
    .catch(e => console.warn('[AgendaEmail]', e.message));
}

module.exports = {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingCancelledByClient,
  sendBookingCancelledByAdmin,
  sendBookingRescheduled,
  sendRescheduleRequested,
  sendRescheduleRejected,
  sendReminder24h,
  sendReminder1h,
  sendNoShowAlert,
};
