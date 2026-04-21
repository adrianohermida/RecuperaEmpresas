'use strict';

(function () {
  const AVATAR_KEY = 're_admin_avatar';

  function getToken() {
    if (window.REShared?.getStoredToken) return window.REShared.getStoredToken();
    return localStorage.getItem('re_token');
  }

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() };
  }

  function applyAvatarToUI(src) {
    const avatarEl = document.getElementById('userAvatar');
    const displayEl = document.getElementById('profileAvatarDisplay');
    if (!avatarEl || !displayEl) return;

    if (src) {
      avatarEl.style.backgroundImage = `url(${src})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';

      displayEl.style.backgroundImage = `url(${src})`;
      displayEl.style.backgroundSize = 'cover';
      displayEl.style.backgroundPosition = 'center';
      displayEl.textContent = '';

      const removeBtn = document.getElementById('removeAvatarBtn');
      if (removeBtn) removeBtn.style.display = '';
    } else {
      avatarEl.style.backgroundImage = '';
      displayEl.style.backgroundImage = '';
      const removeBtn = document.getElementById('removeAvatarBtn');
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  window.handleAvatarUpload = function (input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('A foto deve ter no máximo 2 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      localStorage.setItem(AVATAR_KEY, dataUrl);
      applyAvatarToUI(dataUrl);
      showToast('Foto atualizada.', 'success');
    };
    reader.readAsDataURL(file);
  };

  window.removeAvatar = function () {
    localStorage.removeItem(AVATAR_KEY);
    const avatarEl = document.getElementById('userAvatar');
    const displayEl = document.getElementById('profileAvatarDisplay');
    if (avatarEl) {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (document.getElementById('userName')?.textContent || '?')[0].toUpperCase();
    }
    if (displayEl) {
      displayEl.style.backgroundImage = '';
      displayEl.textContent = (document.getElementById('userName')?.textContent || '?')[0].toUpperCase();
    }
    const removeBtn = document.getElementById('removeAvatarBtn');
    if (removeBtn) removeBtn.style.display = 'none';
    showToast('Foto removida.', 'success');
  };

  window.saveProfile = async function (e) {
    e.preventDefault();
    const name = document.getElementById('profileName')?.value.trim();
    const phone = document.getElementById('profilePhone')?.value.trim();
    if (!name) { showToast('Informe seu nome.', 'error'); return; }

    const btn = document.getElementById('saveProfileBtn');
    if (btn) btn.disabled = true;

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: authH(),
        body: JSON.stringify({ name, phone }),
      });
      if (!response.ok) throw new Error('response not ok');
      const data = await response.json();
      const updatedName = data.user?.name || name;
      const userNameEl = document.getElementById('userName');
      const dropupNameEl = document.getElementById('dropupUserName');
      const avatarEl = document.getElementById('userAvatar');
      if (userNameEl) userNameEl.textContent = updatedName;
      if (dropupNameEl) dropupNameEl.textContent = updatedName;
      const savedAvatar = localStorage.getItem(AVATAR_KEY);
      if (!savedAvatar && avatarEl) avatarEl.textContent = updatedName[0].toUpperCase();
      showToast('Perfil atualizado.', 'success');
    } catch {
      showToast('Erro ao salvar perfil.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.savePassword = async function (e) {
    e.preventDefault();
    const current = document.getElementById('currentPassword')?.value;
    const next = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmPassword')?.value;

    if (!current || !next) { showToast('Preencha todos os campos.', 'error'); return; }
    if (next.length < 8) { showToast('A nova senha deve ter ao menos 8 caracteres.', 'error'); return; }
    if (next !== confirm) { showToast('As senhas não coincidem.', 'error'); return; }

    const btn = document.getElementById('savePasswordBtn');
    if (btn) btn.disabled = true;

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'response not ok');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      showToast('Senha atualizada.', 'success');
    } catch (err) {
      showToast(err.message || 'Erro ao atualizar senha.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  async function initPerfil() {
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
      window.REShared.redirectToRoute('login', { search: 'err=timeout' });
      return;
    }

    if (!response.ok) { window.REShared.redirectToRoute('login'); return; }

    let user;
    try {
      const body = await response.json();
      user = body.user;
      if (!user) throw new Error('missing user');
      if (window.REShared?.storeAuthUser) window.REShared.storeAuthUser(user);
    } catch {
      window.REShared.redirectToRoute('login', { search: 'err=parse' });
      return;
    }

    if (!user.isAdmin) { window.REShared.redirectToRoute('dashboard'); return; }

    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropupUserName = document.getElementById('dropupUserName');
    const dropupUserEmail = document.getElementById('dropupUserEmail');
    const profileAvatarDisplay = document.getElementById('profileAvatarDisplay');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');

    if (userName) userName.textContent = user.name || user.email;
    if (dropupUserName) dropupUserName.textContent = user.name || user.email;
    if (dropupUserEmail) dropupUserEmail.textContent = user.email || '';
    if (profileName) profileName.value = user.name || '';
    if (profileEmail) profileEmail.value = user.email || '';

    const initials = (user.name || user.email || '?')[0].toUpperCase();
    if (userAvatar) userAvatar.textContent = initials;
    if (profileAvatarDisplay) profileAvatarDisplay.textContent = initials;

    const savedAvatar = localStorage.getItem(AVATAR_KEY);
    if (savedAvatar) applyAvatarToUI(savedAvatar);

    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initPerfil();
  } else {
    window.addEventListener('load', initPerfil);
  }

  console.info('[RE:perfil-init] loaded');
})();
