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

  // Patch window.fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var resolvedUrl = resolveUrl(url);
    return _fetch(resolvedUrl, opts).catch(function (error) {
      reportApiFailure({
        url: resolvedUrl,
        originalUrl: url,
        method: String((opts && opts.method) || 'GET').toUpperCase(),
        status: 0,
        reason: error && error.message ? error.message : 'fetch failed'
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
            responseSnippet: text
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
        reportApiFailure({
          url: targetUrl,
          originalUrl: url,
          method: method,
          status: 0,
          reason: 'xhr network error'
        });
        reject(new Error('Network request failed'));
      };

      xhr.ontimeout = function () {
        reportApiFailure({
          url: targetUrl,
          originalUrl: url,
          method: method,
          status: 0,
          reason: 'xhr timeout'
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
