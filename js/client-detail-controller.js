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

  function getRequestedTab() {
    return new URLSearchParams(window.location.search).get('tab') || 'overview';
  }

  function getBodyElement() {
    return document.getElementById('clientPageBody') || document.getElementById('drawerBody');
  }

  function getTitleElement() {
    return document.getElementById('clientPageTitle') || document.getElementById('drawerTitle');
  }

  function getSubtitleElement() {
    return document.getElementById('clientPageSubtitle') || document.getElementById('drawerSub');
  }

  function getCurrentTabNavElement() {
    return document.getElementById('clientPageTabs') || null;
  }

  function setActionLinks(clientId) {
    const adminBackLink = document.getElementById('clientPageBackLink');
    if (adminBackLink) {
      adminBackLink.href = '/admin';
    }
    const docsLink = document.getElementById('clientDocsShortcut');
    if (docsLink) docsLink.href = '#docs';
    const agendaLink = document.getElementById('clientAgendaShortcut');
    if (agendaLink) agendaLink.href = '#agenda';
  }

  function clientPageSearch(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('clientGlobalSearch');
    const query = String(input?.value || '').trim();
    if (!query) {
      input?.focus();
      return false;
    }
    window.location.href = '/admin?q=' + encodeURIComponent(query);
    return false;
  }

  function updatePageHeader(user) {
    const title = getTitleElement();
    const subtitle = getSubtitleElement();
    if (title) title.textContent = user.company || user.name || 'Cliente';
    if (subtitle) {
      subtitle.textContent = user.email + (user.freshdeskTicketId ? ' · acompanhamento ativo' : '');
    }
    const summaryName = document.getElementById('clientSummaryName');
    const summaryMeta = document.getElementById('clientSummaryMeta');
    const statusBadge = document.getElementById('clientSummaryStatus');
    if (summaryName) summaryName.textContent = user.company || user.name || 'Cliente';
    if (summaryMeta) summaryMeta.textContent = user.email || '';
    if (statusBadge && detailState.currentClientData?.onboarding) {
      const status = STATUS_LABELS[detailState.currentClientData.onboarding.status] || STATUS_LABELS.nao_iniciado;
      statusBadge.className = 'badge ' + status.cls;
      statusBadge.textContent = status.label;
    }
  }

  function normalizeClientId(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized === 'null' || normalized === 'undefined' || normalized === 'NaN') return null;
    return normalized;
  }

  const detailState = window.REClientDetailState || { currentClientId: null, currentClientData: null };
  detailState.currentClientId = normalizeClientId(detailState.currentClientId)
    || normalizeClientId(new URLSearchParams(window.location.search).get('id'));
  window.REClientDetailState = detailState;
  Object.defineProperty(window, '_currentClientId', {
    configurable: true,
    get() { return detailState.currentClientId; },
    set(value) { detailState.currentClientId = value; },
  });
  Object.defineProperty(window, '_currentClientData', {
    configurable: true,
    get() { return detailState.currentClientData; },
    set(value) { detailState.currentClientData = value; },
  });
  var _drawerMsgPollTimer = null;

  function _stopDrawerMsgPoll() {
    if (_drawerMsgPollTimer) {
      clearInterval(_drawerMsgPollTimer);
      _drawerMsgPollTimer = null;
    }
  }

  async function _drawerMsgPollTick() {
    if (!detailState.currentClientId) return;
    const thread = document.getElementById('adminMsgThread');
    if (!thread) {
      _stopDrawerMsgPoll();
      return;
    }

    try {
      const response = await fetch('/api/admin/client/' + detailState.currentClientId, { headers: authH() });
      if (!response.ok) return;
      const data = await response.json();
      const messages = data.messages || [];
      const previousMessages = detailState.currentClientData?.messages || [];
      const hasChanged = messages.length !== previousMessages.length
        || (messages.length && messages[messages.length - 1].ts !== previousMessages.slice(-1)[0]?.ts);
      if (!hasChanged) return;

      detailState.currentClientData = data;
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

    detailState.currentClientData = payload;
    detailState.currentClientId = normalizeClientId(id);
    updatePageHeader(payload.user || {});
    setActionLinks(id);
    return payload;
  }

  async function openClient(id) {
    id = normalizeClientId(id);
    if (!id) return;
    if (!isClientPageMode()) {
      const nextTab = arguments.length > 1 && arguments[1] ? String(arguments[1]) : 'overview';
      window.location.href = '/cliente?id=' + encodeURIComponent(id) + '&tab=' + encodeURIComponent(nextTab);
      return;
    }

    const body = getBodyElement();
    const title = getTitleElement();
    if (title) title.textContent = 'Carregando...';
    if (body) body.innerHTML = '<p class="acdd-empty-copy">Carregando dados...</p>';

    const payload = await loadClientData(id);
    if (!payload) return;
    switchClientDetailTab(getRequestedTab());
  }

  function closeClientDetail() {
    _stopDrawerMsgPoll();
    detailState.currentClientId = null;
    detailState.currentClientData = null;
    if (isClientPageMode()) {
      window.location.href = '/admin';
    }
  }

  function switchClientDetailTab(tab, element) {
    _stopDrawerMsgPoll();

    document.querySelectorAll('.client-page-tab').forEach(function (node) {
      node.classList.remove('active');
    });
    if (element) {
      element.classList.add('active');
    } else {
      const nav = getCurrentTabNavElement();
      nav?.querySelector('[data-client-tab="' + tab + '"]')?.classList.add('active');
    }

    renderClientDetailTab(tab);
    if (tab === 'messages') {
      _drawerMsgPollTimer = setInterval(_drawerMsgPollTick, 10000);
    }
  }

  async function renderClientDetailTab(tab) {
    if (!detailState.currentClientData) return;
    const body = getBodyElement();
    const user = detailState.currentClientData.user || {};
    const onboarding = detailState.currentClientData.onboarding || {};
    const tasks = detailState.currentClientData.tasks || [];
    const plan = detailState.currentClientData.plan || {};
    const messages = detailState.currentClientData.messages || [];

    if (window.REClientDetailPrimaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: detailState.currentClientId,
    })) {
      return;
    }

    if (await window.REClientDetailSecondaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: detailState.currentClientId,
      currentClientData: detailState.currentClientData,
    })) {
      return;
    }

    if (await window.REClientDetailTertiaryTabs?.render?.(tab, {
      body: body,
      user: user,
      onboarding: onboarding,
      tasks: tasks,
      plan: plan,
      messages: messages,
      currentClientId: detailState.currentClientId,
      currentClientData: detailState.currentClientData,
    })) {
      return;
    }

    if (tab === 'data') {
      window.REClientDetailDataTab.render({ body: body, user: user, onboarding: onboarding });
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
    window.startAdminNotifPolling?.();

    const params = new URLSearchParams(window.location.search);
    const clientId = normalizeClientId(params.get('id'));
    if (!clientId) {
      const body = getBodyElement();
      if (body) {
        body.innerHTML = '<div class="empty-state"><p>Nenhum cliente selecionado.</p></div>';
      }
      return;
    }

    await openClient(clientId);
  }

  window.REClientDetail = {
    close: closeClientDetail,
    getState() {
      return {
        currentClientData: detailState.currentClientData,
        currentClientId: detailState.currentClientId,
      };
    },
    init: initClientPage,
    open: openClient,
    renderTab: renderClientDetailTab,
    switchTab: switchClientDetailTab,
  };
  window.logClientDetailDiagnostic = logDrawerDiagnostic;
  window.readClientDetailResponse = readDrawerResponse;
  window.openClient = openClient;
  window.closeClientDetail = closeClientDetail;
  window.switchClientDetailTab = switchClientDetailTab;
  window.renderClientDetailTab = renderClientDetailTab;
  window.initClientPage = initClientPage;
  window.logDrawerDiagnostic = logDrawerDiagnostic;
  window.readDrawerResponse = readDrawerResponse;
  window.closeDrawer = closeClientDetail;
  window.switchDrawerTab = switchClientDetailTab;
  window.renderDrawerTab = renderClientDetailTab;
  window.clientPageSearch = clientPageSearch;

  document.addEventListener('DOMContentLoaded', function () {
    initClientPage().catch(function (error) {
      console.error('[CLIENT PAGE INIT]', error.message);
      showToast('Erro ao carregar a página do cliente.', 'error');
    });
  });

  console.info('[RE:client-detail-controller] loaded');
})();
