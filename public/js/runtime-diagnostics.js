(function () {
  var seen = Object.create(null);
  var TRACE_LIMIT = 8;

  function nowIso() {
    return new Date().toISOString();
  }

  function cleanUrl(value) {
    return String(value || '').trim();
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
    if (/static\.cloudflareinsights\.com\/beacon\.min\.js/i.test(targetUrl)) {
      return {
        code: 'cloudflare-insights-blocked',
        level: 'warn',
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

  window.REDiagnostics = {
    captureTrace: captureTrace,
    report: emit,
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
})();