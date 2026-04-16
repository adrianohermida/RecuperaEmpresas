'use strict';
require('dotenv').config();

const crypto       = require('crypto');
const path         = require('path');
const fs           = require('fs');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const BASE_URL   = process.env.BASE_URL   || `http://localhost:${PORT}`;

// Freshdesk — secret: FRESHDESK_API_KEY | domínio: FRESHSALES_ALIAS_DOMAIN (fallback FRESHDESK_DOMAIN)
const FRESHDESK_HOST = (
  process.env.FRESHSALES_ALIAS_DOMAIN ||
  process.env.FRESHDESK_DOMAIN        ||
  'recuperaempresas'
) + '.freshdesk.com';
const FRESHDESK_KEY = (
  process.env.FRESHDESK_API_KEY ||
  process.env.FRESHDESK_KEY     ||
  '6wvjwNiWfTtY0sloBJSK'
);
const FD_AUTH = 'Basic ' + Buffer.from(FRESHDESK_KEY + ':X').toString('base64');

// Freshsales — secret: FRESHSALES_API_KEY | domínio: FRESHSALES_ALIAS_DOMAIN
const FRESHSALES_HOST = (
  process.env.FRESHSALES_ALIAS_DOMAIN ||
  process.env.FRESHDESK_DOMAIN        ||
  'recuperaempresas'
) + '.myfreshworks.com';
const FRESHSALES_KEY = process.env.FRESHSALES_API_KEY || '';

// Freshchat — secret: FRESHCHAT_API_KEY | domínio: FRESHCHAT_ALIAS_DOMAIN
const FRESHCHAT_HOST = (
  process.env.FRESHCHAT_ALIAS_DOMAIN ||
  process.env.FRESHDESK_DOMAIN       ||
  'recuperaempresas'
) + '.freshchat.com';
const FRESHCHAT_KEY = process.env.FRESHCHAT_API_KEY || '';

const FRESHCHAT_JWT_SECRET = Buffer.from(
  process.env.FRESHCHAT_JWT_SECRET || '8p6UT0bSzLGGahXjd+nPo7BrYc7oXT7KLdgctXABMxE=', 'base64'
);

// Email — secret: RESEND_API_KEY
const RESEND_KEY = process.env.RESEND_API_KEY || process.env.RESEND_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Recupera Empresas <contato@recuperaempresas.com.br>';
const EMAIL_TO   = process.env.EMAIL_TO   || 'contato@recuperaempresas.com.br';

// Stripe — secrets: STRIPE_SECRET_KEY, STRIPE_PUBLIC_KEY, STRIPE_ACCOUNT_ID, STRIPE_WEBHOOK_SECRET
const STRIPE_SECRET_KEY   = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '';
const STRIPE_PUBLIC_KEY   = process.env.STRIPE_PUBLIC_KEY || '';
const STRIPE_ACCOUNT_ID   = process.env.STRIPE_ACCOUNT_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'contato@recuperaempresas.com.br,camilagbhmaia@gmail.com,adrianohermida@gmail.com')
                       .split(',').map(e => e.trim().toLowerCase());

// ─── Google Calendar (service account) ───────────────────────────────────────
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
const GOOGLE_PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY  || '').replace(/\\n/g, '\n');
const GOOGLE_CALENDAR_ID  = process.env.GOOGLE_CALENDAR_ID  || '';
const GOOGLE_CALENDAR_TZ  = process.env.GOOGLE_CALENDAR_TZ  || 'America/Sao_Paulo';

// ─── Supabase — aceita nomes VITE_* (convenção do projeto) ou nomes genéricos ─
const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL      ||
  'https://riiajjmnzgagntiqqshs.supabase.co'
);
const SUPABASE_SERVICE_KEY = (
  process.env.VITE_SUPABASE_SERVICE_ROLE  ||
  process.env.SUPABASE_SERVICE_ROLE_KEY   ||
  ''
);
const SUPABASE_ANON_KEY = (
  process.env.VITE_SUPABASE_ANON_KEY                 ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY    ||
  process.env.SUPABASE_ANON_KEY                       ||
  ''
);

// Service role bypasses RLS — OBRIGATÓRIO para queries server-side
const SUPABASE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
if (!SUPABASE_ANON_KEY) {
  console.error('[SUPABASE] ❌  VITE_SUPABASE_ANON_KEY não definido — login/register vão falhar!');
  console.error('[SUPABASE] ❌  Defina VITE_SUPABASE_ANON_KEY no .env ou nas env vars do Render.');
}
if (!SUPABASE_SERVICE_KEY) {
  console.warn('[SUPABASE] ⚠️  VITE_SUPABASE_SERVICE_ROLE não definido — usando anon key.');
  console.warn('[SUPABASE] ⚠️  Queries de escrita/leitura admin serão bloqueadas por RLS.');
  console.warn('[SUPABASE] ⚠️  Defina VITE_SUPABASE_SERVICE_ROLE no .env para operação completa.');
}
console.log(`[SUPABASE] Projeto: ${SUPABASE_URL}`);

// sb = service role (DB + Auth admin operations)
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// sbAnon = anon key (Supabase Auth sign-in/sign-up — validates user credentials)
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const AUTH_EMAIL_REDIRECTS = {
  confirmSignUp:   `${BASE_URL}/login.html?confirmed=1`,
  inviteUser:      `${BASE_URL}/login.html?invited=1`,
  magicLink:       `${BASE_URL}/login.html?magic=1`,
  changeEmail:     `${BASE_URL}/login.html?email_changed=1`,
  resetPassword:   `${BASE_URL}/reset-password.html`,
  reauthentication:`${BASE_URL}/login.html?reauthenticated=1`,
};

// ─── Upload dir (for temp file uploads) ──────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Multer upload instance ───────────────────────────────────────────────────
const multer  = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({
  storage, limits: { fileSize: 20*1024*1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (/^(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar)$/.test(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido'));
  }
});

module.exports = {
  PORT,
  JWT_SECRET,
  BASE_URL,
  FRESHDESK_HOST,
  FRESHDESK_KEY,
  FD_AUTH,
  FRESHSALES_HOST,
  FRESHSALES_KEY,
  FRESHCHAT_HOST,
  FRESHCHAT_KEY,
  FRESHCHAT_JWT_SECRET,
  RESEND_KEY,
  EMAIL_FROM,
  EMAIL_TO,
  STRIPE_SECRET_KEY,
  STRIPE_PUBLIC_KEY,
  STRIPE_ACCOUNT_ID,
  STRIPE_WEBHOOK_SECRET,
  ADMIN_EMAILS,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CALENDAR_ID,
  GOOGLE_CALENDAR_TZ,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_KEY,
  AUTH_EMAIL_REDIRECTS,
  UPLOADS_DIR,
  sb,
  sbAnon,
  upload,
  storage,
};
