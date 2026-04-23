(function () {
  function parseStoredJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (error) {
      return {};
    }
  }

  var ROUTES = {
    login: '/login',
    register: '/register',
    forgotPassword: '/forgot-password',
    resetPassword: '/reset-password',
    dashboard: '/dashboard',
    admin: '/admin',
    perfil: '/perfil',
    configuracoes: '/configuracoes',
    cliente: '/cliente',
    onboarding: '/index.html'
  };

  var SIDEBAR_ICONS = {
    clients: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    agenda: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    financeiro: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    formularios: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
    jornadas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    businessPlan: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/></svg>',
    suporte: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    tarefas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    documentos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    cobrancas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    marketplace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    auditoria: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    dashboard: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
    perfil: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    configuracoes: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  function getStoredToken(options) {
    var allowImpersonation = !!(options && options.allowImpersonation);
    if (allowImpersonation) {
      var impersonationToken = sessionStorage.getItem('re_impersonate_token');
      if (impersonationToken) return impersonationToken;
    }
    return localStorage.getItem('re_token') || '';
  }

  function getStoredUser() {
    return parseStoredJson('re_user');
  }

  function storeAuthUser(user) {
    localStorage.setItem('re_user', JSON.stringify(user || {}));
  }

  function storeAuthToken(token) {
    if (!token || token === 'null' || token === 'undefined') return;
    localStorage.setItem('re_token', String(token));
  }

  function getSupabaseProjectRef() {
    try {
      var url = window.VITE_SUPABASE_URL || window.RE_SUPABASE_URL || '';
      var hostname = new URL(url).hostname;
      return hostname.split('.')[0] || '';
    } catch (error) {
      return '';
    }
  }

  function getSupabaseStorageKeys() {
    var ref = getSupabaseProjectRef();
    if (!ref) return [];
    return [
      'sb-' + ref + '-auth-token',
      'sb-' + ref + '-auth-token-code-verifier'
    ];
  }

  function getSupabaseSessionTokens() {
    var keys = getSupabaseStorageKeys();
    for (var index = 0; index < keys.length; index += 1) {
      try {
        var parsed = JSON.parse(localStorage.getItem(keys[index]) || 'null');
        if (parsed && parsed.access_token && parsed.refresh_token) {
          return {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token
          };
        }
      } catch (error) {
        // Ignore malformed local storage entries.
      }
    }
    return { access_token: '', refresh_token: '' };
  }

  function clearSupabaseBrowserSession() {
    getSupabaseStorageKeys().forEach(function (key) {
      localStorage.removeItem(key);
    });
  }

  function buildAuthHeaders(options) {
    var opts = options || {};
    var headers = {};
    var extra = opts.extra || {};
    var token = getStoredToken(opts);

    if (opts.includeContentType !== false) {
      headers['Content-Type'] = 'application/json';
    }
    if (token && token !== 'null' && token !== 'undefined') {
      headers.Authorization = 'Bearer ' + token;
    }

    return Object.assign(headers, extra);
  }

  function getRoute(name) {
    return ROUTES[name] || '/';
  }

  function redirectToRoute(name, options) {
    var route = getRoute(name);
    var opts = options || {};
    var search = opts.search || '';
    if (search && search.charAt(0) !== '?') search = '?' + search;
    window.location.href = route + search;
  }

  function redirectToUserHome(user, options) {
    if (user && user.isAdmin && !(options && options.allowImpersonation)) {
      redirectToRoute('admin');
      return;
    }
    redirectToRoute('dashboard');
  }

  function getPortalView(user, options) {
    if (user && user.isAdmin && !(options && options.allowImpersonation)) {
      return 'admin';
    }
    return 'client';
  }

  function buildPortalSectionUrl(user, section, options) {
    var route = getPortalView(user, options) === 'admin' ? getRoute('admin') : getRoute('dashboard');
    if (!section) return route;
    return route + '?section=' + encodeURIComponent(section);
  }

  function applyText(target, value) {
    if (!target || typeof value !== 'string') return;
    target.textContent = value;
  }

  function setLink(target, href, label, isActive) {
    if (!target) return;
    if (typeof href === 'string' && href) target.href = href;
    if (typeof label === 'string') {
      var labelNode = target.querySelector('[data-shell-label]') || target;
      labelNode.textContent = label;
    }
    if (typeof isActive === 'boolean') {
      target.classList.toggle('active', isActive);
    }
  }

  function applyPortalAccountShell(user, options) {
    var opts = options || {};
    var view = getPortalView(user, opts);
    var isAdmin = view === 'admin';
    var config = isAdmin
      ? {
          logoSub: 'Painel do Consultor',
          badge: 'Admin',
          role: 'Consultor Admin',
          navLabel: 'Visão Geral',
          primaryLinks: [
            { href: getRoute('admin'), label: 'Clientes', active: opts.section === 'home' },
            { href: buildPortalSectionUrl(user, 'agenda', opts), label: 'Agenda', active: opts.section === 'agenda' }
          ],
          homeHref: getRoute('admin'),
          homeLabel: 'Voltar ao painel'
        }
      : {
          logoSub: 'Portal do Cliente',
          badge: 'Cliente',
          role: 'Cliente Empresa',
          navLabel: 'Meu Portal',
          primaryLinks: [
            { href: getRoute('dashboard'), label: 'Dashboard', active: opts.section === 'home' },
            { href: buildPortalSectionUrl(user, 'agenda', opts), label: 'Agenda', active: opts.section === 'agenda' }
          ],
          homeHref: getRoute('dashboard'),
          homeLabel: 'Voltar ao portal'
        };

    applyText(document.getElementById('shellLogoSub'), config.logoSub);
    applyText(document.getElementById('shellRoleBadge'), config.badge);
    applyText(document.getElementById('userMenuRole'), config.role);
    applyText(document.getElementById('shellNavLabel'), config.navLabel);
    setLink(document.getElementById('shellPrimaryLinkOne'), config.primaryLinks[0].href, config.primaryLinks[0].label, !!config.primaryLinks[0].active);
    setLink(document.getElementById('shellPrimaryLinkTwo'), config.primaryLinks[1].href, config.primaryLinks[1].label, !!config.primaryLinks[1].active);
    setLink(document.getElementById('accountBackLink'), config.homeHref, config.homeLabel, false);

    document.body.dataset.portalView = view;
    return config;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeSidebarHref(href) {
    try {
      var url = new URL(href, window.location.origin);
      return url.pathname + url.search;
    } catch (_error) {
      return href || '';
    }
  }

  function getSidebarActiveHref(activeHref) {
    return normalizeSidebarHref(activeHref || (window.location.pathname + window.location.search));
  }

  function isSidebarItemActive(itemHref, activeHref) {
    var normalizedItemHref = normalizeSidebarHref(itemHref);
    var normalizedActiveHref = getSidebarActiveHref(activeHref);

    if (normalizedItemHref === normalizedActiveHref) return true;

    try {
      var itemUrl = new URL(normalizedItemHref, window.location.origin);
      var activeUrl = new URL(normalizedActiveHref, window.location.origin);
      var itemSection = itemUrl.searchParams.get('section');
      var activeSection = activeUrl.searchParams.get('section');
      if (itemUrl.pathname === activeUrl.pathname && itemSection && activeSection && itemSection === activeSection) {
        return true;
      }
    } catch (_error) {}

    return false;
  }

  function getSidebarSections(user) {
    var view = getPortalView(user);
    if (view === 'admin') {
      return [
        {
          label: 'Visão Geral',
          items: [
            { href: '/admin', label: 'Clientes', icon: SIDEBAR_ICONS.clients },
            { href: '/admin?section=agenda', label: 'Agenda', icon: SIDEBAR_ICONS.agenda },
            { href: '/admin?section=financeiro', label: 'Financeiro', icon: SIDEBAR_ICONS.financeiro },
            { href: '/admin?section=formularios', label: 'Formulários', icon: SIDEBAR_ICONS.formularios },
            { href: '/admin?section=jornadas', label: 'Jornadas', icon: SIDEBAR_ICONS.jornadas },
            { href: '/admin?section=businessPlan', label: 'Business Plan', icon: SIDEBAR_ICONS.businessPlan }
          ]
        },
        {
          label: 'Operação',
          items: [
            { href: '/suporte-admin', label: 'Suporte', icon: SIDEBAR_ICONS.suporte },
            { href: '/tarefas-admin', label: 'Tarefas', icon: SIDEBAR_ICONS.tarefas },
            { href: '/documentos-admin', label: 'Documentos', icon: SIDEBAR_ICONS.documentos },
            { href: '/admin?section=adminInvoices', label: 'Cobranças', icon: SIDEBAR_ICONS.cobrancas },
            { href: '/admin?section=adminMarketplace', label: 'Marketplace', icon: SIDEBAR_ICONS.marketplace },
            { href: '/admin?section=auditlog', label: 'Auditoria', icon: SIDEBAR_ICONS.auditoria }
          ]
        },
        {
          label: 'Conta',
          items: [
            { href: '/perfil', label: 'Meu Perfil', icon: SIDEBAR_ICONS.perfil },
            { href: '/configuracoes', label: 'Configurações', icon: SIDEBAR_ICONS.configuracoes }
          ]
        }
      ];
    }

    return [
      {
        label: 'Meu Portal',
        items: [
          { href: '/dashboard', label: 'Dashboard', icon: SIDEBAR_ICONS.dashboard },
          { href: '/dashboard?section=agenda', label: 'Agenda', icon: SIDEBAR_ICONS.agenda },
          { href: '/dashboard?section=docs', label: 'Documentos', icon: SIDEBAR_ICONS.documentos },
          { href: '/dashboard?section=forms', label: 'Formulários', icon: SIDEBAR_ICONS.formularios },
          { href: '/dashboard?section=support', label: 'Suporte', icon: SIDEBAR_ICONS.suporte },
          { href: '/dashboard?section=financeiro', label: 'Financeiro', icon: SIDEBAR_ICONS.financeiro }
        ]
      },
      {
        label: 'Conta',
        items: [
          { href: '/perfil', label: 'Meu Perfil', icon: SIDEBAR_ICONS.perfil },
          { href: '/configuracoes', label: 'Configurações', icon: SIDEBAR_ICONS.configuracoes }
        ]
      }
    ];
  }

  function renderPortalSidebar(options) {
    var opts = options || {};
    var container = opts.container || (opts.containerId ? document.getElementById(opts.containerId) : null);
    if (!container) return;

    var sections = getSidebarSections(opts.user || getStoredUser());
    var activeHref = getSidebarActiveHref(opts.activeHref);

    container.innerHTML = sections.map(function (section) {
      return [
        '<div class="sidebar-section">',
        '<div class="sidebar-label">' + escapeHtml(section.label) + '</div>',
        section.items.map(function (item) {
          var activeClass = isSidebarItemActive(item.href, activeHref) ? ' active' : '';
          return [
            '<a href="' + escapeHtml(item.href) + '" class="sidebar-link' + activeClass + '">',
            item.icon || '',
            '<span>' + escapeHtml(item.label) + '</span>',
            '</a>'
          ].join('');
        }).join(''),
        '</div>'
      ].join('');
    }).join('');
  }

  async function verifySession(options) {
    var opts = options || {};
    var allowAnonymous = !!opts.allowAnonymous;
    var controller = new AbortController();
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 20000;
    var timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
    var url = '/api/auth/verify' + (allowAnonymous ? '?allowAnonymous=1' : '');

    try {
      var response = await fetch(url, {
        method: 'GET',
        headers: buildAuthHeaders({
          allowImpersonation: !!opts.allowImpersonation,
          includeContentType: false
        }),
        credentials: 'include',
        signal: controller.signal
      });
      var data = await readResponse(response);
      if (response.ok && data && data.user) {
        storeAuthUser(data.user);
      }
      return {
        ok: response.ok,
        status: response.status,
        data: data,
        user: data && data.user ? data.user : null
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  function clearStoredAuth(options) {
    var opts = options || {};
    var keys = opts.keys || ['re_token', 're_user'];
    keys.forEach(function (key) {
      localStorage.removeItem(key);
    });
    clearSupabaseBrowserSession();
    if (opts.clearImpersonation) {
      sessionStorage.removeItem('re_impersonate_token');
    }
  }

  async function logoutSession(options) {
    var opts = options || {};
    var endpoint = opts.global ? '/api/auth/revoke-sessions' : '/api/auth/logout';
    var supabaseSession = getSupabaseSessionTokens();

    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supabaseSession)
      });
    } catch (error) {
      // Best effort: local cleanup still needs to happen.
    }

    clearStoredAuth({
      keys: opts.keys || ['re_token', 're_user'],
      clearImpersonation: opts.clearImpersonation
    });
  }

  function readResponse(response) {
    if (typeof window.readApiResponse === 'function') {
      return window.readApiResponse(response);
    }

    return response.text().then(function (text) {
      if (!text) return {};

      try {
        return JSON.parse(text);
      } catch (error) {
        var cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          error: cleaned || ('HTTP ' + response.status),
          rawText: text
        };
      }
    });
  }

  function toDate(value) {
    if (!value) return null;
    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatCurrencyBRL(value) {
    var amount = Number(value || 0);
    return amount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function formatDateBR(value, options) {
    var date = toDate(value);
    return date ? date.toLocaleDateString('pt-BR', options || {}) : '';
  }

  function formatDateTimeBR(value, options) {
    var date = toDate(value);
    return date ? date.toLocaleString('pt-BR', options || {}) : '';
  }

  function clampNumber(value, min, max) {
    var number = Number(value);
    if (!isFinite(number)) number = 0;
    number = Math.round(number);
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function applyRangeClass(element, value, min, max, prefix, datasetKey) {
    if (!element) return min;

    var safeValue = clampNumber(value, min, max);
    var previousClass = element.dataset[datasetKey];
    if (previousClass) element.classList.remove(previousClass);

    var nextClass = prefix + '-' + safeValue;
    element.classList.add(nextClass);
    element.dataset[datasetKey] = nextClass;
    return safeValue;
  }

  function applyPercentClass(element, value) {
    return applyRangeClass(element, value, 0, 100, 'ui-progress', 'uiProgressClass');
  }

  function applyPixelHeightClass(element, value, max) {
    var safeMax = typeof max === 'number' ? max : 40;
    return applyRangeClass(element, value, 0, safeMax, 'ui-height', 'uiHeightClass');
  }

  window.REShared = {
    applyPercentClass: applyPercentClass,
    applyPixelHeightClass: applyPixelHeightClass,
    buildAuthHeaders: buildAuthHeaders,
    clearStoredAuth: clearStoredAuth,
    formatCurrencyBRL: formatCurrencyBRL,
    formatDateBR: formatDateBR,
    formatDateTimeBR: formatDateTimeBR,
    applyPortalAccountShell: applyPortalAccountShell,
    buildPortalSectionUrl: buildPortalSectionUrl,
    getPortalView: getPortalView,
    getSupabaseSessionTokens: getSupabaseSessionTokens,
    getRoute: getRoute,
    getStoredToken: getStoredToken,
    getStoredUser: getStoredUser,
    storeAuthToken: storeAuthToken,
    logoutSession: logoutSession,
    readResponse: readResponse,
    renderPortalSidebar: renderPortalSidebar,
    redirectToRoute: redirectToRoute,
    redirectToUserHome: redirectToUserHome,
    storeAuthUser: storeAuthUser,
    verifySession: verifySession,
  };
})();
