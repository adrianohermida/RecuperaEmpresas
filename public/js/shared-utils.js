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
    getStoredToken: getStoredToken,
    getStoredUser: getStoredUser,
    readResponse: readResponse,
  };
})();