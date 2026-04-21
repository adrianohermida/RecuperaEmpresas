'use strict';

(function () {
  const PREFS_KEY = 're_portal_prefs';

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json' };
  }

  function getPrefsKey(user) {
    return user && user.isAdmin ? 're_admin_prefs' : PREFS_KEY;
  }

  function loadPrefs(user) {
    try {
      return JSON.parse(localStorage.getItem(getPrefsKey(user)) || '{}');
    } catch (error) {
      return {};
    }
  }

  function storePrefs(user, prefs) {
    localStorage.setItem(getPrefsKey(user), JSON.stringify(prefs));
  }

  window.saveSetting = function (key, value) {
    const user = window.REShared?.getStoredUser?.() || {};
    const prefs = loadPrefs(user);
    prefs[key] = value;
    storePrefs(user, prefs);
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
      window.REShared.redirectToRoute('login');
    } catch (error) {
      showToast('Erro ao encerrar sessões.', 'error');
    }
  };

  function applyPrefsToUI(prefs) {
    ['notifMessages', 'notifNewClients', 'notifSteps', 'prefCompactTable', 'prefShowProgress'].forEach(function (id) {
      const element = document.getElementById(id);
      if (!element) return;
      if (Object.prototype.hasOwnProperty.call(prefs, id)) {
        element.checked = !!prefs[id];
      }
    });
  }

  function fillUser(user) {
    const displayName = user.name || user.company || user.email || 'Usuário';
    const initial = displayName.charAt(0).toUpperCase();
    const avatar = document.getElementById('userAvatar');

    document.getElementById('userName').textContent = displayName;
    document.getElementById('dropupUserName').textContent = displayName;
    document.getElementById('dropupUserEmail').textContent = user.email || 'Sem e-mail';
    if (avatar) avatar.textContent = initial;

    const avatarKey = user.isAdmin ? 're_admin_avatar' : 're_client_avatar';
    const savedAvatar = localStorage.getItem(avatarKey);
    if (savedAvatar && avatar) {
      avatar.style.backgroundImage = 'url(' + savedAvatar + ')';
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
      avatar.textContent = '';
    }
  }

  async function initConfiguracoes() {
    const session = await window.REShared.verifySession({ timeoutMs: 55000 }).catch(function () {
      return { ok: false, status: 0 };
    });

    if (!session.ok || !session.user) {
      window.REShared.redirectToRoute('login');
      return;
    }

    const user = session.user;
    window.REShared.applyPortalAccountShell(user, { section: 'home' });
    fillUser(user);
    applyPrefsToUI(loadPrefs(user));
    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initConfiguracoes();
  } else {
    window.addEventListener('load', initConfiguracoes, { once: true });
  }

  console.info('[RE:configuracoes-init] loaded');
})();
