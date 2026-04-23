'use strict';

(function () {
  var state = {
    page: 1,
    pageSize: 25
  };

  function getAllClients() {
    return Array.isArray(window._allClients) ? window._allClients : [];
  }

  function getSelection() {
    return window._clientSelection instanceof Set ? window._clientSelection : new Set();
  }

  function getFilters() {
    if (!window._clientFilters) {
      window._clientFilters = {
        query: '',
        status: 'all',
        step: 'all',
        hasPendingTasks: false,
        hasUnread: false,
        accountState: 'all'
      };
    }
    if (!('accountState' in window._clientFilters)) window._clientFilters.accountState = 'all';
    return window._clientFilters;
  }

  function getClientAccountState(client) {
    return client?.accountState === 'archived' ? 'archived' : 'active';
  }

  function runBaseFilter() {
    var filters = getFilters();
    var unreadMap = window._unreadMsgs || {};
    return getAllClients().filter(function (client) {
      var query = String(filters.query || '').toLowerCase();
      var matchesQuery = !query
        || (client.company || '').toLowerCase().includes(query)
        || (client.name || '').toLowerCase().includes(query)
        || (client.email || '').toLowerCase().includes(query);
      var matchesStatus = filters.status === 'all' || String(client.status || '') === filters.status;
      var matchesStep = filters.step === 'all' || String(client.step || '') === filters.step;
      var matchesTasks = !filters.hasPendingTasks || Number(client.pendingTasks || 0) > 0;
      var matchesUnread = !filters.hasUnread || Number(unreadMap[client.id] || 0) > 0;
      var matchesAccountState = filters.accountState === 'all' || getClientAccountState(client) === filters.accountState;
      return matchesQuery && matchesStatus && matchesStep && matchesTasks && matchesUnread && matchesAccountState;
    });
  }

  function getPagedClients(filteredClients) {
    var safePageSize = Math.max(1, Number(state.pageSize) || 25);
    var totalPages = Math.max(1, Math.ceil(filteredClients.length / safePageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    var startIndex = (state.page - 1) * safePageSize;
    return filteredClients.slice(startIndex, startIndex + safePageSize);
  }

  function getMetrics(filteredClients) {
    var unreadMap = window._unreadMsgs || {};
    return filteredClients.reduce(function (acc, client) {
      acc.total += 1;
      acc.pendingTasks += Number(client.pendingTasks || 0) > 0 ? 1 : 0;
      acc.unread += Number(unreadMap[client.id] || 0) > 0 ? 1 : 0;
      acc.archived += getClientAccountState(client) === 'archived' ? 1 : 0;
      acc.inProgress += String(client.status || '') === 'em_andamento' ? 1 : 0;
      return acc;
    }, {
      total: 0,
      pendingTasks: 0,
      unread: 0,
      archived: 0,
      inProgress: 0
    });
  }

  function renderPagination(filteredClients, pagedClients) {
    var summary = document.getElementById('clientPaginationSummary');
    var pageSize = document.getElementById('clientPageSize');
    var prevBtn = document.getElementById('clientPagePrev');
    var nextBtn = document.getElementById('clientPageNext');
    var indicator = document.getElementById('clientPageIndicator');
    if (!summary || !pageSize || !prevBtn || !nextBtn || !indicator) return;

    var totalPages = Math.max(1, Math.ceil(filteredClients.length / state.pageSize));
    if (String(pageSize.value) !== String(state.pageSize)) pageSize.value = String(state.pageSize);

    var startNumber = filteredClients.length ? ((state.page - 1) * state.pageSize) + 1 : 0;
    var endNumber = filteredClients.length ? startNumber + pagedClients.length - 1 : 0;

    summary.textContent = filteredClients.length
      ? 'Mostrando ' + startNumber + '–' + endNumber + ' de ' + filteredClients.length + ' clientes'
      : 'Nenhum cliente para exibir';
    indicator.textContent = 'Página ' + state.page + ' de ' + totalPages;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;
  }

  function syncSidePanelControls() {
    var filters = getFilters();
    var panel = document.getElementById('clientFiltersPanel');
    if (!panel) return;
    var status = panel.querySelector('#clientFilterStatusInline');
    var step = panel.querySelector('#clientFilterStepInline');
    var pending = panel.querySelector('#clientFilterPendingInline');
    var unread = panel.querySelector('#clientFilterUnreadInline');
    var accountState = panel.querySelector('#clientFilterAccountStateInline');
    var pageSize = panel.querySelector('#clientFilterPageSizeInline');
    if (status) status.value = filters.status;
    if (step) step.value = filters.step;
    if (pending) pending.checked = !!filters.hasPendingTasks;
    if (unread) unread.checked = !!filters.hasUnread;
    if (accountState) accountState.value = filters.accountState;
    if (pageSize) pageSize.value = String(state.pageSize);
  }

  function renderSelectionSummary() {
    var root = document.getElementById('clientSelectionSummary');
    if (!root) return;
    var selected = Array.from(getSelection());
    if (!selected.length) {
      root.innerHTML = '<div class="account-empty-state">Selecione clientes na tabela para liberar ações em lote mais avançadas.</div>';
      return;
    }
    var clients = getAllClients().filter(function (client) { return selected.includes(client.id); });
    root.innerHTML = clients.slice(0, 6).map(function (client) {
      return '<span class="account-chip">' + (client.company || client.name || 'Cliente') + '</span>';
    }).join('') + (clients.length > 6 ? '<span class="account-chip account-chip-muted">+' + (clients.length - 6) + ' selecionado(s)</span>' : '');
  }

  function renderSidePanelStats(filteredClients) {
    var root = document.getElementById('clientPanelStats');
    if (!root) return;
    var metrics = getMetrics(filteredClients);
    root.innerHTML = [
      '<div class="admin-filter-stat-card"><span class="account-stat-label">Visíveis</span><strong>' + metrics.total + '</strong><div class="tenant-member-meta">Clientes na lista atual</div></div>',
      '<div class="admin-filter-stat-card"><span class="account-stat-label">Em andamento</span><strong>' + metrics.inProgress + '</strong><div class="tenant-member-meta">Com trabalho ativo</div></div>',
      '<div class="admin-filter-stat-card"><span class="account-stat-label">Com tarefas</span><strong>' + metrics.pendingTasks + '</strong><div class="tenant-member-meta">Demandas pendentes</div></div>',
      '<div class="admin-filter-stat-card"><span class="account-stat-label">Com mensagens</span><strong>' + metrics.unread + '</strong><div class="tenant-member-meta">Aguardando retorno</div></div>',
      '<div class="admin-filter-stat-card"><span class="account-stat-label">Arquivados</span><strong>' + metrics.archived + '</strong><div class="tenant-member-meta">Fora da operação ativa</div></div>'
    ].join('');
  }

  function updateClientsSubtitle(filtered, pagedClients) {
    var clientsSub = document.getElementById('clientsSub');
    if (!clientsSub) return;
    var allClients = getAllClients();
    var baseSummary = filtered.length === allClients.length
      ? allClients.length + ' cliente' + (allClients.length !== 1 ? 's' : '') + ' cadastrado' + (allClients.length !== 1 ? 's' : '')
      : filtered.length + ' de ' + allClients.length + ' clientes visíveis';
    var startNumber = filtered.length ? ((state.page - 1) * state.pageSize) + 1 : 0;
    var endNumber = filtered.length ? startNumber + pagedClients.length - 1 : 0;
    clientsSub.textContent = baseSummary + (filtered.length ? ' · exibindo ' + startNumber + '–' + endNumber : '');
  }

  function refreshClientsViewEnhanced() {
    var filtered = runBaseFilter();
    var pagedClients = getPagedClients(filtered);
    if (typeof window.renderClientTable === 'function') {
      window.renderClientTable(pagedClients);
    }
    updateClientsSubtitle(filtered, pagedClients);
    if (typeof window.updateClientBulkToolbar === 'function') {
      window.updateClientBulkToolbar(pagedClients);
    }
    renderPagination(filtered, pagedClients);
    renderSidePanelStats(filtered);
    renderSelectionSummary();
    syncSidePanelControls();
  }

  function filterClientsEnhanced() {
    var input = document.getElementById('clientSearch');
    if (input) getFilters().query = input.value || '';
    state.page = 1;
    refreshClientsViewEnhanced();
  }

  function toggleAllVisibleClientsEnhanced(checked) {
    var selection = getSelection();
    getPagedClients(runBaseFilter()).forEach(function (client) {
      if (checked) selection.add(client.id);
      else selection.delete(client.id);
    });
    window._clientSelection = selection;
    refreshClientsViewEnhanced();
  }

  function setClientPageSize(value) {
    state.pageSize = Math.max(1, Number(value) || 25);
    state.page = 1;
    refreshClientsViewEnhanced();
  }

  function changeClientPage(delta) {
    state.page += delta;
    refreshClientsViewEnhanced();
  }

  function openClientFiltersEnhanced() {
    var panel = document.getElementById('clientFiltersPanel');
    if (window.innerWidth > 1120 && panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var wrapper = document.createElement('div');
    wrapper.innerHTML = document.getElementById('clientFiltersPanelTemplate')?.innerHTML || '';
    var filters = getFilters();
    var status = wrapper.querySelector('#clientFilterStatusInline');
    var step = wrapper.querySelector('#clientFilterStepInline');
    var pending = wrapper.querySelector('#clientFilterPendingInline');
    var unread = wrapper.querySelector('#clientFilterUnreadInline');
    var accountState = wrapper.querySelector('#clientFilterAccountStateInline');
    var pageSize = wrapper.querySelector('#clientFilterPageSizeInline');
    if (status) status.value = filters.status;
    if (step) step.value = filters.step;
    if (pending) pending.checked = !!filters.hasPendingTasks;
    if (unread) unread.checked = !!filters.hasUnread;
    if (accountState) accountState.value = filters.accountState;
    if (pageSize) pageSize.value = String(state.pageSize);

    window.REPortalUI.useDrawer({
      title: 'Filtros de clientes',
      subtitle: 'Refine a lista antes de agir em lote.',
      content: wrapper,
      actions: [{
        label: 'Limpar filtros',
        onClick: function () {
          resetFilters();
          return true;
        }
      }, {
        label: 'Aplicar filtros',
        tone: 'primary',
        onClick: function () {
          applyPanelValues(wrapper);
          return true;
        }
      }]
    });
  }

  function applyPanelValues(root) {
    var filters = getFilters();
    filters.status = root.querySelector('#clientFilterStatusInline')?.value || 'all';
    filters.step = root.querySelector('#clientFilterStepInline')?.value || 'all';
    filters.hasPendingTasks = !!root.querySelector('#clientFilterPendingInline')?.checked;
    filters.hasUnread = !!root.querySelector('#clientFilterUnreadInline')?.checked;
    filters.accountState = root.querySelector('#clientFilterAccountStateInline')?.value || 'all';
    state.pageSize = Math.max(1, Number(root.querySelector('#clientFilterPageSizeInline')?.value) || state.pageSize || 25);
    state.page = 1;
    refreshClientsViewEnhanced();
  }

  function resetFilters() {
    window._clientFilters = {
      query: document.getElementById('clientSearch')?.value || '',
      status: 'all',
      step: 'all',
      hasPendingTasks: false,
      hasUnread: false,
      accountState: 'all'
    };
    state.pageSize = 25;
    state.page = 1;
    refreshClientsViewEnhanced();
  }

  async function bulkMessageClients() {
    var selected = getAllClients().filter(function (client) { return getSelection().has(client.id); });
    if (!selected.length) {
      showToast('Selecione ao menos um cliente.', 'error');
      return;
    }
    var wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<div class="account-chip-list" style="margin-bottom:14px">' + selected.slice(0, 6).map(function (client) {
        return '<span class="account-chip">' + (client.company || client.name || 'Cliente') + '</span>';
      }).join('') + (selected.length > 6 ? '<span class="account-chip account-chip-muted">+' + (selected.length - 6) + ' clientes</span>' : '') + '</div>',
      '<div class="form-group">',
      '  <label class="form-label" for="bulkMessageText">Mensagem</label>',
      '  <textarea class="form-input account-textarea" id="bulkMessageText" placeholder="Escreva a mensagem que deve ser enviada para os clientes selecionados."></textarea>',
      '</div>'
    ].join('');
    window.REPortalUI.useModal({
      title: 'Mensagem em lote',
      subtitle: 'Envie o mesmo retorno para os clientes selecionados.',
      content: wrapper,
      actions: [{
        label: 'Cancelar'
      }, {
        label: 'Enviar mensagem',
        tone: 'primary',
        onClick: async function () {
          var text = String(wrapper.querySelector('#bulkMessageText')?.value || '').trim();
          if (!text) {
            showToast('Escreva uma mensagem antes de enviar.', 'error');
            return false;
          }
          for (var i = 0; i < selected.length; i += 1) {
            var response = await fetch('/api/admin/client/' + selected[i].id + '/message', {
              method: 'POST',
              headers: window.REShared?.buildAuthHeaders ? window.REShared.buildAuthHeaders() : { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: text })
            });
            if (!response.ok) {
              showToast('Falha ao enviar para ' + (selected[i].company || selected[i].name || 'cliente') + '.', 'error');
              return false;
            }
          }
          showToast('Mensagem enviada para ' + selected.length + ' cliente(s).', 'success');
          return true;
        }
      }]
    });
  }

  function copySelectedClientLinks() {
    var selected = getAllClients().filter(function (client) { return getSelection().has(client.id); });
    if (!selected.length) {
      showToast('Selecione ao menos um cliente.', 'error');
      return;
    }
    var payload = selected.map(function (client) {
      return window.location.origin + '/cliente?id=' + encodeURIComponent(client.id);
    }).join('\n');
    var copyPromise = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(payload)
      : Promise.reject(new Error('clipboard_unavailable'));
    copyPromise
      .then(function () { showToast('Links dos clientes copiados.', 'success'); })
      .catch(function () {
        var input = document.createElement('textarea');
        input.value = payload;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        showToast('Links dos clientes copiados.', 'success');
      });
  }

  function ensureWorkspaceShell() {
    var section = document.getElementById('sec-clients');
    var card = section?.querySelector('.portal-card');
    if (!section || !card || section.querySelector('.admin-clients-workspace')) return;

    var workspace = document.createElement('div');
    workspace.className = 'admin-clients-workspace';

    var main = document.createElement('div');
    main.className = 'admin-clients-main';
    card.parentNode.insertBefore(workspace, card);
    workspace.appendChild(main);
    main.appendChild(card);

    var aside = document.createElement('aside');
    aside.className = 'admin-clients-aside card-surface';
    aside.id = 'clientFiltersPanel';
    aside.innerHTML = [
      '<div class="admin-filter-panel-head">',
      '  <div>',
      '    <div class="page-section-title">Filtros e contexto</div>',
      '    <div class="page-section-sub">Painel lateral para refinar a carteira e agir com mais contexto.</div>',
      '  </div>',
      '  <button class="btn btn-ghost btn-sm" type="button" onclick="resetClientFilters()">Limpar</button>',
      '</div>',
      '<div id="clientPanelStats" class="admin-filter-stats"></div>',
      '<div class="admin-filter-section">',
      '  <div class="account-form-block-title">Refinar lista</div>',
      '  <div id="clientFiltersPanelTemplate">',
      '    <div class="form-group">',
      '      <label class="form-label" for="clientFilterStatusInline">Status</label>',
      '      <select class="form-input" id="clientFilterStatusInline">',
      '        <option value="all">Todos</option>',
      '        <option value="nao_iniciado">Não iniciado</option>',
      '        <option value="em_andamento">Em andamento</option>',
      '        <option value="concluido">Concluído</option>',
      '      </select>',
      '    </div>',
      '    <div class="form-group">',
      '      <label class="form-label" for="clientFilterStepInline">Etapa</label>',
      '      <select class="form-input" id="clientFilterStepInline">',
      '        <option value="all">Todas</option>',
      Array.from({ length: 14 }).map(function (_, index) {
        var step = index + 1;
        var label = window.STEP_TITLES && window.STEP_TITLES[step] ? window.STEP_TITLES[step] : 'Etapa';
        return '        <option value="' + step + '">Etapa ' + step + ' · ' + label + '</option>';
      }).join(''),
      '      </select>',
      '    </div>',
      '    <div class="form-group">',
      '      <label class="form-label" for="clientFilterAccountStateInline">Carteira</label>',
      '      <select class="form-input" id="clientFilterAccountStateInline">',
      '        <option value="all">Todos</option>',
      '        <option value="active">Ativos</option>',
      '        <option value="archived">Arquivados</option>',
      '      </select>',
      '    </div>',
      '    <label class="admin-filter-check"><input type="checkbox" id="clientFilterPendingInline"/> <span>Somente com tarefas pendentes</span></label>',
      '    <label class="admin-filter-check"><input type="checkbox" id="clientFilterUnreadInline"/> <span>Somente com mensagens não lidas</span></label>',
      '    <div class="form-group">',
      '      <label class="form-label" for="clientFilterPageSizeInline">Clientes por página</label>',
      '      <select class="form-input" id="clientFilterPageSizeInline">',
      '        <option value="10">10</option>',
      '        <option value="25">25</option>',
      '        <option value="50">50</option>',
      '        <option value="100">100</option>',
      '      </select>',
      '    </div>',
      '  </div>',
      '  <div class="account-form-actions" style="margin-top:12px;">',
      '    <button class="btn btn-primary btn-sm" type="button" onclick="applyClientFilters()">Aplicar</button>',
      '  </div>',
      '</div>',
      '<div class="admin-filter-section">',
      '  <div class="account-form-block-title">Seleção atual</div>',
      '  <div id="clientSelectionSummary"></div>',
      '  <div class="admin-filter-bulk-actions">',
      '    <button class="btn btn-secondary btn-sm" type="button" onclick="bulkMessageClients()">Mensagem em lote</button>',
      '    <button class="btn btn-secondary btn-sm" type="button" onclick="copySelectedClientLinks()">Copiar links</button>',
      '    <button class="btn btn-secondary btn-sm" type="button" onclick="openBulkClientPage(\'tasks\')">Abrir em tarefas</button>',
      '    <button class="btn btn-secondary btn-sm" type="button" onclick="openBulkClientPage(\'documents\')">Abrir em documentos</button>',
      '  </div>',
      '</div>'
    ].join('');
    workspace.appendChild(aside);

    aside.querySelector('#clientFilterStatusInline')?.addEventListener('change', function () { applyPanelValues(aside); });
    aside.querySelector('#clientFilterStepInline')?.addEventListener('change', function () { applyPanelValues(aside); });
    aside.querySelector('#clientFilterAccountStateInline')?.addEventListener('change', function () { applyPanelValues(aside); });
    aside.querySelector('#clientFilterPendingInline')?.addEventListener('change', function () { applyPanelValues(aside); });
    aside.querySelector('#clientFilterUnreadInline')?.addEventListener('change', function () { applyPanelValues(aside); });
    aside.querySelector('#clientFilterPageSizeInline')?.addEventListener('change', function () { applyPanelValues(aside); });
  }

  function upgradeBulkToolbar() {
    var toolbar = document.querySelector('.admin-bulk-toolbar-actions');
    if (!toolbar) return;
    if (!toolbar.querySelector('[data-bulk-message]')) {
      var messageBtn = document.createElement('button');
      messageBtn.className = 'btn btn-secondary btn-sm';
      messageBtn.type = 'button';
      messageBtn.setAttribute('data-bulk-message', '1');
      messageBtn.textContent = 'Mensagem em lote';
      messageBtn.onclick = bulkMessageClients;
      toolbar.insertBefore(messageBtn, toolbar.firstChild);
    }
    if (!toolbar.querySelector('[data-bulk-links]')) {
      var linksBtn = document.createElement('button');
      linksBtn.className = 'btn btn-secondary btn-sm';
      linksBtn.type = 'button';
      linksBtn.setAttribute('data-bulk-links', '1');
      linksBtn.textContent = 'Copiar links';
      linksBtn.onclick = copySelectedClientLinks;
      toolbar.appendChild(linksBtn);
    }
  }

  function patchVisibleStrings() {
    document.title = document.title
      .replace('Ã¢â‚¬â€', '—')
      .replace('Painel do Consultor Ã¢â‚¬â€ Recupera Empresas', 'Painel do Consultor — Recupera Empresas');
  }

  function bootstrap() {
    window.getFilteredClients = runBaseFilter;
    window.refreshClientsView = refreshClientsViewEnhanced;
    window.filterClients = filterClientsEnhanced;
    window.toggleAllVisibleClients = toggleAllVisibleClientsEnhanced;
    window.setClientPageSize = setClientPageSize;
    window.changeClientPage = changeClientPage;
    window.openClientFilters = openClientFiltersEnhanced;
    window.bulkMessageClients = bulkMessageClients;
    window.copySelectedClientLinks = copySelectedClientLinks;
    window.applyClientFilters = function () {
      var panel = document.getElementById('clientFiltersPanel');
      if (panel) applyPanelValues(panel);
    };
    window.resetClientFilters = resetFilters;
    patchVisibleStrings();
    ensureWorkspaceShell();
    upgradeBulkToolbar();
    if (document.getElementById('sec-clients')) {
      refreshClientsViewEnhanced();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  console.info('[RE:admin-clients-enhancements] loaded');
})();
