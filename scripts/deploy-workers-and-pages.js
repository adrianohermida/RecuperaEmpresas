// scripts/deploy-workers-and-pages.js
// Faz deploy do Worker e do Pages em sequência
// Uso: node scripts/deploy-workers-and-pages.js

const { execSync } = require('child_process');
const path = require('path');

function run(cmd, cwd = process.cwd(), env = process.env) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd, env });
}

try {
  const rootDir = path.join(__dirname, '..');
  const publicApiBase = process.env.RE_API_BASE || 'https://api.recuperaempresas.com.br';
  const productionBuildEnv = {
    ...process.env,
    RE_API_BASE: publicApiBase,
    RE_API_WORKER_BASE: '',
    RE_API_WORKER_ROUTES: '',
  };

  // Gera o build do portal com o config.js atualizado.
  run('npm run build', rootDir, productionBuildEnv);

  // Deploy Worker (ajuste o path se necessário)
  const workerDir = path.join(__dirname, '../workers/portal-api');
  run('npx wrangler deploy', workerDir);

  // Deploy Pages a partir de dist em ambos os projetos que servem o portal.
  run('node scripts/deploy-portal-pages.js', rootDir, productionBuildEnv);

  console.log('\n✅ Deploy do Worker e Pages concluído!');
} catch (e) {
  console.error('\n❌ Erro no deploy:', e.message);
  process.exit(1);
}
