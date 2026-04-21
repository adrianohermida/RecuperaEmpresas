'use strict';

(function () {
  const JRN = { currentId: null, forms: [], clients: [] };

  function jrnAuthH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    const token = localStorage.getItem('re_token') || sessionStorage.getItem('re_token') || '';
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  async function jrnInit() {
    await Promise.all([jrnLoadList(), jrnLoadForms(), jrnLoadClients()]);
  }

  async function jrnLoadForms() {
    const response = await fetch('/api/admin/forms', { headers: jrnAuthH() });
    if (!response.ok) return;
    const payload = await response.json();
    JRN.forms = payload.forms || payload || [];
    const select = document.getElementById('jrn-step-form');
    if (select) {
      select.innerHTML = '<option value="">— Nenhum formulário —</option>' +
        JRN.forms.map(form => `<option value="${form.id}">${form.title}</option>`).join('');
    }
  }

  async function jrnLoadClients() {
    const response = await fetch('/api/admin/clients', { headers: jrnAuthH() });
    if (!response.ok) return;
    const payload = await response.json();
    JRN.clients = (payload.clients || payload.users || payload || []).filter(user => !user.is_admin);
    const select = document.getElementById('jrn-assign-user');
    if (select) {
      select.innerHTML = '<option value="">Selecione um cliente...</option>' +
        JRN.clients.map(client => `<option value="${client.id}">${client.name || client.email} (${client.email})</option>`).join('');
    }
  }

  async function jrnLoadList() {
    jrnShowView('list');
    const grid = document.getElementById('jrn-list-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="jrn-state-loading">Carregando...</div>';

    const response = await fetch('/api/admin/journeys', { headers: jrnAuthH() });
    if (!response.ok) {
      grid.innerHTML = '<div class="jrn-state-error">Erro ao carregar.</div>';
      return;
    }

    const journeys = await response.json();
    if (!journeys.length) {
      grid.innerHTML = `<div class="jrn-state-empty">
        <div class="jrn-state-empty-icon">🗺️</div>
        <div class="jrn-state-empty-title">Nenhuma jornada criada</div>
        <div class="jrn-state-empty-copy">Clique em "Nova Jornada" para começar.</div>
      </div>`;
      return;
    }

    const statusLabel = { draft: 'Rascunho', active: 'Ativo', archived: 'Arquivado' };

    grid.innerHTML = journeys.map(journey => `
      <div class="jrn-list-card" onclick="jrnOpenEditor('${journey.id}')">
        <div class="jrn-list-card-header">
          <div class="jrn-list-card-title">${jrnEsc(journey.name)}</div>
          <span class="jrn-status-pill ${jrnStatusClass(journey.status)}">${statusLabel[journey.status] || journey.status}</span>
        </div>
        ${journey.description ? `<div class="jrn-list-card-desc">${jrnEsc(journey.description)}</div>` : ''}
        <div class="jrn-list-card-meta">
          <span>📅 ${new Date(journey.created_at).toLocaleDateString('pt-BR')}</span>
        </div>
        <div class="jrn-list-card-actions">
          <button class="btn-primary jrn-action-btn" onclick="event.stopPropagation();jrnOpenEditor('${journey.id}')">Gerenciar</button>
          <button class="btn-ghost jrn-action-btn jrn-action-btn-danger" onclick="event.stopPropagation();jrnDelete('${jrnEscInline(journey.id)}','${jrnEscInline(journey.name)}')">Excluir</button>
        </div>
      </div>
    `).join('');
  }

  async function jrnOpenEditor(id) {
    JRN.currentId = id;
    jrnShowView('editor');

    const response = await fetch(`/api/admin/journeys/${id}`, { headers: jrnAuthH() });
    if (!response.ok) {
      alert('Erro ao carregar jornada.');
      return;
    }

    const journey = await response.json();
    document.getElementById('jrn-editor-title').textContent = journey.name;
    const statusLabel = { draft: 'Rascunho', active: 'Ativo', archived: 'Arquivado' };
    const badge = document.getElementById('jrn-editor-status-badge');
    badge.textContent = statusLabel[journey.status] || journey.status;
    badge.className = `badge ${jrnEditorStatusBadgeClass(journey.status)} journey-editor-status`;

    JRN.current = journey;
    jrnRenderSteps(journey.steps || []);
    await jrnLoadAssignments(id);
  }

  function jrnRenderSteps(steps) {
    const element = document.getElementById('jrn-steps-list');
    if (!element) return;
    if (!steps.length) {
      element.innerHTML = '<div class="journey-empty-state">Nenhuma etapa ainda.</div>';
      return;
    }

    element.innerHTML = steps.map((step, index) => `
      <div class="jrn-step-item">
        <div class="jrn-step-index">${index + 1}</div>
        <div class="jrn-step-copy">
          <div class="jrn-step-title">${jrnEsc(step.title)}</div>
          ${step.re_forms ? `<div class="jrn-step-form">📋 ${jrnEsc(step.re_forms.title)}</div>` : ''}
          ${step.is_optional ? '<div class="jrn-step-optional">Opcional</div>' : ''}
        </div>
        <div class="jrn-step-actions">
          <button class="btn-ghost jrn-mini-btn" onclick="jrnEditStep('${jrnEscInline(step.id)}','${jrnEscInline(step.title)}','${jrnEscInline(step.description || '')}','${jrnEscInline(step.form_id || '')}',${step.is_optional})">✏️</button>
          <button class="btn-ghost jrn-mini-btn jrn-mini-btn-danger" onclick="jrnDeleteStep('${jrnEscInline(step.id)}')">🗑️</button>
          ${index > 0 ? `<button class="btn-ghost jrn-mini-btn" onclick="jrnMoveStep('${jrnEscInline(step.id)}','up')">↑</button>` : ''}
          ${index < steps.length - 1 ? `<button class="btn-ghost jrn-mini-btn" onclick="jrnMoveStep('${jrnEscInline(step.id)}','down')">↓</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  async function jrnLoadAssignments(id) {
    const response = await fetch(`/api/admin/journeys/${id}/assignments`, { headers: jrnAuthH() });
    const element = document.getElementById('jrn-assignments-list');
    if (!element) return;
    if (!response.ok) {
      element.innerHTML = '<div class="jrn-inline-error">Erro ao carregar.</div>';
      return;
    }

    const list = await response.json();
    if (!list.length) {
      element.innerHTML = '<div class="journey-empty-state journey-empty-state-sm">Nenhum cliente atribuído.</div>';
      return;
    }

    const statusLabel = { active: 'Ativo', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado' };

    element.innerHTML = list.map(assignment => {
      const user = assignment.re_users || {};
      return `
      <div class="jrn-assignment-item">
        <div class="jrn-assignment-copy">
          <div class="jrn-assignment-name">${jrnEsc(user.name || user.email || '—')}</div>
          <div class="jrn-assignment-email">${jrnEsc(user.email || '')}</div>
        </div>
        <span class="jrn-status-pill ${jrnStatusClass(assignment.status)}">${statusLabel[assignment.status] || assignment.status}</span>
        <button class="btn-ghost jrn-mini-btn" onclick="jrnViewProgress('${jrnEscInline(id)}','${jrnEscInline(assignment.id)}','${jrnEscInline(user.name || user.email || '')}')">Ver progresso</button>
        <button class="btn-ghost jrn-mini-btn jrn-mini-btn-danger" onclick="jrnRemoveAssignment('${jrnEscInline(id)}','${jrnEscInline(assignment.id)}')">✕</button>
      </div>`;
    }).join('');
  }

  async function jrnViewProgress(journeyId, assignmentId, clientName) {
    jrnShowView('progress');
    document.getElementById('jrn-progress-title').textContent = `Progresso — ${clientName}`;
    document.getElementById('jrn-progress-back-btn').onclick = () => jrnOpenEditor(journeyId);
    const element = document.getElementById('jrn-progress-content');
    element.innerHTML = '<div class="journey-empty-state">Carregando...</div>';

    const response = await fetch(`/api/admin/journeys/${journeyId}/assignments/${assignmentId}/progress`, { headers: jrnAuthH() });
    if (!response.ok) {
      element.innerHTML = '<div class="jrn-inline-error">Erro.</div>';
      return;
    }

    const data = await response.json();
    const done = data.steps.filter(step => step.completed).length;
    const total = data.steps.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    element.innerHTML = `
      <div class="jrn-progress-summary">
        <div class="jrn-progress-summary-header">
          <div class="jrn-progress-summary-title">Progresso geral</div>
          <div class="jrn-progress-summary-value">${pct}%</div>
        </div>
        <div class="jrn-progress-track">
          <div class="jrn-progress-fill" data-progress="${pct}"></div>
        </div>
      </div>
      <div class="jrn-progress-list">
        ${data.steps.map((step, index) => `
          <div class="jrn-progress-step ${step.completed ? 'jrn-progress-step-done' : ''}">
            <div class="jrn-progress-step-index ${step.completed ? 'jrn-progress-step-index-done' : 'jrn-progress-step-index-pending'}">${step.completed ? '✓' : index + 1}</div>
            <div class="jrn-progress-step-copy">
              <div class="jrn-progress-step-title">${jrnEsc(step.title)}</div>
              ${step.completed_at ? `<div class="jrn-progress-step-meta jrn-progress-step-meta-done">Concluído em ${new Date(step.completed_at).toLocaleString('pt-BR')}</div>` : '<div class="jrn-progress-step-meta">Pendente</div>'}
            </div>
            ${!step.completed ? `<button class="btn-ghost jrn-mini-btn" onclick="jrnMarkStepDone('${jrnEscInline(journeyId)}','${jrnEscInline(assignmentId)}','${jrnEscInline(step.id)}','${jrnEscInline(clientName)}')">Marcar concluído</button>` : ''}
          </div>
        `).join('')}
      </div>`;

    element.querySelectorAll('.jrn-progress-fill').forEach(bar => {
      window.REShared.applyPercentClass(bar, bar.dataset.progress || 0);
    });
  }

  function jrnStatusClass(status) {
    if (status === 'active' || status === 'completed') return 'jrn-status-pill-green';
    if (status === 'archived' || status === 'paused') return 'jrn-status-pill-amber';
    if (status === 'cancelled') return 'jrn-status-pill-red';
    return 'jrn-status-pill-gray';
  }

  function jrnEditorStatusBadgeClass(status) {
    if (status === 'active') return 'badge-green';
    if (status === 'archived') return 'badge-amber';
    return 'badge-gray';
  }

  async function jrnMarkStepDone(journeyId, assignmentId, stepId, clientName) {
    const response = await fetch(`/api/admin/journeys/${journeyId}/assignments/${assignmentId}/complete-step`, {
      method: 'POST',
      headers: jrnAuthH(),
      body: JSON.stringify({ step_id: stepId }),
    });
    if (response.ok) jrnViewProgress(journeyId, assignmentId, clientName);
    else alert('Erro ao marcar etapa.');
  }

  function jrnShowView(view) {
    ['list', 'editor', 'progress'].forEach(currentView => {
      const element = document.getElementById(`jrn-view-${currentView}`);
      if (element) element.classList.toggle('ui-hidden', currentView !== view);
    });
  }

  function jrnEsc(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function jrnEscInline(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function jrnOpenNewModal() {
    JRN.editingId = null;
    document.getElementById('jrn-modal-title').textContent = 'Nova Jornada';
    document.getElementById('jrn-save-btn').textContent = 'Criar Jornada';
    document.getElementById('jrn-f-name').value = '';
    document.getElementById('jrn-f-desc').value = '';
    document.getElementById('jrn-f-status').value = 'draft';
    window.REAdminModal?.openStatic?.('jrn-modal-form', 'admin-journeys:new');
  }

  function jrnOpenEditModal() {
    if (!JRN.current) return;
    JRN.editingId = JRN.current.id;
    document.getElementById('jrn-modal-title').textContent = 'Editar Jornada';
    document.getElementById('jrn-save-btn').textContent = 'Salvar';
    document.getElementById('jrn-f-name').value = JRN.current.name || '';
    document.getElementById('jrn-f-desc').value = JRN.current.description || '';
    document.getElementById('jrn-f-status').value = JRN.current.status || 'draft';
    window.REAdminModal?.openStatic?.('jrn-modal-form', 'admin-journeys:edit');
  }

  function jrnCloseFormModal() {
    window.REAdminModal?.closeById?.('jrn-modal-form', 'admin-journeys:close-form');
  }

  async function jrnSaveForm() {
    const body = {
      name: document.getElementById('jrn-f-name').value.trim(),
      description: document.getElementById('jrn-f-desc').value.trim(),
      status: document.getElementById('jrn-f-status').value,
    };
    if (!body.name) {
      alert('Nome é obrigatório.');
      return;
    }

    const isEdit = !!JRN.editingId;
    const url = isEdit ? `/api/admin/journeys/${JRN.editingId}` : '/api/admin/journeys';
    const response = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: jrnAuthH(), body: JSON.stringify(body) });
    if (!response.ok) {
      alert('Erro ao salvar jornada.');
      return;
    }

    jrnCloseFormModal();
    if (isEdit) jrnOpenEditor(JRN.editingId);
    else jrnLoadList();
  }

  async function jrnDelete(id, name) {
    if (!confirm(`Excluir a jornada "${name}"? Todas as etapas e atribuições serão removidas.`)) return;
    const response = await fetch(`/api/admin/journeys/${id}`, { method: 'DELETE', headers: jrnAuthH() });
    if (response.ok) jrnLoadList();
    else alert('Erro ao excluir.');
  }

  function jrnOpenAddStepModal() {
    document.getElementById('jrn-step-modal-title').textContent = 'Adicionar Etapa';
    document.getElementById('jrn-step-editing-id').value = '';
    document.getElementById('jrn-step-title').value = '';
    document.getElementById('jrn-step-desc').value = '';
    document.getElementById('jrn-step-form').value = '';
    document.getElementById('jrn-step-optional').checked = false;
    window.REAdminModal?.openStatic?.('jrn-modal-step', 'admin-journeys:add-step');
  }

  function jrnEditStep(id, title, desc, formId, isOptional) {
    document.getElementById('jrn-step-modal-title').textContent = 'Editar Etapa';
    document.getElementById('jrn-step-editing-id').value = id;
    document.getElementById('jrn-step-title').value = title;
    document.getElementById('jrn-step-desc').value = desc;
    document.getElementById('jrn-step-form').value = formId || '';
    document.getElementById('jrn-step-optional').checked = !!isOptional;
    window.REAdminModal?.openStatic?.('jrn-modal-step', 'admin-journeys:edit-step');
  }

  function jrnCloseStepModal() {
    window.REAdminModal?.closeById?.('jrn-modal-step', 'admin-journeys:close-step');
  }

  async function jrnSaveStep() {
    const editId = document.getElementById('jrn-step-editing-id').value;
    const body = {
      title: document.getElementById('jrn-step-title').value.trim(),
      description: document.getElementById('jrn-step-desc').value.trim(),
      form_id: document.getElementById('jrn-step-form').value || null,
      is_optional: document.getElementById('jrn-step-optional').checked,
    };
    if (!body.title) {
      alert('Título é obrigatório.');
      return;
    }

    const url = editId
      ? `/api/admin/journeys/${JRN.currentId}/steps/${editId}`
      : `/api/admin/journeys/${JRN.currentId}/steps`;
    const response = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: jrnAuthH(), body: JSON.stringify(body) });
    if (!response.ok) {
      alert('Erro ao salvar etapa.');
      return;
    }

    jrnCloseStepModal();
    jrnOpenEditor(JRN.currentId);
  }

  async function jrnDeleteStep(stepId) {
    if (!confirm('Remover esta etapa?')) return;
    const response = await fetch(`/api/admin/journeys/${JRN.currentId}/steps/${stepId}`, { method: 'DELETE', headers: jrnAuthH() });
    if (response.ok) jrnOpenEditor(JRN.currentId);
    else alert('Erro ao remover etapa.');
  }

  async function jrnMoveStep(stepId, direction) {
    const response = await fetch(`/api/admin/journeys/${JRN.currentId}`, { headers: jrnAuthH() });
    const journey = await response.json();
    const steps = [...(journey.steps || [])].sort((left, right) => left.order_index - right.order_index);
    const index = steps.findIndex(step => step.id === stepId);
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= steps.length) return;

    const order = steps.map((step, currentIndex) => {
      if (currentIndex === index) return { id: step.id, order_index: steps[swap].order_index };
      if (currentIndex === swap) return { id: step.id, order_index: steps[index].order_index };
      return { id: step.id, order_index: step.order_index };
    });

    await fetch(`/api/admin/journeys/${JRN.currentId}/steps/reorder`, {
      method: 'POST',
      headers: jrnAuthH(),
      body: JSON.stringify({ order }),
    });
    jrnOpenEditor(JRN.currentId);
  }

  async function jrnOpenAssignModal() {
    await jrnLoadClients();
    document.getElementById('jrn-assign-notes').value = '';
    window.REAdminModal?.openStatic?.('jrn-modal-assign', 'admin-journeys:assign');
  }

  function jrnCloseAssignModal() {
    window.REAdminModal?.closeById?.('jrn-modal-assign', 'admin-journeys:close-assign');
  }

  async function jrnSaveAssign() {
    const body = {
      user_id: document.getElementById('jrn-assign-user').value,
      notes: document.getElementById('jrn-assign-notes').value.trim(),
    };
    if (!body.user_id) {
      alert('Selecione um cliente.');
      return;
    }

    const response = await fetch(`/api/admin/journeys/${JRN.currentId}/assignments`, {
      method: 'POST',
      headers: jrnAuthH(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      alert('Erro ao atribuir cliente.');
      return;
    }

    jrnCloseAssignModal();
    jrnOpenEditor(JRN.currentId);
  }

  async function jrnRemoveAssignment(journeyId, assignmentId) {
    if (!confirm('Remover este cliente da jornada?')) return;
    const response = await fetch(`/api/admin/journeys/${journeyId}/assignments/${assignmentId}`, { method: 'DELETE', headers: jrnAuthH() });
    if (response.ok) jrnOpenEditor(journeyId);
    else alert('Erro ao remover.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const originalShowSection = window.showSection;
    window.showSection = function (section, button) {
      if (originalShowSection) originalShowSection(section, button);
      if (section === 'jornadas' && !JRN._inited) {
        JRN._inited = true;
        jrnInit();
      }
    };
  });

  window.JRN = JRN;
  window.jrnAuthH = jrnAuthH;
  window.jrnInit = jrnInit;
  window.jrnLoadForms = jrnLoadForms;
  window.jrnLoadClients = jrnLoadClients;
  window.jrnLoadList = jrnLoadList;
  window.jrnOpenEditor = jrnOpenEditor;
  window.jrnRenderSteps = jrnRenderSteps;
  window.jrnLoadAssignments = jrnLoadAssignments;
  window.jrnViewProgress = jrnViewProgress;
  window.jrnMarkStepDone = jrnMarkStepDone;
  window.jrnShowView = jrnShowView;
  window.jrnEsc = jrnEsc;
  window.jrnOpenNewModal = jrnOpenNewModal;
  window.jrnOpenEditModal = jrnOpenEditModal;
  window.jrnCloseFormModal = jrnCloseFormModal;
  window.jrnSaveForm = jrnSaveForm;
  window.jrnDelete = jrnDelete;
  window.jrnOpenAddStepModal = jrnOpenAddStepModal;
  window.jrnEditStep = jrnEditStep;
  window.jrnCloseStepModal = jrnCloseStepModal;
  window.jrnSaveStep = jrnSaveStep;
  window.jrnDeleteStep = jrnDeleteStep;
  window.jrnMoveStep = jrnMoveStep;
  window.jrnOpenAssignModal = jrnOpenAssignModal;
  window.jrnSaveAssign = jrnSaveAssign;
  window.jrnRemoveAssignment = jrnRemoveAssignment;

console.info('[RE:admin-journeys] loaded');
})();
