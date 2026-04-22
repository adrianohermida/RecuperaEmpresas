'use strict';

/* ═══════════════════════════════════════════════════════════════
   Recupera Empresas — Onboarding App v2
   Auth + 14 etapas + per-step email + Freshdesk
═══════════════════════════════════════════════════════════════ */

const LS_KEY      = 'recupera_onboarding_v2';
let   TOTAL_STEPS = 14;

// Active step IDs — may be a subset of 1-14 if admin disabled some steps
let ACTIVE_STEP_IDS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14];

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getToken()   { return window.REShared.getStoredToken(); }
function getUser()    { return window.REShared.getStoredUser(); }
function authHeaders(extra = {}) {
  return window.REShared.buildAuthHeaders({ extra });
}

async function logout() {
  await window.REShared.logoutSession({ keys: ['re_token', 're_user', LS_KEY] });
  window.REShared.redirectToRoute('login');
}

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  step: 1,
  data: {
    lgpd:        { concordo: false },
    empresa:     {},
    socios:      [{}],
    numSocios:   1,
    operacional: {},
    funcionarios:{},
    ativos:      {},
    financeiro:  {},
    dividas:     [{}],
    crise:       {},
    diagnostico: {},
    mercado:     {},
    expectativas:{},
    documentos:  {},
    responsavel: {},
    confirmacao: { declaro: false }
  },
  files: {}   // { fieldName: FileList }
};

// ─── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1,  title: 'Consentimento LGPD',       icon: '🔒' },
  { id: 2,  title: 'Dados da Empresa',          icon: '🏢' },
  { id: 3,  title: 'Sócios',                   icon: '👥' },
  { id: 4,  title: 'Estrutura Operacional',     icon: '⚙️'  },
  { id: 5,  title: 'Quadro de Funcionários',    icon: '👷' },
  { id: 6,  title: 'Ativos',                   icon: '🏭' },
  { id: 7,  title: 'Dados Financeiros',         icon: '💰' },
  { id: 8,  title: 'Dívidas e Credores',        icon: '📋' },
  { id: 9,  title: 'Histórico da Crise',        icon: '📉' },
  { id: 10, title: 'Diagnóstico Estratégico',   icon: '🧠' },
  { id: 11, title: 'Mercado e Operação',        icon: '📊' },
  { id: 12, title: 'Expectativas e Estratégia', icon: '🎯' },
  { id: 13, title: 'Documentos',               icon: '📁' },
  { id: 14, title: 'Confirmação e Envio',       icon: '✅' }
];

// ─── Masks ────────────────────────────────────────────────────────────────────
function maskCNPJ(v) {
  v = v.replace(/\D/g,'').slice(0,14);
  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5')
         .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/,'$1.$2.$3/$4')
         .replace(/^(\d{2})(\d{3})(\d{3})$/,'$1.$2.$3')
         .replace(/^(\d{2})(\d{3})$/,'$1.$2')
         .replace(/^(\d{2})$/,'$1');
}
function maskCPF(v) {
  v = v.replace(/\D/g,'').slice(0,11);
  return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4')
         .replace(/^(\d{3})(\d{3})(\d{3})$/,'$1.$2.$3')
         .replace(/^(\d{3})(\d{3})$/,'$1.$2')
         .replace(/^(\d{3})$/,'$1');
}
function maskPhone(v) {
  v = v.replace(/\D/g,'').slice(0,11);
  if (v.length === 11) return v.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');
  if (v.length >= 10)  return v.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');
  return v;
}
function maskCEP(v) {
  v = v.replace(/\D/g,'').slice(0,8);
  return v.replace(/^(\d{5})(\d{3})$/,'$1-$2');
}
function maskCurrency(v) {
  let n = v.replace(/\D/g,'');
  if (!n) return '';
  n = (parseInt(n,10)/100).toFixed(2);
  return 'R$ ' + n.replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
}
function parseCurrency(v) {
  return v.replace(/[^\d,]/g,'').replace(',','.');
}

function applyMask(el) {
  const type = el.dataset.mask;
  const raw = el.value;
  if (type === 'cnpj')     el.value = maskCNPJ(raw);
  else if (type === 'cpf') el.value = maskCPF(raw);
  else if (type === 'phone') el.value = maskPhone(raw);
  else if (type === 'cep')   el.value = maskCEP(raw);
  else if (type === 'currency') el.value = maskCurrency(raw);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function el(id)    { return document.getElementById(id); }
function qs(sel)   { return document.querySelector(sel); }
function qsa(sel)  { return document.querySelectorAll(sel); }

function showToast(msg, type = '', duration = 3000) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, duration);
}

