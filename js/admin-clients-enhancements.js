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

  function runBaseFilter() {
    return Array.isArray(window._allClients)
      ? window._allClients.filter(function (client) {
          var filters = window._clientFilters || {};
          var query = String(filters.query || '').toLowerCase();
          var matchesQuery = !query
            || (client.company || '').toLowerCase().includes(query)
            || (client.name || '').toLowerCase().includes(query)
            || (client.email || '').toLowerCase().includes(query);
          var matchesStatus = filters.status === 'all' || String(client.status || '') === filters.status;
          var matchesStep = filters.step === 'all' || String(client.step || '') === filters.step;
          var matchesTasks = !filters.hasPendingTasks || Number(client.pendingTasks || 0) > 0;
          var unreadMap = window._unreadMsgs || {};
          var matchesUnread = !filters.hasUnread || Number(unreadMap[client.id] || 0) > 0;
          return matchesQuery && matchesStatus && matchesStep && matchesTasks && matchesUnread;
        })
      : [];
  }

  function getFilteredClients() {
    if (typeof window.getFilteredClients === 'function' && window.getFilteredClients !== getFilteredClientsEnhanced) {
      return window.getFilteredClients();
    }
    return runBaseFilter();
  }

  function getPagedClients(filteredClients) {
    var safePageSize = Math.max(1, Number(state.pageSize) || 25);
    var totalPages = Math.max(1, Math.ceil(filteredClients.length / safePageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    var startIndex = (state.page - 1) * safePageSize;
    return filteredClients.slice(startIndex, startIndex + safePageSize);
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

  function refreshClientsViewEnhanced() {
    var filtered = runBaseFilter();
    var pagedClients = getPagedClients(filtered);
    if (typeof window.renderClientTable === 'function') {
      window.renderClientTable(pagedClients);
    }

    var clientsSub = document.getElementById('clientsSub');
    if (clientsSub) {
      var allClients = getAllClients();
      var baseSummary = filtered.length === allClients.length
        ? allClients.length + ' cliente' + (allClients.length !== 1 ? 's' : '') + ' cadastrado' + (allClients.length !== 1 ? 's' : '')
        : filtered.length + ' de ' + allClients.length + ' clientes visíveis';
      var startNumber = filtered.length ? ((state.page - 1) * state.pageSize) + 1 : 0;
      var endNumber = filtered.length ? startNumber + pagedClients.length - 1 : 0;
      clientsSub.textContent = baseSummary + (filtered.length ? ' · exibindo ' + startNumber + '–' + endNumber : '');
    }

    if (typeof window.updateClientBulkToolbar === 'function') {
      window.updateClientBulkToolbar(pagedClients);
    }
    renderPagination(filtered, pagedClients);
  }

  function getFilteredClientsEnhanced() {
    return runBaseFilter();
  }

  function filterClientsEnhanced() {
    if (document.getElementById('clientSearch')) {
      window._clientFilters.query = document.getElementById('clientSearch').value || '';
    }
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
    var wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<div class="page-field-row">',
      '  <div class="form-group">',
      '    <label class="form-label" for="clientFilterStatus">Status</label>',
      '    <select class="form-input" id="clientFilterStatus">',
      '      <option value="all">Todos</option>',
      '      <option value="nao_iniciado">Não iniciado</option>',
      '      <option value="em_andamento">Em andamento</option>',
      '      <option value="concluido">Concluído</option>',
      '    </select>',
      '  </div>',
      '  <div class="form-group">',
      '    <label class="form-label" for="clientFilterStep">Etapa</label>',
      '    <select class="form-input" id="clientFilterStep">',
      '      <option value="all">Todas</option>',
      Array.from({ length: 14 }).map(function (_, index) {
        var step = index + 1;
        var label = window.STEP_TITLES && window.STEP_TITLES[step] ? window.STEP_TITLES[step] : 'Etapa';
        return '      <option value="' + step + '">Etapa ' + step + ' · ' + label + '</option>';
      }).join(''),
      '    </select>',
      '  </div>',
      '</div>',
      '<div class="page-toggle-row">',
      '  <div>',
      '    <div class="page-toggle-label">Somente com tarefas pendentes</div>',
      '    <div class="page-toggle-desc">Foca clientes com demanda operacional em aberto.</div>',
      '  </div>',
      '  <label class="page-toggle">',
      '    <input type="checkbox" id="clientFilterPendingTasks"/>',
      '    <span class="page-toggle-track"></span>',
      '  </label>',
      '</div>',
      '<div class="page-toggle-row">',
      '  <div>',
      '    <div class="page-toggle-label">Somente com mensagens não lidas</div>',
      '    <div class="page-toggle-desc">Destaca clientes com retorno pendente da equipe.</div>',
      '  </div>',
      '  <label class="page-toggle">',
      '    <input type="checkbox" id="clientFilterUnread"/>',
      '    <span class="page-toggle-track"></span>',
      '  </label>',
      '</div>',
      '<div class="page-field-row">',
      '  <div class="form-group">',
      '    <label class="form-label" for="clientFilterPageSize">Clientes por página</label>',
      '    <select class="form-input" id="clientFilterPageSize">',
      '      <option value="10">10</option>',
      '      <option value="25">25</option>',
      '      <option value="50">50</option>',
      '      <option value="100">100</option>',
      '    </select>',
      '  </div>',
      '</div>'
    ].join('');

    wrapper.querySelector('#clientFilterStatus').value = window._clientFilters.status;
    wrapper.querySelector('#clientFilterStep').value = window._clientFilters.step;
    wrapper.querySelector('#clientFilterPendingTasks').checked = !!window._clientFilters.hasPendingTasks;
    wrapper.querySelector('#clientFilterUnread').checked = !!window._clientFilters.hasUnread;
    wrapper.querySelector('#clientFilterPageSize').value = String(state.pageSize);

    window.REPortalUI.useDrawer({
      title: 'Filtros de clientes',
      subtitle: 'Refine a lista e a densidade da visão antes de agir em lote.',
      content: wrapper,
      actions: [{
        label: 'Limpar filtros',
        onClick: function () {
          window._clientFilters.status = 'all';
          window._clientFilters.step = 'all';
          window._clientFilters.hasPendingTasks = false;
          window._clientFilters.hasUnread = false;
          state.pageSize = 25;
          state.page = 1;
          refreshClientsViewEnhanced();
          return true;
        }
      }, {
        label: 'Aplicar filtros',
        tone: 'primary',
        onClick: function () {
          window._clientFilters.status = wrapper.querySelector('#clientFilterStatus').value;
          window._clientFilters.step = wrapper.querySelector('#clientFilterStep').value;
          window._clientFilters.hasPendingTasks = wrapper.querySelector('#clientFilterPendingTasks').checked;
          window._clientFilters.hasUnread = wrapper.querySelector('#clientFilterUnread').checked;
          state.pageSize = Math.max(1, Number(wrapper.querySelector('#clientFilterPageSize').value) || 25);
          state.page = 1;
          refreshClientsViewEnhanced();
          return true;
        }
      }]
    });
  }

  function patchVisibleStrings() {
    document.title = document.title
      .replace('â€”', '—')
      .replace('Painel do Consultor â€” Recupera Empresas', 'Painel do Consultor — Recupera Empresas');

    var shell = document.querySelector('[data-shell-header]');
    if (shell && shell.dataset) {
      shell.dataset.pageKicker = 'Operação';
    }

    document.querySelectorAll('.sidebar-label').forEach(function (label) {
      label.textContent = label.textContent
        .replace('VisÃ£o Geral', 'Visão Geral')
        .replace('OperaÃ§Ã£o', 'Operação');
    });

    var pageTitle = document.querySelector('.section-title');
    if (pageTitle && pageTitle.textContent.includes('GestÃ£o do Business Plan')) {
      pageTitle.textContent = 'Gestão do Business Plan';
    }
  }

  function bootstrap() {
    window.getFilteredClients = getFilteredClientsEnhanced;
    window.refreshClientsView = refreshClientsViewEnhanced;
    window.filterClients = filterClientsEnhanced;
    window.toggleAllVisibleClients = toggleAllVisibleClientsEnhanced;
    window.setClientPageSize = setClientPageSize;
    window.changeClientPage = changeClientPage;
    window.openClientFilters = openClientFiltersEnhanced;
    patchVisibleStrings();
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
