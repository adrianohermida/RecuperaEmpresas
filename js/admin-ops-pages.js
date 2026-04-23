'use strict';

(function () {
  var pageMode = document.body?.dataset?.adminWorkspace || 'support';
  var state = {
    user: null,
    clients: [],
    filteredClients: [],
    selectedClientId: null,
    allowedIds: [],
    details: {},
  };

  function escHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function modeCopy() {
    return {
      support: {
        title: 'Suporte',
        subtitle: 'Mensagens administrativas, contexto Freshdesk e resposta rápida ao cliente.',
      },
      tasks: {
        title: 'Tarefas',
        subtitle: 'Fila operacional por cliente com criação rápida e foco no que está pendente.',
      },
      documents: {
        title: 'Documentos',
        subtitle: 'Análise de documentos enviados, comentários e mudança de status.',
      },
    }[pageMode] || { title: 'Operação', subtitle: 'Workspace administrativo.' };
  }

  function parseAllowedIds() {
    var raw = new URLSearchParams(window.location.search).get('ids') || '';
    return raw.split(',').map(function (value) { return value.trim(); }).filter(Boolean);
  }

  function syncShell() {
    var displayName = state.user?.name || state.user?.email || 'Admin';
    document.getElementById('userName').textContent = displayName;
    document.getElementById('userAvatar').textContent = displayName.charAt(0).toUpperCase();
    document.getElementById('dropupUserName').textContent = displayName;
    document.getElementById('dropupUserEmail').textContent = state.user?.email || 'Sem e-mail';
    window.REShared?.renderPortalSidebar?.({
      containerId: 'portalSidebarNav',
      user: state.user,
      activeHref: pageMode === 'support'
        ? '/suporte-admin'
        : pageMode === 'tasks'
          ? '/tarefas-admin'
          : '/documentos-admin'
    });
    var copy = modeCopy();
    document.getElementById('opsPageTitle').textContent = copy.title;
    document.getElementById('opsPageSub').textContent = copy.subtitle;
  }

  function filterClients() {
    var query = String(document.getElementById('opsClientSearch')?.value || '').toLowerCase();
    var base = state.allowedIds.length
      ? state.clients.filter(function (client) { return state.allowedIds.includes(client.id); })
      : state.clients.slice();
    state.filteredClients = base.filter(function (client) {
      return !query
        || (client.company || '').toLowerCase().includes(query)
        || (client.name || '').toLowerCase().includes(query)
        || (client.email || '').toLowerCase().includes(query);
    });
    renderClientList();
  }

  function renderClientList() {
    var root = document.getElementById('opsClientList');
    if (!root) return;
    document.getElementById('opsRailSummary').textContent = state.filteredClients.length + ' cliente(s) visível(is).';
    if (!state.filteredClients.length) {
      root.innerHTML = '<div class="account-empty-state">Nenhum cliente disponível para este filtro.</div>';
      return;
    }

    root.innerHTML = state.filteredClients.map(function (client) {
      var status = STATUS_LABELS[client.status] || STATUS_LABELS.nao_iniciado;
      var selected = client.id === state.selectedClientId;
      return '<button type="button" class="ops-client-card' + (selected ? ' active' : '') + '" onclick="selectOpsClient(\'' + client.id + '\')">'
        + '<div class="ops-client-card-top"><div class="ops-client-card-title">' + (client.company || client.name || 'Cliente') + '</div><span class="badge ' + status.cls + '">' + status.label + '</span></div>'
        + '<div class="ops-client-card-meta">' + (client.email || 'Sem e-mail') + '</div>'
        + '<div class="ops-client-card-foot">Etapa ' + (client.step || 0) + ' · ' + (client.pendingTasks || 0) + ' tarefa(s)</div>'
        + '</button>';
    }).join('');
  }

  async function loadClientDetail(clientId) {
    if (state.details[clientId]) return state.details[clientId];
    var response = await fetch('/api/admin/client/' + clientId, { headers: authH() });
    if (!response.ok) throw new Error('Erro ao carregar cliente.');
    var detail = await response.json();
    if (pageMode === 'documents') {
      var docsRes = await fetch('/api/admin/client/' + clientId + '/documents', { headers: authH() });
      detail.documentsPayload = docsRes.ok ? await docsRes.json() : { documents: [] };
    }
    state.details[clientId] = detail;
    return detail;
  }

  function supportPanel(detail) {
    var user = detail.user || {};
    var messages = detail.messages || [];
    return '<div class="ops-panel-stack">'
      + '<section class="ops-hero-grid">'
      + '  <div class="account-stat-card"><span class="account-stat-label">Cliente</span><strong>' + (user.company || user.name || 'Cliente') + '</strong><div class="tenant-member-meta">' + (user.email || 'Sem e-mail') + '</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Ticket Freshdesk</span><strong>' + (user.freshdeskTicketId || 'Sem vínculo') + '</strong><div class="tenant-member-meta">Canal principal de atendimento</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Mensagens</span><strong>' + messages.length + '</strong><div class="tenant-member-meta">Histórico administrativo do cliente</div></div>'
      + '</section>'
      + '<section class="page-section"><div class="page-section-title">Resposta rápida</div><div class="page-section-sub">Envie uma mensagem administrativa para o cliente e use o detalhe completo quando precisar aprofundar.</div><div class="ops-compose-box"><textarea id="opsSupportMessage" class="form-input account-textarea" placeholder="Escreva a resposta para o cliente."></textarea><div class="account-form-actions"><a class="btn btn-secondary" href="/cliente?id=' + user.id + '&tab=messages">Abrir detalhe completo</a><button class="btn btn-primary" type="button" onclick="sendOpsSupportMessage()">Enviar mensagem</button></div></div></section>'
      + '<section class="page-section"><div class="page-section-title">Histórico</div><div class="page-section-sub">Mensagens já trocadas com o cliente.</div><div class="ops-message-list">'
      + (!messages.length ? '<div class="account-empty-state">Nenhuma mensagem administrativa registrada.</div>' : messages.map(function (message) {
          var author = (message.fromRole || message.from) === 'admin' ? 'Equipe Recupera Empresas' : (message.fromName || 'Cliente');
          return '<article class="ops-message-card"><div class="ops-message-head"><strong>' + author + '</strong><span>' + new Date(message.ts).toLocaleString('pt-BR') + '</span></div><div>' + escHtml(message.text) + '</div></article>';
        }).join(''))
      + '</div></section>'
      + '</div>';
  }

  function tasksPanel(detail) {
    var user = detail.user || {};
    var tasks = detail.tasks || [];
    var completed = tasks.filter(function (task) { return task.status === 'concluido'; }).length;
    var pending = tasks.filter(function (task) { return task.status !== 'concluido'; }).length;
    return '<div class="ops-panel-stack">'
      + '<section class="ops-hero-grid">'
      + '  <div class="account-stat-card"><span class="account-stat-label">Cliente</span><strong>' + (user.company || user.name || 'Cliente') + '</strong><div class="tenant-member-meta">' + (user.email || 'Sem e-mail') + '</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Pendentes</span><strong>' + pending + '</strong><div class="tenant-member-meta">Demandas ainda em aberto</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Concluídas</span><strong>' + completed + '</strong><div class="tenant-member-meta">Itens finalizados</div></div>'
      + '</section>'
      + '<section class="page-section"><div class="page-section-title">Nova tarefa</div><div class="page-section-sub">Crie uma tarefa operacional diretamente do workspace.</div><div class="page-field-row full"><div class="form-group"><label class="form-label" for="opsTaskTitle">Título</label><input class="form-input" id="opsTaskTitle" type="text" placeholder="Título da tarefa"/></div></div><div class="page-field-row full"><div class="form-group"><label class="form-label" for="opsTaskDescription">Descrição</label><textarea class="form-input account-textarea" id="opsTaskDescription" placeholder="Detalhes e contexto"></textarea></div></div><div class="page-field-row full"><div class="form-group"><label class="form-label" for="opsTaskDueDate">Prazo</label><input class="form-input" id="opsTaskDueDate" type="date"/></div></div><div class="account-form-actions"><button class="btn btn-primary" type="button" onclick="createOpsTask()">Criar tarefa</button></div></section>'
      + '<section class="page-section"><div class="page-section-title">Fila do cliente</div><div class="page-section-sub">Resumo das tarefas já atribuídas.</div><div class="tenant-team-list">'
      + (!tasks.length ? '<div class="account-empty-state">Nenhuma tarefa atribuída a este cliente.</div>' : tasks.map(function (task) {
          var pendingTask = task.status !== 'concluido';
          var dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString('pt-BR') : 'Sem prazo';
          return '<article class="tenant-member-card"><div><div class="tenant-member-name">' + escHtml(task.title) + '</div><div class="tenant-member-meta">' + escHtml(task.description || 'Sem descrição') + '</div></div><div class="tenant-member-actions"><span class="badge ' + (pendingTask ? 'badge-amber' : 'badge-green') + '">' + (pendingTask ? 'Pendente' : 'Concluída') + '</span><span class="tenant-member-meta">' + dueDate + '</span></div></article>';
        }).join(''))
      + '</div></section>'
      + '</div>';
  }

  function documentsPanel(detail) {
    var user = detail.user || {};
    var documents = detail.documentsPayload?.documents || [];
    var approved = documents.filter(function (doc) { return doc.status === 'aprovado'; }).length;
    var review = documents.filter(function (doc) { return doc.status === 'em_analise'; }).length;
    return '<div class="ops-panel-stack">'
      + '<section class="ops-hero-grid">'
      + '  <div class="account-stat-card"><span class="account-stat-label">Cliente</span><strong>' + (user.company || user.name || 'Cliente') + '</strong><div class="tenant-member-meta">' + (user.email || 'Sem e-mail') + '</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Em análise</span><strong>' + review + '</strong><div class="tenant-member-meta">Aguardando decisão da equipe</div></div>'
      + '  <div class="account-stat-card"><span class="account-stat-label">Aprovados</span><strong>' + approved + '</strong><div class="tenant-member-meta">Documentos já validados</div></div>'
      + '</section>'
      + '<section class="page-section"><div class="page-section-title">Documentos enviados</div><div class="page-section-sub">Atualize status e comente diretamente no workspace.</div><div class="tenant-team-list">'
      + (!documents.length ? '<div class="account-empty-state">Este cliente ainda não enviou documentos.</div>' : documents.map(function (doc) {
          return '<article class="ops-document-card"><div class="ops-document-head"><div><div class="tenant-member-name">' + escHtml(doc.name) + '</div><div class="tenant-member-meta">' + escHtml(doc.docType || 'Documento') + ' · ' + new Date(doc.createdAt).toLocaleDateString('pt-BR') + '</div></div><span class="badge ' + ({pendente:'badge-gray', em_analise:'badge-blue', aprovado:'badge-green', reprovado:'badge-red', ajuste_solicitado:'badge-amber'}[doc.status] || 'badge-gray') + '">' + escHtml(doc.status || 'pendente') + '</span></div><div class="page-field-row"><div class="form-group"><label class="form-label" for="opsDocStatus_' + doc.id + '">Status</label><select class="form-input" id="opsDocStatus_' + doc.id + '"><option value="pendente">Pendente</option><option value="em_analise">Em análise</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="ajuste_solicitado">Ajuste solicitado</option></select></div><div class="form-group"><label class="form-label" for="opsDocComment_' + doc.id + '">Comentário</label><input class="form-input" id="opsDocComment_' + doc.id + '" type="text" placeholder="Comentário opcional para o cliente"/></div></div><div class="tenant-member-actions"><a class="btn btn-secondary btn-sm" href="/api/documents/' + doc.id + '/file?token=' + encodeURIComponent(getToken()) + '" target="_blank">Abrir arquivo</a><button class="btn btn-primary btn-sm" type="button" onclick="saveOpsDocumentStatus(\'' + doc.id + '\')">Salvar status</button></div></article>';
        }).join(''))
      + '</div></section>'
      + '</div>';
  }

  async function renderSelectedClient() {
    var root = document.getElementById('opsMainPanel');
    if (!root) return;
    if (!state.selectedClientId) {
      root.innerHTML = '<div class="account-empty-state">Selecione um cliente para abrir o workspace.</div>';
      return;
    }
    root.innerHTML = '<div class="account-empty-state">Carregando workspace...</div>';
    try {
      var detail = await loadClientDetail(state.selectedClientId);
      root.innerHTML = pageMode === 'support'
        ? supportPanel(detail)
        : pageMode === 'tasks'
          ? tasksPanel(detail)
          : documentsPanel(detail);
      if (pageMode === 'documents') {
        (detail.documentsPayload?.documents || []).forEach(function (doc) {
          var statusEl = document.getElementById('opsDocStatus_' + doc.id);
          if (statusEl) statusEl.value = doc.status || 'pendente';
        });
      }
    } catch (error) {
      root.innerHTML = '<div class="account-empty-state">' + escHtml(error.message || 'Erro ao carregar workspace.') + '</div>';
    }
  }

  async function loadClients() {
    var response = await fetch('/api/admin/clients', { headers: authH() });
    if (!response.ok) throw new Error('Erro ao carregar clientes.');
    var payload = await response.json();
    state.clients = payload.clients || [];
    filterClients();
    if (!state.selectedClientId && state.filteredClients.length) {
      state.selectedClientId = state.filteredClients[0].id;
    }
    renderClientList();
    await renderSelectedClient();
  }

  async function initPage() {
    try {
      var session = await window.REShared.verifySession({ timeoutMs: 20000 });
      if (!session.ok || !session.user) {
        window.REShared.redirectToRoute('login');
        return;
      }
      if (!session.user.isAdmin) {
        window.REShared.redirectToRoute('dashboard');
        return;
      }
      state.user = session.user;
      state.allowedIds = parseAllowedIds();
      syncShell();
      document.getElementById('opsClientSearch').addEventListener('input', filterClients);
      await loadClients();
      
      // Initialize Freshchat widget for consultants (agents)
      if (window.REAccountData && typeof window.REAccountData.bootFreshchat === 'function') {
        window.REAccountData.bootFreshchat(state.user).catch(function (error) {
          console.warn('[AdminOps] Failed to initialize Freshchat:', error.message);
        });
      }
    } finally {
      document.getElementById('authGuard')?.remove();
    }
  }

  async function sendOpsSupportMessage() {
    var input = document.getElementById('opsSupportMessage');
    var text = String(input?.value || '').trim();
    if (!text || !state.selectedClientId) {
      showToast('Escreva uma mensagem para enviar.', 'error');
      return;
    }
    var response = await fetch('/api/admin/client/' + state.selectedClientId + '/message', {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ text: text }),
    });
    if (!response.ok) {
      showToast('Erro ao enviar mensagem.', 'error');
      return;
    }
    input.value = '';
    delete state.details[state.selectedClientId];
    await renderSelectedClient();
    showToast('Mensagem enviada.', 'success');
  }

  async function createOpsTask() {
    var title = String(document.getElementById('opsTaskTitle')?.value || '').trim();
    var description = String(document.getElementById('opsTaskDescription')?.value || '').trim();
    var dueDate = document.getElementById('opsTaskDueDate')?.value || null;
    if (!title || !state.selectedClientId) {
      showToast('Informe ao menos o título da tarefa.', 'error');
      return;
    }
    var response = await fetch('/api/admin/client/' + state.selectedClientId + '/task', {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ title: title, description: description, dueDate: dueDate || null }),
    });
    if (!response.ok) {
      showToast('Erro ao criar tarefa.', 'error');
      return;
    }
    delete state.details[state.selectedClientId];
    await renderSelectedClient();
    showToast('Tarefa criada.', 'success');
  }

  async function saveOpsDocumentStatus(docId) {
    if (!state.selectedClientId) return;
    var status = document.getElementById('opsDocStatus_' + docId)?.value;
    var comment = String(document.getElementById('opsDocComment_' + docId)?.value || '').trim();
    var response = await fetch('/api/admin/client/' + state.selectedClientId + '/documents/' + docId, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status: status, comment: comment }),
    });
    if (!response.ok) {
      showToast('Erro ao atualizar documento.', 'error');
      return;
    }
    delete state.details[state.selectedClientId];
    await renderSelectedClient();
    showToast('Documento atualizado.', 'success');
  }

  function selectOpsClient(clientId) {
    state.selectedClientId = clientId;
    renderClientList();
    renderSelectedClient();
  }

  window.selectOpsClient = selectOpsClient;
  window.sendOpsSupportMessage = sendOpsSupportMessage;
  window.createOpsTask = createOpsTask;
  window.saveOpsDocumentStatus = saveOpsDocumentStatus;

  if (document.readyState === 'complete') initPage();
  else window.addEventListener('load', initPage, { once: true });
})();
