'use strict';

var STEP_TITLES = {
  1: 'LGPD', 2: 'Empresa', 3: 'Sócios', 4: 'Operacional', 5: 'Funcionários', 6: 'Ativos',
  7: 'Financeiro', 8: 'Dívidas', 9: 'Histórico da Crise', 10: 'Diagnóstico',
  11: 'Mercado', 12: 'Expectativas', 13: 'Documentos', 14: 'Confirmação'
};

var CHAPTER_STATUS = {
  pendente: { label: 'Aguardando dados', cls: 'badge-gray' },
  em_elaboracao: { label: 'Em elaboração', cls: 'badge-blue' },
  aguardando: { label: 'Aguardando cliente', cls: 'badge-amber' },
  em_revisao: { label: 'Em revisão', cls: 'badge-purple' },
  aprovado: { label: 'Aprovado', cls: 'badge-green' },
};

var STATUS_LABELS = {
  nao_iniciado: { label: 'Não iniciado', cls: 'badge-gray' },
  em_andamento: { label: 'Em andamento', cls: 'badge-blue' },
  concluido: { label: 'Concluído', cls: 'badge-green' },
};

var APPT_TYPES = {
  diagnostico: 'Diagnóstico inicial',
  revisao: 'Revisão do Business Plan',
  financeiro: 'Análise financeira',
  estrategia: 'Planejamento estratégico',
  outro: 'Outro',
};

function getToken() {
  if (window.REShared?.getStoredToken) return window.REShared.getStoredToken();
  return localStorage.getItem('re_token');
}

function authH() {
  if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() };
}

async function logout() {
  if (window.REShared?.logoutSession) {
    await window.REShared.logoutSession();
  } else if (window.REShared?.clearStoredAuth) {
    window.REShared.clearStoredAuth();
  } else {
    ['re_token', 're_user'].forEach(key => localStorage.removeItem(key));
  }
  window.REShared.redirectToRoute('login');
}

function showToast(msg, type, ms) {
  var toast = document.getElementById('toast');
  var duration = typeof ms === 'number' ? ms : 3000;
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show ' + (type || '');
  setTimeout(function () { toast.className = 'toast'; }, duration);
}

function readAdminResponse(response) {
  if (window.REShared?.readResponse) return window.REShared.readResponse(response);
  if (window.readApiResponse) return window.readApiResponse(response);
  return response.json().catch(function () { return {}; });
}

function isFreshchatEnabled() {
  return !!(window.RE_ENABLE_FRESHCHAT && window.RE_FRESHCHAT_TOKEN && window.RE_FRESHCHAT_SITE_ID);
}

function toggleSidebar() {
  var sidebar = document.getElementById('appSidebar');
  var backdrop = document.getElementById('sidebarBackdrop');
  var isOpen = sidebar?.classList.contains('mobile-open');
  sidebar?.classList.toggle('mobile-open', !isOpen);
  backdrop?.classList.toggle('open', !isOpen);
}

function closeSidebar() {
  document.getElementById('appSidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.remove('open');
}

function toggleUserDropup() {
  var dropup = document.getElementById('userDropup');
  var btn = document.getElementById('userMenuBtn');
  var isOpen = dropup?.classList.contains('open');
  dropup?.classList.toggle('open', !isOpen);
  btn?.setAttribute('aria-expanded', String(!isOpen));
}

document.addEventListener('click', function (e) {
  var footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.contains(e.target)) {
    var dropup = document.getElementById('userDropup');
    var btn = document.getElementById('userMenuBtn');
    if (dropup?.classList.contains('open')) {
      dropup.classList.remove('open');
      btn?.setAttribute('aria-expanded', 'false');
    }
  }
});

function showSection(name, el) {
  window.REAdminModal?.init?.();
  window.REAdminModal?.closeAll?.({ reason: 'show-section:' + name });
  // Close any open overlay modals before switching sections
  document.querySelectorAll('.admin-modal-overlay').forEach(function (m) {
    m.classList.add('ui-hidden');
  });
  document.querySelectorAll('.tab-content').forEach(function (section) { section.classList.remove('active'); });
  document.querySelectorAll('.sidebar-link').forEach(function (link) { link.classList.remove('active'); });
  document.getElementById('sec-' + name)?.classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'logs') loadLogs();
  if (name === 'agenda') loadAdminAgenda();
  if (name === 'financeiro') loadAdminFinanceiro();
  if (name === 'formularios') loadFormBuilder();
  if (name === 'adminInvoices') loadAdminInvoices();
  if (name === 'adminMarketplace') loadAdminMarketplace();
  if (name === 'auditlog') loadAuditLog();
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

var _allClients = [];

function filterClients() {
  var query = (document.getElementById('clientSearch')?.value || '').toLowerCase();
  var filtered = _allClients.filter(function (client) {
    return (client.company || '').toLowerCase().includes(query)
      || (client.name || '').toLowerCase().includes(query)
      || (client.email || '').toLowerCase().includes(query);
  });
  renderClientTable(filtered);
}

var _unreadMsgs = {};

function renderClientTable(clients) {
  var tbody = document.getElementById('clientTableBody');
  if (!tbody) return;
  if (!clients.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="admin-client-empty-cell">Nenhum cliente encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = clients.map(function (client) {
    var status = STATUS_LABELS[client.status] || STATUS_LABELS.nao_iniciado;
    var progress = client.completed ? 100 : client.progress;
    var lastActivity = client.lastActivity ? new Date(client.lastActivity).toLocaleDateString('pt-BR') : '—';
    var unread = _unreadMsgs[client.id] || 0;
    var msgBadge = unread
      ? '<span class="badge badge-red admin-unread-pulse">' + unread + '</span>'
      : '<span class="admin-client-empty-dash">—</span>';
    return `<tr onclick="openClient('${client.id}')">
      <td>
        <div class="company-cell">${client.company || client.name}</div>
        <div class="email-cell">${client.email}</div>
      </td>
      <td><span class="badge ${status.cls}">${status.label}</span></td>
      <td>
        <div class="admin-client-progress-wrap">
          <div class="mini-progress"><div class="mini-progress-fill" data-progress="${progress}"></div></div>
          <span class="admin-client-progress-value">${progress}%</span>
        </div>
      </td>
      <td class="admin-client-meta">${client.step}/14</td>
      <td class="admin-client-meta">${lastActivity}</td>
      <td>${client.pendingTasks ? `<span class="badge badge-amber">${client.pendingTasks}</span>` : '<span class="admin-client-empty-dash">—</span>'}</td>
      <td>${msgBadge}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.mini-progress-fill').forEach(function (bar) {
    window.REShared.applyPercentClass(bar, bar.dataset.progress || 0);
  });
}

console.info('[RE:admin-shell-core] loaded');
