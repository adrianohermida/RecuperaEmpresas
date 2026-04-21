'use strict';

(function () {
  let currentUser = null;
  let currentProfile = null;
  let currentPreferences = {};
  let tenantMembers = [];

  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json' };
  }

  function canManageMembers() {
    return currentUser && !currentUser.isAdmin && !currentUser.company_id;
  }

  function syncHeader() {
    const displayName = currentUser?.name || currentUser?.company || currentUser?.email || 'Usuário';
    document.getElementById('userName').textContent = displayName;
    document.getElementById('dropupUserName').textContent = displayName;
    document.getElementById('dropupUserEmail').textContent = currentUser?.email || 'Sem e-mail';
    document.getElementById('settingsHeroName').textContent = displayName;
    document.getElementById('settingsHeroRole').textContent = currentUser?.isAdmin
      ? 'Administrador global'
      : currentUser?.company_id
        ? 'Membro do tenant'
        : 'Titular do tenant';
    document.getElementById('settingsHeroEmail').textContent = currentUser?.email || 'Sem e-mail';
    document.getElementById('settingsAccessLabel').textContent = currentUser?.isAdmin
      ? 'Global'
      : currentUser?.role || (currentUser?.company_id ? 'visualizador' : 'titular');
    window.REAccountData.renderAvatar(document.getElementById('userAvatar'), currentProfile?.avatar_data_url || '', displayName);
  }

  function applyPrefsToUI(prefs) {
    ['notifMessages', 'notifNewClients', 'notifSteps', 'prefCompactTable', 'prefShowProgress', 'prefOpenKanbanByDefault', 'prefCollapseFiltersOnMobile'].forEach(function (id) {
      const element = document.getElementById(id);
      if (!element) return;
      element.checked = !!prefs[id];
    });
  }

  function renderMembers() {
    const container = document.getElementById('tenantMembersList');
    const openInviteButton = document.getElementById('openInviteMemberBtn');
    if (!container) return;

    document.getElementById('settingsMembersCount').textContent = String(tenantMembers.length || 0);

    if (currentUser?.isAdmin) {
      container.innerHTML = '<div class="account-empty-state">A gestão de equipe aparece quando você navega no contexto de um tenant cliente.</div>';
      if (openInviteButton) openInviteButton.style.display = 'none';
      return;
    }

    if (!tenantMembers.length) {
      container.innerHTML = '<div class="account-empty-state">Nenhum membro vinculado a este tenant ainda.</div>';
    } else {
      container.innerHTML = tenantMembers.map(function (member) {
        var status = member.active === false ? 'Suspenso' : 'Ativo';
        var actions = canManageMembers()
          ? '<div class="tenant-member-actions">'
            + '<button class="btn btn-secondary btn-sm" type="button" onclick="editTenantMember(\'' + member.id + '\')">Editar</button>'
            + '<button class="btn btn-secondary btn-sm" type="button" onclick="resetTenantMemberPassword(\'' + member.id + '\')">Redefinir senha</button>'
            + '<button class="btn btn-danger-outline btn-sm" type="button" onclick="removeTenantMember(\'' + member.id + '\')">Remover</button>'
            + '</div>'
          : '';
        return '<article class="tenant-member-card">'
          + '<div>'
          + '  <div class="tenant-member-name">' + (member.name || member.email || 'Membro') + '</div>'
          + '  <div class="tenant-member-meta">' + (member.email || 'Sem e-mail') + ' · ' + (member.role || 'visualizador') + ' · ' + status + '</div>'
          + '</div>'
          + actions
          + '</article>';
      }).join('');
    }

    if (openInviteButton) openInviteButton.style.display = canManageMembers() ? 'inline-flex' : 'none';
  }

  async function reloadMembers() {
    if (currentUser?.isAdmin) {
      tenantMembers = [];
      renderMembers();
      return;
    }
    tenantMembers = await window.REAccountData.listCompanyMembers().catch(function () { return []; });
    renderMembers();
  }

  window.saveSetting = async function (key, value) {
    const previous = Object.assign({}, currentPreferences);
    currentPreferences[key] = value;
    applyPrefsToUI(currentPreferences);
    try {
      const data = await window.REAccountData.saveProfileState({ preferences: { [key]: value } });
      currentPreferences = Object.assign({}, currentPreferences, data.preferences || {});
      showToast('Preferência salva.', 'success', 1500);
    } catch (error) {
      currentPreferences = previous;
      applyPrefsToUI(previous);
      showToast(error.message || 'Erro ao salvar preferência.', 'error');
    }
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

  function buildMemberForm(member) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<div class="page-field-row full">',
      '  <div class="form-group">',
      '    <label class="form-label" for="memberNameInput">Nome</label>',
      '    <input class="form-input" id="memberNameInput" type="text" value="' + (member?.name || '') + '"/>',
      '  </div>',
      '</div>',
      '<div class="page-field-row full">',
      '  <div class="form-group">',
      '    <label class="form-label" for="memberEmailInput">E-mail</label>',
      '    <input class="form-input" id="memberEmailInput" type="email" value="' + (member?.email || '') + '" ' + (member ? 'readonly' : '') + '/>',
      '  </div>',
      '</div>',
      '<div class="page-field-row">',
      '  <div class="form-group">',
      '    <label class="form-label" for="memberRoleInput">Função</label>',
      '    <select class="form-input" id="memberRoleInput">',
      '      <option value="operacional">Operacional</option>',
      '      <option value="financeiro">Financeiro</option>',
      '      <option value="contador">Contador</option>',
      '      <option value="visualizador">Visualizador</option>',
      '    </select>',
      '  </div>',
      '  <div class="form-group">',
      '    <label class="form-label" for="memberActiveInput">Status</label>',
      '    <select class="form-input" id="memberActiveInput">',
      '      <option value="true">Ativo</option>',
      '      <option value="false">Suspenso</option>',
      '    </select>',
      '  </div>',
      '</div>',
      (!member ? '<div class="page-field-row full"><div class="form-group"><label class="form-label" for="memberPasswordInput">Senha inicial</label><input class="form-input" id="memberPasswordInput" type="password" placeholder="Mínimo 8 caracteres"/></div></div>' : '')
    ].join('');
    wrapper.querySelector('#memberRoleInput').value = member?.role || 'operacional';
    if (member) wrapper.querySelector('#memberActiveInput').value = member.active === false ? 'false' : 'true';
    return wrapper;
  }

  window.openInviteMemberDrawer = function () {
    if (!canManageMembers()) return;
    var form = buildMemberForm(null);
    window.REPortalUI.useDrawer({
      title: 'Adicionar membro',
      subtitle: 'Convide um usuário para operar no mesmo tenant.',
      content: form,
      actions: [{
        label: 'Salvar convite',
        tone: 'primary',
        onClick: async function () {
          var password = form.querySelector('#memberPasswordInput').value.trim();
          if (password.length < 8) {
            showToast('A senha inicial deve ter no mínimo 8 caracteres.', 'error');
            return false;
          }
          await window.REAccountData.inviteCompanyMember({
            name: form.querySelector('#memberNameInput').value.trim(),
            email: form.querySelector('#memberEmailInput').value.trim(),
            role: form.querySelector('#memberRoleInput').value,
            password: password,
          });
          await reloadMembers();
          showToast('Membro convidado.', 'success');
          return true;
        }
      }]
    });
  };

  window.editTenantMember = function (memberId) {
    if (!canManageMembers()) return;
    var member = tenantMembers.find(function (item) { return item.id === memberId; });
    if (!member) return;
    var form = buildMemberForm(member);
    window.REPortalUI.useModal({
      title: 'Editar membro',
      subtitle: member.email || '',
      content: form,
      actions: [{
        label: 'Salvar alterações',
        tone: 'primary',
        onClick: async function () {
          await window.REAccountData.updateCompanyMember(memberId, {
            name: form.querySelector('#memberNameInput').value.trim(),
            role: form.querySelector('#memberRoleInput').value,
            active: form.querySelector('#memberActiveInput').value === 'true',
          });
          await reloadMembers();
          showToast('Membro atualizado.', 'success');
          return true;
        }
      }]
    });
  };

  window.resetTenantMemberPassword = function (memberId) {
    if (!canManageMembers()) return;
    var member = tenantMembers.find(function (item) { return item.id === memberId; });
    if (!member) return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="form-group"><label class="form-label" for="resetPasswordInput">Nova senha para ' + (member.name || member.email || 'membro') + '</label><input class="form-input" id="resetPasswordInput" type="password" placeholder="Mínimo 8 caracteres"/></div>';
    window.REPortalUI.useModal({
      title: 'Redefinir senha',
      content: wrapper,
      actions: [{
        label: 'Confirmar',
        tone: 'primary',
        onClick: async function () {
          var password = wrapper.querySelector('#resetPasswordInput').value.trim();
          if (password.length < 8) {
            showToast('Informe uma senha com pelo menos 8 caracteres.', 'error');
            return false;
          }
          await window.REAccountData.resetCompanyMemberPassword(memberId, password);
          showToast('Senha redefinida.', 'success');
          return true;
        }
      }]
    });
  };

  window.removeTenantMember = async function (memberId) {
    if (!canManageMembers()) return;
    if (!confirm('Remover este membro do tenant?')) return;
    try {
      await window.REAccountData.deleteCompanyMember(memberId);
      await reloadMembers();
      showToast('Membro removido.', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao remover membro.', 'error');
    }
  };

  async function initConfiguracoes() {
    const session = await window.REShared.verifySession({ timeoutMs: 55000 }).catch(function () {
      return { ok: false, status: 0 };
    });

    if (!session.ok || !session.user) {
      window.REShared.redirectToRoute('login');
      return;
    }

    currentUser = session.user;
    window.REShared.applyPortalAccountShell(currentUser, { section: 'home' });

    try {
      const profileState = await window.REAccountData.fetchProfileState();
      currentUser = Object.assign({}, currentUser || {}, profileState.user || {});
      currentProfile = profileState.profile || {};
      currentPreferences = profileState.preferences || {};
      syncHeader();
      applyPrefsToUI(currentPreferences);
      await reloadMembers();
    } catch (_error) {
      showToast('Não foi possível carregar as configurações completas.', 'error');
    }

    document.getElementById('authGuard')?.remove();
  }

  if (document.readyState === 'complete') {
    initConfiguracoes();
  } else {
    window.addEventListener('load', initConfiguracoes, { once: true });
  }

  console.info('[RE:configuracoes-init] loaded');
})();
