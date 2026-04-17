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
  if (!allowed) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(response.body, { ...response, headers });
}