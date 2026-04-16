/**
 * form-builder.js  — Admin Form Builder UI
 * Recupera Empresas | Professional Form Builder (Typeform / SurveyMonkey style)
 *
 * Views managed:
 *   1. List   — grid of all forms
 *   2. Builder— 3-column canvas (palette | canvas | properties)
 *   3. Responses — per-form response list + detail
 */
'use strict';

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────────*/
function fbToken()  { return localStorage.getItem('re_token'); }
function fbAuthH()  { return { 'Content-Type':'application/json', 'Authorization':'Bearer '+fbToken() }; }

function fbEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fbToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log('[FB]', type, msg);
}

async function fbRead(res) {
  if (typeof window.readApiResponse === 'function') return window.readApiResponse(res);
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    return { error: cleaned && !/^<!doctype/i.test(text.trim()) ? cleaned : `Erro ${res.status || ''}`.trim() };
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   State
──────────────────────────────────────────────────────────────────────────────*/
const FB = {
  view:          'list',   // 'list' | 'builder' | 'responses'
  forms:         [],
  currentForm:   null,     // full form object
  currentFormId: null,
  currentPage:   null,     // active page object
  selectedQ:     null,     // selected question id
  responses:     [],
  selectedResp:  null,
  readOnly:      false,    // true for system forms (view-only)
};

/* ──────────────────────────────────────────────────────────────────────────────
   Question Types catalogue
──────────────────────────────────────────────────────────────────────────────*/
const QB_TYPES = [
  { type:'short_text',    label:'Texto curto',        icon:'✏️' },
  { type:'long_text',     label:'Texto longo',        icon:'📝' },
  { type:'number',        label:'Número',             icon:'🔢' },
  { type:'currency',      label:'Valor monetário',    icon:'💰' },
  { type:'percentage',    label:'Percentual',         icon:'📊' },
  { type:'date',          label:'Data',               icon:'📅' },
  { type:'single_choice', label:'Múltipla escolha',   icon:'🔘' },
  { type:'multi_choice',  label:'Caixas de seleção',  icon:'☑️' },
  { type:'dropdown',      label:'Lista suspensa',     icon:'🔽' },
  { type:'scale',         label:'Escala linear',      icon:'📏' },
  { type:'nps',           label:'NPS (0-10)',          icon:'⭐' },
  { type:'rating',        label:'Avaliação (estrelas)',icon:'🌟' },
  { type:'yes_no',        label:'Sim / Não',          icon:'✅' },
  { type:'file_upload',   label:'Upload de arquivo',  icon:'📎' },
  { type:'section',       label:'Título de seção',    icon:'🏷️' },
  { type:'calculated',    label:'Campo calculado',    icon:'🧮' },
];

/* ──────────────────────────────────────────────────────────────────────────────
   Entry point — called by showSection('formularios')
──────────────────────────────────────────────────────────────────────────────*/
function loadFormBuilder() {
  fbShowView('list');
  fbLoadFormsList();
}

/* ──────────────────────────────────────────────────────────────────────────────
   View switcher
──────────────────────────────────────────────────────────────────────────────*/
function fbShowView(view) {
  FB.view = view;
  ['list','builder','responses'].forEach(v => {
    const el = document.getElementById('fb-view-'+v);
     if (el) el.classList.toggle('ui-hidden', v !== view);
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   VIEW 1 — FORMS LIST
══════════════════════════════════════════════════════════════════════════════*/
async function fbLoadFormsList() {
  fbShowView('list');
  const grid = document.getElementById('fb-forms-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="admin-empty-state-soft">Carregando formulários...</div>';

  const res = await fetch('/api/admin/forms', { headers: fbAuthH() });
  if (!res.ok) { grid.innerHTML = '<div class="form-builder-feedback-error">Erro ao carregar.</div>'; return; }
  const j = await res.json();
  FB.forms = j.forms || j;

  if (!FB.forms.length) {
    grid.innerHTML = `<div class="form-builder-list-empty">
      <div class="form-builder-list-empty-icon">📋</div>
      <div class="form-builder-list-empty-title">Nenhum formulário criado</div>
      <div class="form-builder-list-empty-copy">Clique em "Novo Formulário" para começar.</div>
    </div>`;
    return;
  }

  const TYPE_LABELS = { diagnostico:'Diagnóstico', pesquisa:'Pesquisa', avaliacao:'Avaliação', onboarding:'Onboarding', custom:'Personalizado', outro:'Outro' };
  const STATUS_CLS  = { draft:'badge-gray', rascunho:'badge-gray', active:'badge-green', publicado:'badge-green', inactive:'badge-amber', arquivado:'badge-amber' };
  const STATUS_LBL  = { draft:'Rascunho', rascunho:'Rascunho', active:'Publicado', publicado:'Publicado', inactive:'Arquivado', arquivado:'Arquivado' };

  grid.innerHTML = FB.forms.map(f => {
    const fid = f.id;
    const isSystem = !!(f.is_system);
    const systemNote = f.settings?.system_note || '';
    const statusBadge = `<span class="badge ${STATUS_CLS[f.status] || 'badge-gray'}">${STATUS_LBL[f.status] || f.status}</span>`;
    const systemBadge = isSystem ? '<span class="badge form-builder-system-badge">Sistema</span>' : '';
    const actionBtns = isSystem
      ? `<button class="btn-primary form-builder-card-btn" onclick="fbOpenBuilder('${fid}',true)">👁️ Ver Perguntas</button>
         <button class="btn-ghost form-builder-card-btn" onclick="fbOpenResponses('${fid}','${fbEsc(f.title)}')">📊 Respostas</button>
         <button class="btn-ghost form-builder-card-btn" onclick="fbOpenStatsPanel('${fid}')">📈 Estatísticas</button>`
      : `<button class="btn-primary form-builder-card-btn" onclick="fbOpenBuilder('${fid}')">✏️ Editar</button>
         <button class="btn-ghost form-builder-card-btn" onclick="fbOpenResponses('${fid}','${fbEsc(f.title)}')">📊 Respostas</button>
         <button class="btn-ghost form-builder-card-btn" onclick="fbOpenStatsPanel('${fid}')">📈 Estatísticas</button>
         <button class="btn-ghost form-builder-card-btn" onclick="fbDuplicateForm('${fid}')">📋 Duplicar</button>
         <button class="btn-ghost form-builder-card-btn form-builder-card-btn-danger" onclick="fbDeleteForm('${fid}','${fbEsc(f.title)}')">🗑️ Excluir</button>`;
    return `
    <div class="form-builder-list-card ${isSystem ? 'form-builder-list-card-system' : ''}">
      <div class="form-builder-list-card-header">
        <div>
          <div class="form-builder-list-card-title">${fbEsc(f.title)}</div>
          <div class="form-builder-list-card-type">${TYPE_LABELS[f.type] || f.type || '—'}</div>
        </div>
        <div class="form-builder-list-card-badges">${systemBadge}${statusBadge}</div>
      </div>
      ${f.description ? `<div class="form-builder-list-card-desc">${fbEsc(f.description)}</div>` : ''}
      ${isSystem && systemNote ? `<div class="form-builder-system-note">ℹ️ ${fbEsc(systemNote)}</div>` : ''}
      <div class="form-builder-list-card-meta">
        <span>📬 ${f.response_count || 0} respostas</span>
      </div>
      <div class="form-builder-list-card-actions">${actionBtns}</div>
    </div>`;
  }).join('');
}

async function fbDuplicateForm(id) {
  const res = await fetch(`/api/admin/forms/${id}/duplicate`, { method:'POST', headers: fbAuthH() });
  if (res.ok) { fbToast('Formulário duplicado!','success'); fbLoadFormsList(); }
  else fbToast('Erro ao duplicar.','error');
}

async function fbDeleteForm(id, title) {
  if (!confirm(`Excluir o formulário "${title}"? Esta ação é irreversível.`)) return;
  const res = await fetch(`/api/admin/forms/${id}`, { method:'DELETE', headers: fbAuthH() });
  if (res.ok) { fbToast('Formulário excluído.','success'); fbLoadFormsList(); }
  else fbToast('Erro ao excluir.','error');
}

async function fbOpenStatsPanel(formIdOverride) {
  const formId = formIdOverride || FB.currentFormId;
  if (!formId) return;
  const panel = document.getElementById('fb-stats-panel');
  if (!panel) return;
  // Show panel
  panel.classList.remove('ui-hidden');
  document.getElementById('fb-stats-content').innerHTML = '<div class="admin-empty-state-soft form-builder-stats-loading">Carregando...</div>';
  document.getElementById('fb-stats-chart').innerHTML = '';

  // If called from list view, open the builder first (stats panel is there)
  if (formIdOverride && FB.currentFormId !== formIdOverride) {
    FB.currentFormId = formIdOverride;
    fbShowView('builder');
    document.getElementById('fb-builder-title').textContent = FB.forms?.find(f=>f.id===formIdOverride)?.title || '—';
    panel.classList.remove('ui-hidden');
  }

  const res = await fetch(`/api/admin/forms/${formId}/stats`, { headers: fbAuthH() });
  if (!res.ok) {
    document.getElementById('fb-stats-content').innerHTML = '<div class="form-builder-feedback-error">Erro ao carregar estatísticas.</div>';
    return;
  }
  const s = await res.json();

  const fmt = v => v == null ? '—' : v;
  const fmtTime = secs => {
    if (secs == null) return '—';
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs/60)}min ${secs%60}s`;
  };

  document.getElementById('fb-stats-content').innerHTML = `
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-blue">${fmt(s.total)}</div>
      <div class="form-builder-stat-label">Total de respostas</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-green">${fmt(s.completed)}</div>
      <div class="form-builder-stat-label">Concluídas</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-amber">${fmt(s.in_progress)}</div>
      <div class="form-builder-stat-label">Em andamento</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-red">${fmt(s.abandoned)}</div>
      <div class="form-builder-stat-label">Abandonadas</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-violet">${s.completion_rate ?? 0}%</div>
      <div class="form-builder-stat-label">Taxa de conclusão</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-pink">${s.abandonment_rate ?? 0}%</div>
      <div class="form-builder-stat-label">Taxa de abandono</div>
    </div>
    <div class="form-builder-stat-card">
      <div class="form-builder-stat-value form-builder-stat-value-cyan">${fmtTime(s.avg_time_seconds)}</div>
      <div class="form-builder-stat-label">Tempo médio</div>
    </div>
  `;

  // Render daily starts sparkline (pure CSS bar chart)
  if (s.daily_starts && s.daily_starts.length) {
    const maxCount = Math.max(...s.daily_starts.map(d=>d.count), 1);
    const bars = s.daily_starts.slice(-14).map(d => {
      const h = Math.round((d.count / maxCount) * 40);
      return `<div title="${d.date}: ${d.count} inícios" class="form-builder-spark-bar" data-height="${h}"></div>`;
    }).join('');
    document.getElementById('fb-stats-chart').innerHTML = `
      <div class="form-builder-spark-title">Inícios por dia (últimos 14 dias)</div>
      <div class="form-builder-spark-row">${bars}</div>`;
    document.querySelectorAll('.form-builder-spark-bar').forEach(bar => {
      bar.style.height = `${bar.dataset.height || 0}px`;
    });
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   New form modal
──────────────────────────────────────────────────────────────────────────────*/
function fbOpenNewFormModal() {
  document.getElementById('fb-modal-new').classList.remove('ui-hidden');
  document.getElementById('fb-new-title').value = '';
  document.getElementById('fb-new-desc').value  = '';
  document.getElementById('fb-new-type').value  = 'diagnostico';
}
function fbCloseNewModal() {
  document.getElementById('fb-modal-new').classList.add('ui-hidden');
}
async function fbSubmitNewForm() {
  const title = document.getElementById('fb-new-title').value.trim();
  if (!title) { fbToast('Informe o título do formulário.','error'); return; }
  const body = {
    title,
    description: document.getElementById('fb-new-desc').value.trim(),
    type:        document.getElementById('fb-new-type').value,
  };
  const res = await fetch('/api/admin/forms', { method:'POST', headers: fbAuthH(), body: JSON.stringify(body) });
  const j   = await fbRead(res);
  if (res.ok) {
    fbCloseNewModal();
    fbToast('Formulário criado!','success');
    fbOpenBuilder((j.form || j).id);
  } else {
    if (j.diagnostic) console.error('[ADMIN FORMS DIAGNOSTIC]', j.diagnostic);
    fbToast(j.error || 'Erro ao criar.','error');
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   VIEW 2 — BUILDER CANVAS
══════════════════════════════════════════════════════════════════════════════*/
async function fbOpenBuilder(formId, readOnly = false) {
  FB.currentFormId = formId;
  FB.selectedQ = null;
  FB.readOnly = readOnly;
  fbShowView('builder');

  const titleEl = document.getElementById('fb-builder-title');
  if (titleEl) titleEl.textContent = 'Carregando...';

  const res = await fetch(`/api/admin/forms/${formId}`, { headers: fbAuthH() });
  const jf = await fbRead(res);
  if (!res.ok) { fbToast(jf.error || 'Erro ao carregar formulário.','error'); return; }
  FB.currentForm = jf.form || jf;

  // Set title
  if (titleEl) titleEl.textContent = FB.currentForm.title;

  // Render pages tabs
  fbRenderPageTabs();

  // Activate first page
  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages[0] || null;
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
}

function fbRenderPageTabs() {
  const pages = FB.currentForm.pages || [];
  const bar   = document.getElementById('fb-page-tabs');
  if (!bar) return;
  bar.innerHTML = pages.map((p, i) => `
    <button class="fb-page-tab ${FB.currentPage && FB.currentPage.id === p.id ? 'active' : ''}"
      onclick="fbSelectPage(${p.id})">
      Página ${i+1}${p.title ? ': '+fbEsc(p.title) : ''}
    </button>
  `).join('') + (FB.readOnly ? '' : `
    <button onclick="fbAddPage()" class="fb-page-tab-add">
      + Página
    </button>
  `);
}

function fbSelectPage(pageId) {
  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages.find(p => p.id === pageId) || null;
  FB.selectedQ   = null;
  fbRenderPageTabs();
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
}

async function fbAddPage() {
  const title = prompt('Título da nova página (opcional):') ?? '';
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/pages`, {
    method:'POST', headers: fbAuthH(),
    body: JSON.stringify({ title, order_index: (FB.currentForm.pages||[]).length })
  });
  if (!res.ok) { fbToast('Erro ao criar página.','error'); return; }
  await fbRefreshForm();
  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages[pages.length - 1] || null;
  fbRenderPageTabs();
  fbRenderCanvas();
}

async function fbRefreshForm() {
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}`, { headers: fbAuthH() });
  if (res.ok) { const j = await fbRead(res); FB.currentForm = j.form || j; }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Canvas rendering
──────────────────────────────────────────────────────────────────────────────*/
function fbRenderCanvas() {
  const canvas = document.getElementById('fb-canvas');
  if (!canvas) return;

  if (!FB.currentPage) {
    canvas.innerHTML = `<div class="form-builder-canvas-empty">
      <div class="form-builder-canvas-empty-icon">📄</div>
      <div class="form-builder-canvas-empty-copy">${FB.readOnly ? 'Nenhuma página.' : 'Nenhuma página. Clique em "+ Página" para criar.'}</div>
    </div>`;
    return;
  }

  const questions = (FB.currentPage.questions || []).sort((a,b) => a.order_index - b.order_index);

  if (!questions.length) {
    canvas.innerHTML = `<div class="form-builder-canvas-empty">
      <div class="form-builder-canvas-empty-icon">❓</div>
      <div class="form-builder-canvas-empty-copy">${FB.readOnly ? 'Nenhuma questão nesta página.' : 'Nenhuma questão nesta página.<br>Arraste um tipo da paleta ou clique para adicionar.'}</div>
    </div>`;
    return;
  }

  canvas.innerHTML = questions.map((q, i) => {
    const typeInfo = QB_TYPES.find(t => t.type === q.type) || { icon:'❓', label: q.type };
    const isActive = FB.selectedQ === q.id;
    return `
    <div class="fb-question-card ${isActive ? 'fb-q-active' : ''}"
         id="fb-q-${q.id}"
         onclick="fbSelectQuestion(${q.id})">
      <div class="fb-question-card-row">
        <span class="fb-question-card-icon">${typeInfo.icon}</span>
        <div class="fb-question-card-copy">
          <div class="fb-question-card-badges">
            <span class="fb-question-card-badge">${typeInfo.label}</span>
            ${q.required ? '<span class="fb-question-card-badge fb-question-card-badge-required">Obrigatório</span>' : ''}
            ${q.weight ? `<span class="fb-question-card-badge fb-question-card-badge-weight">Peso: ${q.weight}</span>` : ''}
          </div>
          <div class="fb-question-card-title">${fbEsc(q.label) || '<em class="fb-question-card-title-empty">Sem título</em>'}</div>
          ${q.description ? `<div class="fb-question-card-description">${fbEsc(q.description)}</div>` : ''}
        </div>
        ${FB.readOnly ? '' : `<div class="fb-question-card-actions">
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'up')" title="Mover para cima"
            class="fb-question-card-action-btn"
            ${i === 0 ? 'disabled' : ''}>↑</button>
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'down')" title="Mover para baixo"
            class="fb-question-card-action-btn"
            ${i === questions.length-1 ? 'disabled' : ''}>↓</button>
          <button onclick="event.stopPropagation();fbDeleteQuestion(${q.id})" title="Excluir"
            class="fb-question-card-action-btn fb-question-card-action-delete">🗑</button>
        </div>`}
      </div>
      ${fbRenderQuestionPreview(q)}
    </div>`;
  }).join('');
}

function fbRenderQuestionPreview(q) {
  if (q.type === 'section') return '';
  if (q.type === 'short_text')  return `<div class="fb-question-preview-wrap"><input disabled placeholder="${fbEsc(q.placeholder || 'Resposta curta...')}" class="fb-question-preview-input"></div>`;
  if (q.type === 'long_text')   return `<div class="fb-question-preview-wrap"><textarea disabled placeholder="${fbEsc(q.placeholder || 'Resposta longa...')}" rows="2" class="fb-question-preview-input fb-question-preview-textarea"></textarea></div>`;
  if (q.type === 'number' || q.type === 'currency' || q.type === 'percentage')
    return `<div class="fb-question-preview-wrap"><input type="number" disabled placeholder="0" class="fb-question-preview-input fb-question-preview-input-sm"></div>`;
  if (q.type === 'date')
    return `<div class="fb-question-preview-wrap"><input type="date" disabled class="fb-question-preview-input fb-question-preview-input-auto"></div>`;
  if (q.type === 'single_choice' || q.type === 'multi_choice' || q.type === 'dropdown') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (!opts.length) return `<div class="fb-question-preview-empty">(Sem opções configuradas)</div>`;
    return `<div class="fb-question-preview-wrap fb-question-preview-options">
      ${opts.slice(0,3).map(o => `<label class="fb-question-preview-option-row">
        <input type="${q.type==='multi_choice'?'checkbox':'radio'}" disabled class="fb-question-preview-option-input"> ${fbEsc(typeof o === 'string' ? o : o.label || o)}
      </label>`).join('')}
      ${opts.length > 3 ? `<span class="fb-question-preview-empty">+ ${opts.length-3} mais opções...</span>` : ''}
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps' || q.type === 'rating') {
    const max = q.type === 'rating' ? 5 : (q.type === 'nps' ? 10 : (q.settings?.max || 10));
    return `<div class="fb-question-preview-wrap fb-question-preview-scale-row">
      ${Array.from({length: Math.min(max,10)}, (_,i) => `<button disabled class="fb-question-preview-scale-btn">${q.type==='rating'?'★':i+(q.type==='nps'?0:1)}</button>`).join('')}
      ${max > 10 ? `<span class="fb-question-preview-scale-more">...</span>` : ''}
    </div>`;
  }
  if (q.type === 'yes_no')
    return `<div class="fb-question-preview-wrap fb-question-preview-binary-row"><button disabled class="fb-question-preview-binary-btn">✅ Sim</button><button disabled class="fb-question-preview-binary-btn">❌ Não</button></div>`;
  if (q.type === 'file_upload')
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-upload">📎 Clique ou arraste o arquivo aqui</div></div>`;
  if (q.type === 'calculated')
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-formula">${fbEsc(q.formula || 'Sem fórmula configurada')}</div></div>`;
  return '';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Question selection & properties panel
──────────────────────────────────────────────────────────────────────────────*/
function fbSelectQuestion(qId) {
  FB.selectedQ = qId;
  fbRenderCanvas(); // re-render to update active state
  fbRenderPropertiesPanel(qId);
}

function fbRenderPropertiesEmpty() {
  const panel = document.getElementById('fb-props-panel');
  if (!panel) return;
  panel.innerHTML = `<div class="fb-props-empty">
    <div class="fb-props-empty-icon">👈</div>
    <div class="fb-props-empty-copy">Clique em uma questão para editar suas propriedades</div>
  </div>`;
}

function fbRenderPropertiesPanel(qId) {
  const panel = document.getElementById('fb-props-panel');
  if (!panel) return;
  const questions = (FB.currentPage?.questions || []);
  const q = questions.find(x => x.id === qId);
  if (!q) { fbRenderPropertiesEmpty(); return; }

  const typeInfo = QB_TYPES.find(t => t.type === q.type) || { icon:'❓', label: q.type };
  const opts = Array.isArray(q.options) ? q.options : [];

  panel.innerHTML = `
  <div class="fb-props-panel-inner">
    ${FB.readOnly ? '<div class="fb-props-readonly-banner">🔒 Somente leitura</div>' : ''}
    <div class="fb-props-type-badge">
      ${typeInfo.icon} ${typeInfo.label}
    </div>

    <!-- Label -->
    <div class="fb-prop-group">
      <label class="fb-prop-label">Título da questão</label>
      <input id="fp-label" class="fb-prop-input" value="${fbEsc(q.label)}" placeholder="Qual é a pergunta?"
        oninput="fbSavePropDebounced(${q.id})">
    </div>
    <!-- Description -->
    <div class="fb-prop-group">
      <label class="fb-prop-label">Descrição / dica</label>
      <input id="fp-description" class="fb-prop-input" value="${fbEsc(q.description||'')}" placeholder="Descrição opcional..."
        oninput="fbSavePropDebounced(${q.id})">
    </div>
    <!-- Placeholder -->
    ${['short_text','long_text','number','currency','percentage'].includes(q.type) ? `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Placeholder</label>
      <input id="fp-placeholder" class="fb-prop-input" value="${fbEsc(q.placeholder||'')}" placeholder="Texto de exemplo..."
        oninput="fbSavePropDebounced(${q.id})">
    </div>` : ''}
    <!-- Required -->
    <div class="fb-prop-group fb-prop-toggle-row">
      <label class="fb-prop-label fb-prop-label-inline">Obrigatório</label>
      <input type="checkbox" id="fp-required" ${q.required?'checked':''} onchange="fbSavePropDebounced(${q.id})"
        class="fb-prop-checkbox">
    </div>

    ${fbRenderTypeSpecificProps(q)}

    <!-- Scoring -->
    <div class="fb-props-section-divider">
      <div class="fb-props-section-title">Pontuação</div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Peso da questão</label>
        <input id="fp-weight" type="number" min="0" class="fb-prop-input" value="${q.weight||0}"
          oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>

    <!-- Buttons -->
    ${FB.readOnly ? '' : `<div class="fb-props-actions">
      <button class="btn-primary fb-props-action-btn" onclick="fbSaveQuestion(${q.id})">
        💾 Salvar questão
      </button>
      ${['single_choice','multi_choice','dropdown','scale','nps','rating'].includes(q.type) ? `
      <button class="btn-ghost fb-props-action-btn" onclick="fbOpenLogicEditor(${q.id})">
        🔀 Editar lógica condicional
      </button>` : ''}
    </div>`}
  </div>`;
}

function fbRenderTypeSpecificProps(q) {
  if (['single_choice','multi_choice','dropdown'].includes(q.type)) {
    const opts = Array.isArray(q.options) ? q.options : [];
    return `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Opções (uma por linha)</label>
      <textarea id="fp-options" class="fb-prop-input" rows="5"
        oninput="fbSavePropDebounced(${q.id})">${opts.map(o=>typeof o==='string'?o:(o.label||o)).join('\n')}</textarea>
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps') {
    const s = q.settings || {};
    return `
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Mínimo</label>
        <input id="fp-scale-min" type="number" class="fb-prop-input" value="${s.min||1}" oninput="fbSavePropDebounced(${q.id})">
      </div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Máximo</label>
        <input id="fp-scale-max" type="number" class="fb-prop-input" value="${s.max||(q.type==='nps'?10:5)}" oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Label mínimo</label>
        <input id="fp-scale-lmin" class="fb-prop-input" value="${fbEsc(s.label_min||'')}" placeholder="Ex: Ruim" oninput="fbSavePropDebounced(${q.id})">
      </div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Label máximo</label>
        <input id="fp-scale-lmax" class="fb-prop-input" value="${fbEsc(s.label_max||'')}" placeholder="Ex: Ótimo" oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>`;
  }
  if (q.type === 'calculated') {
    return `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Fórmula (use {question_id})</label>
      <textarea id="fp-formula" class="fb-prop-input" rows="3"
        oninput="fbSavePropDebounced(${q.id})"
        placeholder="Ex: {q1} * {q2} / 100">${fbEsc(q.formula||'')}</textarea>
    </div>`;
  }
  return '';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Add question from palette
──────────────────────────────────────────────────────────────────────────────*/
async function fbAddQuestion(type) {
  if (!FB.currentPage) { fbToast('Selecione ou crie uma página primeiro.','error'); return; }
  const questions = FB.currentPage.questions || [];
  const body = {
    page_id:     FB.currentPage.id,
    type,
    label:       '',
    order_index: questions.length,
    required:    false,
  };
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions`, {
    method:'POST', headers: fbAuthH(), body: JSON.stringify(body)
  });
  if (!res.ok) { fbToast('Erro ao adicionar questão.','error'); return; }
  const newQ = await res.json();
  await fbRefreshForm();
  // update currentPage ref
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  FB.selectedQ = newQ.id;
  fbRenderCanvas();
  fbRenderPropertiesPanel(newQ.id);
  // scroll canvas to bottom
  const canvas = document.getElementById('fb-canvas');
  if (canvas) canvas.scrollTop = canvas.scrollHeight;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Save question properties
──────────────────────────────────────────────────────────────────────────────*/
let _fbSaveTimer = null;
function fbSavePropDebounced(qId) {
  if (FB.readOnly) return;
  clearTimeout(_fbSaveTimer);
  _fbSaveTimer = setTimeout(() => fbSaveQuestion(qId), 1200);
}

async function fbSaveQuestion(qId) {
  if (FB.readOnly) return;
  clearTimeout(_fbSaveTimer);
  const q = (FB.currentPage?.questions || []).find(x => x.id === qId);
  if (!q) return;

  const label       = document.getElementById('fp-label')?.value || '';
  const description = document.getElementById('fp-description')?.value || '';
  const placeholder = document.getElementById('fp-placeholder')?.value || '';
  const required    = document.getElementById('fp-required')?.checked || false;
  const weight      = parseFloat(document.getElementById('fp-weight')?.value) || 0;

  // options
  let options = q.options;
  const optTA = document.getElementById('fp-options');
  if (optTA) options = optTA.value.split('\n').map(s=>s.trim()).filter(Boolean);

  // settings
  let settings = q.settings || {};
  const smin = document.getElementById('fp-scale-min');
  const smax = document.getElementById('fp-scale-max');
  const slmin = document.getElementById('fp-scale-lmin');
  const slmax = document.getElementById('fp-scale-lmax');
  if (smin) settings = { ...settings, min: parseFloat(smin.value)||1, max: parseFloat(smax?.value)||10, label_min: slmin?.value||'', label_max: slmax?.value||'' };

  // formula
  let formula = q.formula || '';
  const fEl = document.getElementById('fp-formula');
  if (fEl) formula = fEl.value;

  const body = { label, description, placeholder, required, weight, options, settings, formula };

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions/${qId}`, {
    method:'PUT', headers: fbAuthH(), body: JSON.stringify(body)
  });
  if (!res.ok) { fbToast('Erro ao salvar questão.','error'); return; }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
  fbToast('Questão salva!','success');
}

async function fbDeleteQuestion(qId) {
  if (!confirm('Excluir esta questão?')) return;
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions/${qId}`, {
    method:'DELETE', headers: fbAuthH()
  });
  if (!res.ok) { fbToast('Erro ao excluir.','error'); return; }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  FB.selectedQ = null;
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
  fbToast('Questão excluída.','success');
}

async function fbMoveQuestion(qId, dir) {
  const questions = [...(FB.currentPage?.questions || [])].sort((a,b) => a.order_index - b.order_index);
  const idx = questions.findIndex(q => q.id === qId);
  if (idx < 0) return;
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= questions.length) return;

  // swap order_index
  const aOrd = questions[idx].order_index;
  const bOrd = questions[swap].order_index;

  await Promise.all([
    fetch(`/api/admin/forms/${FB.currentFormId}/questions/${questions[idx].id}`, {
      method:'PUT', headers: fbAuthH(), body: JSON.stringify({ order_index: bOrd })
    }),
    fetch(`/api/admin/forms/${FB.currentFormId}/questions/${questions[swap].id}`, {
      method:'PUT', headers: fbAuthH(), body: JSON.stringify({ order_index: aOrd })
    }),
  ]);
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Form settings (title, status, publish)
──────────────────────────────────────────────────────────────────────────────*/
async function fbSaveFormSettings() {
  const title  = document.getElementById('fb-settings-title')?.value.trim();
  const desc   = document.getElementById('fb-settings-desc')?.value.trim();
  const status = document.getElementById('fb-settings-status')?.value;
  if (!title) { fbToast('Título obrigatório.','error'); return; }
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}`, {
    method:'PUT', headers: fbAuthH(), body: JSON.stringify({ title, description: desc, status })
  });
  if (res.ok) {
    const jset = await res.json(); FB.currentForm = jset.form || jset;
    document.getElementById('fb-builder-title').textContent = title;
    fbToast('Configurações salvas!','success');
    document.getElementById('fb-settings-panel').classList.add('ui-hidden');
  } else fbToast('Erro ao salvar.','error');
}

function fbToggleSettings() {
  const p = document.getElementById('fb-settings-panel');
  if (!p) return;
  const show = p.classList.contains('ui-hidden');
  p.classList.toggle('ui-hidden', !show);
  if (show && FB.currentForm) {
    document.getElementById('fb-settings-title').value  = FB.currentForm.title || '';
    document.getElementById('fb-settings-desc').value   = FB.currentForm.description || '';
    document.getElementById('fb-settings-status').value = FB.currentForm.status || 'draft';
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic editor (modal)
──────────────────────────────────────────────────────────────────────────────*/
let _logicSourceQId = null;

async function fbOpenLogicEditor(qId) {
  _logicSourceQId = qId;
  const modal = document.getElementById('fb-logic-modal');
  if (!modal) return;
  modal.classList.remove('ui-hidden');
  await fbLoadLogicRules(qId);
}

function fbCloseLogicModal() {
  document.getElementById('fb-logic-modal').classList.add('ui-hidden');
}

async function fbLoadLogicRules(qId) {
  const container = document.getElementById('fb-logic-rules');
  if (!container) return;
  container.innerHTML = '<div class="form-builder-logic-loading">Carregando regras...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic?question_id=${qId}`, { headers: fbAuthH() });
  const jl = res.ok ? await res.json() : {};
  const rules = jl.rules || jl || [];

  const questions = (FB.currentForm.pages||[]).flatMap(p => p.questions||[]);
  const pages     = FB.currentForm.pages || [];

  if (!rules.length) {
    container.innerHTML = '<div class="form-builder-logic-empty">Nenhuma regra de lógica. Clique em "Adicionar regra".</div>';
    return;
  }

  container.innerHTML = rules.map((r, i) => `
    <div class="form-builder-logic-rule">
      <span class="form-builder-logic-rule-copy">Se resposta</span>
      <span class="form-builder-logic-rule-strong">${fbEsc(r.operator)}</span>
      <span class="form-builder-logic-rule-chip">"${fbEsc(r.condition_value)}"</span>
      <span class="form-builder-logic-rule-copy">→</span>
      <span class="form-builder-logic-rule-strong">${r.action}</span>
      ${r.target_page_id ? `<span class="form-builder-logic-rule-copy">para página ${pages.findIndex(p=>p.id===r.target_page_id)+1}</span>` : ''}
      ${r.target_question_id ? `<span class="form-builder-logic-rule-copy">questão #${r.target_question_id}</span>` : ''}
      <button onclick="fbDeleteLogicRule(${r.id})" class="form-builder-logic-rule-delete">🗑</button>
    </div>
  `).join('');
}

async function fbAddLogicRule() {
  const op    = document.getElementById('fb-logic-op')?.value;
  const val   = document.getElementById('fb-logic-val')?.value.trim();
  const act   = document.getElementById('fb-logic-action')?.value;
  const tPage = document.getElementById('fb-logic-target-page')?.value;
  if (!val) { fbToast('Informe o valor da condição.','error'); return; }

  const body = {
    source_question_id: _logicSourceQId,
    operator:           op,
    condition_value:    val,
    action:             act,
    target_page_id:     tPage ? parseInt(tPage) : null,
  };
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic`, {
    method:'POST', headers: fbAuthH(), body: JSON.stringify(body)
  });
  if (res.ok) { fbToast('Regra adicionada!','success'); fbLoadLogicRules(_logicSourceQId); }
  else fbToast('Erro ao adicionar regra.','error');
}

