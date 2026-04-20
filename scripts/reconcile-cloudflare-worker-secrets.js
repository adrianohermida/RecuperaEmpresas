'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const configPath = process.env.WORKER_WRANGLER_CONFIG || 'workers/portal-api/wrangler.toml';
const auditDir = process.env.AUDIT_DIR || '.cloudflare-worker-secrets-audit';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadDotEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function putSecret(name, value) {
  if (!value) {
    console.log(`Skipping empty Worker secret ${name}`);
    return;
  }

  console.log(`Reconciling Worker secret ${name}`);
  const result = spawnSync(
    'npx',
    ['--yes', 'wrangler@4.12.0', 'secret', 'put', name, '-c', configPath],
    {
      cwd: rootDir,
      input: value,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: process.env,
    }
  );

  const logPath = path.join(rootDir, auditDir, `${name}.log`);
  fs.writeFileSync(logPath, `${result.stdout || ''}${result.stderr || ''}`, 'utf8');

  if (result.status !== 0) {
    throw new Error(`Failed to reconcile Worker secret ${name}`);
  }
}

function main() {
  loadDotEnv();
  ensureDir(path.join(rootDir, auditDir));

  const secrets = [
    ['VITE_SUPABASE_URL', firstDefined(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_URL, 'https://riiajjmnzgagntiqqshs.supabase.co')],
    ['VITE_SUPABASE_ANON_KEY', firstDefined(process.env.VITE_SUPABASE_ANON_KEY, process.env.SUPABASE_ANON_KEY)],
    ['SUPABASE_SERVICE_ROLE_KEY', firstDefined(process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.VITE_SUPABASE_SERVICE_ROLE, process.env.SUPABASE_SERVICE_KEY)],
    ['JWT_SECRET', firstDefined(process.env.JWT_SECRET)],
    ['OAUTH_CLIENT_ID', firstDefined(process.env.OAUTH_CLIENT_ID)],
    ['OAUTH_CLIENT_SECRET', firstDefined(process.env.OAUTH_CLIENT_SECRET)],
    ['RESEND_API_KEY', firstDefined(process.env.RESEND_API_KEY)],
  ];

  for (const [name, value] of secrets) {
    putSecret(name, value);
  }

  const summary = [
    `Worker config: ${configPath}`,
    `Secrets reconciled: ${secrets.filter(([, value]) => value).map(([name]) => name).join(', ')}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(rootDir, auditDir, 'summary.txt'), summary, 'utf8');
  console.log('Cloudflare Worker secret reconciliation completed');
}

main();