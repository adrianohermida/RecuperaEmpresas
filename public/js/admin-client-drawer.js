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

function stepIconDone() {
  return `<span class="step-row-icon step-icon-done">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
  </span>`;
}

function stepIconActive() {
  return `<span class="step-row-icon step-icon-active">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
  </span>`;
}

function stepIconTodo() {
  return '<span class="step-row-icon step-icon-todo"></span>';
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

  if (tab === 'overview') {
    logDrawerDiagnostic('Visão Geral', {
      route: `/api/admin/client/${_currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['user', 'onboarding'],
      actualPayload: { user, onboarding },
      note: 'Deveria usar os dados já carregados da rota base do drawer e conter user e onboarding preenchidos.',
    });
    const step = onboarding.step || 1;
    const pct = onboarding.completed ? 100 : Math.round((step-1)/14*100);
    const st = STATUS_LABELS[onboarding.status] || STATUS_LABELS.nao_iniciado;
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="stat-card blue" style="margin:0;">
          <div class="stat-value" style="font-size:22px;">${pct}%</div>
          <div class="stat-label">Progresso onboarding</div>
        </div>
        <div class="stat-card ${onboarding.completed?'green':'amber'}" style="margin:0;">
          <div class="stat-value" style="font-size:22px;">${step}/14</div>
          <div class="stat-label">Etapas preenchidas</div>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <span class="badge ${st.cls}" style="font-size:13px;">${st.label}</span>
        ${onboarding.completedAt ? `<span style="font-size:12px;color:var(--text-muted);margin-left:8px;">Concluído em ${onboarding.completedAt}</span>` : ''}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:8px;">Informações do cliente</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          ${[['Nome',user.name],['E-mail',user.email],['Empresa',user.company||'—'],['Cadastrado em',new Date(user.createdAt).toLocaleDateString('pt-BR')]].map(([k,v])=>
            `<tr><td style="padding:5px 0;color:var(--text-muted);width:38%;">${k}</td><td style="padding:5px 0;font-weight:500;">${v}</td></tr>`
          ).join('')}
        </table>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:8px;">Etapas do onboarding</div>
      <div class="steps-list">
        ${Array.from({length:14},(_,i)=>{
          const n = i+1;
          const done = onboarding.completed || n < step;
          const act = !onboarding.completed && n===step;
          const cls = done?'done':act?'active':'todo';
          const icon = done ? stepIconDone() : act ? stepIconActive() : stepIconTodo();
          return `<div class="step-row ${cls}">${icon}<span>Etapa ${n} — ${STEP_TITLES[n]}</span></div>`;
        }).join('')}
      </div>`;
    return;
  }

  if (tab === 'plan') {
    logDrawerDiagnostic('Business Plan', {
      route: `/api/admin/client/${_currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['chapters'],
      actualPayload: plan,
      note: 'Deveria usar o campo plan da rota base e conter chapters para montar o Business Plan.',
    });
    body.innerHTML = `<div class="chapter-list">
      ${(plan.chapters||[]).map(ch=>{
        const st = CHAPTER_STATUS[ch.status]||CHAPTER_STATUS.pendente;
        const done = ch.status === 'aprovado';
        const checkIcon = done
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
          : ch.id;
        const comments = (ch.comments||[]).map(c=>`<div style="font-size:12px;background:#F8FAFC;border-radius:6px;padding:8px 10px;margin-top:6px;">
          <strong>${c.from==='client'?'Cliente':'Equipe'}</strong>: ${c.text}
          <span style="float:right;color:var(--text-muted);">${new Date(c.ts).toLocaleDateString('pt-BR')}</span>
        </div>`).join('');
        return `<div class="chapter-item" style="flex-direction:column;align-items:flex-start;gap:10px;">
          <div style="display:flex;align-items:center;gap:12px;width:100%;">
            <div class="chapter-num${done?' done':''}">${checkIcon}</div>
            <div class="chapter-title" style="flex:1;">${ch.title}</div>
            <span class="badge ${st.cls}">${st.label}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;padding-left:44px;width:100%;">
            <select class="portal-select" style="width:auto;flex:1;font-size:13px;" onchange="updateChapterStatus('${_currentClientId}',${ch.id},this.value)">
              ${Object.entries(CHAPTER_STATUS).map(([v,{label}])=>`<option value="${v}"${ch.status===v?' selected':''}>${label}</option>`).join('')}
            </select>
          </div>
          ${comments ? `<div style="padding-left:44px;width:100%;">${comments}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
    return;
  }

  if (tab === 'tasks') {
    logDrawerDiagnostic('Tarefas', {
      route: `/api/admin/client/${_currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['tasks'],
      actualPayload: { tasks },
      note: 'Deveria usar o array tasks da rota base; quando vazio, o array ainda precisa existir.',
    });
    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Adicionar tarefa</div>
        <input type="text" class="portal-input" id="newTaskTitle" placeholder="Título da tarefa" style="margin-bottom:8px;"/>
        <input type="text" class="portal-input" id="newTaskDesc" placeholder="Descrição (opcional)" style="margin-bottom:8px;"/>
        <input type="date" class="portal-input" id="newTaskDate" style="margin-bottom:12px;"/>
        <button class="btn-primary" onclick="addTask()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar tarefa
        </button>
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Tarefas atribuídas</div>
      <div class="task-list">
        ${!tasks.length
          ? '<div class="empty-state"><p>Nenhuma tarefa criada.</p></div>'
          : tasks.map(t=>`<div class="task-item">
              <div class="task-dot ${t.status}"></div>
              <div style="flex:1;">
                <div class="task-title" style="${t.status==='concluido'?'text-decoration:line-through;color:var(--text-muted)':''}">${t.title}</div>
                ${t.description?`<div style="font-size:12px;color:var(--text-muted);">${t.description}</div>`:''}
              </div>
              ${t.dueDate?`<div class="task-due">${new Date(t.dueDate).toLocaleDateString('pt-BR')}</div>`:''}
              <span class="badge ${t.status==='concluido'?'badge-green':'badge-amber'}">${t.status==='concluido'?'Concluída':'Pendente'}</span>
            </div>`).join('')}
      </div>`;
    return;
  }

  if (tab === 'financeiro_client') {
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando financeiro...</div>';
    try {
      const route = `/api/admin/client/${_currentClientId}/financial`;
      const res = await fetch(route, { headers: authH() });
      const data = await readDrawerResponse('Financeiro', route, res, ['invoices'], 'Deveria retornar invoices e, opcionalmente, configured/stripeConfigured.');
      if (!res.ok) throw new Error(data.error || 'Erro');
      const invoices = data.invoices || [];
      const stripeConfigured = data.configured ?? data.stripeConfigured ?? true;
      if (!stripeConfigured) {
        body.innerHTML = '<div class="empty-state"><p>Stripe não configurado.</p></div>';
        return;
      }
      if (!invoices || !invoices.length) {
        body.innerHTML = '<div class="empty-state"><p>Nenhuma cobrança encontrada.</p></div>';
        return;
      }
      const paid = invoices.filter(inv => inv.status === 'paid' || inv.status === 'succeeded');
      const paidTotal = paid.reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="stat-card blue" style="margin:0;">
            <div class="stat-value" style="font-size:18px;">${window.REShared.formatCurrencyBRL(paidTotal)}</div>
            <div class="stat-label">Total pago</div>
          </div>
          <div class="stat-card" style="margin:0;">
            <div class="stat-value" style="font-size:18px;">${invoices.length}</div>
            <div class="stat-label">Cobranças (${paid.length} pagas)</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Histórico de cobranças</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${invoices.map(inv => {
            const isPaid = inv.status === 'paid' || inv.status === 'succeeded';
            const stCls = isPaid ? 'badge-green' : inv.status === 'open' ? 'badge-amber' : 'badge-red';
            const stLbl = isPaid ? 'Pago' : inv.status === 'open' ? 'Em aberto' : inv.status;
            const dt = window.REShared.formatDateBR(inv.date);
            const amt = window.REShared.formatCurrencyBRL(parseFloat(inv.amount || 0));
            const link = inv.pdfUrl || inv.hostedUrl;
            return `<div style="background:#F8FAFC;border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${inv.description || 'Cobrança'}</div>
                <div style="font-size:11px;color:var(--text-muted);">${dt}</div>
              </div>
              <div style="font-weight:700;font-size:13px;">${amt}</div>
              <span class="badge ${stCls}">${stLbl}</span>
              ${link ? `<a href="${link}" target="_blank" style="font-size:11px;color:var(--primary);">Ver</a>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    } catch (e) {
      logDrawerDiagnostic('Financeiro', {
        route: `/api/admin/client/${_currentClientId}/financial`,
        source: 'fetch',
        expectedKeys: ['invoices'],
        actualPayload: null,
        note: 'Deveria retornar invoices e dados de configuração de Stripe.',
        error: e.message,
      });
      body.innerHTML = '<div class="empty-state"><p>Erro ao carregar dados financeiros.</p></div>';
    }
    return;
  }

  if (tab === 'messages') {
    logDrawerDiagnostic('Mensagens', {
      route: `/api/admin/client/${_currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['messages'],
      actualPayload: { messages },
      note: 'Deveria usar o array messages da rota base; ao abrir a guia, o POST de seen é apenas efeito colateral.',
    });
    if (_currentClientId) {
      fetch(`/api/admin/messages/seen/${_currentClientId}`, { method: 'POST', headers: authH() }).catch(() => {});
      if (_unreadMsgs) { _unreadMsgs[_currentClientId] = 0; }
      const btn = document.getElementById('drawerTabMessages');
      if (btn) btn.innerHTML = btn.innerHTML.replace(/\s*<span[^>]*>.*?<\/span>/g, '') + '';
    }
    const MSG_TEMPLATES = [
      { label: 'Solicitar dados pendentes', icon: '📋', text: 'Identificamos que algumas informações estão pendentes no seu cadastro. Para avançarmos na elaboração do Business Plan, precisamos que você complemente os dados do formulário de onboarding. Caso tenha dúvidas, estamos à disposição.' },
      { label: 'Ajuste de documento', icon: '📄', text: 'O documento enviado apresenta algumas inconsistências. Solicitamos o reenvio com as seguintes correções:\n- Verificar período das informações\n- Incluir detalhamento solicitado\n\nAssim que o ajuste for realizado, daremos continuidade à análise.' },
      { label: 'Atualização de etapa', icon: '📊', text: 'Informamos que estamos avançando na análise do seu processo. Atualmente, estamos na fase de estruturação do Business Plan. Caso haja qualquer atualização relevante sobre a situação da empresa, por favor nos comunique.' },
      { label: 'Etapa aprovada', icon: '✅', text: 'Temos uma boa notícia! A etapa de diagnóstico foi concluída com sucesso. A partir de agora, seguiremos para a estruturação da estratégia de recuperação. Em breve entraremos em contato com os próximos passos.' },
      { label: 'Agendar reunião', icon: '📅', text: 'Gostaríamos de agendar uma reunião para discutir o andamento do seu processo. Por favor, acesse a seção "Agenda" no portal e selecione um horário de sua preferência. Aguardamos sua confirmação.' },
    ];

    body.innerHTML = `
      <div class="msg-templates-label">Mensagens rápidas</div>
      <div class="msg-templates">
        ${MSG_TEMPLATES.map((t, i) => `
          <button class="msg-template-btn" onclick="applyMsgTemplate(${i})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${t.label}
          </button>`).join('')}
      </div>
      <div class="message-thread" style="max-height:260px;" id="adminMsgThread">
        ${!messages.length
          ? '<div class="empty-state"><p>Nenhuma mensagem.</p></div>'
          : messages.map(m=>`<div>
              <div class="message-bubble from-${m.fromRole||m.from}">
                <div class="message-from">${(m.fromRole||m.from)==='admin'?'Recupera Empresas':m.fromName||'Cliente'}</div>
                ${m.text}
                <div class="message-ts">${new Date(m.ts).toLocaleString('pt-BR')}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="message-input-row" style="margin-top:12px;">
        <input type="text" class="message-input" id="adminMsgInput" placeholder="Escrever mensagem ao cliente..."
               onkeydown="if(event.key==='Enter')sendAdminMessage()"/>
        <button class="btn-send" onclick="sendAdminMessage()">Enviar</button>
      </div>`;
    setTimeout(() => {
      const t = document.getElementById('adminMsgThread');
      if (t) t.scrollTop = t.scrollHeight;
    }, 50);

    window._msgTemplates = MSG_TEMPLATES;
    return;
  }

  if (tab === 'agenda') {
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando agendamentos...</div>';
    let bookings = [];
    try {
      const route = `/api/admin/client/${_currentClientId}/bookings`;
      const bRes = await fetch(route, { headers: authH() });
      const payload = await readDrawerResponse('Agenda', route, bRes, ['bookings'], 'Deveria retornar bookings com re_agenda_slots aninhado para cada agendamento.');
      if (bRes.ok) bookings = payload.bookings || [];
    } catch (e) {
      logDrawerDiagnostic('Agenda', {
        route: `/api/admin/client/${_currentClientId}/bookings`,
        source: 'fetch',
        expectedKeys: ['bookings'],
        actualPayload: null,
        note: 'Deveria retornar bookings com dados do slot vinculado.',
        error: e.message,
      });
    }

    const ST_MAP = {
      pending: { bg:'#FEF3C7', color:'#D97706', label:'Pendente' },
      confirmed: { bg:'#DCFCE7', color:'#16A34A', label:'Confirmado' },
      cancelled: { bg:'#FEE2E2', color:'#DC2626', label:'Cancelado' },
      rescheduled: { bg:'#EDE9FE', color:'#7C3AED', label:'Remarcado' },
    };

    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:14px;font-weight:700;">Agendamentos</div>
        <button onclick="openBookForClientFromDrawer('${_currentClientId}')"
          style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">
          📅 Novo agendamento
        </button>
      </div>`;

    if (!bookings.length) {
      html += `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Nenhum agendamento encontrado.</p>
      </div>`;
    } else {
      const sorted = [...bookings].sort((a,b) => {
        const da = a.re_agenda_slots?.starts_at || '';
        const db = b.re_agenda_slots?.starts_at || '';
        return db.localeCompare(da);
      });
      html += sorted.map(b => {
        const slot = b.re_agenda_slots || {};
        const d = slot.starts_at ? new Date(slot.starts_at) : null;
        const de = slot.ends_at ? new Date(slot.ends_at) : null;
        const st = ST_MAP[b.status] || { bg:'#F1F5F9', color:'#64748b', label: b.status };
        const isPast = d && d < new Date();
        return `
        <div style="padding:11px 0;border-bottom:1px solid var(--border);${isPast?'opacity:.7':''}">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:#1e293b;">${slot.title || '—'}</div>
              ${d ? `<div style="font-size:12px;color:var(--text-muted);">
                ${d.toLocaleDateString('pt-BR')} às ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}
                ${de ? `– ${String(de.getHours()).padStart(2,'0')}:${String(de.getMinutes()).padStart(2,'0')}` : ''}
              </div>` : ''}
              ${b.notes ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px;">${b.notes}</div>` : ''}
              ${b.cancel_reason ? `<div style="font-size:11px;color:#DC2626;margin-top:2px;">Motivo: ${b.cancel_reason}</div>` : ''}
            </div>
            <span style="font-size:10px;padding:2px 8px;border-radius:12px;background:${st.bg};color:${st.color};font-weight:600;white-space:nowrap;">${st.label}</span>
          </div>
          ${b.status === 'pending' ? `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="agendaConfirmBooking('${b.id}');renderDrawerTab('agenda');" style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#15803D;font-size:11px;font-weight:600;">✅ Confirmar</button>
            <button onclick="agendaRescheduleBooking('${b.id}','${(_currentClientData.user?.name||'').replace(/'/g,'')}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
            <button onclick="agendaCancelBooking('${b.id}','${(_currentClientData.user?.name||'').replace(/'/g,'')}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
          </div>` : b.status === 'confirmed' ? `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="agendaRescheduleBooking('${b.id}','${(_currentClientData.user?.name||'').replace(/'/g,'')}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
            <button onclick="agendaCancelBooking('${b.id}','${(_currentClientData.user?.name||'').replace(/'/g,'')}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
          </div>` : ''}
        </div>`;
      }).join('');
    }
    body.innerHTML = html;
    return;
  }

  if (tab === 'docs') {
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando...</div>';
    const route = `/api/admin/client/${_currentClientId}/documents`;
    const res = await fetch(route, { headers: authH() });
    const payload = await readDrawerResponse('Documentos', route, res, ['documents'], 'Deveria retornar documents com name, status, createdAt e comentários quando existirem.');
    if (!res.ok) { body.innerHTML = `<div class="empty-state"><p>${escHtml(payload.error || 'Erro ao carregar documentos.')}</p></div>`; return; }
    const { documents } = payload;

    const DOC_ST = {
      pendente: { label:'Pendente', cls:'badge-gray' },
      em_analise: { label:'Em análise', cls:'badge-blue' },
      aprovado: { label:'Aprovado', cls:'badge-green' },
      reprovado: { label:'Reprovado', cls:'badge-red' },
      ajuste_solicitado: { label:'Ajuste solicitado', cls:'badge-amber' },
    };
    const DOC_TYPES = {
      dre:'DRE', balanco:'Balanço', fluxo_caixa:'Fluxo de Caixa',
      contrato_social:'Contrato Social', procuracao:'Procuração',
      certidao:'Certidão', extrato:'Extrato', nota_fiscal:'NF', outros:'Outros',
    };

    if (!documents.length) {
      body.innerHTML = `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Cliente ainda não enviou documentos.</p>
      </div>`;
      return;
    }

    body.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:12px;">
        ${documents.length} documento(s) — clique no status para alterar
      </div>
      ${documents.map(doc => {
        const st = DOC_ST[doc.status] || DOC_ST.pendente;
        const tipo = DOC_TYPES[doc.docType] || doc.docType;
        const date = new Date(doc.createdAt).toLocaleDateString('pt-BR');
        const comments = doc.comments || [];
        return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${doc.name}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${tipo} · ${date}</div>
            </div>
            <span class="badge ${st.cls}">${st.label}</span>
          </div>

          <div style="margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;">
            <div>
              <label class="form-label-sm" style="font-size:11px;">Alterar status</label>
              <select class="portal-select" id="docSt_${doc.id}" style="font-size:12px;">
                ${Object.entries(DOC_ST).map(([v,{label}])=>`<option value="${v}"${doc.status===v?' selected':''}>${label}</option>`).join('')}
              </select>
            </div>
            <button class="btn-sm btn-sm-approve" onclick="updateDocStatus('${doc.id}')">Salvar</button>
          </div>
          <div style="margin-top:8px;">
            <input type="text" class="portal-input" id="docCmt_${doc.id}" placeholder="Comentário para o cliente (opcional)" style="font-size:12px;"/>
          </div>

          <div style="margin-top:10px;display:flex;gap:12px;align-items:center;">
            <a href="${(window.RE_API_BASE || '').replace(/\/+$/, '')}/api/documents/${doc.id}/file?token=${getToken()}" target="_blank"
               style="font-size:12px;color:var(--primary);text-decoration:none;display:flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Visualizar / baixar
            </a>
          </div>

          ${comments.length ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">
            ${comments.map(c=>`<div style="font-size:11px;background:#F8FAFC;padding:6px 8px;border-radius:6px;margin-top:4px;">
              <strong>${c.from==='admin'?'Equipe':'Cliente'}</strong>: ${c.text}
              <span style="float:right;color:var(--text-muted);">${new Date(c.ts).toLocaleDateString('pt-BR')}</span>
            </div>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('')}`;
    return;
  }

  if (tab === 'equipe') {
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando equipe...</div>';
    const route = `/api/admin/client/${_currentClientId}/members`;
    const res = await fetch(route, { headers: authH() });
    const j = await readDrawerResponse('Equipe', route, res, ['members'], 'Deveria retornar members com name, email, role, active e last_login quando disponível.');
    if (!res.ok) { body.innerHTML = `<div class="empty-state"><p>${escHtml(j.error || 'Erro ao carregar equipe.')}</p></div>`; return; }
    const { members = [] } = j;
    const ROLE_LABELS = { financeiro:'Financeiro', contador:'Contador', operacional:'Operacional', visualizador:'Visualizador' };
    const ROLE_COLORS = { financeiro:'#2563eb', contador:'#7c3aed', operacional:'#059669', visualizador:'#6b7280' };
    let html = `<div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:14px;">Membros da empresa (${members.length})</div>`;
    if (!members.length) {
      html += `<div class="empty-state"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Nenhum membro cadastrado pelo cliente.</p></div>`;
    } else {
      html += `<div style="display:flex;flex-direction:column;gap:8px;">
        ${members.map(m => `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px;">
          <div style="width:34px;height:34px;border-radius:50%;background:${ROLE_COLORS[m.role]||'#6b7280'}22;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:${ROLE_COLORS[m.role]||'#6b7280'}">
            ${(m.name||'?')[0].toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;color:#1e293b;">${m.name}</div>
            <div style="font-size:11px;color:#64748b;">${m.email}</div>
          </div>
          <span style="background:${ROLE_COLORS[m.role]||'#6b7280'}18;color:${ROLE_COLORS[m.role]||'#6b7280'};font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;">${ROLE_LABELS[m.role]||m.role}</span>
          <span style="font-size:10px;padding:2px 8px;border-radius:20px;${m.active?'background:#dcfce7;color:#16a34a;':'background:#fee2e2;color:#dc2626;'}">${m.active?'Ativo':'Inativo'}</span>
          <div style="font-size:10px;color:#94a3b8;">${m.last_login ? 'Último login: '+new Date(m.last_login).toLocaleDateString('pt-BR') : 'Nunca logou'}</div>
        </div>`).join('')}
      </div>`;
    }
    body.innerHTML = html;
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