/**
 * admin-fiscal-notes.js
 * Módulo de Notas Fiscais para o Painel do Consultor (Admin)
 * Renderiza: sec-notasFiscais (visão geral de todos os clientes) e aba individual do cliente
 */
(function () {
  'use strict';

  const API = window.RE_API_BASE || '';
  const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';

  // ─── Utilitários ──────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('re_token') || '';
  }

  function fmt(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
  }

  function statusBadge(status) {
    const map = {
      emitida: 'badge-success',
      cancelada: 'badge-danger',
      pendente: 'badge-warning',
      substituida: 'badge-secondary',
    };
    const cls = map[status] || 'badge-secondary';
    return `<span class="badge ${cls}">${status || '—'}</span>`;
  }

  function typeBadge(tipo) {
    const map = {
      'NFS-e': 'badge-primary',
      'NF-e': 'badge-info',
      'CT-e': 'badge-warning',
      'NF-Produto': 'badge-secondary',
      'NF-Consumidor': 'badge-secondary',
    };
    const cls = map[tipo] || 'badge-secondary';
    return `<span class="badge ${cls}">${tipo || '—'}</span>`;
  }

  function loadChartJs(cb) {
    if (window.Chart) { cb(); return; }
    const s = document.createElement('script');
    s.src = CHART_CDN;
    s.onload = cb;
    document.head.appendChild(s);
  }

  // ─── API Calls ────────────────────────────────────────────────────────────
  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchStats(clientId) {
    const qs = clientId ? `?clientId=${clientId}` : '';
    return apiFetch(`/api/fiscal-notes/stats${qs}`);
  }

  async function fetchNotes(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/fiscal-notes?${qs}`);
  }

  // ─── Renderização Principal (sec-notasFiscais no Admin) ───────────────────
  async function initAdminFiscalNotes() {
    const container = document.getElementById('sec-notasFiscais');
    if (!container) return;

    container.innerHTML = `
      <div class="admin-section-header" style="padding:1.5rem 1.5rem 0">
        <h2 class="admin-section-title">Notas Fiscais — Visão Geral</h2>
        <p class="admin-section-subtitle" style="color:#64748b;font-size:0.875rem;margin-top:0.25rem">
          Gerencie e visualize as notas fiscais de todos os clientes
        </p>
      </div>
      <div id="adminFnBody" style="padding:1.5rem">
        <div class="fn-loading">Carregando dados fiscais...</div>
      </div>`;

    await loadAdminFiscalNotes();
  }

  async function loadAdminFiscalNotes() {
    const body = document.getElementById('adminFnBody');
    if (!body) return;
    body.innerHTML = '<div class="fn-loading">Carregando...</div>';

    try {
      const [statsRes, notesRes] = await Promise.all([
        fetchStats(null),
        fetchNotes({ limit: 50, offset: 0 }),
      ]);

      const stats = statsRes.data || {};
      const notes = notesRes.data || [];
      const total = notesRes.total || 0;

      body.innerHTML = buildAdminView(stats, notes, total);
      loadChartJs(() => renderAdminCharts(stats));
      attachAdminEvents();
    } catch (err) {
      body.innerHTML = `<div class="fn-error"><strong>Erro ao carregar notas fiscais.</strong><br><small>${err.message}</small></div>`;
    }
  }

  function buildAdminView(stats, notes, total) {
    const monthly = stats.monthly || [];
    const byType = stats.byType || [];

    return `
      <!-- Cards de resumo -->
      <div class="fn-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="fn-card">
          <div class="fn-card-label">Total de Notas</div>
          <div class="fn-card-value">${stats.totalNotes || 0}</div>
        </div>
        <div class="fn-card">
          <div class="fn-card-label">Total Faturado</div>
          <div class="fn-card-value">${fmt(stats.totalBruto)}</div>
        </div>
        <div class="fn-card">
          <div class="fn-card-label">Valor Líquido</div>
          <div class="fn-card-value">${fmt(stats.totalLiquido)}</div>
        </div>
        <div class="fn-card">
          <div class="fn-card-label">Total ISSQN</div>
          <div class="fn-card-value">${fmt(stats.totalIssqn)}</div>
        </div>
      </div>

      <!-- Gráficos -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
        <div class="fn-chart-card">
          <h4 class="fn-chart-title">Faturamento Mensal</h4>
          <canvas id="adminFnChartMonthly" height="220"></canvas>
        </div>
        <div class="fn-chart-card">
          <h4 class="fn-chart-title">Distribuição por Tipo</h4>
          <canvas id="adminFnChartType" height="220"></canvas>
        </div>
      </div>

      <!-- Filtros e tabela -->
      <div class="fn-filters" style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center">
        <input id="adminFnSearch" type="text" class="portal-input" placeholder="Buscar nota, CNPJ, emitente..." style="flex:1;min-width:200px;max-width:320px">
        <select id="adminFnFilterType" class="portal-input" style="min-width:140px">
          <option value="">Todos os tipos</option>
          <option value="NFS-e">NFS-e</option>
          <option value="NF-e">NF-e</option>
          <option value="CT-e">CT-e</option>
          <option value="NF-Produto">NF-Produto</option>
        </select>
        <select id="adminFnFilterStatus" class="portal-input" style="min-width:140px">
          <option value="">Todos os status</option>
          <option value="emitida">Emitida</option>
          <option value="cancelada">Cancelada</option>
          <option value="pendente">Pendente</option>
        </select>
        <button class="btn btn-secondary btn-sm" onclick="window.REAdminFiscalNotes.applyFilters()">Filtrar</button>
      </div>

      <div class="fn-table-wrapper" style="overflow-x:auto">
        <table class="portal-table fn-table" style="width:100%;min-width:900px">
          <thead>
            <tr>
              <th>Nº Nota</th>
              <th>Tipo</th>
              <th>Emitente</th>
              <th>Tomador</th>
              <th>Emissão</th>
              <th>Valor Bruto</th>
              <th>Valor Líquido</th>
              <th>ISSQN</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="adminFnTableBody">
            ${buildTableRows(notes)}
          </tbody>
        </table>
      </div>
      <div id="adminFnPagination" style="margin-top:1rem;text-align:right;color:#64748b;font-size:0.875rem">
        Exibindo ${notes.length} de ${total} notas
      </div>`;
  }

  function buildTableRows(notes) {
    if (!notes || notes.length === 0) {
      return '<tr><td colspan="10" style="text-align:center;padding:2rem;color:#94a3b8">Nenhuma nota fiscal encontrada</td></tr>';
    }
    return notes.map(n => `
      <tr>
        <td><strong>${n.numero_nota || '—'}</strong></td>
        <td>${typeBadge(n.tipo_nota)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${n.emitente_nome || ''}">${n.emitente_nome || '—'}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${n.tomador_nome || ''}">${n.tomador_nome || '—'}</td>
        <td>${fmtDate(n.data_emissao)}</td>
        <td>${fmt(n.valor_bruto)}</td>
        <td>${fmt(n.valor_liquido)}</td>
        <td>${fmt(n.issqn_valor)}</td>
        <td>${statusBadge(n.status)}</td>
        <td>
          ${n.pdf_url ? `<a href="${n.pdf_url}" target="_blank" class="btn btn-ghost btn-sm" title="Ver PDF">📄</a>` : ''}
        </td>
      </tr>`).join('');
  }

  function renderAdminCharts(stats) {
    const monthly = stats.monthly || [];
    const byType = stats.byType || [];

    // Gráfico de faturamento mensal
    const ctxMonthly = document.getElementById('adminFnChartMonthly');
    if (ctxMonthly && monthly.length > 0) {
      new window.Chart(ctxMonthly, {
        type: 'bar',
        data: {
          labels: monthly.map(m => m.mes || m.month || ''),
          datasets: [{
            label: 'Faturamento Bruto',
            data: monthly.map(m => parseFloat(m.total_bruto) || 0),
            backgroundColor: 'rgba(29, 78, 216, 0.7)',
            borderRadius: 6,
          }, {
            label: 'Valor Líquido',
            data: monthly.map(m => parseFloat(m.total_liquido) || 0),
            backgroundColor: 'rgba(16, 185, 129, 0.7)',
            borderRadius: 6,
          }],
        },
        options: { responsive: true, plugins: { legend: { position: 'top' } } },
      });
    }

    // Gráfico de distribuição por tipo
    const ctxType = document.getElementById('adminFnChartType');
    if (ctxType && byType.length > 0) {
      new window.Chart(ctxType, {
        type: 'doughnut',
        data: {
          labels: byType.map(t => t.tipo_nota || t.tipo || ''),
          datasets: [{
            data: byType.map(t => parseInt(t.count) || 0),
            backgroundColor: ['#1d4ed8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
          }],
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
      });
    }
  }

  function attachAdminEvents() {
    const searchEl = document.getElementById('adminFnSearch');
    if (searchEl) {
      searchEl.addEventListener('keydown', e => { if (e.key === 'Enter') window.REAdminFiscalNotes.applyFilters(); });
    }
  }

  async function applyFilters() {
    const search = document.getElementById('adminFnSearch')?.value || '';
    const tipo = document.getElementById('adminFnFilterType')?.value || '';
    const status = document.getElementById('adminFnFilterStatus')?.value || '';
    const tbody = document.getElementById('adminFnTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:1rem">Filtrando...</td></tr>';

    try {
      const params = { limit: 100, offset: 0 };
      if (search) params.search = search;
      if (tipo) params.tipo = tipo;
      if (status) params.status = status;
      const res = await fetchNotes(params);
      const notes = res.data || [];
      if (tbody) tbody.innerHTML = buildTableRows(notes);
      const pag = document.getElementById('adminFnPagination');
      if (pag) pag.textContent = `Exibindo ${notes.length} de ${res.total || notes.length} notas`;
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#ef4444">Erro ao filtrar: ${err.message}</td></tr>`;
    }
  }

  // ─── Aba do Cliente Individual (cliente.html) ─────────────────────────────
  async function renderClientTab({ body, clientId, user }) {
    if (!body) return;
    body.innerHTML = '<div class="fn-loading" style="padding:2rem">Carregando notas fiscais do cliente...</div>';

    try {
      const [statsRes, notesRes] = await Promise.all([
        fetchStats(clientId),
        fetchNotes({ clientId, limit: 30, offset: 0 }),
      ]);

      const stats = statsRes.data || {};
      const notes = notesRes.data || [];
      const total = notesRes.total || 0;

      body.innerHTML = `
        <div style="padding:1rem">
          <div class="fn-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-bottom:1.25rem">
            <div class="fn-card"><div class="fn-card-label">Notas</div><div class="fn-card-value">${stats.totalNotes || 0}</div></div>
            <div class="fn-card"><div class="fn-card-label">Faturado</div><div class="fn-card-value">${fmt(stats.totalBruto)}</div></div>
            <div class="fn-card"><div class="fn-card-label">Líquido</div><div class="fn-card-value">${fmt(stats.totalLiquido)}</div></div>
            <div class="fn-card"><div class="fn-card-label">ISSQN</div><div class="fn-card-value">${fmt(stats.totalIssqn)}</div></div>
          </div>
          <div class="fn-chart-card" style="margin-bottom:1.25rem">
            <h4 class="fn-chart-title">Faturamento Mensal</h4>
            <canvas id="clientFnChartMonthly" height="160"></canvas>
          </div>
          <div class="fn-table-wrapper" style="overflow-x:auto">
            <table class="portal-table fn-table" style="width:100%;min-width:700px">
              <thead>
                <tr>
                  <th>Nº Nota</th><th>Tipo</th><th>Emitente</th><th>Emissão</th>
                  <th>Valor Bruto</th><th>Líquido</th><th>ISSQN</th><th>Status</th><th>PDF</th>
                </tr>
              </thead>
              <tbody>${buildClientTableRows(notes)}</tbody>
            </table>
          </div>
          <div style="margin-top:0.75rem;text-align:right;color:#64748b;font-size:0.8rem">
            Exibindo ${notes.length} de ${total} notas
          </div>
        </div>`;

      loadChartJs(() => {
        const monthly = stats.monthly || [];
        const ctx = document.getElementById('clientFnChartMonthly');
        if (ctx && monthly.length > 0) {
          new window.Chart(ctx, {
            type: 'bar',
            data: {
              labels: monthly.map(m => m.mes || m.month || ''),
              datasets: [{
                label: 'Faturamento',
                data: monthly.map(m => parseFloat(m.total_bruto) || 0),
                backgroundColor: 'rgba(29, 78, 216, 0.7)',
                borderRadius: 4,
              }],
            },
            options: { responsive: true, plugins: { legend: { display: false } } },
          });
        }
      });
    } catch (err) {
      body.innerHTML = `<div class="fn-error" style="padding:2rem"><strong>Erro ao carregar notas fiscais.</strong><br><small>${err.message}</small></div>`;
    }
  }

  function buildClientTableRows(notes) {
    if (!notes || notes.length === 0) {
      return '<tr><td colspan="9" style="text-align:center;padding:1.5rem;color:#94a3b8">Nenhuma nota fiscal cadastrada para este cliente</td></tr>';
    }
    return notes.map(n => `
      <tr>
        <td><strong>${n.numero_nota || '—'}</strong></td>
        <td>${typeBadge(n.tipo_nota)}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.emitente_nome || '—'}</td>
        <td>${fmtDate(n.data_emissao)}</td>
        <td>${fmt(n.valor_bruto)}</td>
        <td>${fmt(n.valor_liquido)}</td>
        <td>${fmt(n.issqn_valor)}</td>
        <td>${statusBadge(n.status)}</td>
        <td>${n.pdf_url ? `<a href="${n.pdf_url}" target="_blank" class="btn btn-ghost btn-sm">📄</a>` : '—'}</td>
      </tr>`).join('');
  }

  // ─── Exposição Global ─────────────────────────────────────────────────────
  window.REAdminFiscalNotes = {
    init: initAdminFiscalNotes,
    load: loadAdminFiscalNotes,
    applyFilters,
    renderClientTab,
  };

  window.initAdminFiscalNotes = initAdminFiscalNotes;
  window.loadAdminFiscalNotes = loadAdminFiscalNotes;

  console.info('[RE:admin-fiscal-notes] loaded');
})();
