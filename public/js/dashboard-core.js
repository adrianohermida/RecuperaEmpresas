'use strict';
/* dashboard-core.js — Núcleo do portal: progresso, plano, tarefas, mensagens, navegação */

const STEP_TITLES = {
  1:'Consentimento LGPD', 2:'Dados da Empresa', 3:'Sócios',
  4:'Estrutura Operacional', 5:'Quadro de Funcionários', 6:'Ativos',
  7:'Dados Financeiros', 8:'Dívidas e Credores', 9:'Histórico da Crise',
  10:'Diagnóstico Estratégico', 11:'Mercado e Operação',
  12:'Expectativas e Estratégia', 13:'Documentos', 14:'Confirmação',
};

const CHAPTER_STATUS = {
  pendente:       { label: 'Aguardando dados',   cls: 'badge-gray'   },
  em_elaboracao:  { label: 'Em elaboração',      cls: 'badge-blue'   },
  aguardando:     { label: 'Aguardando cliente', cls: 'badge-amber'  },
  em_revisao:     { label: 'Em revisão',         cls: 'badge-purple' },
  aprovado:       { label: 'Aprovado',           cls: 'badge-green'  },
};

// ── Seções ────────────────────────────────────────────────────────────────────
function showSection(name, clickedEl) {
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const sec = document.getElementById('sec-' + name);
  if (sec) sec.classList.add('active');
  if (clickedEl) {
    clickedEl.classList.add('active');
  } else {
    document.querySelectorAll('.sidebar-link').forEach(l => {
      if (l.getAttribute('onclick') && l.getAttribute('onclick').includes("'" + name + "'"))
        l.classList.add('active');
    });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  // Update URL hash so browser back/forward works and deep links are shareable
  if (history.replaceState) history.replaceState(null, '', '#' + name);

  // Section-specific data loaders (refresh on every navigation)
  if (name === 'tasks')       loadTasks();
  if (name === 'plan')        loadPlan();
  if (name === 'support')     loadSupport();
  if (name === 'agenda')      loadAgendaSlots();
  if (name === 'financeiro')  { loadFinanceiro(); loadInternalInvoices(); }
  if (name === 'documentos')  loadDocuments();
  if (name === 'equipe')      loadMembers();
  if (name === 'marketplace') loadMarketplace();
  if (name === 'formularios') loadClientForms();
  if (name === 'jornadas')    loadClientJourneys();
  if (name === 'messages') { loadMessages(); startMsgPolling(); } else { stopMsgPolling(); }
  if (typeof closeSidebar === 'function') closeSidebar();
}

// ── Navigate to a section programmatically (e.g. from notifications) ─────────
function navigateTo(section, highlightId) {
  showSection(section, null);
  // Optionally scroll to a specific element after render
  if (highlightId) {
    setTimeout(() => {
      const el = document.getElementById(highlightId) || document.querySelector('[data-id="' + highlightId + '"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-pulse'); }
    }, 300);
  }
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function setRing(pct) {
  const circumference = 238.76;
  const offset = circumference - (pct / 100) * circumference;
  const ring = document.getElementById('progressRing');
  if (ring) ring.setAttribute('stroke-dashoffset', offset);
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
function stepIconTodo() { return `<span class="step-row-icon step-icon-todo"></span>`; }

// ── Render functions ──────────────────────────────────────────────────────────
function renderProgress(progress) {
  const step      = progress.step || 1;
  const completed = progress.completed || false;
  const pct       = Math.min(100, Math.round((step - 1) / 14 * 100));
  const displayPct = completed ? 100 : pct;

  document.getElementById('statProgress').textContent = displayPct + '%';
  document.getElementById('statStep').textContent     = (completed ? 14 : step - 1) + '/14';
  document.getElementById('progressPct').textContent  = displayPct + '%';
  document.getElementById('progressStep').textContent = completed ? 'Onboarding concluído' : `Etapa ${step} de 14`;
  window.REShared.applyPercentClass(document.getElementById('progressBar'), displayPct);
  setRing(displayPct);

  const badge   = document.getElementById('onboardingBadge');
  const btnWrap = document.getElementById('actionBtnWrap');
  const ob      = document.getElementById('onboardingBtn');

  if (completed) {
    badge.textContent = 'Concluído'; badge.className = 'badge badge-green';
    btnWrap.innerHTML = `<span class="dashboard-progress-sent-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Onboarding enviado
    </span>`;
    if (ob) ob.textContent = 'Ver respostas';
  } else if (step > 1) {
    badge.textContent = 'Em andamento'; badge.className = 'badge badge-blue';
  } else {
    badge.textContent = 'Não iniciado'; badge.className = 'badge badge-gray';
  }

  const list = document.getElementById('stepsList');
  if (list) {
    let html = '<div class="steps-list">';
    for (let i = 1; i <= 14; i++) {
      const done   = completed || i < step;
      const active = !completed && i === step;
      const cls    = done ? 'done' : active ? 'active' : 'todo';
      const icon   = done ? stepIconDone() : active ? stepIconActive() : stepIconTodo();
      html += `<div class="step-row ${cls}">${icon}<span>Etapa ${i} — ${STEP_TITLES[i]}</span></div>`;
    }
    html += '</div>';
    list.innerHTML = html;
  }
}

function renderPlan(chapters) {
  const list    = document.getElementById('chapterList');
  const preview = document.getElementById('planPreview');
  const hasContent = chapters.some(c => c.status !== 'pendente');

  if (!hasContent) {
    const emptyHtml = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>O Business Plan será elaborado após a conclusão do onboarding.</p>
    </div>`;
    if (list)    list.innerHTML    = emptyHtml;
    if (preview) preview.innerHTML = emptyHtml;
    return;
  }

  let html = '';
  let previewHtml = '<div class="chapter-list">';
  chapters.forEach(ch => {
    const st   = CHAPTER_STATUS[ch.status] || CHAPTER_STATUS.pendente;
    const done = ch.status === 'aprovado';
    const checkIcon = done
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
      : ch.id;
    const actions = (ch.status === 'aguardando' || ch.status === 'em_revisao')
      ? `<div class="chapter-actions">
          <button class="btn-sm btn-sm-approve" onclick="chapterAction(${ch.id},'approve')">Aprovar</button>
          <button class="btn-sm btn-sm-comment" onclick="openCommentModal(${ch.id},'Comentário — ${ch.title.replace(/'/g, "\\'")}')">Comentar</button>
          <button class="btn-sm btn-sm-change" onclick="openCommentModal(${ch.id},'Solicitar alteração — ${ch.title.replace(/'/g, "\\'")}','request_change')">Alterar</button>
        </div>` : '';
    html += `<div class="chapter-item">
      <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
      <div class="chapter-title">${ch.title}</div>
      <span class="badge ${st.cls}">${st.label}</span>
      ${actions}
    </div>`;
  });
  if (list) list.innerHTML = html;

  chapters.slice(0, 4).forEach(ch => {
    const st = CHAPTER_STATUS[ch.status] || CHAPTER_STATUS.pendente;
    const done = ch.status === 'aprovado';
    const checkIcon = done
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
      : ch.id;
    previewHtml += `<div class="chapter-item dashboard-chapter-preview-item">
      <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
      <div class="chapter-title">${ch.title}</div>
      <span class="badge ${st.cls}">${st.label}</span>
    </div>`;
  });
  previewHtml += '</div>';
  if (preview) preview.innerHTML = previewHtml;
}

function renderTasks(tasks) {
  const list    = document.getElementById('taskList');
  const preview = document.getElementById('tasksPreview');
  const stat    = document.getElementById('statTasks');
  const pending = tasks.filter(t => t.status === 'pendente');
  if (stat) stat.textContent = pending.length;

  if (!tasks.length) {
    const empty = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <p>Nenhuma tarefa atribuída.</p>
    </div>`;
    if (list) list.innerHTML = empty;
    if (preview) preview.innerHTML = empty;
    return;
  }

  let html = '';
  tasks.forEach(t => {
    const done = t.status === 'concluido';
    html += `<div class="task-item">
      <input type="checkbox" class="task-check" ${done ? 'checked' : ''} onchange="toggleTask('${t.id}',this.checked)"/>
      <div>
        <div class="task-title${done ? ' dashboard-task-title-done' : ''}">${t.title}</div>
        ${t.description ? `<div class="dashboard-task-description">${t.description}</div>` : ''}
      </div>
      ${t.dueDate ? `<div class="task-due">${new Date(t.dueDate).toLocaleDateString('pt-BR')}</div>` : ''}
      <span class="badge ${done ? 'badge-green' : 'badge-amber'}">${done ? 'Concluída' : 'Pendente'}</span>
    </div>`;
  });
  if (list) list.innerHTML = html;

  const previewTasks = pending.slice(0, 3);
  if (preview) {
    if (!previewTasks.length) {
      preview.innerHTML = `<div class="dashboard-task-empty-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Sem tarefas pendentes
      </div>`;
    } else {
      let ph = '<div class="task-list">';
      previewTasks.forEach(t => {
        ph += `<div class="task-item">
          <div class="task-dot pendente"></div>
          <div class="task-title">${t.title}</div>
          ${t.dueDate ? `<div class="task-due">${new Date(t.dueDate).toLocaleDateString('pt-BR')}</div>` : ''}
          <span class="badge badge-amber">Pendente</span>
        </div>`;
      });
      ph += '</div>';
      preview.innerHTML = ph;
    }
  }
}

