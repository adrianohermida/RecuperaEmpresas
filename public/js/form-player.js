/**
 * form-player.js  — Client Form Player
 * Recupera Empresas | Professional Form Player with logic engine, scoring, auto-save
 *
 * API:
 *   loadClientForms()          — called by showSection('formularios')
 *   fpPlayForm(formId)         — open the player modal for a form
 */
'use strict';

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────────*/
function fpToken() { return localStorage.getItem('re_token'); }
function fpAuthH() { return { 'Content-Type':'application/json', 'Authorization':'Bearer '+fpToken() }; }

function fpEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fpToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log('[FP]', type, msg);
}

/* ──────────────────────────────────────────────────────────────────────────────
   State
──────────────────────────────────────────────────────────────────────────────*/
const FP = {
  forms:         [],    // assigned forms list
  currentForm:   null,  // full form object (pages, questions, logic)
  currentFormId: null,
  responseId:    null,  // active response ID
  currentPageIdx:0,     // current page index (visible pages array)
  visiblePages:  [],    // pages after applying logic
  answers:       {},    // { questionId: value }
  saving:        false,
  autoSaveTimer: null,
};

/* ──────────────────────────────────────────────────────────────────────────────
   Load forms list (client section)
──────────────────────────────────────────────────────────────────────────────*/
async function loadClientForms() {
  const el = document.getElementById('fp-forms-list');
  if (!el) return;
  el.innerHTML = '<div class="fp-list-loading">Carregando formulários...</div>';

  const res = await fetch('/api/my-forms', { headers: fpAuthH() });
  if (!res.ok) { el.innerHTML = '<div class="fp-list-error">Erro ao carregar formulários.</div>'; return; }
  FP.forms = await res.json();

  if (!FP.forms.length) {
    el.innerHTML = `<div class="fp-list-empty">
      <div class="fp-list-empty-icon">📋</div>
      <div class="fp-list-empty-title">Nenhum formulário atribuído</div>
      <div class="fp-list-empty-copy">Quando seu consultor atribuir formulários, eles aparecerão aqui.</div>
    </div>`;
    return;
  }

  const TYPE_LABELS = { diagnostico:'Diagnóstico', pesquisa:'Pesquisa', avaliacao:'Avaliação', onboarding:'Onboarding', outro:'Outro' };
  const STATUS_MAP  = {
    nao_iniciado: { label:'Não iniciado', cls:'badge-gray',  icon:'⬜', btn:'Iniciar' },
    em_andamento: { label:'Em andamento', cls:'badge-blue',  icon:'⏳', btn:'Continuar' },
    concluido:    { label:'Concluído',    cls:'badge-green', icon:'✅', btn:'Ver resultado' },
  };

  el.innerHTML = FP.forms.map(f => {
    const st = STATUS_MAP[f.response_status] || STATUS_MAP.nao_iniciado;
    const progress = f.response_progress || 0;
    return `
    <div class="fp-list-card">
      <div class="fp-list-card-icon">${st.icon}</div>
      <div class="fp-list-card-copy">
        <div class="fp-list-card-header">
          <div class="fp-list-card-title">${fpEsc(f.title)}</div>
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
        <div class="fp-list-card-type">${TYPE_LABELS[f.type] || f.type || ''}</div>
        ${f.description ? `<div class="fp-list-card-desc">${fpEsc(f.description)}</div>` : ''}
        ${f.response_status === 'em_andamento' ? `
          <div class="fp-list-progress-block">
            <div class="fp-list-progress-meta">
              <span>Progresso</span><span>${f.response_progress || 0}%</span>
            </div>
            <div class="fp-list-progress-track">
              <div class="fp-list-progress-fill" data-progress="${progress}"></div>
            </div>
          </div>` : ''}
        ${f.response_status === 'concluido' && f.score_pct != null ? `
          <div class="fp-list-score">
            Pontuação: ${Math.round(f.score_pct)}%
          </div>` : ''}
      </div>
      <div class="fp-list-card-action">
        <button class="btn-primary fp-list-card-btn" onclick="fpPlayForm(${f.id})">
          ${st.btn} →
        </button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.fp-list-progress-fill').forEach(bar => {
    bar.style.width = `${bar.dataset.progress || 0}%`;
  });
}

/* ──────────────────────────────────────────────────────────────────────────────
   Open form player modal
──────────────────────────────────────────────────────────────────────────────*/
async function fpPlayForm(formId) {
  FP.currentFormId = formId;
  FP.answers       = {};
  FP.responseId    = null;
  FP.currentPageIdx= 0;

  // Open modal early, show loading
  const modal = document.getElementById('fp-player-modal');
  if (!modal) { fpToast('Player não disponível.','error'); return; }
  modal.style.display = 'flex';

  const content = document.getElementById('fp-player-content');
  if (content) content.innerHTML = `<div class="fp-modal-state fp-modal-state-muted">
    <div class="fp-modal-state-icon">⏳</div>
    <div class="fp-modal-state-copy">Carregando formulário...</div>
  </div>`;

  // Load full form
  const res = await fetch(`/api/my-forms/${formId}`, { headers: fpAuthH() });
  if (!res.ok) {
    if (content) content.innerHTML = '<div class="fp-modal-state fp-modal-state-error">Erro ao carregar formulário.</div>';
    return;
  }
  FP.currentForm = await res.json();

  // Restore any existing response
  if (FP.currentForm.existing_response) {
    const er = FP.currentForm.existing_response;
    FP.responseId = er.id;
    // Pre-fill answers
    (er.answers || []).forEach(a => {
      FP.answers[a.question_id] = a.value_json !== undefined ? a.value_json : a.value;
    });
  }

  // Build visible pages (apply logic to initial state)
  fpRebuildVisiblePages();

  // Find resume page
  if (FP.currentForm.existing_response?.current_page_id) {
    const cpId = FP.currentForm.existing_response.current_page_id;
    const idx  = FP.visiblePages.findIndex(p => p.id === cpId);
    if (idx >= 0) FP.currentPageIdx = idx;
  }

  // Render
  fpRenderPlayer();
}

function fpClosePlayer() {
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.style.display = 'none';
  clearTimeout(FP.autoSaveTimer);
  // Refresh forms list
  loadClientForms();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic engine — rebuild visible pages
──────────────────────────────────────────────────────────────────────────────*/
function fpRebuildVisiblePages() {
  const allPages = (FP.currentForm.pages || []).sort((a,b) => a.order_index - b.order_index);
  const logic    = FP.currentForm.logic || [];

  // Determine hidden questions first, then hidden pages
  const hiddenQIds   = new Set();
  const hiddenPageIds = new Set();

  logic.forEach(rule => {
    const srcQ   = fpFindQuestion(rule.source_question_id);
    if (!srcQ) return;
    const answer = FP.answers[rule.source_question_id];
    if (fpEvalCondition(answer, rule.operator, rule.condition_value)) {
      if (rule.action === 'hide_question' && rule.target_question_id)
        hiddenQIds.add(rule.target_question_id);
      if (rule.action === 'skip_to_page' && rule.target_page_id)
        hiddenPageIds.add(rule.target_page_id);
    }
  });

  FP.visiblePages = allPages.map(p => ({
    ...p,
    questions: (p.questions||[])
      .sort((a,b) => a.order_index - b.order_index)
      .filter(q => !hiddenQIds.has(q.id))
  })).filter(p => !hiddenPageIds.has(p.id));
}

function fpFindQuestion(qId) {
  for (const page of (FP.currentForm.pages||[])) {
    const q = (page.questions||[]).find(q => q.id === qId);
    if (q) return q;
  }
  return null;
}

function fpEvalCondition(answer, operator, condValue) {
  const a = answer == null ? '' : String(answer);
  const c = String(condValue);
  switch (operator) {
    case 'equals':        return a === c;
    case 'not_equals':    return a !== c;
    case 'contains':      return a.includes(c);
    case 'greater_than':  return parseFloat(a) > parseFloat(c);
    case 'less_than':     return parseFloat(a) < parseFloat(c);
    case 'is_answered':   return a.trim() !== '';
    case 'is_empty':      return a.trim() === '';
    default:              return false;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Render player
──────────────────────────────────────────────────────────────────────────────*/
function fpRenderPlayer() {
  const content = document.getElementById('fp-player-content');
  if (!content) return;

  const total   = FP.visiblePages.length;
  const idx     = Math.min(FP.currentPageIdx, total - 1);
  const page    = FP.visiblePages[idx];
  const pct     = total > 1 ? Math.round((idx / (total - 1)) * 100) : (idx === 0 ? 0 : 100);
  const isFirst = idx === 0;
  const isLast  = idx === total - 1;

  // Title
  const titleEl = document.getElementById('fp-player-title');
  if (titleEl) titleEl.textContent = FP.currentForm.title || 'Formulário';

  // Progress bar
  const pb = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = pct + '%';
  const pbLabel = document.getElementById('fp-player-progress-label');
  if (pbLabel) pbLabel.textContent = `Página ${idx+1} de ${total}`;

  if (!page) {
    content.innerHTML = '<div class="fp-modal-state fp-modal-state-muted">Formulário sem páginas.</div>';
    return;
  }

  const questions = page.questions || [];

  content.innerHTML = `
    ${page.title ? `<div class="fp-page-header">
      <h2 class="fp-page-title">${fpEsc(page.title)}</h2>
      ${page.description ? `<div class="fp-page-desc">${fpEsc(page.description)}</div>` : ''}
    </div>` : ''}
    <div id="fp-questions" class="fp-questions">
      ${questions.map(q => fpRenderQuestion(q)).join('')}
    </div>
    <!-- Nav -->
    <div class="fp-page-nav">
      <button onclick="fpPrevPage()" class="btn-ghost fp-page-nav-btn ${isFirst ? 'fp-page-nav-btn-hidden' : ''}">
        ← Anterior
      </button>
      <button onclick="${isLast ? 'fpSubmitForm()' : 'fpNextPage()'}"
        class="btn-primary fp-page-nav-btn fp-page-nav-btn-primary" id="fp-next-btn">
        ${isLast ? '✅ Enviar formulário' : 'Próxima →'}
      </button>
    </div>
  `;

  // Wire up change handlers
  questions.forEach(q => fpWireQuestion(q));
  // Re-fill saved answers
  questions.forEach(q => fpRestoreAnswer(q));
}

/* ──────────────────────────────────────────────────────────────────────────────
   Question renderers
──────────────────────────────────────────────────────────────────────────────*/
function fpRenderQuestion(q) {
  const reqMark = q.required ? '<span class="fp-question-required">*</span>' : '';
  return `
  <div class="fp-question" id="fpq-${q.id}">
    ${q.type !== 'section' ? `
    <label class="fp-question-label">
      ${fpEsc(q.label)}${reqMark}
    </label>
    ${q.description ? `<div class="fp-question-desc">${fpEsc(q.description)}</div>` : ''}
    ` : `<div class="fp-question-section">${fpEsc(q.label)}</div>`}
    ${fpRenderInput(q)}
    <div id="fpq-err-${q.id}" class="fp-question-error"></div>
  </div>`;
}

function fpRenderInput(q) {
  const id = `fpinput-${q.id}`;
  switch (q.type) {
    case 'section': return '';
    case 'short_text':
      return `<input id="${id}" type="text" class="portal-input fp-input-limit-lg" placeholder="${fpEsc(q.placeholder||'')}">`;
    case 'long_text':
      return `<textarea id="${id}" class="portal-input fp-input-textarea" rows="4" placeholder="${fpEsc(q.placeholder||'')}"></textarea>`;
    case 'number':
      return `<input id="${id}" type="number" class="portal-input fp-input-limit-sm" placeholder="${fpEsc(q.placeholder||'0')}">`;
    case 'currency':
      return `<div class="fp-inline-input fp-inline-input-md">
        <span class="fp-inline-input-prefix">R$</span>
        <input id="${id}" type="number" min="0" step="0.01" class="portal-input fp-inline-input-control" placeholder="0,00">
      </div>`;
    case 'percentage':
      return `<div class="fp-inline-input fp-inline-input-sm">
        <input id="${id}" type="number" min="0" max="100" step="0.1" class="portal-input fp-inline-input-control" placeholder="0">
        <span class="fp-inline-input-prefix">%</span>
      </div>`;
    case 'date':
      return `<input id="${id}" type="date" class="portal-input fp-input-limit-md">`;
    case 'single_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div class="fp-choice-list" id="${id}-wrap">
        ${opts.map((o,i) => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label class="fp-choice-option"
            onclick="fpSelectRadio(this, '${id}', '${fpEsc(label)}')">
            <input type="radio" name="${id}" value="${fpEsc(label)}" class="fp-choice-input">
            <span class="fp-choice-copy">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'multi_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div class="fp-choice-list" id="${id}-wrap">
        ${opts.map((o,i) => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label class="fp-choice-option">
            <input type="checkbox" value="${fpEsc(label)}" data-mcq="${q.id}" class="fp-choice-input"
              onchange="fpCheckboxChange(${q.id})">
            <span class="fp-choice-copy">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'dropdown': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<select id="${id}" class="portal-input fp-input-limit-select">
        <option value="">Selecione...</option>
        ${opts.map(o => { const l = typeof o==='string'?o:(o.label||o); return `<option value="${fpEsc(l)}">${fpEsc(l)}</option>`; }).join('')}
      </select>`;
    }
    case 'scale': {
      const s   = q.settings || {};
      const min = parseInt(s.min) || 1;
      const max = parseInt(s.max) || 10;
      const range = [];
      for (let i = min; i <= max; i++) range.push(i);
      return `<div>
        <div class="fp-scale-wrap fp-scale-wrap-default" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            class="fp-scale-btn">
            ${v}
          </button>`).join('')}
        </div>
        ${s.label_min||s.label_max ? `<div class="fp-scale-labels">
          <span>${fpEsc(s.label_min||'')}</span><span>${fpEsc(s.label_max||'')}</span>
        </div>` : ''}
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'nps': {
      const range = [];
      for (let i = 0; i <= 10; i++) range.push(i);
      return `<div>
        <div class="fp-scale-wrap fp-scale-wrap-nps" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            class="fp-scale-btn ${fpGetNpsToneClass(v)}">
            ${v}
          </button>`).join('')}
        </div>
        <div class="fp-scale-labels">
          <span>Detrator</span><span>Promotor</span>
        </div>
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'rating': {
      return `<div class="fp-rating-wrap" id="${id}-wrap">
        ${[1,2,3,4,5].map(v => `<button type="button" data-rating="${q.id}" data-val="${v}"
          onclick="fpSelectRating(${q.id}, ${v})"
          class="fp-rating-btn">★</button>`).join('')}
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'yes_no':
      return `<div class="fp-yesno-wrap" id="${id}-wrap">
        <button type="button" data-yn="${q.id}" data-val="sim"
          onclick="fpSelectYesNo(${q.id}, 'sim')"
          class="fp-yesno-btn">
          ✅ Sim
        </button>
        <button type="button" data-yn="${q.id}" data-val="nao"
          onclick="fpSelectYesNo(${q.id}, 'nao')"
          class="fp-yesno-btn">
          ❌ Não
        </button>
        <input type="hidden" id="${id}">
      </div>`;
    case 'file_upload':
      return `<div class="fp-upload-dropzone"
          onclick="document.getElementById('${id}').click()">
        <div class="fp-upload-icon">📎</div>
        <div class="fp-upload-copy">Clique para selecionar o arquivo</div>
        <input type="file" id="${id}" class="fp-upload-input" onchange="fpFileChange(${q.id}, this)">
        <div id="fpfile-name-${q.id}" class="fp-upload-file-name"></div>
      </div>`;
    case 'calculated':
      return `<div id="${id}-result" class="fp-calculated-result">
        Calculado automaticamente
      </div><input type="hidden" id="${id}">`;
    default:
      return `<input id="${id}" type="text" class="portal-input" placeholder="Resposta...">`;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Wire change handlers
──────────────────────────────────────────────────────────────────────────────*/
function fpWireQuestion(q) {
  const id = `fpinput-${q.id}`;
  const el = document.getElementById(id);

  if (['short_text','long_text','number','currency','percentage','date','dropdown'].includes(q.type)) {
    if (el) el.addEventListener('input', () => {
      FP.answers[q.id] = el.value;
      fpTriggerLogic();
      fpScheduleAutoSave();
    });
  }
  // radio / checkbox / scale / rating / yes_no handled by onclick
}

function fpRestoreAnswer(q) {
  const val = FP.answers[q.id];
  if (val == null) return;
  const id = `fpinput-${q.id}`;

  if (['short_text','long_text','number','currency','percentage','date'].includes(q.type)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  } else if (q.type === 'dropdown') {
    const el = document.getElementById(id);
    if (el) el.value = val;
  } else if (q.type === 'single_choice') {
    document.querySelectorAll(`input[name="${id}"]`).forEach(r => {
      if (r.value === val) {
        r.checked = true;
        r.closest('label')?.classList.add('fp-choice-option-selected');
      }
    });
  } else if (q.type === 'multi_choice') {
    const vals = Array.isArray(val) ? val : [];
    document.querySelectorAll(`input[data-mcq="${q.id}"]`).forEach(cb => {
      cb.checked = vals.includes(cb.value);
      cb.closest('label')?.classList.toggle('fp-choice-option-selected', cb.checked);
    });
  } else if (q.type === 'scale' || q.type === 'nps') {
    const el = document.getElementById(id);
    if (el) el.value = val;
    fpSelectScale(q.id, parseInt(val), true);
  } else if (q.type === 'rating') {
    fpSelectRating(q.id, parseInt(val), true);
  } else if (q.type === 'yes_no') {
    fpSelectYesNo(q.id, val, true);
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Input interaction helpers
──────────────────────────────────────────────────────────────────────────────*/
function fpSelectRadio(labelEl, inputName, value) {
  // Reset all labels in this group
  document.querySelectorAll(`input[name="${inputName}"]`).forEach(r => {
    r.closest('label')?.classList.remove('fp-choice-option-selected');
  });
  labelEl.classList.add('fp-choice-option-selected');
  const qId = parseInt(inputName.replace('fpinput-',''));
  FP.answers[qId] = value;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpCheckboxChange(qId) {
  const vals = [];
  document.querySelectorAll(`input[data-mcq="${qId}"]`).forEach(cb => {
    if (cb.checked) vals.push(cb.value);
    cb.closest('label')?.classList.toggle('fp-choice-option-selected', cb.checked);
  });
  FP.answers[qId] = vals;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpSelectScale(qId, val, skipSave) {
  const id = `fpinput-${qId}`;
  document.querySelectorAll(`button[data-scale="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-scale-btn-active', parseInt(b.dataset.val) === val);
  });
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectRating(qId, val, skipSave) {
  const id = `fpinput-${qId}`;
  document.querySelectorAll(`button[data-rating="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-rating-btn-active', parseInt(b.dataset.val) <= val);
  });
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectYesNo(qId, val, skipSave) {
  document.querySelectorAll(`button[data-yn="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-yesno-btn-active', b.dataset.val === val);
  });
  const hidden = document.getElementById(`fpinput-${qId}`);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpFileChange(qId, input) {
  const file = input.files[0];
  if (!file) return;
  const nameEl = document.getElementById('fpfile-name-'+qId);
  if (nameEl) nameEl.textContent = file.name;
  FP.answers[qId] = file.name; // actual upload would be a separate endpoint
  fpScheduleAutoSave();
}

function fpGetNpsToneClass(value) {
  if (value <= 6) return 'fp-scale-btn-nps-low';
  if (value <= 8) return 'fp-scale-btn-nps-mid';
  return 'fp-scale-btn-nps-high';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic — rebuild pages after each answer change
──────────────────────────────────────────────────────────────────────────────*/
function fpTriggerLogic() {
  fpRebuildVisiblePages();
  // Update progress bar without full re-render
  const total = FP.visiblePages.length;
  const idx   = Math.min(FP.currentPageIdx, total - 1);
  const pct   = total > 1 ? Math.round((idx / (total-1)) * 100) : 0;
  const pb    = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = pct + '%';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Navigation
──────────────────────────────────────────────────────────────────────────────*/
function fpNextPage() {
  if (!fpValidatePage()) return;
  fpSaveProgress();
  FP.currentPageIdx = Math.min(FP.currentPageIdx + 1, FP.visiblePages.length - 1);
  fpRenderPlayer();
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.scrollTop = 0;
}

function fpPrevPage() {
  FP.currentPageIdx = Math.max(FP.currentPageIdx - 1, 0);
  fpRenderPlayer();
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.scrollTop = 0;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Validation
──────────────────────────────────────────────────────────────────────────────*/
function fpValidatePage() {
  const page = FP.visiblePages[FP.currentPageIdx];
  if (!page) return true;
  let valid = true;
  (page.questions||[]).forEach(q => {
    const errEl = document.getElementById(`fpq-err-${q.id}`);
    if (!q.required) { if(errEl) errEl.style.display='none'; return; }
    const val = FP.answers[q.id];
    const isEmpty = val == null || val === '' || (Array.isArray(val) && val.length === 0);
    if (isEmpty) {
      if (errEl) {
        errEl.textContent = 'Esta questão é obrigatória.';
        errEl.classList.add('fp-question-error-visible');
      }
      const qEl = document.getElementById(`fpq-${q.id}`);
      if (qEl) qEl.classList.add('fp-question-invalid');
      valid = false;
    } else {
      if (errEl) errEl.classList.remove('fp-question-error-visible');
      const qEl = document.getElementById(`fpq-${q.id}`);
      if (qEl) qEl.classList.remove('fp-question-invalid');
    }
  });
  if (!valid) { fpToast('Responda as questões obrigatórias antes de continuar.','error'); }
  return valid;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Auto-save progress
──────────────────────────────────────────────────────────────────────────────*/
function fpScheduleAutoSave() {
  clearTimeout(FP.autoSaveTimer);
  FP.autoSaveTimer = setTimeout(() => fpSaveProgress(), 2000);
}

async function fpSaveProgress() {
  if (FP.saving) return;
  FP.saving = true;
  try {
    const currentPage = FP.visiblePages[FP.currentPageIdx];
    const body = {
      answers:         FP.answers,
      current_page_id: currentPage?.id || null,
      status:          'em_andamento',
    };
    const res = await fetch(`/api/my-forms/${FP.currentFormId}/response`, {
      method: 'POST', headers: fpAuthH(), body: JSON.stringify(body)
    });
    if (res.ok) {
      const j = await res.json();
      FP.responseId = j.response_id || FP.responseId;
    }
  } catch(e) { /* silent */ }
  FP.saving = false;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Submit form
──────────────────────────────────────────────────────────────────────────────*/
async function fpSubmitForm() {
  if (!fpValidatePage()) return;

  const btn = document.getElementById('fp-next-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  try {
    const body = {
      answers: FP.answers,
      status:  'concluido',
    };
    const res = await fetch(`/api/my-forms/${FP.currentFormId}/response`, {
      method:'POST', headers: fpAuthH(), body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Erro ao enviar');
    const j = await res.json();
    fpShowCompletion(j);
  } catch(e) {
    fpToast('Erro ao enviar formulário. Tente novamente.','error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Enviar formulário'; }
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Completion screen
──────────────────────────────────────────────────────────────────────────────*/
function fpShowCompletion(data) {
  const content = document.getElementById('fp-player-content');
  if (!content) return;

  const score = data.score_pct != null ? Math.round(data.score_pct) : null;
  const CLASS_LBL = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };
  const CLASS_CLR = { saudavel:'#16A34A', risco_moderado:'#D97706', risco_alto:'#DC2626' };

  const pb = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = '100%';

  content.innerHTML = `
    <div class="fp-submit-success">
      <div class="fp-submit-success-icon">🎉</div>
      <h2 class="fp-submit-success-title">Formulário enviado!</h2>
      <p class="fp-submit-success-copy">Suas respostas foram registradas com sucesso.</p>

      ${score != null ? `
      <div class="fp-submit-score-card">
        <div class="fp-submit-score-value">${score}%</div>
        <div class="fp-submit-score-copy ${data.score_classification ? 'fp-submit-score-copy-spaced' : ''}">Pontuação total: ${data.score_total||0} / ${data.score_max||0}</div>
        ${data.score_classification ? `<div class="fp-submit-score-badge">${CLASS_LBL[data.score_classification]||data.score_classification}</div>` : ''}
      </div>` : ''}

      ${data.auto_report ? `
      <div class="fp-submit-report-card">
        <div class="fp-submit-report-title">📄 Seu relatório de diagnóstico</div>
        <div class="fp-submit-report-copy">${fpEsc(data.auto_report)}</div>
      </div>` : ''}

      <button class="btn-primary fp-submit-success-btn" onclick="fpClosePlayer()">
        ← Voltar ao portal
      </button>
    </div>
  `;

  // Hide nav
  const titleEl = document.getElementById('fp-player-title');
  if (titleEl) titleEl.textContent = 'Concluído';
}

/* ══════════════════════════════════════════════════════════════════════════════
   CLIENT JOURNEYS
══════════════════════════════════════════════════════════════════════════════*/

async function loadClientJourneys() {
  const el = document.getElementById('client-journeys-list');
  if (!el) return;

  // Show nav button only when there are journeys
  el.innerHTML = '<div class="fp-list-loading">Carregando...</div>';

  let journeys = [];
  try {
    const res = await fetch('/api/my-journeys', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (res.ok) journeys = await res.json();
  } catch {}

  // Show/hide sidebar button
  const btn = document.getElementById('jornadasSideLink');
  if (btn) btn.style.display = journeys.length ? '' : 'none';

  if (!journeys.length) {
    el.innerHTML = `<div class="fp-journey-empty">
      <div class="fp-journey-empty-icon">🗺️</div>
      <div class="fp-journey-empty-title">Nenhuma jornada atribuída</div>
      <div class="fp-journey-empty-copy">Sua consultoria ainda não atribuiu nenhuma jornada à sua conta.</div>
    </div>`;
    return;
  }

  const STATUS_LBL   = { active:'Em andamento', completed:'Concluída', paused:'Pausada', cancelled:'Cancelada' };

  el.innerHTML = journeys.map(j => {
    const done  = j.steps.filter(s => s.completed).length;
    const total = j.steps.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;
    const stepsHtml = j.steps.map((s, i) => `
      <div class="fp-journey-step ${i < j.steps.length - 1 ? 'fp-journey-step-lined' : ''}">
        <div class="fp-journey-step-index ${fpJourneyStepStateClass(s, i === j.current_step_index)}">
          ${s.completed ? '✓' : i + 1}
        </div>
        <div class="fp-journey-step-copy">
          <div class="fp-journey-step-title ${fpJourneyStepTitleClass(s, i === j.current_step_index)}">
            ${fpEsc(s.title)}
          </div>
          ${s.re_forms ? `<div class="fp-journey-step-form">📋 ${fpEsc(s.re_forms.title)}</div>` : ''}
          ${i === j.current_step_index && !s.completed && s.re_forms
            ? (s.re_forms.system_key === 'onboarding_14steps'
                ? `<button class="btn-primary fp-journey-step-btn" onclick="showSection('onboarding',document.getElementById('onboardSideLink'))">Ir para Onboarding →</button>`
                : `<button class="btn-primary fp-journey-step-btn" onclick="fpOpenPlayer('${s.re_forms.id}')">Responder formulário →</button>`)
            : ''}
        </div>
      </div>
    `).join('');

    return `
    <div class="portal-card fp-journey-card">
      <div class="fp-journey-card-header">
        <div class="fp-journey-card-headline">
          <div class="fp-journey-card-title">${fpEsc(j.journey_name)}</div>
          <span class="fp-journey-card-status">${STATUS_LBL[j.status] || j.status}</span>
        </div>
        ${j.journey_description ? `<div class="fp-journey-card-desc">${fpEsc(j.journey_description)}</div>` : ''}
        <div class="fp-journey-card-progress-row">
          <div class="fp-journey-card-progress-track">
            <div class="fp-journey-card-progress-fill" data-progress="${pct}"></div>
          </div>
          <span class="fp-journey-card-progress-label">${done}/${total} etapas • ${pct}%</span>
        </div>
      </div>
      <div class="fp-journey-card-body">
        ${stepsHtml || '<div class="fp-journey-card-empty">Nenhuma etapa configurada.</div>'}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.fp-journey-card-progress-fill').forEach(bar => {
    bar.style.width = `${bar.dataset.progress || 0}%`;
  });
}

function fpJourneyStepStateClass(step, isCurrent) {
  if (step.completed) return 'fp-journey-step-index-completed';
  if (isCurrent) return 'fp-journey-step-index-current';
  return 'fp-journey-step-index-pending';
}

function fpJourneyStepTitleClass(step, isCurrent) {
  if (step.completed) return 'fp-journey-step-title-completed';
  if (isCurrent) return 'fp-journey-step-title-current';
  return 'fp-journey-step-title-pending';
}
