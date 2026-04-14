'use strict';

const fs = require('fs');
const path = require('path');

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

if (!fs.existsSync(publicDir)) {
  console.error('Build failed: public/ não encontrado.');
  process.exit(1);
}

cleanDir(distDir);
copyRecursive(publicDir, distDir);

const apiBase = process.env.RENDER_API_URL || process.env.RE_API_BASE || '';
const configPath = path.join(distDir, 'js', 'config.js');
ensureDir(path.dirname(configPath));
fs.writeFileSync(
  configPath,
  [
    '/**',
    ' * config.js — generated during build',
    ' */',
    `window.RE_API_BASE = ${JSON.stringify(apiBase)};`,
    ''
  ].join('\n'),
  'utf8'
);

const loginPath = path.join(distDir, 'login.html');
if (fs.existsSync(loginPath)) {
  fs.copyFileSync(loginPath, path.join(distDir, '404.html'));
}

fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

console.log('Build concluído com sucesso. Saída em dist/.');
