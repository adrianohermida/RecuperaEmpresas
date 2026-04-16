'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const TOP_LEVEL_FILES = [
  'admin.html',
  'dashboard.html',
  'forgot-password.html',
  'index.html',
  'login.html',
  'oauth-consent.html',
  'register.html',
  'reset-password.html',
  'favicon.svg',
];

const MIRROR_DIRECTORIES = ['css', 'js'];

const DERIVED_MIRRORS = [
  { source: 'login.html', target: '404.html' },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFilesRecursively(dirPath, relativePrefix = '') {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativePrefix, entry.name);
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolutePath, relativePath));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function getMirrorEntries() {
  const entries = TOP_LEVEL_FILES.map((relativePath) => ({
    source: relativePath,
    target: relativePath,
  }));

  for (const dirName of MIRROR_DIRECTORIES) {
    const sourceDir = path.join(publicDir, dirName);
    if (!fs.existsSync(sourceDir)) {
      continue;
    }

    for (const relativePath of listFilesRecursively(sourceDir, dirName)) {
      entries.push({ source: relativePath, target: relativePath });
    }
  }

  entries.push(...DERIVED_MIRRORS);
  return entries;
}

function syncRootMirrors(options = {}) {
  const { silent = false } = options;

  if (!fs.existsSync(publicDir)) {
    throw new Error('public/ não encontrado para sincronizar espelhos da raiz.');
  }

  for (const entry of getMirrorEntries()) {
    const sourcePath = path.join(publicDir, entry.source);
    const targetPath = path.join(rootDir, entry.target);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Arquivo de origem ausente em public/: ${entry.source}`);
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);

    if (!silent) {
      console.log(`Espelho atualizado: ${entry.target}`);
    }
  }
}

if (require.main === module) {
  syncRootMirrors();
}

module.exports = {
  getMirrorEntries,
  syncRootMirrors,
};