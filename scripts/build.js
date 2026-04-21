'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { syncRootMirrors } = require('./sync-root-mirrors');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function createHtmlRouteAlias(sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(distDir, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) return;

  const targetPath = path.join(distDir, targetRelativePath);
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

if (!fs.existsSync(publicDir)) {
  console.error('Build failed: public/ não encontrado.');
  process.exit(1);
}

cleanDir(distDir);
copyRecursive(publicDir, distDir);
copyIfExists(
  path.join(rootDir, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
  path.join(distDir, 'vendor', 'supabase', 'supabase.js')
);

// Static portal deployments default to same-origin `/api/*`.
// Only set RE_STATIC_API_BASE explicitly for a deliberate non-production split-origin environment.
const defaultWorkerApiBase = '';
const defaultWorkerApiRoutes = [];
const defaultApiBase = '';
const apiBase = process.env.RE_STATIC_API_BASE || defaultApiBase;
const workerApiBase = process.env.RE_API_WORKER_BASE || defaultWorkerApiBase;
const workerApiRoutes = (process.env.RE_API_WORKER_ROUTES || defaultWorkerApiRoutes.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://riiajjmnzgagntiqqshs.supabase.co';
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const freshchatEnabled = process.env.RE_ENABLE_FRESHCHAT === 'true';
const freshchatToken = process.env.RE_FRESHCHAT_TOKEN || '';
const freshchatSiteId = process.env.RE_FRESHCHAT_SITE_ID || '';
const recaptchaSiteKey = process.env.GOOGLE_RECAPTCHA_SITE_KEY || process.env.RECAPTCHA_SITE_KEY || '';
const configPath = path.join(distDir, 'js', 'config.js');
ensureDir(path.dirname(configPath));
fs.writeFileSync(
  configPath,
  [
    '/**',
    ' * config.js — generated during build',
    ' */',
    `window.RE_API_BASE = ${JSON.stringify(apiBase)};`,
    `window.RE_API_WORKER_BASE = ${JSON.stringify(workerApiBase)};`,
    `window.RE_API_WORKER_ROUTES = ${JSON.stringify(workerApiRoutes)};`,
    `window.VITE_SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`,
    `window.VITE_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnon)};`,
    `window.RE_SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`,
    `window.RE_SUPABASE_ANON = ${JSON.stringify(supabaseAnon)};`,
    `window.RE_ENABLE_FRESHCHAT = ${JSON.stringify(freshchatEnabled)};`,
    `window.RE_FRESHCHAT_TOKEN = ${JSON.stringify(freshchatToken)};`,
    `window.RE_FRESHCHAT_SITE_ID = ${JSON.stringify(freshchatSiteId)};`,
    `window.RE_GOOGLE_RECAPTCHA_SITE_KEY = ${JSON.stringify(recaptchaSiteKey)};`,
    ''
  ].join('\n'),
  'utf8'
);

const loginPath = path.join(distDir, 'login.html');
if (fs.existsSync(loginPath)) {
  fs.copyFileSync(loginPath, path.join(distDir, '404.html'));
}

fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

// Aliases de rotas HTML para Cloudflare Pages
// Use apenas uma chamada por alias para evitar duplicidade.
createHtmlRouteAlias('login.html', path.join('login', 'index.html'));
createHtmlRouteAlias('register.html', path.join('register', 'index.html'));
createHtmlRouteAlias('forgot-password.html', path.join('forgot-password', 'index.html'));
createHtmlRouteAlias('reset-password.html', path.join('reset-password', 'index.html'));
createHtmlRouteAlias('oauth-consent.html', path.join('oauth', 'consent', 'index.html'));
createHtmlRouteAlias('dashboard.html', path.join('dashboard', 'index.html'));
createHtmlRouteAlias('admin.html', path.join('admin', 'index.html'));
createHtmlRouteAlias('formulario.html', path.join('formulario', 'index.html'));
createHtmlRouteAlias('perfil.html', path.join('perfil', 'index.html'));
createHtmlRouteAlias('configuracoes.html', path.join('configuracoes', 'index.html'));
createHtmlRouteAlias('cliente.html', path.join('cliente', 'index.html'));
createHtmlRouteAlias('suporte-admin.html', path.join('suporte-admin', 'index.html'));
createHtmlRouteAlias('tarefas-admin.html', path.join('tarefas-admin', 'index.html'));
createHtmlRouteAlias('documentos-admin.html', path.join('documentos-admin', 'index.html'));
// Sempre mantenha aliases únicos e documente a decisão para evitar regressão.

// Keep the branch root aligned with the portal build because some Cloudflare
// Pages source deployments have resolved clean routes from the repository root.
// Mirroring here prevents stale auth pages from resurfacing on /login and peers.
syncRootMirrors({ silent: true });

console.log('Build concluído com sucesso. Saída em dist/.');
