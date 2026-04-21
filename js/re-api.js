'use strict';
/**
 * re-api.js — Camada centralizada de API
 * Centraliza fetch, AbortController, autenticação e tratamento de erro.
 * Deve ser carregado após re-core.js.
 */
(function () {
  'use strict';

  // ── CSS de skeleton (injetado uma única vez) ──────────────────────────────
  var SKELETON_CSS_ID = 're-skeleton-styles';
  function _injectSkeletonCSS() {
    if (document.getElementById(SKELETON_CSS_ID)) return;
    var style = document.createElement('style');
    style.id = SKELETON_CSS_ID;
    style.textContent = [
      '.re-skeleton-line {',
      '  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);',
      '  background-size: 200% 100%;',
      '  animation: re-shimmer 1.5s infinite;',
      '  border-radius: 4px;',
      '  height: 14px;',
      '  margin-bottom: 8px;',
      '}',
      '.re-skeleton-line--title { height: 20px; width: 60%; }',
      '.re-skeleton-line--body  { width: 100%; }',
      '.re-skeleton-line--short { width: 45%; }',
      '.re-skeleton-card {',
      '  padding: 16px;',
      '  border: 1px solid #f0f0f0;',
      '  border-radius: 8px;',
      '  margin-bottom: 12px;',
      '}',
      '.re-skeleton-row {',
      '  display: flex;',
      '  gap: 12px;',
      '  padding: 12px 0;',
      '  border-bottom: 1px solid #f5f5f5;',
      '}',
      '.re-skeleton-cell {',
      '  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);',
      '  background-size: 200% 100%;',
      '  animation: re-shimmer 1.5s infinite;',
      '  border-radius: 4px;',
      '  height: 14px;',
      '  flex: 1;',
      '}',
      '.re-skeleton-cell--sm { flex: 0 0 60px; }',
      '.re-skeleton-cell--md { flex: 0 0 120px; }',
      '@keyframes re-shimmer {',
      '  0%   { background-position: -200% 0; }',
      '  100% { background-position:  200% 0; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Helpers de skeleton HTML ──────────────────────────────────────────────
  function _skeletonCard() {
    return (
      '<div class="re-skeleton-card">' +
        '<div class="re-skeleton-line re-skeleton-line--title"></div>' +
        '<div class="re-skeleton-line re-skeleton-line--body"></div>' +
        '<div class="re-skeleton-line re-skeleton-line--body re-skeleton-line--short"></div>' +
      '</div>'
    );
  }

  function _skeletonRow() {
    return (
      '<div class="re-skeleton-row">' +
        '<div class="re-skeleton-cell re-skeleton-cell--sm"></div>' +
        '<div class="re-skeleton-cell re-skeleton-cell--md"></div>' +
        '<div class="re-skeleton-cell"></div>' +
        '<div class="re-skeleton-cell re-skeleton-cell--md"></div>' +
        '<div class="re-skeleton-cell re-skeleton-cell--sm"></div>' +
      '</div>'
    );
  }

  function _skeletonListItem() {
    return (
      '<div class="re-skeleton-row">' +
        '<div class="re-skeleton-cell re-skeleton-cell--sm"></div>' +
        '<div class="re-skeleton-cell"></div>' +
      '</div>'
    );
  }

  function _skeletonDetail() {
    return (
      '<div class="re-skeleton-card">' +
        '<div class="re-skeleton-line re-skeleton-line--title"></div>' +
        '<div class="re-skeleton-line re-skeleton-line--body"></div>' +
        '<div class="re-skeleton-line re-skeleton-line--body"></div>' +
        '<div class="re-skeleton-line re-skeleton-line--body re-skeleton-line--short"></div>' +
      '</div>'
    );
  }

  // ── Núcleo de API ─────────────────────────────────────────────────────────
  var _controllers = {};

  /**
   * Fetch centralizado.
   * Retorna sempre { ok, status, data } — nunca lança em erros HTTP.
   * Lança apenas em erros de rede (sem resposta).
   */
  async function _apiFetch(url, options) {
    options = options || {};
    var method  = (options.method  || 'GET').toUpperCase();
    var key     = options.key     || null;
    var signal  = options.signal  || null;

    // AbortController: nomeado (key) ou interno
    var controller = null;
    if (!signal) {
      if (key) {
        // cancela requisição anterior com a mesma key
        if (_controllers[key]) {
          try { _controllers[key].abort(); } catch (_) {}
        }
        controller = new AbortController();
        _controllers[key] = controller;
      } else {
        controller = new AbortController();
      }
      signal = controller.signal;
    }

    // Headers de autenticação (lazy — acessa REShared no momento da chamada)
    var authHeaders = {};
    if (window.REShared && typeof window.REShared.buildAuthHeaders === 'function') {
      try { authHeaders = window.REShared.buildAuthHeaders() || {}; } catch (_) {}
    }

    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      authHeaders,
      options.headers || {}
    );

    // Monta opções do fetch
    var fetchOptions = {
      method:  method,
      headers: headers,
      signal:  signal
    };

    // credentials: include para rotas /api/
    if (typeof url === 'string' && url.startsWith('/api/')) {
      fetchOptions.credentials = 'include';
    } else if (options.credentials) {
      fetchOptions.credentials = options.credentials;
    }

    // Body
    if (options.body !== undefined) {
      fetchOptions.body = options.body;
    }

    var response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (networkError) {
      // Erro de rede — emite evento e relança
      if (window.RE && window.RE.events) {
        window.RE.events.emit('api:error', { url: url, method: method, error: networkError });
      }
      throw networkError;
    } finally {
      // Remove controller nomeado do mapa quando terminar
      if (key && _controllers[key] && _controllers[key] === controller) {
        delete _controllers[key];
      }
    }

    // Trata 401
    if (response.status === 401) {
      if (window.RE && window.RE.events) {
        window.RE.events.emit('auth:expired');
      }
    }

    // Parse do body
    var data = null;
    try {
      if (typeof window.readApiResponse === 'function') {
        data = await window.readApiResponse(response.clone());
      } else {
        data = await response.json();
      }
    } catch (_) {
      data = null;
    }

    return {
      ok:     response.ok,
      status: response.status,
      data:   data
    };
  }

  // ── Shorthands ────────────────────────────────────────────────────────────
  function _get(url, options) {
    return _apiFetch(url, Object.assign({}, options, { method: 'GET' }));
  }

  function _post(url, body, options) {
    return _apiFetch(url, Object.assign({}, options, {
      method: 'POST',
      body:   JSON.stringify(body)
    }));
  }

  function _put(url, body, options) {
    return _apiFetch(url, Object.assign({}, options, {
      method: 'PUT',
      body:   JSON.stringify(body)
    }));
  }

  function _patch(url, body, options) {
    return _apiFetch(url, Object.assign({}, options, {
      method: 'PATCH',
      body:   JSON.stringify(body)
    }));
  }

  function _delete(url, options) {
    return _apiFetch(url, Object.assign({}, options, { method: 'DELETE' }));
  }

  // ── abort helpers ─────────────────────────────────────────────────────────
  function _abort(key) {
    if (_controllers[key]) {
      try { _controllers[key].abort(); } catch (_) {}
      delete _controllers[key];
    }
  }

  function _abortAll() {
    Object.keys(_controllers).forEach(function (k) {
      try { _controllers[k].abort(); } catch (_) {}
    });
    _controllers = {};
  }

  // ── skeleton ──────────────────────────────────────────────────────────────
  /**
   * Injeta HTML de skeleton em `container`.
   * @param {HTMLElement|string} container  elemento ou seletor CSS
   * @param {number}             rows       quantidade de itens
   * @param {'table'|'cards'|'list'|'detail'} type
   */
  function _skeleton(container, rows, type) {
    _injectSkeletonCSS();

    var el = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!el) return;

    rows = rows || 4;
    type = type || 'cards';

    var html = '';
    for (var i = 0; i < rows; i++) {
      switch (type) {
        case 'table':  html += _skeletonRow();      break;
        case 'list':   html += _skeletonListItem(); break;
        case 'detail': html += _skeletonDetail();   break;
        case 'cards':
        default:       html += _skeletonCard();     break;
      }
    }

    el.innerHTML = html;
  }

  // ── Listener auth:expired ─────────────────────────────────────────────────
  // Registrado após RE estar disponível; usa setTimeout para garantir
  // que re-core.js já configurou RE.events antes.
  function _registerAuthExpiredListener() {
    if (!window.RE || !window.RE.events) return;
    window.RE.events.on('auth:expired', function () {
      if (!window.location.pathname.includes('/login')) {
        if (window.REShared && typeof window.REShared.redirectToRoute === 'function') {
          window.REShared.redirectToRoute('login');
        } else {
          window.location.href = '/login.html';
        }
      }
    });
  }

  // ── Montagem do namespace ─────────────────────────────────────────────────
  if (!window.RE) {
    window.RE = {};
  }

  window.RE.api = {
    _controllers: _controllers,

    fetch:    _apiFetch,
    get:      _get,
    post:     _post,
    put:      _put,
    patch:    _patch,
    'delete': _delete,

    abort:    _abort,
    abortAll: _abortAll,

    skeleton: _skeleton
  };

  // Registra listener quando DOM estiver pronto (garante re-core.js carregado)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _registerAuthExpiredListener);
  } else {
    _registerAuthExpiredListener();
  }

  console.info('[RE:api] loaded');

}());
