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

function applyInitialAdminSearchQuery() {
  try {
    var query = new URLSearchParams(window.location.search).get('q') || '';
    if (!query) return;
    var input = document.getElementById('clientSearch');
    if (!input) return;
    input.value = query;
    if (typeof window.filterClients === 'function') {
      window.filterClients();
    }
  } catch (_error) {}
}

function getUserMenuShell() {
  return document.querySelector('[data-user-menu-shell]') || document.querySelector('.sidebar-footer');
}

function setUserDropupState(open, options) {
  var dropup = document.getElementById('userDropup');
  var btn = document.getElementById('userMenuBtn');
  var footer = getUserMenuShell();
  dropup?.classList.toggle('open', !!open);
  btn?.setAttribute('aria-expanded', String(!!open));
  footer?.classList.toggle('menu-open', !!open);
  if (open && options?.focusFirst) {
    dropup?.querySelector('.user-dropup-item')?.focus();
  }
}

function toggleUserDropup(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  var dropup = document.getElementById('userDropup');
  var isOpen = dropup?.classList.contains('open');
  setUserDropupState(!isOpen, { focusFirst: !isOpen });
}

document.addEventListener('click', function (e) {
  var footer = getUserMenuShell();
  if (footer && !footer.contains(e.target)) {
    setUserDropupState(false);
  }
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    setUserDropupState(false);
    closeAllClientActionMenus();
  }
});

document.addEventListener('DOMContentLoaded', function () {
  window.setTimeout(applyInitialAdminSearchQuery, 250);
});

function showSection(name, el) {
  window.REAdminModal?.init?.();
  window.REAdminModal?.closeAll?.({ reason: 'show-section:' + name });
  document.querySelectorAll('.tab-content').forEach(function (section) { section.classList.remove('active'); });
  document.querySelectorAll('.sidebar-link').forEach(function (link) { link.classList.remove('active'); });
  document.getElementById('sec-' + name)?.classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'logs') loadLogs();
  if (name === 'agenda') {
    // Open on the availability tab first — shows Camila's free windows immediately.
    // switchAgendaTab is defined in admin-agenda.js which loads after this file;
    // it is always available when the user clicks the sidebar, but may not exist
    // yet during deep-link URL startup (race condition). The pending flag below
    // is consumed by admin-agenda.js at its end to recover from this race.
    if (typeof switchAgendaTab === 'function') {
      switchAgendaTab('availability');
    } else {
      window._pendingAgendaTab = 'availability'; // picked up by admin-agenda.js
    }
  }
  if (name === 'financeiro') loadAdminFinanceiro();
  if (name === 'formularios') loadFormBuilder();
  if (name === 'adminInvoices') loadAdminInvoices();
  if (name === 'adminMarketplace') loadAdminMarketplace();
  if (name === 'auditlog') loadAuditLog();
  if (name === 'businessPlan') {
    if (typeof initBusinessPlanModule === 'function') {
      initBusinessPlanModule();
    }
  }
  if (name === 'notasFiscais') {
    if (typeof initAdminFiscalNotes === 'function') {
      if (!window._adminFnInitialized) { window._adminFnInitialized = true; initAdminFiscalNotes(); }
      else { if (typeof loadAdminFiscalNotes === 'function') loadAdminFiscalNotes(); }
    }
  }
  if (name === 'clients') {
    setTimeout(function () {
      if (typeof window.REClientsRedesign?.init === 'function') {
        window.REClientsRedesign.init();
      }
    }, 80);
  }
  var href = name === 'clients' ? '/admin' : '/admin?section=' + encodeURIComponent(name);
  if (history.replaceState) history.replaceState(null, '', href);
  window.REShared?.syncSidebarActive?.(href);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

var _allClients = [];
var _clientSelection = new Set();
var _openClientActionMenuId = null;
var _clientPageState = {
  page: 1,
  pageSize: 25,
};
var _clientFilters = {
  query: '',
  status: 'all',
  step: 'all',
  hasPendingTasks: false,
  hasUnread: false,
};

function getClientAccountState(client) {
  return client?.accountState === 'archived' ? 'archived' : 'active';
}

function setAdminFlashToast(payload) {
  try {
    sessionStorage.setItem('re_admin_flash_toast', JSON.stringify(payload || {}));
  } catch (_error) {}
}

