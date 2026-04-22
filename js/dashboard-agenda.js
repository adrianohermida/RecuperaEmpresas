'use strict';
/* dashboard-agenda.js — Agenda com créditos: horários, reservas, histórico */

const MONTH_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function fmtSlotDate(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')} ${MONTH_PT[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtSlotTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function loadAgendaSlots() {
  const el     = document.getElementById('slotsList');
  const histEl = document.getElementById('creditsHistory');
  if (!el) return;
  el.innerHTML = '<div class="dashboard-section-loading">Carregando...</div>';

  const [slotsRes, histRes] = await Promise.all([
    fetch('/api/agenda/slots',    { headers: authH() }),
    fetch('/api/credits/history', { headers: authH() }),
  ]);

  if (slotsRes.ok) {
    const { slots, credits_balance } = await slotsRes.json();
    document.getElementById('creditsCount').textContent = credits_balance ?? 0;

    if (!slots.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>Nenhum horário disponível no momento.<br><small>A equipe publicará novos horários em breve.</small></p>
      </div>`;
    } else {
      const bal = credits_balance ?? 0;
      el.innerHTML = `<div class="agenda-slot-list">
        ${slots.map(s => _renderClientSlotCard(s, bal)).join('')}
      </div>`;
    }
  }

  if (histRes.ok && histEl) {
    const { transactions } = await histRes.json();
    if (!transactions.length) {
      histEl.innerHTML = '<div class="dashboard-credit-history-empty">Nenhuma movimentação ainda.</div>';
    } else {
      histEl.innerHTML = `<div class="dashboard-credit-history-list">
        ${transactions.slice(0, 10).map(t => `
        <div class="dashboard-credit-history-row">
          <span class="dashboard-credit-history-delta ${t.delta > 0 ? 'dashboard-credit-history-delta-positive' : 'dashboard-credit-history-delta-negative'}">${t.delta > 0 ? '+' : ''}${t.delta}</span>
          <span class="dashboard-credit-history-reason">${
            t.reason === 'purchase'  ? 'Compra de créditos' :
            t.reason === 'booking'   ? 'Sessão reservada'   :
            t.reason === 'refund'    ? 'Reembolso de cancelamento' : t.reason
          }</span>
          <span class="dashboard-credit-history-date">${new Date(t.created_at).toLocaleDateString('pt-BR')}</span>
          <span class="dashboard-credit-history-balance">${t.balance_after} crédito${t.balance_after !== 1 ? 's' : ''}</span>
        </div>`).join('')}
      </div>`;
    }
  }
}

function _renderClientSlotCard(s, bal) {
  const past    = new Date(s.starts_at) < new Date();
  const noSlots = !s.available && !s.my_booking;
  const bd      = s.my_booking_detail;
  // Support both old (meeting_link) and new (meet_link) column names
  const meetUrl = s.meet_link || s.meeting_link || null;

  // ─── action area ────────────────────────────────────────────────────────────
  let actionArea = '';
  if (!bd) {
    if (noSlots) {
      actionArea = '<span class="agenda-slot-status agenda-slot-status-full">Lotado</span>';
    } else if (past) {
      actionArea = '<span class="agenda-slot-status agenda-slot-status-past">Encerrado</span>';
    } else if (bal < s.credits_cost) {
      actionArea = `<button onclick="buyCredits()" class="agenda-slot-action dashboard-slot-action-buy">Comprar créditos</button>`;
    } else {
      actionArea = `<button onclick="bookSlot('${s.id}',${s.credits_cost})" class="agenda-slot-action dashboard-slot-action-primary">Reservar</button>`;
    }
  } else if (bd.status === 'pending') {
    actionArea = `
      <span class="dashboard-slot-status-pill dashboard-slot-status-pending">Aguardando confirmação</span>
      <button onclick="cancelBooking('${s.id}')" class="agenda-slot-action agenda-slot-action-delete">Cancelar</button>`;
  } else if (bd.status === 'confirmed') {
    actionArea = `<span class="dashboard-slot-status-pill dashboard-slot-status-confirmed">✅ Confirmado</span>`;
    if (!past) {
      actionArea += `
        <button onclick="requestReschedule('${s.id}','${bd.id}')" class="agenda-slot-action dashboard-slot-action-reschedule">↕️ Remarcar</button>
        <button onclick="cancelBooking('${s.id}')" class="agenda-slot-action agenda-slot-action-delete">Cancelar</button>`;
    }
  } else if (bd.status === 'pending_reschedule') {
    actionArea = `
      <span class="dashboard-slot-status-pill dashboard-slot-status-reschedule">⏳ Remarcação solicitada</span>
      <button onclick="cancelBooking('${s.id}')" class="agenda-slot-action agenda-slot-action-delete">Cancelar</button>`;
  } else if (bd.status === 'cancelled') {
    actionArea = '<span class="dashboard-slot-status-pill dashboard-slot-status-cancelled">Cancelado</span>';
  } else if (bd.status === 'rescheduled') {
    actionArea = '<span class="dashboard-slot-status-pill dashboard-slot-status-rescheduled">Remarcado</span>';
  } else if (bd.status === 'no_show') {
    actionArea = '<span class="dashboard-slot-status-pill dashboard-slot-status-cancelled">Não compareceu</span>';
  }
  // ── Feedback button for past confirmed/no_show bookings ──────────────────────
  if (past && bd?.id && ['confirmed', 'no_show', 'rescheduled'].includes(bd.status)) {
    if (bd.feedback_submitted_at) {
      const stars = '★'.repeat(bd.feedback_rating || 0) + '☆'.repeat(5 - (bd.feedback_rating || 0));
      actionArea += `<span class="dashboard-slot-feedback-done" title="Avaliação enviada" style="color:#f59e0b;font-size:16px;margin-left:8px">${stars}</span>`;
    } else {
      actionArea += `<button onclick="openFeedbackModal('${bd.id}')" class="agenda-slot-action dashboard-slot-action-feedback" style="background:#f59e0b;color:#fff;border:none">⭐ Avaliar sessão</button>`;
    }
  }

  // ─── notes ──────────────────────────────────────────────────────────────────
  let noteBanner = '';
  if (bd?.status === 'cancelled' && bd.cancel_reason) {
    noteBanner = `<div class="dashboard-slot-note dashboard-slot-note-cancelled"><strong>Cancelado pela consultoria:</strong> ${bd.cancel_reason}</div>`;
  } else if (bd?.status === 'rescheduled' && bd.reschedule_reason) {
    noteBanner = `<div class="dashboard-slot-note dashboard-slot-note-rescheduled"><strong>Remarcado:</strong> ${bd.reschedule_reason}</div>`;
  } else if (bd?.status === 'pending_reschedule') {
    noteBanner = `<div class="dashboard-slot-note dashboard-slot-note-reschedule">Sua solicitação de remarcação está em análise. A consultoria responderá em breve.</div>`;
  }

  return `
  <div class="agenda-slot-card${past ? ' agenda-slot-card-past' : ''}${s.my_booking ? ' dashboard-slot-card-booked' : ''}">
    <div class="agenda-slot-header">
      <div class="agenda-slot-date-card${s.my_booking ? ' dashboard-slot-date-card-booked' : ''}">
        <div class="agenda-slot-day">${new Date(s.starts_at).getDate()}</div>
        <div class="agenda-slot-month">${MONTH_PT[new Date(s.starts_at).getMonth()]}</div>
      </div>
      <div class="agenda-slot-main">
        <div class="agenda-slot-title">${s.title}</div>
        <div class="agenda-slot-meta">
          ${fmtSlotTime(s.starts_at)} – ${fmtSlotTime(s.ends_at)} &nbsp;·&nbsp; ${s.duration_min}min
          &nbsp;·&nbsp; ${s.credits_cost} crédito${s.credits_cost > 1 ? 's' : ''}
          ${s.location === 'presencial' ? '&nbsp;·&nbsp; 📍 Presencial' : '&nbsp;·&nbsp; 🖥 Online'}
        </div>
        ${meetUrl && bd?.status === 'confirmed'
          ? `<div class="agenda-slot-link-wrap"><a href="${meetUrl}" target="_blank" class="agenda-slot-link">🔗 Entrar na reunião</a></div>`
          : ''}
      </div>
      ${actionArea}
    </div>
    ${noteBanner}
  </div>`;
}

// ─── Book slot ───────────────────────────────────────────────────────────────

async function bookSlot(slotId, cost) {
  if (!confirm(`Reservar esta sessão usando ${cost} crédito${cost > 1 ? 's' : ''}?`)) return;
  const res = await fetch(`/api/agenda/book/${slotId}`, {
    method: 'POST', headers: authH(), body: JSON.stringify({}),
  });
  const j = await res.json();
  if (res.ok) {
    showToast('Solicitação enviada! Aguardando confirmação da consultoria.', 'success');
    document.getElementById('creditsCount').textContent = j.credits_balance;
    loadAgendaSlots();
  } else {
    showToast(j.error || 'Erro ao reservar.', 'error');
    if (j.credits_needed) setTimeout(() => buyCredits(), 800);
  }
}

// ─── Cancel booking ──────────────────────────────────────────────────────────

async function cancelBooking(slotId) {
  const reason = prompt('Motivo do cancelamento (opcional — ajuda a consultoria a melhorar os horários):');
  if (reason === null) return;
  const res = await fetch(`/api/agenda/cancel-slot/${slotId}`, {
    method: 'DELETE', headers: authH(),
    body: JSON.stringify({ reason: reason.trim() || null }),
  });
  const j = await res.json();
  if (res.ok) { showToast('Reserva cancelada. Créditos devolvidos.', 'success'); loadAgendaSlots(); }
  else showToast(j.error || 'Erro ao cancelar.', 'error');
}

// ─── Request reschedule (client → admin) ─────────────────────────────────────

async function requestReschedule(slotId, bookingId) {
  // Fetch available (free) slots from the freebusy-aware endpoint
  const res = await fetch('/api/agenda/available-slots', { headers: authH() });
  const j   = res.ok ? await res.json() : {};
  const futureSlots = (j.slots || []).filter(s => s.id !== slotId && new Date(s.starts_at) > new Date() && s.available);

  if (!futureSlots.length) {
    showToast('Nenhum outro horário disponível no momento. Tente novamente em breve.', 'error');
    return;
  }

  // Build modal
  const modal = document.createElement('div');
  modal.id = 'rescheduleRequestModal';
  modal.className = 'admin-modal-overlay admin-modal-overlay-high';
  modal.innerHTML = `
    <div class="admin-modal agenda-modal-card agenda-modal-card-md">
      <div class="agenda-modal-title">↕️ Solicitar remarcação</div>
      <div class="agenda-modal-subtitle" style="color:#64748B;font-size:13px;margin-bottom:16px">
        Escolha o novo horário desejado e informe o motivo. A consultoria analisará e confirmará a troca.
      </div>
      <label class="agenda-modal-label">Novo horário desejado *</label>
      <select id="rrSlotSelect" class="portal-select agenda-modal-field" style="margin-bottom:12px">
        ${futureSlots.map(s => {
          const sd = new Date(s.starts_at), ed = new Date(s.ends_at);
          const pad = n => String(n).padStart(2,'0');
          return `<option value="${s.id}">${sd.toLocaleDateString('pt-BR')} ${pad(sd.getHours())}:${pad(sd.getMinutes())}–${pad(ed.getHours())}:${pad(ed.getMinutes())} · ${s.title}</option>`;
        }).join('')}
      </select>
      <label class="agenda-modal-label">Motivo *</label>
      <textarea id="rrReason" rows="3" placeholder="Ex.: Conflito de agenda, compromisso inadiável…"
        class="portal-input agenda-modal-field agenda-modal-textarea" style="margin-bottom:16px"></textarea>
      <div class="admin-modal-actions agenda-modal-actions-tight">
        <button onclick="document.getElementById('rescheduleRequestModal').remove()" class="btn-ghost admin-modal-btn">Cancelar</button>
        <button onclick="_submitRescheduleRequest('${bookingId}')" class="btn-primary admin-modal-btn">Solicitar remarcação</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function _submitRescheduleRequest(bookingId) {
  const newSlotId = document.getElementById('rrSlotSelect').value;
  const reason    = document.getElementById('rrReason').value.trim();
  if (!reason) { showToast('O motivo é obrigatório.', 'error'); return; }

  const res = await fetch(`/api/agenda/book/${bookingId}/request-reschedule`, {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ new_slot_id: newSlotId, reason }),
  });
  const j = await res.json();
  if (res.ok) {
    document.getElementById('rescheduleRequestModal')?.remove();
    showToast('Solicitação enviada! Aguardando aprovação da consultoria.', 'success');
    loadAgendaSlots();
  } else {
    showToast(j.error || 'Erro ao solicitar remarcação.', 'error');
  }
}

// ─── Credits ─────────────────────────────────────────────────────────────────

function buyCredits()         { toggleCreditsPanel(); }
function toggleCreditsPanel() {
  document.getElementById('creditsBuyPanel').classList.toggle('ui-hidden');
}

async function checkoutCredits(pack) {
  const res = await fetch('/api/credits/checkout', {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ pack: String(pack) }),
  });
  const j = await res.json();
  if (j.url) window.location.href = j.url;
  else showToast(j.error || 'Erro ao iniciar pagamento.', 'error');
}

