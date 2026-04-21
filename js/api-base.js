/**
 * api-base.js — API URL interceptor
 *
 * Production uses same-origin `/api/*` by default.
 *
 * You can override all API traffic with `window.RE_API_BASE`, or route only a
 * subset of endpoints to a Worker using `window.RE_API_WORKER_BASE` plus
 * `window.RE_API_WORKER_ROUTES`.
 */
(function () {
  var PUBLIC_API_FALLBACK_BASE = '';

  function trimBase(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function getFallbackApiBase() {
    return trimBase(window.RE_API_BASE) || PUBLIC_API_FALLBACK_BASE;
  }

  function parseWorkerRoutes(value) {
    if (Array.isArray(value)) return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
    }
    return [];
  }

  function patternToRegex(pattern) {
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    var wildcarded = escaped.replace(/\*/g, '[^/]+' );
    return new RegExp('^' + wildcarded + '(?:$|/.*)');
  }

  function matchesWorkerRoute(pathname) {
    var patterns = parseWorkerRoutes(window.RE_API_WORKER_ROUTES);
    return patterns.some(function (pattern) {
      if (!pattern) return false;
      if (pattern.indexOf('*') !== -1) return patternToRegex(pattern).test(pathname);
      return pathname === pattern || pathname.indexOf(pattern + '/') === 0;
    });
  }

  function resolveBaseForPath(pathname) {
    var workerBase = trimBase(window.RE_API_WORKER_BASE);
    if (workerBase && matchesWorkerRoute(pathname)) return workerBase;

    return trimBase(window.RE_API_BASE);
  }

  function resolveUrl(url) {
    if (typeof url !== 'string' || url.charAt(0) !== '/') return url;

    var pathname;
    try {
      pathname = new URL(url, window.location.origin).pathname;
    } catch (error) {
      pathname = url;
    }

    var base = resolveBaseForPath(pathname);
    return base ? base + url : url;
  }

  function normalizeHeaders(headers) {
    if (!headers) return [];
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return Array.from(headers.entries());
    }
    return Object.keys(headers).map(function (key) {
      return [key, headers[key]];
    });
  }

  function reportApiFailure(details) {
    if (window.REDiagnostics && typeof window.REDiagnostics.reportApiFailure === 'function') {
      window.REDiagnostics.reportApiFailure(details);
    }
  }

  function captureTrace(label) {
    if (window.REDiagnostics && typeof window.REDiagnostics.captureTrace === 'function') {
      return window.REDiagnostics.captureTrace(label);
    }
    return { frames: [] };
  }

  function buildExpected(opts, method, resolvedUrl) {
    var diagnostics = opts && opts.diagnostics;
    return diagnostics && diagnostics.expected ? diagnostics.expected : {
      method: method,
      url: resolvedUrl
    };
  }

  function buildIdentified(url, method, status, responseSnippet, reason) {
    return {
      method: method,
      url: url,
      status: status,
      responseSnippet: responseSnippet || '',
      reason: reason || ''
    };
  }

  function getExpectedStatuses(opts) {
    var diagnostics = opts && opts.diagnostics;
    var statuses = diagnostics && diagnostics.expectedStatuses;
    if (!Array.isArray(statuses)) return [];
    return statuses
      .map(function (status) { return Number(status); })
      .filter(function (status) { return Number.isFinite(status); });
  }

  function isExpectedStatus(opts, status) {
    return getExpectedStatuses(opts).indexOf(Number(status)) !== -1;
  }

  function shouldIncludeCredentials(url, resolvedUrl) {
    try {
      var original = typeof url === 'string' ? url : '';
      if (original.indexOf('/api/') === 0) return true;

      var parsed = new URL(resolvedUrl, window.location.href);
      if (parsed.pathname.indexOf('/api/') !== 0) return false;

      return /(^|\.)recuperaempresas\.com\.br$/i.test(parsed.hostname) || /(^|\.)pages\.dev$/i.test(parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function isRetriablePostPath(pathname) {
    return pathname === '/api/support/ticket';
  }

  function canRetryViaPublicApi(url, resolvedUrl, method, status) {
    if (Number(status) !== 530) return false;
    if (trimBase(window.RE_API_BASE)) return false;

    try {
      var parsed = new URL(resolvedUrl, window.location.href);
      var normalizedMethod = String(method || 'GET').toUpperCase();
      var allowedMethod = /^(GET|HEAD|OPTIONS)$/i.test(normalizedMethod)
        || (normalizedMethod === 'POST' && isRetriablePostPath(parsed.pathname));
      return allowedMethod && parsed.origin === window.location.origin && parsed.pathname.indexOf('/api/') === 0;
    } catch (error) {
      return false;
    }
  }

  function buildFallbackUrl(resolvedUrl) {
    var parsed = new URL(resolvedUrl, window.location.href);
    return getFallbackApiBase() + parsed.pathname + parsed.search;
  }

  // Patch window.fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var resolvedUrl = resolveUrl(url);
    var method = String((opts && opts.method) || 'GET').toUpperCase();
    var trace = captureTrace('fetch:' + resolvedUrl).frames;
    var requestOptions = Object.assign({}, opts || {});
    if (!requestOptions.credentials && shouldIncludeCredentials(url, resolvedUrl)) {
      requestOptions.credentials = 'include';
    }
    if (canRetryViaPublicApi(url, resolvedUrl, method, 530)) {
      requestOptions.__reApiSuppress530Diagnostics = true;
    }
    return _fetch(resolvedUrl, requestOptions).then(function (response) {
      if (!canRetryViaPublicApi(url, resolvedUrl, method, response.status)) return response;

      var fallbackUrl = buildFallbackUrl(resolvedUrl);
      var retryOptions = Object.assign({}, requestOptions);
      delete retryOptions.__reApiSuppress530Diagnostics;
      if (!retryOptions.credentials && shouldIncludeCredentials(url, fallbackUrl)) {
        retryOptions.credentials = 'include';
      }
      return _fetch(fallbackUrl, retryOptions);
    }).catch(function (error) {
      reportApiFailure({
        url: resolvedUrl,
        originalUrl: url,
        method: method,
        status: 0,
        reason: error && error.message ? error.message : 'fetch failed',
        expected: buildExpected(opts, method, resolvedUrl),
        identified: buildIdentified(resolvedUrl, method, 0, '', error && error.message ? error.message : 'fetch failed'),
        trace: trace,
        operation: opts && opts.diagnostics ? opts.diagnostics.operation : ''
      });
      throw error;
    });
  };

  window.apiJsonRequest = function (url, opts) {
    opts = opts || {};

    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var method = String(opts.method || 'GET').toUpperCase();
      var targetUrl = resolveUrl(url);
      var trace = captureTrace('xhr:' + targetUrl).frames;

      xhr.open(method, targetUrl, true);

      if (opts.credentials === 'include' || shouldIncludeCredentials(url, targetUrl)) {
        xhr.withCredentials = true;
      }

      if (typeof opts.timeout === 'number' && opts.timeout > 0) {
        xhr.timeout = opts.timeout;
      }

      normalizeHeaders(opts.headers).forEach(function (entry) {
        if (typeof entry[1] !== 'undefined') {
          xhr.setRequestHeader(entry[0], entry[1]);
        }
      });

      xhr.onload = function () {
        var text = xhr.responseText || '';
        var data = {};

        if (text) {
          try {
            data = JSON.parse(text);
          } catch (error) {
            data = {
              error: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || ('HTTP ' + xhr.status),
              rawText: text
            };
          }
        }

        if (xhr.status >= 400 && !isExpectedStatus(opts, xhr.status)) {
          reportApiFailure({
            url: targetUrl,
            originalUrl: url,
            method: method,
            status: xhr.status,
            responseSnippet: text,
            expected: buildExpected(opts, method, targetUrl),
            identified: buildIdentified(targetUrl, method, xhr.status, text, ''),
            trace: trace,
            operation: opts && opts.diagnostics ? opts.diagnostics.operation : ''
          });
        }

        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          data: data,
          rawText: text
        });
      };

      xhr.onerror = function () {
        var reason = 'xhr network error';
        reportApiFailure({
          url: targetUrl,
          originalUrl: url,
          method: method,
          status: 0,
          reason: reason,
          expected: buildExpected(opts, method, targetUrl),
          identified: buildIdentified(targetUrl, method, 0, '', reason),
          trace: trace,
          operation: opts && opts.diagnostics ? opts.diagnostics.operation : ''
        });
        reject(new Error('Network request failed'));
      };

      xhr.ontimeout = function () {
        var reason = 'xhr timeout';
        reportApiFailure({
          url: targetUrl,
          originalUrl: url,
          method: method,
          status: 0,
          reason: reason,
          expected: buildExpected(opts, method, targetUrl),
          identified: buildIdentified(targetUrl, method, 0, '', reason),
          trace: trace,
          operation: opts && opts.diagnostics ? opts.diagnostics.operation : ''
        });
        reject(new Error('Request timed out'));
      };

      xhr.send(typeof opts.body === 'undefined' ? null : opts.body);
    });
  };

  window.readApiResponse = async function (response) {
    var text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch (error) {
      var cleaned = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        error: cleaned || ('HTTP ' + response.status),
        rawText: text
      };
    }
  };

  // Patch XMLHttpRequest (Freshchat widget etc.)
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = resolveUrl(url);
    return _open.apply(this, args);
  };
})();
