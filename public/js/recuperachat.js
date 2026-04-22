/**
 * RecuperaChat — Módulo de Chat e Suporte Multitenant
 * Substitui o Freshchat com Realtime nativo via Supabase
 *
 * Uso:
 *   window.RecuperaChat.boot(user)  — inicializa o widget para o cliente
 *   window.RecuperaChat.destroy()   — remove o widget
 */
(function () {
  'use strict';

  // ─── Configuração ──────────────────────────────────────────────────────────

  const API_BASE = window.RE_API_BASE || '';
  const SUPABASE_URL  = window.RE_SUPABASE_URL  || window.VITE_SUPABASE_URL  || '';
  const SUPABASE_ANON = window.RE_SUPABASE_ANON || window.VITE_SUPABASE_ANON_KEY || '';

  let _state = {
    user: null,
    conversationId: null,
    messages: [],
    lastTs: null,
    pollingInterval: null,
    realtimeChannel: null,
    supabase: null,
    isOpen: false,
  };

  // ─── Helpers de API ────────────────────────────────────────────────────────

  function authHeaders() {
    const token = localStorage.getItem('re_token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      headers: authHeaders(),
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ─── Realtime via Supabase ─────────────────────────────────────────────────

  function initRealtime(conversationId) {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      console.info('[RecuperaChat] Realtime indisponível — usando polling.');
      return;
    }
    try {
      const { createClient } = window.supabase || {};
      if (!createClient) {
        console.warn('[RecuperaChat] supabase-js não carregado, usando polling.');
        return;
      }
      _state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
      _state.realtimeChannel = _state.supabase
        .channel(`chat:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 're_chat_messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const msg = payload.new;
            if (!_state.messages.find(m => m.id === msg.id)) {
              _state.messages.push(msg);
              _state.lastTs = msg.created_at;
              renderMessages();
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.info('[RecuperaChat] Realtime conectado para conversa', conversationId);
            // Cancela polling se Realtime estiver ativo
            if (_state.pollingInterval) {
              clearInterval(_state.pollingInterval);
              _state.pollingInterval = null;
            }
          }
        });
    } catch (e) {
      console.warn('[RecuperaChat] Falha ao iniciar Realtime:', e.message);
    }
  }

  // ─── Polling (fallback) ────────────────────────────────────────────────────

  function startPolling(conversationId) {
    if (_state.pollingInterval) return;
    _state.pollingInterval = setInterval(async () => {
      try {
        const since = _state.lastTs || new Date(0).toISOString();
        const data = await apiFetch(`/api/chat/conversations/${conversationId}/messages?since=${encodeURIComponent(since)}`);
        const newMsgs = (data.messages || []).filter(m => !_state.messages.find(x => x.id === m.id));
        if (newMsgs.length) {
          _state.messages.push(...newMsgs);
          _state.lastTs = newMsgs[newMsgs.length - 1].created_at;
          renderMessages();
        }
      } catch (e) {
        console.warn('[RecuperaChat] Polling error:', e.message);
      }
    }, 3000);
  }

  // ─── Renderização ──────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderMessages() {
    const container = document.getElementById('recuperachat-messages');
    if (!container) return;
    const userId = _state.user?.id;
    container.innerHTML = _state.messages.map(m => {
      const isSelf = m.sender_id === userId;
      const isSystem = m.sender_role === 'system' || m.sender_role === 'ai';
      const cls = isSystem ? 'rc-msg-system' : isSelf ? 'rc-msg-self' : 'rc-msg-other';
      const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `<div class="rc-msg ${cls}">
        <div class="rc-msg-bubble">${escHtml(m.content)}</div>
        <div class="rc-msg-time">${time}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  function renderWidget() {
    if (document.getElementById('recuperachat-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'recuperachat-widget';
    widget.innerHTML = `
      <style>
        #recuperachat-widget {
          position: fixed; bottom: 24px; right: 24px; z-index: 9999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #recuperachat-btn {
          width: 56px; height: 56px; border-radius: 50%;
          background: #1a56db; color: #fff; border: none; cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,.2); font-size: 22px;
          display: flex; align-items: center; justify-content: center;
          transition: transform .15s;
        }
        #recuperachat-btn:hover { transform: scale(1.08); }
        #recuperachat-panel {
          position: absolute; bottom: 68px; right: 0;
          width: 340px; max-height: 500px;
          background: #fff; border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,.15);
          display: flex; flex-direction: column; overflow: hidden;
        }
        #recuperachat-panel.rc-hidden { display: none; }
        #recuperachat-header {
          background: #1a56db; color: #fff; padding: 14px 16px;
          font-weight: 600; font-size: 15px; display: flex;
          align-items: center; justify-content: space-between;
        }
        #recuperachat-header span { font-size: 12px; opacity: .8; }
        #recuperachat-messages {
          flex: 1; overflow-y: auto; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
          background: #f8fafc; min-height: 200px;
        }
        .rc-msg { display: flex; flex-direction: column; max-width: 80%; }
        .rc-msg-self { align-self: flex-end; align-items: flex-end; }
        .rc-msg-other { align-self: flex-start; }
        .rc-msg-system { align-self: center; }
        .rc-msg-bubble {
          padding: 8px 12px; border-radius: 12px;
          font-size: 14px; line-height: 1.4; word-break: break-word;
        }
        .rc-msg-self .rc-msg-bubble { background: #1a56db; color: #fff; border-radius: 12px 12px 2px 12px; }
        .rc-msg-other .rc-msg-bubble { background: #e5e7eb; color: #111; border-radius: 12px 12px 12px 2px; }
        .rc-msg-system .rc-msg-bubble { background: #fef3c7; color: #92400e; font-size: 12px; border-radius: 6px; }
        .rc-msg-time { font-size: 10px; color: #9ca3af; margin-top: 2px; }
        #recuperachat-input-area {
          display: flex; gap: 8px; padding: 10px 12px;
          border-top: 1px solid #e5e7eb; background: #fff;
        }
        #recuperachat-input {
          flex: 1; border: 1px solid #d1d5db; border-radius: 8px;
          padding: 8px 10px; font-size: 14px; outline: none;
          resize: none; max-height: 80px;
        }
        #recuperachat-input:focus { border-color: #1a56db; }
        #recuperachat-send {
          background: #1a56db; color: #fff; border: none;
          border-radius: 8px; padding: 8px 14px; cursor: pointer;
          font-size: 14px; font-weight: 500;
        }
        #recuperachat-send:disabled { opacity: .5; cursor: not-allowed; }
        .rc-empty { text-align: center; color: #9ca3af; font-size: 13px; padding: 24px 0; }
        #recuperachat-unread {
          position: absolute; top: -4px; right: -4px;
          background: #ef4444; color: #fff; border-radius: 50%;
          width: 18px; height: 18px; font-size: 11px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        #recuperachat-unread.rc-hidden { display: none; }
      </style>

      <div id="recuperachat-panel" class="rc-hidden">
        <div id="recuperachat-header">
          <div>Suporte</div>
          <span id="recuperachat-status">Conectando...</span>
        </div>
        <div id="recuperachat-messages">
          <div class="rc-empty">Nenhuma mensagem ainda. Diga olá!</div>
        </div>
        <div id="recuperachat-input-area">
          <textarea id="recuperachat-input" placeholder="Digite sua mensagem..." rows="1"></textarea>
          <button id="recuperachat-send">Enviar</button>
        </div>
      </div>

      <button id="recuperachat-btn" title="Suporte">
        💬
        <span id="recuperachat-unread" class="rc-hidden">0</span>
      </button>
    `;

    document.body.appendChild(widget);

    // Eventos
    document.getElementById('recuperachat-btn').addEventListener('click', togglePanel);
    document.getElementById('recuperachat-send').addEventListener('click', sendMessage);
    document.getElementById('recuperachat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  function togglePanel() {
    const panel = document.getElementById('recuperachat-panel');
    if (!panel) return;
    _state.isOpen = !_state.isOpen;
    panel.classList.toggle('rc-hidden', !_state.isOpen);
    if (_state.isOpen && _state.conversationId) {
      markRead();
    }
  }

  async function markRead() {
    if (!_state.conversationId) return;
    try {
      await apiFetch(`/api/chat/conversations/${_state.conversationId}/read`, { method: 'POST', body: '{}' });
      setUnreadBadge(0);
    } catch (e) {
      console.warn('[RecuperaChat] markRead error:', e.message);
    }
  }

  function setUnreadBadge(count) {
    const badge = document.getElementById('recuperachat-unread');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('rc-hidden');
    } else {
      badge.classList.add('rc-hidden');
    }
  }

  async function sendMessage() {
    const input = document.getElementById('recuperachat-input');
    const btn = document.getElementById('recuperachat-send');
    const content = input?.value?.trim();
    if (!content || !_state.conversationId) return;

    btn.disabled = true;
    input.value = '';

    try {
      const data = await apiFetch(`/api/chat/conversations/${_state.conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      // Se Realtime não estiver ativo, adiciona localmente
      if (!_state.realtimeChannel) {
        _state.messages.push(data.message);
        _state.lastTs = data.message.created_at;
        renderMessages();
      }
    } catch (e) {
      console.error('[RecuperaChat] sendMessage error:', e.message);
      input.value = content; // Restaura o texto em caso de erro
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  // ─── Inicialização ─────────────────────────────────────────────────────────

  async function boot(user) {
    if (!user) return;
    _state.user = user;

    renderWidget();

    try {
      // Carrega ou cria a conversa aberta
      const convData = await apiFetch('/api/chat/conversation');
      _state.conversationId = convData.conversation.id;

      // Carrega histórico de mensagens
      const msgData = await apiFetch(`/api/chat/conversations/${_state.conversationId}/messages`);
      _state.messages = msgData.messages || [];
      if (_state.messages.length) {
        _state.lastTs = _state.messages[_state.messages.length - 1].created_at;
      }

      renderMessages();

      const statusEl = document.getElementById('recuperachat-status');
      if (statusEl) statusEl.textContent = 'Online';

      // Tenta Realtime primeiro, cai em polling
      initRealtime(_state.conversationId);
      if (!_state.realtimeChannel) {
        startPolling(_state.conversationId);
      }

    } catch (e) {
      console.error('[RecuperaChat] boot error:', e.message);
      const statusEl = document.getElementById('recuperachat-status');
      if (statusEl) statusEl.textContent = 'Erro de conexão';
    }
  }

  function destroy() {
    if (_state.pollingInterval) clearInterval(_state.pollingInterval);
    if (_state.realtimeChannel) _state.supabase?.removeChannel(_state.realtimeChannel);
    const widget = document.getElementById('recuperachat-widget');
    if (widget) widget.remove();
    _state = {
      user: null, conversationId: null, messages: [],
      lastTs: null, pollingInterval: null, realtimeChannel: null,
      supabase: null, isOpen: false,
    };
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  window.RecuperaChat = { boot, destroy, togglePanel };
  console.info('[RecuperaChat] módulo carregado v1.0');
})();
