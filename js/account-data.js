'use strict';

(function () {
  function authH(includeContentType) {
    if (window.REShared?.buildAuthHeaders) {
      return window.REShared.buildAuthHeaders({ includeContentType: includeContentType !== false });
    }
    var headers = {};
    if (includeContentType !== false) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function readJsonSafe(response) {
    try {
      return await response.json();
    } catch (_error) {
      return {};
    }
  }

  async function fetchProfileState() {
    var response = await fetch('/api/auth/profile', {
      method: 'GET',
      headers: authH(false),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar perfil.');
    return data;
  }

  async function saveProfileState(payload) {
    var response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: authH(true),
      body: JSON.stringify(payload || {}),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao salvar perfil.');
    return data;
  }

  async function listCompanyMembers() {
    var response = await fetch('/api/company/members', { headers: authH(false) });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar equipe.');
    return data.members || [];
  }

  async function inviteCompanyMember(payload) {
    var response = await fetch('/api/company/members', {
      method: 'POST',
      headers: authH(true),
      body: JSON.stringify(payload || {}),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao convidar membro.');
    return data;
  }

  async function updateCompanyMember(memberId, payload) {
    var response = await fetch('/api/company/members/' + memberId, {
      method: 'PUT',
      headers: authH(true),
      body: JSON.stringify(payload || {}),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao atualizar membro.');
    return data;
  }

  async function deleteCompanyMember(memberId) {
    var response = await fetch('/api/company/members/' + memberId, {
      method: 'DELETE',
      headers: authH(false),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao remover membro.');
    return data;
  }

  async function resetCompanyMemberPassword(memberId, password) {
    var response = await fetch('/api/company/members/' + memberId + '/reset-password', {
      method: 'POST',
      headers: authH(true),
      body: JSON.stringify({ password: password }),
    });
    var data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao redefinir senha.');
    return data;
  }

  function renderAvatar(element, src, fallback) {
    if (!element) return;
    if (src) {
      element.innerHTML = '<img alt="Avatar" src="' + src + '"/>';
      return;
    }
    element.innerHTML = '';
    element.textContent = (fallback || '?').charAt(0).toUpperCase();
  }

  function centerCropImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(''); return; }
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function (event) {
        var image = new Image();
        image.onerror = reject;
        image.onload = function () {
          var size = Math.min(image.width, image.height);
          var sx = Math.max(0, Math.floor((image.width - size) / 2));
          var sy = Math.max(0, Math.floor((image.height - size) / 2));
          var canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 320;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(image, sx, sy, size, size, 0, 0, 320, 320);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        image.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function splitTags(text) {
    return String(text || '')
      .split(',')
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function ensureSignatureEditor(rootId, toolbarId) {
    var editor = document.getElementById(rootId);
    var toolbar = document.getElementById(toolbarId);
    if (!editor || !toolbar) return;
    toolbar.querySelectorAll('[data-cmd]').forEach(function (button) {
      button.addEventListener('click', function () {
        var cmd = button.getAttribute('data-cmd');
        editor.focus();
        document.execCommand(cmd, false, null);
      });
    });
  }

  window.REAccountData = {
    centerCropImage: centerCropImage,
    deleteCompanyMember: deleteCompanyMember,
    ensureSignatureEditor: ensureSignatureEditor,
    fetchProfileState: fetchProfileState,
    inviteCompanyMember: inviteCompanyMember,
    listCompanyMembers: listCompanyMembers,
    renderAvatar: renderAvatar,
    resetCompanyMemberPassword: resetCompanyMemberPassword,
    saveProfileState: saveProfileState,
    splitTags: splitTags,
    updateCompanyMember: updateCompanyMember,
  };
})();