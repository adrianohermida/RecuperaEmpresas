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

  function getFilteredClients() {
    return typeof window.getFilteredClients === 'function' ? window.getFilteredClients() : getAllClients();
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
    var filtered = getFilteredClients();
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

  function filterClientsEnhanced() {
    if (document.getElementById('clientSearch')) {
      window._clientFilters.query = document.getElementById('clientSearch').value || '';
    }
    state.page = 1;
    refreshClientsViewEnhanced();
  }

  function toggleAllVisibleClientsEnhanced(checked) {
    var selection = getSelection();
    getPagedClients(getFilteredClients()).forEach(function (client) {
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

  function patchStrings() {
    var replacements = [
      ['[data-page-kicker]', 'Operação'],
      ['title', document.title.replace('â€”', '—')]
    ];

    var kicker = document.querySelector('[data-page-kicker]');
    if (kicker && kicker.dataset) kicker.dataset.pageKicker = 'Operação';

    document.querySelectorAll('.sidebar-label').forEach(function (label) {
      label.textContent = label.textContent
        .replace('VisÃ£o Geral', 'Visão Geral')
        .replace('OperaÃ§Ã£o', 'Operação');
    });
  }

  function bootstrap() {
    window.refreshClientsView = refreshClientsViewEnhanced;
    window.filterClients = filterClientsEnhanced;
    window.toggleAllVisibleClients = toggleAllVisibleClientsEnhanced;
    window.setClientPageSize = setClientPageSize;
    window.changeClientPage = changeClientPage;
    patchStrings();
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
