/**
 * api-base.js — API URL interceptor
 *
 * Production now runs on a single origin (Render serving frontend + backend),
 * so `/api/*` must stay same-origin by default.
 *
 * Only set `window.RE_API_BASE` when you intentionally want a different API
 * origin in a controlled environment. Otherwise keep it empty.
 */
(function () {
  function resolveUrl(url) {
    var base = (window.RE_API_BASE || '').replace(/\/+$/, '');
    if (!base) return url;
    if (typeof url === 'string' && url.charAt(0) === '/') return base + url;
    return url;
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

  // Patch window.fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var resolvedUrl = resolveUrl(url);
    var method = String((opts && opts.method) || 'GET').toUpperCase();
    var trace = captureTrace('fetch:' + resolvedUrl).frames;
    return _fetch(resolvedUrl, opts).catch(function (error) {
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

      if (opts.credentials === 'include') {
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

        if (xhr.status >= 400) {
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
