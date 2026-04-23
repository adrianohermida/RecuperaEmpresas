/**
 * admin-clients-redesign.js
 * Redesign UX Mobile-First — Módulo de Clientes
 * Injeta o novo shell HTML na sec-clients e conecta ao sistema existente
 */
(function () {
  'use strict';

  // ─── Utilitários ────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function statusLabel(s) {
    var map = {
      em_andamento: 'Em andamento',
      concluido: 'Concluído',
      nao_iniciado: 'Não iniciado',
      arquivado: 'Arquivado',
    };
    return map[s] || s || '—';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var now = new Date();
      var diff = Math.floor((now - d) / 86400000);
      if (diff === 0) return 'Hoje';
      if (diff === 1) return 'Ontem';
      if (diff < 7) return diff + 'd atrás';
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    } catch (e) { return iso; }
  }

  // ─── Injeção do Shell HTML ───────────────────────────────────────────────────
  function injectShell(container) {
    // Cria o novo shell sem remover os elementos legados (eles ficam ocultos via CSS)
    var existing = container.querySelector('.clients-module-shell');
    if (existing) return; // já injetado

    var shell = document.createElement('div');
    shell.className = 'clients-module-shell';
    shell.innerHTML = buildShellHTML();

    // Insere no início da seção
    container.insertBefore(shell, container.firstChild);

    // Conecta eventos
    attachEvents(shell);
  }

  function buildShellHTML() {
    return `
      <!-- Header -->
      <div class="clients-header">
        <div class="clients-header-top">
          <div>
            <div class="clients-header-title">Clientes</div>
            <div class="clients-header-sub" id="redesignClientsSub">Carregando...</div>
          </div>
          <div class="clients-header-actions">
            <button class="clients-btn-new" type="button" onclick="openNewClientModal ? openNewClientModal() : null">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span class="clients-btn-label">Novo Cliente</span>
            </button>
          </div>
        </div>
        <!-- Barra de busca -->
        <div class="clients-search-bar">
          <div class="clients-search-input-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              id="redesignClientSearch"
              class="clients-search-input"
              placeholder="Buscar por nome, empresa ou e-mail..."
              autocomplete="off"
              oninput="window.REClientsRedesign.onSearch(this.value)"
            />
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="clients-stats-grid" id="redesignStatsGrid">
        <div class="clients-stat-card">
          <div class="clients-stat-icon blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="clients-stat-body">
            <div class="clients-stat-value" id="redesignsTotalClients">—</div>
            <div class="clients-stat-label">Total</div>
          </div>
        </div>
        <div class="clients-stat-card">
          <div class="clients-stat-icon blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="clients-stat-body">
            <div class="clients-stat-value" id="redesignsEmAndamento">—</div>
            <div class="clients-stat-label">Em andamento</div>
          </div>
        </div>
        <div class="clients-stat-card">
          <div class="clients-stat-icon green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div class="clients-stat-body">
            <div class="clients-stat-value" id="redesignsConcluido">—</div>
            <div class="clients-stat-label">Concluídos</div>
          </div>
        </div>
        <div class="clients-stat-card">
          <div class="clients-stat-icon amber">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="clients-stat-body">
            <div class="clients-stat-value" id="redesignsNaoIniciado">—</div>
            <div class="clients-stat-label">Não iniciados</div>
          </div>
        </div>
      </div>

      <!-- Bulk toolbar -->
      <div class="clients-bulk-toolbar" id="redesignBulkToolbar">
        <div class="clients-bulk-toolbar-info">
          <div class="clients-bulk-toolbar-title">Ações em lote</div>
          <div class="clients-bulk-toolbar-sub" id="redesignBulkSummary">Nenhum cliente selecionado.</div>
        </div>
        <div class="clients-bulk-toolbar-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openBulkClientPage && openBulkClientPage('support')">Chamados</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="openBulkClientPage && openBulkClientPage('tasks')">Tarefas</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="bulkAssignClients && bulkAssignClients()">Atribuir tarefa</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="bulkSetClientArchiveState && bulkSetClientArchiveState(true)">Arquivar</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="bulkSetClientArchiveState && bulkSetClientArchiveState(false)">Ativar</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="copySelectedClientEmails && copySelectedClientEmails()">Copiar e-mails</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="exportSelectedClients && exportSelectedClients('xlsx')">XLS</button>
          <button class="btn btn-danger-outline btn-sm" type="button" onclick="bulkDeleteClients && bulkDeleteClients()">Excluir</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="window.REClientsRedesign.clearSelection()">Limpar</button>
        </div>
      </div>

      <!-- Tabela/Card principal -->
      <div class="clients-table-card" id="redesignTableCard">
        <!-- Mobile: lista de cards -->
        <div class="clients-card-list" id="redesignCardList">
          <div class="clients-empty-state">
            <div class="clients-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            </div>
            <div class="clients-empty-title">Carregando clientes...</div>
          </div>
        </div>
        <!-- Desktop: tabela -->
        <div class="clients-table-wrap">
          <table class="clients-table" id="redesignTable">
            <thead>
              <tr>
                <th class="col-check">
                  <input type="checkbox" id="redesignSelectAll" aria-label="Selecionar todos" onchange="window.REClientsRedesign.toggleAll(this.checked)"/>
                </th>
                <th>Empresa / Cliente</th>
                <th class="col-status">Status</th>
                <th class="col-progress">Progresso</th>
                <th>Etapa</th>
                <th class="col-activity">Última atividade</th>
                <th class="col-tasks">Tarefas</th>
                <th class="col-msgs">Msgs</th>
                <th class="col-actions">Ações</th>
              </tr>
            </thead>
            <tbody id="redesignTableBody">
              <tr><td colspan="9" style="text-align:center;padding:2rem;color:#94a3b8">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
        <!-- Paginação -->
        <div class="clients-pagination" id="redesignPagination">
          <div class="clients-pagination-info" id="redesignPaginationInfo">Carregando...</div>
          <div class="clients-pagination-controls">
            <div class="clients-page-size-wrap">
              <span class="clients-page-size-label">Por página</span>
              <select class="clients-page-size-select" id="redesignPageSize" onchange="setClientPageSize && setClientPageSize(this.value)">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <button class="clients-pagination-btn" id="redesignPagePrev" type="button" onclick="changeClientPage && changeClientPage(-1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="clients-page-indicator" id="redesignPageIndicator">Página 1</span>
            <button class="clients-pagination-btn" id="redesignPageNext" type="button" onclick="changeClientPage && changeClientPage(1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ─── Eventos ─────────────────────────────────────────────────────────────────
  var _searchDebounce = null;

  function attachEvents(shell) {
    // Sincroniza busca com o sistema legado
    var searchInput = shell.querySelector('#redesignClientSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(function () {
          // Propaga para o input legado e dispara filterClients
          var legacyInput = document.getElementById('clientSearch');
          if (legacyInput) {
            legacyInput.value = searchInput.value;
          }
          if (typeof filterClients === 'function') filterClients();
        }, 280);
      });
    }
  }

  // ─── Sincronização com o sistema legado ──────────────────────────────────────
  // Observa mudanças nos elementos legados e espelha no novo shell
  function syncStats() {
    var map = {
      sTotalClients: 'redesignsTotalClients',
      sConcluido: 'redesignsConcluido',
      sEmAndamento: 'redesignsEmAndamento',
      sNaoIniciado: 'redesignsNaoIniciado',
    };
    Object.keys(map).forEach(function (legacyId) {
      var legacyEl = document.getElementById(legacyId);
      var newEl = document.getElementById(map[legacyId]);
      if (legacyEl && newEl) {
        newEl.textContent = legacyEl.textContent;
      }
    });
  }

  function syncPagination() {
    var legacySummary = document.getElementById('clientPaginationSummary');
    var newInfo = document.getElementById('redesignPaginationInfo');
    if (legacySummary && newInfo) {
      newInfo.textContent = legacySummary.textContent;
    }

    var legacyIndicator = document.getElementById('clientPageIndicator');
    var newIndicator = document.getElementById('redesignPageIndicator');
    if (legacyIndicator && newIndicator) {
      newIndicator.textContent = legacyIndicator.textContent;
    }

    var legacyPrev = document.getElementById('clientPagePrev');
    var newPrev = document.getElementById('redesignPagePrev');
    if (legacyPrev && newPrev) {
      newPrev.disabled = legacyPrev.disabled;
    }

    var legacyNext = document.getElementById('clientPageNext');
    var newNext = document.getElementById('redesignPageNext');
    if (legacyNext && newNext) {
      newNext.disabled = legacyNext.disabled;
    }
  }

  function syncSub() {
    var legacySub = document.getElementById('clientsSub');
    var newSub = document.getElementById('redesignClientsSub');
    if (legacySub && newSub) {
      newSub.textContent = legacySub.textContent;
    }
  }

  function syncBulkToolbar() {
    var legacyToolbar = document.getElementById('clientBulkToolbar');
    var newToolbar = document.getElementById('redesignBulkToolbar');
    if (!legacyToolbar || !newToolbar) return;

    var hasSelection = legacyToolbar.classList.contains('has-selection');
    newToolbar.classList.toggle('has-selection', hasSelection);

    var legacySummary = document.getElementById('clientBulkSummary');
    var newSummary = document.getElementById('redesignBulkSummary');
    if (legacySummary && newSummary) {
      newSummary.textContent = legacySummary.textContent;
    }
  }

  // Sincroniza a tabela legada com o novo shell
  function syncTable() {
    var legacyTbody = document.getElementById('clientTableBody');
    var newTbody = document.getElementById('redesignTableBody');
    var newCardList = document.getElementById('redesignCardList');

    if (!legacyTbody) return;

    // Copia o conteúdo da tabela legada para a nova tabela
    if (newTbody) {
      newTbody.innerHTML = legacyTbody.innerHTML;
      // Aplica classes novas nas linhas
      Array.from(newTbody.querySelectorAll('tr')).forEach(function (tr) {
        tr.classList.add('clients-table-row');
      });
    }

    // Gera os cards mobile a partir das linhas da tabela
    if (newCardList) {
      renderCardList(legacyTbody, newCardList);
    }
  }

  function renderCardList(legacyTbody, cardList) {
    var rows = Array.from(legacyTbody.querySelectorAll('tr[data-id], tr[data-client-id]'));

    if (rows.length === 0) {
      // Verifica se é mensagem de carregando ou vazio
      var firstRow = legacyTbody.querySelector('tr');
      var msg = firstRow ? firstRow.textContent.trim() : 'Carregando...';
      cardList.innerHTML = `
        <div class="clients-empty-state">
          <div class="clients-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <div class="clients-empty-title">${esc(msg)}</div>
        </div>`;
      return;
    }

    cardList.innerHTML = rows.map(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 3) return '';

      var clientId = row.dataset.id || row.dataset.clientId || '';
      var nameCell = cells[1] ? cells[1].textContent.trim() : '—';
      var statusCell = cells[2] ? cells[2].textContent.trim() : '—';
      var progressCell = cells[3] ? cells[3].textContent.trim() : '';
      var stepCell = cells[4] ? cells[4].textContent.trim() : '—';
      var activityCell = cells[5] ? cells[5].textContent.trim() : '—';
      var tasksCell = cells[6] ? cells[6].textContent.trim() : '—';

      // Extrai o nome real do link se houver
      var nameLink = cells[1] ? cells[1].querySelector('a, button') : null;
      var displayName = nameLink ? nameLink.textContent.trim() : nameCell;

      // Extrai progresso numérico
      var pctMatch = progressCell.match(/(\d+)/);
      var pct = pctMatch ? parseInt(pctMatch[1]) : 0;

      // Extrai status class
      var statusText = statusCell.toLowerCase().replace(/\s+/g, '_').replace(/[áàã]/g, 'a').replace(/[éê]/g, 'e').replace(/[í]/g, 'i').replace(/[óô]/g, 'o').replace(/[ú]/g, 'u');

      // Checkbox
      var checkInput = row.querySelector('input[type="checkbox"]');
      var isChecked = checkInput ? checkInput.checked : false;
      var checkId = checkInput ? checkInput.id : '';

      return `
        <div class="clients-card-item" data-id="${esc(clientId)}" onclick="window.REClientsRedesign.openClient('${esc(clientId)}', event)">
          <div class="clients-card-check" onclick="event.stopPropagation()">
            <input type="checkbox" ${isChecked ? 'checked' : ''} data-client-id="${esc(clientId)}" onchange="window.REClientsRedesign.onCardCheck(this, '${esc(clientId)}')"/>
          </div>
          <div class="clients-card-avatar">${esc(initials(displayName))}</div>
          <div class="clients-card-body">
            <div class="clients-card-name">${esc(displayName)}</div>
            <div class="clients-card-meta">
              <span class="clients-badge status-${esc(statusText)}">${esc(statusLabel(statusText))}</span>
              <span class="clients-card-meta-item">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                ${esc(stepCell)}
              </span>
              <span class="clients-card-meta-item">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${esc(activityCell)}
              </span>
              ${tasksCell && tasksCell !== '—' && tasksCell !== '0' ? `<span class="clients-card-meta-item" style="color:#d97706">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/></svg>
                ${esc(tasksCell)} tarefas
              </span>` : ''}
            </div>
            ${pct > 0 ? `
            <div class="clients-card-progress-wrap">
              <div class="clients-card-progress-bar">
                <div class="clients-card-progress-fill" style="width:${pct}%"></div>
              </div>
              <span class="clients-card-progress-pct">${pct}%</span>
            </div>` : ''}
          </div>
          <div class="clients-card-foot">
            <button class="clients-action-btn" type="button" title="Ver detalhes" onclick="event.stopPropagation(); window.REClientsRedesign.openClient('${esc(clientId)}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // ─── Ações ───────────────────────────────────────────────────────────────────
  function openClient(clientId, event) {
    if (event && event.target.closest('input[type="checkbox"]')) return;
    // Delega para o sistema legado
    var legacyRow = document.querySelector('#clientTableBody tr[data-id="' + clientId + '"]');
    if (legacyRow) {
      var link = legacyRow.querySelector('a[href*="/cliente/"], button.admin-client-primary-link');
      if (link) { link.click(); return; }
    }
    // Fallback: navega direto
    if (clientId) window.location.href = '/cliente/' + clientId;
  }

  function onCardCheck(checkbox, clientId) {
    // Sincroniza com o checkbox da tabela legada
    var legacyRow = document.querySelector('#clientTableBody tr[data-id="' + clientId + '"]');
    if (legacyRow) {
      var legacyCheck = legacyRow.querySelector('input[type="checkbox"]');
      if (legacyCheck) {
        legacyCheck.checked = checkbox.checked;
        legacyCheck.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // Também chama toggleClientSelection se disponível
    if (typeof toggleClientSelection === 'function') {
      toggleClientSelection(clientId, checkbox.checked);
    }
  }

  function toggleAll(checked) {
    // Delega para o sistema legado
    var legacySelectAll = document.getElementById('clientSelectAll');
    if (legacySelectAll) {
      legacySelectAll.checked = checked;
      legacySelectAll.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof toggleAllVisibleClients === 'function') {
      toggleAllVisibleClients(checked);
    }
  }

  function clearSelection() {
    if (typeof clearSelectedClients === 'function') clearSelectedClients();
    var toolbar = document.getElementById('redesignBulkToolbar');
    if (toolbar) toolbar.classList.remove('has-selection');
  }

  function onSearch(value) {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(function () {
      var legacyInput = document.getElementById('clientSearch');
      if (legacyInput) legacyInput.value = value;
      if (typeof filterClients === 'function') filterClients();
    }, 280);
  }

  // ─── MutationObserver para sincronização em tempo real ───────────────────────
  var _observer = null;

  function startObserver() {
    if (_observer) return;

    var targets = [
      document.getElementById('clientTableBody'),
      document.getElementById('clientsSub'),
      document.getElementById('clientBulkToolbar'),
      document.getElementById('clientPaginationSummary'),
      document.getElementById('clientPageIndicator'),
      document.getElementById('sTotalClients'),
    ].filter(Boolean);

    _observer = new MutationObserver(function () {
      syncStats();
      syncPagination();
      syncSub();
      syncBulkToolbar();
      syncTable();
    });

    targets.forEach(function (el) {
      _observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  }

  // ─── Inicialização ───────────────────────────────────────────────────────────
  function init() {
    var container = document.getElementById('sec-clients');
    if (!container) return;

    injectShell(container);
    syncStats();
    syncPagination();
    syncSub();
    syncBulkToolbar();
    syncTable();
    startObserver();

    console.info('[RE:clients-redesign] initialized');
  }

  // ─── Exposição Global ─────────────────────────────────────────────────────────
  window.REClientsRedesign = {
    init: init,
    syncStats: syncStats,
    syncTable: syncTable,
    openClient: openClient,
    onCardCheck: onCardCheck,
    toggleAll: toggleAll,
    clearSelection: clearSelection,
    onSearch: onSearch,
  };

  window.initClientsRedesign = init;

  // Auto-init quando a seção de clientes for exibida
  document.addEventListener('DOMContentLoaded', function () {
    // Se a seção já está ativa, inicializa imediatamente
    var sec = document.getElementById('sec-clients');
    if (sec && sec.classList.contains('active')) {
      setTimeout(init, 100);
    }
  });

  console.info('[RE:clients-redesign] loaded');
})();
