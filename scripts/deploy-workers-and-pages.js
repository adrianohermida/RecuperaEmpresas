// scripts/deploy-workers-and-pages.js
// Faz deploy do Worker e do Pages em sequência
// Uso: node scripts/deploy-workers-and-pages.js

const { execSync } = require('child_process');
const path = require('path');

function run(cmd, cwd = process.cwd()) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
}

try {
  // Deploy Worker (ajuste o path se necessário)
  const workerDir = path.join(__dirname, '../workers/portal-api');
  run('npx wrangler deploy', workerDir);

  // Deploy Pages (diretório raiz)
  run('npx wrangler pages deploy . --branch gh-pages', path.join(__dirname, '..'));

  console.log('\n✅ Deploy do Worker e Pages concluído!');
} catch (e) {
  console.error('\n❌ Erro no deploy:', e.message);
  process.exit(1);
}