function renderMessages(messages) {
  const thread = document.getElementById('messageThread');
  const stat   = document.getElementById('statMsgs');
  if (stat) stat.textContent = messages.length;

  if (!messages.length) {
    thread.innerHTML = '<div class="empty-state"><p>Nenhuma mensagem ainda. Dúvidas? Escreva para nós.</p></div>';
    return;
  }
  thread.innerHTML = messages.map(m => `
    <div>
      <div class="message-bubble from-${m.from}">
        <div class="message-from">${m.from === 'admin' ? 'Recupera Empresas' : m.fromName || 'Você'}</div>
        ${m.text}
        <div class="message-ts">${new Date(m.ts).toLocaleString('pt-BR')}</div>
      </div>
    </div>
  `).join('');
  thread.scrollTop = thread.scrollHeight;
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadProgress() {
  const res = await fetch('/api/progress', { headers: authH() });
  if (res.ok) renderProgress(await res.json());
}

async function loadPlan() {
  const res = await fetch('/api/plan', { headers: authH() });
  if (res.ok) { const p = await res.json(); renderPlan(p.chapters || []); }
}

async function loadTasks() {
  const res = await fetch('/api/tasks', { headers: authH() });
  if (res.ok) { const t = await res.json(); renderTasks(t.tasks || []); }
}

async function loadMessages() {
  const res = await fetch('/api/messages', { headers: authH() });
  if (res.ok) { const m = await res.json(); renderMessages(m.messages || []); }
}

async function loadData() {
  await Promise.all([loadProgress(), loadPlan(), loadTasks(), loadMessages()]);
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function chapterAction(chId, action) {
  await fetch(`/api/plan/chapter/${chId}`, {
    method: 'PUT', headers: authH(),
    body: JSON.stringify({ clientAction: action }),
  });
  showToast(action === 'approve' ? 'Capítulo aprovado!' : 'Solicitação enviada.', 'success');
  loadData();
}

async function toggleTask(id, done) {
  await fetch(`/api/tasks/${id}`, {
    method: 'PUT', headers: authH(),
    body: JSON.stringify({ status: done ? 'concluido' : 'pendente' }),
  });
  showToast(done ? 'Tarefa concluída!' : 'Tarefa reaberta.', done ? 'success' : '');
  loadData();
}

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  await fetch('/api/messages', { method: 'POST', headers: authH(), body: JSON.stringify({ text }) });
  await loadMessages();
}

// ── Mensagens polling ─────────────────────────────────────────────────────────
let _lastMsgTs = null, _msgPollTimer = null;

function startMsgPolling() {
  if (_msgPollTimer) return;
  _msgPollTimer = setInterval(async () => {
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab !== 'sec-messages') return;
    try {
      const since = _lastMsgTs || new Date(0).toISOString();
      const res   = await fetch(`/api/messages/poll?since=${encodeURIComponent(since)}`, { headers: authH() });
      if (!res.ok) return;
      const { messages } = await res.json();
      if (!messages.length) return;
      _lastMsgTs = messages[messages.length - 1].ts;
      const full = await fetch('/api/messages', { headers: authH() });
      if (full.ok) { const m = await full.json(); renderMessages(m.messages || []); }
    } catch {}
  }, 8000);
}