function consumeAdminFlashToast() {
  try {
    var raw = sessionStorage.getItem('re_admin_flash_toast');
    if (!raw) return;
    sessionStorage.removeItem('re_admin_flash_toast');
    var payload = JSON.parse(raw);
    if (payload?.message) showToast(payload.message, payload.type || 'success');
  } catch (_error) {}
}

function closeAllClientActionMenus() {
  document.querySelectorAll('.admin-client-menu.open').forEach(function (menu) {
    menu.classList.remove('open');
  });
  document.querySelectorAll('.admin-client-menu-trigger[aria-expanded="true"]').forEach(function (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  });
  _openClientActionMenuId = null;
}

function toggleClientActionMenu(event, clientId) {
  event.preventDefault();
  event.stopPropagation();
  var target = document.getElementById('clientActionMenu_' + clientId);
  var trigger = event.currentTarget;
  if (!target) return;
  var willOpen = _openClientActionMenuId !== clientId || !target.classList.contains('open');
  closeAllClientActionMenus();
  if (willOpen) {
    target.classList.add('open');
    trigger?.setAttribute('aria-expanded', 'true');
    _openClientActionMenuId = clientId;
  }
}

document.addEventListener('click', function () {
  closeAllClientActionMenus();
});

function getFilteredClients() {
  var query = String(_clientFilters.query || '').toLowerCase();
  return _allClients.filter(function (client) {
    var matchesQuery = !query
      || (client.company || '').toLowerCase().includes(query)
      || (client.name || '').toLowerCase().includes(query)
      || (client.email || '').toLowerCase().includes(query);
    var matchesStatus = _clientFilters.status === 'all' || String(client.status || '') === _clientFilters.status;
    var matchesStep = _clientFilters.step === 'all' || String(client.step || '') === _clientFilters.step;
    var matchesTasks = !_clientFilters.hasPendingTasks || Number(client.pendingTasks || 0) > 0;
    var matchesUnread = !_clientFilters.hasUnread || Number(_unreadMsgs[client.id] || 0) > 0;
    return matchesQuery && matchesStatus && matchesStep && matchesTasks && matchesUnread;
  });
}

function getTotalClientPages(filteredClients) {
  var safePageSize = Math.max(1, Number(_clientPageState.pageSize) || 25);
  return Math.max(1, Math.ceil(filteredClients.length / safePageSize));
}

function getPagedClients(filteredClients) {
  var totalPages = getTotalClientPages(filteredClients);
  _clientPageState.page = Math.min(Math.max(1, _clientPageState.page), totalPages);
  var startIndex = (_clientPageState.page - 1) * _clientPageState.pageSize;
  return filteredClients.slice(startIndex, startIndex + _clientPageState.pageSize);
}

function updateClientSelectAllState(visibleClients) {
  var selectAll = document.getElementById('clientSelectAll');
  if (!selectAll) return;
  if (!visibleClients.length) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  var selectedVisible = visibleClients.filter(function (client) { return _clientSelection.has(client.id); }).length;
  selectAll.checked = selectedVisible > 0 && selectedVisible === visibleClients.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleClients.length;
}

function updateClientBulkToolbar(visibleClients) {
  var selected = Array.from(_clientSelection);
  var summary = document.getElementById('clientBulkSummary');
  var toolbar = document.getElementById('clientBulkToolbar');
  if (toolbar) toolbar.classList.toggle('has-selection', selected.length > 0);
  if (summary) {
    if (!selected.length) {
      summary.textContent = visibleClients.length
        ? visibleClients.length + ' cliente(s) visível(is).'
        : 'Nenhum cliente corresponde aos filtros atuais.';
    } else {
      summary.textContent = selected.length + ' cliente(s) selecionado(s) para ações em lote.';
    }
  }
  updateClientSelectAllState(visibleClients);
}

function refreshClientsView() {
  var filtered = getFilteredClients();
  renderClientTable(filtered);
  var clientsSub = document.getElementById('clientsSub');
  if (clientsSub) {
    clientsSub.textContent = filtered.length === _allClients.length
      ? _allClients.length + ' cliente' + (_allClients.length !== 1 ? 's' : '') + ' cadastrado' + (_allClients.length !== 1 ? 's' : '')
      : filtered.length + ' de ' + _allClients.length + ' clientes visíveis';
  }
  updateClientBulkToolbar(filtered);
  // Sincroniza stats e sub no redesign
  setTimeout(function () {
    if (typeof window.REClientsRedesign?.syncStats === 'function') window.REClientsRedesign.syncStats();
  }, 10);
}

