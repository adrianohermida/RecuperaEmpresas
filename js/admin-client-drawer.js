'use strict';

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

function logDrawerDiagnostic(tabLabel, details = {}) {
  const {
    route,
    method = 'GET',
    source = 'fetch',
    expectedKeys = [],
    actualPayload,
    response,
    note,
    error,
  } = details;
  const actualKeys = actualPayload && typeof actualPayload === 'object' && !Array.isArray(actualPayload)
    ? Object.keys(actualPayload)
    : [];
  const missingKeys = expectedKeys.filter(key => !actualKeys.includes(key));
  const prefix = error || (response && !response.ok) ? '[CLIENT DRAWER ERROR]' : '[CLIENT DRAWER DEBUG]';
  const title = `${prefix} ${tabLabel}`;
  const logger = error || (response && !response.ok) ? console.error : console.info;
  if (typeof console.groupCollapsed === 'function') console.groupCollapsed(title);
  logger('rota:', route || '(cache local)');
  logger('metodo:', method);
  logger('fonte:', source);
  if (response) logger('status:', response.status, response.statusText || '');
  if (note) logger('como deveria ser:', note);
  if (expectedKeys.length) logger('chaves esperadas:', expectedKeys);
  if (actualKeys.length) logger('chaves recebidas:', actualKeys);
  if (missingKeys.length) logger('chaves ausentes:', missingKeys);
  if (error) logger('erro:', error);
  logger('como esta:', drawerDebugSummarize(actualPayload));
  logger('payload bruto:', actualPayload);
  if (typeof console.groupEnd === 'function') console.groupEnd();
}

async function readDrawerResponse(tabLabel, route, res, expectedKeys = [], note = '') {
  const payload = await readAdminResponse(res);
  logDrawerDiagnostic(tabLabel, {
    route,
    response: res,
    expectedKeys,
    actualPayload: payload,
    note,
  });
  return payload;
}

var _currentClientId = null;
var _currentClientData = null;
var _drawerMsgPollTimer = null;

function _stopDrawerMsgPoll() {
  if (_drawerMsgPollTimer) { clearInterval(_drawerMsgPollTimer); _drawerMsgPollTimer = null; }
}

async function _drawerMsgPollTick() {
  if (!_currentClientId) return;
  const thread = document.getElementById('adminMsgThread');
  if (!thread) { _stopDrawerMsgPoll(); return; }
  try {
    const r = await fetch(`/api/admin/client/${_currentClientId}`, { headers: authH() });
    if (!r.ok) return;
    const data = await r.json();
    const msgs = data.messages || [];
    if (msgs.length !== (_currentClientData?.messages?.length || 0) ||
        (msgs.length && msgs[msgs.length-1].ts !== (_currentClientData?.messages?.slice(-1)[0]?.ts))) {
      _currentClientData = data;
      thread.innerHTML = !msgs.length
        ? '<div class="empty-state"><p>Nenhuma mensagem.</p></div>'
        : msgs.map(m=>`<div>
            <div class="message-bubble from-${m.fromRole||m.from}">
              <div class="message-from">${(m.fromRole||m.from)==='admin'?'Recupera Empresas':m.fromName||'Cliente'}</div>
              ${m.text}
              <div class="message-ts">${new Date(m.ts).toLocaleString('pt-BR')}</div>
            </div>
          </div>`).join('');
      thread.scrollTop = thread.scrollHeight;
    }
  } catch {}
}

async function openClient(id) {
  _currentClientId = id;
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('clientDrawer').classList.add('open');
  document.getElementById('drawerTitle').textContent = 'Carregando...';
  document.getElementById('drawerBody').innerHTML = '<p class="acdd-empty-copy">Carregando dados...</p>';

  const route = `/api/admin/client/${id}`;
  const res = await fetch(route, { headers: authH() });
  const payload = await readDrawerResponse('Base do Drawer', route, res, ['user', 'onboarding', 'tasks', 'plan', 'messages'], 'Deveria retornar a estrutura completa do drawer do cliente, com user, onboarding, tasks, plan e messages.');
  if (!res.ok) { showToast(payload.error || 'Erro ao carregar cliente.', 'error'); return; }

  _currentClientData = payload;
  const { user } = _currentClientData;

  document.getElementById('drawerTitle').textContent = user.company || user.name;
  document.getElementById('drawerSub').textContent = user.email + (user.freshdeskTicketId ? ` · Ticket #${user.freshdeskTicketId}` : '');

  document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.drawer-tab').classList.add('active');
  renderDrawerTab('overview');
}

function closeDrawer() {
  _stopDrawerMsgPoll();
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('clientDrawer').classList.remove('open');
  _currentClientId = null;
  _currentClientData = null;
}

function switchDrawerTab(tab, el) {
  _stopDrawerMsgPoll();
  document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderDrawerTab(tab);
  if (tab === 'messages') {
    _drawerMsgPollTimer = setInterval(_drawerMsgPollTick, 10000);
  }
}

async function renderDrawerTab(tab) {
  const body = document.getElementById('drawerBody');
  const { user, onboarding, tasks, plan, messages } = _currentClientData;
  if (window.REAdminDrawerPrimaryTabs?.render?.(tab, {
    body,
    user,
    onboarding,
    tasks,
    plan,
    messages,
    currentClientId: _currentClientId,
  })) {
    return;
  }

  if (await window.REAdminDrawerSecondaryTabs?.render?.(tab, {
    body,
    user,
    onboarding,
    tasks,
    plan,
    messages,
    currentClientId: _currentClientId,
    currentClientData: _currentClientData,
  })) {
    return;
  }

  if (await window.REAdminDrawerTertiaryTabs?.render?.(tab, {
    body,
    user,
    onboarding,
    tasks,
    plan,
    messages,
    currentClientId: _currentClientId,
    currentClientData: _currentClientData,
  })) {
    return;
  }

  if (tab === 'data') {
    window.REAdminDrawerDataTab.render({ body, user, onboarding });
  }
}

console.info('[RE:admin-client-drawer] loaded');