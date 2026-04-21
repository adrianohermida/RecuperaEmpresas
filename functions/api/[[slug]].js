const DEFAULT_LEGACY_API_BASE = 'https://api.recuperaempresas.com.br';
const DEFAULT_WORKER_API_BASE = 'https://api-edge.recuperaempresas.com.br';
const DEFAULT_WORKER_ROUTES = [
  '/api/auth',
  '/api/company/members',
  '/api/company/members/*',
  '/api/admin/clients',
  '/api/admin/client/*',
  '/api/admin/messages/unread',
  '/api/admin/messages/seen/*',
  '/api/admin/logs',
  '/api/admin/stats',
  '/api/admin/agenda/slots',
  '/api/admin/financial',
  '/api/admin/forms',
  '/api/admin/audit-log',
  '/api/admin/invoices',
  '/api/admin/journeys',
  '/api/admin/impersonate',
  '/api/admin/services',
  '/api/admin/service-orders',
  '/api/notifications'
];

function trimBase(value) {
  return String(value || '').replace(/\/+$/, '');
}

function parseWorkerRoutes(value) {
  if (!value) return DEFAULT_WORKER_ROUTES.slice();
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const wildcarded = escaped.replace(/\*/g, '[^/]+');
  return new RegExp(`^${wildcarded}(?:$|/.*)`);
}

function matchesWorkerRoute(pathname, patterns) {
  return patterns.some((pattern) => {
    if (pattern.includes('*')) return patternToRegex(pattern).test(pathname);
    return pathname === pattern || pathname.startsWith(`${pattern}/`);
  });
}

function resolveTargetBase(pathname, method, env) {
  const legacyBase = trimBase(env.RE_API_BASE || DEFAULT_LEGACY_API_BASE);
  const workerBase = trimBase(env.RE_API_WORKER_BASE || DEFAULT_WORKER_API_BASE);
  const workerRoutes = parseWorkerRoutes(env.RE_API_WORKER_ROUTES);

  if (workerBase && method === 'DELETE' && /^\/api\/admin\/client\/[^/]+$/.test(pathname)) return workerBase;
  if (workerBase && matchesWorkerRoute(pathname, workerRoutes)) return workerBase;
  if (legacyBase) return legacyBase;
  if (workerBase) return workerBase;
  return '';
}

export async function onRequest(context) {
  const { request, env } = context;
  const incomingUrl = new URL(request.url);
  const targetBase = resolveTargetBase(incomingUrl.pathname, request.method, env);

  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `${targetBase}/`);

  if (targetUrl.origin === incomingUrl.origin) {
    return Response.json(
      { error: 'Pages API proxy target would recurse into itself.' },
      { status: 500 }
    );
  }

  return fetch(new Request(targetUrl.toString(), request));
}
