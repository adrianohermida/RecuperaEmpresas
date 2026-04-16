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
    fetch('/api/agenda/slots',      { headers: authH() }),
    fetch('/api/credits/history',   { headers: authH() }),
  ]);

  if (slotsRes.ok) {
    const { slots, credits_balance } = await slotsRes.json();
    document.getElementById('creditsCount').textContent = credits_balance ?? 0;

    if (!slots.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Nenhum horário disponível no momento.<br><small>A equipe publicará novos horários em breve.</small></p>
      </div>`;
    } else {
      const bal = credits_balance ?? 0;
      el.innerHTML = `<div class="agenda-slot-list">
        ${slots.map(s => {
          const past    = new Date(s.starts_at) < new Date();
          const noSlots = !s.available && !s.my_booking;
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
                  ${s.location === 'presencial' ? '&nbsp;·&nbsp; 📍 Presencial' : '&nbsp;·&nbsp; 🔗 Online'}
                </div>
                ${s.meeting_link && s.my_booking_detail?.status === 'confirmed'
                  ? `<div class="agenda-slot-link-wrap"><a href="${s.meeting_link}" target="_blank" class="agenda-slot-link">🔗 Entrar na reunião</a></div>`
                  : ''}
              </div>
              ${(() => {
                const bd = s.my_booking_detail;
                if (!bd) {
                  if (noSlots) return '<span class="agenda-slot-status agenda-slot-status-full">Lotado</span>';
                  if (past)    return '<span class="agenda-slot-status agenda-slot-status-past">Encerrado</span>';
                  if (bal < s.credits_cost) return '<button onclick="buyCredits()" class="agenda-slot-action dashboard-slot-action-buy">Comprar créditos</button>';
                  return '<button onclick="bookSlot(\''+s.id+'\','+s.credits_cost+')" class="agenda-slot-action dashboard-slot-action-primary">Reservar</button>';
                }
                if (bd.status === 'pending')     return '<span class="dashboard-slot-status-pill dashboard-slot-status-pending">Aguardando confirmação</span>'
                  + '<button onclick="cancelBooking(\''+s.id+'\')" class="agenda-slot-action agenda-slot-action-delete">Cancelar</button>';
                if (bd.status === 'confirmed')   return '<span class="dashboard-slot-status-pill dashboard-slot-status-confirmed">✅ Confirmado</span>'
                  + (!past ? '<button onclick="cancelBooking(\''+s.id+'\')" class="agenda-slot-action agenda-slot-action-delete">Cancelar</button>' : '');
                if (bd.status === 'cancelled')   return '<span class="dashboard-slot-status-pill dashboard-slot-status-cancelled">Cancelado</span>';
                if (bd.status === 'rescheduled') return '<span class="dashboard-slot-status-pill dashboard-slot-status-rescheduled">Remarcado</span>';
                return '';
              })()}
            </div>
            ${s.my_booking_detail?.status === 'cancelled' && s.my_booking_detail?.cancel_reason ? `
              <div class="dashboard-slot-note dashboard-slot-note-cancelled">
                <strong>Cancelado pela consultoria:</strong> ${s.my_booking_detail.cancel_reason}
              </div>` : ''}
            ${s.my_booking_detail?.status === 'rescheduled' && s.my_booking_detail?.reschedule_reason ? `
              <div class="dashboard-slot-note dashboard-slot-note-rescheduled">
                <strong>Remarcado:</strong> ${s.my_booking_detail.reschedule_reason}
              </div>` : ''}
          </div>`;
        }).join('')}
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
          <span class="dashboard-credit-history-reason">${t.reason === 'purchase' ? 'Compra de créditos' : t.reason === 'booking' ? 'Sessão reservada' : t.reason === 'refund' ? 'Reembolso de cancelamento' : t.reason}</span>
          <span class="dashboard-credit-history-date">${new Date(t.created_at).toLocaleDateString('pt-BR')}</span>
          <span class="dashboard-credit-history-balance">${t.balance_after} crédito${t.balance_after !== 1 ? 's' : ''}</span>
        </div>`).join('')}
      </div>`;
    }
  }
}

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

async function cancelBooking(slotId) {
  const reason = prompt('Motivo do cancelamento (opcional — ajuda a consultoria a melhorar os horários):');
  if (reason === null) return;
  const cancelRes = await fetch(`/api/agenda/cancel-slot/${slotId}`, {
    method: 'DELETE', headers: authH(),
    body: JSON.stringify({ reason: reason.trim() || null }),
  });
  const j = await cancelRes.json();
  if (cancelRes.ok) { showToast('Reserva cancelada. Créditos devolvidos.', 'success'); loadAgendaSlots(); }
  else showToast(j.error || 'Erro ao cancelar.', 'error');
}

function buyCredits()        { toggleCreditsPanel(); }
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
