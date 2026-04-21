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
  const rootDir = path.join(__dirname, '..');

  // Gera o build do portal com o config.js atualizado.
  run('npm run build', rootDir);

  // Deploy Worker (ajuste o path se necessário)
  const workerDir = path.join(__dirname, '../workers/portal-api');
  run('npx wrangler deploy', workerDir);

  // Deploy Pages a partir de dist para evitar publicar assets stale da raiz.
  run('npx wrangler pages deploy dist --project-name=recuperaempresas --branch gh-pages', rootDir);

  console.log('\n✅ Deploy do Worker e Pages concluído!');
} catch (e) {
  console.error('\n❌ Erro no deploy:', e.message);
  process.exit(1);
}
