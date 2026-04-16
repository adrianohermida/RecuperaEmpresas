'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function request(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: 'GET',
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, '/api/health');
      if (response.statusCode === 200) return;
      lastError = new Error(`Healthcheck retornou ${response.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timeout aguardando servidor responder');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const port = await getFreePort();
  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      VITE_SUPABASE_SERVICE_ROLE: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      RE_ENABLE_FRESHCHAT: 'false',
      OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID || 'smoke-test-client',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(port, 20000);

    const health = await request(port, '/api/health');
    assert(health.statusCode === 200, 'GET /api/health deve retornar 200');
    const healthJson = JSON.parse(health.body);
    assert(healthJson.status === 'ok', 'GET /api/health deve retornar status ok');

    const config = await request(port, '/js/config.js');
    assert(config.statusCode === 200, 'GET /js/config.js deve retornar 200');
    assert(config.body.includes('window.RE_SUPABASE_URL'), 'config.js deve expor RE_SUPABASE_URL');
    assert(config.body.includes('window.RE_SUPABASE_ANON'), 'config.js deve expor RE_SUPABASE_ANON');

    const oauthConsent = await request(port, '/oauth/consent');
    assert(oauthConsent.statusCode === 200, 'GET /oauth/consent deve retornar 200');
    assert(/html/i.test(String(oauthConsent.headers['content-type'] || '')), '/oauth/consent deve retornar HTML');

    const fallback = await request(port, '/rota-inexistente-smoke');
    assert(fallback.statusCode === 200, 'Fallback deve retornar 200');
    assert(/html/i.test(String(fallback.headers['content-type'] || '')), 'Fallback deve retornar HTML');

    console.log('Smoke test concluído com sucesso.');
  } finally {
    child.kill();
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(resolve, 2000);
    });
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((error) => {
  console.error('Smoke test falhou:', error.message);
  process.exitCode = 1;
});
