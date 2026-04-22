'use strict';
/* builder-modals.js — Form Builder: modais transientes (lógica + atribuições) */

let _logicSourceQId = null;
let _logicEditorState = null;

const FB_TRANSIENT_MODAL_IDS = ['fb-modal-new', 'fb-logic-modal', 'fb-assign-modal', 'fb-resp-detail-modal'];

function fbGetTransientModal(id) {
  return document.getElementById(id);
}

function fbCloseAllTransientModals(exceptId) {
  if (window.REAdminModal?.closeAll) {
    window.REAdminModal.closeAll({ keepId: exceptId || null, reason: 'fb-close-all' });
  } else {
    FB_TRANSIENT_MODAL_IDS.forEach(id => {
      if (id === exceptId) return;
      fbGetTransientModal(id)?.classList.add('ui-hidden');
    });
  }
}

function fbCloseTransientModals(exceptId) {
  fbCloseAllTransientModals(exceptId);
}

function fbOpenTransientModal(id) {
  if (!FB_TRANSIENT_MODAL_IDS.includes(id)) return;
  if (window.REAdminModal?.openStatic) {
    window.REAdminModal.openStatic(id, 'form-builder:' + id);
  } else {
    fbCloseAllTransientModals(id);
    fbGetTransientModal(id)?.classList.remove('ui-hidden');
  }
}

function fbCloseTransientModal(id) {
  if (!FB_TRANSIENT_MODAL_IDS.includes(id)) return;
  if (window.REAdminModal?.closeById) {
    window.REAdminModal.closeById(id, 'form-builder:' + id + ':close');
  } else {
    fbGetTransientModal(id)?.classList.add('ui-hidden');
  }
}

function fbEnsureTransientModalController() {
  if (window.__fbTransientModalControllerReady) return;
  window.__fbTransientModalControllerReady = true;
  window.REAdminModal?.registerStatic?.(FB_TRANSIENT_MODAL_IDS, 'form-builder');
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
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic editor modal
──────────────────────────────────────────────────────────────────────────────*/
async function fbOpenLogicEditor(qId) {
  _logicSourceQId = qId;
  _logicEditorState = null;
  const modal = fbGetTransientModal('fb-logic-modal');
  if (!modal) return;
  fbOpenTransientModal('fb-logic-modal');
  await fbLoadLogicRules(qId);
}

function fbCloseLogicModal() {
  fbCloseTransientModal('fb-logic-modal');
}

function fbNormalizeLogicOperator(operator) {
  const normalized = String(operator || 'equals').trim().toLowerCase();
  if (normalized === 'is_answered') return 'not_empty';
  if (normalized === 'is_empty') return 'empty';
  return normalized;
}

function fbGetLogicSourceQuestion() {
  const pages = FB.currentForm?.pages || [];
  for (const page of pages) {
    const found = (page.questions || []).find((question) => Number(question.id) === Number(_logicSourceQId));
    if (found) return found;
  }
  return null;
}

function fbGetLogicPageOptions() {
  return (FB.currentForm?.pages || []).map((page, index) => ({
    id: page.id,
    label: `Página ${index + 1}${page.title ? ` · ${page.title}` : ''}`,
  }));
}

function fbGetLogicQuestionOptions() {
  const options = [];
  (FB.currentForm?.pages || []).forEach((page, pageIndex) => {
    (page.questions || []).forEach((question, questionIndex) => {
      if (Number(question.id) === Number(_logicSourceQId)) return;
      options.push({
        id: question.id,
        label: `P${pageIndex + 1}.${questionIndex + 1} · ${question.label || 'Sem título'}`,
      });
    });
  });
  return options;
}

function fbCreateLogicAction(branch, rule) {
  const action = String(rule?.action || 'go_to_page').toLowerCase();
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    branch,
    action,
    target_page_id: rule?.target_page_id ? Number(rule.target_page_id) : null,
    target_question_id: rule?.target_question_id ? Number(rule.target_question_id) : null,
  };
}

function fbEnsureLogicState() {
  if (_logicEditorState) return _logicEditorState;
  _logicEditorState = {
    condition: { operator: 'equals', value: '' },
    ifActions: [],
    elseActions: [],
    rules: [],
  };
  return _logicEditorState;
}

