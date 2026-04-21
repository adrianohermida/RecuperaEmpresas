'use strict';
/**
 * re-integration.js — Wiring de eventos entre módulos via RE.events
 * Carregado por último. Conecta módulos que precisam reagir a eventos de outros.
 */

(function () {

  function initIntegration() {
    var EVT = RE.events.EVT;

    // 1. client:opened → atualiza store com cliente ativo
    RE.events.on(EVT.CLIENT_OPENED, function (payload) {
      RE.store.set('activeClient', payload);
      RE.store.set('activeClientId', payload && payload.id);
    });

    // 2. client:closed → limpa store do cliente ativo
    RE.events.on(EVT.CLIENT_CLOSED, function () {
      RE.store.set('activeClient', null);
      RE.store.set('activeClientId', null);
    });

    // 3. booking:updated → re-render agenda se visível
    RE.events.on(EVT.BOOKING_UPDATED, function (payload) {
      if (typeof window.loadAdminAgenda === 'function') {
        window.loadAdminAgenda();
      }
      if (typeof window.loadAgendaSection === 'function') {
        window.loadAgendaSection();
      }
    });

    // 4. form:saved → atualiza lista de formulários se visível
    RE.events.on(EVT.FORM_SAVED, function (payload) {
      if (typeof window.fbLoadForms === 'function') {
        window.fbLoadForms();
      }
    });

    // 5. journey:updated → re-render jornada se drawer/page estiver aberto
    RE.events.on(EVT.JOURNEY_UPDATED, function (payload) {
      var clientId = RE.store.get('activeClientId');
      if (!clientId) return;
      if (typeof window.renderClientDetailTab === 'function') {
        window.renderClientDetailTab('journey');
      }
    });

    // 6. section:changed → fecha modais abertos
    RE.events.on(EVT.SECTION_CHANGED, function (payload) {
      if (window.REAdminModal && typeof window.REAdminModal.closeAll === 'function') {
        window.REAdminModal.closeAll({ reason: 'section-changed' });
      }
    });

    // 7. auth:ready → persiste usuário no store e inicia polling de notificações
    RE.events.on(EVT.AUTH_READY, function (user) {
      RE.store.set('currentUser', user);
      if (typeof window.startAdminNotifPolling === 'function') {
        window.startAdminNotifPolling();
      }
    });

    // 8. Monkey-patch openClient para emitir CLIENT_OPENED após carregar dados
    (function patchOpenClient() {
      var _originalOpenClient = window.openClient;
      if (typeof _originalOpenClient !== 'function') return;

      window.openClient = function (id, tab) {
        var result = _originalOpenClient.call(this, id, tab);
        // openClient é async — aguarda e emite
        if (result && typeof result.then === 'function') {
          result.then(function () {
            var state = window.REClientDetail && typeof window.REClientDetail.getState === 'function'
              ? window.REClientDetail.getState()
              : {};
            if (state.currentClientId) {
              RE.events.emit(EVT.CLIENT_OPENED, {
                id: state.currentClientId,
                data: state.currentClientData,
              });
            }
          });
        }
        return result;
      };
    }());

    // 9. Monkey-patch closeClientDetail para emitir CLIENT_CLOSED
    (function patchCloseClientDetail() {
      var _original = window.closeClientDetail;
      if (typeof _original !== 'function') return;
      window.closeClientDetail = function () {
        _original.apply(this, arguments);
        RE.events.emit(EVT.CLIENT_CLOSED, null);
      };
    }());
  }

  // Guard: só executa se RE.events estiver disponível
  if (!window.RE || !window.RE.events) {
    console.warn('[RE:integration] RE.events not available — skipping');
    // tenta novamente após DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
      if (window.RE && window.RE.events) { initIntegration(); }
    });
  } else {
    initIntegration();
  }

}());
