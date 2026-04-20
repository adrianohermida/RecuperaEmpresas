// scripts/diagnose-supabase-admin.js
// Diagnóstico avançado das configs sensíveis do Supabase via API Admin
// Uso: node scripts/diagnose-supabase-admin.js


// Node.js 18+ já possui fetch global
const fetchFn = global.fetch || fetch;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://riiajjmnzgagntiqqshs.supabase.co';
const SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}

async function getAuthConfig() {
  // Endpoint privado da API Admin do Supabase
  const url = `${SUPABASE_URL}/auth/v1/admin/settings`;
  const res = await fetchFn(url, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Erro ao buscar configs: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

(async () => {
  console.log('--- Diagnóstico Avançado Supabase (Admin API) ---\n');
  try {
    const config = await getAuthConfig();
    console.log('Site URL:', config.site_url);
    console.log('Redirect URLs:', config.redirect_urls);
    if (!config.site_url || !Array.isArray(config.redirect_urls)) {
      console.warn('⚠️  Atenção: Não foi possível obter todas as configs esperadas.');
    }
    // Checklist básico
    const esperado = [
      'https://recuperaempresas.com.br/login.html',
      'https://recuperaempresas.com.br/reset-password.html',
      'https://recuperaempresas.com.br/oauth/consent',
      'https://recuperaempresas.com.br/api/auth/oauth/callback',
      // Adicione outros redirects necessários aqui
    ];
    const faltando = esperado.filter(url => !config.redirect_urls.includes(url));
    if (faltando.length) {
      console.warn('\n⚠️  URLs de redirect faltando no painel Supabase:');
      faltando.forEach(url => console.warn(' -', url));
    } else {
      console.log('\n✅ Todas as URLs essenciais de redirect estão cadastradas.');
    }
  } catch (e) {
    console.error('Erro:', e.message);
  }
  console.log('\n--- Fim do diagnóstico ---');
})();
