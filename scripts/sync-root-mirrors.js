'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const MIRROR_PATHS = [
  'admin.html',
  'dashboard.html',
  'forgot-password.html',
  'index.html',
  'login.html',
  'oauth-consent.html',
  'register.html',
  'reset-password.html',
  'favicon.svg',
  'css/auth.css',
  'css/portal.css',
  'css/style.css',
  'js/api-base.js',
  'js/admin-client-drawer.js',
  'js/app.js',
  'js/config.js',
  'js/shared-utils.js',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function syncRootMirrors(options = {}) {
  const { silent = false } = options;

  if (!fs.existsSync(publicDir)) {
    throw new Error('public/ não encontrado para sincronizar espelhos da raiz.');
  }

  for (const relativePath of MIRROR_PATHS) {
    const sourcePath = path.join(publicDir, relativePath);
    const targetPath = path.join(rootDir, relativePath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo de origem ausente em public/: ${relativePath}`);
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);

    if (!silent) {
      console.log(`Espelho atualizado: ${relativePath}`);
    }
  }
}

if (require.main === module) {
  syncRootMirrors();
}

module.exports = {
  MIRROR_PATHS,
  syncRootMirrors,
};