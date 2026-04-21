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

  function isFreshchatEnabled() {
    return !!(window.RE_ENABLE_FRESHCHAT && window.RE_FRESHCHAT_TOKEN && window.RE_FRESHCHAT_SITE_ID);
  }

  function getFreshchatScriptPromise() {
    if (window.__reFreshchatScriptPromise) return window.__reFreshchatScriptPromise;
    window.__reFreshchatScriptPromise = new Promise(function (resolve, reject) {
      if (typeof window.fcWidget !== 'undefined') {
        resolve(window.fcWidget);
        return;
      }
      var existing = document.querySelector('script[data-re-freshchat="true"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.fcWidget); }, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = '//fw-cdn.com/16078787/7064112.js';
      script.setAttribute('chat', 'true');
      script.setAttribute('data-re-freshchat', 'true');
      script.async = true;
      script.onload = function () { resolve(window.fcWidget); };
      script.onerror = reject;
      document.body.appendChild(script);
    });
    return window.__reFreshchatScriptPromise;
  }

  function pollFreshchatReady(attempts) {
    return new Promise(function (resolve, reject) {
      function check(remaining) {
        if (typeof window.fcWidget !== 'undefined') {
          resolve(window.fcWidget);
          return;
        }
        if (remaining <= 0) {
          reject(new Error('Freshchat widget não ficou pronto a tempo.'));
          return;
        }
        setTimeout(function () { check(remaining - 1); }, 500);
      }
      check(attempts || 30);
    });
  }

  function buildFreshchatName(user) {
    var fullName = String(user?.name || user?.full_name || user?.company || user?.email || '').trim();
    var parts = fullName.split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' '),
    };
  }

  function configureFreshchatShell(options) {
    window.fcSettings = {
      token: window.RE_FRESHCHAT_TOKEN,
      host: window.RE_FRESHCHAT_HOST || 'https://msdk.freshchat.com',
      siteId: window.RE_FRESHCHAT_SITE_ID,
      config: {
        headerProperty: {
          appName: options?.appName || 'Recupera Empresas',
          backgroundColor: '#1e3a5f',
          foregroundColor: '#ffffff'
        },
        content: {
          placeholders: {
            search_field: 'Buscar conversa...',
            reply_field: options?.replyPlaceholder || 'Escreva sua mensagem...'
          }
        }
      }
    };
  }

  async function bootFreshchat(user) {
    if (!isFreshchatEnabled() || !user) return false;
    var bootKey = [user.id || user.email || 'unknown', user.isAdmin ? 'consultor' : 'cliente', user.company_id || user.id || 'tenant'].join('::');
    if (window.__reFreshchatBootKey === bootKey && typeof window.fcWidget !== 'undefined') return true;

    configureFreshchatShell({
      appName: user.isAdmin ? 'Recupera Empresas — Operador' : 'Recupera Empresas',
      replyPlaceholder: user.isAdmin ? 'Responder...' : 'Escreva sua mensagem...'
    });

    await getFreshchatScriptPromise();
    await pollFreshchatReady(30);

    var response = await fetch('/api/freshchat-token', { headers: authH(false) });
    var data = await readJsonSafe(response);
    if (!response.ok || !data.token) throw new Error(data.error || 'Erro ao autenticar Freshchat.');

    var names = buildFreshchatName(user);
    window.fcWidget.setExternalId(data.external_id || user.id || user.email);
    window.fcWidget.user.setFirstName(names.firstName);
    window.fcWidget.user.setLastName(names.lastName);
    window.fcWidget.user.setEmail(user.email || '');

    if (user.isAdmin) {
      window.fcWidget.user.setProperties({
        role: 'consultor',
        scope: user.company_id ? 'tenant-member' : 'admin-global',
        tenant_id: user.company_id || user.id || '',
        company: user.company || '',
        app: 'Recupera Empresas — Operador'
      });

      await new Promise(function (resolve, reject) {
        window.fcWidget.authenticate({
          token: data.token,
          callback: function (error) {
            if (error) reject(error);
            else resolve();
          }
        });
      });

      window.__reFreshchatBootKey = bootKey;
      return true;
    }

    window.fcWidget.user.setProperties({
      role: user.company_id ? 'membro' : 'cliente',
      tenant_id: user.company_id || user.id || '',
      company: user.company || '',
      plan: user.company_id ? 'tenant-member' : 'tenant-owner'
    });

    await new Promise(function (resolve, reject) {
      window.fcWidget.authenticate({
        token: data.token,
        callback: function (error) {
          if (error) reject(error);
          else resolve();
        }
      });
    });

    window.__reFreshchatBootKey = bootKey;
    return true;
  }

  window.REAccountData = {
    bootFreshchat: bootFreshchat,
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