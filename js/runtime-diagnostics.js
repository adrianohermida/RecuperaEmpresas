(function () {
  var seen = Object.create(null);
  var TRACE_LIMIT = 8;

  function nowIso() {
    return new Date().toISOString();
  }

  function cleanUrl(value) {
    return String(value || '').trim();
  }

  function cleanHost(url) {
    try {
      return new URL(url, window.location.href).host;
    } catch (error) {
      return '';
    }
  }

  function limitText(value, maxLength) {
    var text = String(value || '');
    if (!maxLength || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  function normalizeError(value) {
    if (!value) return null;
    if (typeof value === 'string') return { message: value };
    return {
      name: value.name || '',
      message: value.message || String(value),
      stack: value.stack || ''
    };
  }

  function normalizeStack(stack) {
    if (!stack) return [];
    return String(stack)
      .split('\n')
      .slice(1, TRACE_LIMIT + 1)
      .map(function (line) {
        var trimmed = line.trim();
        var match = trimmed.match(/(?:at\s+.*?\()?(.*?):(\d+):(\d+)\)?$/);
        return {
          raw: trimmed,
          source: match ? match[1] : '',
          line: match ? Number(match[2]) : 0,
          column: match ? Number(match[3]) : 0
        };
      });
  }

  function captureTrace(label) {
    var error = new Error(label || 'trace');
    return {
      label: label || 'trace',
      stack: error.stack || '',
      frames: normalizeStack(error.stack || '')
    };
  }

  function getContext() {
    return {
      href: window.location.href,
      path: window.location.pathname,
      apiBase: cleanUrl(window.RE_API_BASE),
      workerBase: cleanUrl(window.RE_API_WORKER_BASE),
      workerRoutes: Array.isArray(window.RE_API_WORKER_ROUTES) ? window.RE_API_WORKER_ROUTES.slice() : window.RE_API_WORKER_ROUTES || []
    };
  }

  function getCookieNames() {
    return document.cookie
      .split(';')
      .map(function (entry) { return entry.trim(); })
      .filter(Boolean)
      .map(function (entry) { return entry.split('=')[0]; });
  }

  function getStorageFlag(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function getAuthSnapshot() {
    var hashParams = {};
    try {
      hashParams = Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
    } catch (error) {}

    return {
      cookies: {
        names: getCookieNames(),
        hasPortalCookie: getCookieNames().indexOf('re_session') !== -1
      },
      storage: {
        hasReToken: Boolean(getStorageFlag('re_token')),
        hasReUser: Boolean(getStorageFlag('re_user')),
        hasImpersonation: Boolean(sessionStorage.getItem('re_impersonate_token'))
      },
      supabase: {
        configuredUrl: cleanUrl(window.VITE_SUPABASE_URL || window.RE_SUPABASE_URL),
        hasAnonKey: Boolean(window.VITE_SUPABASE_ANON_KEY || window.RE_SUPABASE_ANON)
      },
      navigation: {
        search: window.location.search || '',
        hashKeys: Object.keys(hashParams),
        hasOauthHash: Boolean(hashParams.oauth || hashParams.oauth_token || hashParams.oauth_access_token),
        hasRecoveryHash: Boolean(hashParams.access_token && hashParams.type)
      }
    };
  }

  function shouldLog(signature) {
    if (!signature) return true;
    if (seen[signature]) return false;
    seen[signature] = true;
    return true;
  }

  function emit(level, code, details) {
    var payload = Object.assign({
      code: code,
      ts: nowIso()
    }, getContext(), details || {});
    var signature = [code, payload.url, payload.method, payload.status, payload.message].filter(Boolean).join('|');
    if (!shouldLog(signature)) return;

    var method = console[level] || console.warn;
    method.call(console, '[RE:diagnostics]', payload);
  }

  function classifyResourceFailure(url) {
    var targetUrl = cleanUrl(url);
    if (/\/favicon\.ico(?:[?#].*)?$/i.test(targetUrl)) {
      return {
        code: 'favicon-ico-missing',
        level: 'info',
        summary: 'O navegador tentou buscar /favicon.ico, mas o projeto usa favicon.svg.',
        impact: 'Ruído visual no console. Não bloqueia autenticação, OAuth, Worker ou Supabase.',
        recommendedAction: 'Opcionalmente publicar um alias /favicon.ico -> /favicon.svg para reduzir o ruído.'
      };
    }

    if (/static\.cloudflareinsights\.com\/beacon\.min\.js/i.test(targetUrl)) {
      return {
        code: 'cloudflare-insights-blocked',
        level: 'info',
        suppress: true,
        summary: 'Cloudflare Web Analytics foi bloqueado pelo navegador ou por uma extensão.',
        impact: 'Apenas telemetria foi afetada. Isso não bloqueia login, API, Workers ou Pages.',
        probableCause: 'Tracking Prevention, adblock ou extensão de privacidade.',
        recommendedAction: 'Ignore durante a depuração funcional ou desative Web Analytics no projeto Pages para eliminar o ruído.'
      };
    }

    return {
      code: 'resource-load-failed',
      level: 'warn',
      summary: 'Falha ao carregar recurso estático.',
      impact: 'Pode afetar comportamento da página se o recurso for essencial.',
      recommendedAction: 'Validar URL, cache, política do navegador e publicação no Pages.'
    };
  }

  function classifyObservedHttp(details) {
    var url = cleanUrl(details && details.url);
    var status = Number(details && details.status) || 0;
    var host = cleanHost(url);

    if (!url || !status || status < 400) return null;

    if (/amcdn\.msftauth\.net$/i.test(host) || /aadcdn\.msauth\.net$/i.test(host)) {
      if (status === 429) {
        return {
          code: 'microsoft-session-probe-rate-limited',
          level: 'info',
          summary: 'A Microsoft limitou uma sondagem de sessão feita pelo próprio fluxo de login hospedado.',
          impact: 'Normalmente isso não impede o auth do Supabase no portal. É ruído do provedor externo.',
          recommendedAction: 'Priorize erros do domínio recuperaempresas.com.br e do projeto Supabase. Ignore este 429 ao depurar o portal.'
        };
      }

      return {
        code: 'microsoft-identity-http-issue',
        level: 'info',
        summary: 'O provedor externo Microsoft respondeu com erro durante uma checagem auxiliar.',
        impact: 'Pode ou não afetar login social, mas não explica sozinho falhas do portal/Worker.',
        recommendedAction: 'Cruze com erros do Supabase Auth e com os redirects finais do portal antes de agir.'
      };
    }

    if (/supabase\.co$/i.test(host) && /\/auth\/v1\//i.test(url)) {
      return {
        code: 'supabase-auth-http-issue',
        level: status >= 500 ? 'error' : 'warn',
        summary: 'O endpoint hospedado do Supabase Auth respondeu com erro.',
        impact: 'Pode afetar login, confirmação de e-mail, reset de senha ou OAuth.',
        recommendedAction: 'Validar redirect URLs, OAuth client, sessão Supabase do navegador e payload exato retornado por /auth/v1.'
      };
    }

    if (/recuperaempresas\.com\.br$/i.test(host) && /\/api\/auth\//i.test(url)) {
      return {
        code: 'portal-auth-http-issue',
        level: status >= 500 ? 'error' : 'warn',
        summary: 'A API de autenticação do portal respondeu com status inesperado.',
        impact: 'Pode bloquear login, verify, reset ou consentimento OAuth.',
        recommendedAction: 'Comparar request, cookies re_session, resposta JSON e logs do Worker correspondente.'
      };
    }

    return null;
  }

  function classifyApiFailure(details) {
    var status = Number(details && details.status);
    var method = String((details && details.method) || 'GET').toUpperCase();
    var url = cleanUrl(details && details.url);
    var workerBase = cleanUrl(window.RE_API_WORKER_BASE);
    var isWorker = workerBase && url.indexOf(workerBase) === 0;

    if (status === 404 && isWorker) {
      return {
        code: 'worker-route-not-found',
        level: 'error',
        summary: 'A chamada foi roteada para o Worker, mas a rota não existe lá.',
        recommendedAction: 'Validar RE_API_WORKER_ROUTES, pathname publicado e handler correspondente no Worker.'
      };
    }

    if (status === 405 && isWorker) {
      return {
        code: 'worker-method-not-allowed',
        level: 'warn',
        summary: 'O Worker recebeu a rota, mas rejeitou o método HTTP.',
        recommendedAction: 'Comparar o método enviado pelo navegador com o método esperado pelo handler do Worker.'
      };
    }

    if (status >= 500) {
      return {
        code: 'api-server-error',
        level: 'error',
        summary: 'A API retornou erro interno.',
        recommendedAction: 'Inspecionar logs do Worker/Node e payload da resposta.'
      };
    }

    if (status === 0) {
      return {
        code: 'api-network-blocked',
        level: 'error',
        summary: 'A requisição não concluiu. Pode haver CORS, bloqueio do navegador ou falha de rede.',
        recommendedAction: 'Validar preflight, domínio configurado, extensão do navegador e disponibilidade do host.'
      };
    }

    return {
      code: 'api-http-issue',
      level: status >= 400 ? 'warn' : 'info',
      summary: 'A API retornou uma resposta não ideal para a migração.',
      recommendedAction: 'Comparar URL final, método e corpo da resposta com a configuração publicada.'
    };
  }

  function onResourceError(event) {
    var target = event && event.target;
    if (!target || target === window) return;

    var url = target.src || target.href || '';
    if (!url) return;

    var info = classifyResourceFailure(url);
    if (info.suppress) return;
    emit(info.level, info.code, {
      url: url,
      tagName: String(target.tagName || '').toLowerCase(),
      summary: info.summary,
      impact: info.impact,
      probableCause: info.probableCause || '',
      recommendedAction: info.recommendedAction
    });
  }

  function onRuntimeError(event) {
    if (event && event.target && event.target !== window) return;
    emit('error', 'runtime-error', {
      message: event && event.message ? event.message : 'Erro de runtime no navegador.',
      source: event && event.filename ? event.filename : '',
      line: event && event.lineno ? event.lineno : 0,
      column: event && event.colno ? event.colno : 0,
      trace: event && event.error && event.error.stack ? normalizeStack(event.error.stack) : []
    });
  }

  function onUnhandledRejection(event) {
    var reason = event ? event.reason : null;
    var message = reason && reason.message ? reason.message : String(reason || 'Promise rejeitada sem tratamento.');
    emit('error', 'unhandled-promise-rejection', {
      message: message,
      error: normalizeError(reason),
      trace: normalizeStack(reason && reason.stack ? reason.stack : '')
    });
  }

  function observeFetch() {
    if (typeof window.fetch !== 'function') return;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return originalFetch(input, init).then(function (response) {
        try {
          var info = classifyObservedHttp({
            url: typeof input === 'string' ? input : (input && input.url) || '',
            status: response.status
          });
          if (info) {
            emit(info.level, info.code, {
              url: response.url || (typeof input === 'string' ? input : (input && input.url) || ''),
              status: response.status,
              method: String((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
              summary: info.summary,
              impact: info.impact,
              recommendedAction: info.recommendedAction
            });
          }
        } catch (error) {}
        return response;
      });
    };
  }

  function observeXhr() {
    if (typeof XMLHttpRequest === 'undefined') return;
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__reDiagMethod = String(method || 'GET').toUpperCase();
      this.__reDiagUrl = url;
      this.addEventListener('loadend', function () {
        try {
          var info = classifyObservedHttp({
            url: this.responseURL || this.__reDiagUrl || '',
            status: this.status
          });
          if (info) {
            emit(info.level, info.code, {
              url: this.responseURL || this.__reDiagUrl || '',
              status: this.status,
              method: this.__reDiagMethod || 'GET',
              summary: info.summary,
              impact: info.impact,
              recommendedAction: info.recommendedAction
            });
          }
        } catch (error) {}
      });
      return open.apply(this, arguments);
    };
  }

  window.REDiagnostics = {
    captureTrace: captureTrace,
    report: emit,
    dumpAuthState: function (label, extra) {
      emit('info', 'auth-state-snapshot', Object.assign({
        label: label || 'auth-state',
        snapshot: getAuthSnapshot()
      }, extra || {}));
    },
    reportApiFailure: function (details) {
      var info = classifyApiFailure(details || {});
      emit(info.level, info.code, Object.assign({
        summary: info.summary,
        recommendedAction: info.recommendedAction,
        method: String((details && details.method) || 'GET').toUpperCase(),
        url: cleanUrl(details && details.url),
        status: Number(details && details.status) || 0,
        originalUrl: cleanUrl(details && details.originalUrl),
        responseSnippet: limitText(details && details.responseSnippet, 240),
        reason: cleanUrl(details && details.reason),
        expected: details && details.expected ? details.expected : null,
        identified: details && details.identified ? details.identified : null,
        trace: details && details.trace ? details.trace : []
      }, details || {}));
    },
    reportResourceFailure: function (url, details) {
      var info = classifyResourceFailure(url);
      if (info.suppress) return;
      emit(info.level, info.code, Object.assign({
        url: cleanUrl(url),
        summary: info.summary,
        impact: info.impact,
        probableCause: info.probableCause || '',
        recommendedAction: info.recommendedAction
      }, details || {}));
    },
    reportIssue: function (level, code, details) {
      emit(level || 'warn', code || 'generic-issue', Object.assign({
        trace: details && details.trace ? details.trace : captureTrace(code || 'generic-issue').frames
      }, details || {}));
    }
  };

  window.addEventListener('error', onResourceError, true);
  window.addEventListener('error', onRuntimeError, false);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  observeFetch();
  observeXhr();
})();
