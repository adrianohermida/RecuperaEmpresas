'use strict';
/* builder-modals.js — Form Builder: modais transientes (lógica + atribuições) */

let _logicSourceQId = null;

const FB_TRANSIENT_MODAL_IDS = ['fb-modal-new', 'fb-logic-modal', 'fb-assign-modal', 'fb-resp-detail-modal'];
const FB_MODAL_DESKTOP_BREAKPOINT = 900;
const fbTransientModalState = {
  activeModalId: null,
  initialized: false,
  resizeHandler: null,
};

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function fbGetTransientModal(id) {
  return document.getElementById(id);
}

function fbGetVisibleTransientModals() {
  return FB_TRANSIENT_MODAL_IDS
    .map(fbGetTransientModal)
    .filter(modal => modal && !modal.classList.contains('ui-hidden'));
}

function fbSyncTransientModalState() {
  const visible = fbGetVisibleTransientModals();
  if (!visible.length) {
    fbTransientModalState.activeModalId = null;
    return;
  }

  const activeModal = visible[visible.length - 1];
  fbTransientModalState.activeModalId = activeModal.id;
}

function fbEnforceSingleVisibleModal() {
  const visible = fbGetVisibleTransientModals();
  if (visible.length <= 1) {
    fbSyncTransientModalState();
    return;
  }

  const activeId = fbTransientModalState.activeModalId;
  const keep = visible.find(modal => modal.id === activeId) || visible[visible.length - 1];
  visible.forEach(modal => {
    if (modal.id !== keep.id) modal.classList.add('ui-hidden');
  });
  fbTransientModalState.activeModalId = keep.id;
}

function fbCloseAllTransientModals(exceptId) {
  FB_TRANSIENT_MODAL_IDS.forEach(id => {
    if (id === exceptId) return;
    fbGetTransientModal(id)?.classList.add('ui-hidden');
  });
  fbTransientModalState.activeModalId = exceptId || null;
}

function fbCloseTransientModals(exceptId) {
  fbCloseAllTransientModals(exceptId);
}

function fbOpenTransientModal(id) {
  if (!FB_TRANSIENT_MODAL_IDS.includes(id)) return;
  fbCloseAllTransientModals(id);
  fbGetTransientModal(id)?.classList.remove('ui-hidden');
  fbTransientModalState.activeModalId = id;
}

function fbCloseTransientModal(id) {
  if (!FB_TRANSIENT_MODAL_IDS.includes(id)) return;
  fbGetTransientModal(id)?.classList.add('ui-hidden');
  if (fbTransientModalState.activeModalId === id) {
    fbTransientModalState.activeModalId = null;
  }
}

function fbEnsureTransientModalController() {
  if (fbTransientModalState.initialized) return;
  fbTransientModalState.initialized = true;

  let lastWidth = window.innerWidth;
  fbTransientModalState.resizeHandler = debounce(() => {
    if (window.innerWidth === lastWidth) return;
    const previousWidth = lastWidth;
    lastWidth = window.innerWidth;

    if (window.innerWidth > FB_MODAL_DESKTOP_BREAKPOINT || previousWidth > FB_MODAL_DESKTOP_BREAKPOINT) {
      fbEnforceSingleVisibleModal();
    }
  }, 150);

  window.addEventListener('resize', fbTransientModalState.resizeHandler);
}

function fbBindTransientModalBehavior() {
  fbEnsureTransientModalController();

  FB_TRANSIENT_MODAL_IDS.forEach(id => {
    const modal = fbGetTransientModal(id);
    if (!modal || modal.dataset.boundBackdrop === '1') return;
    modal.dataset.boundBackdrop = '1';
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      fbCloseTransientModal(id);
    });
  });

  if (document.body.dataset.fbEscBound === '1') return;
  document.body.dataset.fbEscBound = '1';

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (fbTransientModalState.activeModalId) {
      fbCloseTransientModal(fbTransientModalState.activeModalId);
      return;
    }
    const activeModal = [...fbGetVisibleTransientModals()].pop();
    if (activeModal) fbCloseTransientModal(activeModal.id);
  });
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic editor modal
──────────────────────────────────────────────────────────────────────────────*/
async function fbOpenLogicEditor(qId) {
  _logicSourceQId = qId;
  const modal = fbGetTransientModal('fb-logic-modal');
  if (!modal) return;
  fbOpenTransientModal('fb-logic-modal');
  await fbLoadLogicRules(qId);
}

function fbCloseLogicModal() {
  fbCloseTransientModal('fb-logic-modal');
}

async function fbLoadLogicRules(qId) {
  const container = document.getElementById('fb-logic-rules');
  if (!container) return;
  container.innerHTML = '<div class="form-builder-logic-loading">Carregando regras...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic?question_id=${qId}`, { headers: fbAuthH() });
  const jl = res.ok ? await res.json() : {};
  const rules = jl.rules || jl || [];

  const pages = FB.currentForm.pages || [];

  if (!rules.length) {
    container.innerHTML = '<div class="form-builder-logic-empty">Nenhuma regra de lógica. Clique em "Adicionar regra".</div>';
    return;
  }

  container.innerHTML = rules.map(r => `
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
  const modal = fbGetTransientModal('fb-assign-modal');
  if (!modal) return;
  fbOpenTransientModal('fb-assign-modal');
  await fbLoadAssignments();
}

function fbCloseAssignModal() {
  fbCloseTransientModal('fb-assign-modal');
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
        const uname  = u.name  || a.user_name  || '—';
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

window.fbOpenTransientModal = fbOpenTransientModal;
window.fbCloseTransientModal = fbCloseTransientModal;
window.fbCloseTransientModals = fbCloseTransientModals;
window.fbEnsureTransientModalController = fbEnsureTransientModalController;
