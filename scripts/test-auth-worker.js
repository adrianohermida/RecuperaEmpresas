'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const content = fs.readFileSync(envPath, 'utf8');
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      })
  );
}

function logResult(label, value) {
  process.stdout.write(label + '=' + value + '\n');
}

async function buildLocalInvoker(env) {
  const { handleAuth } = await import('../workers/portal-api/src/routes/auth.mjs');
  return {
    async request(method, pathname, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
      }
      const request = new Request('https://api-edge.recuperaempresas.com.br' + pathname, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      return handleAuth(request, env);
    },
  };
}

function buildPublishedInvoker(baseUrl) {
  return {
    async request(method, pathname, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(baseUrl.replace(/\/+$/, '') + pathname, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    },
  };
}

async function readJsonSafe(response) {
  const text = await response.text();
  return {
    text,
    json: text ? JSON.parse(text) : {},
  };
}

async function main() {
  const env = loadEnv();
  const mode = process.argv[2] || 'local';
  const targetBase = process.argv[3] || process.env.TARGET_BASE || 'https://api-edge.recuperaempresas.com.br';

  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRole = env.VITE_SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

  const invoker = mode === 'published' ? buildPublishedInvoker(targetBase) : await buildLocalInvoker(env);
  const email = 'copilot-auth-' + Date.now() + '@example.com';
  const password = 'SenhaSegura123!';

  let userId = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: 'Auth Test', company: 'Recupera QA' },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;

    const loginResponse = await invoker.request('POST', '/api/auth/login', {
      body: { email, password },
    });
    const loginPayload = await readJsonSafe(loginResponse);
    const sessionCookie = loginResponse.headers.get('set-cookie') || '';
    logResult('mode', mode);
    logResult('login_status', loginResponse.status);
    logResult('login_cookie_length', sessionCookie.length);
    logResult('login_body', loginPayload.text);

    const verifyResponse = await invoker.request('GET', '/api/auth/verify', {
      headers: { Cookie: sessionCookie },
    });
    logResult('verify_status', verifyResponse.status);
    logResult('verify_body', await verifyResponse.text());

    const refreshResponse = await invoker.request('POST', '/api/auth/session/refresh', {
      headers: { Cookie: sessionCookie },
      body: loginPayload.json.supabase_session || {},
    });
    const refreshPayload = await readJsonSafe(refreshResponse);
    const refreshCookie = refreshResponse.headers.get('set-cookie') || '';
    logResult('refresh_status', refreshResponse.status);
    logResult('refresh_cookie_length', refreshCookie.length);
    logResult('refresh_body', refreshPayload.text);

    const logoutResponse = await invoker.request('POST', '/api/auth/logout', {
      headers: { Cookie: refreshCookie || sessionCookie },
      body: loginPayload.json.supabase_session || {},
    });
    logResult('logout_status', logoutResponse.status);
    logResult('logout_cookie', logoutResponse.headers.get('set-cookie') || '');
    logResult('logout_body', await logoutResponse.text());

    const verifyAfterLogoutResponse = await invoker.request('GET', '/api/auth/verify', {
      headers: { Cookie: sessionCookie },
    });
    logResult('verify_after_logout_status', verifyAfterLogoutResponse.status);
    logResult('verify_after_logout_body', await verifyAfterLogoutResponse.text());

    if (loginResponse.status !== 200 || verifyResponse.status !== 200 || refreshResponse.status !== 200 || logoutResponse.status !== 200 || verifyAfterLogoutResponse.status !== 401) {
      process.exitCode = 1;
    }
  } finally {
    if (userId) {
      await admin.from('re_users').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});