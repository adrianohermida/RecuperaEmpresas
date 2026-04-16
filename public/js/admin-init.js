'use strict';

(function () {
  function loadFreshchatWidget() {
    var script = document.createElement('script');
    script.src = '//fw-cdn.com/16078787/7064112.js';
    script.setAttribute('chat', 'true');
    script.async = true;
    document.body.appendChild(script);
  }

  function initFreshchatBoot() {
    if (!(window.RE_ENABLE_FRESHCHAT && window.RE_FRESHCHAT_TOKEN && window.RE_FRESHCHAT_SITE_ID)) return;

    window.fcSettings = {
      token: window.RE_FRESHCHAT_TOKEN,
      host: 'https://msdk.freshchat.com',
      siteId: window.RE_FRESHCHAT_SITE_ID,
      config: {
        headerProperty: { appName: 'Recupera Empresas — Operador', backgroundColor: '#1e3a5f', foregroundColor: '#ffffff' },
        content: { placeholders: { search_field: 'Buscar conversa...', reply_field: 'Responder...' } }
      }
    };

    loadFreshchatWidget();
  }

  // NOTE: initAdminShell listener is already registered in admin-bootstrap.js.
  // Do NOT add a second listener here — it would cause double initialization.
  initFreshchatBoot();
  console.info('[RE:admin-init] loaded');
})();