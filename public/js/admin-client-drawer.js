'use strict';

(function () {
  function drawerDebugSummarize(value) {
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    if (!value || typeof value !== 'object') return value;
    const keys = Object.keys(value);
    const summary = { type: 'object', keys };
    if (Array.isArray(value.bookings)) summary.bookings = value.bookings.length;
    if (Array.isArray(value.documents)) summary.documents = value.documents.length;
    if (Array.isArray(value.members)) summary.members = value.members.length;
    if (Array.isArray(value.tasks)) summary.tasks = value.tasks.length;
    if (Array.isArray(value.messages)) summary.messages = value.messages.length;
    if (Array.isArray(value.chapters)) summary.chapters = value.chapters.length;
    if (Array.isArray(value.comments)) summary.comments = value.comments.length;
    return summary;
  }

  function logDrawerDiagnostic(tabLabel, details) {
    const info = details || {};
    const expectedKeys = info.expectedKeys || [];
    const actualPayload = info.actualPayload;
    const actualKeys = actualPayload && typeof actualPayload === 'object' && !Array.isArray(actualPayload)
      ? Object.keys(actualPayload)
      : [];
    const missingKeys = expectedKeys.filter(function (key) { return !actualKeys.includes(key); });
    const prefix = info.error || (info.response && !info.response.ok) ? '[CLIENT PAGE ERROR]' : '[CLIENT PAGE DEBUG]';
    const title = prefix + ' ' + tabLabel;
    const logger = info.error || (info.response && !info.response.ok) ? console.error : console.info;

    if (typeof console.groupCollapsed === 'function') console.groupCollapsed(title);
    logger('rota:', info.route || '(cache local)');
    logger('metodo:', info.method || 'GET');
    logger('fonte:', info.source || 'fetch');
    if (info.response) logger('status:', info.response.status, info.response.statusText || '');
    if (info.note) logger('como deveria ser:', info.note);
    if (expectedKeys.length) logger('chaves esperadas:', expectedKeys);
    if (actualKeys.length) logger('chaves recebidas:', actualKeys);
    if (missingKeys.length) logger('chaves ausentes:', missingKeys);
    if (info.error) logger('erro:', info.error);
    logger('como esta:', drawerDebugSummarize(actualPayload));
    logger('payload bruto:', actualPayload);
    if (typeof console.groupEnd === 'function') console.groupEnd();
  }

  async function readDrawerResponse(tabLabel, route, response, expectedKeys, note) {
    const payload = await readAdminResponse(response);
    logDrawerDiagnostic(tabLabel, {
      route: route,
      response: response,
      expectedKeys: expectedKeys || [],
      actualPayload: payload,
      note: note || '',
    });
    return payload;
  }

  function isClientPageMode() {
    return !!document.getElementById('clientPageLayout');
  }

  function getBodyElement() {
    return document.getElementById('drawerBody') || document.getElementById('clientPageBody');
  }

  function getTitleElement() {
    return document.getElementById('drawerTitle') || document.getElementById('clientPageTitle');
  }

  function getSubtitleElement() {
    return document.getElementById('drawerSub') || document.getElementById('clientPageSubtitle');
  }

  function getCurrentTabNavElement() {
    return document.getElementById('clientPageTabs') || null;
  }

  function setActionLinks(clientId) {
    const adminBackLink = document.getElementById('clientPageBackLink');
    if (adminBackLink) {
      adminBackLink.href = 'admin.html';
    }
    const docsLink = document.getElementById('clientDocsShortcut');
    if (docsLink) docsLink.href = '#docs';
    const agendaLink = document.getElementById('clientAgendaShortcut');
    if (agendaLink) agendaLink.href = '#agenda';
  }

  function updatePageHeader(user) {
    const title = getTitleElement();
    const subtitle = getSubtitleElement();
    if (title) title.textContent = user.company || user.name || 'Cliente';
    if (subtitle) {
      subtitle.textContent = user.email + (user.freshdeskTicketId ? ' · Ticket #' + user.freshdeskTicketId : '');
    }
    const summaryName = document.getElementById('clientSummaryName');
    const summaryMeta = document.getElementById('clientSummaryMeta');
    const statusBadge = document.getElementById('clientSummaryStatus');
    if (summaryName) summaryName.textContent = user.company || user.name || 'Cliente';
    if (summaryMeta) summaryMeta.textContent = user.email || '';
    if (statusBadge && window._currentClientData?.onboarding) {
      const status = STATUS_LABELS[window._currentClientData.onboarding.status] || STATUS_LABELS.nao_iniciado;
      statusBadge.className = 'badge ' + status.cls;
      statusBadge.textContent = status.label;
    }
  }

  var _currentClientId = null;
  var _currentClientData = null;
  var _drawerMsgPollTimer = null;

  function _stopDrawerMsgPoll() {
    if (_drawerMsgPollTimer) {
      clearInterval(_drawerMsgPollTimer);
      _drawerMsgPollTimer = null;
    }
  }

  async function _drawerMsgPollTick() {
    if (!_currentClientId) return;
    const thread = document.getElementById('adminMsgThread');
    if (!thread) {
      _stopDrawerMsgPoll();
      return;
    }

    try {
      const response = await fetch('/api/admin/client/' + _currentClientId, { headers: authH() });
      if (!response.ok) return;
      const data = await response.json();
      const messages = data.messages || [];
      const previousMessages = _currentClientData?.messages || [];
      const hasChanged = messages.length !== previousMessages.length
        || (messages.length && messages[messages.length - 1].ts !== previousMessages.slice(-1)[0]?.ts);
      if (!hasChanged) return;

      _currentClientData = data;
      thread.innerHTML = !messages.length
        ? '<div class="empty-state"><p>Nenhuma mensagem.</p></div>'
        : messages.map(function (message) {
            return `<div>
              <div class="message-bubble from-${message.fromRole || message.from}">
                <div class="message-from">${(message.fromRole || message.from) === 'admin' ? 'Recupera Empresas' : (message.fromName || 'Cliente')}</div>
                ${message.text}
                <div class="message-ts">${new Date(message.ts).toLocaleString('pt-BR')}</div>
              </div>
            </div>`;
          }).join('');
      thread.scrollTop = thread.scrollHeight;
    } catch (error) {}
  }

  async function loadClientData(id) {
    const route = '/api/admin/client/' + id;
    const response = await fetch(route, { headers: authH() });
    const payload = await readDrawerResponse(
      'Base da Página do Cliente',
      route,
      response,
      ['user', 'onboarding', 'tasks', 'plan', 'messages'],
      'Deveria retornar a estrutura completa do cliente, com user, onboarding, tasks, plan e messages.'
    );

    if (!response.ok) {
      showToast(payload.error || 'Erro ao carregar cliente.', 'error');
      return null;
    }

    _currentClientData = payload;
    _currentClientId = id;
    updatePageHeader(payload.user || {});
    setActionLinks(id);
    return payload;
  }

  async function openClient(id) {
    if (!id) return;
    if (!isClientPageMode()) {
      window.location.href = 'cliente.html?id=' + encodeURIComponent(id);
      return;
    }

    const body = getBodyElement();
    const title = getTitleElement();
    if (title) title.textContent = 'Carregando...';
    if (body) body.innerHTML = '<p class="acdd-empty-copy">Carregando dados...</p>';

    const payload = await loadClientData(id);
    if (!payload) return;
    switchDrawerTab('overview');
  }

  function closeDrawer() {
    _stopDrawerMsgPoll();
    if (isClientPageMode()) {
      window.location.href = 'admin.html';
      return;
    }
    document.getElementById('drawerOverlay')?.classList.remove('open');
    document.getElementById('clientDrawer')?.classList.remove('open');
    _currentClientId = null;
    _currentClientData = null;
  }

  function switchDrawerTab(tab, element) {
    _stopDrawerMsgPoll();

    document.querySelectorAll('.drawer-tab, .client-page-tab').forEach(function (node) {
      node.classList.remove('active');
    });
    if (element) {
      element.classList.add('active');
    } else {
      const nav = getCurrentTabNavElement();
      nav?.querySelector('[data-client-tab="' + tab + '"]')?.classList.add('active');
      document.querySelector('.drawer-tab[data-client-tab="' + tab + '"]')?.classList.add('active');
    }

    renderDrawerTab(tab);
    if (tab === 'messages') {
      _drawerMsgPollTimer = setInterval(_drawerMsgPollTick, 10000);
    }
  }

  async function renderDrawerTab(tab) {
    if (!_currentClientData) return;
    const body = getBodyElement();
    const user = _currentClientData.user || {};
    const onboarding = _currentClientData.onboarding || {};
    const tasks = _currentClientData.tasks || [];
    const plan = _currentClientData.plan || {};
    const messages = _currentClientData.messages || [];

    if (window.REAdminDrawerPrimaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: _currentClientId,
    })) {
      return;
    }

    if (await window.REAdminDrawerSecondaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: _currentClientId,
      currentClientData: _currentClientData,
    })) {
      return;
    }

    if (await window.REAdminDrawerTertiaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: _currentClientId,
      currentClientData: _currentClientData,
    })) {
      return;
    }

    if (tab === 'data') {
      window.REAdminDrawerDataTab.render({ body: body, user: user, onboarding: onboarding });
    }
  }

  async function initClientPage() {
    if (!isClientPageMode()) return;

    let verified;
    try {
      verified = await window.REShared.verifySession({ timeoutMs: 20000 });
    } catch (error) {
      window.REShared.redirectToRoute('login', { search: 'err=timeout' });
      return;
    }

    if (!verified.ok || !verified.user) {
      window.REShared.redirectToRoute('login');
      return;
    }
    if (!verified.user.isAdmin) {
      window.REShared.redirectToRoute('dashboard');
      return;
    }

    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropupUserName = document.getElementById('dropupUserName');
    const dropupUserEmail = document.getElementById('dropupUserEmail');
    if (userName) userName.textContent = verified.user.name || verified.user.email;
    if (userAvatar) userAvatar.textContent = (verified.user.name || verified.user.email || '?')[0].toUpperCase();
    if (dropupUserName) dropupUserName.textContent = verified.user.name || verified.user.email;
    if (dropupUserEmail) dropupUserEmail.textContent = verified.user.email || '';
    document.body.dataset.reAdminAuthReady = '1';
    document.getElementById('authGuard')?.remove();
    window.REAdminModal?.init?.();

    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('id');
    if (!clientId) {
      const body = getBodyElement();
      if (body) {
        body.innerHTML = '<div class="empty-state"><p>Nenhum cliente selecionado.</p></div>';
      }
      return;
    }

    await openClient(clientId);
  }

  window.logDrawerDiagnostic = logDrawerDiagnostic;
  window.readDrawerResponse = readDrawerResponse;
  window.openClient = openClient;
  window.closeDrawer = closeDrawer;
  window.switchDrawerTab = switchDrawerTab;
  window.renderDrawerTab = renderDrawerTab;
  window.initClientPage = initClientPage;

  document.addEventListener('DOMContentLoaded', function () {
    initClientPage().catch(function (error) {
      console.error('[CLIENT PAGE INIT]', error.message);
      showToast('Erro ao carregar a página do cliente.', 'error');
    });
  });

  console.info('[RE:admin-client-drawer] loaded');
})();