function fbBuildLogicStateFromRules(rules) {
  const state = fbEnsureLogicState();
  const normalized = Array.isArray(rules) ? rules : [];
  const primaryRules = normalized.filter((rule) => fbNormalizeLogicOperator(rule.operator) !== 'else');
  const elseRules = normalized.filter((rule) => fbNormalizeLogicOperator(rule.operator) === 'else');
  const firstPrimary = primaryRules[0] || null;
  state.condition = {
    operator: fbNormalizeLogicOperator(firstPrimary?.operator || 'equals'),
    value: firstPrimary?.condition_value == null ? '' : String(firstPrimary.condition_value),
  };
  state.ifActions = primaryRules.map((rule) => fbCreateLogicAction('if', rule));
  state.elseActions = elseRules.map((rule) => fbCreateLogicAction('else', rule));
  state.rules = normalized;
  if (!state.ifActions.length) state.ifActions = [fbCreateLogicAction('if')];
  return state;
}

function fbRequiresLogicValue(operator) {
  return !['empty', 'not_empty'].includes(fbNormalizeLogicOperator(operator));
}

function fbActionUsesPageTarget(action) {
  return ['skip_to_page', 'go_to_page', 'show_page', 'hide_page'].includes(String(action || '').toLowerCase());
}

function fbActionUsesQuestionTarget(action) {
  return ['show_question', 'hide_question'].includes(String(action || '').toLowerCase());
}

function fbDescribeLogicAction(action) {
  const value = String(action || '').toLowerCase();
  const map = {
    go_to_page: 'Ir para página',
    skip_to_page: 'Pular para página',
    show_page: 'Mostrar página',
    hide_page: 'Ocultar página',
    show_question: 'Mostrar questão',
    hide_question: 'Ocultar questão',
  };
  return map[value] || value;
}

function fbDescribeLogicRule(rule) {
  const sourceQuestion = fbGetLogicSourceQuestion();
  const pageOptions = fbGetLogicPageOptions();
  const questionOptions = fbGetLogicQuestionOptions();
  const operator = fbNormalizeLogicOperator(rule.operator);
  const pageLabel = pageOptions.find((item) => Number(item.id) === Number(rule.target_page_id))?.label || '';
  const questionLabel = questionOptions.find((item) => Number(item.id) === Number(rule.target_question_id))?.label || '';
  const branch = operator === 'else'
    ? 'SENÃO'
    : `SE ${sourceQuestion?.label || 'resposta'} ${operator}${fbRequiresLogicValue(operator) ? ` "${fbEsc(rule.condition_value || '')}"` : ''}`;
  const target = pageLabel || questionLabel || 'sem alvo';
  return `${branch} → ${fbDescribeLogicAction(rule.action)} · ${target}`;
}

function fbRenderLogicSummary() {
  const container = document.getElementById('fb-logic-rules');
  if (!container) return;
  const state = fbEnsureLogicState();
  if (!state.rules.length) {
    container.innerHTML = '<div class="form-builder-logic-empty">Nenhuma lógica salva ainda. Monte os ramos IF e ELSE abaixo e salve.</div>';
    return;
  }
  container.innerHTML = state.rules.map((rule) => `<div class="form-builder-logic-rule"><span class="form-builder-logic-rule-strong">${fbEsc(fbDescribeLogicRule(rule))}</span></div>`).join('');
}

