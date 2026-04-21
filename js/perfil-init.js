'use strict';

(function () {
  const AVATAR_KEY = 're_admin_avatar';

  function getStoredAvatarKey(user) {
    return user && user.isAdmin ? AVATAR_KEY : 're_client_avatar';
  }

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json' };
  }

  function getUserInitial(user) {
    return (user?.name || user?.company || user?.email || '?').charAt(0).toUpperCase();
  }

  function applyAvatarToUI(src) {
    const avatarEl = document.getElementById('userAvatar');
    const displayEl = document.getElementById('profileAvatarDisplay');
    if (!avatarEl || !displayEl) return;

    if (src) {
      [avatarEl, displayEl].forEach(function (element) {
        element.style.backgroundImage = 'url(' + src + ')';
        element.style.backgroundSize = 'cover';
        element.style.backgroundPosition = 'center';
        element.textContent = '';
      });
      document.getElementById('removeAvatarBtn')?.style.removeProperty('display');
      return;
    }

    [avatarEl, displayEl].forEach(function (element) {
      element.style.backgroundImage = '';
    });
    document.getElementById('removeAvatarBtn')?.style.setProperty('display', 'none');
  }

  window.handleAvatarUpload = function (input) {
    const file = input.files?.[0];
    const user = window.REShared?.getStoredUser?.() || {};
    const avatarKey = getStoredAvatarKey(user);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('A foto deve ter no máximo 2 MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      const dataUrl = event.target.result;
      localStorage.setItem(avatarKey, dataUrl);
      applyAvatarToUI(dataUrl);
      showToast('Foto atualizada.', 'success');
    };
    reader.readAsDataURL(file);
  };

  window.removeAvatar = function () {
    const user = window.REShared?.getStoredUser?.() || {};
    const avatarKey = getStoredAvatarKey(user);
    localStorage.removeItem(avatarKey);
    applyAvatarToUI('');
    const initial = getUserInitial(user);
    const avatarEl = document.getElementById('userAvatar');
    const displayEl = document.getElementById('profileAvatarDisplay');
    if (avatarEl) avatarEl.textContent = initial;
    if (displayEl) displayEl.textContent = initial;
    showToast('Foto removida.', 'success');
  };

  window.saveProfile = async function (event) {
    event.preventDefault();
    const name = document.getElementById('profileName')?.value.trim();
    const phone = document.getElementById('profilePhone')?.value.trim();
    if (!name) {
      showToast('Informe seu nome.', 'error');
      return;
    }

    const button = document.getElementById('saveProfileBtn');
    if (button) button.disabled = true;

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: authH(),
        body: JSON.stringify({ name, phone }),
      });
      if (!response.ok) throw new Error('response not ok');
      const data = await response.json();
      const updatedUser = data.user || {};
      const updatedName = updatedUser.name || name;
      if (window.REShared?.storeAuthUser) {
        window.REShared.storeAuthUser(Object.assign({}, window.REShared.getStoredUser?.() || {}, updatedUser));
      }
      document.getElementById('userName').textContent = updatedName;
      document.getElementById('dropupUserName').textContent = updatedName;
      if (!localStorage.getItem(getStoredAvatarKey(updatedUser))) {
        document.getElementById('userAvatar').textContent = updatedName.charAt(0).toUpperCase();
      }
      showToast('Perfil atualizado.', 'success');
    } catch (error) {
      showToast('Erro ao salvar perfil.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };

  window.savePassword = async function (event) {
    event.preventDefault();
    const current = document.getElementById('currentPassword')?.value;
    const next = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmPassword')?.value;

    if (!current || !next) {
      showToast('Preencha todos os campos.', 'error');
      return;
    }
    if (next.length < 8) {
      showToast('A nova senha deve ter ao menos 8 caracteres.', 'error');
      return;
    }
    if (next !== confirm) {
      showToast('As senhas não coincidem.', 'error');
      return;
    }

    const button = document.getElementById('savePasswordBtn');
    if (button) button.disabled = true;

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'response not ok');

      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      showToast('Senha atualizada.', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao atualizar senha.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };

  function fillProfile(user) {
    const displayName = user.name || user.company || user.email || 'Usuário';
    const initial = getUserInitial(user);

    document.getElementById('userName').textContent = displayName;
    document.getElementById('dropupUserName').textContent = displayName;
    document.getElementById('dropupUserEmail').textContent = user.email || 'Sem e-mail';
    document.getElementById('profileName').value = user.name || user.company || '';
    document.getElementById('profileEmail').value = user.email || '';
    document.getElementById('userAvatar').textContent = initial;
    document.getElementById('profileAvatarDisplay').textContent = initial;

    const savedAvatar = localStorage.getItem(getStoredAvatarKey(user));
    if (savedAvatar) applyAvatarToUI(savedAvatar);
  }

  async function initPerfil() {
    const session = await window.REShared.verifySession({ timeoutMs: 55000 }).catch(function () {
      return { ok: false, status: 0 };
    });

    if (!session.ok || !session.user) {
      window.REShared.redirectToRoute('login');
      return;
    }

    const user = session.user;
    window.REShared.applyPortalAccountShell(user, { section: 'home' });
    fillProfile(user);
    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initPerfil();
  } else {
    window.addEventListener('load', initPerfil, { once: true });
  }

  console.info('[RE:perfil-init] loaded');
})();