// ─── Progress ─────────────────────────────────────────────────────────────────
function updateProgress(step) {
  // Position within active steps (1-based)
  const pos = ACTIVE_STEP_IDS.indexOf(step) + 1 || 1;
  const pct = Math.round(((pos - 1) / TOTAL_STEPS) * 100);
  el('progressLabel').textContent = `Etapa ${pos} de ${TOTAL_STEPS}`;
  el('progressPct').textContent   = `${pct}% concluído`;
  window.REShared.applyPercentClass(el('progressFill'), pct);

  // dots — only show active steps
  const dots = el('stepsDots');
  dots.innerHTML = '';
  ACTIVE_STEP_IDS.forEach(id => {
    const s = STEPS[id - 1];
    const d = document.createElement('div');
    d.className = 'step-dot' + (id < step ? ' done' : id === step ? ' active' : '');
    d.title = s?.title || `Etapa ${id}`;
    dots.appendChild(d);
  });
}

// ─── Nav buttons state ────────────────────────────────────────────────────────
function updateNavButtons(step) {
  const back = el('btnBack');
  const next = el('btnNext');
  const isFirst = ACTIVE_STEP_IDS.indexOf(step) === 0;
  const isLast  = ACTIVE_STEP_IDS.indexOf(step) === ACTIVE_STEP_IDS.length - 1;
  back.classList.toggle('ui-visibility-hidden', isFirst);
  if (isLast) {
    next.classList.add('ui-hidden');
  } else {
    next.classList.remove('ui-hidden');
    next.innerHTML = 'Próximo <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
  }
}

