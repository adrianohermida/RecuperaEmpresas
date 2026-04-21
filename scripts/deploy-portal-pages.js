'use strict';

const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const projects = [
  'recuperaempresas',
  'recuperaempresas-landing',
];

for (const project of projects) {
  console.log(`\n$ npx --yes wrangler@4.12.0 pages deploy dist --project-name=${project} --branch=gh-pages`);
  execSync(`npx --yes wrangler@4.12.0 pages deploy dist --project-name=${project} --branch=gh-pages`, {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
  });
}
