/**
 * RecuperaChat Admin — Painel de Chat e Suporte para Consultores
 * Versão 2.0: Interface Freshchat Style integrada com Tickets e Clientes
 */
(function () {
  'use strict';

  const API_BASE = window.RE_API_BASE || '';
  const SUPABASE_URL  = window.RE_SUPABASE_URL  || window.VITE_SUPABASE_URL  || '';
  const SUPABASE_ANON = window.RE_SUPABASE_ANON || window.VITE_SUPABASE_ANON_KEY || '';

  let _state = {
    user: null,
    conversations: [],
    selectedConvId: null,
    messages: [],
    lastTs: null,
    pollingInterval: null,
    realtimeChannel: null,
    supabase: null,
    orgData: { departments: [], members: [] },
    view: 'conversations', // 'conversations' | 'tickets'
    filter: 'open'
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function authH() {
    const token = localStorage.getItem('re_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API_BASE + path, { headers: authH(), ...opts });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `${Math.floor(diff/60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  // ─── Realtime ──────────────────────────────────────────────────────────────

  function subscribeToConversation(convId) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    try {
      const { createClient } = window.supabase || {};
      if (!createClient) return;
      if (!_state.supabase) _state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

      if (_state.realtimeChannel) {
        _state.supabase.removeChannel(_state.realtimeChannel);
      }

      _state.realtimeChannel = _state.supabase
        .channel(`admin-chat:${convId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 're_chat_messages',
          filter: `conversation_id=eq.${convId}`,
        }, (payload) => {
          const msg = payload.new;
          if (!_state.messages.find(m => m.id === msg.id)) {
            _state.messages.push(msg);
            _state.lastTs = msg.created_at;
            renderChatPanel();
          }
        })
        .subscribe();
    } catch (e) {
      console.warn('[RecuperaChat Admin] Realtime error:', e.message);
    }
  }

  // ─── Carregamento de dados ─────────────────────────────────────────────────

  async function loadConversations(status = _state.filter) {
    _state.filter = status;
    const qs = status ? `?status=${status}` : '';
    const data = await apiFetch(`/api/admin/chat/conversations${qs}`);
    _state.conversations = data.conversations || [];
    renderConversationList();
  }

  async function selectConversation(convId) {
    _state.selectedConvId = convId;
    _state.messages = [];
    _state.lastTs = null;

    // Marca como lida
    apiFetch(`/api/admin/chat/conversations/${convId}/read`, { method: 'POST', body: '{}' }).catch(() => {});

    // Carrega mensagens
    const data = await apiFetch(`/api/admin/chat/conversations/${convId}/messages`);
    _state.messages = data.messages || [];
    if (_state.messages.length) {
      _state.lastTs = _state.messages[_state.messages.length - 1].created_at;
    }

    // Carrega dados da organização (departamentos/membros)
    const conv = _state.conversations.find(c => c.id === convId);
    if (conv?.client_id) {
      loadOrgData(conv.client_id);
    }

    renderChatPanel();
    renderDetailsSidebar();
    subscribeToConversation(convId);
  }

  async function loadOrgData(clientId) {
    try {
      const data = await apiFetch(`/api/admin/chat/client/${clientId}/org-data`);
      _state.orgData = data;
      renderDetailsSidebar();
    } catch (e) {
      console.error('[RecuperaChat Admin] OrgData error:', e.message);
    }
  }

  // ─── Renderização ──────────────────────────────────────────────────────────

  function renderConversationList() {
    const sidebar = document.getElementById('sec-recuperachat');
    if (!sidebar) return;

    // Garantir estrutura 3 colunas
    if (!document.querySelector('.rc-admin-workspace')) {
      sidebar.innerHTML = `
        <div class="rc-admin-workspace">
          <div class="rc-admin-conv-sidebar">
            <div class="rc-admin-conv-sidebar-head">
              <span>Conversas</span>
              <button class="btn btn-sm btn-primary" onclick="window.RCAdmin.showNewConvModal()">+</button>
            </div>
            <div class="rc-status-filters">
              <button class="rc-filter-btn ${_state.filter === 'open' ? 'rc-active' : ''}" onclick="window.RCAdmin.loadConversations('open')">Abertas</button>
              <button class="rc-filter-btn ${_state.filter === 'resolved' ? 'rc-active' : ''}" onclick="window.RCAdmin.loadConversations('resolved')">Resolvidas</button>
              <button class="rc-filter-btn ${_state.filter === 'all' ? 'rc-active' : ''}" onclick="window.RCAdmin.loadConversations('all')">Todas</button>
            </div>
            <div class="rc-admin-conv-list" id="rc-admin-conv-list"></div>
          </div>
          <div class="rc-admin-chat-panel" id="rc-admin-chat-panel">
            <div class="rc-admin-placeholder">Selecione uma conversa para começar</div>
          </div>
          <div class="rc-admin-details-sidebar" id="rc-admin-details-sidebar">
            <div class="rc-admin-placeholder">Detalhes do Cliente</div>
          </div>
        </div>
        <div id="rc-convert-modal" class="rc-modal rc-hidden"></div>
        <div id="rc-new-conv-modal" class="rc-modal rc-hidden"></div>
      `;
    }

    const container = document.getElementById('rc-admin-conv-list');
    if (!container) return;

    if (!_state.conversations.length) {
      container.innerHTML = '<div class="rc-admin-empty">Nenhuma conversa encontrada.</div>';
      return;
    }

    container.innerHTML = _state.conversations.map(conv => {
      const client = conv.client || {};
      const isSelected = conv.id === _state.selectedConvId;
      const ticket = conv.ticket?.[0];
      
      return `<div class="rc-admin-conv-item ${isSelected ? 'rc-selected' : ''}" 
                   onclick="window.RCAdmin.selectConversation('${conv.id}')">
        <div class="rc-admin-conv-name">${escHtml(client.name || 'Cliente')}</div>
        <div class="rc-admin-conv-company">${escHtml(client.company || '')}</div>
        <div class="rc-admin-conv-meta">
          <span class="rc-badge ${conv.status === 'open' ? 'rc-badge-green' : 'rc-badge-gray'}">${conv.status}</span>
          ${ticket ? `<span class="rc-badge rc-badge-yellow">#${ticket.ticket_number}</span>` : ''}
          <span class="rc-admin-conv-time">${relativeTime(conv.updated_at)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function renderChatPanel() {
    const panel = document.getElementById('rc-admin-chat-panel');
    if (!panel) return;

    const conv = _state.conversations.find(c => c.id === _state.selectedConvId);
    const client = conv?.client || {};

    panel.innerHTML = `
      <div class="rc-admin-chat-header">
        <div>
          <div class="rc-admin-chat-title">${escHtml(client.name || 'Cliente')}</div>
          <div class="rc-admin-chat-sub">${escHtml(client.company || '')}</div>
        </div>
        <div class="rc-admin-chat-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.RCAdmin.showConvertToTicket()">
            ${conv?.ticket?.[0] ? 'Ver Chamado' : 'Criar Chamado'}
          </button>
          <select onchange="window.RCAdmin.updateStatus(this.value)" class="rc-status-select">
            <option value="open" ${conv?.status === 'open' ? 'selected' : ''}>Aberta</option>
            <option value="snoozed" ${conv?.status === 'snoozed' ? 'selected' : ''}>Pausar</option>
            <option value="resolved" ${conv?.status === 'resolved' ? 'selected' : ''}>Resolver</option>
          </select>
        </div>
      </div>

      <div class="rc-admin-messages" id="rc-admin-messages">
        ${_state.messages.map(m => {
          const isAdmin = m.sender_role === 'admin';
          const isSystem = m.sender_role === 'system' || m.sender_role === 'ai';
          const cls = isSystem ? 'rc-msg-system' : isAdmin ? 'rc-msg-self' : 'rc-msg-other';
          const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return `<div class="rc-msg ${cls}">
            <div class="rc-msg-bubble">${escHtml(m.content)}</div>
            <div class="rc-msg-time">${time}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="rc-admin-input-area">
        <textarea id="rc-admin-input" placeholder="Responder ao cliente..." rows="2"></textarea>
        <button class="btn btn-primary" onclick="window.RCAdmin.sendMessage()">Enviar</button>
      </div>
    `;

    const msgContainer = document.getElementById('rc-admin-messages');
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function renderDetailsSidebar() {
    const sidebar = document.getElementById('rc-admin-details-sidebar');
    if (!sidebar) return;

    const conv = _state.conversations.find(c => c.id === _state.selectedConvId);
    if (!conv) return;

    const client = conv.client || {};
    const ticket = conv.ticket?.[0];

    sidebar.innerHTML = `
      <div>
        <div class="rc-detail-section-title">Informações do Cliente</div>
        <div class="rc-detail-card">
          <div class="rc-detail-row"><span class="rc-detail-label">Nome:</span> <span class="rc-detail-value">${escHtml(client.name)}</span></div>
          <div class="rc-detail-row"><span class="rc-detail-label">Empresa:</span> <span class="rc-detail-value">${escHtml(client.company)}</span></div>
          <div class="rc-detail-row"><span class="rc-detail-label">E-mail:</span> <span class="rc-detail-value">${escHtml(client.email)}</span></div>
        </div>
      </div>

      <div>
        <div class="rc-detail-section-title">Chamado Vinculado</div>
        <div class="rc-detail-card">
          ${ticket ? `
            <div class="rc-detail-row"><span class="rc-detail-label">Número:</span> <span class="rc-detail-value">#${ticket.ticket_number}</span></div>
            <div class="rc-detail-row"><span class="rc-detail-label">Status:</span> <span class="rc-badge rc-badge-yellow">${ticket.status}</span></div>
            <div class="rc-detail-row"><span class="rc-detail-label">Prioridade:</span> <span class="rc-detail-value">${ticket.priority}</span></div>
          ` : '<p class="rc-admin-empty" style="padding:0">Nenhum chamado vinculado.</p>'}
        </div>
      </div>

      <div>
        <div class="rc-detail-section-title">Organização / Departamentos</div>
        <div class="rc-detail-card">
          ${_state.orgData.departments.length ? 
            _state.orgData.departments.map(d => `<div class="rc-detail-row"><span class="rc-detail-value">${escHtml(d.name)}</span></div>`).join('')
            : '<p class="rc-admin-empty" style="padding:0">Sem departamentos.</p>'
          }
        </div>
      </div>

      <div>
        <div class="rc-detail-section-title">Membros Ativos</div>
        <div class="rc-detail-card">
          ${_state.orgData.members.length ? 
            _state.orgData.members.map(m => `<div class="rc-detail-row"><span class="rc-detail-value">${escHtml(m.name)}</span> <span class="rc-detail-label">${m.role}</span></div>`).join('')
            : '<p class="rc-admin-empty" style="padding:0">Sem membros.</p>'
          }
        </div>
      </div>
    `;
  }

  // ─── Ações ─────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const input = document.getElementById('rc-admin-input');
    const content = input?.value?.trim();
    if (!content || !_state.selectedConvId) return;
    input.value = '';
    try {
      await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      // O realtime cuidará da renderização se configurado, senão fazemos polling/manual
      if (!_state.supabase) await selectConversation(_state.selectedConvId);
    } catch (e) {
      input.value = content;
      if (typeof showToast === 'function') showToast('Erro ao enviar.', 'error');
    }
  }

  async function updateStatus(status) {
    try {
      await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadConversations();
      if (typeof showToast === 'function') showToast('Status atualizado.', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro ao atualizar.', 'error');
    }
  }

  function showNewConvModal() {
    const modal = document.getElementById('rc-new-conv-modal');
    modal.innerHTML = `
      <div class="rc-modal-box">
        <div class="rc-modal-title">Iniciar Nova Conversa</div>
        <label>Cliente</label>
        <select id="rc-new-client-id" class="rc-input">
          <option value="">Carregando clientes...</option>
        </select>
        <label>Assunto</label>
        <input type="text" id="rc-new-subject" placeholder="Ex: Dúvida sobre Onboarding" class="rc-input"/>
        <label>Mensagem Inicial</label>
        <textarea id="rc-new-msg" rows="3" class="rc-input" placeholder="Olá, como podemos ajudar?"></textarea>
        <div class="rc-modal-actions">
          <button class="btn btn-secondary" onclick="window.RCAdmin.hideModals()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.RCAdmin.createNewConversation()">Iniciar Chat</button>
        </div>
      </div>
    `;
    modal.classList.remove('rc-hidden');
    loadClientsForModal();
  }

  async function loadClientsForModal() {
    try {
      const data = await apiFetch('/api/admin/clients');
      const select = document.getElementById('rc-new-client-id');
      if (select) {
        select.innerHTML = (data.clients || []).map(c => `<option value="${c.id}">${escHtml(c.company || c.name)} (${c.email})</option>`).join('');
      }
    } catch (e) {
      console.error('Erro ao carregar clientes:', e);
    }
  }

  async function createNewConversation() {
    const client_id = document.getElementById('rc-new-client-id').value;
    const subject = document.getElementById('rc-new-subject').value;
    const initial_message = document.getElementById('rc-new-msg').value;

    if (!client_id) return;

    try {
      const data = await apiFetch('/api/admin/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ client_id, subject, initial_message })
      });
      hideModals();
      await loadConversations('open');
      selectConversation(data.conversation.id);
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro ao criar conversa.', 'error');
    }
  }

  function showConvertToTicket() {
    const modal = document.getElementById('rc-convert-modal');
    const conv = _state.conversations.find(c => c.id === _state.selectedConvId);
    
    modal.innerHTML = `
      <div class="rc-modal-box">
        <div class="rc-modal-title">Converter em Chamado</div>
        <label>Assunto</label>
        <input type="text" id="rc-ticket-subject" value="${escHtml(conv?.subject || '')}" class="rc-input"/>
        <label>Descrição</label>
        <textarea id="rc-ticket-desc" rows="4" class="rc-input" placeholder="Descreva o problema..."></textarea>
        <label>Prioridade</label>
        <select id="rc-ticket-priority" class="rc-input">
          <option value="low">Baixa</option>
          <option value="normal" selected>Normal</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
        <div class="rc-modal-actions">
          <button class="btn btn-secondary" onclick="window.RCAdmin.hideModals()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.RCAdmin.convertToTicket()">Criar Chamado</button>
        </div>
      </div>
    `;
    modal.classList.remove('rc-hidden');
  }

  async function convertToTicket() {
    const subject = document.getElementById('rc-ticket-subject').value;
    const description = document.getElementById('rc-ticket-desc').value;
    const priority = document.getElementById('rc-ticket-priority').value;

    try {
      await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/convert-to-ticket`, {
        method: 'POST',
        body: JSON.stringify({ subject, description, priority })
      });
      hideModals();
      await loadConversations();
      await selectConversation(_state.selectedConvId);
      if (typeof showToast === 'function') showToast('Chamado criado!', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro ao criar chamado.', 'error');
    }
  }

  function hideModals() {
    document.querySelectorAll('.rc-modal').forEach(m => m.classList.add('rc-hidden'));
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  window.RCAdmin = {
    init: (user) => { _state.user = user; loadConversations(); },
    loadConversations,
    selectConversation,
    sendMessage,
    updateStatus,
    showNewConvModal,
    createNewConversation,
    showConvertToTicket,
    convertToTicket,
    hideModals
  };

})();
