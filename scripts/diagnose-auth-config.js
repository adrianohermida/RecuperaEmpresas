// scripts/diagnose-auth-config.js
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (e) {
    console.error('node-fetch não encontrado e fetch global não disponível. Use Node.js 18+ ou instale node-fetch.');
    process.exit(1);
  }
}
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(line => !line.trim().startsWith('#'))
      .map(line => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      })
  );
}

async function checkWorkerStatus(workerUrl) {
  try {
    const res = await fetchFn(workerUrl + '/api/auth/oauth/status');
    const json = await res.json();
    return { ok: res.ok, ...json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkPagesVars(pagesUrl) {
  try {
    const res = await fetchFn(pagesUrl + '/api/auth/oauth/status');
    const json = await res.json();
    return { ok: res.ok, ...json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkSupabaseRedirects(supabaseUrl, anonKey) {
  try {
    const res = await fetchFn(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey }
    });
    const json = await res.json();
    return json;
  } catch (e) {
    return { error: e.message };
  }
}

(async () => {
  const env = loadEnv();
  const workerUrl = env.WORKER_URL || 'https://api-edge.recuperaempresas.com.br';
  const pagesUrl = env.PAGES_URL || 'https://portal.recuperaempresas.com.br';
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

  console.log('--- Diagnóstico de Autenticação ---\n');

  // 1. Diagnóstico do Worker
  console.log('🔎 Cloudflare Worker:');
  const worker = await checkWorkerStatus(workerUrl);
  if (worker.ok && worker.configured) {
    console.log('✅ Worker configurado corretamente.');
  } else {
    console.log('❌ Worker com problemas:', worker.missing || worker.error || worker);
  }

  // 2. Diagnóstico do Pages
  console.log('\n🔎 Cloudflare Pages:');
  const pages = await checkPagesVars(pagesUrl);
  if (pages.ok && pages.configured) {
    console.log('✅ Pages configurado corretamente.');
  } else {
    console.log('❌ Pages com problemas:', pages.missing || pages.error || pages);
  }

  // 3. Diagnóstico do Supabase
  console.log('\n🔎 Supabase Redirect URLs:');
  if (supabaseUrl && anonKey) {
    const supa = await checkSupabaseRedirects(supabaseUrl, anonKey);
    if (supa.site_url && Array.isArray(supa.redirect_urls)) {
      console.log('Site URL:', supa.site_url);
      console.log('Redirect URLs:', supa.redirect_urls);
      // Aqui você pode comparar com a lista esperada e alertar se faltar algum
    } else {
      console.log('❌ Não foi possível obter configurações do Supabase:', supa.error || supa);
    }
  } else {
    console.log('❌ Variáveis do Supabase ausentes no .env');
  }

  console.log('\n--- Fim do diagnóstico ---');
})();