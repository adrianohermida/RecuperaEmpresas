export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function noContent(init = {}) {
  return new Response(null, { status: 204, ...init });
}

export function notFound(message = 'Rota não encontrada.') {
  return json({ error: message }, { status: 404 });
}

export function methodNotAllowed() {
  return json({ error: 'Método não permitido.' }, { status: 405 });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

export function parseCookies(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const entries = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex < 0) return [item, ''];
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    });
  return Object.fromEntries(entries);
}

function applySecurityHeaders(request, response) {
  const headers = new Headers(response.headers);
  const pathname = new URL(request.url).pathname;

  if (!headers.has('Cache-Control') && pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
  if (!headers.has('Permissions-Policy')) {
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function applyCors(request, response, env) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https:\/\/(www\.)?recuperaempresas\.com\.br$/,
    /^https:\/\/portal\.recuperaempresas\.com\.br$/,
    /^https:\/\/[^.]+\.pages\.dev$/,
  ];
  const explicit = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = allowedOrigins.some((pattern) => pattern.test(origin)) || explicit.includes(origin);
  const secured = applySecurityHeaders(request, response);
  if (!allowed) return secured;

  const headers = new Headers(secured.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept,X-Requested-With');
  headers.append('Vary', 'Origin');
  return new Response(secured.body, {
    status: secured.status,
    statusText: secured.statusText,
    headers,
  });
}