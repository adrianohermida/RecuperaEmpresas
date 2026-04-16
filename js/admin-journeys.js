'use strict';

(function () {
  const JRN = { currentId: null, forms: [], clients: [] };

  function jrnAuthH() {
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
    const response = await fetch('/api/admin/users', { headers: jrnAuthH() });
    if (!response.ok) return;
    const payload = await response.json();
    JRN.clients = (payload.users || payload || []).filter(user => !user.is_admin);
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
    grid.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando...</div>';

    const response = await fetch('/api/admin/journeys', { headers: jrnAuthH() });
    if (!response.ok) {
      grid.innerHTML = '<div style="padding:24px;color:#EF4444;">Erro ao carregar.</div>';
      return;
    }

    const journeys = await response.json();
    if (!journeys.length) {
      grid.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
        <div style="font-size:40px;margin-bottom:12px;">🗺️</div>
        <div style="font-size:15px;font-weight:600;color:#64748B;margin-bottom:8px;">Nenhuma jornada criada</div>
        <div style="font-size:13px;">Clique em "Nova Jornada" para começar.</div>
      </div>`;
      return;
    }

    const statusColor = { draft: '#94A3B8', active: '#10B981', archived: '#F59E0B' };
    const statusLabel = { draft: 'Rascunho', active: 'Ativo', archived: 'Arquivado' };

    grid.innerHTML = journeys.map(journey => `
      <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;cursor:pointer;transition:box-shadow .15s;"
           onclick="jrnOpenEditor('${journey.id}')"
           onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="font-weight:700;font-size:15px;color:#1E293B;">${jrnEsc(journey.name)}</div>
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#F1F5F9;color:${statusColor[journey.status] || '#94A3B8'};white-space:nowrap;">${statusLabel[journey.status] || journey.status}</span>
        </div>
        ${journey.description ? `<div style="font-size:13px;color:#64748B;line-height:1.5;">${jrnEsc(journey.description)}</div>` : ''}
        <div style="display:flex;gap:12px;font-size:12px;color:#94A3B8;">
          <span>📅 ${new Date(journey.created_at).toLocaleDateString('pt-BR')}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-primary" style="font-size:12px;padding:6px 12px;" onclick="event.stopPropagation();jrnOpenEditor('${journey.id}')">Gerenciar</button>
          <button class="btn-ghost" style="font-size:12px;padding:6px 12px;color:#EF4444;" onclick="event.stopPropagation();jrnDelete('${journey.id}','${jrnEsc(journey.name)}')">Excluir</button>
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
    const statusColor = { draft: '#94A3B8', active: '#10B981', archived: '#F59E0B' };
    const statusLabel = { draft: 'Rascunho', active: 'Ativo', archived: 'Arquivado' };
    const badge = document.getElementById('jrn-editor-status-badge');
    badge.textContent = statusLabel[journey.status] || journey.status;
    badge.style.color = statusColor[journey.status] || '#94A3B8';

    JRN.current = journey;
    jrnRenderSteps(journey.steps || []);
    await jrnLoadAssignments(id);
  }

  function jrnRenderSteps(steps) {
    const element = document.getElementById('jrn-steps-list');
    if (!element) return;
    if (!steps.length) {
      element.innerHTML = '<div style="color:#94A3B8;text-align:center;padding:20px;">Nenhuma etapa ainda.</div>';
      return;
    }

    element.innerHTML = steps.map((step, index) => `
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
        <div style="width:24px;height:24px;border-radius:50%;background:#1A56DB;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${index + 1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:#1E293B;">${jrnEsc(step.title)}</div>
          ${step.re_forms ? `<div style="font-size:11px;color:#6366F1;margin-top:2px;">📋 ${jrnEsc(step.re_forms.title)}</div>` : ''}
          ${step.is_optional ? '<div style="font-size:10px;color:#94A3B8;">Opcional</div>' : ''}
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="jrnEditStep('${step.id}','${jrnEsc(step.title)}','${jrnEsc(step.description || '')}','${step.form_id || ''}',${step.is_optional})">✏️</button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 8px;color:#EF4444;" onclick="jrnDeleteStep('${step.id}')">🗑️</button>
          ${index > 0 ? `<button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="jrnMoveStep('${step.id}','up')">↑</button>` : ''}
          ${index < steps.length - 1 ? `<button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="jrnMoveStep('${step.id}','down')">↓</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  async function jrnLoadAssignments(id) {
    const response = await fetch(`/api/admin/journeys/${id}/assignments`, { headers: jrnAuthH() });
    const element = document.getElementById('jrn-assignments-list');
    if (!element) return;
    if (!response.ok) {
      element.innerHTML = '<div style="color:#EF4444;">Erro ao carregar.</div>';
      return;
    }

    const list = await response.json();
    if (!list.length) {
      element.innerHTML = '<div style="color:#94A3B8;text-align:center;padding:16px;">Nenhum cliente atribuído.</div>';
      return;
    }

    const statusLabel = { active: 'Ativo', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado' };
    const statusColor = { active: '#10B981', paused: '#F59E0B', completed: '#6366F1', cancelled: '#EF4444' };

    element.innerHTML = list.map(assignment => {
      const user = assignment.re_users || {};
      return `
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${jrnEsc(user.name || user.email || '—')}</div>
          <div style="font-size:11px;color:#94A3B8;">${jrnEsc(user.email || '')}</div>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:#F1F5F9;color:${statusColor[assignment.status] || '#94A3B8'};white-space:nowrap;">${statusLabel[assignment.status] || assignment.status}</span>
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="jrnViewProgress('${id}','${assignment.id}','${jrnEsc(user.name || user.email || '')}')">Ver progresso</button>
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;color:#EF4444;" onclick="jrnRemoveAssignment('${id}','${assignment.id}')">✕</button>
      </div>`;
    }).join('');
  }

  async function jrnViewProgress(journeyId, assignmentId, clientName) {
    jrnShowView('progress');
    document.getElementById('jrn-progress-title').textContent = `Progresso — ${clientName}`;
    document.getElementById('jrn-progress-back-btn').onclick = () => jrnOpenEditor(journeyId);
    const element = document.getElementById('jrn-progress-content');
    element.innerHTML = '<div style="color:#94A3B8;text-align:center;padding:20px;">Carregando...</div>';

    const response = await fetch(`/api/admin/journeys/${journeyId}/assignments/${assignmentId}/progress`, { headers: jrnAuthH() });
    if (!response.ok) {
      element.innerHTML = '<div style="color:#EF4444;">Erro.</div>';
      return;
    }

    const data = await response.json();
    const done = data.steps.filter(step => step.completed).length;
    const total = data.steps.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    element.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:13px;font-weight:600;color:#1E293B;">Progresso geral</div>
          <div style="font-size:13px;font-weight:700;color:#1A56DB;">${pct}%</div>
        </div>
        <div style="height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:#1A56DB;border-radius:4px;transition:width .4s;"></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${data.steps.map((step, index) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${step.completed ? '#F0FDF4' : '#F8FAFC'};border:1px solid ${step.completed ? '#BBF7D0' : '#E2E8F0'};border-radius:8px;">
            <div style="width:22px;height:22px;border-radius:50%;background:${step.completed ? '#10B981' : '#E2E8F0'};color:${step.completed ? '#fff' : '#94A3B8'};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${step.completed ? '✓' : index + 1}</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:#1E293B;">${jrnEsc(step.title)}</div>
              ${step.completed_at ? `<div style="font-size:11px;color:#10B981;">Concluído em ${new Date(step.completed_at).toLocaleString('pt-BR')}</div>` : '<div style="font-size:11px;color:#94A3B8;">Pendente</div>'}
            </div>
            ${!step.completed ? `<button class="btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="jrnMarkStepDone('${journeyId}','${assignmentId}','${step.id}','${clientName}')">Marcar concluído</button>` : ''}
          </div>
        `).join('')}
      </div>`;
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

  function jrnOpenNewModal() {
    JRN.editingId = null;
    document.getElementById('jrn-modal-title').textContent = 'Nova Jornada';
    document.getElementById('jrn-save-btn').textContent = 'Criar Jornada';
    document.getElementById('jrn-f-name').value = '';
    document.getElementById('jrn-f-desc').value = '';
    document.getElementById('jrn-f-status').value = 'draft';
    document.getElementById('jrn-modal-form').classList.remove('ui-hidden');
  }

  function jrnOpenEditModal() {
    if (!JRN.current) return;
    JRN.editingId = JRN.current.id;
    document.getElementById('jrn-modal-title').textContent = 'Editar Jornada';
    document.getElementById('jrn-save-btn').textContent = 'Salvar';
    document.getElementById('jrn-f-name').value = JRN.current.name || '';
    document.getElementById('jrn-f-desc').value = JRN.current.description || '';
    document.getElementById('jrn-f-status').value = JRN.current.status || 'draft';
    document.getElementById('jrn-modal-form').classList.remove('ui-hidden');
  }

  function jrnCloseFormModal() {
    document.getElementById('jrn-modal-form').classList.add('ui-hidden');
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
    document.getElementById('jrn-modal-step').classList.remove('ui-hidden');
  }

  function jrnEditStep(id, title, desc, formId, isOptional) {
    document.getElementById('jrn-step-modal-title').textContent = 'Editar Etapa';
    document.getElementById('jrn-step-editing-id').value = id;
    document.getElementById('jrn-step-title').value = title;
    document.getElementById('jrn-step-desc').value = desc;
    document.getElementById('jrn-step-form').value = formId || '';
    document.getElementById('jrn-step-optional').checked = !!isOptional;
    document.getElementById('jrn-modal-step').classList.remove('ui-hidden');
  }

  function jrnCloseStepModal() {
    document.getElementById('jrn-modal-step').classList.add('ui-hidden');
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
    document.getElementById('jrn-modal-assign').classList.remove('ui-hidden');
  }

  function jrnCloseAssignModal() {
    document.getElementById('jrn-modal-assign').classList.add('ui-hidden');
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
})();