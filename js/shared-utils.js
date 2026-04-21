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
    onboarding: '/index.html'
  };

  function getStoredToken(options) {
    var allowImpersonation = !!(options && options.allowImpersonation);
    if (allowImpersonation) {
      var impersonationToken = sessionStorage.getItem('re_impersonate_token');
      if (impersonationToken) return impersonationToken;
    }
    return localStorage.getItem('re_token');
  }

  function getStoredUser() {
    return parseStoredJson('re_user');
  }

  function buildAuthHeaders(options) {
    var opts = options || {};
    var headers = {};
    var extra = opts.extra || {};
    var token = getStoredToken(opts);

    if (opts.includeContentType !== false) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
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
        localStorage.setItem('re_user', JSON.stringify(data.user || {}));
        localStorage.removeItem('re_token');
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
    if (opts.clearImpersonation) {
      sessionStorage.removeItem('re_impersonate_token');
    }
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
    getRoute: getRoute,
    getStoredToken: getStoredToken,
    getStoredUser: getStoredUser,
    readResponse: readResponse,
    redirectToRoute: redirectToRoute,
    redirectToUserHome: redirectToUserHome,
    verifySession: verifySession,
  };
})();
