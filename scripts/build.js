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

// Static portal deploys on Pages must keep working even if the Pages panel
// executes a secondary build without custom env vars.
const defaultWorkerApiBase = 'https://api-edge.recuperaempresas.com.br';
const defaultWorkerApiRoutes = ['/api'];
const apiBase = process.env.RE_API_BASE || '';
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
    `window.RE_SUPABASE_URL = ${JSON.stringify(supabaseUrl)};`,
    `window.RE_SUPABASE_ANON = ${JSON.stringify(supabaseAnon)};`,
    `window.RE_ENABLE_FRESHCHAT = ${JSON.stringify(freshchatEnabled)};`,
    `window.RE_FRESHCHAT_TOKEN = ${JSON.stringify(freshchatToken)};`,
    `window.RE_FRESHCHAT_SITE_ID = ${JSON.stringify(freshchatSiteId)};`,
    ''
  ].join('\n'),
  'utf8'
);

const loginPath = path.join(distDir, 'login.html');
if (fs.existsSync(loginPath)) {
  fs.copyFileSync(loginPath, path.join(distDir, '404.html'));
}

fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

createHtmlRouteAlias('login.html', path.join('login', 'index.html'));
createHtmlRouteAlias('register.html', path.join('register', 'index.html'));
createHtmlRouteAlias('forgot-password.html', path.join('forgot-password', 'index.html'));
createHtmlRouteAlias('reset-password.html', path.join('reset-password', 'index.html'));
createHtmlRouteAlias('oauth-consent.html', path.join('oauth', 'consent', 'index.html'));

// Root files are now reserved for the marketing/landing experience on GitHub Pages.
// Only sync portal mirrors to the repository root when explicitly requested.
if (process.env.SYNC_ROOT_MIRRORS === 'true') {
  syncRootMirrors({ silent: true });
}

console.log('Build concluído com sucesso. Saída em dist/.');