async function fbDeleteLogicRule(ruleId) {
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic/${ruleId}`, {
    method:'DELETE', headers: fbAuthH()
  });
  if (res.ok) { fbToast('Regra removida.','success'); fbLoadLogicRules(_logicSourceQId); }
  else fbToast('Erro ao remover regra.','error');
}

/* ──────────────────────────────────────────────────────────────────────────────
   Assignments modal
──────────────────────────────────────────────────────────────────────────────*/
async function fbOpenAssignModal() {
  const modal = document.getElementById('fb-assign-modal');
  if (!modal) return;
  modal.classList.remove('ui-hidden');
  await fbLoadAssignments();
}
function fbCloseAssignModal() {
  document.getElementById('fb-assign-modal').classList.add('ui-hidden');
}

async function fbLoadAssignments() {
  const el = document.getElementById('fb-assign-list');
  if (!el) return;
  el.innerHTML = '<div class="form-builder-assign-loading">Carregando...</div>';
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/assignments`, { headers: fbAuthH() });
  const ja = res.ok ? await res.json() : {};
  const data = ja.assignments || ja || [];
  el.innerHTML = data.length
    ? data.map(a => {
        const u = a['re_users!re_form_assignments_user_id_fkey'] || a;
        const uname = u.name || a.user_name || '—';
        const uemail = u.email || a.user_email || '—';
        return `
        <div class="form-builder-assign-item">
          <div>
            <div class="form-builder-assign-name">${fbEsc(uname)}</div>
            <div class="form-builder-assign-email">${fbEsc(uemail)}</div>
          </div>
          <button onclick="fbRemoveAssignment(${a.user_id})" class="form-builder-assign-remove">Remover</button>
        </div>`;}).join('')
    : '<div class="form-builder-assign-empty">Nenhum cliente atribuído.</div>';
}

