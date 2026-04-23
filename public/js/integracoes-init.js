'use strict';

(function () {
  function authH() {
    if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
    return { 'Content-Type': 'application/json' };
  }

  function showToast(msg, type, duration) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + (type || '');
    setTimeout(function () { toast.className = 'toast'; }, duration || 3000);
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function renderSupportIdentityStatus(data) {
    var container = document.getElementById('supportDiagnosticsContainer');
    if (!container) return;

    var ready = !!(data && data.freshchatExternalId && data.hasJwtSecret);
    var html = [
      '<div class="diagnostics-item diagnostics-status-ok">',
      '  <span class="diagnostics-label">Usuario identificado</span>',
      '  <span class="diagnostics-value">' + escapeHtml(data.email || 'Nao informado') + '</span>',
      '</div>',
      '<div class="diagnostics-item ' + (data.freshchatExternalId ? 'diagnostics-status-ok' : 'diagnostics-status-error') + '">',
      '  <span class="diagnostics-label">Vinculo de atendimento</span>',
      '  <span class="diagnostics-value">' + escapeHtml(data.freshchatExternalId ? 'Ativo' : 'Pendente') + '</span>',
      '</div>',
      '<div class="diagnostics-item ' + (data.hasJwtSecret ? 'diagnostics-status-ok' : 'diagnostics-status-error') + '">',
      '  <span class="diagnostics-label">Seguranca da sessao</span>',
      '  <span class="diagnostics-value">' + escapeHtml(data.secretSource || 'Nao disponivel') + '</span>',
      '</div>',
      '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.05);font-size:12px;color:var(--text-muted);">',
      ready
        ? 'Canal pronto para uso. O consultor pode abrir o atendimento com a identidade sincronizada.'
        : 'Ainda ha configuracoes pendentes. Revise o vinculo do usuario e tente atualizar novamente.',
      '</div>'
    ].join('');

    container.innerHTML = html;
    var badge = document.getElementById('supportStatusBadge');
    if (badge) {
      badge.textContent = ready ? 'Ativo' : 'Atencao';
      badge.className = 'integration-badge ' + (ready ? 'integration-badge-active' : 'integration-badge-inactive');
    }
  }

  async function loadSupportIdentityStatus() {
    var container = document.getElementById('supportDiagnosticsContainer');
    var btn = document.getElementById('supportRefreshBtn');
    if (!container) return;

    btn?.setAttribute('disabled', 'disabled');
    container.innerHTML = '<div class="diagnostics-loading"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Carregando status...</div>';

    try {
      var response = await fetch('/api/admin/freshchat/identity', {
        method: 'GET',
        headers: authH()
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sua sessao expirou. Entre novamente para continuar.');
        throw new Error('Nao foi possivel consultar o status da conexao.');
      }

      var data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Nao foi possivel consultar o status da conexao.');

      renderSupportIdentityStatus(data);
      showToast('Status atualizado.', 'success', 1800);
    } catch (error) {
      container.innerHTML = '<div style="color:var(--error);font-size:13px;">' + escapeHtml(error.message) + '</div>';
      showToast('Erro ao carregar o status.', 'error');
    } finally {
      btn?.removeAttribute('disabled');
    }
  }

  function renderSyncHistory() {
    var container = document.getElementById('syncHistoryContainer');
    if (!container) return;

    var activities = [
      { time: new Date(Date.now() - 2 * 60000).toLocaleString('pt-BR'), type: 'Atendimento integrado', status: 'success', message: 'Status consultado com sucesso' },
      { time: new Date(Date.now() - 18 * 60000).toLocaleString('pt-BR'), type: 'Agenda conectada', status: 'error', message: 'Conexao ainda nao concluida' },
      { time: new Date(Date.now() - 70 * 60000).toLocaleString('pt-BR'), type: 'Atendimento integrado', status: 'success', message: 'Identidade sincronizada' }
    ];

    container.innerHTML = activities.map(function (item) {
      var statusClass = item.status === 'success' ? 'success' : 'error';
      var statusLabel = item.status === 'success' ? 'OK' : 'Pendente';
      return [
        '<div class="history-item">',
        '  <div>',
        '    <div style="font-weight:500;color:var(--text);">' + escapeHtml(item.type) + '</div>',
        '    <div class="history-item-time">' + escapeHtml(item.time) + '</div>',
        '  </div>',
        '  <span class="history-item-status ' + statusClass + '">' + statusLabel + ' - ' + escapeHtml(item.message) + '</span>',
        '</div>'
      ].join('');
    }).join('');
  }

  function connectCalendar() {
    showToast('A conexao com agenda sera liberada na proxima etapa.', 'info', 2600);
  }

  function testCalendarConnection() {
    showToast('Nenhuma agenda conectada para testar neste momento.', 'info', 2600);
  }

  async function initIntegracoes() {
    var session = await window.REShared.verifySession({ timeoutMs: 55000 }).catch(function () {
      return { ok: false, status: 0 };
    });

    if (!session.ok || !session.user) {
      window.REShared.redirectToRoute('login');
      return;
    }

    var user = session.user;
    window.REShared.applyPortalAccountShell(user, { section: 'home' });
    window.REShared.renderPortalSidebar({ containerId: 'portalSidebarNav', user: user, activeHref: '/integracoes' });

    document.getElementById('dropupUserName').textContent = user.name || user.company || user.email || 'Usuario';
    document.getElementById('dropupUserEmail').textContent = user.email || 'Sem e-mail';
    document.getElementById('authGuard')?.remove();

    loadSupportIdentityStatus();
    renderSyncHistory();
  }

  window.loadSupportIdentityStatus = loadSupportIdentityStatus;
  window.connectCalendar = connectCalendar;
  window.testCalendarConnection = testCalendarConnection;

  if (document.readyState === 'complete') {
    initIntegracoes();
  } else {
    window.addEventListener('load', initIntegracoes, { once: true });
  }

  console.info('[RE:integracoes-init] loaded');
})();