function fbRenderLogicActionRows(branch) {
  const container = document.getElementById(branch === 'else' ? 'fb-logic-else-actions' : 'fb-logic-if-actions');
  if (!container) return;
  const state = fbEnsureLogicState();
  const list = branch === 'else' ? state.elseActions : state.ifActions;
  const pageOptions = fbGetLogicPageOptions();
  const questionOptions = fbGetLogicQuestionOptions();

  if (!list.length) {
    container.innerHTML = '<div class="form-builder-logic-empty-row">Nenhuma ação neste ramo.</div>';
    return;
  }

  container.innerHTML = list.map((item) => {
    const targetOptions = fbActionUsesPageTarget(item.action) ? pageOptions : questionOptions;
    const targetValue = fbActionUsesPageTarget(item.action) ? String(item.target_page_id || '') : String(item.target_question_id || '');
    const placeholder = fbActionUsesPageTarget(item.action) ? 'Selecione a página' : 'Selecione a questão';
    return `
      <div class="form-builder-logic-action-row">
        <select class="portal-input form-builder-logic-control" data-logic-branch="${branch}" data-logic-id="${item.id}" data-logic-field="action">
          <option value="go_to_page" ${item.action === 'go_to_page' || item.action === 'skip_to_page' ? 'selected' : ''}>Ir para página</option>
          <option value="show_page" ${item.action === 'show_page' ? 'selected' : ''}>Mostrar página</option>
          <option value="hide_page" ${item.action === 'hide_page' ? 'selected' : ''}>Ocultar página</option>
          <option value="show_question" ${item.action === 'show_question' ? 'selected' : ''}>Mostrar questão</option>
          <option value="hide_question" ${item.action === 'hide_question' ? 'selected' : ''}>Ocultar questão</option>
        </select>
        <select class="portal-input form-builder-logic-control" data-logic-branch="${branch}" data-logic-id="${item.id}" data-logic-field="target">
          <option value="">${placeholder}</option>
          ${targetOptions.map((option) => `<option value="${option.id}" ${String(option.id) === targetValue ? 'selected' : ''}>${fbEsc(option.label)}</option>`).join('')}
        </select>
        <button class="form-builder-logic-rule-delete" type="button" onclick="fbRemoveLogicActionRow('${branch}','${item.id}')">Remover</button>
      </div>`;
  }).join('');
}

function fbRenderLogicEditor() {
  const sourceHint = document.getElementById('fb-logic-source-hint');
  const operatorEl = document.getElementById('fb-logic-op');
  const valueEl = document.getElementById('fb-logic-val');
  const state = fbEnsureLogicState();
  const sourceQuestion = fbGetLogicSourceQuestion();
  if (sourceHint) {
    sourceHint.textContent = sourceQuestion?.label
      ? `Pergunta de origem: ${sourceQuestion.label}`
      : 'Pergunta de origem selecionada.';
  }
  if (operatorEl) operatorEl.value = fbNormalizeLogicOperator(state.condition.operator);
  if (valueEl) {
    valueEl.value = state.condition.value || '';
    valueEl.disabled = !fbRequiresLogicValue(state.condition.operator);
    valueEl.placeholder = valueEl.disabled ? 'Sem valor para este operador' : 'Ex: Sim';
  }
  fbRenderLogicSummary();
  fbRenderLogicActionRows('if');
  fbRenderLogicActionRows('else');
}

async function fbLoadLogicRules(qId) {
  const container = document.getElementById('fb-logic-rules');
  if (!container) return;
  container.innerHTML = '<div class="form-builder-logic-loading">Carregando regras...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic?question_id=${qId}`, { headers: fbAuthH() });
  const jl = res.ok ? await res.json() : {};
  const rules = jl.rules || jl || [];
  _logicEditorState = {
    condition: { operator: 'equals', value: '' },
    ifActions: [],
    elseActions: [],
    rules: [],
  };
  fbBuildLogicStateFromRules(rules);
  fbRenderLogicEditor();
}

function fbHandleLogicConditionChange() {
  const state = fbEnsureLogicState();
  state.condition.operator = fbNormalizeLogicOperator(document.getElementById('fb-logic-op')?.value || 'equals');
  state.condition.value = document.getElementById('fb-logic-val')?.value || '';
  fbRenderLogicEditor();
}

function fbAddLogicActionRow(branch) {
  const state = fbEnsureLogicState();
  const targetList = branch === 'else' ? state.elseActions : state.ifActions;
  targetList.push(fbCreateLogicAction(branch));
  fbRenderLogicActionRows(branch);
}

function fbRemoveLogicActionRow(branch, actionId) {
  const state = fbEnsureLogicState();
  if (branch === 'else') {
    state.elseActions = state.elseActions.filter((item) => item.id !== actionId);
  } else {
    state.ifActions = state.ifActions.filter((item) => item.id !== actionId);
  }
  fbRenderLogicActionRows(branch);
}

