/**
 * RecuperaChat Admin — Painel de Chat e Suporte para Consultores
 * Gerencia conversas, tickets e integração com IA no painel admin
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
    view: 'conversations', // 'conversations' | 'tickets'
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

  function startPolling(convId) {
    if (_state.pollingInterval) clearInterval(_state.pollingInterval);
    _state.pollingInterval = setInterval(async () => {
      if (!_state.selectedConvId) return;
      try {
        const since = _state.lastTs || new Date(0).toISOString();
        const data = await apiFetch(`/api/admin/chat/conversations/${convId}/messages?since=${encodeURIComponent(since)}`);
        const newMsgs = (data.messages || []).filter(m => !_state.messages.find(x => x.id === m.id));
        if (newMsgs.length) {
          _state.messages.push(...newMsgs);
          _state.lastTs = newMsgs[newMsgs.length - 1].created_at;
          renderChatPanel();
        }
      } catch (e) {
        console.warn('[RecuperaChat Admin] Polling error:', e.message);
      }
    }, 3000);
  }

  // ─── Carregamento de dados ─────────────────────────────────────────────────

  async function loadConversations(status = null) {
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

    renderChatPanel();
    subscribeToConversation(convId);
    if (!_state.realtimeChannel) startPolling(convId);
  }

  // ─── Renderização ──────────────────────────────────────────────────────────

  function renderConversationList() {
    const container = document.getElementById('rc-admin-conv-list');
    if (!container) return;

    if (!_state.conversations.length) {
      container.innerHTML = '<div class="rc-admin-empty">Nenhuma conversa encontrada.</div>';
      return;
    }

    container.innerHTML = _state.conversations.map(conv => {
      const client = conv.re_users || {};
      const isSelected = conv.id === _state.selectedConvId;
      const statusBadge = {
        open: '<span class="rc-badge rc-badge-green">Aberta</span>',
        resolved: '<span class="rc-badge rc-badge-gray">Resolvida</span>',
        snoozed: '<span class="rc-badge rc-badge-yellow">Pausada</span>',
      }[conv.status] || '';

      return `<div class="rc-admin-conv-item ${isSelected ? 'rc-selected' : ''}" 
                   onclick="window.RCAdmin.selectConversation('${conv.id}')">
        <div class="rc-admin-conv-name">${escHtml(client.name || 'Cliente')}</div>
        <div class="rc-admin-conv-company">${escHtml(client.company || '')}</div>
        <div class="rc-admin-conv-meta">
          ${statusBadge}
          <span class="rc-admin-conv-time">${relativeTime(conv.updated_at)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function renderChatPanel() {
    const panel = document.getElementById('rc-admin-chat-panel');
    if (!panel) return;

    const conv = _state.conversations.find(c => c.id === _state.selectedConvId);
    const client = conv?.re_users || {};

    panel.innerHTML = `
      <div class="rc-admin-chat-header">
        <div>
          <div class="rc-admin-chat-title">${escHtml(client.name || 'Cliente')}</div>
          <div class="rc-admin-chat-sub">${escHtml(client.company || '')}</div>
        </div>
        <div class="rc-admin-chat-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.RCAdmin.showConvertToTicket()">
            Converter em Chamado
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.RCAdmin.requestAISummary()">
            Resumo IA
          </button>
          <select onchange="window.RCAdmin.updateStatus(this.value)" class="rc-status-select">
            <option value="open" ${conv?.status === 'open' ? 'selected' : ''}>Aberta</option>
            <option value="snoozed" ${conv?.status === 'snoozed' ? 'selected' : ''}>Pausar</option>
            <option value="resolved" ${conv?.status === 'resolved' ? 'selected' : ''}>Resolver</option>
          </select>
        </div>
      </div>

      <div class="rc-admin-messages" id="rc-admin-messages">
        ${_state.messages.length === 0
          ? '<div class="rc-admin-empty">Nenhuma mensagem ainda.</div>'
          : _state.messages.map(m => {
              const isAdmin = m.sender_role === 'admin';
              const isSystem = m.sender_role === 'system' || m.sender_role === 'ai';
              const cls = isSystem ? 'rc-msg-system' : isAdmin ? 'rc-msg-self' : 'rc-msg-other';
              const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              return `<div class="rc-msg ${cls}">
                <div class="rc-msg-bubble">${escHtml(m.content)}</div>
                <div class="rc-msg-time">${time}</div>
              </div>`;
            }).join('')
        }
      </div>

      <div class="rc-admin-input-area">
        <textarea id="rc-admin-input" placeholder="Responder ao cliente..." rows="2"></textarea>
        <button class="btn btn-primary" onclick="window.RCAdmin.sendMessage()">Enviar</button>
      </div>

      <div id="rc-convert-modal" class="rc-modal rc-hidden">
        <div class="rc-modal-box">
          <div class="rc-modal-title">Converter em Chamado</div>
          <label>Assunto</label>
          <input type="text" id="rc-ticket-subject" placeholder="Assunto do chamado" class="rc-input"/>
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
            <button class="btn btn-secondary" onclick="window.RCAdmin.hideConvertToTicket()">Cancelar</button>
            <button class="btn btn-primary" onclick="window.RCAdmin.convertToTicket()">Criar Chamado</button>
          </div>
        </div>
      </div>
    `;

    // Scroll para o final
    const msgContainer = document.getElementById('rc-admin-messages');
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

    // Evento de Enter no textarea
    const input = document.getElementById('rc-admin-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          window.RCAdmin.sendMessage();
        }
      });
    }
  }

  // ─── Ações ─────────────────────────────────────────────────────────────────

  async function sendMessage() {
    const input = document.getElementById('rc-admin-input');
    const content = input?.value?.trim();
    if (!content || !_state.selectedConvId) return;
    input.value = '';
    try {
      const data = await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      if (!_state.realtimeChannel) {
        _state.messages.push(data.message);
        _state.lastTs = data.message.created_at;
        renderChatPanel();
      }
    } catch (e) {
      console.error('[RecuperaChat Admin] sendMessage error:', e.message);
      input.value = content;
      if (typeof showToast === 'function') showToast('Erro ao enviar mensagem.', 'error');
    }
  }

  async function updateStatus(status) {
    if (!_state.selectedConvId) return;
    try {
      await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadConversations();
      if (typeof showToast === 'function') showToast('Status atualizado.', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro ao atualizar status.', 'error');
    }
  }

  function showConvertToTicket() {
    const modal = document.getElementById('rc-convert-modal');
    if (modal) modal.classList.remove('rc-hidden');
  }

  function hideConvertToTicket() {
    const modal = document.getElementById('rc-convert-modal');
    if (modal) modal.classList.add('rc-hidden');
  }

  async function convertToTicket() {
    const subject = document.getElementById('rc-ticket-subject')?.value?.trim();
    const description = document.getElementById('rc-ticket-desc')?.value?.trim();
    const priority = document.getElementById('rc-ticket-priority')?.value || 'normal';

    if (!subject) {
      if (typeof showToast === 'function') showToast('Informe o assunto do chamado.', 'error');
      return;
    }
    if (!description) {
      if (typeof showToast === 'function') showToast('Informe a descrição do chamado.', 'error');
      return;
    }

    try {
      const data = await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/convert-to-ticket`, {
        method: 'POST',
        body: JSON.stringify({ subject, description, priority }),
      });
      hideConvertToTicket();
      if (typeof showToast === 'function') showToast(`Chamado #${data.ticket.ticket_number} criado com sucesso!`, 'success');
      // Recarrega mensagens para mostrar a mensagem de sistema
      await selectConversation(_state.selectedConvId);
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || 'Erro ao criar chamado.', 'error');
    }
  }

  async function requestAISummary() {
    if (!_state.selectedConvId) return;
    if (typeof showToast === 'function') showToast('Gerando resumo com IA...', 'info');
    try {
      const data = await apiFetch(`/api/admin/chat/conversations/${_state.selectedConvId}/ai-summary`, {
        method: 'POST',
        body: '{}',
      });
      if (data.summary) {
        if (typeof showToast === 'function') showToast('Resumo gerado!', 'success');
        alert(`Resumo IA:\n\n${data.summary}`);
      } else if (data.warning) {
        if (typeof showToast === 'function') showToast(data.warning, 'warning');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || 'Erro ao gerar resumo.', 'error');
    }
  }

  // ─── Inicialização ─────────────────────────────────────────────────────────

  async function init(user) {
    _state.user = user;
    await loadConversations();
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  window.RCAdmin = {
    init,
    loadConversations,
    selectConversation,
    sendMessage,
    updateStatus,
    showConvertToTicket,
    hideConvertToTicket,
    convertToTicket,
    requestAISummary,
  };

  console.info('[RecuperaChat Admin] módulo carregado v1.0');
})();
