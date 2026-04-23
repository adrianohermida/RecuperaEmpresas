/**
 * ─── Módulo de Notas Fiscais — Frontend ──────────────────────────────────────
 * Dashboard do cliente: seção de notas fiscais
 * Funcionalidades:
 *   - Upload drag-and-drop de PDFs com extração automática
 *   - Importação de planilhas XLS/XLSX/CSV com preview
 *   - Tabela de notas com filtros, busca e paginação
 *   - Gráficos demonstrativos com Chart.js
 *   - Modal de detalhes e edição de nota
 *   - Formulário de cadastro manual
 */

/* global Chart, RE_API, showToast */
'use strict';

// ─── Estado do módulo ─────────────────────────────────────────────────────────
const FN = {
  notes:       [],
  stats:       null,
  charts:      {},
  page:        1,
  limit:       20,
  total:       0,
  filters:     { tipo_nota: '', status: '', search: '', sort: 'data_emissao', order: 'desc' },
  loading:     false,
  activeTab:   'lista', // 'lista' | 'graficos'
  editingId:   null,
};

// ─── Inicialização ────────────────────────────────────────────────────────────
async function initFiscalNotes() {
  renderFiscalNotesUI();
  await Promise.all([loadFiscalNotes(), loadFiscalStats()]);
  initChartJS();
}

// ─── Renderizar UI completa ───────────────────────────────────────────────────
function renderFiscalNotesUI() {
  const sec = document.getElementById('sec-notas-fiscais');
  if (!sec) return;

  sec.innerHTML = `
    <!-- Header da seção -->
    <div class="section-header">
      <div>
        <div class="section-title">Notas Fiscais</div>
        <div class="section-sub">Gerencie suas notas fiscais, importe planilhas e acompanhe o desempenho financeiro</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="FN_openImportModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Importar Planilha
        </button>
        <button class="btn btn-outline btn-sm" onclick="FN_openUploadModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Upload PDF
        </button>
        <button class="btn btn-primary btn-sm" onclick="FN_openManualModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova Nota
        </button>
      </div>
    </div>

    <!-- Cards de resumo -->
    <div class="stats-grid stats-grid-4" id="fn-stats-grid">
      <div class="stat-card blue">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="stat-value" id="fn-stat-total">—</div>
        <div class="stat-label">Total de notas</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div class="stat-value" id="fn-stat-servico">—</div>
        <div class="stat-label">Total faturado</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="stat-value" id="fn-stat-liquido">—</div>
        <div class="stat-label">Valor líquido</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div class="stat-value" id="fn-stat-issqn">—</div>
        <div class="stat-label">Total ISSQN</div>
      </div>
    </div>

    <!-- Tabs: Lista / Gráficos -->
    <div class="filter-tabs" style="margin-bottom:20px;" id="fn-tabs">
      <button class="filter-tab active" onclick="FN_switchTab('lista',this)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:5px;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Lista de Notas
      </button>
      <button class="filter-tab" onclick="FN_switchTab('graficos',this)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:5px;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Gráficos
      </button>
    </div>

    <!-- Painel: Lista de Notas -->
    <div id="fn-panel-lista">
      <!-- Toolbar de filtros -->
      <div class="actions-toolbar">
        <div class="search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" id="fn-search" placeholder="Buscar por número, emitente, CNPJ..." oninput="FN_onSearch(this.value)"/>
        </div>
        <select class="form-control" style="width:auto;min-width:140px;" onchange="FN_setFilter('tipo_nota',this.value)">
          <option value="">Todos os tipos</option>
          <option value="NFS-e">NFS-e</option>
          <option value="NF-e">NF-e</option>
          <option value="NF-Produto">NF-Produto</option>
          <option value="CT-e">CT-e</option>
          <option value="Outros">Outros</option>
        </select>
        <select class="form-control" style="width:auto;min-width:130px;" onchange="FN_setFilter('status',this.value)">
          <option value="">Todos os status</option>
          <option value="processado">Processado</option>
          <option value="pendente">Pendente</option>
          <option value="erro">Erro</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select class="form-control" style="width:auto;min-width:160px;" onchange="FN_setSort(this.value)">
          <option value="data_emissao_desc">Data (mais recente)</option>
          <option value="data_emissao_asc">Data (mais antiga)</option>
          <option value="valor_liquido_desc">Valor (maior)</option>
          <option value="valor_liquido_asc">Valor (menor)</option>
        </select>
      </div>

      <!-- Tabela de notas -->
      <div class="portal-card">
        <div class="portal-card-header">
          <span class="portal-card-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Notas Fiscais
          </span>
          <span class="badge badge-gray" id="fn-count-badge">0 notas</span>
        </div>
        <div class="nfe-table-wrap">
          <table class="nfe-table" id="fn-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Tipo</th>
                <th>Emitente</th>
                <th>Competência</th>
                <th>Data Emissão</th>
                <th>Valor Serviço</th>
                <th>Valor Líquido</th>
                <th>ISSQN</th>
                <th>Status</th>
                <th>Arquivo</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="fn-tbody">
              <tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted);">
                <div class="spinner" style="margin:0 auto 12px;"></div>
                Carregando notas fiscais...
              </td></tr>
            </tbody>
          </table>
        </div>
        <!-- Paginação -->
        <div id="fn-pagination" style="padding:12px 16px;border-top:1px solid var(--border);"></div>
      </div>
    </div>

    <!-- Painel: Gráficos -->
    <div id="fn-panel-graficos" style="display:none;">
      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Faturamento Mensal</div>
              <div class="chart-card-sub">Valor total de notas por mês</div>
            </div>
          </div>
          <div class="chart-container" style="height:240px;">
            <canvas id="fn-chart-monthly"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Distribuição por Tipo</div>
              <div class="chart-card-sub">NFS-e, NF-e e outros</div>
            </div>
          </div>
          <div class="chart-container" style="height:240px;">
            <canvas id="fn-chart-tipos"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Carga Tributária</div>
              <div class="chart-card-sub">ISSQN + Tributos federais por mês</div>
            </div>
          </div>
          <div class="chart-container" style="height:240px;">
            <canvas id="fn-chart-tributos"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Status das Notas</div>
              <div class="chart-card-sub">Distribuição por situação</div>
            </div>
          </div>
          <div class="chart-container" style="height:240px;">
            <canvas id="fn-chart-status"></canvas>
          </div>
        </div>
      </div>
      <!-- Top emitentes -->
      <div class="chart-card">
        <div class="chart-card-header">
          <div>
            <div class="chart-card-title">Top 10 Emitentes</div>
            <div class="chart-card-sub">Maiores fornecedores/prestadores por valor líquido</div>
          </div>
        </div>
        <div class="chart-container" style="height:300px;">
          <canvas id="fn-chart-emitentes"></canvas>
        </div>
      </div>
      <!-- Evolução do valor líquido -->
      <div class="chart-card">
        <div class="chart-card-header">
          <div>
            <div class="chart-card-title">Evolução do Valor Líquido</div>
            <div class="chart-card-sub">Valor líquido ao longo do tempo</div>
          </div>
        </div>
        <div class="chart-container" style="height:220px;">
          <canvas id="fn-chart-evolucao"></canvas>
        </div>
      </div>
    </div>
  `;
}