function filterClients() {
  _clientFilters.query = document.getElementById('clientSearch')?.value || '';
  refreshClientsView();
}

var _unreadMsgs = {};

function renderClientTable(clients) {
  var tbody = document.getElementById('clientTableBody');
  if (!tbody) return;
  if (!clients.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="admin-client-empty-cell">Nenhum cliente encontrado.</td></tr>';
    updateClientBulkToolbar(clients);
    return;
  }

  tbody.innerHTML = clients.map(function (client) {
    var status = STATUS_LABELS[client.status] || STATUS_LABELS.nao_iniciado;
    var accountState = getClientAccountState(client);
    var progress = client.completed ? 100 : client.progress;
    var lastActivity = client.lastActivity ? new Date(client.lastActivity).toLocaleDateString('pt-BR') : '—';
    var unread = _unreadMsgs[client.id] || 0;
    var msgBadge = unread
      ? '<span class="badge badge-red admin-unread-pulse">' + unread + '</span>'
      : '<span class="admin-client-empty-dash">—</span>';
    var checked = _clientSelection.has(client.id) ? ' checked' : '';
    return `<tr class="admin-client-row${checked ? ' is-selected' : ''}" data-client-id="${client.id}">
      <td class="admin-client-check-col" onclick="event.stopPropagation()">
        <input type="checkbox" aria-label="Selecionar ${client.company || client.name || client.email}"${checked} onchange="toggleClientSelection('${client.id}', this.checked)"/>
      </td>
      <td>
        <button class="admin-client-primary-link" type="button" onclick="openClient('${client.id}')">
          <div class="company-cell">${client.company || client.name}${accountState === 'archived' ? ' <span class="badge badge-amber">Arquivado</span>' : ''}</div>
          <div class="email-cell">${client.email}</div>
        </button>
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
      <td class="admin-client-actions-col" onclick="event.stopPropagation()">
        <div class="admin-client-row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="window.location.href='/suporte-admin?ids=${client.id}'">Suporte</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="window.location.href='/tarefas-admin?ids=${client.id}'">Tarefas</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="window.location.href='/documentos-admin?ids=${client.id}'">Docs</button>
          <div class="admin-client-menu-wrap">
            <button class="btn btn-ghost btn-sm admin-client-menu-trigger" type="button" aria-label="Abrir menu de ações" aria-expanded="false" aria-controls="clientActionMenu_${client.id}" onclick="toggleClientActionMenu(event, '${client.id}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
            </button>
            <div class="admin-client-menu" id="clientActionMenu_${client.id}">
              <button type="button" class="admin-client-menu-item" onclick="assignClientFromList('${client.id}')">Atribuir tarefa</button>
              <button type="button" class="admin-client-menu-item" onclick="toggleClientArchiveState('${client.id}', ${accountState !== 'archived'})">${accountState === 'archived' ? 'Ativar' : 'Arquivar'}</button>
              <button type="button" class="admin-client-menu-item" onclick="adminEditClient('${client.id}')">Editar</button>
              <button type="button" class="admin-client-menu-item danger" onclick="adminDeleteClient('${client.id}')">Excluir</button>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.mini-progress-fill').forEach(function (bar) {
    window.REShared.applyPercentClass(bar, bar.dataset.progress || 0);
  });
  updateClientBulkToolbar(clients);
  // Sincroniza com o redesign mobile-first
  if (typeof window.REClientsRedesign?.syncTable === 'function') {
    setTimeout(function () { window.REClientsRedesign.syncTable(); }, 0);
  }
}

function toggleClientSelection(clientId, checked) {
  if (checked) _clientSelection.add(clientId);
  else _clientSelection.delete(clientId);
  refreshClientsView();
}

function toggleAllVisibleClients(checked) {
  getFilteredClients().forEach(function (client) {
    if (checked) _clientSelection.add(client.id);
    else _clientSelection.delete(client.id);
  });
  refreshClientsView();
}

function clearSelectedClients() {
  _clientSelection.clear();
  refreshClientsView();
}

function getSelectedClients() {
  return _allClients.filter(function (client) { return _clientSelection.has(client.id); });
}

function openBulkClientPage(kind) {
  var selected = getSelectedClients();
  if (!selected.length) {
    showToast('Selecione ao menos um cliente.', 'error');
    return;
  }
  var pathMap = {
    support: '/suporte-admin',
    tasks: '/tarefas-admin',
    documents: '/documentos-admin',
  };
  window.location.href = pathMap[kind] + '?ids=' + encodeURIComponent(selected.map(function (client) { return client.id; }).join(','));
}

function assignClientFromList(clientId) {
  closeAllClientActionMenus();
  window.location.href = '/tarefas-admin?ids=' + encodeURIComponent(clientId);
}

function bulkAssignClients() {
  openBulkClientPage('tasks');
}

async function applyBulkClientAction(action, options) {
  var selected = getSelectedClients();
  if (!selected.length) {
    showToast('Selecione ao menos um cliente.', 'error');
    return false;
  }
  var response = await fetch('/api/admin/clients/bulk-action', {
    method: 'POST',
    headers: authH(),
    body: JSON.stringify({
      action: action,
      ids: selected.map(function (client) { return client.id; }),
      confirm: options?.confirm || undefined,
    }),
  });
  var data = await readAdminResponse(response);
  if (!response.ok) {
    showToast(data.error || 'Erro ao aplicar ação em lote.', 'error');
    return false;
  }
  _clientSelection.clear();
  if (typeof window.loadAdminData === 'function') await window.loadAdminData();
  showToast(data.message || 'Ação aplicada.', 'success');
  return true;
}

function bulkSetClientArchiveState(archived) {
  return applyBulkClientAction(archived ? 'archive' : 'activate');
}

function bulkDeleteClients() {
  var selected = getSelectedClients();
  if (!selected.length) {
    showToast('Selecione ao menos um cliente.', 'error');
    return;
  }
  var wrapper = document.createElement('div');
  wrapper.innerHTML = [
    '<div class="account-empty-state" style="margin-bottom:12px">Você está prestes a excluir ' + selected.length + ' cliente(s). Todos os dados serão removidos de forma irreversível.</div>',
    '<label class="admin-confirm-check">',
    '  <input type="checkbox" id="bulkDeleteConfirmCheck"/>',
    '  <span>Confirmo a exclusão definitiva dos clientes selecionados.</span>',
    '</label>'
  ].join('');

  window.REPortalUI.useModal({
    title: 'Excluir clientes em lote',
    subtitle: 'Ação irreversível com notificação ao cliente.',
    content: wrapper,
    actions: [{
      label: 'Cancelar'
    }, {
      label: 'Excluir clientes',
      tone: 'danger',
      onClick: async function () {
        if (!wrapper.querySelector('#bulkDeleteConfirmCheck')?.checked) {
          showToast('Marque a confirmação antes de excluir.', 'error');
          return false;
        }
        return applyBulkClientAction('delete', { confirm: 'CONFIRMAR_EXCLUSAO' });
      }
    }]
  });
}

function toggleClientArchiveState(clientId, archived) {
  closeAllClientActionMenus();
  _clientSelection = new Set([clientId]);
  return applyBulkClientAction(archived ? 'archive' : 'activate');
}

function copySelectedClientEmails() {
  var emails = getSelectedClients().map(function (client) { return client.email; }).filter(Boolean);
  if (!emails.length) {
    showToast('Nenhum e-mail disponível para copiar.', 'error');
    return;
  }
  var payload = emails.join(', ');
  var copyPromise = navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(payload)
    : Promise.reject(new Error('clipboard_unavailable'));
  copyPromise
    .then(function () { showToast('E-mails copiados.', 'success'); })
    .catch(function () {
      var input = document.createElement('textarea');
      input.value = payload;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      showToast('E-mails copiados.', 'success');
    });
}

function exportSelectedClients(format) {
  var selected = getSelectedClients();
  if (!selected.length) {
    showToast('Selecione ao menos um cliente.', 'error');
    return;
  }
  selected.forEach(function (client, index) {
    setTimeout(function () {
      if (format === 'pdf') exportClientPDF(client.id);
      else exportClientXLS(client.id);
    }, index * 250);
  });
  showToast('Exportação em lote iniciada.', 'success');
}

function openClientFilters() {
  var wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="page-field-row">
      <div class="form-group">
        <label class="form-label" for="clientFilterStatus">Status</label>
        <select class="form-input" id="clientFilterStatus">
          <option value="all">Todos</option>
          <option value="nao_iniciado">Não iniciado</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluido">Concluído</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="clientFilterStep">Etapa</label>
        <select class="form-input" id="clientFilterStep">
          <option value="all">Todas</option>
          ${Array.from({ length: 14 }).map(function (_, index) {
            var step = index + 1;
            return '<option value="' + step + '">Etapa ' + step + ' · ' + (STEP_TITLES[step] || 'Etapa') + '</option>';
          }).join('')}
        </select>
      </div>
    </div>
    <div class="page-toggle-row">
      <div>
        <div class="page-toggle-label">Somente com tarefas pendentes</div>
        <div class="page-toggle-desc">Foca clientes com demanda operacional em aberto.</div>
      </div>
      <label class="page-toggle">
        <input type="checkbox" id="clientFilterPendingTasks"/>
        <span class="page-toggle-track"></span>
      </label>
    </div>
    <div class="page-toggle-row">
      <div>
        <div class="page-toggle-label">Somente com mensagens não lidas</div>
        <div class="page-toggle-desc">Destaca clientes com retorno pendente da equipe.</div>
      </div>
      <label class="page-toggle">
        <input type="checkbox" id="clientFilterUnread"/>
        <span class="page-toggle-track"></span>
      </label>
    </div>`;

  wrapper.querySelector('#clientFilterStatus').value = _clientFilters.status;
  wrapper.querySelector('#clientFilterStep').value = _clientFilters.step;
  wrapper.querySelector('#clientFilterPendingTasks').checked = !!_clientFilters.hasPendingTasks;
  wrapper.querySelector('#clientFilterUnread').checked = !!_clientFilters.hasUnread;

  window.REPortalUI.useDrawer({
    title: 'Filtros de clientes',
    subtitle: 'Refine a lista antes de aplicar ações em lote.',
    content: wrapper,
    actions: [{
      label: 'Limpar filtros',
      onClick: function () {
        _clientFilters.status = 'all';
        _clientFilters.step = 'all';
        _clientFilters.hasPendingTasks = false;
        _clientFilters.hasUnread = false;
        refreshClientsView();
        return true;
      }
    }, {
      label: 'Aplicar filtros',
      tone: 'primary',
      onClick: function () {
        _clientFilters.status = wrapper.querySelector('#clientFilterStatus').value;
        _clientFilters.step = wrapper.querySelector('#clientFilterStep').value;
        _clientFilters.hasPendingTasks = wrapper.querySelector('#clientFilterPendingTasks').checked;
        _clientFilters.hasUnread = wrapper.querySelector('#clientFilterUnread').checked;
        refreshClientsView();
        return true;
      }
    }]
  });
}

window.toggleClientSelection = toggleClientSelection;
window.toggleAllVisibleClients = toggleAllVisibleClients;
window.clearSelectedClients = clearSelectedClients;
window.copySelectedClientEmails = copySelectedClientEmails;
window.exportSelectedClients = exportSelectedClients;
window.openBulkClientPage = openBulkClientPage;
window.openClientFilters = openClientFilters;
window.assignClientFromList = assignClientFromList;
window.bulkAssignClients = bulkAssignClients;
window.bulkSetClientArchiveState = bulkSetClientArchiveState;
window.bulkDeleteClients = bulkDeleteClients;
window.toggleClientArchiveState = toggleClientArchiveState;
window.toggleClientActionMenu = toggleClientActionMenu;
window.consumeAdminFlashToast = consumeAdminFlashToast;

console.info('[RE:admin-shell-core] loaded');

(function initAdminSectionRouting() {
  var validSections = ['clients', 'agenda', 'financeiro', 'formularios', 'jornadas', 'logs', 'adminInvoices', 'adminMarketplace', 'auditlog', 'businessPlan', 'notasFiscais'];

  function applyRequestedSection() {
    var params = new URLSearchParams(window.location.search);
    var requested = params.get('section') || window.location.hash.replace('#', '').trim();
    if (!requested || !validSections.includes(requested)) return;
    showSection(requested, null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRequestedSection, { once: true });
  } else {
    applyRequestedSection();
  }
})();
