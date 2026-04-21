'use strict';

(function () {
  async function refreshCurrentClient() {
    const clientId = window.REClientDetailState?.currentClientId || _currentClientId;
    if (!clientId) return null;
    const response = await fetch(`/api/admin/client/${clientId}`, { headers: authH() });
    if (!response.ok) return null;
    const payload = await response.json();
    if (window.REClientDetailState) window.REClientDetailState.currentClientData = payload;
    _currentClientData = payload;
    return payload;
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
    if (refreshed.ok) {
      const payload = await refreshed.json();
      if (window.REClientDetailState) window.REClientDetailState.currentClientData = payload;
      _currentClientData = payload;
    }
  }

  async function addTask() {
    const title = document.getElementById('newTaskTitle').value.trim();
    const description = document.getElementById('newTaskDesc').value.trim();
    const dueDate = document.getElementById('newTaskDate').value;
    if (!title) {
      showToast('Informe o título da tarefa.', 'error');
      return;
    }

    const clientId = window.REClientDetailState?.currentClientId || _currentClientId;
    const response = await fetch(`/api/admin/client/${clientId}/task`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ title, description, dueDate: dueDate || null }),
    });
    if (!response.ok) {
      showToast('Erro ao criar tarefa.', 'error');
      return;
    }

    showToast('Tarefa criada!', 'success');
    if (await refreshCurrentClient()) (window.renderClientDetailTab || renderDrawerTab)('tasks');
  }

  function applyMsgTemplate(index) {
    const template = (window._msgTemplates || [])[index];
    if (!template) return;
    const ta = document.getElementById('adminMsgInput');
    if (ta) {
      ta.value = template.text;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      ta.focus();
    }
  }

  async function sendAdminMessage() {
    const ta = document.getElementById('adminMsgInput');
    const text = ta.value.trim();
    if (!text) return;

    ta.value = '';
    ta.style.height = 'auto';
    const clientId = window.REClientDetailState?.currentClientId || _currentClientId;
    const response = await fetch(`/api/admin/client/${clientId}/message`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ text }),
    });
    if (response.ok && await refreshCurrentClient()) {
      (window.renderClientDetailTab || renderDrawerTab)('messages');
    }
  }

  async function updateDocStatus(docId) {
    const statusEl = document.getElementById(`docSt_${docId}`);
    const commentEl = document.getElementById(`docCmt_${docId}`);
    if (!statusEl) return;

    const status = statusEl.value;
    const comment = commentEl ? commentEl.value.trim() : '';
    const clientId = window.REClientDetailState?.currentClientId || _currentClientId;
    const response = await fetch(`/api/admin/client/${clientId}/documents/${docId}`, {
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
    (window.renderClientDetailTab || renderDrawerTab)('docs');
  }

  async function confirmApptDrawer(apptId) {
    const response = await fetch(`/api/admin/appointments/${apptId}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status: 'confirmado' }),
    });
    if (!response.ok) {
      showToast('Erro ao confirmar.', 'error');
      return;
    }

    showToast('Reunião confirmada!', 'success');
    if (await refreshCurrentClient()) (window.renderClientDetailTab || renderDrawerTab)('agenda');
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

console.info('[RE:admin-client-actions] loaded');
})();
