'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');
const rootVendorDir = path.join(rootDir, 'vendor');
const supabaseVendorSource = path.join(
  rootDir,
  'node_modules',
  '@supabase',
  'supabase-js',
  'dist',
  'umd',
  'supabase.js'
);

const mirroredHtmlFiles = [
  '404.html',
  'admin.html',
  'cliente.html',
  'configuracoes.html',
  'dashboard.html',
  'forgot-password.html',
  'index.html',
  'login.html',
  'oauth-consent.html',
  'perfil.html',
  'register.html',
  'reset-password.html'
];

const mirroredRouteAliases = [
  { file: 'admin.html', routeDir: path.join('admin', 'index.html') },
  { file: 'cliente.html', routeDir: path.join('cliente', 'index.html') },
  { file: 'configuracoes.html', routeDir: path.join('configuracoes', 'index.html') },
  { file: 'dashboard.html', routeDir: path.join('dashboard', 'index.html') },
  { file: 'forgot-password.html', routeDir: path.join('forgot-password', 'index.html') },
  { file: 'login.html', routeDir: path.join('login', 'index.html') },
  { file: 'oauth-consent.html', routeDir: path.join('oauth', 'consent', 'index.html') },
  { file: 'perfil.html', routeDir: path.join('perfil', 'index.html') },
  { file: 'register.html', routeDir: path.join('register', 'index.html') },
  { file: 'reset-password.html', routeDir: path.join('reset-password', 'index.html') }
];

const mirroredAssetDirs = ['css', 'js'];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanPath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
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

  copyFile(src, dest);
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  copyFile(src, dest);
  return true;
}

function getMirrorEntries() {
  return [
    ...mirroredHtmlFiles.map((file) => ({
      type: 'file',
      source: path.join(publicDir, file),
      target: path.join(rootDir, file)
    })),
    ...mirroredAssetDirs.map((dir) => ({
      type: 'dir',
      source: path.join(publicDir, dir),
      target: path.join(rootDir, dir)
    })),
    {
      type: 'file',
      source: path.join(publicDir, 'favicon.svg'),
      target: path.join(rootDir, 'favicon.svg')
    },
    {
      type: 'file',
      source: path.join(publicDir, '_headers'),
      target: path.join(rootDir, '_headers')
    },
    {
      type: 'file',
      source: path.join(publicDir, '_redirects'),
      target: path.join(rootDir, '_redirects')
    },
    {
      type: 'file',
      source: path.join(publicDir, 'robots.txt'),
      target: path.join(rootDir, 'robots.txt')
    }
  ];
}

function syncRootMirrors(options = {}) {
  const { silent = false } = options;

  if (!fs.existsSync(publicDir)) {
    throw new Error('public/ não encontrado para espelhamento da raiz.');
  }

  for (const entry of getMirrorEntries()) {
    cleanPath(entry.target);
    if (!fs.existsSync(entry.source)) continue;
    if (entry.type === 'dir') copyRecursive(entry.source, entry.target);
    else copyFile(entry.source, entry.target);
  }

  for (const alias of mirroredRouteAliases) {
    const sourcePath = path.join(rootDir, alias.file);
    const targetPath = path.join(rootDir, alias.routeDir);
    cleanPath(path.dirname(targetPath));
    copyFile(sourcePath, targetPath);
  }

  cleanPath(rootVendorDir);
  copyIfExists(supabaseVendorSource, path.join(rootVendorDir, 'supabase', 'supabase.js'));

  // Se existir um config.js gerado no build, ele deve prevalecer sobre o fallback de public/.
  copyIfExists(path.join(distDir, 'js', 'config.js'), path.join(rootDir, 'js', 'config.js'));

  if (!silent) {
    console.log('Espelhos da raiz sincronizados a partir de public/.');
  }
}

if (require.main === module) {
  syncRootMirrors();
}

module.exports = {
  getMirrorEntries,
  syncRootMirrors,
};
