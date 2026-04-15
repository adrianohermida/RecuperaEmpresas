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
