'use strict';

(function () {
  const PREFS_KEY = 're_admin_prefs';

  function getToken() {
    if (window.REShared?.getStoredToken) return window.REShared.getStoredToken();
    return localStorage.getItem('re_token');
  }

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() };
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
  }

  function storePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  window.saveSetting = function (key, value) {
    const prefs = loadPrefs();
    prefs[key] = value;
    storePrefs(prefs);
    showToast('Preferência salva.', 'success', 1500);
  };

  window.revokeAllSessions = async function () {
    if (!confirm('Isso encerrará sua sessão em todos os dispositivos. Continuar?')) return;
    try {
      if (window.REShared?.logoutSession) {
        await window.REShared.logoutSession({ global: true });
      } else {
        const response = await fetch('/api/auth/revoke-sessions', {
          method: 'POST',
          headers: authH(),
        });
        if (!response.ok) throw new Error('response not ok');
      }
      location.href = 'login.html';
    } catch {
      showToast('Erro ao encerrar sessões.', 'error');
    }
  };

  function applyPrefsToUI(prefs) {
    const ids = ['notifMessages', 'notifNewClients', 'notifSteps', 'prefCompactTable', 'prefShowProgress'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id in prefs) {
        el.checked = !!prefs[id];
      }
    });
  }

  async function initConfiguracoes() {
    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      response = await fetch('/api/auth/verify', {
        headers: authH(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch {
      location.href = 'login.html?err=timeout';
      return;
    }

    if (!response.ok) { location.href = 'login.html'; return; }

    let user;
    try {
      const body = await response.json();
      user = body.user;
      if (!user) throw new Error('missing user');
      if (window.REShared?.storeAuthUser) window.REShared.storeAuthUser(user);
    } catch {
      location.href = 'login.html?err=parse';
      return;
    }

    if (!user.isAdmin) { location.href = 'dashboard.html'; return; }

    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropupUserName = document.getElementById('dropupUserName');
    const dropupUserEmail = document.getElementById('dropupUserEmail');

    if (userName) userName.textContent = user.name || user.email;
    if (userAvatar) userAvatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
    if (dropupUserName) dropupUserName.textContent = user.name || user.email;
    if (dropupUserEmail) dropupUserEmail.textContent = user.email || '';

    const savedAvatar = localStorage.getItem('re_admin_avatar');
    if (savedAvatar && userAvatar) {
      userAvatar.style.backgroundImage = `url(${savedAvatar})`;
      userAvatar.style.backgroundSize = 'cover';
      userAvatar.style.backgroundPosition = 'center';
      userAvatar.textContent = '';
    }

    applyPrefsToUI(loadPrefs());
    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initConfiguracoes();
  } else {
    window.addEventListener('load', initConfiguracoes);
  }

  console.info('[RE:configuracoes-init] loaded');
})();
