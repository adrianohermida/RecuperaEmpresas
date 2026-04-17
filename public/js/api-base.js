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
  function trimBase(value) {
    return String(value || '').replace(/\/+$/, '');
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

  // Patch window.fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    return _fetch(resolveUrl(url), opts);
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
