(function () {
  function parseStoredJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (error) {
      return {};
    }
  }

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
    localStorage.removeItem('re_token');
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
    getSupabaseSessionTokens: getSupabaseSessionTokens,
    getStoredToken: getStoredToken,
    getStoredUser: getStoredUser,
    logoutSession: logoutSession,
    readResponse: readResponse,
    storeAuthUser: storeAuthUser,
  };
})();