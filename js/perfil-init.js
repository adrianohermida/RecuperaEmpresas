'use strict';

(function () {
  let currentUser = null;
  let currentProfile = null;
  let currentPreferences = null;
  let tenantMembers = [];
  let pendingAvatarDataUrl = '';

  function renderCompetencyPreview() {
    var container = document.getElementById('profileCompetencyPreview');
    if (!container) return;
    var tags = window.REAccountData.splitTags(document.getElementById('profileCompetencies')?.value);
    if (!tags.length) {
      container.innerHTML = '<span class="account-chip account-chip-muted">Nenhuma competência destacada ainda</span>';
      return;
    }
    container.innerHTML = tags.map(function (tag) {
      return '<span class="account-chip">' + tag + '</span>';
    }).join('');
  }

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json' };
  }

  function getUserInitial(user) {
    return (user?.name || user?.company || user?.email || '?').charAt(0).toUpperCase();
  }

  function getDisplayName(user) {
    return user?.name || user?.company || user?.email || 'Usuário';
  }

  function applyAvatarToUI(src) {
    const avatarEl = document.getElementById('userAvatar');
    const displayEl = document.getElementById('profileAvatarDisplay');
    const fallback = getUserInitial(currentUser);

    window.REAccountData.renderAvatar(avatarEl, src, fallback);
    window.REAccountData.renderAvatar(displayEl, src, fallback);
    document.getElementById('removeAvatarBtn')?.style.setProperty('display', src ? 'inline-flex' : 'none');
  }

  function syncHeader() {
    const displayName = getDisplayName(currentUser);
    const avatarSrc = pendingAvatarDataUrl || currentProfile?.avatar_data_url || '';

    document.getElementById('userName').textContent = displayName;
    document.getElementById('dropupUserName').textContent = displayName;
    document.getElementById('dropupUserEmail').textContent = currentUser?.email || 'Sem e-mail';
    document.getElementById('profileHeroName').textContent = displayName;
    document.getElementById('profileHeroEmail').textContent = currentUser?.email || 'Sem e-mail';
    document.getElementById('profileHeroRole').textContent = currentUser?.isAdmin
      ? 'Administrador global'
      : currentUser?.isMember
        ? 'Membro do tenant · ' + (currentUser.role || 'visualizador')
        : 'Titular do tenant';

    applyAvatarToUI(avatarSrc);
  }

  function renderTenantSummary() {
    const container = document.getElementById('tenantSummaryPanel');
    if (!container) return;
    const tenantId = currentUser?.company_id || currentUser?.id || '';
    const memberCount = Array.isArray(tenantMembers) ? tenantMembers.length : 0;
    const tenantLinks = currentProfile?.tenant_links || [];
    document.getElementById('profileTenantCount').textContent = String(Math.max(tenantLinks.length || 0, tenantId ? 1 : 0));

    if (currentUser?.isAdmin) {
      container.innerHTML = '<div class="account-note-card">Seu usuário opera no contexto administrativo global. A associação por tenant aparece quando você entra como cliente ou membro.</div>';
      return;
    }

    const cards = [
      '<div class="account-note-card">',
      '  <div class="account-note-title">Tenant principal</div>',
      '  <div class="account-note-line"><strong>ID:</strong> ' + (tenantId || 'não disponível') + '</div>',
      '  <div class="account-note-line"><strong>Papel:</strong> ' + (currentUser?.role || (currentUser?.isMember ? 'membro' : 'titular')) + '</div>',
      '  <div class="account-note-line"><strong>Equipe:</strong> ' + memberCount + ' membro(s)</div>',
      '</div>'
    ];

    if (tenantLinks.length) {
      cards.push('<div class="account-chip-list">' + tenantLinks.map(function (item) {
        var label = item.label || item.tenant_id || item.type || 'Tenant';
        var role = item.role ? ' · ' + item.role : '';
        return '<span class="account-chip">' + label + role + '</span>';
      }).join('') + '</div>');
    }

    container.innerHTML = cards.join('');
  }

  function renderMetrics() {
    const competencies = currentProfile?.competencies || [];
    const score = [currentProfile?.bio, currentProfile?.qualifications, currentProfile?.signature_html, competencies.length]
      .filter(Boolean).length;
    document.getElementById('profileCompetencyCount').textContent = String(competencies.length);
    document.getElementById('profileCompletionLabel').textContent = score >= 4 ? 'Completo' : score >= 2 ? 'Em evolução' : 'Base';
  }

  function renderProfileState() {
    if (!currentUser || !currentProfile) return;
    document.getElementById('profileName').value = currentUser.name || currentUser.company || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profilePhone').value = currentProfile.phone || '';
    document.getElementById('profileBio').value = currentProfile.bio || '';
    document.getElementById('profileQualifications').value = currentProfile.qualifications || '';
    document.getElementById('profileCompetencies').value = (currentProfile.competencies || []).join(', ');
    document.getElementById('socialLinkedin').value = currentProfile.social_links?.linkedin || '';
    document.getElementById('socialInstagram').value = currentProfile.social_links?.instagram || '';
    document.getElementById('socialWebsite').value = currentProfile.social_links?.website || '';
    document.getElementById('socialWhatsapp').value = currentProfile.social_links?.whatsapp || '';
    document.getElementById('profileSignatureEditor').innerHTML = currentProfile.signature_html || '<p><strong>' + getDisplayName(currentUser) + '</strong></p><p>Equipe Recupera Empresas</p>';
    syncHeader();
    renderMetrics();
    renderTenantSummary();
    renderCompetencyPreview();
  }

  window.handleAvatarUpload = async function (input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('A foto deve ter no máximo 2 MB.', 'error');
      return;
    }
    try {
      pendingAvatarDataUrl = await window.REAccountData.centerCropImage(file);
      applyAvatarToUI(pendingAvatarDataUrl);
      showToast('Avatar preparado. Salve o perfil para persistir.', 'success');
    } catch (_error) {
      showToast('Não foi possível processar a imagem.', 'error');
    } finally {
      input.value = '';
    }
  };

  window.removeAvatar = function () {
    pendingAvatarDataUrl = '';
    if (currentProfile) currentProfile.avatar_data_url = '';
    applyAvatarToUI('');
    showToast('Avatar removido. Salve o perfil para persistir.', 'success');
  };

  window.saveProfile = async function (event) {
    event.preventDefault();
    const name = document.getElementById('profileName')?.value.trim();
    if (!name) {
      showToast('Informe seu nome.', 'error');
      return;
    }

    const button = document.getElementById('saveProfileBtn');
    const originalLabel = button ? button.textContent : 'Salvar perfil';
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }

    try {
      const payload = {
        name: name,
        profile: {
          phone: document.getElementById('profilePhone')?.value.trim(),
          bio: document.getElementById('profileBio')?.value.trim(),
          qualifications: document.getElementById('profileQualifications')?.value.trim(),
          competencies: window.REAccountData.splitTags(document.getElementById('profileCompetencies')?.value),
          social_links: {
            linkedin: document.getElementById('socialLinkedin')?.value.trim(),
            instagram: document.getElementById('socialInstagram')?.value.trim(),
            website: document.getElementById('socialWebsite')?.value.trim(),
            whatsapp: document.getElementById('socialWhatsapp')?.value.trim(),
          },
          signature_html: document.getElementById('profileSignatureEditor')?.innerHTML || '',
          avatar_data_url: pendingAvatarDataUrl || currentProfile?.avatar_data_url || '',
          tenant_links: currentProfile?.tenant_links || [],
        },
      };

      const data = await window.REAccountData.saveProfileState(payload);
      currentUser = Object.assign({}, currentUser || {}, data.user || {}, { name: name });
      currentProfile = data.profile || payload.profile;
      currentPreferences = data.preferences || currentPreferences;
      pendingAvatarDataUrl = '';
      window.REShared?.storeAuthUser?.(currentUser);
      renderProfileState();
      showToast('Perfil atualizado.', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar perfil.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
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
    const originalLabel = button ? button.textContent : 'Atualizar senha';
    if (button) { button.disabled = true; button.textContent = 'Atualizando...'; }

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
      if (button) { button.disabled = false; button.textContent = originalLabel; }
    }
  };

  async function initPerfil() {
    const session = await window.REShared.verifySession({ timeoutMs: 55000 }).catch(function () {
      return { ok: false, status: 0 };
    });

    if (!session.ok || !session.user) {
      window.REShared.redirectToRoute('login');
      return;
    }

    currentUser = session.user;
    window.REShared.applyPortalAccountShell(currentUser, { section: 'home' });
    window.REAccountData.ensureSignatureEditor('profileSignatureEditor', 'signatureToolbar');

    try {
      const profileState = await window.REAccountData.fetchProfileState();
      currentUser = Object.assign({}, currentUser || {}, profileState.user || {});
      currentProfile = profileState.profile || {};
      currentPreferences = profileState.preferences || {};
      if (!currentUser.isAdmin) {
        tenantMembers = await window.REAccountData.listCompanyMembers().catch(function () { return []; });
      }
      renderProfileState();
      window.REAccountData.bootFreshchat(currentUser).catch(function (error) {
        console.warn('[Freshchat:perfil]', error?.message || error);
      });
    } catch (_error) {
      showToast('Não foi possível carregar o perfil completo.', 'error');
    }

    document.getElementById('profileCompetencies')?.addEventListener('input', renderCompetencyPreview);

    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initPerfil();
  } else {
    window.addEventListener('load', initPerfil, { once: true });
  }

  console.info('[RE:perfil-init] loaded');
})();
