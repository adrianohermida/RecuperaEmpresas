'use strict';
/**
 * re-core.js — Namespace, EventBus, Store e bridges
 * Carregado ANTES de todos os outros módulos (exceto config, runtime-diagnostics, api-base, shared-utils)
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Namespace
  // ---------------------------------------------------------------------------
  window.RE = window.RE || {};

  // ---------------------------------------------------------------------------
  // 2. RE.events — EventBus pub/sub
  // ---------------------------------------------------------------------------
  RE.events = RE.events || (function () {
    var _listeners = {}; // { eventName: [ { handler, once } ] }

    /** Constantes de eventos padrão */
    var EVT = Object.freeze({
      CLIENT_OPENED:      'client:opened',
      CLIENT_CLOSED:      'client:closed',
      CLIENT_DATA_UPDATED:'client:data_updated',
      MODAL_OPENED:       'modal:opened',
      MODAL_CLOSED:       'modal:closed',
      FORM_SAVED:         'form:saved',
      FORM_OPENED:        'form:opened',
      BOOKING_UPDATED:    'booking:updated',
      JOURNEY_UPDATED:    'journey:updated',
      SECTION_CHANGED:    'section:changed',
      AUTH_READY:         'auth:ready',
    });

    /**
     * Subscreve ao evento.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} função de cancelamento (unsub)
     */
    function on(event, handler) {
      if (typeof handler !== 'function') {
        console.warn('[RE:events] on() — handler must be a function', event);
        return function () {};
      }
      if (!_listeners[event]) _listeners[event] = [];
      var entry = { handler: handler, once: false };
      _listeners[event].push(entry);
      return function () { off(event, handler); };
    }

    /**
     * Cancela subscrição.
     * @param {string} event
     * @param {Function} handler
     */
    function off(event, handler) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function (e) {
        return e.handler !== handler;
      });
    }

    /**
     * Dispara evento para todos os subscribers.
     * @param {string} event
     * @param {*} payload
     */
    function emit(event, payload) {
      var entries = (_listeners[event] || []).slice(); // cópia para safe iteration
      entries.forEach(function (entry) {
        try {
          entry.handler(payload);
        } catch (err) {
          console.error('[RE:events] error in handler for "' + event + '"', err);
        }
        if (entry.once) off(event, entry.handler);
      });
    }

    /**
     * Subscreve uma única vez.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsub
     */
    function once(event, handler) {
      if (typeof handler !== 'function') {
        console.warn('[RE:events] once() — handler must be a function', event);
        return function () {};
      }
      if (!_listeners[event]) _listeners[event] = [];
      var entry = { handler: handler, once: true };
      _listeners[event].push(entry);
      return function () { off(event, handler); };
    }

    return { EVT: EVT, on: on, off: off, emit: emit, once: once };
  }());

  // ---------------------------------------------------------------------------
  // 3. RE.store — Store reativo
  // ---------------------------------------------------------------------------
  RE.store = RE.store || (function () {
    var _data = {};
    var _subs = {}; // { key: [ fn ] }

    /**
     * Define um valor e notifica subscribers da chave.
     * @param {string} key
     * @param {*} value
     */
    function set(key, value) {
      _data[key] = value;
      var fns = (_subs[key] || []).slice();
      fns.forEach(function (fn) {
        try { fn(value, key); }
        catch (err) { console.error('[RE:store] subscriber error for key "' + key + '"', err); }
      });
    }

    /**
     * Lê um valor do store.
     * @param {string} key
     * @param {*} [defaultValue]
     * @returns {*}
     */
    function get(key, defaultValue) {
      return Object.prototype.hasOwnProperty.call(_data, key) ? _data[key] : defaultValue;
    }

    /**
     * Subscreve a mudanças de uma chave.
     * @param {string} key
     * @param {Function} fn  — chamada com (newValue, key)
     * @returns {Function} unsub
     */
    function subscribe(key, fn) {
      if (typeof fn !== 'function') {
        console.warn('[RE:store] subscribe() — fn must be a function', key);
        return function () {};
      }
      if (!_subs[key]) _subs[key] = [];
      _subs[key].push(fn);
      return function () {
        if (!_subs[key]) return;
        _subs[key] = _subs[key].filter(function (f) { return f !== fn; });
      };
    }

    /**
     * Aplica uma função ao valor atual e salva o resultado.
     * @param {string} key
     * @param {Function} updaterFn  — recebe (currentValue) e retorna newValue
     */
    function update(key, updaterFn) {
      if (typeof updaterFn !== 'function') {
        console.warn('[RE:store] update() — updaterFn must be a function', key);
        return;
      }
      set(key, updaterFn(get(key)));
    }

    /**
     * Limpa todo o store. Usar com cuidado.
     */
    function reset() {
      _data = {};
      _subs = {};
    }

    return { set: set, get: get, subscribe: subscribe, update: update, reset: reset };
  }());

  // ---------------------------------------------------------------------------
  // 4. RE.modal — bridge para REAdminModal (queue pattern)
  // ---------------------------------------------------------------------------
  RE.modal = RE.modal || (function () {
    var _queue = []; // chamadas pendentes enquanto REAdminModal não está disponível
    var _flushed = false;

    /** Tenta descarregar a fila quando REAdminModal estiver disponível. */
    function _flush() {
      if (_flushed) return;
      if (!window.REAdminModal) return;
      _flushed = true;
      var pending = _queue.splice(0);
      pending.forEach(function (call) {
        try {
          var fn = window.REAdminModal[call.method];
          if (typeof fn === 'function') {
            fn.apply(window.REAdminModal, call.args);
          }
        } catch (err) {
          console.error('[RE:modal] error flushing queued call "' + call.method + '"', err);
        }
      });
    }

    /** Agenda varredura periódica para detectar quando REAdminModal é carregado. */
    function _waitForManager() {
      if (window.REAdminModal) { _flush(); return; }
      var attempts = 0;
      var interval = setInterval(function () {
        attempts++;
        if (window.REAdminModal) {
          clearInterval(interval);
          _flush();
        } else if (attempts >= 100) {
          // desiste após ~10 s (100 × 100 ms)
          clearInterval(interval);
          console.warn('[RE:modal] REAdminModal never loaded; queued calls discarded', _queue);
          _queue = [];
        }
      }, 100);
    }
    _waitForManager();

    /**
     * Delega ou enfileira uma chamada.
     * @param {string} method
     * @param {Array} args
     */
    function _dispatch(method, args) {
      if (window.REAdminModal && typeof window.REAdminModal[method] === 'function') {
        return window.REAdminModal[method].apply(window.REAdminModal, args);
      }
      _queue.push({ method: method, args: args });
    }

    /**
     * Abre um modal pelo nome.
     * @param {string} name
     * @param {Object} [props]
     * @param {Object} [options]
     */
    function open(name, props, options) {
      return _dispatch('open', [name, props, options]);
    }

    /**
     * Fecha um modal pelo id.
     * @param {string} id
     */
    function close(id) {
      return _dispatch('close', [id]);
    }

    /**
     * Fecha todos os modais abertos.
     * @param {Object} [options]
     */
    function closeAll(options) {
      return _dispatch('closeAll', [options]);
    }

    /**
     * Abre um modal estático (conteúdo inline já no DOM).
     * @param {string} id
     * @param {*} [source]
     */
    function openStatic(id, source) {
      return _dispatch('openStatic', [id, source]);
    }

    /**
     * Abre um dialog simples a partir de uma config.
     * @param {Object} config
     */
    function openDialog(config) {
      return _dispatch('openDialog', [config]);
    }

    /**
     * Subscreve a eventos do modal manager.
     * @param {Function} listener
     */
    function subscribe(listener) {
      return _dispatch('subscribe', [listener]);
    }

    return {
      open:       open,
      close:      close,
      closeAll:   closeAll,
      openStatic: openStatic,
      openDialog: openDialog,
      subscribe:  subscribe,
    };
  }());

  // ---------------------------------------------------------------------------
  // 5. RE.shared — bridge para REShared (lazy binding)
  // ---------------------------------------------------------------------------
  RE.shared = RE.shared || {
    buildAuthHeaders:   function () {
      return window.REShared && window.REShared.buildAuthHeaders
        ? window.REShared.buildAuthHeaders.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), {});
    },
    formatCurrencyBRL:  function () {
      return window.REShared && window.REShared.formatCurrencyBRL
        ? window.REShared.formatCurrencyBRL.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), '');
    },
    formatDateBR:       function () {
      return window.REShared && window.REShared.formatDateBR
        ? window.REShared.formatDateBR.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), '');
    },
    formatDateTimeBR:   function () {
      return window.REShared && window.REShared.formatDateTimeBR
        ? window.REShared.formatDateTimeBR.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), '');
    },
    getStoredUser:      function () {
      return window.REShared && window.REShared.getStoredUser
        ? window.REShared.getStoredUser()
        : (console.warn('[RE:shared] REShared not loaded yet'), null);
    },
    getStoredToken:     function () {
      return window.REShared && window.REShared.getStoredToken
        ? window.REShared.getStoredToken.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), null);
    },
    redirectToRoute:    function () {
      return window.REShared && window.REShared.redirectToRoute
        ? window.REShared.redirectToRoute.apply(window.REShared, arguments)
        : console.warn('[RE:shared] REShared not loaded yet');
    },
    verifySession:      function () {
      return window.REShared && window.REShared.verifySession
        ? window.REShared.verifySession.apply(window.REShared, arguments)
        : (console.warn('[RE:shared] REShared not loaded yet'), Promise.reject(new Error('REShared not loaded')));
    },
  };

  // ---------------------------------------------------------------------------
  // 6. RE._version e RE._debug
  // ---------------------------------------------------------------------------
  RE._version = '1.0.0';

  RE._debug = function () {
    console.group('[RE:debug] state dump v' + RE._version);

    console.group('RE.store internal');
    // acessa via get com chaves conhecidas não é possível sem introspection;
    // expõe uma cópia segura via closure trick
    console.info('(use RE.store.get(key) para inspecionar chaves individuais)');
    console.groupEnd();

    console.group('RE.events listeners');
    console.info('(listeners internos não expostos — use RE.events.on/off para gestão)');
    console.groupEnd();

    console.group('RE.modal queue status');
    console.info('REAdminModal disponível:', !!window.REAdminModal);
    console.groupEnd();

    console.group('RE.shared dependencies');
    console.info('REShared disponível:', !!window.REShared);
    console.groupEnd();

    console.groupEnd();
  };

  // ---------------------------------------------------------------------------
  // Pronto
  // ---------------------------------------------------------------------------
  console.info('[RE:core] loaded v' + RE._version);

}());
