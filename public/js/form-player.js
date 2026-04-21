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
function fpToken() {
  if (window.REShared && typeof window.REShared.getStoredToken === 'function') {
    return window.REShared.getStoredToken({ allowImpersonation: true });
  }
  return localStorage.getItem('re_token') || sessionStorage.getItem('re_impersonate_token');
}
function fpAuthH() {
  if (window.REShared && typeof window.REShared.buildAuthHeaders === 'function') {
    return window.REShared.buildAuthHeaders({ allowImpersonation: true });
  }
  return { 'Content-Type':'application/json', 'Authorization':'Bearer '+fpToken() };
}

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
  lastFocusEl:   null,
};

function fpSetModalOpen(open) {
  const modal = document.getElementById('fp-player-modal');
  if (!modal) return;

  modal.classList.toggle('dashboard-player-modal-open', open);
  document.body.classList.toggle('dashboard-modal-active', open);

  if (open) {
    FP.lastFocusEl = document.activeElement;
    const closeBtn = modal.querySelector('.dashboard-player-modal-close');
    if (closeBtn) closeBtn.focus();
    return;
  }

  if (FP.lastFocusEl && typeof FP.lastFocusEl.focus === 'function') {
    FP.lastFocusEl.focus();
  }
  FP.lastFocusEl = null;
}

function fpHandleModalBackdrop(event) {
  if (event.target && event.target.id === 'fp-player-modal') {
    fpClosePlayer();
  }
}

function fpHandleModalKeydown(event) {
  if (event.key === 'Escape') {
    fpClosePlayer();
  }
}

function fpApplyPercentClass(element, value) {
  if (!window.REShared || typeof window.REShared.applyPercentClass !== 'function') return;
  window.REShared.applyPercentClass(element, value);
}

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
    fpApplyPercentClass(bar, bar.dataset.progress || 0);
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
  fpSetModalOpen(true);

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
  fpSetModalOpen(false);
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
  fpApplyPercentClass(pb, pct);
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
    if (!q.required) {
      if (errEl) errEl.classList.remove('fp-question-error-visible');
      return;
    }
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

  fpApplyPercentClass(document.getElementById('fp-player-progress'), 100);

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
  if (btn) btn.classList.toggle('ui-hidden', !journeys.length);

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
    fpApplyPercentClass(bar, bar.dataset.progress || 0);
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

document.addEventListener('DOMContentLoaded', function () {
  const modal = document.getElementById('fp-player-modal');
  if (!modal) return;
  modal.addEventListener('click', fpHandleModalBackdrop);
  document.addEventListener('keydown', fpHandleModalKeydown);
});
