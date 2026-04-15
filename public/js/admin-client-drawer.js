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
  document.getElementById('drawerBody').innerHTML = '<p style="color:var(--text-muted);padding:20px 0;">Carregando dados...</p>';

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
    const d = onboarding.data || {};
    const score = calcRecoveryScore(d, onboarding);
    const insights = calcInsights(d);
    const suggests = calcSuggestions(d, score);
    const scoreColor = score >= 70 ? '#059669' : score >= 50 ? '#F59E0B' : score >= 30 ? '#EF4444' : '#DC2626';
    const scoreLabel = score >= 70 ? 'Bom' : score >= 50 ? 'Moderado' : score >= 30 ? 'Atenção' : 'Crítico';
    const pct = onboarding.completed ? 100 : Math.round(((onboarding.step||1)-1)/14*100);
    const empresa = d.empresa || {};

    const statusCls = score >= 70 ? 'badge-green' : score >= 50 ? 'badge-amber' : 'badge-red';
    const statusLabel = score >= 70 ? 'Estável' : score >= 50 ? 'Atenção' : 'Crítico';

    body.innerHTML = `
      <div class="exec-header">
        <div class="exec-company">${empresa.razaoSocial || user.company || '—'}</div>
        <div class="exec-cnpj">CNPJ: ${empresa.cnpj || '—'} &nbsp;·&nbsp; <span class="badge ${statusCls}" style="font-size:11px;">${statusLabel}</span></div>
        <div class="exec-kpis">
          <div class="exec-kpi">
            <div class="exec-kpi-val" style="color:${scoreColor};">${score}%</div>
            <div class="exec-kpi-lbl">Score de Recuperação</div>
            <div class="exec-kpi-sub" style="color:${scoreColor};">${scoreLabel}</div>
          </div>
          <div class="exec-kpi exec-divider" style="padding-left:20px;">
            <div class="exec-kpi-val">${pct}%</div>
            <div class="exec-kpi-lbl">Onboarding</div>
            <div class="exec-kpi-sub" style="color:${onboarding.completed?'#34D399':'#93C5FD'};">${onboarding.completed?'Concluído':'Em andamento'}</div>
          </div>
          <div class="exec-kpi exec-divider" style="padding-left:20px;">
            <div class="exec-kpi-val">${calcTotalDebt(d.dividas)}</div>
            <div class="exec-kpi-lbl">Total dívidas</div>
          </div>
        </div>
      </div>

      <div class="data-tab-bar">
        ${['Resumo','Financeiro','Dívidas','Operação','Crise','Estratégia','Sócios'].map((t,i)=>
          `<button class="data-tab-btn${i===0?' active':''}" onclick="switchDataTab(${i},this)">${t}</button>`
        ).join('')}
      </div>

      <div id="dataTabContent"></div>

      ${insights.length ? `
      <div class="insights-box">
        <div class="insights-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Pontos de atenção identificados
        </div>
        <ul class="insights-list">${insights.map(i=>`<li>${i}</li>`).join('')}</ul>
      </div>` : ''}

      ${suggests.length ? `
      <div class="suggestions-box">
        <div class="suggestions-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Sugestões estratégicas
        </div>
        <ul class="suggestions-list">${suggests.map(s=>`<li>${s}</li>`).join('')}</ul>
      </div>` : ''}
    `;

    window._execData = { d, user, onboarding };
    switchDataTab(0, body.querySelector('.data-tab-btn'));
  }
}