function fbUpdateLogicActionField(branch, actionId, field, value) {
  const state = fbEnsureLogicState();
  const list = branch === 'else' ? state.elseActions : state.ifActions;
  const action = list.find((item) => item.id === actionId);
  if (!action) return;
  if (field === 'action') {
    action.action = String(value || 'go_to_page').toLowerCase();
    if (fbActionUsesPageTarget(action.action)) {
      action.target_question_id = null;
    } else {
      action.target_page_id = null;
    }
    fbRenderLogicActionRows(branch);
    return;
  }
  if (field === 'target') {
    if (fbActionUsesPageTarget(action.action)) {
      action.target_page_id = value ? Number(value) : null;
      action.target_question_id = null;
    } else {
      action.target_question_id = value ? Number(value) : null;
      action.target_page_id = null;
    }
  }
}

function fbCollectLogicRulesForSave() {
  const state = fbEnsureLogicState();
  const operator = fbNormalizeLogicOperator(state.condition.operator);
  const conditionValue = fbRequiresLogicValue(operator) ? String(state.condition.value || '').trim() : null;
  if (fbRequiresLogicValue(operator) && !conditionValue) {
    throw new Error('Informe o valor da condição IF.');
  }

  const serialize = (item, branch) => {
    if (!item.action) throw new Error('Selecione uma ação para cada linha da lógica.');
    if (fbActionUsesPageTarget(item.action) && !item.target_page_id) {
      throw new Error('Selecione a página alvo para a ação escolhida.');
    }
    if (fbActionUsesQuestionTarget(item.action) && !item.target_question_id) {
      throw new Error('Selecione a questão alvo para a ação escolhida.');
    }
    return {
      source_question_id: Number(_logicSourceQId),
      operator: branch === 'else' ? 'else' : operator,
      condition_value: branch === 'else' ? null : conditionValue,
      action: item.action === 'go_to_page' ? 'skip_to_page' : item.action,
      target_page_id: fbActionUsesPageTarget(item.action) ? Number(item.target_page_id) : null,
      target_question_id: fbActionUsesQuestionTarget(item.action) ? Number(item.target_question_id) : null,
    };
  };

  return [
    ...state.ifActions.map((item) => serialize(item, 'if')),
    ...state.elseActions.map((item) => serialize(item, 'else')),
  ];
}

async function fbSaveLogicRules() {
  try {
    const rules = fbCollectLogicRulesForSave();
    const res = await fetch(`/api/admin/forms/${FB.currentFormId}/logic`, {
      method: 'PUT',
      headers: fbAuthH(),
      body: JSON.stringify({
        source_question_id: Number(_logicSourceQId),
        rules,
      }),
    });
    const payload = await fbRead(res);
    if (!res.ok) {
      fbToast(payload.error || 'Erro ao salvar lógica.','error');
      return;
    }
    fbToast('Lógica salva!','success');
    await fbLoadLogicRules(_logicSourceQId);
  } catch (error) {
    fbToast(error?.message || 'Erro ao salvar lógica.','error');
  }
}

document.addEventListener('change', (event) => {
  const branch = event.target?.dataset?.logicBranch;
  const actionId = event.target?.dataset?.logicId;
  const field = event.target?.dataset?.logicField;
  if (branch && actionId && field) {
    fbUpdateLogicActionField(branch, actionId, field, event.target.value);
    return;
  }
  if (event.target?.id === 'fb-logic-op') {
    fbHandleLogicConditionChange();
  }
});

document.addEventListener('input', (event) => {
  if (event.target?.id === 'fb-logic-val') {
    fbHandleLogicConditionChange();
  }
});

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
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/assignments/${userId}`, {
    method:'DELETE', headers: fbAuthH()
  });
  if (res.ok) { fbToast('Removido.','success'); fbLoadAssignments(); }
  else fbToast('Erro.','error');
}

window.fbOpenTransientModal = fbOpenTransientModal;
window.fbCloseTransientModal = fbCloseTransientModal;
window.fbCloseTransientModals = fbCloseTransientModals;
window.fbEnsureTransientModalController = fbEnsureTransientModalController;
window.fbAddLogicActionRow = fbAddLogicActionRow;
window.fbRemoveLogicActionRow = fbRemoveLogicActionRow;
window.fbSaveLogicRules = fbSaveLogicRules;