// ─── Feedback modal ─────────────────────────────────────────────────────────────────────────────────

let _feedbackSelectedRating = 0;

function openFeedbackModal(bookingId) {
  _feedbackSelectedRating = 0;
  const modal = document.createElement('div');
  modal.id = 'feedbackModal';
  modal.className = 'admin-modal-overlay admin-modal-overlay-high';
  modal.innerHTML = `
    <div class="admin-modal agenda-modal-card agenda-modal-card-md">
      <div class="agenda-modal-title">⭐ Avaliar sessão</div>
      <div class="agenda-modal-subtitle" style="color:#64748B;font-size:13px;margin-bottom:16px">
        Sua avaliação é anônima e ajuda a melhorar o serviço.
      </div>
      <div id="feedbackStars" style="font-size:32px;cursor:pointer;margin-bottom:16px;text-align:center">
        ${'<span onclick="_setFeedbackRating(' + 1 + ')" data-star="1">☆</span>' +
          '<span onclick="_setFeedbackRating(' + 2 + ')" data-star="2">☆</span>' +
          '<span onclick="_setFeedbackRating(' + 3 + ')" data-star="3">☆</span>' +
          '<span onclick="_setFeedbackRating(' + 4 + ')" data-star="4">☆</span>' +
          '<span onclick="_setFeedbackRating(' + 5 + ')" data-star="5">☆</span>'}
      </div>
      <label class="agenda-modal-label">Comentário (opcional)</label>
      <textarea id="feedbackComment" rows="3" placeholder="Conte como foi sua experiência..."
        class="portal-input agenda-modal-field agenda-modal-textarea" style="margin-bottom:16px"></textarea>
      <div class="admin-modal-actions agenda-modal-actions-tight">
        <button onclick="document.getElementById('feedbackModal').remove()" class="btn-ghost admin-modal-btn">Cancelar</button>
        <button onclick="_submitFeedback('${bookingId}')" class="btn-primary admin-modal-btn">Enviar avaliação</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _setFeedbackRating(rating) {
  _feedbackSelectedRating = rating;
  const stars = document.querySelectorAll('#feedbackStars span');
  stars.forEach((s, i) => { s.textContent = i < rating ? '★' : '☆'; });
}

async function _submitFeedback(bookingId) {
  if (!_feedbackSelectedRating) { showToast('Selecione uma nota de 1 a 5 estrelas.', 'error'); return; }
  const comment = document.getElementById('feedbackComment').value.trim();
  const res = await fetch(`/api/agenda/book/${bookingId}/feedback`, {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ rating: _feedbackSelectedRating, comment: comment || null }),
  });
  const j = await res.json();
  if (res.ok) {
    document.getElementById('feedbackModal')?.remove();
    showToast('Obrigado pela sua avaliação!', 'success');
    loadAgendaSlots();
  } else {
    showToast(j.error || 'Erro ao enviar avaliação.', 'error');
  }
}

console.info('[RE:dashboard-agenda] loaded');