// ─── Carregar notas do servidor ───────────────────────────────────────────────
async function loadFiscalNotes() {
  FN.loading = true;
  try {
    const params = new URLSearchParams({
      page:  FN.page,
      limit: FN.limit,
      sort:  FN.filters.sort,
      order: FN.filters.order,
    });
    if (FN.filters.tipo_nota) params.set('tipo_nota', FN.filters.tipo_nota);
    if (FN.filters.status)    params.set('status',    FN.filters.status);
    if (FN.filters.search)    params.set('search',    FN.filters.search);

    const res = await fetch(`/api/fiscal-notes?${params}`, {
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao carregar notas');

    FN.notes = data.notes || [];
    FN.total = data.total || 0;
    renderNotesTable();
    renderPagination();
    updateStatCards();
  } catch (err) {
    console.error('[FiscalNotes] loadFiscalNotes:', err);
    const tbody = document.getElementById('fn-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--error);">Erro ao carregar notas fiscais.</td></tr>`;
  } finally {
    FN.loading = false;
  }
}

// ─── Carregar estatísticas ────────────────────────────────────────────────────
async function loadFiscalStats() {
  try {
    const res = await fetch('/api/fiscal-notes/stats?months=12', {
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    FN.stats = data;
    updateStatCards();
    if (FN.activeTab === 'graficos') renderCharts();
  } catch (err) {
    console.error('[FiscalNotes] loadFiscalStats:', err);
  }
}

// ─── Atualizar cards de resumo ────────────────────────────────────────────────
function updateStatCards() {
  const s = FN.stats?.summary;
  if (!s) return;

  const el = id => document.getElementById(id);
  if (el('fn-stat-total'))   el('fn-stat-total').textContent   = s.total_notas || 0;
  if (el('fn-stat-servico')) el('fn-stat-servico').textContent = s.total_servico_fmt || 'R$ 0,00';
  if (el('fn-stat-liquido')) el('fn-stat-liquido').textContent = s.total_liquido_fmt || 'R$ 0,00';
  if (el('fn-stat-issqn'))   el('fn-stat-issqn').textContent   = s.total_issqn_fmt   || 'R$ 0,00';
}

// ─── Renderizar tabela de notas ───────────────────────────────────────────────
function renderNotesTable() {
  const tbody = document.getElementById('fn-tbody');
  const badge = document.getElementById('fn-count-badge');
  if (!tbody) return;

  if (badge) badge.textContent = `${FN.total} nota${FN.total !== 1 ? 's' : ''}`;

  if (FN.notes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11">
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="empty-state-title">Nenhuma nota fiscal encontrada</div>
            <div class="empty-state-desc">Faça upload de um PDF, importe uma planilha ou cadastre manualmente.</div>
            <button class="btn btn-primary btn-sm" onclick="FN_openUploadModal()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar primeira nota
            </button>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = FN.notes.map(n => `
    <tr class="fn-row" data-id="${n.id}">
      <td><span class="nfe-numero">${n.numero_nfe || '—'}</span></td>
      <td><span class="badge ${FN_tipoBadge(n.tipo_nota)}">${n.tipo_nota || '—'}</span></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${escHtml(n.emitente_razao_social || '—')}</div>
        ${n.emitente_cnpj ? `<div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${FN_formatCNPJ(n.emitente_cnpj)}</div>` : ''}
      </td>
      <td>${n.competencia || '—'}</td>
      <td>${FN_formatDate(n.data_emissao)}</td>
      <td class="nfe-valor">${n.valor_servico_fmt || '—'}</td>
      <td class="nfe-valor-liquido">${n.valor_liquido_fmt || '—'}</td>
      <td>${n.valor_issqn_fmt || '—'}</td>
      <td><span class="badge ${FN_statusBadge(n.status)}">${FN_statusLabel(n.status)}</span></td>
      <td>
        ${n.arquivo_path
          ? `<a href="/api/fiscal-notes/${n.id}/file?token=${RE_API.getToken()}" target="_blank" class="btn btn-ghost btn-xs" title="Ver PDF">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              PDF
            </a>`
          : '<span style="color:var(--text-light);font-size:12px;">—</span>'}
      </td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-xs" onclick="FN_openDetail('${n.id}')" title="Ver detalhes">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <button class="btn btn-ghost btn-xs" onclick="FN_openEdit('${n.id}')" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-xs" onclick="FN_deleteNote('${n.id}')" title="Excluir" style="color:var(--error);">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ─── Paginação ────────────────────────────────────────────────────────────────
function renderPagination() {
  const el = document.getElementById('fn-pagination');
  if (!el) return;
  const pages = Math.ceil(FN.total / FN.limit);
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  html += `<button class="page-btn" onclick="FN_goPage(${FN.page-1})" ${FN.page<=1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - FN.page) <= 2) {
      html += `<button class="page-btn ${i===FN.page?'active':''}" onclick="FN_goPage(${i})">${i}</button>`;
    } else if (Math.abs(i - FN.page) === 3) {
      html += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;
    }
  }
  html += `<button class="page-btn" onclick="FN_goPage(${FN.page+1})" ${FN.page>=pages?'disabled':''}>›</button>`;
  html += '</div>';
  el.innerHTML = html;
}

// ─── Gráficos com Chart.js ────────────────────────────────────────────────────
async function initChartJS() {
  if (window.Chart) return;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

function renderCharts() {
  if (!window.Chart || !FN.stats) return;

  const monthly     = FN.stats.monthly || [];
  const summary     = FN.stats.summary || {};
  const topEmitentes = FN.stats.topEmitentes || [];

  const labels = monthly.map(m => m.label);
  const colors = {
    primary:  '#1A56DB',
    success:  '#059669',
    warning:  '#D97706',
    error:    '#DC2626',
    purple:   '#7C3AED',
    teal:     '#0D9488',
    accent:   '#0EA5E9',
  };

  // Destruir gráficos anteriores
  Object.values(FN.charts).forEach(c => { try { c.destroy(); } catch {} });
  FN.charts = {};

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { size: 12, family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' } } },
      tooltip: { callbacks: {
        label: ctx => {
          const v = ctx.parsed.y ?? ctx.parsed;
          return ` ${typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : v}`;
        }
      }},
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: {
        font: { size: 11 },
        callback: v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }),
      }},
    },
  };

  // 1. Faturamento Mensal
  const ctxMonthly = document.getElementById('fn-chart-monthly');
  if (ctxMonthly) {
    FN.charts.monthly = new Chart(ctxMonthly, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Valor do Serviço',
            data: monthly.map(m => m.total_servico_f),
            backgroundColor: colors.primary + '33',
            borderColor: colors.primary,
            borderWidth: 2,
            borderRadius: 6,
          },
          {
            label: 'Valor Líquido',
            data: monthly.map(m => m.total_liquido_f),
            backgroundColor: colors.success + '33',
            borderColor: colors.success,
            borderWidth: 2,
            borderRadius: 6,
          },
        ],
      },
      options: { ...chartDefaults },
    });
  }

  // 2. Distribuição por Tipo
  const ctxTipos = document.getElementById('fn-chart-tipos');
  if (ctxTipos && summary.por_tipo) {
    const tipoLabels = Object.keys(summary.por_tipo);
    const tipoData   = Object.values(summary.por_tipo);
    const tipoColors = [colors.primary, colors.success, colors.warning, colors.purple, colors.teal];
    FN.charts.tipos = new Chart(ctxTipos, {
      type: 'doughnut',
      data: {
        labels: tipoLabels,
        datasets: [{ data: tipoData, backgroundColor: tipoColors, borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} nota${ctx.parsed !== 1 ? 's' : ''}` } },
        },
      },
    });
  }

  // 3. Carga Tributária
  const ctxTributos = document.getElementById('fn-chart-tributos');
  if (ctxTributos) {
    FN.charts.tributos = new Chart(ctxTributos, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'ISSQN',
            data: monthly.map(m => m.total_issqn_f),
            backgroundColor: colors.warning + 'CC',
            borderRadius: 4,
            stack: 'tributos',
          },
          {
            label: 'Federais',
            data: monthly.map(m => m.total_federais_f),
            backgroundColor: colors.error + 'CC',
            borderRadius: 4,
            stack: 'tributos',
          },
        ],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          x: { ...chartDefaults.scales.x, stacked: true },
          y: { ...chartDefaults.scales.y, stacked: true },
        },
      },
    });
  }

  // 4. Status das Notas
  const ctxStatus = document.getElementById('fn-chart-status');
  if (ctxStatus && summary.por_status) {
    const statusLabels = Object.keys(summary.por_status).map(FN_statusLabel);
    const statusData   = Object.values(summary.por_status);
    const statusColors = {
      'Processado': colors.success,
      'Pendente':   colors.warning,
      'Erro':       colors.error,
      'Cancelado':  '#94A3B8',
    };
    FN.charts.status = new Chart(ctxStatus, {
      type: 'pie',
      data: {
        labels: statusLabels,
        datasets: [{
          data: statusData,
          backgroundColor: statusLabels.map(l => statusColors[l] || colors.primary),
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
        },
      },
    });
  }

  // 5. Top Emitentes
  const ctxEmitentes = document.getElementById('fn-chart-emitentes');
  if (ctxEmitentes && topEmitentes.length > 0) {
    FN.charts.emitentes = new Chart(ctxEmitentes, {
      type: 'bar',
      data: {
        labels: topEmitentes.map(e => e.razao_social?.slice(0, 30) || e.cnpj),
        datasets: [{
          label: 'Valor Líquido Total',
          data: topEmitentes.map(e => e.total_f),
          backgroundColor: colors.primary + '44',
          borderColor: colors.primary,
          borderWidth: 2,
          borderRadius: 6,
        }],
      },
      options: {
        ...chartDefaults,
        indexAxis: 'y',
        scales: {
          x: { ...chartDefaults.scales.y },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  // 6. Evolução do Valor Líquido (linha)
  const ctxEvolucao = document.getElementById('fn-chart-evolucao');
  if (ctxEvolucao) {
    FN.charts.evolucao = new Chart(ctxEvolucao, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Valor Líquido',
          data: monthly.map(m => m.total_liquido_f),
          borderColor: colors.teal,
          backgroundColor: colors.teal + '15',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: colors.teal,
          borderWidth: 2,
        }],
      },
      options: { ...chartDefaults },
    });
  }
}

// ─── Modal: Upload de PDF ─────────────────────────────────────────────────────
function FN_openUploadModal() {
  const html = `
    <div class="modal-overlay" id="fn-upload-modal" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:520px;">
        <div class="modal-header">
          <div class="modal-title">Upload de Nota Fiscal (PDF)</div>
          <button class="modal-close" onclick="document.getElementById('fn-upload-modal').remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="alert-inline info" style="margin-bottom:16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>O sistema extrai automaticamente os dados da NFS-e e NF-e. Suporta PDFs de todos os municípios brasileiros.</span>
          </div>
          <div class="upload-zone" id="fn-pdf-dropzone">
            <input type="file" id="fn-pdf-input" accept=".pdf" onchange="FN_handlePDFSelect(this)"/>
            <div class="upload-zone-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div class="upload-zone-title">Arraste o PDF aqui ou clique para selecionar</div>
            <div class="upload-zone-sub">Nota Fiscal de Serviço Eletrônica (NFS-e) ou NF-e</div>
            <div class="upload-zone-formats">
              <span class="upload-format-badge">PDF</span>
              <span class="upload-format-badge">NFS-e</span>
              <span class="upload-format-badge">NF-e</span>
              <span class="upload-format-badge">DANFSe</span>
              <span class="upload-format-badge">DANFE</span>
            </div>
          </div>
          <div id="fn-pdf-preview" style="display:none;margin-top:16px;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('fn-upload-modal').remove()">Cancelar</button>
          <button class="btn btn-primary" id="fn-pdf-submit" onclick="FN_submitPDF()" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Processar PDF
          </button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  // Drag & Drop
  const zone = document.getElementById('fn-pdf-dropzone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      const input = document.getElementById('fn-pdf-input');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      FN_handlePDFSelect(input);
    }
  });
}

function FN_handlePDFSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('fn-pdf-preview');
  const submit  = document.getElementById('fn-pdf-submit');
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="info-card">
      <div class="info-card-icon" style="background:var(--error-light);color:var(--error);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div>
        <div class="info-card-title">${escHtml(file.name)}</div>
        <div class="info-card-desc">${(file.size / 1024).toFixed(1)} KB — Pronto para processar</div>
      </div>
    </div>`;
  submit.disabled = false;
}

async function FN_submitPDF() {
  const input  = document.getElementById('fn-pdf-input');
  const submit = document.getElementById('fn-pdf-submit');
  if (!input?.files[0]) return;

  submit.disabled = true;
  submit.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Processando...';

  try {
    const formData = new FormData();
    formData.append('file', input.files[0]);

    const res = await fetch('/api/fiscal-notes/upload-pdf', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no upload');

    document.getElementById('fn-upload-modal')?.remove();
    showToast(data.message || 'PDF processado com sucesso!', 'success');
    await Promise.all([loadFiscalNotes(), loadFiscalStats()]);
  } catch (err) {
    showToast(err.message || 'Erro ao processar PDF.', 'error');
    submit.disabled = false;
    submit.innerHTML = 'Processar PDF';
  }
}

// ─── Modal: Importar Planilha ─────────────────────────────────────────────────
function FN_openImportModal() {
  const html = `
    <div class="modal-overlay" id="fn-import-modal" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:680px;">
        <div class="modal-header">
          <div class="modal-title">Importar Planilha de Notas Fiscais</div>
          <button class="modal-close" onclick="document.getElementById('fn-import-modal').remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="alert-inline info" style="margin-bottom:16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>O sistema reconhece automaticamente as colunas. Colunas aceitas: número, data, emitente, CNPJ, valor, valor_liquido, ISSQN, PIS, COFINS, INSS, IR, CSLL e outras.</span>
          </div>
          <div class="upload-zone" id="fn-sheet-dropzone">
            <input type="file" id="fn-sheet-input" accept=".xls,.xlsx,.csv" onchange="FN_handleSheetSelect(this)"/>
            <div class="upload-zone-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </div>
            <div class="upload-zone-title">Arraste a planilha aqui ou clique para selecionar</div>
            <div class="upload-zone-sub">Planilha de notas fiscais com cabeçalho na primeira linha</div>
            <div class="upload-zone-formats">
              <span class="upload-format-badge">XLS</span>
              <span class="upload-format-badge">XLSX</span>
              <span class="upload-format-badge">CSV</span>
            </div>
          </div>
          <div id="fn-sheet-preview" style="display:none;margin-top:16px;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('fn-import-modal').remove()">Cancelar</button>
          <button class="btn btn-primary" id="fn-sheet-submit" onclick="FN_submitSheet()" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Importar Notas
          </button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function FN_handleSheetSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('fn-sheet-preview');
  const submit  = document.getElementById('fn-sheet-submit');
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="info-card">
      <div class="info-card-icon" style="background:var(--success-light);color:var(--success);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
      </div>
      <div>
        <div class="info-card-title">${escHtml(file.name)}</div>
        <div class="info-card-desc">${(file.size / 1024).toFixed(1)} KB — Pronto para importar</div>
      </div>
    </div>`;
  submit.disabled = false;
}

async function FN_submitSheet() {
  const input  = document.getElementById('fn-sheet-input');
  const submit = document.getElementById('fn-sheet-submit');
  if (!input?.files[0]) return;

  submit.disabled = true;
  submit.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Importando...';

  try {
    const formData = new FormData();
    formData.append('file', input.files[0]);

    const res = await fetch('/api/fiscal-notes/import-spreadsheet', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na importação');

    document.getElementById('fn-import-modal')?.remove();
    showToast(data.message || `${data.imported} notas importadas!`, 'success');
    await Promise.all([loadFiscalNotes(), loadFiscalStats()]);
  } catch (err) {
    showToast(err.message || 'Erro ao importar planilha.', 'error');
    submit.disabled = false;
    submit.innerHTML = 'Importar Notas';
  }
}

// ─── Modal: Nova Nota Manual ──────────────────────────────────────────────────
function FN_openManualModal(noteData = null) {
  const isEdit = !!noteData;
  const v = noteData || {};

  const html = `
    <div class="modal-overlay" id="fn-manual-modal" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:680px;">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Nota Fiscal' : 'Nova Nota Fiscal'}</div>
          <button class="modal-close" onclick="document.getElementById('fn-manual-modal').remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label class="form-label">Tipo de Nota *</label>
            <select class="form-control" id="fn-f-tipo" required>
              <option value="NFS-e" ${v.tipo_nota==='NFS-e'?'selected':''}>NFS-e (Serviço)</option>
              <option value="NF-e"  ${v.tipo_nota==='NF-e'?'selected':''}>NF-e (Produto)</option>
              <option value="NF-Produto" ${v.tipo_nota==='NF-Produto'?'selected':''}>NF-Produto</option>
              <option value="CT-e"  ${v.tipo_nota==='CT-e'?'selected':''}>CT-e (Transporte)</option>
              <option value="Outros" ${v.tipo_nota==='Outros'?'selected':''}>Outros</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Número da Nota</label>
            <input class="form-control" id="fn-f-numero" type="text" value="${v.numero_nfe||''}" placeholder="Ex: 1884"/>
          </div>
          <div class="form-group">
            <label class="form-label">Data de Emissão</label>
            <input class="form-control" id="fn-f-data" type="date" value="${v.data_emissao?.slice(0,10)||''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Competência (MM/AAAA)</label>
            <input class="form-control" id="fn-f-competencia" type="text" value="${v.competencia||''}" placeholder="03/2025"/>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="form-label">Emitente — Razão Social *</label>
            <input class="form-control" id="fn-f-emitente" type="text" value="${escHtml(v.emitente_razao_social||'')}" placeholder="Nome da empresa prestadora"/>
          </div>
          <div class="form-group">
            <label class="form-label">CNPJ do Emitente</label>
            <input class="form-control" id="fn-f-cnpj" type="text" value="${v.emitente_cnpj||''}" placeholder="00.000.000/0001-00"/>
          </div>
          <div class="form-group">
            <label class="form-label">Município / UF</label>
            <input class="form-control" id="fn-f-municipio" type="text" value="${v.emitente_municipio||''}" placeholder="São Paulo"/>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="form-label">Descrição do Serviço</label>
            <textarea class="form-control" id="fn-f-descricao" rows="2" placeholder="Discriminação do serviço prestado">${escHtml(v.descricao_servico||'')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Valor do Serviço (R$) *</label>
            <input class="form-control" id="fn-f-valor" type="text" value="${v.valor_servico||''}" placeholder="1.500,00"/>
          </div>
          <div class="form-group">
            <label class="form-label">Valor Líquido (R$)</label>
            <input class="form-control" id="fn-f-liquido" type="text" value="${v.valor_liquido||''}" placeholder="1.458,00"/>
          </div>
          <div class="form-group">
            <label class="form-label">Alíquota ISSQN (%)</label>
            <input class="form-control" id="fn-f-aliquota" type="number" step="0.01" value="${v.aliquota_issqn||''}" placeholder="2,79"/>
          </div>
          <div class="form-group">
            <label class="form-label">Valor ISSQN (R$)</label>
            <input class="form-control" id="fn-f-issqn" type="text" value="${v.valor_issqn||''}" placeholder="41,85"/>
          </div>
          <div class="form-group">
            <label class="form-label">PIS (R$)</label>
            <input class="form-control" id="fn-f-pis" type="text" value="${v.valor_pis||''}" placeholder="0,00"/>
          </div>
          <div class="form-group">
            <label class="form-label">COFINS (R$)</label>
            <input class="form-control" id="fn-f-cofins" type="text" value="${v.valor_cofins||''}" placeholder="0,00"/>
          </div>
          <div class="form-group">
            <label class="form-label">INSS (R$)</label>
            <input class="form-control" id="fn-f-inss" type="text" value="${v.valor_inss||''}" placeholder="0,00"/>
          </div>
          <div class="form-group">
            <label class="form-label">IR (R$)</label>
            <input class="form-control" id="fn-f-ir" type="text" value="${v.valor_ir||''}" placeholder="0,00"/>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="form-label">Observações</label>
            <textarea class="form-control" id="fn-f-obs" rows="2" placeholder="Informações adicionais">${escHtml(v.observacoes||'')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('fn-manual-modal').remove()">Cancelar</button>
          <button class="btn btn-primary" id="fn-manual-submit" onclick="FN_submitManual('${isEdit ? v.id : ''}')">
            ${isEdit ? 'Salvar Alterações' : 'Cadastrar Nota'}
          </button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function FN_submitManual(editId = '') {
  const submit = document.getElementById('fn-manual-submit');
  const g = id => document.getElementById(id)?.value?.trim() || '';

  const payload = {
    tipo_nota:             g('fn-f-tipo'),
    numero_nfe:            g('fn-f-numero'),
    data_emissao:          g('fn-f-data') || null,
    competencia:           g('fn-f-competencia'),
    emitente_razao_social: g('fn-f-emitente'),
    emitente_cnpj:         g('fn-f-cnpj').replace(/[^\d]/g, ''),
    emitente_municipio:    g('fn-f-municipio'),
    descricao_servico:     g('fn-f-descricao'),
    valor_servico:         g('fn-f-valor'),
    valor_liquido:         g('fn-f-liquido'),
    aliquota_issqn:        g('fn-f-aliquota'),
    valor_issqn:           g('fn-f-issqn'),
    valor_pis:             g('fn-f-pis'),
    valor_cofins:          g('fn-f-cofins'),
    valor_inss:            g('fn-f-inss'),
    valor_ir:              g('fn-f-ir'),
    observacoes:           g('fn-f-obs'),
  };

  if (!payload.emitente_razao_social || !payload.valor_servico) {
    showToast('Preencha o emitente e o valor do serviço.', 'warning');
    return;
  }

  submit.disabled = true;
  submit.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Salvando...';

  try {
    const url    = editId ? `/api/fiscal-notes/${editId}` : '/api/fiscal-notes';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RE_API.getToken()}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar');

    document.getElementById('fn-manual-modal')?.remove();
    showToast(editId ? 'Nota atualizada!' : 'Nota cadastrada!', 'success');
    await Promise.all([loadFiscalNotes(), loadFiscalStats()]);
  } catch (err) {
    showToast(err.message || 'Erro ao salvar nota.', 'error');
    submit.disabled = false;
    submit.innerHTML = editId ? 'Salvar Alterações' : 'Cadastrar Nota';
  }
}

// ─── Detalhe e Edição ─────────────────────────────────────────────────────────
async function FN_openDetail(id) {
  try {
    const res = await fetch(`/api/fiscal-notes/${id}`, {
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const n = data.note;

    const html = `
      <div class="modal-overlay" id="fn-detail-modal" onclick="if(event.target===this)this.remove()">
        <div class="modal-box" style="max-width:600px;">
          <div class="modal-header">
            <div>
              <div class="modal-title">Nota Fiscal ${n.numero_nfe ? '#' + n.numero_nfe : ''}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${n.tipo_nota} — ${FN_formatDate(n.data_emissao)}</div>
            </div>
            <button class="modal-close" onclick="document.getElementById('fn-detail-modal').remove()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${FN_detailRow('Emitente', n.emitente_razao_social)}
              ${FN_detailRow('CNPJ Emitente', FN_formatCNPJ(n.emitente_cnpj))}
              ${FN_detailRow('Município/UF', [n.emitente_municipio, n.emitente_uf].filter(Boolean).join(' / '))}
              ${FN_detailRow('Competência', n.competencia)}
              ${FN_detailRow('Chave de Acesso', n.chave_acesso, true)}
              ${FN_detailRow('Simples Nacional', n.simples_nacional ? 'Sim' : 'Não')}
            </div>
            <div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-top:16px;">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Valores</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                ${FN_valueRow('Valor do Serviço', n.valor_servico_fmt, 'var(--dark)')}
                ${FN_valueRow('Desconto', n.valor_desconto_fmt || 'R$ 0,00')}
                ${FN_valueRow('ISSQN', n.valor_issqn_fmt, n.iss_retido ? 'var(--warning)' : undefined)}
                ${FN_valueRow('PIS', n.valor_pis ? (n.valor_pis).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00')}
                ${FN_valueRow('COFINS', n.valor_cofins ? (n.valor_cofins).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00')}
                ${FN_valueRow('INSS', n.valor_inss ? (n.valor_inss).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00')}
                ${FN_valueRow('IR', n.valor_ir ? (n.valor_ir).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00')}
                ${FN_valueRow('CSLL', n.valor_csll ? (n.valor_csll).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00')}
              </div>
              <div style="border-top:2px solid var(--border);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:700;color:var(--dark);">Valor Líquido</span>
                <span style="font-size:20px;font-weight:800;color:var(--success);">${n.valor_liquido_fmt}</span>
              </div>
            </div>
            ${n.descricao_servico ? `<div style="margin-top:14px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Descrição do Serviço</div><div style="font-size:13.5px;color:var(--text);line-height:1.5;background:var(--bg-alt);padding:12px;border-radius:var(--radius);border:1px solid var(--border);">${escHtml(n.descricao_servico)}</div></div>` : ''}
          </div>
          <div class="modal-footer">
            ${n.arquivo_path ? `<a href="/api/fiscal-notes/${n.id}/file?token=${RE_API.getToken()}" target="_blank" class="btn btn-outline btn-sm">Ver PDF</a>` : ''}
            <button class="btn btn-ghost" onclick="document.getElementById('fn-detail-modal').remove()">Fechar</button>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('fn-detail-modal').remove();FN_openEdit('${n.id}')">Editar</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  } catch (err) {
    showToast('Erro ao carregar detalhes da nota.', 'error');
  }
}

async function FN_openEdit(id) {
  try {
    const res = await fetch(`/api/fiscal-notes/${id}`, {
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    FN_openManualModal(data.note);
  } catch (err) {
    showToast('Erro ao carregar nota para edição.', 'error');
  }
}

async function FN_deleteNote(id) {
  if (!confirm('Tem certeza que deseja excluir esta nota fiscal?')) return;
  try {
    const res = await fetch(`/api/fiscal-notes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${RE_API.getToken()}` },
    });
    if (!res.ok) throw new Error('Erro ao excluir');
    showToast('Nota excluída.', 'success');
    await Promise.all([loadFiscalNotes(), loadFiscalStats()]);
  } catch (err) {
    showToast('Erro ao excluir nota.', 'error');
  }
}

// ─── Filtros e Navegação ──────────────────────────────────────────────────────
let _fnSearchTimer;
function FN_onSearch(val) {
  clearTimeout(_fnSearchTimer);
  _fnSearchTimer = setTimeout(() => {
    FN.filters.search = val;
    FN.page = 1;
    loadFiscalNotes();
  }, 350);
}

function FN_setFilter(key, val) {
  FN.filters[key] = val;
  FN.page = 1;
  loadFiscalNotes();
}

function FN_setSort(val) {
  const [sort, order] = val.split('_');
  FN.filters.sort  = sort === 'data' ? 'data_emissao' : sort === 'valor' ? 'valor_liquido' : sort;
  FN.filters.order = order;
  FN.page = 1;
  loadFiscalNotes();
}

function FN_goPage(p) {
  const pages = Math.ceil(FN.total / FN.limit);
  if (p < 1 || p > pages) return;
  FN.page = p;
  loadFiscalNotes();
}

function FN_switchTab(tab, btn) {
  FN.activeTab = tab;
  document.querySelectorAll('#fn-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const lista    = document.getElementById('fn-panel-lista');
  const graficos = document.getElementById('fn-panel-graficos');
  if (tab === 'lista') {
    lista.style.display    = '';
    graficos.style.display = 'none';
  } else {
    lista.style.display    = 'none';
    graficos.style.display = '';
    initChartJS().then(() => renderCharts());
  }
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────
function FN_tipoBadge(tipo) {
  const map = { 'NFS-e': 'badge-blue', 'NF-e': 'badge-green', 'CT-e': 'badge-purple', 'NF-Produto': 'badge-teal', 'Outros': 'badge-gray' };
  return map[tipo] || 'badge-gray';
}

function FN_statusBadge(status) {
  const map = { processado: 'badge-green', pendente: 'badge-amber', erro: 'badge-red', cancelado: 'badge-gray' };
  return map[status] || 'badge-gray';
}

function FN_statusLabel(status) {
  const map = { processado: 'Processado', pendente: 'Pendente', erro: 'Erro', cancelado: 'Cancelado' };
  return map[status] || status;
}

function FN_formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
}

function FN_formatCNPJ(cnpj) {
  if (!cnpj) return '';
  const c = cnpj.replace(/\D/g, '');
  if (c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (c.length === 11) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return cnpj;
}

function FN_detailRow(label, value, mono = false) {
  if (!value) return '';
  return `<div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${label}</div>
    <div style="font-size:13.5px;color:var(--dark);${mono?'font-family:monospace;font-size:12px;':''}">${escHtml(String(value))}</div>
  </div>`;
}

function FN_valueRow(label, value, color = 'var(--text)') {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
    <span style="font-size:13px;color:var(--text-muted);">${label}</span>
    <span style="font-size:13.5px;font-weight:600;color:${color};">${value || '—'}</span>
  </div>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Expor funções globais necessárias
window.initFiscalNotes      = initFiscalNotes;
window.FN_openUploadModal   = FN_openUploadModal;
window.FN_openImportModal   = FN_openImportModal;
window.FN_openManualModal   = FN_openManualModal;
window.FN_openDetail        = FN_openDetail;
window.FN_openEdit          = FN_openEdit;
window.FN_deleteNote        = FN_deleteNote;
window.FN_onSearch          = FN_onSearch;
window.FN_setFilter         = FN_setFilter;
window.FN_setSort           = FN_setSort;
window.FN_goPage            = FN_goPage;
window.FN_switchTab         = FN_switchTab;
window.FN_handlePDFSelect   = FN_handlePDFSelect;
window.FN_submitPDF         = FN_submitPDF;
window.FN_handleSheetSelect = FN_handleSheetSelect;
window.FN_submitSheet       = FN_submitSheet;
window.FN_submitManual      = FN_submitManual;