// ─── Render dispatcher ───────────────────────────────────────────────────────
function renderStep(step) {
  const main = el('mainContent');
  main.innerHTML = '';

  const renderers = [
    null,
    renderStep1,  renderStep2,  renderStep3,  renderStep4,
    renderStep5,  renderStep6,  renderStep7,  renderStep8,
    renderStep9,  renderStep10, renderStep11, renderStep12,
    renderStep13, renderStep14
  ];

  if (renderers[step]) renderers[step](main);
  updateProgress(step);
  updateNavButtons(step);
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Attach mask listeners
  qsa('[data-mask]').forEach(inp => {
    inp.addEventListener('input', () => applyMask(inp));
  });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function card(content) {
  return `<div class="card">${content}</div>`;
}
function stepHeader(step, desc = '') {
  const s   = STEPS[step - 1];
  const pos = ACTIVE_STEP_IDS.indexOf(step) + 1 || step;
  // Config description overrides built-in desc
  const cfgStep    = window._formCfg?.steps?.find(x => x.id === step);
  const configDesc = cfgStep?.description || '';
  const finalDesc  = configDesc || desc;
  return `<div class="step-header">
    <div class="step-chip">Etapa ${pos} de ${TOTAL_STEPS}</div>
    <h1 class="step-title">${s.icon} ${s.title}</h1>
    ${finalDesc ? `<p class="step-desc">${finalDesc}</p>` : ''}
  </div>`;
}
function field(id, label, input, required = true, hint = '') {
  const req = required ? '<span class="req">*</span>' : '<span class="opt">(opcional)</span>';
  return `<div class="field" id="wrap_${id}">
    <label for="${id}">${label}${req}</label>
    ${input}
    ${hint ? `<span class="field-hint app-field-hint">${hint}</span>` : ''}
    <span class="field-error" id="err_${id}"></span>
  </div>`;
}
function textInput(id, placeholder = '', mask = '', extra = '') {
  return `<input type="text" id="${id}" name="${id}" placeholder="${placeholder}"
    ${mask ? `data-mask="${mask}"` : ''} ${extra} />`;
}
function emailInput(id, placeholder = '') {
  return `<input type="email" id="${id}" name="${id}" placeholder="${placeholder}" />`;
}
function telInput(id) {
  return `<input type="tel" id="${id}" name="${id}" placeholder="(00) 00000-0000" data-mask="phone" />`;
}
function selectInput(id, options, placeholder = 'Selecione...') {
  const opts = options.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  return `<select id="${id}" name="${id}"><option value="">${placeholder}</option>${opts}</select>`;
}
function radioGroup(name, options, valueKey, onChange = '') {
  return `<div class="radio-group" id="rg_${name}">
    ${options.map(([v,l]) => `
      <label class="radio-option${state.data[valueKey]?.[name] === v ? ' selected' : ''}"
             onclick="if(event.target.tagName==='INPUT')return; setRadio('${name}','${v}','${valueKey}',this.closest('.radio-group'))${onChange ? ';'+onChange : ''}">
        <input type="radio" name="${name}" value="${v}" ${state.data[valueKey]?.[name] === v ? 'checked' : ''}/>
        <span class="indicator"></span>${l}
      </label>`).join('')}
  </div>`;
}
function checkGroup(name, options, valueKey) {
  const cur = state.data[valueKey]?.[name] || [];
  return `<div class="check-group" id="cg_${name}">
    ${options.map(([v,l]) => `
      <label class="check-option${cur.includes(v) ? ' selected' : ''}"
             onclick="if(event.target.tagName==='INPUT')return; toggleCheck('${name}','${v}','${valueKey}',this)">
        <input type="checkbox" name="${name}" value="${v}" ${cur.includes(v) ? 'checked' : ''}/>
        <span class="indicator"></span>${l}
      </label>`).join('')}
  </div>`;
}

function setRadio(name, value, dataKey, group) {
  if (!state.data[dataKey]) state.data[dataKey] = {};
  state.data[dataKey][name] = value;
  group.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
  // find the option with matching value and mark it selected
  group.querySelectorAll('.radio-option').forEach(opt => {
    if (opt.querySelector('input')?.value === value) opt.classList.add('selected');
  });
  saveToLS();
}

function toggleCheck(name, value, dataKey, el) {
  if (!state.data[dataKey]) state.data[dataKey] = {};
  if (!state.data[dataKey][name]) state.data[dataKey][name] = [];
  const arr = state.data[dataKey][name];
  const idx = arr.indexOf(value);
  if (idx === -1) { arr.push(value); el.classList.add('selected'); }
  else            { arr.splice(idx,1); el.classList.remove('selected'); }
  saveToLS();
}

// ── renderStep1-14 estão em onboarding-steps.js ──────────────────────────────
// ── collectStepData, fillFields, collectFields em onboarding-collect.js ──────
// ── validateStep, showError, clearErrors em onboarding-validate.js ───────────

// ─── Navigation ───────────────────────────────────────────────────────────────
const app = {
  async nextStep() {
    collectStepData(state.step);
    if (!validateStep(state.step)) return;

    const idx = ACTIVE_STEP_IDS.indexOf(state.step);
    if (idx !== -1 && idx < ACTIVE_STEP_IDS.length - 1) {
      const nextStepId = ACTIVE_STEP_IDS[idx + 1];
      await notifyStepComplete(state.step, nextStepId);
      state.step = nextStepId;
      renderStep(state.step);
      saveToLS();
      await saveProgressRemote({ step: state.step, status: 'em_andamento', data: state.data }, { silent: true });
    }
  },
  async prevStep() {
    collectStepData(state.step);
    const idx = ACTIVE_STEP_IDS.indexOf(state.step);
    if (idx > 0) {
      state.step = ACTIVE_STEP_IDS[idx - 1];
      renderStep(state.step);
      saveToLS();
      await saveProgressRemote({ step: state.step, status: 'em_andamento', data: state.data }, { silent: true });
    }
  },
  async saveProgress() {
    collectStepData(state.step);
    saveToLS();
    const ok = await saveProgressRemote({
      step: state.step,
      status: state.step > 1 ? 'em_andamento' : 'nao_iniciado',
      data: state.data
    }, { silent: true });
    if (!ok) {
      showToast('Salvamos neste navegador. A sincronização online vai tentar novamente.', 'warning', 5000);
      return;
    }
    showToast('Progresso salvo! Você pode fechar e continuar depois.', 'success', 4000);
  }
};

// ─── Per-step API notification ────────────────────────────────────────────────
async function saveProgressRemote(payload, options = {}) {
  try {
    const response = await fetch('/api/progress', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.warn('Progress sync failed:', response.status);
      return false;
    }
    const json = await response.json();
    if (json?.progress?.step) state.step = json.progress.step;
    if (json?.progress?.data) Object.assign(state.data, json.progress.data);
    return true;
  } catch (e) {
    if (!options.silent) console.warn('Progress sync failed:', e.message);
    return false;
  }
}

async function notifyStepComplete(stepNum, nextStep) {
  try {
    await fetch('/api/step-complete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ stepNum, nextStep, allData: state.data })
    });
  } catch (e) { console.warn('Step notify failed:', e.message); }
}

// ─── Local Storage ────────────────────────────────────────────────────────────
function saveToLS() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ step: state.step, data: state.data }));
  } catch(e) { /* storage full */ }
}

function loadFromLS() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (parsed.data) {
      Object.assign(state.data, parsed.data);
      state.step = parsed.step || 1;
      return state.step > 1;
    }
  } catch(e) { localStorage.removeItem(LS_KEY); }
  return false;
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitForm() {
  collectStepData(14);
  if (!validateStep(14)) return;

  const btn = el('btnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Enviando...';

  const formData = new FormData();
  formData.append('formData', JSON.stringify(state.data));
  Object.entries({ balanco: 'balanco', dre: 'dre', extratos: 'extratos', contratos: 'contratos' })
    .forEach(([key, field]) => (state.files[key] || []).forEach(f => formData.append(field, f)));

  try {
    const res  = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData
    });
    const json = await res.json();
    if (json.success) {
      showSuccessScreen();
      localStorage.removeItem(LS_KEY);
    } else {
      throw new Error(json.message || 'Erro desconhecido');
    }
  } catch(err) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar informações';
    showToast('Erro ao enviar. Tente novamente.', 'error', 5000);
  }
}

