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
    if (el) el.style.display = (v === view) ? '' : 'none';
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   VIEW 1 — FORMS LIST
══════════════════════════════════════════════════════════════════════════════*/
async function fbLoadFormsList() {
  fbShowView('list');
  const grid = document.getElementById('fb-forms-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando formulários...</div>';

  const res = await fetch('/api/admin/forms', { headers: fbAuthH() });
  if (!res.ok) { grid.innerHTML = '<div style="padding:24px;color:#EF4444;">Erro ao carregar.</div>'; return; }
  const j = await res.json();
  FB.forms = j.forms || j;

  if (!FB.forms.length) {
    grid.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
      <div style="font-size:40px;margin-bottom:12px;">📋</div>
      <div style="font-size:15px;font-weight:600;color:#64748B;margin-bottom:8px;">Nenhum formulário criado</div>
      <div style="font-size:13px;">Clique em "Novo Formulário" para começar.</div>
    </div>`;
    return;
  }

  const TYPE_LABELS = { diagnostico:'Diagnóstico', pesquisa:'Pesquisa', avaliacao:'Avaliação', onboarding:'Onboarding', custom:'Personalizado', outro:'Outro' };
  const STATUS_CLS  = { draft:'badge-gray', rascunho:'badge-gray', active:'badge-green', publicado:'badge-green', inactive:'badge-amber', arquivado:'badge-amber' };
  const STATUS_LBL  = { draft:'Rascunho', rascunho:'Rascunho', active:'Publicado', publicado:'Publicado', inactive:'Arquivado', arquivado:'Arquivado' };

  grid.innerHTML = FB.forms.map(f => `
    <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;transition:box-shadow .15s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;color:#1E293B;">${fbEsc(f.title)}</div>
          <div style="font-size:12px;color:#94A3B8;margin-top:2px;">${TYPE_LABELS[f.type] || f.type || '—'}</div>
        </div>
        <span class="badge ${STATUS_CLS[f.status] || 'badge-gray'}">${STATUS_LBL[f.status] || f.status}</span>
      </div>
      ${f.description ? `<div style="font-size:13px;color:#64748B;line-height:1.5;">${fbEsc(f.description)}</div>` : ''}
      <div style="display:flex;gap:8px;font-size:12px;color:#94A3B8;">
        <span>📬 ${f.response_count || 0} respostas</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        <button class="btn-primary" style="font-size:12px;padding:6px 12px;" onclick="fbOpenBuilder(${f.id})">
          ✏️ Editar
        </button>
        <button class="btn-ghost" style="font-size:12px;padding:6px 12px;" onclick="fbOpenResponses(${f.id},'${fbEsc(f.title)}')">
          📊 Respostas
        </button>
        <button class="btn-ghost" style="font-size:12px;padding:6px 12px;" onclick="fbDuplicateForm(${f.id})">
          📋 Duplicar
        </button>
        <button class="btn-ghost" style="font-size:12px;padding:6px 12px;color:#EF4444;" onclick="fbDeleteForm(${f.id},'${fbEsc(f.title)}')">
          🗑️ Excluir
        </button>
      </div>
    </div>
  `).join('');
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

/* ──────────────────────────────────────────────────────────────────────────────
   New form modal
──────────────────────────────────────────────────────────────────────────────*/
function fbOpenNewFormModal() {
  document.getElementById('fb-modal-new').style.display = 'flex';
  document.getElementById('fb-new-title').value = '';
  document.getElementById('fb-new-desc').value  = '';
  document.getElementById('fb-new-type').value  = 'diagnostico';
}
function fbCloseNewModal() {
  document.getElementById('fb-modal-new').style.display = 'none';
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
  const j   = await res.json();
  if (res.ok) {
    fbCloseNewModal();
    fbToast('Formulário criado!','success');
    fbOpenBuilder((j.form || j).id);
  } else {
    fbToast(j.error || 'Erro ao criar.','error');
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   VIEW 2 — BUILDER CANVAS
══════════════════════════════════════════════════════════════════════════════*/
async function fbOpenBuilder(formId) {
  FB.currentFormId = formId;
  FB.selectedQ = null;
  fbShowView('builder');

  const titleEl = document.getElementById('fb-builder-title');
  if (titleEl) titleEl.textContent = 'Carregando...';

  const res = await fetch(`/api/admin/forms/${formId}`, { headers: fbAuthH() });
  if (!res.ok) { fbToast('Erro ao carregar formulário.','error'); return; }
  const jf = await res.json();
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
      onclick="fbSelectPage(${p.id})" style="padding:6px 14px;border-radius:6px;border:1px solid ${FB.currentPage && FB.currentPage.id === p.id ? '#1A56DB' : '#E2E8F0'};background:${FB.currentPage && FB.currentPage.id === p.id ? '#EFF6FF' : '#fff'};color:${FB.currentPage && FB.currentPage.id === p.id ? '#1A56DB' : '#64748B'};font-size:13px;cursor:pointer;font-weight:${FB.currentPage && FB.currentPage.id === p.id ? '700' : '500'};">
      Página ${i+1}${p.title ? ': '+fbEsc(p.title) : ''}
    </button>
  `).join('') + `
    <button onclick="fbAddPage()" style="padding:6px 12px;border-radius:6px;border:1px dashed #CBD5E1;background:#F8FAFC;color:#64748B;font-size:13px;cursor:pointer;">
      + Página
    </button>
  `;
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
  if (res.ok) { const j = await res.json(); FB.currentForm = j.form || j; }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Canvas rendering
──────────────────────────────────────────────────────────────────────────────*/
function fbRenderCanvas() {
  const canvas = document.getElementById('fb-canvas');
  if (!canvas) return;

  if (!FB.currentPage) {
    canvas.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
      <div style="font-size:32px;margin-bottom:10px;">📄</div>
      <div style="font-size:14px;">Nenhuma página. Clique em "+ Página" para criar.</div>
    </div>`;
    return;
  }

  const questions = (FB.currentPage.questions || []).sort((a,b) => a.order_index - b.order_index);

  if (!questions.length) {
    canvas.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
      <div style="font-size:32px;margin-bottom:10px;">❓</div>
      <div style="font-size:14px;">Nenhuma questão nesta página.<br>Arraste um tipo da paleta ou clique para adicionar.</div>
    </div>`;
    return;
  }

  canvas.innerHTML = questions.map((q, i) => {
    const typeInfo = QB_TYPES.find(t => t.type === q.type) || { icon:'❓', label: q.type };
    const isActive = FB.selectedQ === q.id;
    return `
    <div class="fb-question-card ${isActive ? 'fb-q-active' : ''}"
         id="fb-q-${q.id}"
         onclick="fbSelectQuestion(${q.id})"
         style="background:#fff;border:2px solid ${isActive ? '#1A56DB' : '#E2E8F0'};border-radius:10px;padding:16px 18px;margin-bottom:8px;cursor:pointer;transition:border-color .15s,box-shadow .15s;${isActive ? 'box-shadow:0 0 0 3px rgba(26,86,219,.1);' : ''}">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;user-select:none;">${typeInfo.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;background:#F1F5F9;color:#64748B;border-radius:4px;padding:1px 6px;font-weight:500;">${typeInfo.label}</span>
            ${q.required ? '<span style="font-size:11px;background:#FEF2F2;color:#EF4444;border-radius:4px;padding:1px 6px;font-weight:500;">Obrigatório</span>' : ''}
            ${q.weight ? `<span style="font-size:11px;background:#F0FDF4;color:#16A34A;border-radius:4px;padding:1px 6px;font-weight:500;">Peso: ${q.weight}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:600;color:#1E293B;margin-top:4px;">${fbEsc(q.label) || '<em style="color:#94A3B8;">Sem título</em>'}</div>
          ${q.description ? `<div style="font-size:12px;color:#94A3B8;margin-top:2px;">${fbEsc(q.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'up')" title="Mover para cima"
            style="background:none;border:none;cursor:pointer;color:#94A3B8;padding:4px;border-radius:4px;font-size:14px;"
            ${i === 0 ? 'disabled style="opacity:.3;"' : ''}>↑</button>
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'down')" title="Mover para baixo"
            style="background:none;border:none;cursor:pointer;color:#94A3B8;padding:4px;border-radius:4px;font-size:14px;"
            ${i === questions.length-1 ? 'disabled style="opacity:.3;"' : ''}>↓</button>
          <button onclick="event.stopPropagation();fbDeleteQuestion(${q.id})" title="Excluir"
            style="background:none;border:none;cursor:pointer;color:#EF4444;padding:4px;border-radius:4px;font-size:14px;">🗑</button>
        </div>
      </div>
      ${fbRenderQuestionPreview(q)}
    </div>`;
  }).join('');
}

function fbRenderQuestionPreview(q) {
  if (q.type === 'section') return '';
  if (q.type === 'short_text')  return `<div style="margin-top:10px;"><input disabled placeholder="${fbEsc(q.placeholder || 'Resposta curta...')}" style="width:100%;padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#94A3B8;box-sizing:border-box;background:#F8FAFC;"></div>`;
  if (q.type === 'long_text')   return `<div style="margin-top:10px;"><textarea disabled placeholder="${fbEsc(q.placeholder || 'Resposta longa...')}" rows="2" style="width:100%;padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#94A3B8;box-sizing:border-box;background:#F8FAFC;resize:none;"></textarea></div>`;
  if (q.type === 'number' || q.type === 'currency' || q.type === 'percentage')
    return `<div style="margin-top:10px;"><input type="number" disabled placeholder="0" style="width:180px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#94A3B8;background:#F8FAFC;"></div>`;
  if (q.type === 'date')
    return `<div style="margin-top:10px;"><input type="date" disabled style="padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#94A3B8;background:#F8FAFC;"></div>`;
  if (q.type === 'single_choice' || q.type === 'multi_choice' || q.type === 'dropdown') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (!opts.length) return `<div style="margin-top:8px;font-size:12px;color:#94A3B8;">(Sem opções configuradas)</div>`;
    return `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
      ${opts.slice(0,3).map(o => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#64748B;cursor:default;">
        <input type="${q.type==='multi_choice'?'checkbox':'radio'}" disabled style="margin:0;"> ${fbEsc(typeof o === 'string' ? o : o.label || o)}
      </label>`).join('')}
      ${opts.length > 3 ? `<span style="font-size:12px;color:#94A3B8;">+ ${opts.length-3} mais opções...</span>` : ''}
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps' || q.type === 'rating') {
    const max = q.type === 'rating' ? 5 : (q.type === 'nps' ? 10 : (q.settings?.max || 10));
    return `<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap;">
      ${Array.from({length: Math.min(max,10)}, (_,i) => `<button disabled style="width:32px;height:32px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#94A3B8;font-size:12px;cursor:default;">${q.type==='rating'?'★':i+(q.type==='nps'?0:1)}</button>`).join('')}
      ${max > 10 ? `<span style="font-size:12px;color:#94A3B8;line-height:32px;">...</span>` : ''}
    </div>`;
  }
  if (q.type === 'yes_no')
    return `<div style="margin-top:10px;display:flex;gap:8px;"><button disabled style="padding:8px 20px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#94A3B8;font-size:13px;">✅ Sim</button><button disabled style="padding:8px 20px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#94A3B8;font-size:13px;">❌ Não</button></div>`;
  if (q.type === 'file_upload')
    return `<div style="margin-top:10px;padding:16px;border:2px dashed #E2E8F0;border-radius:8px;text-align:center;color:#94A3B8;font-size:13px;">📎 Clique ou arraste o arquivo aqui</div>`;
  if (q.type === 'calculated')
    return `<div style="margin-top:10px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;font-size:12px;color:#94A3B8;font-family:monospace;">${fbEsc(q.formula || 'Sem fórmula configurada')}</div>`;
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
  panel.innerHTML = `<div style="padding:24px;text-align:center;color:#94A3B8;">
    <div style="font-size:28px;margin-bottom:8px;">👈</div>
    <div style="font-size:13px;">Clique em uma questão para editar suas propriedades</div>
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
  <div style="padding:16px;">
    <div style="font-size:12px;background:#EFF6FF;color:#1A56DB;border-radius:6px;padding:4px 10px;display:inline-block;margin-bottom:12px;font-weight:600;">
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
    <div class="fb-prop-group" style="display:flex;align-items:center;justify-content:space-between;">
      <label class="fb-prop-label" style="margin:0;">Obrigatório</label>
      <input type="checkbox" id="fp-required" ${q.required?'checked':''} onchange="fbSavePropDebounced(${q.id})"
        style="width:16px;height:16px;cursor:pointer;">
    </div>

    ${fbRenderTypeSpecificProps(q)}

    <!-- Scoring -->
    <div style="border-top:1px solid #F1F5F9;margin:14px 0 10px;padding-top:10px;">
      <div style="font-size:12px;font-weight:700;color:#64748B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Pontuação</div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Peso da questão</label>
        <input id="fp-weight" type="number" min="0" class="fb-prop-input" value="${q.weight||0}"
          oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>

    <!-- Buttons -->
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
      <button class="btn-primary" onclick="fbSaveQuestion(${q.id})" style="font-size:13px;padding:8px;">
        💾 Salvar questão
      </button>
      ${['single_choice','multi_choice','dropdown','scale','nps','rating'].includes(q.type) ? `
      <button class="btn-ghost" onclick="fbOpenLogicEditor(${q.id})" style="font-size:13px;padding:8px;">
        🔀 Editar lógica condicional
      </button>` : ''}
    </div>
  </div>`;
}

