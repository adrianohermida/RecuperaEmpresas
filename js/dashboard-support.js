'use strict';
/* dashboard-support.js — Suporte: chamados Freshdesk */

const FD_STATUS = {
  2: { label: 'Aberto',   cls: 'badge-blue'  },
  3: { label: 'Pendente', cls: 'badge-amber' },
  4: { label: 'Resolvido',cls: 'badge-green' },
  5: { label: 'Fechado',  cls: 'badge-gray'  },
};

function toggleNewTicketForm() {
  document.getElementById('newTicketCard').classList.toggle('ui-hidden');
}

async function loadSupport() {
  const el = document.getElementById('ticketList');
  el.innerHTML = '<div class="dashboard-section-loading">Carregando...</div>';
  const res = await fetch('/api/support/tickets', { headers: authH() });
  if (!res.ok) {
    el.innerHTML = '<div class="empty-state"><p>Erro ao carregar chamados.</p></div>';
    return;
  }
  const { tickets } = await res.json();
  if (!tickets || !tickets.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <p>Nenhum chamado encontrado. Clique em "Novo chamado" para abrir uma solicitação.</p>
    </div>`;
    return;
  }
  let html = '<div class="admin-table-wrap"><table class="admin-simple-table"><thead><tr>'
    + '<th>#</th><th>Assunto</th><th>Status</th><th>Criado em</th>'
    + '</tr></thead><tbody>';
  tickets.forEach(t => {
    const st = FD_STATUS[t.status] || { label: 'Desconhecido', cls: 'badge-gray' };
    html += `<tr>
      <td class="admin-log-muted">#${t.id}</td>
      <td class="dashboard-support-subject">${t.subject || '-'}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td class="admin-log-muted">${t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '-'}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function submitTicket() {
  const subject = document.getElementById('ticketSubject').value.trim();
  const desc    = document.getElementById('ticketDesc').value.trim();
  if (!subject) { showToast('Informe o assunto do chamado.', 'error'); return; }

  const res = await fetch('/api/support/ticket', {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ subject, description: desc }),
  });
  const json = await dashboardReadResponse(res);
  if (json.success) {
    showToast('Chamado aberto com sucesso!', 'success');
    document.getElementById('ticketSubject').value = '';
    document.getElementById('ticketDesc').value = '';
    toggleNewTicketForm();
    loadSupport();
  } else {
    showToast(json.error || 'Erro ao abrir chamado.', 'error');
  }
}
console.info('[RE:dashboard-support] loaded');
