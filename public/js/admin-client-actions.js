'use strict';

(function () {
  async function refreshCurrentClient() {
    if (!_currentClientId) return null;
    const response = await fetch(`/api/admin/client/${_currentClientId}`, { headers: authH() });
    if (!response.ok) return null;
    _currentClientData = await response.json();
    return _currentClientData;
  }

  async function updateChapterStatus(clientId, chapterId, status) {
    const response = await fetch(`/api/admin/client/${clientId}/plan/chapter/${chapterId}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status }),
    });
    if (response.ok) showToast('Status atualizado.', 'success');
    else showToast('Erro ao atualizar.', 'error');

    const refreshed = await fetch(`/api/admin/client/${clientId}`, { headers: authH() });
    if (refreshed.ok) _currentClientData = await refreshed.json();
  }

  async function addTask() {
    const title = document.getElementById('newTaskTitle').value.trim();
    const description = document.getElementById('newTaskDesc').value.trim();
    const dueDate = document.getElementById('newTaskDate').value;
    if (!title) {
      showToast('Informe o título da tarefa.', 'error');
      return;
    }

    const response = await fetch(`/api/admin/client/${_currentClientId}/task`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ title, description, dueDate: dueDate || null }),
    });
    if (!response.ok) {
      showToast('Erro ao criar tarefa.', 'error');
      return;
    }

    showToast('Tarefa criada!', 'success');
    if (await refreshCurrentClient()) renderDrawerTab('tasks');
  }

  function applyMsgTemplate(index) {
    const template = (window._msgTemplates || [])[index];
    if (!template) return;
    const input = document.getElementById('adminMsgInput');
    if (input) {
      input.value = template.text;
      input.focus();
    }
  }

  async function sendAdminMessage() {
    const input = document.getElementById('adminMsgInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    const response = await fetch(`/api/admin/client/${_currentClientId}/message`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ text }),
    });
    if (response.ok && await refreshCurrentClient()) renderDrawerTab('messages');
  }

  async function updateDocStatus(docId) {
    const statusEl = document.getElementById(`docSt_${docId}`);
    const commentEl = document.getElementById(`docCmt_${docId}`);
    if (!statusEl) return;

    const status = statusEl.value;
    const comment = commentEl ? commentEl.value.trim() : '';
    const response = await fetch(`/api/admin/client/${_currentClientId}/documents/${docId}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status, comment }),
    });
    if (!response.ok) {
      showToast('Erro ao atualizar.', 'error');
      return;
    }

    showToast('Status do documento atualizado.', 'success');
    if (commentEl) commentEl.value = '';
    renderDrawerTab('docs');
  }

  async function confirmApptDrawer(apptId) {
    const response = await fetch(`/api/admin/appointments/${_currentClientId}/${apptId}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status: 'confirmado' }),
    });
    if (!response.ok) {
      showToast('Erro ao confirmar.', 'error');
      return;
    }

    showToast('Reunião confirmada!', 'success');
    if (await refreshCurrentClient()) renderDrawerTab('agenda');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.updateChapterStatus = updateChapterStatus;
  window.addTask = addTask;
  window.applyMsgTemplate = applyMsgTemplate;
  window.sendAdminMessage = sendAdminMessage;
  window.updateDocStatus = updateDocStatus;
  window.confirmApptDrawer = confirmApptDrawer;
  window.escHtml = escHtml;
})();