'use strict';

(function () {
  var LOGO_MARKUP = [
    '<svg width="36" height="30" viewBox="0 0 44 36" fill="none" aria-hidden="true">',
    '  <rect x="0" y="26" width="8" height="10" rx="4" fill="#4B9EFF"></rect>',
    '  <rect x="12" y="18" width="8" height="18" rx="4" fill="#2B7FFF"></rect>',
    '  <rect x="24" y="10" width="8" height="26" rx="4" fill="#1A56DB"></rect>',
    '  <rect x="36" y="2" width="8" height="34" rx="4" fill="#1244AB"></rect>',
    '</svg>'
  ].join('');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readTemplateHtml(templateId) {
    if (!templateId) return '';
    var template = document.getElementById(templateId);
    if (!template) return '';
    return template.innerHTML.trim();
  }

  function getNotificationConfig(variant) {
    if (variant === 'admin') {
      return {
        wrapId: 'adminNotifBellWrap',
        bellId: 'adminNotifBell',
        badgeId: 'adminNotifBadge',
        dropdownId: 'adminNotifDropdown',
        listId: 'adminNotifList',
        title: 'Notificações',
        markAllLabel: 'Marcar todas lidas',
        toggleAction: 'toggleAdminNotifDropdown()',
        markAllAction: 'adminMarkAllNotifRead()'
      };
    }
    if (variant === 'client') {
      return {
        wrapId: 'notifBellWrap',
        bellId: 'notifBell',
        badgeId: 'notifBadge',
        dropdownId: 'notifDropdown',
        listId: 'notifList',
        title: 'Notificações',
        markAllLabel: 'Marcar todas lidas',
        toggleAction: 'toggleNotifDropdown()',
        markAllAction: 'markAllNotifRead()'
      };
    }
    return null;
  }

  function HeaderLeft(props) {
    return [
      '<div class="header-left">',
      props.showMenu
        ? '<button class="menu-toggle" id="menuToggle" onclick="toggleSidebar()" aria-label="Abrir menu">'
          + '  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">'
          + '    <line x1="3" y1="6" x2="21" y2="6"></line>'
          + '    <line x1="3" y1="12" x2="21" y2="12"></line>'
          + '    <line x1="3" y1="18" x2="21" y2="18"></line>'
          + '  </svg>'
          + '</button>'
        : '',
      '<a class="logo header-logo" href="' + escapeHtml(props.homeHref) + '" aria-label="' + escapeHtml(props.logoLabel) + '">',
      '  <span class="logo-mark">' + LOGO_MARKUP + '</span>',
      '  <span class="logo-copy">',
      '    <span class="logo-text">Recupera Empresas</span>',
      '    <span class="logo-sub" id="shellLogoSub">' + escapeHtml(props.logoSub) + '</span>',
      '  </span>',
      '</a>',
      '</div>'
    ].join('');
  }

  function HeaderCenter(props) {
    if (props.centerTemplateHtml) {
      return [
        '<div class="header-center header-center-template">',
        props.pageTitle || props.mobileTitle
          ? '  <div class="header-center-mobile">'
            + '    <div class="header-page-summary">'
            + (props.pageKicker ? '      <div class="header-page-kicker">' + escapeHtml(props.pageKicker) + '</div>' : '')
            + '      <div class="header-page-title">' + escapeHtml(props.pageTitle || props.mobileTitle || '') + '</div>'
            + '    </div>'
            + '  </div>'
          : '',
        '  <div class="header-center-desktop">',
        props.centerTemplateHtml,
        '  </div>',
        '</div>'
      ].join('');
    }

    if (!props.pageTitle && !props.mobileTitle) {
      return '<div class="header-center header-center-empty" aria-hidden="true"></div>';
    }

    return [
      '<div class="header-center">',
      '  <div class="header-page-summary">',
      props.pageKicker ? '    <div class="header-page-kicker">' + escapeHtml(props.pageKicker) + '</div>' : '',
      '    <div class="header-page-title">' + escapeHtml(props.pageTitle || props.mobileTitle || '') + '</div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function NotificationBell(props) {
    var config = getNotificationConfig(props.notificationVariant);
    if (!config) return '';

    return [
      '<div class="header-action-wrap admin-notif-wrap" id="' + config.wrapId + '">',
      '  <button id="' + config.bellId + '" class="admin-notif-bell header-icon-button" onclick="' + config.toggleAction + '" type="button" aria-label="Abrir notificações" title="Notificações">',
      '    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
      '      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>',
      '      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
      '    </svg>',
      '    <span id="' + config.badgeId + '" class="admin-notif-badge">0</span>',
      '  </button>',
      '  <div id="' + config.dropdownId + '" class="admin-notif-dropdown">',
      '    <div class="admin-notif-dropdown-header">',
      '      <span class="admin-notif-dropdown-title">' + escapeHtml(config.title) + '</span>',
      '      <button class="admin-notif-mark-all" type="button" onclick="' + config.markAllAction + '">' + escapeHtml(config.markAllLabel) + '</button>',
      '    </div>',
      '    <div id="' + config.listId + '" class="admin-notif-list">',
      '      <div class="admin-notif-empty">Carregando...</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function UserMenu(props) {
    return [
      '<div class="header-user-menu" data-user-menu-shell>',
      '  <div class="user-dropup user-menu-dropdown" id="userDropup" role="menu" aria-labelledby="userMenuBtn">',
      '    <div class="user-dropup-header">',
      props.accountKicker ? '      <div class="user-dropup-kicker">' + escapeHtml(props.accountKicker) + '</div>' : '',
      '      <div class="user-dropup-name" id="dropupUserName">—</div>',
      '      <div class="user-dropup-email" id="dropupUserEmail">—</div>',
      '    </div>',
      '    <a href="' + escapeHtml(props.profileHref) + '" class="user-dropup-item" role="menuitem">',
      '      <span class="user-dropup-item-copy">',
      '        <span class="user-dropup-item-label">Perfil</span>',
      '        <span class="user-dropup-item-meta">Identidade, avatar e dados públicos</span>',
      '      </span>',
      '    </a>',
      '    <a href="' + escapeHtml(props.settingsHref) + '" class="user-dropup-item" role="menuitem">',
      '      <span class="user-dropup-item-copy">',
      '        <span class="user-dropup-item-label">Configurações</span>',
      '        <span class="user-dropup-item-meta">Preferências e segurança da conta</span>',
      '      </span>',
      '    </a>',
      '    <hr class="user-dropup-divider"/>',
      '    <button class="user-dropup-item danger" type="button" onclick="logout()" role="menuitem">',
      '      <span class="user-dropup-item-copy">',
      '        <span class="user-dropup-item-label">Sair</span>',
      '        <span class="user-dropup-item-meta">Encerrar a sessão atual</span>',
      '      </span>',
      '    </button>',
      '  </div>',
      '  <button class="user-menu-btn header-user-trigger" id="userMenuBtn" onclick="toggleUserDropup(event)" aria-expanded="false" aria-haspopup="true" aria-controls="userDropup">',
      '    <div class="user-menu-avatar" id="userAvatar">?</div>',
      '    <div class="user-menu-info">',
      '      <div class="user-menu-name" id="userName">Carregando...</div>',
      '      <div class="user-menu-role" id="userMenuRole">' + escapeHtml(props.userRole) + '</div>',
      '    </div>',
      '    <svg class="user-menu-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
      '      <polyline points="18 15 12 9 6 15"></polyline>',
      '    </svg>',
      '  </button>',
      '</div>'
    ].join('');
  }

  function HeaderRight(props) {
    return [
      '<div class="header-right">',
      NotificationBell(props),
      props.badge ? '<span class="admin-badge" id="shellRoleBadge">' + escapeHtml(props.badge) + '</span>' : '',
      UserMenu(props),
      '</div>'
    ].join('');
  }

  function Header(props) {
    return [
      '<header class="header re-shell-header">',
      '  <div class="header-inner">',
      HeaderLeft(props),
      HeaderCenter(props),
      HeaderRight(props),
      '  </div>',
      '</header>'
    ].join('');
  }

  function getProps(root) {
    return {
      showMenu: root.dataset.showMenu !== 'false',
      homeHref: root.dataset.homeHref || '/',
      logoLabel: root.dataset.logoLabel || 'Página inicial',
      logoSub: root.dataset.logoSub || 'Portal',
      pageKicker: root.dataset.pageKicker || '',
      pageTitle: root.dataset.pageTitle || '',
      mobileTitle: root.dataset.mobileTitle || '',
      badge: root.dataset.badge || '',
      notificationVariant: root.dataset.notificationVariant || '',
      userRole: root.dataset.userRole || 'Conta',
      profileHref: root.dataset.profileHref || '/perfil',
      settingsHref: root.dataset.settingsHref || '/configuracoes',
      accountKicker: root.dataset.accountKicker || 'Minha conta',
      centerTemplateHtml: readTemplateHtml(root.dataset.centerTemplate || '')
    };
  }

  function getUserMenuShell() {
    return document.querySelector('[data-user-menu-shell]');
  }

  function setDefaultUserDropupState(open, options) {
    var dropup = document.getElementById('userDropup');
    var button = document.getElementById('userMenuBtn');
    var shell = getUserMenuShell();
    dropup?.classList.toggle('open', !!open);
    button?.setAttribute('aria-expanded', String(!!open));
    shell?.classList.toggle('menu-open', !!open);
    if (open && options && options.focusFirst) {
      dropup?.querySelector('.user-dropup-item')?.focus();
    }
  }

  function toggleDefaultUserDropup(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    var dropup = document.getElementById('userDropup');
    var isOpen = !!dropup?.classList.contains('open');
    setDefaultUserDropupState(!isOpen, { focusFirst: !isOpen });
  }

  function bindDefaultUserMenu() {
    if (window.__rePortalHeaderUserMenuBound) return;
    window.__rePortalHeaderUserMenuBound = true;

    if (typeof window.setUserDropupState !== 'function') {
      window.setUserDropupState = setDefaultUserDropupState;
    }
    if (typeof window.toggleUserDropup !== 'function') {
      window.toggleUserDropup = toggleDefaultUserDropup;
    }

    document.addEventListener('click', function (event) {
      var shell = getUserMenuShell();
      if (shell && !shell.contains(event.target)) {
        window.setUserDropupState(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        window.setUserDropupState(false);
      }
    });
  }

  function render(root) {
    if (!root || root.dataset.portalHeaderMounted === '1') return;
    root.dataset.portalHeaderMounted = '1';
    var wrapper = document.createElement('div');
    wrapper.innerHTML = Header(getProps(root));
    var header = wrapper.firstElementChild;
    if (!header) return;
    root.replaceWith(header);
    bindDefaultUserMenu();
  }

  function init() {
    document.querySelectorAll('[data-shell-header]').forEach(render);
  }

  window.REPortalHeader = {
    init: init,
    render: render
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();