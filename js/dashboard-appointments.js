'use strict';
/* dashboard-appointments.js — Agendamento de reuniões */

const APPT_TYPES = {
  diagnostico: 'Diagnóstico inicial',
  revisao:     'Revisão do Business Plan',
  financeiro:  'Análise financeira',
  estrategia:  'Planejamento estratégico',
  outro:       'Outro',
};

function toggleApptForm() {
  const card = document.getElementById('apptFormCard');
  if (!card) return;
  const willShow = card.classList.contains('dashboard-hidden-card');
  card.classList.toggle('dashboard-hidden-card');
  if (willShow) {
    document.getElementById('apptDate').min = new Date().toISOString().split('T')[0];
  }
}

async function loadAppointments() {
  const el = document.getElementById('apptList');
  el.innerHTML = '<div class="dashboard-appt-loading">Carregando...</div>';
  const res = await fetch('/api/appointments', { headers: authH() });
  if (!res.ok) {
    el.innerHTML = '<div class="empty-state"><p>Erro ao carregar agenda.</p></div>';
    return;
  }
  const { appointments } = await res.json();
  if (!appointments || !appointments.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <p>Nenhuma reunião agendada. Clique em "Agendar reunião" para solicitar uma.</p>
    </div>`;
    return;
  }
  const now = new Date();
  const upcoming = appointments
    .filter(a => new Date(a.date + 'T' + (a.time || '23:59')) >= now)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = appointments
    .filter(a => new Date(a.date + 'T' + (a.time || '23:59')) < now)
    .sort((a, b) => b.date.localeCompare(a.date));

  let html = '';
  if (upcoming.length) {
    html += '<div class="dashboard-appt-group">';
    upcoming.forEach(a => {
      const st = a.status === 'confirmado' ? { label: 'Confirmada', cls: 'badge-green' }
               : a.status === 'cancelado'  ? { label: 'Cancelada',  cls: 'badge-red'   }
               : { label: 'Solicitada', cls: 'badge-amber' };
      html += apptCard(a, st);
    });
    html += '</div>';
  }
  if (past.length) {
    html += '<div class="dashboard-appt-history-title">Histórico</div>';
    past.slice(0, 5).forEach(a => {
      const st = a.status === 'confirmado' ? { label: 'Realizada', cls: 'badge-green' }
               : a.status === 'cancelado'  ? { label: 'Cancelada', cls: 'badge-red'   }
               : { label: 'Expirada', cls: 'badge-gray' };
      html += apptCard(a, st, true);
    });
  }
  el.innerHTML = html || `<div class="empty-state"><p>Nenhuma reunião agendada.</p></div>`;
}

function apptCard(a, st, muted = false) {
  const dateStr = new Date(a.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `<div class="dashboard-appt-card">
    <div class="dashboard-appt-date ${muted ? 'dashboard-appt-date-muted' : ''}">
      <div class="dashboard-appt-day">${new Date(a.date + 'T12:00:00').getDate()}</div>
      <div class="dashboard-appt-month">${new Date(a.date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' })}</div>
    </div>
    <div class="dashboard-appt-copy">
      <div class="dashboard-appt-title">${APPT_TYPES[a.type] || a.type}</div>
      <div class="dashboard-appt-meta">${dateStr}${a.time ? ' às ' + a.time : ''}</div>
      ${a.notes ? `<div class="dashboard-appt-notes">${a.notes}</div>` : ''}
    </div>
    <span class="badge ${st.cls}">${st.label}</span>
  </div>`;
}

async function submitAppt() {
  const date  = document.getElementById('apptDate').value;
  const time  = document.getElementById('apptTime').value;
  const type  = document.getElementById('apptType').value;
  const notes = document.getElementById('apptNotes').value.trim();
  if (!date) { showToast('Selecione a data.', 'error'); return; }

  const res = await fetch('/api/appointments', {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ date, time, type, notes }),
  });
  const json = await res.json();
  if (json.success) {
    showToast('Reunião solicitada! Aguarde confirmação da equipe.', 'success');
    document.getElementById('apptDate').value  = '';
    document.getElementById('apptTime').value  = '';
    document.getElementById('apptNotes').value = '';
    toggleApptForm();
    loadAppointments();
  } else {
    showToast(json.error || 'Erro ao agendar.', 'error');
  }
}