function fbRenderTypeSpecificProps(q) {
  if (['single_choice','multi_choice','dropdown'].includes(q.type)) {
    const opts = Array.isArray(q.options) ? q.options : [];
    return `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Opções (uma por linha)</label>
      <textarea id="fp-options" class="fb-prop-input" rows="5"
        oninput="fbSavePropDebounced(${q.id})"
        style="resize:vertical;font-size:13px;">${opts.map(o=>typeof o==='string'?o:(o.label||o)).join('\n')}</textarea>
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps') {
    const s = q.settings || {};
    return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Mínimo</label>
        <input id="fp-scale-min" type="number" class="fb-prop-input" value="${s.min||1}" oninput="fbSavePropDebounced(${q.id})">
      </div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Máximo</label>
        <input id="fp-scale-max" type="number" class="fb-prop-input" value="${s.max||(q.type==='nps'?10:5)}" oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
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
        placeholder="Ex: {q1} * {q2} / 100"
        style="font-family:monospace;font-size:12px;resize:vertical;">${fbEsc(q.formula||'')}</textarea>
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
  clearTimeout(_fbSaveTimer);
  _fbSaveTimer = setTimeout(() => fbSaveQuestion(qId), 1200);
}

async function fbSaveQuestion(qId) {
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
    document.getElementById('fb-settings-panel').style.display = 'none';
  } else fbToast('Erro ao salvar.','error');
}

function fbToggleSettings() {
  const p = document.getElementById('fb-settings-panel');
  if (!p) return;
  const show = p.style.display === 'none' || !p.style.display;
  p.style.display = show ? '' : 'none';
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
  modal.style.display = 'flex';
  await fbLoadLogicRules(qId);
}

function fbCloseLogicModal() {
  document.getElementById('fb-logic-modal').style.display = 'none';
}

async function fbLoadLogicRules(qId) {
  const container = document.getElementById('fb-logic-rules');
  if (!container) return;
  container.innerHTML = '<div style="padding:16px;color:#94A3B8;">Carregando regras...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic?question_id=${qId}`, { headers: fbAuthH() });
  const jl = res.ok ? await res.json() : {};
  const rules = jl.rules || jl || [];

  const questions = (FB.currentForm.pages||[]).flatMap(p => p.questions||[]);
  const pages     = FB.currentForm.pages || [];

  if (!rules.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8;font-size:13px;">Nenhuma regra de lógica. Clique em "Adicionar regra".</div>';
    return;
  }

  container.innerHTML = rules.map((r, i) => `
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="font-size:12px;color:#64748B;">Se resposta</span>
      <span style="font-size:12px;font-weight:600;color:#1E293B;">${fbEsc(r.operator)}</span>
      <span style="font-size:12px;background:#EFF6FF;color:#1A56DB;border-radius:4px;padding:2px 8px;">"${fbEsc(r.condition_value)}"</span>
      <span style="font-size:12px;color:#64748B;">→</span>
      <span style="font-size:12px;font-weight:600;color:#1E293B;">${r.action}</span>
      ${r.target_page_id ? `<span style="font-size:12px;color:#64748B;">para página ${pages.findIndex(p=>p.id===r.target_page_id)+1}</span>` : ''}
      ${r.target_question_id ? `<span style="font-size:12px;color:#64748B;">questão #${r.target_question_id}</span>` : ''}
      <button onclick="fbDeleteLogicRule(${r.id})" style="margin-left:auto;background:none;border:none;color:#EF4444;cursor:pointer;font-size:13px;">🗑</button>
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
  modal.style.display = 'flex';
  await fbLoadAssignments();
}
function fbCloseAssignModal() {
  document.getElementById('fb-assign-modal').style.display = 'none';
}

async function fbLoadAssignments() {
  const el = document.getElementById('fb-assign-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:12px;color:#94A3B8;font-size:13px;">Carregando...</div>';
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/assignments`, { headers: fbAuthH() });
  const ja = res.ok ? await res.json() : {};
  const data = ja.assignments || ja || [];
  el.innerHTML = data.length
    ? data.map(a => {
        const u = a['re_users!re_form_assignments_user_id_fkey'] || a;
        const uname = u.name || a.user_name || '—';
        const uemail = u.email || a.user_email || '—';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#1E293B;">${fbEsc(uname)}</div>
            <div style="font-size:11px;color:#94A3B8;">${fbEsc(uemail)}</div>
          </div>
          <button onclick="fbRemoveAssignment(${a.user_id})" style="background:none;border:none;color:#EF4444;cursor:pointer;font-size:12px;">Remover</button>
        </div>`;}).join('')
    : '<div style="padding:12px;color:#94A3B8;font-size:13px;">Nenhum cliente atribuído.</div>';
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
  if (el) el.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando...</div>';

  const res = await fetch(`/api/admin/forms/${formId}/responses`, { headers: fbAuthH() });
  if (!res.ok) { if(el) el.innerHTML='<div style="padding:24px;color:#EF4444;">Erro ao carregar respostas.</div>'; return; }
  const jr = await res.json();
  FB.responses = jr.responses || jr;

  const STATUS_CLS = { em_andamento:'badge-blue', concluido:'badge-green', abandonado:'badge-gray' };
  const STATUS_LBL = { em_andamento:'Em andamento', concluido:'Concluído', abandonado:'Abandonado' };
  const CLASS_CLS  = { saudavel:'badge-green', risco_moderado:'badge-amber', risco_alto:'badge-red' };
  const CLASS_LBL  = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };

  if (!FB.responses.length) {
    if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:#94A3B8;"><div style="font-size:32px;margin-bottom:10px;">📭</div><div style="font-size:14px;">Nenhuma resposta ainda.</div></div>';
    return;
  }

  if (el) el.innerHTML = `
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="border-bottom:2px solid #F1F5F9;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Cliente</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Status</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Pontuação</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Classificação</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Data</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;">Ação</th>
      </tr>
    </thead>
    <tbody>
      ${FB.responses.map(r => {
        const u = r['re_users!re_form_responses_user_id_fkey'] || {};
        const uname  = u.name  || r.user_name  || '—';
        const uemail = u.email || r.user_email || '—';
        return `
      <tr style="border-bottom:1px solid #F8FAFC;cursor:pointer;" onclick="fbOpenResponseDetail(${r.id})"
          onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background=''">
        <td style="padding:10px 12px;">
          <div style="font-size:13px;font-weight:600;color:#1E293B;">${fbEsc(uname)}</div>
          <div style="font-size:11px;color:#94A3B8;">${fbEsc(uemail)}</div>
        </td>
        <td style="padding:10px 12px;"><span class="badge ${STATUS_CLS[r.status]||'badge-gray'}">${STATUS_LBL[r.status]||r.status}</span></td>
        <td style="padding:10px 12px;">
          ${r.score_pct != null ? `<span style="font-size:14px;font-weight:700;color:#1A56DB;">${Math.round(r.score_pct)}%</span>
          <span style="font-size:11px;color:#94A3B8;margin-left:4px;">${r.score_total||0}/${r.score_max||0}</span>` : '—'}
        </td>
        <td style="padding:10px 12px;">
          ${r.score_classification ? `<span class="badge ${CLASS_CLS[r.score_classification]||'badge-gray'}">${CLASS_LBL[r.score_classification]||r.score_classification}</span>` : '—'}
        </td>
        <td style="padding:10px 12px;font-size:12px;color:#94A3B8;">${r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:10px 12px;">
          <button class="btn-ghost" style="font-size:12px;padding:4px 10px;" onclick="event.stopPropagation();fbOpenResponseDetail(${r.id})">
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
  modal.style.display = 'flex';

  const body = document.getElementById('fb-resp-detail-body');
  if (body) body.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando detalhes...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/responses/${respId}`, { headers: fbAuthH() });
  if (!res.ok) { if(body) body.innerHTML='<div style="padding:24px;color:#EF4444;">Erro ao carregar.</div>'; return; }
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
    <div style="background:linear-gradient(135deg,#1e3a5f,#1A56DB);border-radius:10px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;color:#fff;">
      <div>
        <div style="font-size:24px;font-weight:800;">${Math.round(data.score_pct)}%</div>
        <div style="font-size:13px;opacity:.85;">Pontuação: ${data.score_total||0} / ${data.score_max||0} pontos</div>
      </div>
      ${data.score_classification ? `<span style="background:rgba(255,255,255,.2);border-radius:6px;padding:4px 12px;font-size:13px;font-weight:600;">${CLASS_LBL[data.score_classification]||data.score_classification}</span>` : ''}
    </div>` : ''}

    <!-- Auto-report -->
    ${data.auto_report ? `
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#16A34A;margin-bottom:6px;">📄 RELATÓRIO AUTOMÁTICO</div>
      <div style="font-size:13px;color:#166534;white-space:pre-wrap;">${fbEsc(data.auto_report)}</div>
    </div>` : ''}

    <!-- Answers -->
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${answers.map(a => `
      <div style="border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;">
        <div style="font-size:12px;color:#94A3B8;margin-bottom:4px;">${fbEsc(a.question_label||'Questão #'+a.question_id)}</div>
        <div style="font-size:14px;color:#1E293B;font-weight:500;">${a.value_json ? JSON.stringify(a.value_json) : (fbEsc(a.value) || '<em style="color:#94A3B8;">Sem resposta</em>')}</div>
        ${a.score != null ? `<div style="margin-top:4px;font-size:11px;color:#16A34A;font-weight:600;">Pontos: ${a.score}</div>` : ''}
      </div>`).join('')}
    </div>
  `;
}

function fbCloseRespDetailModal() {
  document.getElementById('fb-resp-detail-modal').style.display = 'none';
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