async function fbAssignClient() {
  const email = document.getElementById('fb-assign-email')?.value.trim();
  if (!email) { fbToast('Informe o email do cliente.','error'); return; }
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/assign-email`, {
    method:'POST', headers: fbAuthH(), body: JSON.stringify({ email })
  });
  const j = await res.json();
  if (res.ok) { fbToast('Cliente atribuído!','success'); fbLoadAssignments(); document.getElementById('fb-assign-email').value=''; }
  else fbToast(j.error||'Erro ao atribuir.','error');
}

async function fbRemoveAssignment(userId) {
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/assign/${userId}`, {
    method:'DELETE', headers: fbAuthH()
  });
  if (res.ok) { fbToast('Removido.','success'); fbLoadAssignments(); }
  else fbToast('Erro.','error');
}

/* ══════════════════════════════════════════════════════════════════════════════
   VIEW 3 — RESPONSES
══════════════════════════════════════════════════════════════════════════════*/
async function fbOpenResponses(formId, formTitle) {
  FB.currentFormId = formId;
  FB.selectedResp  = null;
  fbShowView('responses');

  const titleEl = document.getElementById('fb-resp-title');
  if (titleEl) titleEl.textContent = 'Respostas: ' + (formTitle || '');

  const el = document.getElementById('fb-resp-list');
  if (el) el.innerHTML = '<div class="admin-empty-state-soft">Carregando...</div>';

  const res = await fetch(`/api/admin/forms/${formId}/responses`, { headers: fbAuthH() });
  if (!res.ok) { if(el) el.innerHTML='<div class="form-builder-feedback-error">Erro ao carregar respostas.</div>'; return; }
  const jr = await res.json();
  FB.responses = jr.responses || jr;

  const STATUS_CLS = { em_andamento:'badge-blue', concluido:'badge-green', abandonado:'badge-gray' };
  const STATUS_LBL = { em_andamento:'Em andamento', concluido:'Concluído', abandonado:'Abandonado' };
  const CLASS_CLS  = { saudavel:'badge-green', risco_moderado:'badge-amber', risco_alto:'badge-red' };
  const CLASS_LBL  = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };

  if (!FB.responses.length) {
    if (el) el.innerHTML = '<div class="form-builder-response-empty"><div class="form-builder-response-empty-icon">📭</div><div class="form-builder-response-empty-copy">Nenhuma resposta ainda.</div></div>';
    return;
  }

  if (el) el.innerHTML = `
  <table class="admin-simple-table form-builder-response-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>Status</th>
        <th>Pontuação</th>
        <th>Classificação</th>
        <th>Data</th>
        <th>Ação</th>
      </tr>
    </thead>
    <tbody>
      ${FB.responses.map(r => {
        const u = r['re_users!re_form_responses_user_id_fkey'] || {};
        const uname  = u.name  || r.user_name  || '—';
        const uemail = u.email || r.user_email || '—';
        return `
      <tr class="form-builder-response-row" onclick="fbOpenResponseDetail(${r.id})">
        <td>
          <div class="form-builder-response-user">${fbEsc(uname)}</div>
          <div class="form-builder-response-email">${fbEsc(uemail)}</div>
        </td>
        <td><span class="badge ${STATUS_CLS[r.status]||'badge-gray'}">${STATUS_LBL[r.status]||r.status}</span></td>
        <td>
          ${r.score_pct != null ? `<span class="form-builder-response-score">${Math.round(r.score_pct)}%</span>
          <span class="form-builder-response-score-meta">${r.score_total||0}/${r.score_max||0}</span>` : '—'}
        </td>
        <td>
          ${r.score_classification ? `<span class="badge ${CLASS_CLS[r.score_classification]||'badge-gray'}">${CLASS_LBL[r.score_classification]||r.score_classification}</span>` : '—'}
        </td>
        <td class="form-builder-response-date">${r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : '—'}</td>
        <td>
          <button class="btn-ghost form-builder-response-action" onclick="event.stopPropagation();fbOpenResponseDetail(${r.id})">
            Ver detalhes
          </button>
        </td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function fbOpenResponseDetail(respId) {
  const modal = document.getElementById('fb-resp-detail-modal');
  if (!modal) return;
  modal.classList.remove('ui-hidden');

  const body = document.getElementById('fb-resp-detail-body');
  if (body) body.innerHTML = '<div class="admin-empty-state-soft">Carregando detalhes...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/responses/${respId}`, { headers: fbAuthH() });
  if (!res.ok) { if(body) body.innerHTML='<div class="form-builder-feedback-error">Erro ao carregar.</div>'; return; }
  const jr = await res.json();
  const data = jr.response || jr;

  const CLASS_CLS = { saudavel:'badge-green', risco_moderado:'badge-amber', risco_alto:'badge-red' };
  const CLASS_LBL = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };

  const rawAnswers = jr.answers || [];
  const answers = rawAnswers.map(a => ({
    ...a,
    question_label: (a['re_form_questions'] || {}).label || a.question_label || ('Questão #'+a.question_id),
  }));

  if (body) body.innerHTML = `
    <!-- Score summary -->
    ${data.score_pct != null ? `
    <div class="form-builder-response-summary">
      <div>
        <div class="form-builder-response-summary-score">${Math.round(data.score_pct)}%</div>
        <div class="form-builder-response-summary-meta">Pontuação: ${data.score_total||0} / ${data.score_max||0} pontos</div>
      </div>
      ${data.score_classification ? `<span class="form-builder-response-summary-badge">${CLASS_LBL[data.score_classification]||data.score_classification}</span>` : ''}
    </div>` : ''}

    <!-- Auto-report -->
    ${data.auto_report ? `
    <div class="form-builder-auto-report">
      <div class="form-builder-auto-report-title">📄 RELATÓRIO AUTOMÁTICO</div>
      <div class="form-builder-auto-report-body">${fbEsc(data.auto_report)}</div>
    </div>` : ''}

    <!-- Answers -->
    <div class="form-builder-answer-list">
      ${answers.map(a => `
      <div class="form-builder-answer-card">
        <div class="form-builder-answer-label">${fbEsc(a.question_label||'Questão #'+a.question_id)}</div>
        <div class="form-builder-answer-value">${a.value_json ? JSON.stringify(a.value_json) : (fbEsc(a.value) || '<em class="form-builder-answer-empty">Sem resposta</em>')}</div>
        ${a.score != null ? `<div class="form-builder-answer-score">Pontos: ${a.score}</div>` : ''}
      </div>`).join('')}
    </div>
  `;
}

function fbCloseRespDetailModal() {
  document.getElementById('fb-resp-detail-modal').classList.add('ui-hidden');
}

/* ──────────────────────────────────────────────────────────────────────────────
   Export responses CSV
──────────────────────────────────────────────────────────────────────────────*/
function fbExportResponsesCSV() {
  if (!FB.responses.length) { fbToast('Sem respostas para exportar.','error'); return; }
  const rows = [['ID','Cliente','Email','Status','Pontuação %','Classificação','Data']];
  FB.responses.forEach(r => rows.push([
    r.id, r.user_name||'', r.user_email||'', r.status||'',
    r.score_pct != null ? Math.round(r.score_pct) : '',
    r.score_classification||'',
    r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : ''
  ]));
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download='respostas.csv'; a.click();
  URL.revokeObjectURL(url);
}