function showSuccessScreen() {
  el('progressWrapper').classList.add('ui-hidden');
  el('navBar').classList.add('ui-hidden');
  el('mainContent').innerHTML = card(`
    <div class="success-screen">
      <div class="success-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h1 class="success-title">Informações enviadas com sucesso!</h1>
      <p class="success-msg">
        Nossa equipe recebeu todos os seus dados e documentos. A análise será iniciada em breve
        e entraremos em contato pelo e-mail e telefone cadastrados.
      </p>
      <div class="success-note">
        <strong>Próximos passos:</strong><br/>
        Nossa equipe iniciará a análise e elaboração do Business Plan. Em até 2 dias úteis
        você receberá um contato para alinhamento das próximas etapas.
      </div>
      <p class="success-screen-link-wrap">
        <a href="/dashboard" class="success-screen-link">
          Acessar o Portal
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
      </p>
    </div>
  `);
  // Auto-redirect after 6 seconds
  setTimeout(() => { window.REShared.redirectToRoute('dashboard'); }, 6000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  const res = await fetch('/api/auth/verify', { headers: authHeaders({}) });
  if (!res.ok) { window.REShared.redirectToRoute('login'); return; }

  const { user } = await res.json();
  if (window.REShared?.storeAuthUser) window.REShared.storeAuthUser(user);

  // Show user info in header
  const userEl   = el('userName');
  const avatarEl = el('userAvatar');
  if (userEl)   userEl.textContent   = user.name || user.email;
  if (avatarEl) avatarEl.textContent = (user.name || user.email || '?')[0].toUpperCase();

  // Remove auth guard overlay
  const guard = el('authGuard');
  if (guard) guard.remove();

  // Redirect admin to admin panel
  if (user.isAdmin) { window.REShared.redirectToRoute('admin'); return; }

  // ── Load form configuration ───────────────────────────────────────────────
  try {
    const cfgRes = await fetch('/api/form-config', { headers: authHeaders() });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      window._formCfg = cfg;
      // Build active step IDs (always includes 1 and 14)
      const activeIds = (cfg.steps || []).map(s => s.id).filter(id => id >= 1 && id <= 14);
      if (activeIds.length >= 2) {
        ACTIVE_STEP_IDS = activeIds;
        TOTAL_STEPS     = ACTIVE_STEP_IDS.length;
      }
      // Patch STEPS titles from config
      (cfg.steps || []).forEach(cs => {
        const s = STEPS.find(x => x.id === cs.id);
        if (s && cs.title) s.title = cs.title;
      });
      // Show welcome message if set
      if (cfg.welcomeMessage) {
        const wm = document.getElementById('welcomeMsg');
        if (wm) wm.textContent = cfg.welcomeMessage;
      }
    }
  } catch { /* fall back to 14-step defaults */ }

  // ── Load server-side progress ─────────────────────────────────────────────
  try {
    const pRes = await fetch('/api/progress', { headers: authHeaders() });
    if (pRes.ok) {
      const serverProgress = await pRes.json();
      // If already completed, go to dashboard
      if (serverProgress.completed) { window.REShared.redirectToRoute('dashboard'); return; }
      if (serverProgress.data) {
        Object.assign(state.data, serverProgress.data);
      }
      if (serverProgress.step > 1) {
        // Snap to nearest active step if saved step is now disabled
        const savedStep = serverProgress.step;
        state.step = ACTIVE_STEP_IDS.includes(savedStep)
          ? savedStep
          : ACTIVE_STEP_IDS.find(id => id >= savedStep) || ACTIVE_STEP_IDS[0];
      }
    }
  } catch { /* fall back to local */ }

  // Also try localStorage as fallback
  if (state.step <= 1) loadFromLS();

  // Snap to valid active step after LS load
  if (!ACTIVE_STEP_IDS.includes(state.step)) {
    state.step = ACTIVE_STEP_IDS.find(id => id >= state.step) || ACTIVE_STEP_IDS[0];
  }

  renderStep(state.step);
  if (state.step > 1) showToast(`Bem-vindo de volta, ${user.name?.split(' ')[0] || ''}! Continuando na etapa ${state.step}.`, 'success', 4000);
  if (window.RecuperaChat) window.RecuperaChat.boot(user);
})();