function stopMsgPolling() {
  clearInterval(_msgPollTimer);
  _msgPollTimer = null;
}
// ── Dashboard sidebar mobile controls ────────────────────────────────────────
// Uses #appSidebar (real sidebar ID in dashboard.html), #dashSidebarBackdrop,
// and #dashMenuToggle. Exposed on window so inline onclick handlers can call them.

function openDashSidebar() {
  const sidebar  = document.getElementById('appSidebar');
  const backdrop = document.getElementById('dashSidebarBackdrop');
  const toggle   = document.getElementById('dashMenuToggle');
  if (sidebar)  sidebar.classList.add('mobile-open');
  if (backdrop) backdrop.classList.add('open');
  if (toggle)   toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('sidebar-open');
}

function closeDashSidebar() {
  const sidebar  = document.getElementById('appSidebar');
  const backdrop = document.getElementById('dashSidebarBackdrop');
  const toggle   = document.getElementById('dashMenuToggle');
  if (sidebar)  sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('open');
  if (toggle)   toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sidebar-open');
}

function toggleDashSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (!sidebar) return;
  if (sidebar.classList.contains('mobile-open')) {
    closeDashSidebar();
  } else {
    openDashSidebar();
  }
}

window.openDashSidebar  = openDashSidebar;
window.closeDashSidebar = closeDashSidebar;
window.toggleDashSidebar = toggleDashSidebar;

// Close on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeDashSidebar();
});

// Close on resize above 768px
(function() {
  let _dashResizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_dashResizeTimer);
    _dashResizeTimer = setTimeout(function() {
      if (window.innerWidth > 768) closeDashSidebar();
    }, 120);
  });
})();

console.info('[RE:dashboard-core] loaded');
