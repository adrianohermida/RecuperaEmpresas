'use strict';

const http = require('http');
const https = require('https');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function parseWorkerRoutes(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function requestUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
          url,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseAssignedJson(source, variableName) {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*=\\s*([^;]+);`));
  if (!match) return undefined;
  return JSON.parse(match[1]);
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const wildcarded = escaped.replace(/\*/g, '[^/]+');
  return new RegExp(`^${wildcarded}(?:$|/.*)`);
}

function matchesWorkerRoute(pathname, patterns) {
  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern.includes('*')) return patternToRegex(pattern).test(pathname);
    return pathname === pattern || pathname.startsWith(`${pattern}/`);
  });
}

function resolveBase(pathname, config) {
  if (config.workerBase && matchesWorkerRoute(pathname, config.workerRoutes)) {
    return config.workerBase;
  }
  if (config.apiBase) return config.apiBase;
  return config.portalOrigin;
}

async function fetchConfig(portalUrl) {
  const portal = new URL(portalUrl);
  const response = await requestUrl(new URL('/js/config.js', portal).toString());
  assert(response.statusCode === 200, `GET ${portal.origin}/js/config.js deve retornar 200`);

  return {
    portalOrigin: normalizeBase(portal.origin),
    apiBase: normalizeBase(parseAssignedJson(response.body, 'window.RE_API_BASE') || ''),
    workerBase: normalizeBase(parseAssignedJson(response.body, 'window.RE_API_WORKER_BASE') || ''),
    workerRoutes: Array.isArray(parseAssignedJson(response.body, 'window.RE_API_WORKER_ROUTES'))
      ? parseAssignedJson(response.body, 'window.RE_API_WORKER_ROUTES')
      : parseWorkerRoutes(process.env.RE_API_WORKER_ROUTES || ''),
  };
}

async function checkHealth(baseUrl, label) {
  const response = await requestUrl(`${baseUrl}/api/health`);
  assert(response.statusCode === 200, `${label} /api/health deve retornar 200`);
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(`${label} /api/health deve retornar JSON valido`);
  }
  assert(payload.status === 'ok', `${label} /api/health deve retornar status ok`);
}

async function tryCheckHealth(baseUrl, label) {
  try {
    await checkHealth(baseUrl, label);
    return true;
  } catch (error) {
    return { ok: false, error };
  }
}

function renderMapping(routes, config) {
  return routes.map((route) => `${route} -> ${resolveBase(route, config)}`);
}

async function run() {
  const portalUrl = process.env.PORTAL_URL || 'https://portal.recuperaempresas.com.br';
  const explicitRoutes = parseWorkerRoutes(process.env.CANARY_SAMPLE_ROUTES || '');
  const defaultRoutes = [
    '/api/plan',
    '/api/tasks',
    '/api/notifications',
    '/api/appointments',
    '/api/messages',
    '/api/change-requests',
    '/api/document-requests',
    '/api/admin/appointments',
    '/api/admin/client/00000000-0000-0000-0000-000000000000/departments',
    '/api/admin/client/00000000-0000-0000-0000-000000000000/members/invite',
  ];

  const config = await fetchConfig(portalUrl);

  console.log(`Portal: ${config.portalOrigin}`);
  console.log(`API principal: ${config.apiBase || '(same-origin)'}`);
  console.log(`API Worker: ${config.workerBase || '(desabilitado)'}`);
  console.log(`Rotas canario: ${config.workerRoutes.length ? config.workerRoutes.join(', ') : '(nenhuma)'}`);

  const explicitLegacyBase = normalizeBase(process.env.LEGACY_API_BASE || config.apiBase || '');
  const workerBase = normalizeBase(process.env.WORKER_API_BASE || config.workerBase || '');

  let legacyBase = explicitLegacyBase;
  if (!legacyBase) {
    const probe = await tryCheckHealth(config.portalOrigin, 'API principal same-origin');
    if (probe === true) {
      legacyBase = config.portalOrigin;
      console.log('API principal inferida como same-origin no portal atual.');
    } else {
      console.warn('Aviso: RE_API_BASE/LEGACY_API_BASE nao configurado e o portal nao expoe /api/health JSON em same-origin.');
      console.warn('Aviso: pulando healthcheck da API principal. Defina LEGACY_API_BASE para validar o host real da API.');
    }
  }

  if (legacyBase) {
    await checkHealth(legacyBase, 'API principal');
  }

  if (workerBase) {
    await checkHealth(workerBase, 'API Worker');
  }

  const sampleRoutes = explicitRoutes.length ? explicitRoutes : defaultRoutes;
  const mapping = renderMapping(sampleRoutes, {
    ...config,
    apiBase: legacyBase,
    workerBase,
  });

  console.log('Mapeamento de rotas:');
  mapping.forEach((line) => console.log(`- ${line}`));

  if (workerBase && config.workerRoutes.length > 0) {
    const workerHits = sampleRoutes.filter((route) => resolveBase(route, { ...config, apiBase: legacyBase, workerBase }) === workerBase);
    assert(workerHits.length > 0, 'Ao menos uma rota de exemplo deve apontar para o Worker quando o canario estiver habilitado.');
  }

  console.log('Smoke test do rollout canario concluido com sucesso.');
}

run().catch((error) => {
  console.error('Smoke test do rollout canario falhou:', error.message);
  process.exitCode = 1;
});