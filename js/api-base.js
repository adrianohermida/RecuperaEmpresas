/**
 * api-base.js — API URL interceptor for split-origin deployments
 *
 * When the frontend is served from a different origin than the API
 * (e.g. GitHub Pages frontend + Render.com backend), set:
 *
 *   window.RE_API_BASE = 'https://recuperaempresas.onrender.com'
 *
 * in public/js/config.js (generated at build time by CI, not committed).
 * When both are on the same origin (local dev, Render serving everything),
 * leave RE_API_BASE empty or undefined — relative paths are used as-is.
 *
 * RE_API_BASE is read lazily on every request so config.js can be loaded
 * in any order relative to this file.
 */
(function () {
  function fallbackBase() {
    var host = window.location.hostname;
    if (host === 'recuperaempresas.com.br' || host === 'www.recuperaempresas.com.br') {
      return 'https://recuperaempresas.onrender.com';
    }
    return '';
  }

  function resolveUrl(url) {
    var base = (window.RE_API_BASE || fallbackBase()).replace(/\/+$/, '');
    if (!base) return url;
    if (typeof url === 'string' && url.charAt(0) === '/') return base + url;
    return url;
  }

  // Patch window.fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    return _fetch(resolveUrl(url), opts);
  };

  // Patch XMLHttpRequest (Freshchat widget etc.)
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = resolveUrl(url);
    return _open.apply(this, args);
  };
})();
