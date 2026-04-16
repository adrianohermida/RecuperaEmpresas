/**
 * form-builder.js — Admin Form Builder: helpers, estado global, lista de forms
 *
 * Módulos carregados separadamente:
 *   builder-properties.js — painel de propriedades
 *   builder-canvas.js     — canvas, páginas, questões
 *   builder-modals.js     — modais de lógica e atribuição
 *   builder-responses.js  — visualização e exportação de respostas
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
  view:          'list',
  forms:         [],
  currentForm:   null,
  currentFormId: null,
  currentPage:   null,
  selectedQ:     null,
  responses:     [],
  selectedResp:  null,
  readOnly:      false,
};

/* ──────────────────────────────────────────────────────────────────────────────
   Question Types catalogue
──────────────────────────────────────────────────────────────────────────────*/
const QB_TYPES = [
  { type:'short_text',    label:'Texto curto',         icon:'✏️' },
  { type:'long_text',     label:'Texto longo',         icon:'📝' },
  { type:'number',        label:'Número',              icon:'🔢' },
  { type:'currency',      label:'Valor monetário',     icon:'💰' },
  { type:'percentage',    label:'Percentual',          icon:'📊' },
  { type:'date',          label:'Data',                icon:'📅' },
  { type:'single_choice', label:'Múltipla escolha',    icon:'🔘' },
  { type:'multi_choice',  label:'Caixas de seleção',   icon:'☑️' },
  { type:'dropdown',      label:'Lista suspensa',      icon:'🔽' },
  { type:'scale',         label:'Escala linear',       icon:'📏' },
  { type:'nps',           label:'NPS (0-10)',           icon:'⭐' },
  { type:'rating',        label:'Avaliação (estrelas)', icon:'🌟' },
  { type:'yes_no',        label:'Sim / Não',           icon:'✅' },
  { type:'file_upload',   label:'Upload de arquivo',   icon:'📎' },
  { type:'section',       label:'Título de seção',     icon:'🏷️' },
  { type:'calculated',    label:'Campo calculado',     icon:'🧮' },
];

/* ──────────────────────────────────────────────────────────────────────────────
   Entry point — called by showSection('formularios')
──────────────────────────────────────────────────────────────────────────────*/
function loadFormBuilder() {
  fbBindTransientModalBehavior();
  fbShowView('list');
  fbLoadFormsList();
}

/* ──────────────────────────────────────────────────────────────────────────────
   View switcher
──────────────────────────────────────────────────────────────────────────────*/
function fbShowView(view) {
  FB.view = view;
  fbCloseTransientModals();
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
    const fid        = f.id;
    const isSystem   = !!(f.is_system);
    const systemNote = f.settings?.system_note || '';
    const statusBadge = `<span class="badge ${STATUS_CLS[f.status] || 'badge-gray'}">${STATUS_LBL[f.status] || f.status}</span>`;
    const systemBadge = isSystem ? '<span class="badge form-builder-system-badge">Sistema</span>' : '';
    const actionBtns  = isSystem
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
  panel.classList.remove('ui-hidden');
  document.getElementById('fb-stats-content').innerHTML = '<div class="admin-empty-state-soft form-builder-stats-loading">Carregando...</div>';
  document.getElementById('fb-stats-chart').innerHTML = '';

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

  const fmt     = v => v == null ? '—' : v;
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
      window.REShared.applyPixelHeightClass(bar, bar.dataset.height || 0, 40);
    });
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   New form modal
──────────────────────────────────────────────────────────────────────────────*/
function fbOpenNewFormModal() {
  fbCloseTransientModals('fb-modal-new');
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
