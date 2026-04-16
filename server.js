'use strict';
require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
const path         = require('path');
const fs           = require('fs');
const https        = require('https');
const { createClient } = require('@supabase/supabase-js');
const XLSX    = require('xlsx');
const PDFDoc  = require('pdfkit');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const planRoutes = require('./routes/plan');
const taskRoutes = require('./routes/tasks');
const messageRoutes = require('./routes/messages');
const adminClientRoutes = require('./routes/admin-clients');

const {
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
} = require('./lib/config');
const { signToken, verifyToken, requireAuth, requireAdmin } = require('./lib/auth');
const {
  findUserByEmail,
  findUserById,
  saveUser,
  readOnboarding,
  saveOnboarding,
  readPlan,
  saveChapterStatus,
  readTasks,
  upsertTask,
  readMessages,
  insertMessage,
  readAppointments,
  insertAppointment,
  updateAppointment,
} = require('./lib/db');
const { logAccess, auditLog, pushNotification } = require('./lib/logging');
const {
  createFreshdeskTicket,
  createFreshdeskContact,
  addFreshdeskNote,
  updateFreshdeskTicket,
  syncFreshsalesContact,
  createFreshsalesDeal,
} = require('./lib/crm');
const {
  sendMail,
  STEP_TITLES,
  EMAIL_STYLE,
  emailStyle,
  emailFactRow,
  emailFactTable,
  emailWrapper,
  buildClientStepConfirmHtml,
  buildStepHtml,
} = require('./lib/email');

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();

// ── CORS — allow the GitHub Pages frontend (and local dev) to call this API ──
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Always allow localhost and the Render service itself
const DEFAULT_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/(www\.)?recuperaempresas\.com\.br$/,
  /^https:\/\/recuperaempresas\.onrender\.com$/,
  // GitHub Pages: https://<user>.github.io  (any path)
  /^https:\/\/[^.]+\.github\.io$/,
  // Cloudflare Pages: https://<project>.pages.dev
  /^https:\/\/[^.]+\.pages\.dev$/,
];

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed =
    DEFAULT_ORIGINS.some(re => re.test(origin)) ||
    ALLOWED_ORIGINS.includes(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Auth endpoints: 20 tentativas / 15 min por IP (login, register, forgot-password)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});
app.use('/api/auth/login',               authLimiter);
app.use('/api/auth/register',            authLimiter);
app.use('/api/auth/forgot-password',     authLimiter);
app.use('/api/auth/reset-password',      authLimiter);
app.use('/api/auth/resend-confirmation', authLimiter);

// API geral: 300 req / min por IP (protege contra flood/scraping)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições atingido. Tente novamente em instantes.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});
app.use('/api/', apiLimiter);

// Upload de arquivos: 10 uploads / 10 min por IP
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos uploads. Aguarde 10 minutos.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});
app.use('/api/documents/upload', uploadLimiter);
app.use('/api/submit',           uploadLimiter);

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// Serve config.js dynamically so the browser gets the correct Supabase URL/key
app.get('/js/config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.RE_API_BASE        = '';
window.RE_SUPABASE_URL    = ${JSON.stringify(SUPABASE_URL)};
window.RE_SUPABASE_ANON   = ${JSON.stringify(SUPABASE_ANON_KEY)};
window.RE_OAUTH_CLIENT_ID = ${JSON.stringify(process.env.OAUTH_CLIENT_ID || '')};
window.RE_ENABLE_FRESHCHAT = ${JSON.stringify(process.env.RE_ENABLE_FRESHCHAT === 'true')};
window.RE_FRESHCHAT_TOKEN  = ${JSON.stringify(process.env.RE_FRESHCHAT_TOKEN || '')};
window.RE_FRESHCHAT_SITE_ID = ${JSON.stringify(process.env.RE_FRESHCHAT_SITE_ID || '')};
`);
});

app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || /\.html?$/i.test(req.path))) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

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

// Helper: safe public user object
function safeUser(u) {
  return {
    id:              u.id,
    name:            u.name || u.full_name || '',
    email:           u.email,
    company:         u.company || '',
    isAdmin:         u.is_admin || ADMIN_EMAILS.includes((u.email||'').toLowerCase()),
    credits_balance: u.credits_balance ?? 0,
    freshdeskTicketId:  u.freshdesk_ticket_id  || null,
    freshdeskContactId: u.freshdesk_contact_id || null,
    createdAt: u.created_at,
  };
}

function extractMissingColumnName(message) {
  const text = String(message || '');
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i,
    /Could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i,
    /record\s+['"]?(?:new|old)['"]?\s+has no field\s+['"]?([a-zA-Z0-9_]+)['"]?/i,
    /schema cache.*column\s+['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function isSchemaCompatibilityError(message, hints = []) {
  const text = String(message || '').toLowerCase();
  const hasSchemaSignal = [
    'does not exist',
    'could not find',
    'schema cache',
    'has no field',
    'relation',
  ].some((signal) => text.includes(signal));

  if (!hasSchemaSignal) return false;
  if (!hints.length) return true;
  return hints.some((hint) => text.includes(String(hint).toLowerCase()));
}

function isCompanyMembersSchemaError(message) {
  return isSchemaCompatibilityError(message, ['re_company_users', 'company_id', 'password_hash', 'invited_at', 'last_login', 'role', 'active']);
}

function buildRouteDiagnostic(route, error, attempts = []) {
  return {
    route,
    lastError: String(error?.message || error || ''),
    attempts: attempts.map((attempt, index) => ({
      index: index + 1,
      requiredColumns: attempt.requiredColumns || [],
      returningColumns: attempt.returningColumns || [],
      payloadKeys: Object.keys(attempt.payload || {}),
    })),
  };
}

async function selectWithColumnFallback(table, options) {
  let columns = [...(options.columns || [])];
  let orderBy = [...(options.orderBy || [])];
  const requiredColumns = new Set(options.requiredColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).select(columns.join(','));
    if (typeof options.apply === 'function') query = options.apply(query);
    if (orderBy[0]) query = query.order(orderBy[0], { ascending: options.ascending ?? true });

    const { data, error } = await query;
    if (!error) return { data, error: null, columns, order: orderBy[0] || null };

    const missingColumn = extractMissingColumnName(error.message);
    if (!missingColumn) return { data: null, error, columns, order: orderBy[0] || null };

    if (columns.includes(missingColumn) && !requiredColumns.has(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do select: ${missingColumn}`);
      continue;
    }

    if (orderBy.includes(missingColumn)) {
      orderBy = orderBy.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do order: ${missingColumn}`);
      continue;
    }

    return { data: null, error, columns, order: orderBy[0] || null };
  }

  return { data: null, error: new Error(`Falha ao consultar ${table} com fallback de schema.`), columns, order: orderBy[0] || null };
}

async function insertWithColumnFallback(table, payload, options = {}) {
  const candidate = { ...payload };
  const requiredColumns = new Set(options.requiredColumns || []);
  let returningColumns = [...(options.returningColumns || [])];
  const requiredReturningColumns = new Set(options.requiredReturningColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).insert(candidate);
    if (returningColumns.length) query = query.select(returningColumns.join(','));
    else query = query.select();
    const { data, error } = await query.single();
    if (!error) return { data, error: null, payload: candidate };

    const missingColumn = extractMissingColumnName(error.message);
    if (missingColumn && returningColumns.includes(missingColumn) && !requiredReturningColumns.has(missingColumn)) {
      returningColumns = returningColumns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do retorno do insert: ${missingColumn}`);
      continue;
    }

    if (!missingColumn || !(missingColumn in candidate) || requiredColumns.has(missingColumn)) {
      return { data: null, error, payload: candidate };
    }

    delete candidate[missingColumn];
    console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do insert: ${missingColumn}`);
  }

  return { data: null, error: new Error(`Falha ao inserir em ${table} com fallback de schema.`), payload: candidate };
}

async function updateWithColumnFallback(table, match, payload, options = {}) {
  let candidate = { ...payload };
  const requiredColumns = new Set(options.requiredColumns || []);
  let returningColumns = [...(options.returningColumns || [])];
  const requiredReturningColumns = new Set(options.requiredReturningColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).update(candidate);
    Object.entries(match || {}).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    if (returningColumns.length) query = query.select(returningColumns.join(','));
    else query = query.select();
    const { data, error } = await query.single();
    if (!error) return { data, error: null, payload: candidate };

    const missingColumn = extractMissingColumnName(error.message);
    if (missingColumn && returningColumns.includes(missingColumn) && !requiredReturningColumns.has(missingColumn)) {
      returningColumns = returningColumns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do retorno do update: ${missingColumn}`);
      continue;
    }

    if (!missingColumn || !(missingColumn in candidate) || requiredColumns.has(missingColumn)) {
      return { data: null, error, payload: candidate };
    }

    delete candidate[missingColumn];
    console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do update: ${missingColumn}`);
  }

  return { data: null, error: new Error(`Falha ao atualizar ${table} com fallback de schema.`), payload: candidate };
}

app.use(authRoutes);
app.use(onboardingRoutes);

app.get('/oauth/consent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'oauth-consent.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.use(planRoutes);
app.use(taskRoutes);
app.use(messageRoutes);
app.use(adminClientRoutes);

// ─── Multi-user companies ─────────────────────────────────────────────────────
// List members of a client company
app.get('/api/company/members', requireAuth, async (req, res) => {
  const companyId = req.user.company_id || req.user.id;
  const { data, error } = await selectWithColumnFallback('re_company_users', {
    columns: ['id', 'name', 'email', 'role', 'active', 'invited_at', 'last_login'],
    requiredColumns: ['id', 'email'],
    orderBy: ['created_at', 'invited_at', 'id'],
    apply: (query) => query.eq('company_id', companyId),
  });
  if (error) {
    if (isSchemaCompatibilityError(error.message, ['re_company_users', 'company_id', 'invited_at', 'last_login', 'role', 'active'])) {
      console.warn('[COMPANY MEMBERS] recurso multiusuário indisponível neste schema:', error.message);
      return res.json({ members: [] });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ members: (data || []).map((member) => ({
    ...member,
    name: member.name || member.email || 'Membro',
    role: member.role || 'visualizador',
    active: member.active !== false,
  })) });
});

// Invite / create a new member
app.post('/api/company/members', requireAuth, async (req, res) => {
  const companyId = req.user.company_id || req.user.id;
  // Only the owner (re_users row) may invite
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode convidar membros.' });
  const { name, email, role, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password são obrigatórios.' });
  const ROLES = ['financeiro','contador','operacional','visualizador'];
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Papel inválido.' });

  // Check uniqueness
  const { data: existing, error: existingError } = await sb.from('re_company_users')
    .select('id').eq('company_id', companyId).eq('email', email.toLowerCase()).single();
  if (existingError && !String(existingError.message || '').toLowerCase().includes('multiple') && !String(existingError.message || '').toLowerCase().includes('json object requested')) {
    if (isCompanyMembersSchemaError(existingError.message)) {
      console.warn('[COMPANY MEMBERS CREATE] recurso multiusuário indisponível neste schema:', existingError.message);
      return res.status(503).json({ error: 'Recurso de equipe indisponível neste ambiente no momento.' });
    }
    return res.status(500).json({ error: existingError.message });
  }
  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa.' });

  const hash = await bcrypt.hash(password, 10);
  const { data: member, error } = await insertWithColumnFallback('re_company_users', {
    company_id:    companyId,
    name:          name.trim(),
    email:         email.toLowerCase().trim(),
    role:          role || 'operacional',
    password_hash: hash,
  }, { requiredColumns: ['company_id', 'name', 'email', 'role', 'password_hash'] });

  if (error) {
    if (isCompanyMembersSchemaError(error.message)) {
      console.warn('[COMPANY MEMBERS CREATE] recurso multiusuário indisponível neste schema:', error.message);
      return res.status(503).json({ error: 'Recurso de equipe indisponível neste ambiente no momento.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true, member });
});

// Update member (role / active)
app.put('/api/company/members/:memberId', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode editar membros.' });
  const companyId = req.user.id;
  const { role, active, name } = req.body;
  const updates = {};
  if (role   !== undefined) updates.role   = role;
  if (active !== undefined) updates.active = active;
  if (name   !== undefined) updates.name   = name.trim();
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada para atualizar.' });

  const { data, error } = await sb.from('re_company_users')
    .update(updates)
    .eq('id', req.params.memberId)
    .eq('company_id', companyId)
    .select('id,name,email,role,active').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ success: true, member: data });
});

// Remove a member
app.delete('/api/company/members/:memberId', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode remover membros.' });
  const companyId = req.user.id;
  const { error } = await sb.from('re_company_users')
    .delete()
    .eq('id', req.params.memberId)
    .eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Reset member password
app.post('/api/company/members/:memberId/reset-password', requireAuth, async (req, res) => {
  if (req.user.company_id) return res.status(403).json({ error: 'Apenas o titular pode redefinir senhas.' });
  const companyId = req.user.id;
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' });
  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await sb.from('re_company_users')
    .update({ password_hash: hash })
    .eq('id', req.params.memberId)
    .eq('company_id', companyId)
    .select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Membro não encontrado.' });
  res.json({ success: true });
});

// ─── Auth: login for company members ─────────────────────────────────────────
// Member login — generates a JWT with company_id set (marks them as a sub-user)
app.post('/api/auth/member-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

  const { data: member, error } = await sb.from('re_company_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('active', true)
    .single();

  if (error || !member) return res.status(401).json({ error: 'Credenciais inválidas.' });
  const ok = await bcrypt.compare(password, member.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

  // Update last_login
  const lastLoginUpdate = await updateWithColumnFallback('re_company_users', { id: member.id }, {
    last_login: new Date().toISOString(),
  });
  if (lastLoginUpdate.error) {
    console.warn('[COMPANY MEMBER LOGIN] Não foi possível atualizar last_login:', lastLoginUpdate.error.message);
  }

  // Fetch owner (company) data for context
  const owner = await findUserById(member.company_id);

  const token = jwt.sign({
    id:         member.id,
    email:      member.email,
    name:       member.name,
    role:       member.role,
    company_id: member.company_id,   // ← marks this as a sub-user
    is_admin:   false,
  }, JWT_SECRET, { expiresIn: '12h' });

  res.json({
    token,
    user: {
      id:         member.id,
      name:       member.name,
      email:      member.email,
      role:       member.role,
      company_id: member.company_id,
      company:    owner?.company || owner?.name || '',
    },
  });
});

// ─── Admin: list members for a client ────────────────────────────────────────
app.get('/api/admin/client/:id/members', requireAdmin, async (req, res) => {
  const { data, error } = await selectWithColumnFallback('re_company_users', {
    columns: ['id', 'name', 'email', 'role', 'active', 'invited_at', 'last_login'],
    requiredColumns: ['id', 'email'],
    orderBy: ['created_at', 'invited_at', 'id'],
    apply: (query) => query.eq('company_id', req.params.id),
  });
  if (error) {
    if (isSchemaCompatibilityError(error.message, ['re_company_users', 'company_id', 'invited_at', 'last_login', 'role', 'active'])) {
      console.warn('[ADMIN COMPANY MEMBERS] recurso multiusuário indisponível neste schema:', error.message);
      return res.json({ members: [] });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ members: (data || []).map((member) => ({
    ...member,
    name: member.name || member.email || 'Membro',
    role: member.role || 'visualizador',
    active: member.active !== false,
  })) });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA + CRÉDITOS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Credit helpers ────────────────────────────────────────────────────────────
async function getCredits(userId) {
  const { data } = await sb.from('re_users').select('credits_balance').eq('id', userId).single();
  return data?.credits_balance ?? 0;
}

async function adjustCredits(userId, delta, reason, refId = null) {
  const current = await getCredits(userId);
  const newBal  = current + delta;
  await sb.from('re_users').update({ credits_balance: newBal }).eq('id', userId);
  await sb.from('re_credit_transactions').insert({
    user_id: userId, delta, reason, ref_id: refId, balance_after: newBal
  });
  return newBal;
}

// ── Client: view available slots + own balance ────────────────────────────────
app.get('/api/agenda/slots', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const from = req.query.from || new Date().toISOString();
  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings,location,meeting_link')
    .gte('starts_at', from)
    .order('starts_at', { ascending: true })
    .limit(60);

  // Count active bookings per slot (pending + confirmed only)
  const slotIds = (slots||[]).map(s => s.id);
  let bookingCounts = {};
  if (slotIds.length) {
    const { data: counts } = await sb.from('re_bookings')
      .select('slot_id').in('slot_id', slotIds)
      .in('status', ['pending', 'confirmed']);
    (counts||[]).forEach(b => { bookingCounts[b.slot_id] = (bookingCounts[b.slot_id]||0) + 1; });
  }

  // Client's own bookings — full detail for status display
  const { data: myBookings } = await sb.from('re_bookings')
    .select('id,slot_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,notes,created_at')
    .eq('user_id', userId)
    .in('slot_id', slotIds.length ? slotIds : ['00000000-0000-0000-0000-000000000000'])
    .neq('status', 'rescheduled'); // hide superseded bookings
  const myBookingMap = {};
  (myBookings||[]).forEach(b => { myBookingMap[b.slot_id] = b; });

  const credits = await getCredits(userId);

  const enriched = (slots||[]).map(s => ({
    ...s,
    booked_count: bookingCounts[s.id] || 0,
    available: (bookingCounts[s.id] || 0) < s.max_bookings,
    my_booking: !!myBookingMap[s.id],
    my_booking_detail: myBookingMap[s.id] || null,
  }));

  res.json({ slots: enriched, credits_balance: credits });
});

// ── Client: book a slot (spend credits) ──────────────────────────────────────
app.post('/api/agenda/book/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { slotId } = req.params;
  const { notes } = req.body;

  const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slotId).single();
  if (!slot) return res.status(404).json({ error: 'Slot não encontrado.' });
  if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Horário já passou.' });

  // Check capacity
  const { count } = await sb.from('re_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId).neq('status', 'cancelled');
  if ((count||0) >= slot.max_bookings) return res.status(400).json({ error: 'Horário lotado.' });

  // Check duplicate
  const { data: dup } = await sb.from('re_bookings')
    .select('id').eq('slot_id', slotId).eq('user_id', userId).neq('status', 'cancelled').single();
  if (dup) return res.status(409).json({ error: 'Você já tem reserva neste horário.' });

  // Check credits
  const credits = await getCredits(userId);
  if (credits < slot.credits_cost) return res.status(402).json({
    error: `Créditos insuficientes. Necessário: ${slot.credits_cost}, disponível: ${credits}.`,
    credits_needed: slot.credits_cost - credits
  });

  const { data: booking, error } = await sb.from('re_bookings').insert({
    slot_id: slotId, user_id: userId,
    status: 'pending', credits_spent: slot.credits_cost, notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Deduct credits immediately (refunded if consultant rejects)
  const newBal = await adjustCredits(userId, -slot.credits_cost, 'booking_pending', booking.id);

  // Emails
  const startsAtFmt = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const clientName = req.user.name || req.user.email;

  sendMail(req.user.email, 'Solicitação de agendamento recebida — Recupera Empresas', emailWrapper(
    'Solicitação de agendamento recebida',
    `<p>Olá, <b>${clientName}</b>!</p>
     <p>Sua solicitação foi recebida e está <b>aguardando confirmação</b> do consultor.</p>
     ${emailFactTable([
       emailFactRow('Sessão', slot.title || 'Consultoria'),
       emailFactRow('Data e hora', startsAtFmt),
       emailFactRow('Créditos reservados', slot.credits_cost),
     ].join(''))}
     <p ${emailStyle('factValue', 'font-size:13px;color:#F59E0B')}>⏳ Você receberá um e-mail assim que o consultor confirmar.</p>`
  )).catch(e => console.warn('[async]', e?.message));

  sendMail(EMAIL_TO, `[Novo Agendamento] ${clientName} — ${startsAtFmt}`, emailWrapper(
    'Nova solicitação de agendamento',
    `<p><b>${clientName}</b> (${req.user.company || '—'}) solicitou um agendamento.</p>
     <p><b>Sessão:</b> ${slot.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
      <p ${emailStyle('metaText', 'margin-top:0')}>Acesse o painel do consultor → Agenda para confirmar, remarcar ou cancelar.</p>`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, booking, credits_balance: newBal });
});

// ── Client: cancel a booking (refund credits) ────────────────────────────────
app.delete('/api/agenda/book/:bookingId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('id', req.params.bookingId).eq('user_id', userId).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (['cancelled','rescheduled'].includes(booking.status)) return res.status(400).json({ error: 'Reserva já cancelada.' });

  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at,title').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status: 'cancelled', cancelled_by: 'client',
    cancel_reason: reason || null, updated_at: new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  // Restore calendar slot
  const evId = _calendarEventIds.get(booking.slot_id);
  if (evId) {
    gcPatchEvent(evId, {
      summary: `[Disponível] ${slot?.title || 'Consultoria'} — Recupera Empresas`,
      attendees: [],
    }).catch(e => console.warn('[async]', e?.message));
  }

  // Notify admin
  const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  sendMail(EMAIL_TO, `[Cancelamento] ${req.user.name || req.user.email} — ${startsAtFmt}`, emailWrapper(
    'Agendamento cancelado pelo cliente',
    `<p><b>${req.user.name || req.user.email}</b> cancelou o agendamento.</p>
     <p><b>Sessão:</b> ${slot?.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
     ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, credits_balance: newBal });
});

// ── Client: credit history ────────────────────────────────────────────────────
app.get('/api/credits/history', requireAuth, async (req, res) => {
  const { data } = await sb.from('re_credit_transactions')
    .select('*').eq('user_id', req.user.id)
    .order('created_at', { ascending: false }).limit(50);
  const balance = await getCredits(req.user.id);
  res.json({ transactions: data || [], balance });
});

// ── Stripe: create checkout session to purchase credits ───────────────────────
app.post('/api/credits/checkout', requireAuth, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Pagamentos não configurados.' });

  const PACKS = {
    '1':  { credits: 1,  price_brl: 29700 },   // R$ 297
    '3':  { credits: 3,  price_brl: 79700 },   // R$ 797
    '5':  { credits: 5,  price_brl: 119700 },  // R$ 1.197
    '10': { credits: 10, price_brl: 197000 },  // R$ 1.970
  };
  const { pack = '1', success_url, cancel_url } = req.body;
  const chosen = PACKS[String(pack)];
  if (!chosen) return res.status(400).json({ error: 'Pacote inválido. Opções: 1, 3, 5, 10.' });

  const Stripe = require('stripe');
  const stripe = Stripe(STRIPE_SECRET_KEY);
  const user   = req.user;

  // Ensure Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name || user.email });
    customerId = customer.id;
    await sb.from('re_users').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer:    customerId,
    mode:        'payment',
    line_items:  [{
      price_data: {
        currency:     'brl',
        unit_amount:  chosen.price_brl,
        product_data: { name: `${chosen.credits} crédito${chosen.credits > 1 ? 's' : ''} de consultoria` },
      },
      quantity: 1,
    }],
    metadata: { user_id: user.id, credits: String(chosen.credits) },
    success_url: success_url || `${BASE_URL}/dashboard.html?credits=success`,
    cancel_url:  cancel_url  || `${BASE_URL}/dashboard.html?credits=cancel`,
  });

  res.json({ url: session.url, session_id: session.id });
});

// ── Stripe webhook: credit the account on payment ────────────────────────────
// Body is already raw Buffer via the global middleware at /api/stripe/webhook
app.post('/api/stripe/webhook', async (req, res) => {
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return res.sendStatus(400);
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[STRIPE WEBHOOK]', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { user_id, credits } = session.metadata || {};
      if (user_id && credits) {
        const delta = parseInt(credits, 10);
        await adjustCredits(user_id, delta, 'purchase', session.payment_intent);
        console.log(`[CREDITS] +${delta} créditos para user ${user_id}`);
      }
    }

    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      console.log(`[STRIPE] invoice.paid: ${inv.id} customer=${inv.customer} amount=${inv.amount_paid}`);
      if (inv.customer) {
        const { data: user } = await sb.from('re_users')
          .select('email,name,company').eq('stripe_customer_id', inv.customer).single();
        if (user) {
          sendMail(user.email, 'Pagamento confirmado — Recupera Empresas', emailWrapper(
            'Pagamento recebido',
            `<p>Olá, <b>${user.name || user.company || user.email}</b>!</p>
             <p>Confirmamos o recebimento do seu pagamento referente à fatura
                <b>${inv.number || inv.id}</b>
                no valor de <b>R$ ${(inv.amount_paid / 100).toFixed(2).replace('.', ',')}</b>.</p>
             <p>Obrigado pela confiança.</p>`
          )).catch(e => console.warn('[async]', e?.message));
        }
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      console.warn(`[STRIPE] invoice.payment_failed: ${inv.id} customer=${inv.customer}`);
      if (inv.customer && inv.hosted_invoice_url) {
        const { data: user } = await sb.from('re_users')
          .select('email,name,company').eq('stripe_customer_id', inv.customer).single();
        if (user) {
          sendMail(user.email, 'Falha no pagamento — Recupera Empresas', emailWrapper(
            'Falha no pagamento',
            `<p>Olá, <b>${user.name || user.company || user.email}</b>!</p>
             <p>Não foi possível processar o pagamento da fatura <b>${inv.number || inv.id}</b>.</p>
             <p><a href="${inv.hosted_invoice_url}" ${emailStyle('footerLink')}>Clique aqui para regularizar o pagamento.</a></p>`
          )).catch(e => console.warn('[async]', e?.message));
        }
      }
    }

    res.json({ received: true });
  }
);

// ── Admin: agenda slots management ───────────────────────────────────────────
app.get('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const includeBookings = !['0', 'false', 'no'].includes(String(req.query.include_bookings || '1').toLowerCase());
    const { data: slots, error: slotsError } = await selectWithColumnFallback('re_agenda_slots', {
      columns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_at'],
      requiredColumns: ['id', 'starts_at', 'ends_at'],
      orderBy: ['starts_at', 'created_at', 'id'],
      apply: (query) => query.gte('starts_at', from).limit(100),
    });
    if (slotsError) {
      if (isSchemaCompatibilityError(slotsError.message, ['re_agenda_slots', 'starts_at', 'ends_at', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description'])) {
        console.warn('[ADMIN AGENDA SLOTS] returning empty list due to schema mismatch:', slotsError.message);
        return res.json({ slots: [] });
      }
      return res.status(500).json({ error: slotsError.message });
    }

    if (!includeBookings) {
      return res.json({ slots: slots || [] });
    }

    const slotIds = (slots || []).map(s => s.id);
    let bookings = [];
    if (slotIds.length) {
      const { data, error } = await selectWithColumnFallback('re_bookings', {
        columns: ['id', 'slot_id', 'user_id', 'status', 'credits_spent', 'confirmed_at', 'cancel_reason', 'cancelled_by', 'reschedule_reason', 'rescheduled_to_slot_id', 'external_contact', 'notes', 'created_at', 're_users(id,name,email,company)'],
        requiredColumns: ['id', 'slot_id', 'status'],
        orderBy: ['created_at', 'id'],
        apply: (query) => query.in('slot_id', slotIds),
      });
      if (error) {
        console.warn('[ADMIN AGENDA BOOKINGS] returning slots without bookings:', error.message);
      } else {
        bookings = data || [];
      }
    }
    const bySlot = {};
    bookings.forEach(b => { (bySlot[b.slot_id] = bySlot[b.slot_id] || []).push(b); });

    res.json({ slots: (slots || []).map(s => ({ ...s, bookings: bySlot[s.id] || [] })) });
  } catch (e) {
    console.error('[ADMIN AGENDA SLOTS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  try {
    const { starts_at, ends_at, title, credits_cost, max_bookings, duration_min, location, meeting_link, description } = req.body;
    if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at e ends_at são obrigatórios.' });
    const slotAttempts = [
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1, duration_min: duration_min || 60,
          location: location || 'online', meeting_link: meeting_link || null, description: description || null,
          created_by: req.user.id,
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1, duration_min: duration_min || 60,
          location: location || 'online',
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: {
          starts_at, ends_at, title: title || 'Consultoria',
          credits_cost: credits_cost || 1, max_bookings: max_bookings || 1,
        },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: { starts_at, ends_at, title: title || 'Consultoria' },
        requiredColumns: ['starts_at', 'ends_at'],
      },
      {
        payload: { starts_at, ends_at },
        requiredColumns: ['starts_at', 'ends_at'],
      },
    ];
    let slotInsert = null;
    for (const attempt of slotAttempts) {
      slotInsert = await insertWithColumnFallback('re_agenda_slots', attempt.payload, {
        requiredColumns: attempt.requiredColumns,
        returningColumns: ['id', 'starts_at', 'ends_at', 'title', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_at'],
        requiredReturningColumns: ['id', 'starts_at', 'ends_at'],
      });
      if (!slotInsert.error) break;
    }
    const { data, error } = slotInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_agenda_slots', 'starts_at', 'ends_at', 'credits_cost', 'max_bookings', 'duration_min', 'location', 'meeting_link', 'description', 'created_by'])) {
        return res.status(503).json({
          error: 'Agenda temporariamente indisponível até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/agenda/slots', error, slotAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    gcCreateEvent({
      summary: `[Disponível] ${title || 'Consultoria'} — Recupera Empresas`,
      description: `Slot disponível para reserva.\nVagas: ${max_bookings || 1}  |  Créditos: ${credits_cost || 1}${meeting_link ? '\nLink: ' + meeting_link : ''}`,
      start: starts_at, end: ends_at,
    }).then(evId => { if (evId) _calendarEventIds.set(data.id, evId); }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, slot: data });
  } catch (e) {
    console.error('[ADMIN AGENDA CREATE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/agenda/slots/:slotId', requireAdmin, async (req, res) => {
  const { slotId } = req.params;
  await sb.from('re_agenda_slots').delete().eq('id', slotId);
  const evId = _calendarEventIds.get(slotId);
  if (evId) { gcDeleteEvent(evId).catch(e => console.warn('[async]', e?.message)); _calendarEventIds.delete(slotId); }
  res.json({ success: true });
});

// ── Admin: confirm a booking ──────────────────────────────────────────────────
app.put('/api/admin/agenda/bookings/:bookingId/confirm', requireAdmin, async (req, res) => {
  try {
    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,ends_at,title,location,meeting_link),re_users(name,email,company)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Já confirmada.' });
    if (booking.status === 'cancelled')  return res.status(400).json({ error: 'Reserva cancelada.' });

    await sb.from('re_bookings').update({
      status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const slot  = booking.re_agenda_slots;
    const user  = booking.re_users || {};
    const email = user.email || booking.external_contact?.email;
    const name  = user.name  || booking.external_contact?.name || email;
    const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      const linkLine = slot?.meeting_link ? emailFactRow('Link da reunião', `<a href="${slot.meeting_link}">${slot.meeting_link}</a>`) : '';
      sendMail(email, '✅ Agendamento confirmado — Recupera Empresas', emailWrapper(
        'Agendamento confirmado!',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi <b>confirmado</b> pelo consultor.</p>
         ${emailFactTable([
           emailFactRow('Sessão', slot?.title||'Consultoria'),
           emailFactRow('Data e hora', startsAtFmt),
           emailFactRow('Modalidade', slot?.location==='presencial'?'Presencial':'Online'),
           linkLine,
         ].filter(Boolean).join(''))}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes da sessão.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Add to Google Calendar
    const evId = _calendarEventIds.get(slot?.id);
    if (evId && email) {
      gcPatchEvent(evId, {
        summary: `${slot?.title||'Consultoria'} — ${user.company||name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: cancel a booking (with reason) ────────────────────────────────────
app.put('/api/admin/agenda/bookings/:bookingId/cancel', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,title),re_users(name,email)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Já cancelada.' });

    await sb.from('re_bookings').update({
      status: 'cancelled', cancelled_by: 'admin',
      cancel_reason: reason || null, updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    // Refund credits if user exists
    if (booking.user_id && booking.credits_spent) {
      await adjustCredits(booking.user_id, booking.credits_spent, 'refund_admin_cancel', booking.id)
        .catch(e => console.warn('[async credits refund]', e?.message));
    }

    const slot  = booking.re_agenda_slots;
    const user  = booking.re_users || {};
    const email = user.email || booking.external_contact?.email;
    const name  = user.name  || booking.external_contact?.name || email;
    const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      sendMail(email, '❌ Agendamento cancelado — Recupera Empresas', emailWrapper(
        'Agendamento cancelado',
        `<p>Olá, <b>${name}</b>!</p>
         <p>Seu agendamento foi <b>cancelado</b> pelo consultor.</p>
         <p><b>Sessão:</b> ${slot?.title||'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
         ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
         ${booking.credits_spent ? `<p ${emailStyle('factValue', 'color:#10B981')}>Seus créditos foram devolvidos.</p>` : ''}
         <p ${emailStyle('metaText', 'margin-top:0')}>Entre em contato para reagendar.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Restore Google Calendar slot
    const evId = _calendarEventIds.get(slot?.id);
    if (evId) {
      gcPatchEvent(evId, {
        summary: `[Disponível] ${slot?.title||'Consultoria'} — Recupera Empresas`, attendees: [],
      }).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: reschedule a booking to a new slot ─────────────────────────────────
app.put('/api/admin/agenda/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
  try {
    const { new_slot_id, reason } = req.body;
    if (!new_slot_id) return res.status(400).json({ error: 'new_slot_id é obrigatório.' });

    const { data: booking } = await sb.from('re_bookings')
      .select('*,re_agenda_slots(id,starts_at,title),re_users(name,email,company)')
      .eq('id', req.params.bookingId).single();
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (['cancelled','rescheduled'].includes(booking.status)) return res.status(400).json({ error: 'Reserva não pode ser remarcada.' });

    // Validate new slot capacity
    const { data: newSlot } = await sb.from('re_agenda_slots').select('*').eq('id', new_slot_id).single();
    if (!newSlot) return res.status(404).json({ error: 'Novo horário não encontrado.' });
    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', new_slot_id).in('status', ['pending','confirmed']);
    if ((count||0) >= newSlot.max_bookings) return res.status(400).json({ error: 'Novo horário lotado.' });

    // Create new confirmed booking
    const { data: newBooking } = await sb.from('re_bookings').insert({
      slot_id: new_slot_id, user_id: booking.user_id,
      external_contact: booking.external_contact || null,
      status: 'confirmed', confirmed_at: new Date().toISOString(),
      credits_spent: booking.credits_spent, notes: booking.notes || null,
    }).select().single();

    // Mark original as rescheduled
    await sb.from('re_bookings').update({
      status: 'rescheduled', reschedule_reason: reason || null,
      rescheduled_to_slot_id: new_slot_id, updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const oldSlot = booking.re_agenda_slots;
    const user    = booking.re_users || {};
    const email   = user.email || booking.external_contact?.email;
    const name    = user.name  || booking.external_contact?.name || email;
    const oldFmt  = new Date(oldSlot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const newFmt  = new Date(newSlot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (email) {
      const linkLine = newSlot.meeting_link ? emailFactRow('Link', `<a href="${newSlot.meeting_link}">${newSlot.meeting_link}</a>`, 'font-weight:400') : '';
      sendMail(email, '📅 Agendamento remarcado — Recupera Empresas', emailWrapper(
        'Agendamento remarcado',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi <b>remarcado</b>.</p>
         ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
         ${emailFactTable([
           emailFactRow('Data anterior', oldFmt, 'text-decoration:line-through;color:#94A3B8'),
           emailFactRow('Nova data', newFmt, 'font-weight:700;color:#10B981'),
           emailFactRow('Sessão', newSlot.title||'Consultoria'),
           linkLine,
         ].filter(Boolean).join(''))}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes da nova sessão.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    res.json({ success: true, new_booking: newBooking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: book a slot for an existing client or external contact ──────────────
app.post('/api/admin/agenda/book-for-client', requireAdmin, async (req, res) => {
  try {
    const { slot_id, user_id, external_contact, notes } = req.body;
    if (!slot_id) return res.status(400).json({ error: 'slot_id é obrigatório.' });
    if (!user_id && !external_contact?.name) return res.status(400).json({ error: 'Informe user_id ou external_contact.name.' });

    const { data: slot } = await sb.from('re_agenda_slots').select('*').eq('id', slot_id).single();
    if (!slot) return res.status(404).json({ error: 'Horário não encontrado.' });
    if (new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Horário já passou.' });

    const { count } = await sb.from('re_bookings')
      .select('id', { count: 'exact', head: true }).eq('slot_id', slot_id).in('status', ['pending','confirmed']);
    if ((count||0) >= slot.max_bookings) return res.status(400).json({ error: 'Horário lotado.' });

    // Get user info for email
    let userInfo = null;
    if (user_id) {
      const { data: u } = await sb.from('re_users').select('id,name,email,company').eq('id', user_id).single();
      userInfo = u;
    }

    const { data: booking, error } = await sb.from('re_bookings').insert({
      slot_id, user_id: user_id || null,
      external_contact: !user_id ? external_contact : null,
      status: 'confirmed', confirmed_at: new Date().toISOString(),
      credits_spent: 0, notes: notes || null, // admin bookings don't spend credits
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const name  = userInfo?.name  || external_contact?.name  || 'Cliente';
    const email = userInfo?.email || external_contact?.email;
    const startsAtFmt = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const linkLine = slot.meeting_link ? `<p><b>Link:</b> <a href="${slot.meeting_link}">${slot.meeting_link}</a></p>` : '';

    if (email) {
      sendMail(email, '✅ Agendamento confirmado — Recupera Empresas', emailWrapper(
        'Agendamento confirmado',
        `<p>Olá, <b>${name}</b>! Seu agendamento foi confirmado.</p>
         <p><b>Sessão:</b> ${slot.title||'Consultoria'}<br><b>Data:</b> ${startsAtFmt}<br><b>Modalidade:</b> ${slot.location==='presencial'?'Presencial':'Online'}</p>
         ${linkLine}
         <p ${emailStyle('metaText', 'margin-top:0')}>Você receberá um lembrete 24h antes.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }

    // Calendar
    const evId = _calendarEventIds.get(slot_id);
    if (evId && email) {
      gcPatchEvent(evId, {
        summary: `${slot.title||'Consultoria'} — ${name}`,
        attendees: [{ email, displayName: name }],
      }).catch(e => console.warn('[async]', e?.message));
    }

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'booking', entityId: booking.id, action: 'admin_book',
      after: { slot_id, user_id, name, startsAtFmt } }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, booking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Client: cancel booking by slot id (convenience — finds booking then delegates)
app.delete('/api/agenda/cancel-slot/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reason } = req.body || {};
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('slot_id', req.params.slotId).eq('user_id', userId)
    .in('status', ['pending','confirmed']).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at,title').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({
    status: 'cancelled', cancelled_by: 'client',
    cancel_reason: reason || null, updated_at: new Date().toISOString(),
  }).eq('id', booking.id);

  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund_client_cancel', booking.id);

  const startsAtFmt = new Date(slot?.starts_at || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  sendMail(EMAIL_TO, `[Cancelamento] ${req.user.name || req.user.email} — ${startsAtFmt}`, emailWrapper(
    'Agendamento cancelado pelo cliente',
    `<p><b>${req.user.name || req.user.email}</b> cancelou o agendamento.</p>
     <p><b>Sessão:</b> ${slot?.title || 'Consultoria'}<br><b>Data:</b> ${startsAtFmt}</p>
     ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}`
  )).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, credits_balance: newBal });
});

// Admin: adjust credits manually
app.post('/api/admin/client/:id/credits', requireAdmin, async (req, res) => {
  const { delta, reason } = req.body;
  if (!delta || !reason) return res.status(400).json({ error: 'delta e reason obrigatórios.' });
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const newBal = await adjustCredits(user.id, parseInt(delta), reason, `admin:${req.user.id}`);
  res.json({ success: true, credits_balance: newBal });
});

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  const { data: logs } = await sb.from('re_access_log')
    .select('*').order('ts', { ascending: false }).limit(500);
  res.json({ logs: (logs || []).map(l => ({
    ts: l.ts, email: l.email, event: l.event, ip: l.ip, step: l.step
  })) });
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const { data: users } = await sb.from('re_users').select('id').eq('is_admin', false);
  const ids = (users || []).map(u => u.id);
  const { data: obs } = await sb.from('re_onboarding')
    .select('status').in('user_id', ids);

  const stats = { total: ids.length, naoIniciado: 0, emAndamento: 0, concluido: 0 };
  (obs || []).forEach(o => {
    if (o.status === 'concluido') stats.concluido++;
    else if (o.status === 'em_andamento') stats.emAndamento++;
    else stats.naoIniciado++;
  });
  // Users with no onboarding row → nao_iniciado
  stats.naoIniciado += ids.length - (obs || []).length;
  res.json(stats);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRESHCHAT / SUPPORT / APPOINTMENTS / FINANCIAL
// ═══════════════════════════════════════════════════════════════════════════════

// Freshchat JWT for identity verification
app.get('/api/freshchat-token', requireAuth, (req, res) => {
  const name = req.user.name || req.user.full_name || '';
  const [firstName, ...rest] = name.split(' ');
  const token = jwt.sign({
    sub:        req.user.email,
    first_name: firstName || '',
    last_name:  rest.join(' ') || '',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }, FRESHCHAT_JWT_SECRET, { algorithm: 'HS256' });
  res.json({ token });
});

// Support: list tickets for current user
app.get('/api/support/tickets', requireAuth, async (req, res) => {
  const result = await freshdeskRequest('GET',
    `tickets?email=${encodeURIComponent(req.user.email)}&include=stats&per_page=30`, null);
  const tickets = (result.ok && Array.isArray(result.data)) ? result.data : [];
  res.json({ tickets });
});

// Support: open a new ticket
app.post('/api/support/ticket', requireAuth, async (req, res) => {
  const { subject, description } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'Assunto obrigatório.' });
  const result = await freshdeskRequest('POST', 'tickets', {
    subject: subject.trim(),
    description: (description || subject).trim(),
    email: req.user.email, name: req.user.name || req.user.email,
    priority: 2, status: 2, tags: ['portal']
  });
  if (result.ok) res.json({ success: true, ticket: result.data });
  else res.status(503).json({ error: 'Suporte temporariamente indisponível. Tente novamente mais tarde.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════════

const DOC_TYPES = {
  dre:             'DRE (Demonstrativo de Resultado)',
  balanco:         'Balanço Patrimonial',
  fluxo_caixa:     'Fluxo de Caixa',
  contrato_social: 'Contrato Social',
  procuracao:      'Procuração',
  certidao:        'Certidão (CNPJ/Dívida)',
  extrato:         'Extrato Bancário',
  nota_fiscal:     'Nota Fiscal',
  outros:          'Outros',
};

const DOC_STATUS = {
  pendente:           { label: 'Pendente',           cls: 'badge-gray'   },
  em_analise:         { label: 'Em análise',         cls: 'badge-blue'   },
  aprovado:           { label: 'Aprovado',           cls: 'badge-green'  },
  reprovado:          { label: 'Reprovado',          cls: 'badge-red'    },
  ajuste_solicitado:  { label: 'Ajuste solicitado',  cls: 'badge-amber'  },
};

async function readDocuments(userId) {
  const { data } = await sb.from('re_documents')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return (data || []).map(d => ({
    id: d.id, userId: d.user_id, name: d.name, originalName: d.original_name,
    filePath: d.file_path, fileSize: d.file_size, mimeType: d.mime_type,
    docType: d.doc_type, status: d.status, comments: d.comments || [],
    createdAt: d.created_at, updatedAt: d.updated_at,
  }));
}

// Client: list own documents
app.get('/api/documents', requireAuth, async (req, res) => {
  const docs = await readDocuments(req.user.id);
  res.json({ documents: docs, docTypes: DOC_TYPES, docStatus: DOC_STATUS });
});

// Client: upload a document
const docUpload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (/^(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar)$/.test(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido.'));
  },
});

app.post('/api/documents/upload', requireAuth, docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const { docType = 'outros', name } = req.body;

  const docName = (name || req.file.originalname).trim().slice(0, 120);
  const { data: doc } = await sb.from('re_documents').insert({
    user_id:       req.user.id,
    name:          docName,
    original_name: req.file.originalname,
    file_path:     req.file.filename,
    file_size:     req.file.size,
    mime_type:     req.file.mimetype,
    doc_type:      docType,
    status:        'pendente',
    comments:      [],
  }).select().single();

  res.json({ success: true, document: doc });
});

// Serve document file (auth-gated — accepts ?token= for direct download links)
app.get('/api/documents/:docId/file', async (req, res, next) => {
  // Allow token via query param so browser <a href> downloads work
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  requireAuth(req, res, next);
}, async (req, res) => {
  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  // Only owner or admin can download
  if (doc.user_id !== req.user.id && !req.user.is_admin &&
      !ADMIN_EMAILS.includes((req.user.email||'').toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const filePath = path.join(UPLOADS_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });

  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

// Client: delete own document (only if pendente or ajuste_solicitado)
app.delete('/api/documents/:docId', requireAuth, async (req, res) => {
  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).eq('user_id', req.user.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (!['pendente','ajuste_solicitado'].includes(doc.status))
    return res.status(400).json({ error: 'Não é possível excluir um documento em análise ou aprovado.' });

  // Remove physical file
  const fp = path.join(UPLOADS_DIR, doc.file_path);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  await sb.from('re_documents').delete().eq('id', req.params.docId);
  res.json({ success: true });
});

// Admin: list all client documents
app.get('/api/admin/client/:id/documents', requireAdmin, async (req, res) => {
  const docs = await readDocuments(req.params.id);
  res.json({ documents: docs, docTypes: DOC_TYPES, docStatus: DOC_STATUS });
});

// Admin: update document status + optional comment
app.put('/api/admin/client/:id/documents/:docId', requireAdmin, async (req, res) => {
  const { status, comment } = req.body;
  if (!DOC_STATUS[status]) return res.status(400).json({ error: 'Status inválido.' });

  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).eq('user_id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  const comments = Array.isArray(doc.comments) ? [...doc.comments] : [];
  if (comment?.trim()) {
    comments.push({ from: 'admin', name: req.user.name || req.user.email, text: comment.trim(), ts: new Date().toISOString() });
  }

  await sb.from('re_documents')
    .update({ status, comments, updated_at: new Date().toISOString() })
    .eq('id', req.params.docId);

  res.json({ success: true });
});

// Appointments: list
app.get('/api/admin/appointments', requireAdmin, async (req, res) => {
  const { data: appts } = await sb.from('re_appointments')
    .select('*, re_users(name, email, company)')
    .order('date');

  const appointments = (appts || []).map(a => ({
    ...a,
    clientName:  a.re_users?.name  || '',
    clientEmail: a.re_users?.email || '',
    userId:      a.user_id,
  }));
  res.json({ appointments });
});

// Admin: update appointment status
app.put('/api/admin/appointments/:userId/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  const updates = {};
  if (status !== undefined) updates.status = status;
  if (notes  !== undefined) updates.notes  = notes;
  await sb.from('re_appointments').update(updates).eq('id', req.params.id);
  res.json({ success: true });
});

// Financial: invoices (Stripe real)
app.get('/api/financial/invoices', requireAuth, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ invoices: [], stripeConfigured: false });
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);
    const user   = req.user;

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId  = found.data[0]?.id || null;
      if (customerId) await sb.from('re_users').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }
    if (!customerId) return res.json({ invoices: [], stripeConfigured: true });

    const [invList, piList] = await Promise.all([
      stripe.invoices.list({ customer: customerId, limit: 50 }),
      stripe.paymentIntents.list({ customer: customerId, limit: 50 }),
    ]);

    const invoices = invList.data.map(inv => ({
      id: inv.id, type: 'invoice',
      amount: (inv.amount_due / 100).toFixed(2),
      amountPaid: (inv.amount_paid / 100).toFixed(2),
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      date: new Date(inv.created * 1000).toISOString(),
      dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      pdfUrl:    inv.invoice_pdf        || null,
      hostedUrl: inv.hosted_invoice_url || null,
      description: inv.description || inv.lines?.data?.[0]?.description || 'Fatura',
    }));

    // Inclui pagamentos de créditos que não geram invoice formal
    const payments = piList.data
      .filter(p => p.status === 'succeeded' && !invoices.find(i => i.id === p.invoice))
      .map(p => ({
        id: p.id, type: 'payment',
        amount: (p.amount / 100).toFixed(2), amountPaid: (p.amount / 100).toFixed(2),
        currency: p.currency.toUpperCase(), status: 'paid',
        date: new Date(p.created * 1000).toISOString(),
        description: p.description || 'Pagamento',
      }));

    const all = [...invoices, ...payments].sort((a, b) => b.date.localeCompare(a.date));
    res.json({ invoices: all, stripeConfigured: true });
  } catch (e) {
    console.error('[FINANCIAL]', e.message);
    res.json({ invoices: [], stripeConfigured: true, error: e.message });
  }
});

// Financial: request 2nd copy
app.post('/api/financial/request-invoice', requireAuth, async (req, res) => {
  const { description } = req.body;
  await Promise.all([
    freshdeskRequest('POST', 'tickets', {
      subject: `2ª via boleto — ${req.user.company || req.user.name || req.user.email}`,
      description: `<p>Solicitação de 2ª via.</p>
        <p><b>Cliente:</b> ${req.user.name || ''}<br/><b>E-mail:</b> ${req.user.email}<br/>
        <b>Empresa:</b> ${req.user.company || '—'}</p>
        ${description ? `<p><b>Detalhe:</b> ${description}</p>` : ''}`,
      email: req.user.email, name: req.user.name || req.user.email,
      priority: 2, status: 2, tags: ['financeiro', '2a-via']
    }),
    sendMail(EMAIL_TO, `Solicitação 2ª via — ${req.user.company || req.user.name || req.user.email}`,
      emailWrapper('Solicitação de fatura', `
        <p>Cliente <b>${req.user.name || ''}</b> (${req.user.email}) solicita 2ª via do boleto.</p>
        ${description ? `<p><b>Detalhe:</b> ${description}</p>` : ''}
      `)
    )
  ]).catch(e => console.warn('[async]', e?.message));
  res.json({ success: true, message: 'Solicitação enviada. Nossa equipe entrará em contato.' });
});

// ─── Mensagens: polling em tempo real ────────────────────────────────────────
// Cliente: busca mensagens novas desde 'since' (ISO timestamp)
app.get('/api/messages/poll', requireAuth, async (req, res) => {
  const since = req.query.since || new Date(0).toISOString();
  const { data } = await sb.from('re_messages')
    .select('*').eq('user_id', req.user.id)
    .gt('ts', since).order('ts');
  res.json({ messages: data || [] });
});

// Admin: conta mensagens de clientes não lidas por agente
app.get('/api/admin/messages/unread', requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const seen    = _adminMsgSeen.get(adminId) || {};

  const { data: msgs } = await sb.from('re_messages')
    .select('user_id, ts, from_role')
    .eq('from_role', 'client')
    .order('ts', { ascending: false });

  const unread = {};
  (msgs || []).forEach(m => {
    const lastSeen = seen[m.user_id] || '1970-01-01T00:00:00.000Z';
    if (m.ts > lastSeen) unread[m.user_id] = (unread[m.user_id] || 0) + 1;
  });
  res.json({ unread });
});

// Admin: marca mensagens de um cliente como vistas
app.post('/api/admin/messages/seen/:clientId', requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  if (!_adminMsgSeen.has(adminId)) _adminMsgSeen.set(adminId, {});
  _adminMsgSeen.get(adminId)[req.params.clientId] = new Date().toISOString();
  res.json({ success: true });
});

// Admin: polling de mensagens de um cliente específico
app.get('/api/admin/client/:id/messages/poll', requireAdmin, async (req, res) => {
  const since = req.query.since || new Date(0).toISOString();
  const { data } = await sb.from('re_messages')
    .select('*').eq('user_id', req.params.id)
    .gt('ts', since).order('ts');
  res.json({ messages: data || [] });
});

// ─── Admin: visão financeira consolidada (Stripe) ────────────────────────────
app.get('/api/admin/financial', requireAdmin, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ configured: false, clients: [], totalRevenue: 0 });
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);

    const { data: users } = await sb.from('re_users')
      .select('id, name, email, company, stripe_customer_id')
      .eq('is_admin', false);

    const results = await Promise.all((users || []).map(async u => {
      try {
        if (!u.stripe_customer_id) return { userId: u.id, name: u.name, email: u.email, company: u.company, totalPaid: 0, paymentsCount: 0, lastPaymentDate: null };
        const piList = await stripe.paymentIntents.list({ customer: u.stripe_customer_id, limit: 20 });
        const paid   = piList.data.filter(p => p.status === 'succeeded');
        return {
          userId: u.id, name: u.name, email: u.email, company: u.company,
          customerId: u.stripe_customer_id,
          totalPaid:      paid.reduce((s, p) => s + p.amount, 0) / 100,
          paymentsCount:  paid.length,
          lastPaymentDate: paid[0] ? new Date(paid[0].created * 1000).toISOString() : null,
        };
      } catch { return { userId: u.id, name: u.name, email: u.email, company: u.company, totalPaid: 0, paymentsCount: 0, lastPaymentDate: null }; }
    }));

    const totalRevenue = results.reduce((s, c) => s + (c.totalPaid || 0), 0);
    res.json({ configured: true, clients: results, totalRevenue });
  } catch (e) {
    console.error('[ADMIN FINANCIAL]', e.message);
    res.json({ configured: false, clients: [], totalRevenue: 0, error: e.message });
  }
});

// Admin: invoices de um cliente específico
app.get('/api/admin/client/:id/financial', requireAdmin, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ invoices: [], configured: false });
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);
    const { data: user } = await sb.from('re_users').select('stripe_customer_id, email').eq('id', req.params.id).single();
    if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId  = found.data[0]?.id || null;
    }
    if (!customerId) return res.json({ invoices: [], configured: true });

    const piList = await stripe.paymentIntents.list({ customer: customerId, limit: 30 });
    const invoices = piList.data.map(p => ({
      id: p.id, amount: (p.amount / 100).toFixed(2),
      currency: p.currency.toUpperCase(), status: p.status,
      date: new Date(p.created * 1000).toISOString(),
      description: p.description || 'Pagamento',
    }));
    res.json({ invoices, configured: true });
  } catch (e) { res.json({ invoices: [], configured: true, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORM BUILDER — configuração dinâmica do formulário de onboarding
// ═══════════════════════════════════════════════════════════════════════════════

const FORM_CONFIG_PATH = path.join(__dirname, 'form-config.json');

const FORM_CONFIG_DEFAULTS = {
  steps: [
    { id:1,  title:'Consentimento LGPD',       description:'', enabled:true,  required:true  },
    { id:2,  title:'Dados da Empresa',          description:'', enabled:true,  required:true  },
    { id:3,  title:'Sócios',                   description:'', enabled:true,  required:true  },
    { id:4,  title:'Estrutura Operacional',     description:'', enabled:true,  required:false },
    { id:5,  title:'Quadro de Funcionários',    description:'', enabled:true,  required:false },
    { id:6,  title:'Ativos',                   description:'', enabled:true,  required:false },
    { id:7,  title:'Dados Financeiros',         description:'', enabled:true,  required:true  },
    { id:8,  title:'Dívidas e Credores',        description:'', enabled:true,  required:true  },
    { id:9,  title:'Histórico da Crise',        description:'', enabled:true,  required:false },
    { id:10, title:'Diagnóstico Estratégico',   description:'', enabled:true,  required:false },
    { id:11, title:'Mercado e Operação',        description:'', enabled:true,  required:false },
    { id:12, title:'Expectativas e Estratégia', description:'', enabled:true,  required:false },
    { id:13, title:'Documentos',               description:'', enabled:true,  required:false },
    { id:14, title:'Confirmação e Envio',       description:'', enabled:true,  required:true  },
  ],
  welcomeMessage: 'Preencha as informações da sua empresa para que possamos elaborar o Business Plan de recuperação.',
  lastUpdated: null,
};

function readFormConfig() {
  try {
    if (fs.existsSync(FORM_CONFIG_PATH)) {
      const raw = fs.readFileSync(FORM_CONFIG_PATH, 'utf8');
      const cfg = JSON.parse(raw);
      // Merge: keep defaults for any step missing in saved config
      const savedIds = new Set((cfg.steps||[]).map(s => s.id));
      const merged = FORM_CONFIG_DEFAULTS.steps.map(def => {
        const saved = (cfg.steps||[]).find(s => s.id === def.id);
        return saved ? { ...def, ...saved } : def;
      });
      return { ...FORM_CONFIG_DEFAULTS, ...cfg, steps: merged };
    }
  } catch (e) { console.warn('[FORM-CONFIG] read error:', e.message); }
  return { ...FORM_CONFIG_DEFAULTS, steps: FORM_CONFIG_DEFAULTS.steps.map(s => ({ ...s })) };
}

function writeFormConfig(cfg) {
  try { fs.writeFileSync(FORM_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) {
    console.error('[FORM-CONFIG] write error:', e.message);
    throw e;
  }
}

// Authenticated clients: read enabled steps only
app.get('/api/form-config', requireAuth, (req, res) => {
  const cfg = readFormConfig();
  res.json({
    steps: cfg.steps.filter(s => s.enabled),
    welcomeMessage: cfg.welcomeMessage || '',
  });
});

// Admin: full config
app.get('/api/admin/form-config', requireAdmin, (req, res) => {
  res.json(readFormConfig());
});

// Admin: save config
app.put('/api/admin/form-config', requireAdmin, (req, res) => {
  try {
    const current = readFormConfig();
    const { steps, welcomeMessage } = req.body;
    // Validate and sanitise steps
    const merged = (FORM_CONFIG_DEFAULTS.steps).map(def => {
      const incoming = (steps||[]).find(s => s.id === def.id);
      if (!incoming) return current.steps.find(s => s.id === def.id) || def;
      return {
        id:          def.id,
        title:       (typeof incoming.title === 'string' ? incoming.title.trim() : '') || def.title,
        description: typeof incoming.description === 'string' ? incoming.description.trim() : '',
        enabled:     !!incoming.enabled,
        required:    !!incoming.required,
      };
    });
    // Steps 1 and 14 are always enabled & required (LGPD + confirmação)
    merged[0]  = { ...merged[0],  enabled: true, required: true };
    merged[13] = { ...merged[13], enabled: true, required: true };

    const updated = {
      ...current,
      steps: merged,
      welcomeMessage: typeof welcomeMessage === 'string' ? welcomeMessage.trim() : current.welcomeMessage,
      lastUpdated: new Date().toISOString(),
    };
    writeFormConfig(updated);
    res.json({ success: true, config: updated });
  } catch (e) {
    console.error('[FORM-CONFIG PUT]', e.message);
    res.status(500).json({ error: 'Erro ao salvar configuração.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FORM BUILDER — Full API
// ══════════════════════════════════════════════════════════════════════════════

// ── Helper: load full form (pages + questions + logic) ────────────────────────
async function loadFullForm(formId) {
  const { data: form }  = await sb.from('re_forms').select('*').eq('id', formId).single();
  if (!form) return null;
  const { data: pages } = await sb.from('re_form_pages')
    .select('*').eq('form_id', formId).order('order_index');
  const { data: qs }    = await sb.from('re_form_questions')
    .select('*').eq('form_id', formId).order('order_index');
  const { data: logic } = await sb.from('re_form_logic')
    .select('*').eq('form_id', formId);

  // Nest questions into their pages (makes it easy for front-end consumers)
  const allPages = (pages || []).map(p => ({
    ...p,
    questions: (qs || []).filter(q => q.page_id === p.id).sort((a,b) => a.order_index - b.order_index),
  }));

  return { ...form, pages: allPages, logic: logic || [] };
}

// ── Admin: List forms ─────────────────────────────────────────────────────────
app.get('/api/admin/forms', requireAdmin, async (req, res) => {
  try {
    const { type, status } = req.query;
    const { data: forms, error } = await selectWithColumnFallback('re_forms', {
      columns: ['id', 'title', 'description', 'type', 'status', 'settings', 'linked_plan_chapter', 'created_by', 'created_at', 'updated_at'],
      requiredColumns: ['id', 'title'],
      orderBy: ['created_at', 'id'],
      apply: (query) => {
        let next = query;
        if (type) next = next.eq('type', type);
        if (status) next = next.eq('status', status);
        return next;
      },
    });
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_forms', 'title', 'description', 'type', 'status', 'settings', 'linked_plan_chapter', 'created_by'])) {
        console.warn('[FORMS LIST] returning empty list due to schema mismatch:', error.message);
        return res.json({ forms: [] });
      }
      throw error;
    }
    // Attach response counts
    const ids = (forms || []).map(f => f.id);
    let counts = {};
    if (ids.length) {
      const { data: resp, error: respError } = await sb.from('re_form_responses')
        .select('form_id').in('form_id', ids).eq('status', 'completed');
      if (respError) {
        console.warn('[FORMS LIST] response counts unavailable:', respError.message);
      } else {
        (resp || []).forEach(r => { counts[r.form_id] = (counts[r.form_id] || 0) + 1; });
      }
    }
    res.json({ forms: (forms || []).map(f => ({ ...f, response_count: counts[f.id] || 0 })) });
  } catch (e) { console.error('[FORMS LIST]', e.message); res.json({ forms: [] }); }
});

// ── Admin: Create form ────────────────────────────────────────────────────────
app.post('/api/admin/forms', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, settings, linked_plan_chapter } = req.body;
    if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });
    const basePayload = {
      title,
      description: description || null,
      type: type || 'custom',
      settings: settings || { scoring_enabled: false, show_progress: true, allow_resume: true },
      linked_plan_chapter: linked_plan_chapter || null,
      created_by: req.user.id,
      status: 'draft',
    };
    const formReturningColumns = ['id', 'title', 'description', 'type', 'settings', 'linked_plan_chapter', 'created_by', 'status', 'created_at', 'updated_at'];
    const formAttempts = [
      {
        payload: basePayload,
        requiredColumns: ['title'],
      },
      {
        payload: { ...basePayload, type: 'custom', created_by: null, linked_plan_chapter: null },
        requiredColumns: ['title'],
      },
      {
        payload: { title, description: description || null, type: 'custom', status: 'draft' },
        requiredColumns: ['title'],
      },
      {
        payload: { title, description: description || null },
        requiredColumns: ['title'],
      },
      {
        payload: { title },
        requiredColumns: ['title'],
      },
    ];
    let formInsert = null;
    for (const attempt of formAttempts) {
      formInsert = await insertWithColumnFallback('re_forms', attempt.payload, {
        requiredColumns: attempt.requiredColumns,
        returningColumns: formReturningColumns,
        requiredReturningColumns: ['id', 'title'],
      });
      if (!formInsert.error) break;
    }

    const { data: form, error } = formInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_forms', 'title', 'description', 'type', 'settings', 'linked_plan_chapter', 'created_by', 'status'])) {
        return res.status(503).json({
          error: 'Formulários temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/forms', error, formAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }
    // Auto-create first page
    const { error: pageError } = await insertWithColumnFallback('re_form_pages', {
      form_id: form.id,
      title: 'Página 1',
      order_index: 0,
    }, {
      requiredColumns: ['form_id', 'title'],
      returningColumns: ['id', 'form_id', 'title', 'order_index'],
      requiredReturningColumns: ['id', 'form_id', 'title'],
    });
    if (pageError) {
      if (isSchemaCompatibilityError(pageError.message, ['re_form_pages', 'form_id', 'title', 'order_index'])) {
        console.warn('[FORMS CREATE] first page unavailable due to schema mismatch, continuing with empty form:', pageError.message);
      } else {
        return res.status(500).json({ error: pageError.message });
      }
    }
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'form', entityId: form.id, action: 'create', after: { title, type } }).catch(e => console.warn('[async]', e?.message));
    res.json({ success: true, form });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Get full form ──────────────────────────────────────────────────────
app.get('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    const form = await loadFullForm(req.params.id);
    if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });
    res.json({ form });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Update form metadata ───────────────────────────────────────────────
app.put('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, status, settings, linked_plan_chapter } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (title  !== undefined) updates.title  = title;
    if (description !== undefined) updates.description = description;
    if (type   !== undefined) updates.type   = type;
    if (status !== undefined) updates.status = status;
    if (settings !== undefined) updates.settings = settings;
    if (linked_plan_chapter !== undefined) updates.linked_plan_chapter = linked_plan_chapter;
    const { data: form, error } = await updateWithColumnFallback('re_forms', { id: req.params.id }, updates, {
      requiredColumns: ['updated_at'],
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, form });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Delete form ────────────────────────────────────────────────────────
app.delete('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_forms').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Duplicate form ─────────────────────────────────────────────────────
app.post('/api/admin/forms/:id/duplicate', requireAdmin, async (req, res) => {
  try {
    const src = await loadFullForm(req.params.id);
    if (!src) return res.status(404).json({ error: 'Formulário não encontrado.' });

    const { data: newForm, error: formInsertError } = await insertWithColumnFallback('re_forms', {
      title: src.title + ' (cópia)', description: src.description,
      type: src.type, settings: src.settings, status: 'draft',
      linked_plan_chapter: src.linked_plan_chapter,
      created_by: req.user.id, template_id: src.id, version: 1,
    }, { requiredColumns: ['title', 'type', 'settings'] });
    if (formInsertError) return res.status(500).json({ error: formInsertError.message });

    const pageIdMap = {};
    for (const p of src.pages) {
      const { data: np } = await sb.from('re_form_pages').insert({
        form_id: newForm.id, title: p.title, description: p.description, order_index: p.order_index,
      }).select().single();
      pageIdMap[p.id] = np.id;
    }

    const qIdMap = {};
    for (const q of src.questions) {
      const { data: nq } = await sb.from('re_form_questions').insert({
        form_id: newForm.id, page_id: pageIdMap[q.page_id] || null,
        order_index: q.order_index, type: q.type, label: q.label,
        description: q.description, placeholder: q.placeholder,
        required: q.required, options: q.options, settings: q.settings,
        weight: q.weight, score_map: q.score_map, formula: q.formula,
      }).select().single();
      qIdMap[q.id] = nq.id;
    }

    for (const l of src.logic) {
      await sb.from('re_form_logic').insert({
        form_id: newForm.id,
        source_question_id: qIdMap[l.source_question_id] || null,
        operator: l.operator, condition_value: l.condition_value, action: l.action,
        target_question_id: l.target_question_id ? qIdMap[l.target_question_id] : null,
        target_page_id: l.target_page_id ? pageIdMap[l.target_page_id] : null,
      });
    }

    res.json({ success: true, form: newForm });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Assign form to client(s) ──────────────────────────────────────────
app.post('/api/admin/forms/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || !user_ids.length)
      return res.status(400).json({ error: 'user_ids é obrigatório.' });
    const rows = user_ids.map(uid => ({ form_id: req.params.id, user_id: uid, assigned_by: req.user.id }));
    await sb.from('re_form_assignments').upsert(rows, { onConflict: 'form_id,user_id' });
    // Notify clients
    for (const uid of user_ids) {
      const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
      pushNotification(uid, 'task', 'Novo formulário disponível',
        form?.title || 'Formulário', 'form', req.params.id).catch(e => console.warn('[async]', e?.message));
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Get form assignments ───────────────────────────────────────────────
app.get('/api/admin/forms/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_form_assignments')
      .select('*,re_users!re_form_assignments_user_id_fkey(name,email,company)')
      .eq('form_id', req.params.id);
    res.json({ assignments: data || [] });
  } catch (e) { res.json({ assignments: [] }); }
});

// ── Admin: Remove assignment ──────────────────────────────────────────────────
app.delete('/api/admin/forms/:id/assignments/:uid', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_assignments').delete().eq('form_id', req.params.id).eq('user_id', req.params.uid);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Pages CRUD ─────────────────────────────────────────────────────────
app.post('/api/admin/forms/:id/pages', requireAdmin, async (req, res) => {
  try {
    const { title, description } = req.body;
    const { data: last } = await sb.from('re_form_pages')
      .select('order_index').eq('form_id', req.params.id).order('order_index', { ascending: false }).limit(1).single();
    const { data: page } = await sb.from('re_form_pages').insert({
      form_id: req.params.id, title: title || 'Nova Página',
      description: description || null, order_index: (last?.order_index ?? -1) + 1,
    }).select().single();
    res.json({ success: true, page });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/forms/:id/pages/:pageId', requireAdmin, async (req, res) => {
  try {
    const { title, description, order_index } = req.body;
    const upd = {};
    if (title !== undefined)       upd.title       = title;
    if (description !== undefined) upd.description = description;
    if (order_index !== undefined) upd.order_index = order_index;
    const { data: page } = await sb.from('re_form_pages').update(upd).eq('id', req.params.pageId).select().single();
    res.json({ success: true, page });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/forms/:id/pages/:pageId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_questions').delete().eq('page_id', req.params.pageId);
    await sb.from('re_form_pages').delete().eq('id', req.params.pageId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Questions CRUD ─────────────────────────────────────────────────────
app.post('/api/admin/forms/:id/questions', requireAdmin, async (req, res) => {
  try {
    const { page_id, type, label, description, placeholder, required,
            options, settings, weight, score_map, formula } = req.body;
    if (!page_id || !type) return res.status(400).json({ error: 'page_id e type são obrigatórios.' });
    const { data: last } = await sb.from('re_form_questions')
      .select('order_index').eq('page_id', page_id).order('order_index', { ascending: false }).limit(1).single();
    const { data: q, error } = await sb.from('re_form_questions').insert({
      form_id: req.params.id, page_id, type,
      label: label || 'Nova Pergunta',
      description: description || null,
      placeholder: placeholder || null,
      required: required || false,
      options: options || null,
      settings: settings || null,
      weight: weight ?? 1,
      score_map: score_map || null,
      formula: formula || null,
      order_index: (last?.order_index ?? -1) + 1,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, question: q });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/forms/:id/questions/:qId', requireAdmin, async (req, res) => {
  try {
    const allowed = ['label','description','placeholder','required','options','settings',
                     'weight','score_map','formula','type','order_index','page_id'];
    const upd = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
    const { data: q, error } = await sb.from('re_form_questions').update(upd).eq('id', req.params.qId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, question: q });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/forms/:id/questions/:qId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_logic')
      .delete().or(`source_question_id.eq.${req.params.qId},target_question_id.eq.${req.params.qId}`);
    await sb.from('re_form_questions').delete().eq('id', req.params.qId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reorder questions within a page
app.post('/api/admin/forms/:id/questions/reorder', requireAdmin, async (req, res) => {
  try {
    // req.body.order = [{id, order_index}]
    const { order } = req.body;
    for (const item of (order || [])) {
      await sb.from('re_form_questions').update({ order_index: item.order_index }).eq('id', item.id);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: List logic rules for a form ───────────────────────────────────────
app.get('/api/admin/forms/:id/logic', requireAdmin, async (req, res) => {
  try {
    let q = sb.from('re_form_logic').select('*').eq('form_id', req.params.id);
    if (req.query.question_id) q = q.eq('source_question_id', req.query.question_id);
    const { data: rules } = await q.order('id');
    res.json({ rules: rules || [] });
  } catch (e) { res.json({ rules: [] }); }
});

// ── Admin: Logic CRUD ─────────────────────────────────────────────────────────
app.post('/api/admin/forms/:id/logic', requireAdmin, async (req, res) => {
  try {
    const { source_question_id, operator, condition_value, action,
            target_question_id, target_page_id } = req.body;
    if (!source_question_id || !action)
      return res.status(400).json({ error: 'source_question_id e action são obrigatórios.' });
    const { data: rule } = await sb.from('re_form_logic').insert({
      form_id: req.params.id, source_question_id, operator: operator || 'equals',
      condition_value: condition_value ?? null, action,
      target_question_id: target_question_id || null,
      target_page_id:     target_page_id     || null,
    }).select().single();
    res.json({ success: true, rule });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/forms/:id/logic/:ruleId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_logic').delete().eq('id', req.params.ruleId).eq('form_id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Responses ──────────────────────────────────────────────────────────
app.get('/api/admin/forms/:id/responses', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let q = sb.from('re_form_responses')
      .select('*,re_users!re_form_responses_user_id_fkey(name,email,company)')
      .eq('form_id', req.params.id)
      .order('started_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data: responses } = await q;
    res.json({ responses: responses || [] });
  } catch (e) { res.json({ responses: [] }); }
});

app.get('/api/admin/forms/:id/responses/:responseId', requireAdmin, async (req, res) => {
  try {
    const { data: response } = await sb.from('re_form_responses')
      .select('*,re_users!re_form_responses_user_id_fkey(name,email,company)')
      .eq('id', req.params.responseId).single();
    if (!response) return res.status(404).json({ error: 'Resposta não encontrada.' });
    const { data: answers } = await sb.from('re_form_answers')
      .select('*,re_form_questions(label,type)')
      .eq('response_id', req.params.responseId);
    res.json({ response, answers: answers || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Assign form by email (looks up user first) ────────────────────────
app.post('/api/admin/forms/:id/assign-email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório.' });
    const { data: user } = await sb.from('re_users').select('id,name,email').eq('email', email).single();
    if (!user) return res.status(404).json({ error: 'Cliente não encontrado com este email.' });
    await sb.from('re_form_assignments').upsert(
      { form_id: req.params.id, user_id: user.id, assigned_by: req.user.id },
      { onConflict: 'form_id,user_id' }
    );
    const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
    pushNotification(user.id, 'task', 'Novo formulário disponível',
      form?.title || 'Formulário', 'form', req.params.id).catch(e => console.warn('[async]', e?.message));
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: List available forms ──────────────────────────────────────────────
app.get('/api/forms', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    // Get forms assigned to this user
    const { data: assignments } = await sb.from('re_form_assignments')
      .select('form_id').eq('user_id', uid);
    const formIds = (assignments || []).map(a => a.form_id);

    let forms = [];
    if (formIds.length) {
      const { data } = await sb.from('re_forms')
        .select('id,title,description,type,settings')
        .in('id', formIds).eq('status', 'active');
      forms = data || [];
    }

    // Attach response status for each form
    const withStatus = await Promise.all(forms.map(async f => {
      const { data: resp } = await sb.from('re_form_responses')
        .select('id,status,completed_at,score_pct')
        .eq('form_id', f.id).eq('user_id', uid)
        .order('started_at', { ascending: false }).limit(1);
      const latest = resp?.[0] || null;
      return { ...f, my_status: latest?.status || 'not_started',
               my_response_id: latest?.id || null,
               completed_at: latest?.completed_at || null,
               score_pct: latest?.score_pct || null };
    }));

    res.json({ forms: withStatus });
  } catch (e) { res.json({ forms: [] }); }
});

// ── Client: Get form for rendering (public structure) ─────────────────────────
app.get('/api/forms/:id', requireAuth, async (req, res) => {
  try {
    // Check assignment
    const { data: asgn } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', req.params.id).eq('user_id', req.user.id).single();
    if (!asgn) return res.status(403).json({ error: 'Sem acesso a este formulário.' });

    const form = await loadFullForm(req.params.id);
    if (!form || form.status === 'inactive') return res.status(404).json({ error: 'Formulário não disponível.' });
    res.json({ form });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: Start or resume a response ───────────────────────────────────────
app.post('/api/forms/:id/responses', requireAuth, async (req, res) => {
  try {
    const formId = req.params.id;
    // Resume existing in-progress response if any
    const { data: existing } = await sb.from('re_form_responses')
      .select('*').eq('form_id', formId).eq('user_id', req.user.id)
      .eq('status', 'in_progress').order('started_at', { ascending: false }).limit(1).single();
    if (existing) return res.json({ response: existing, resumed: true });

    // Get first page
    const { data: firstPage } = await sb.from('re_form_pages')
      .select('id').eq('form_id', formId).order('order_index').limit(1).single();

    const { data: response } = await sb.from('re_form_responses').insert({
      form_id: formId, user_id: req.user.id, status: 'in_progress',
      current_page_id: firstPage?.id || null,
    }).select().single();

    res.json({ response, resumed: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: Save answers (auto-save) ─────────────────────────────────────────
app.put('/api/forms/:id/responses/:responseId', requireAuth, async (req, res) => {
  try {
    const { answers, current_page_id } = req.body;
    // Verify ownership
    const { data: resp } = await sb.from('re_form_responses')
      .select('id,user_id').eq('id', req.params.responseId).single();
    if (!resp || resp.user_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão.' });

    if (current_page_id) {
      await sb.from('re_form_responses').update({ current_page_id }).eq('id', req.params.responseId);
    }

    if (Array.isArray(answers)) {
      for (const ans of answers) {
        await sb.from('re_form_answers').upsert({
          response_id: req.params.responseId,
          question_id: ans.question_id,
          value:       ans.value       ?? null,
          value_json:  ans.value_json  ?? null,
          file_path:   ans.file_path   ?? null,
          updated_at:  new Date().toISOString(),
        }, { onConflict: 'response_id,question_id' });
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: Complete form response ────────────────────────────────────────────
app.post('/api/forms/:id/responses/:responseId/complete', requireAuth, async (req, res) => {
  try {
    const { score_total, score_max, score_pct, score_classification, score_details,
            calculation_results, auto_report } = req.body;

    const { data: resp } = await sb.from('re_form_responses')
      .select('user_id').eq('id', req.params.responseId).single();
    if (!resp || resp.user_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão.' });

    await sb.from('re_form_responses').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      score_total:          score_total          ?? null,
      score_max:            score_max            ?? null,
      score_pct:            score_pct            ?? null,
      score_classification: score_classification ?? null,
      score_details:        score_details        ?? null,
      calculation_results:  calculation_results  ?? null,
      auto_report:          auto_report          ?? null,
    }).eq('id', req.params.responseId);

    // Notify admin(s)
    const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
    const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(10);
    for (const adm of (admins || [])) {
      pushNotification(adm.id, 'task', 'Formulário concluído',
        `${form?.title || 'Formulário'} — resposta de ${req.user.name || req.user.email}`,
        'form_response', req.params.responseId).catch(e => console.warn('[async]', e?.message));
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FORM PLAYER — Simplified Client Routes (/api/my-forms/*)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/my-forms — list assigned forms with status ───────────────────────
app.get('/api/my-forms', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: assignments } = await sb.from('re_form_assignments').select('form_id').eq('user_id', uid);
    const formIds = (assignments || []).map(a => a.form_id);
    if (!formIds.length) return res.json([]);

    const { data: forms } = await sb.from('re_forms')
      .select('id,title,description,type,status')
      .in('id', formIds).in('status', ['active','publicado']);

    const withStatus = await Promise.all((forms || []).map(async f => {
      const { data: resp } = await sb.from('re_form_responses')
        .select('id,status,score_pct,score_classification,current_page_id,updated_at')
        .eq('form_id', f.id).eq('user_id', uid)
        .order('updated_at', { ascending: false }).limit(1);
      const r = resp?.[0] || null;
      const STATUS_MAP = { in_progress:'em_andamento', completed:'concluido' };
      return {
        ...f,
        response_status:   r ? (STATUS_MAP[r.status] || r.status) : 'nao_iniciado',
        response_id:       r?.id || null,
        response_progress: null, // not tracked per-question for now
        score_pct:         r?.score_pct || null,
        score_classification: r?.score_classification || null,
      };
    }));
    res.json(withStatus);
  } catch (e) { res.json([]); }
});

// ── GET /api/my-forms/:id — form structure + existing response ────────────────
app.get('/api/my-forms/:id', requireAuth, async (req, res) => {
  try {
    const uid    = req.user.id;
    const formId = req.params.id;
    // Check assignment
    const { data: asgn } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', formId).eq('user_id', uid).single();
    if (!asgn) return res.status(403).json({ error: 'Sem acesso a este formulário.' });

    const form = await loadFullForm(formId);
    if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });

    // Get existing in-progress or completed response
    const { data: existing } = await sb.from('re_form_responses')
      .select('id,status,current_page_id,score_pct,score_total,score_max,score_classification,auto_report')
      .eq('form_id', formId).eq('user_id', uid)
      .order('updated_at', { ascending: false }).limit(1).single();

    let existingWithAnswers = null;
    if (existing) {
      const { data: answers } = await sb.from('re_form_answers')
        .select('question_id,value,value_json').eq('response_id', existing.id);
      existingWithAnswers = { ...existing, answers: answers || [] };
    }

    res.json({ ...form, existing_response: existingWithAnswers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/my-forms/:id/response — upsert response + save all answers ─────
app.post('/api/my-forms/:id/response', requireAuth, async (req, res) => {
  try {
    const uid    = req.user.id;
    const formId = req.params.id;
    const { answers, current_page_id, status } = req.body;

    // Check assignment
    const { data: asgn } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', formId).eq('user_id', uid).single();
    if (!asgn) return res.status(403).json({ error: 'Sem acesso.' });

    // Get or create response
    let { data: resp } = await sb.from('re_form_responses')
      .select('id,status').eq('form_id', formId).eq('user_id', uid)
      .not('status', 'eq', 'completed')
      .order('updated_at', { ascending: false }).limit(1).single();

    const isCompleting = status === 'concluido';
    const dbStatus     = isCompleting ? 'completed' : 'in_progress';

    const now = new Date().toISOString();
    if (!resp) {
      const { data: newResp } = await sb.from('re_form_responses').insert({
        form_id: formId, user_id: uid, status: dbStatus,
        current_page_id: current_page_id || null,
        last_active_at: now,
        updated_at: now,
      }).select('id,status,started_at').single();
      resp = newResp;
    } else {
      const upd = { status: dbStatus, updated_at: now, last_active_at: now };
      if (current_page_id) upd.current_page_id = current_page_id;
      if (isCompleting) {
        upd.completed_at = now;
        // Compute time_to_complete_seconds from started_at
        if (resp.started_at) {
          const secs = Math.round((Date.now() - new Date(resp.started_at).getTime()) / 1000);
          upd.time_to_complete_seconds = secs;
        }
      }
      await sb.from('re_form_responses').update(upd).eq('id', resp.id);
    }

    const responseId = resp.id;

    // Save answers (answers is a {questionId: value} object)
    if (answers && typeof answers === 'object') {
      for (const [qId, val] of Object.entries(answers)) {
        const isArr     = Array.isArray(val);
        const isComplex = isArr || (typeof val === 'object' && val !== null);
        await sb.from('re_form_answers').upsert({
          response_id: responseId,
          question_id: parseInt(qId),
          value:       isComplex ? null : (val == null ? null : String(val)),
          value_json:  isComplex ? val  : null,
          updated_at:  new Date().toISOString(),
        }, { onConflict: 'response_id,question_id' });
      }
    }

    // If completing, calculate scoring
    let scoreData = {};
    if (isCompleting) {
      const { data: questions } = await sb.from('re_form_questions')
        .select('id,weight,score_map,type').eq('form_id', formId);

      let totalScore = 0, maxScore = 0;
      const scoreDetails = {};
      for (const q of (questions || [])) {
        if (!q.weight) continue;
        maxScore += q.weight;
        const ansKey  = String(q.id);
        const ansVal  = answers?.[ansKey];
        const scoreMap = q.score_map || {};
        let pts = 0;
        if (ansVal != null && scoreMap[String(ansVal)] !== undefined) {
          pts = parseFloat(scoreMap[String(ansVal)]) || 0;
        } else if (typeof ansVal === 'number') {
          pts = ansVal * (q.weight / 10); // default scale scoring
        }
        totalScore += pts;
        scoreDetails[q.id] = pts;
      }
      const pct = maxScore > 0 ? (totalScore / maxScore) * 100 : null;
      const classification = pct == null ? null
        : pct >= 70 ? 'saudavel'
        : pct >= 40 ? 'risco_moderado'
        : 'risco_alto';

      // Generate auto-report
      const { data: form } = await sb.from('re_forms').select('title,type').eq('id', formId).single();
      let autoReport = null;
      if (pct != null) {
        autoReport = `Relatório de ${form?.title || 'Diagnóstico'}\n\nPontuação: ${Math.round(pct)}% (${totalScore.toFixed(1)}/${maxScore} pontos)\n`;
        autoReport += classification === 'saudavel'      ? 'Situação: SAUDÁVEL — A empresa apresenta boa saúde financeira e operacional.\n'
                    : classification === 'risco_moderado' ? 'Situação: RISCO MODERADO — Há pontos de atenção que merecem acompanhamento.\n'
                    : 'Situação: RISCO ALTO — A empresa necessita de intervenção imediata.\n';
        autoReport += `\nEste relatório foi gerado automaticamente com base nas respostas fornecidas em ${new Date().toLocaleDateString('pt-BR')}.`;
      }

      await sb.from('re_form_responses').update({
        score_total:          totalScore,
        score_max:            maxScore,
        score_pct:            pct,
        score_classification: classification,
        score_details:        scoreDetails,
        auto_report:          autoReport,
      }).eq('id', responseId);

      scoreData = { score_total: totalScore, score_max: maxScore, score_pct: pct, score_classification: classification, auto_report: autoReport };

      // Notify admins
      const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(10);
      for (const adm of (admins || [])) {
        pushNotification(adm.id, 'task', 'Formulário concluído',
          `${form?.title || 'Formulário'} — resposta de ${req.user.name || req.user.email}`,
          'form_response', responseId).catch(e => console.warn('[async]', e?.message));
      }
    }

    res.json({ response_id: responseId, ...scoreData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Client: Get own responses ─────────────────────────────────────────────────
app.get('/api/my-form-responses', requireAuth, async (req, res) => {
  try {
    const { data } = await sb.from('re_form_responses')
      .select('*,re_forms(title,type)')
      .eq('user_id', req.user.id)
      .order('started_at', { ascending: false });
    res.json({ responses: data || [] });
  } catch (e) { res.json({ responses: [] }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FORM STATS — Admin
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/forms/:id/stats', requireAdmin, async (req, res) => {
  try {
    const formId = req.params.id;

    const { data: all } = await sb.from('re_form_responses')
      .select('id,status,started_at,completed_at,abandoned_at,time_to_complete_seconds,last_active_at,metadata')
      .eq('form_id', formId);

    const rows = all || [];
    const total       = rows.length;
    const completed   = rows.filter(r => r.status === 'completed').length;
    const abandoned   = rows.filter(r => r.abandoned_at != null || r.status === 'abandoned').length;
    const inProgress  = total - completed - abandoned;

    const completedRows = rows.filter(r => r.time_to_complete_seconds != null);
    const avgTime = completedRows.length
      ? Math.round(completedRows.reduce((s, r) => s + r.time_to_complete_seconds, 0) / completedRows.length)
      : null;

    const completionRate  = total > 0 ? Math.round((completed / total) * 100)  : 0;
    const abandonmentRate = total > 0 ? Math.round((abandoned / total) * 100)  : 0;

    // Daily starts (last 30 days)
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const recentRows = rows.filter(r => r.started_at >= cutoff);
    const dailyMap = {};
    for (const r of recentRows) {
      const day = r.started_at.slice(0, 10);
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    const dailyStarts = Object.entries(dailyMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      total, completed, abandoned, in_progress: inProgress,
      completion_rate: completionRate,
      abandonment_rate: abandonmentRate,
      avg_time_seconds: avgTime,
      daily_starts: dailyStarts,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mark abandoned responses (called by cron or manually) ────────────────────
app.post('/api/admin/forms/:id/responses/:responseId/abandon', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_responses').update({
      status: 'abandoned',
      abandoned_at: new Date().toISOString(),
    }).eq('id', req.params.responseId).eq('form_id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// JOURNEYS — Admin CRUD
// ══════════════════════════════════════════════════════════════════════════════

// ── List journeys ─────────────────────────────────────────────────────────────
app.get('/api/admin/journeys', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_journeys')
      .select('*')
      .order('created_at', { ascending: false });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get single journey (with steps) ──────────────────────────────────────────
app.get('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    const { data: journey } = await sb.from('re_journeys')
      .select('*').eq('id', req.params.id).single();
    if (!journey) return res.status(404).json({ error: 'Jornada não encontrada.' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('*,re_forms(id,title,type,status)')
      .eq('journey_id', req.params.id)
      .order('order_index', { ascending: true });

    res.json({ ...journey, steps: steps || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create journey ────────────────────────────────────────────────────────────
app.post('/api/admin/journeys', requireAdmin, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const { data } = await sb.from('re_journeys').insert({
      name, description: description || null,
      status: status || 'draft',
      created_by: req.user.id,
    }).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Update journey ────────────────────────────────────────────────────────────
app.put('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const upd = {};
    if (name        !== undefined) upd.name        = name;
    if (description !== undefined) upd.description = description;
    if (status      !== undefined) upd.status      = status;
    const { data } = await sb.from('re_journeys').update(upd).eq('id', req.params.id).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete journey ────────────────────────────────────────────────────────────
app.delete('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_journeys').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Steps: add ────────────────────────────────────────────────────────────────
app.post('/api/admin/journeys/:id/steps', requireAdmin, async (req, res) => {
  try {
    const { title, description, form_id, is_optional, unlock_condition } = req.body;
    if (!title) return res.status(400).json({ error: 'Título da etapa é obrigatório.' });

    // Auto order_index
    const { count } = await sb.from('re_journey_steps')
      .select('id', { count: 'exact', head: true }).eq('journey_id', req.params.id);

    const { data } = await sb.from('re_journey_steps').insert({
      journey_id: req.params.id,
      form_id:    form_id    || null,
      title, description: description || null,
      order_index:      count || 0,
      is_optional:      !!is_optional,
      unlock_condition: unlock_condition || {},
    }).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Steps: update ─────────────────────────────────────────────────────────────
app.put('/api/admin/journeys/:id/steps/:stepId', requireAdmin, async (req, res) => {
  try {
    const { title, description, form_id, is_optional, order_index, unlock_condition } = req.body;
    const upd = {};
    if (title            !== undefined) upd.title            = title;
    if (description      !== undefined) upd.description      = description;
    if (form_id          !== undefined) upd.form_id          = form_id || null;
    if (is_optional      !== undefined) upd.is_optional      = !!is_optional;
    if (order_index      !== undefined) upd.order_index      = order_index;
    if (unlock_condition !== undefined) upd.unlock_condition = unlock_condition;
    const { data } = await sb.from('re_journey_steps')
      .update(upd).eq('id', req.params.stepId).eq('journey_id', req.params.id).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Steps: reorder ────────────────────────────────────────────────────────────
app.post('/api/admin/journeys/:id/steps/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body; // array of { id, order_index }
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve ser um array.' });
    for (const item of order) {
      await sb.from('re_journey_steps')
        .update({ order_index: item.order_index })
        .eq('id', item.id).eq('journey_id', req.params.id);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Steps: delete ─────────────────────────────────────────────────────────────
app.delete('/api/admin/journeys/:id/steps/:stepId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_journey_steps').delete()
      .eq('id', req.params.stepId).eq('journey_id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assignments: list (admin — all clients for a journey) ─────────────────────
app.get('/api/admin/journeys/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_journey_assignments')
      .select('*,re_users(id,name,email,company)')
      .eq('journey_id', req.params.id)
      .order('assigned_at', { ascending: false });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assignments: assign client to journey ─────────────────────────────────────
app.post('/api/admin/journeys/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { user_id, notes } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório.' });
    const { data } = await sb.from('re_journey_assignments').upsert({
      journey_id:  req.params.id,
      user_id,
      assigned_by: req.user.id,
      status:      'active',
      notes:       notes || null,
    }, { onConflict: 'journey_id,user_id' }).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assignments: update status / notes ───────────────────────────────────────
app.put('/api/admin/journeys/:id/assignments/:asnId', requireAdmin, async (req, res) => {
  try {
    const { status, notes, current_step_index } = req.body;
    const upd = {};
    if (status             !== undefined) upd.status             = status;
    if (notes              !== undefined) upd.notes              = notes;
    if (current_step_index !== undefined) upd.current_step_index = current_step_index;
    if (status === 'completed') upd.completed_at = new Date().toISOString();
    const { data } = await sb.from('re_journey_assignments')
      .update(upd).eq('id', req.params.asnId).select().single();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assignments: remove ───────────────────────────────────────────────────────
app.delete('/api/admin/journeys/:id/assignments/:asnId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_journey_assignments')
      .delete().eq('id', req.params.asnId).eq('journey_id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Step completions: mark complete ──────────────────────────────────────────
app.post('/api/admin/journeys/:id/assignments/:asnId/complete-step', requireAdmin, async (req, res) => {
  try {
    const { step_id, form_response_id, notes } = req.body;
    if (!step_id) return res.status(400).json({ error: 'step_id é obrigatório.' });

    await sb.from('re_journey_step_completions').upsert({
      assignment_id:    req.params.asnId,
      step_id,
      form_response_id: form_response_id || null,
      notes:            notes || null,
      completed_at:     new Date().toISOString(),
    }, { onConflict: 'assignment_id,step_id' });

    // Advance current_step_index to the next step
    const { data: steps } = await sb.from('re_journey_steps')
      .select('id,order_index').eq('journey_id', req.params.id).order('order_index');
    const completedIdx = steps?.findIndex(s => s.id === step_id) ?? -1;
    const nextIdx      = completedIdx + 1;
    if (nextIdx < (steps?.length || 0)) {
      await sb.from('re_journey_assignments')
        .update({ current_step_index: nextIdx }).eq('id', req.params.asnId);
    } else {
      // All steps done
      await sb.from('re_journey_assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', req.params.asnId);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Journey progress for a specific client (admin view) ──────────────────────
app.get('/api/admin/journeys/:id/assignments/:asnId/progress', requireAdmin, async (req, res) => {
  try {
    const { data: assignment } = await sb.from('re_journey_assignments')
      .select('*,re_users(name,email)').eq('id', req.params.asnId).single();
    if (!assignment) return res.status(404).json({ error: 'Atribuição não encontrada.' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('*,re_forms(id,title)').eq('journey_id', req.params.id).order('order_index');

    const { data: completions } = await sb.from('re_journey_step_completions')
      .select('step_id,completed_at,form_response_id').eq('assignment_id', req.params.asnId);
    const completionMap = {};
    for (const c of (completions || [])) completionMap[c.step_id] = c;

    const stepsWithStatus = (steps || []).map(s => ({
      ...s,
      completed: !!completionMap[s.id],
      completed_at: completionMap[s.id]?.completed_at || null,
      form_response_id: completionMap[s.id]?.form_response_id || null,
    }));

    res.json({ assignment, steps: stepsWithStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// JOURNEYS — Client Routes (/api/my-journeys/*)
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/my-journeys', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: assignments } = await sb.from('re_journey_assignments')
      .select('*,re_journeys(id,name,description,status)')
      .eq('user_id', uid).in('status', ['active','completed']);

    // Check if user has completed the main onboarding (for auto-completing form steps)
    const { data: onboarding } = await sb.from('re_onboarding')
      .select('status').eq('user_id', uid).single();
    const onboardingDone = onboarding?.status === 'completed';

    const result = await Promise.all((assignments || []).map(async asn => {
      const { data: steps } = await sb.from('re_journey_steps')
        .select('id,title,description,order_index,is_optional,form_id,re_forms(id,title,is_system,system_key)')
        .eq('journey_id', asn.journey_id).order('order_index');

      const { data: completions } = await sb.from('re_journey_step_completions')
        .select('step_id,completed_at').eq('assignment_id', asn.id);
      const doneSet = new Set((completions || []).map(c => c.step_id));

      // Auto-complete onboarding form steps for clients who already finished onboarding
      if (onboardingDone) {
        for (const step of (steps || [])) {
          if (step.re_forms?.system_key === 'onboarding_14steps' && !doneSet.has(step.id)) {
            await sb.from('re_journey_step_completions').upsert({
              assignment_id: asn.id,
              step_id:       step.id,
              completed_at:  new Date().toISOString(),
              notes:         'Completado automaticamente via onboarding do portal',
            }, { onConflict: 'assignment_id,step_id' }).catch(e => console.warn('[auto-complete step]', e?.message));
            doneSet.add(step.id);
            // Advance pointer past this step
            if (asn.current_step_index === step.order_index) {
              const nextIdx = step.order_index + 1;
              await sb.from('re_journey_assignments')
                .update({ current_step_index: nextIdx }).eq('id', asn.id)
                .catch(e => console.warn('[auto-advance journey]', e?.message));
              asn.current_step_index = nextIdx;
            }
          }
        }
      }

      return {
        assignment_id:       asn.id,
        journey_id:          asn.journey_id,
        journey_name:        asn.re_journeys?.name,
        journey_description: asn.re_journeys?.description,
        status:              asn.status,
        current_step_index:  asn.current_step_index,
        assigned_at:         asn.assigned_at,
        completed_at:        asn.completed_at,
        steps: (steps || []).map(s => ({
          ...s,
          completed: doneSet.has(s.id),
        })),
        progress_pct: steps?.length
          ? Math.round((doneSet.size / steps.length) * 100)
          : 0,
      };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Client: complete a journey step (linked to a form response they submitted)
app.post('/api/my-journeys/:asnId/complete-step', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { step_id, form_response_id } = req.body;
    if (!step_id) return res.status(400).json({ error: 'step_id é obrigatório.' });

    // Verify assignment belongs to this user
    const { data: asn } = await sb.from('re_journey_assignments')
      .select('id,journey_id').eq('id', req.params.asnId).eq('user_id', uid).single();
    if (!asn) return res.status(403).json({ error: 'Sem acesso.' });

    await sb.from('re_journey_step_completions').upsert({
      assignment_id:    req.params.asnId,
      step_id,
      form_response_id: form_response_id || null,
      completed_at:     new Date().toISOString(),
    }, { onConflict: 'assignment_id,step_id' });

    // Advance pointer
    const { data: steps } = await sb.from('re_journey_steps')
      .select('id,order_index').eq('journey_id', asn.journey_id).order('order_index');
    const idx     = steps?.findIndex(s => s.id === step_id) ?? -1;
    const nextIdx = idx + 1;
    if (nextIdx < (steps?.length || 0)) {
      await sb.from('re_journey_assignments')
        .update({ current_step_index: nextIdx }).eq('id', req.params.asnId);
    } else {
      await sb.from('re_journey_assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', req.params.asnId);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notifications ───────────────────────────────────────────────────────────
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const { data: rows } = await sb.from('re_notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit);
    const items   = rows || [];
    const unread  = items.filter(n => !n.read).length;
    res.json({ notifications: items, unread_count: unread });
  } catch (e) {
    console.error('[NOTIF GET]', e.message);
    res.json({ notifications: [], unread_count: 0 });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('read', false);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: push notification to a specific user or broadcast
app.post('/api/admin/notifications/send', requireAdmin, async (req, res) => {
  try {
    const { user_id, type, title, body, entity_type, entity_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });

    if (user_id) {
      await pushNotification(user_id, type || 'info', title, body, entity_type, entity_id);
    } else {
      // Broadcast to all active clients
      const { data: users } = await sb.from('re_users')
        .select('id')
        .eq('is_admin', false)
        .limit(500);
      for (const u of (users || [])) {
        await pushNotification(u.id, type || 'info', title, body, entity_type, entity_id);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Internal Invoices (hybrid billing) ──────────────────────────────────────

// Client: list own internal invoices
app.get('/api/financial/internal-invoices', requireAuth, async (req, res) => {
  try {
    const { data: invoices } = await sb.from('re_invoices')
      .select('id,description,amount_cents,due_date,status,paid_at,payment_method,boleto_pdf_path,bank_data,created_at')
      .eq('user_id', req.user.id)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: false });
    res.json({ invoices: invoices || [] });
  } catch (e) {
    console.error('[INVOICES GET]', e.message);
    res.json({ invoices: [] });
  }
});

// Client: download boleto PDF for an invoice
app.get('/api/financial/internal-invoices/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: inv } = await sb.from('re_invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!inv) return res.status(404).json({ error: 'Boleto não encontrado.' });

    // If a cached PDF exists, serve it
    if (inv.boleto_pdf_path) {
      const pdfPath = path.join(__dirname, inv.boleto_pdf_path);
      if (fs.existsSync(pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleto-${inv.id}.pdf"`);
        return fs.createReadStream(pdfPath).pipe(res);
      }
    }

    // Generate PDF on the fly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boleto-${inv.id}.pdf"`);
    const doc = new PDFDoc({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const amtFmt = (inv.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dueFmt = new Date(inv.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
    const bd     = inv.bank_data || {};

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a5f').text('Recupera Empresas', { align: 'center' });
    doc.fontSize(13).font('Helvetica').fillColor('#374151').text('BOLETO DE COBRANÇA', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E2E8F0').stroke();
    doc.moveDown(0.5);

    const field = (label, value) => {
      doc.fontSize(9).fillColor('#6B7280').text(label.toUpperCase());
      doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text(value || '-');
      doc.font('Helvetica').moveDown(0.4);
    };

    field('Beneficiário',       'Recupera Empresas Consultoria Ltda');
    field('Descrição',          inv.description);
    field('Valor',              amtFmt);
    field('Vencimento',         dueFmt);
    field('Status',             inv.status === 'paid' ? 'PAGO' : inv.status === 'overdue' ? 'VENCIDO' : 'EM ABERTO');
    if (bd.linha_digitavel) field('Linha Digitável',   bd.linha_digitavel);
    if (bd.banco)           field('Banco',             bd.banco);
    if (bd.agencia)         field('Agência / Conta',   `${bd.agencia} / ${bd.conta}`);

    doc.moveDown();
    doc.fontSize(9).fillColor('#9CA3AF').text(`Gerado em ${new Date().toLocaleString('pt-BR')} — ID: ${inv.id}`, { align: 'center' });
    doc.end();
  } catch (e) {
    console.error('[BOLETO PDF]', e.message);
    res.status(500).json({ error: 'Erro ao gerar PDF.' });
  }
});

// Admin: list all internal invoices with optional filters
app.get('/api/admin/invoices', requireAdmin, async (req, res) => {
  try {
    const { status, user_id, from, to, limit = '50', offset = '0' } = req.query;
    let q = sb.from('re_invoices')
      .select('*,re_users!re_invoices_user_id_fkey(name,email,company)')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status)  q = q.eq('status', status);
    if (user_id) q = q.eq('user_id', user_id);
    if (from)    q = q.gte('due_date', from);
    if (to)      q = q.lte('due_date', to);
    const { data: invoices, count } = await q;
    res.json({ invoices: invoices || [], total: count || 0 });
  } catch (e) {
    console.error('[ADMIN INVOICES GET]', e.message);
    res.json({ invoices: [], total: 0 });
  }
});

// Admin: create internal invoice for a client
app.post('/api/admin/invoices', requireAdmin, async (req, res) => {
  try {
    const { user_id, description, amount_cents, due_date, payment_method, bank_data, notes } = req.body;
    if (!user_id || !description || !amount_cents || !due_date) {
      return res.status(400).json({ error: 'user_id, description, amount_cents e due_date são obrigatórios.' });
    }
    const { data: invoiceUser, error: invoiceUserError } = await sb.from('re_users').select('id,email,name,company').eq('id', user_id).single();
    if (invoiceUserError || !invoiceUser) {
      return res.status(400).json({ error: 'Cliente informado não foi encontrado para a cobrança.', diagnostic: { route: '/api/admin/invoices', user_id } });
    }
    const basePayload = {
      user_id,
      description,
      amount_cents: parseInt(amount_cents, 10),
      due_date,
      status: 'pending',
      payment_method: payment_method || 'boleto',
      bank_data: bank_data || null,
      notes: notes || null,
      created_by: req.user.id,
    };
    const invoiceReturningColumns = ['id', 'user_id', 'description', 'amount_cents', 'due_date', 'status', 'paid_at', 'payment_method', 'boleto_pdf_path', 'bank_data', 'notes', 'created_by', 'created_at', 'updated_at'];
    let invoiceInsert = await insertWithColumnFallback('re_invoices', basePayload, {
      requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'],
      returningColumns: invoiceReturningColumns,
      requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
    });

    if (invoiceInsert.error && /payment_method/i.test(String(invoiceInsert.error.message || ''))) {
      invoiceInsert = await insertWithColumnFallback('re_invoices', { ...basePayload, payment_method: null }, {
        requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'],
        returningColumns: invoiceReturningColumns,
        requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
      });
    }

    if (invoiceInsert.error && /created_by/i.test(String(invoiceInsert.error.message || ''))) {
      invoiceInsert = await insertWithColumnFallback('re_invoices', { ...basePayload, created_by: null }, {
        requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'],
        returningColumns: invoiceReturningColumns,
        requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
      });
    }

    if (invoiceInsert.error && /bank_data/i.test(String(invoiceInsert.error.message || ''))) {
      invoiceInsert = await insertWithColumnFallback('re_invoices', { ...basePayload, bank_data: null }, {
        requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'],
        returningColumns: invoiceReturningColumns,
        requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
      });
    }

    if (invoiceInsert.error && /notes/i.test(String(invoiceInsert.error.message || ''))) {
      invoiceInsert = await insertWithColumnFallback('re_invoices', { ...basePayload, notes: null }, {
        requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'],
        returningColumns: invoiceReturningColumns,
        requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
      });
    }

    const { data: inv, error } = invoiceInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_invoices', 'user_id', 'description', 'amount_cents', 'due_date', 'status', 'payment_method', 'bank_data', 'notes', 'created_by'])) {
        return res.status(503).json({
          error: 'Cobranças temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/invoices', error, [
            { payload: basePayload, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'], returningColumns: invoiceReturningColumns },
            { payload: { ...basePayload, payment_method: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'], returningColumns: invoiceReturningColumns },
            { payload: { ...basePayload, created_by: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'], returningColumns: invoiceReturningColumns },
            { payload: { ...basePayload, bank_data: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'], returningColumns: invoiceReturningColumns },
            { payload: { ...basePayload, notes: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'], returningColumns: invoiceReturningColumns },
          ]),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    // Push notification to client
    pushNotification(user_id, 'payment', 'Nova cobrança disponível',
      `${description} — vencimento: ${new Date(due_date + 'T12:00:00').toLocaleDateString('pt-BR')}`,
      'invoice', inv.id).catch(e => console.warn('[async]', e?.message));

    // Audit log
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'invoice', entityId: inv.id, action: 'create',
      after: { user_id, description, amount_cents, due_date } }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, invoice: inv });
  } catch (e) {
    console.error('[ADMIN INVOICE POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: update invoice (status, paid_at, notes)
app.put('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
  try {
    const { status, paid_at, notes, bank_data } = req.body;
    const { data: before } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!before) return res.status(404).json({ error: 'Boleto não encontrado.' });

    const updates = {};
    if (status    !== undefined) updates.status    = status;
    if (paid_at   !== undefined) updates.paid_at   = paid_at;
    if (notes     !== undefined) updates.notes     = notes;
    if (bank_data !== undefined) updates.bank_data = bank_data;

    const { data: inv, error } = await sb.from('re_invoices').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Notify client on status change
    if (status && status !== before.status) {
      const labels = { paid: 'Pagamento confirmado', overdue: 'Boleto vencido', cancelled: 'Boleto cancelado' };
      if (labels[status]) {
        pushNotification(before.user_id, 'payment', labels[status],
          before.description, 'invoice', req.params.id).catch(e => console.warn('[async]', e?.message));
      }
    }

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'invoice', entityId: req.params.id, action: 'update',
      before: before, after: updates }).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, invoice: inv });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: cancel (soft-delete) invoice
app.delete('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
  try {
    const { data: before } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!before) return res.status(404).json({ error: 'Boleto não encontrado.' });
    await sb.from('re_invoices').update({ status: 'cancelled' }).eq('id', req.params.id);
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'invoice', entityId: req.params.id, action: 'cancel',
      before: { status: before.status }, after: { status: 'cancelled' } }).catch(e => console.warn('[async]', e?.message));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: manually send invoice notification email
app.post('/api/admin/invoices/:id/send-email', requireAdmin, async (req, res) => {
  try {
    const { data: inv } = await sb.from('re_invoices')
      .select('*,re_users!re_invoices_user_id_fkey(name,email)')
      .eq('id', req.params.id)
      .single();
    if (!inv) return res.status(404).json({ error: 'Boleto não encontrado.' });

    const client     = inv.re_users || {};
    const amtFmt     = ((inv.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dueFmt     = new Date(inv.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
    const pdfUrl     = `${BASE_URL}/api/financial/internal-invoices/${inv.id}/pdf`;

    await sendMail(
      client.email,
      `Boleto disponível: ${inv.description}`,
      `<p>Olá, ${client.name || 'Cliente'}!</p>
       <p>Um novo boleto está disponível no seu portal:</p>
       <ul>
         <li><strong>Descrição:</strong> ${inv.description}</li>
         <li><strong>Valor:</strong> ${amtFmt}</li>
         <li><strong>Vencimento:</strong> ${dueFmt}</li>
       </ul>
         <p><a href="${pdfUrl}" ${emailStyle('primaryButton', 'padding:10px 20px')}>Baixar Boleto PDF</a></p>
       <p>Acesse o <a href="${BASE_URL}/dashboard.html">Portal do Cliente</a> para mais detalhes.</p>`
    );

    await sb.from('re_invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[INVOICE EMAIL]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: admin-side PDF generation (same as client endpoint but no user check)
app.get('/api/admin/invoices/:id/pdf', requireAdmin, async (req, res) => {
  try {
    const { data: inv } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!inv) return res.status(404).json({ error: 'Boleto não encontrado.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boleto-${inv.id}.pdf"`);
    const doc = new PDFDoc({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const amtFmt = (inv.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dueFmt = new Date(inv.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
    const bd     = inv.bank_data || {};

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a5f').text('Recupera Empresas', { align: 'center' });
    doc.fontSize(13).font('Helvetica').fillColor('#374151').text('BOLETO DE COBRANÇA — CÓPIA ADMINISTRATIVA', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E2E8F0').stroke();
    doc.moveDown(0.5);

    const field = (label, value) => {
      doc.fontSize(9).fillColor('#6B7280').font('Helvetica').text(label.toUpperCase());
      doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text(value || '-');
      doc.font('Helvetica').moveDown(0.4);
    };

    field('Descrição',        inv.description);
    field('Valor',            amtFmt);
    field('Vencimento',       dueFmt);
    field('Status',           inv.status === 'paid' ? 'PAGO' : inv.status === 'overdue' ? 'VENCIDO' : inv.status === 'cancelled' ? 'CANCELADO' : 'EM ABERTO');
    field('ID do Boleto',     inv.id);
    if (bd.linha_digitavel)  field('Linha Digitável', bd.linha_digitavel);
    if (bd.banco)            field('Banco',           bd.banco);
    if (bd.agencia)          field('Agência / Conta', `${bd.agencia} / ${bd.conta}`);
    if (inv.notes)           field('Observações',     inv.notes);

    doc.moveDown();
    doc.fontSize(9).fillColor('#9CA3AF').text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
    doc.end();
  } catch (e) {
    console.error('[ADMIN BOLETO PDF]', e.message);
    res.status(500).json({ error: 'Erro ao gerar PDF.' });
  }
});

// ─── Service Marketplace ─────────────────────────────────────────────────────

// Client: list active services
app.get('/api/services', requireAuth, async (req, res) => {
  try {
    const { data: services } = await sb.from('re_services')
      .select('id,name,description,category,price_cents,features,delivery_days,featured')
      .eq('active', true)
      .order('featured', { ascending: false })
      .order('created_at');
    res.json({ services: services || [] });
  } catch (e) {
    res.json({ services: [] });
  }
});

// Client: get single service
app.get('/api/services/:id', requireAuth, async (req, res) => {
  try {
    const { data: s } = await sb.from('re_services').select('*').eq('id', req.params.id).eq('active', true).single();
    if (!s) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ service: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Client: place an order for a service
app.post('/api/services/:id/order', requireAuth, async (req, res) => {
  try {
    const { data: svc } = await sb.from('re_services').select('*').eq('id', req.params.id).eq('active', true).single();
    if (!svc) return res.status(404).json({ error: 'Serviço não encontrado.' });

    const svcName = svc.name || svc.title || 'Serviço';

    // Create internal invoice
    const { data: inv } = await sb.from('re_invoices').insert({
      user_id:        req.user.id,
      description:    `Serviço: ${svcName}`,
      amount_cents:   svc.price_cents,
      due_date:       new Date(Date.now() + 3*86400000).toISOString().split('T')[0],
      status:         'pending',
      payment_method: 'boleto',
      created_by:     null,
    }).select().single();

    // Create order referencing the invoice
    const { data: order, error: orderErr } = await sb.from('re_service_orders').insert({
      user_id:        req.user.id,
      service_id:     svc.id,
      amount_cents:   svc.price_cents,
      status:         'pending_payment',
      payment_method: 'boleto',
      invoice_id:     inv?.id || null,
      contracted_at:  new Date().toISOString(),
    }).select().single();
    if (orderErr) return res.status(500).json({ error: orderErr.message });

    // Auto-assign journey if the service has one linked
    if (svc.journey_id) {
      sb.from('re_journey_assignments').upsert({
        journey_id:  svc.journey_id,
        user_id:     req.user.id,
        assigned_by: null,
        status:      'active',
        notes:       `Atribuído automaticamente pela contratação do serviço "${svcName}"`,
      }, { onConflict: 'journey_id,user_id' }).then(() => {}).catch(e => console.warn('[async journey assign]', e?.message));
    }

    pushNotification(req.user.id, 'service', 'Pedido recebido!',
      `Seu pedido para "${svcName}" foi registrado. Aguarde o boleto.`,
      'service_order', order?.id).catch(e => console.warn('[async]', e?.message));

    res.json({ success: true, order, invoice: inv });
  } catch (e) {
    console.error('[SERVICE ORDER]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Client: list own orders
app.get('/api/service-orders', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await sb.from('re_service_orders')
      .select('*,re_services(name,category)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    res.json({ orders: orders || [] });
  } catch (e) { res.json({ orders: [] }); }
});

// Admin: list all services (including inactive)
app.get('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { data: services, error } = await selectWithColumnFallback('re_services', {
      columns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
      requiredColumns: ['id'],
      orderBy: ['created_at', 'id'],
    });
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by'])) {
        console.warn('[ADMIN SERVICES] returning empty list due to schema mismatch:', error.message);
        return res.json({ services: [] });
      }
      throw error;
    }
    res.json({ services: services || [] });
  } catch (e) { res.json({ services: [] }); }
});

// Admin: create service
app.post('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { name, description, category, price_cents, delivery_days, features, featured, journey_id } = req.body;
    if (!name || !price_cents) return res.status(400).json({ error: 'name e price_cents são obrigatórios.' });
    const parsedPriceCents = parseInt(price_cents, 10);
    const parsedPrice = parsedPriceCents / 100;
    const basePayload = {
      name, title: name,
      description, category,
      price_cents: parsedPriceCents,
      price: parsedPrice,
      delivery_days: delivery_days || null,
      features: features || null,
      featured: featured || false,
      journey_id: journey_id || null,
      active: true,
      created_by: req.user.id,
    };
    const cleanPayload = (payload) => Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    const serviceReturningColumns = ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'];
    const serviceInsertAttempts = [
      {
        payload: basePayload,
        requiredColumns: ['name', 'price_cents', 'active'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      },
      {
        payload: { ...basePayload, category: null, journey_id: null, created_by: null },
        requiredColumns: ['name', 'price_cents', 'active'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      },
      {
        payload: { ...basePayload, active: undefined, category: null, journey_id: null, created_by: null },
        requiredColumns: ['name', 'price_cents'],
        requiredReturningColumns: ['id', 'name', 'price_cents'],
      },
      {
        payload: { title: name, description, price_cents: parsedPriceCents, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['title', 'price_cents'],
        requiredReturningColumns: ['id', 'title', 'price_cents'],
      },
      {
        payload: { title: name, description, price: parsedPrice, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['title', 'price'],
        requiredReturningColumns: ['id', 'title', 'price'],
      },
      {
        payload: { name, description, price: parsedPrice, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['name', 'price'],
        requiredReturningColumns: ['id', 'name', 'price'],
      },
    ];

    let insertResult = null;
    for (const attempt of serviceInsertAttempts) {
      insertResult = await insertWithColumnFallback('re_services', cleanPayload(attempt.payload), {
        requiredColumns: attempt.requiredColumns,
        returningColumns: serviceReturningColumns,
        requiredReturningColumns: attempt.requiredReturningColumns,
      });
      if (!insertResult.error) break;
    }

    const { data: rawService, error } = insertResult;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by'])) {
        return res.status(503).json({
          error: 'Serviços temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/services', error, serviceInsertAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }
    const svc = {
      ...rawService,
      name: rawService?.name || rawService?.title || name,
      title: rawService?.title || rawService?.name || name,
      price_cents: rawService?.price_cents ?? parsedPriceCents,
      price: rawService?.price ?? parsedPrice,
      active: rawService?.active ?? true,
      description: rawService?.description ?? description ?? null,
      category: rawService?.category ?? category ?? null,
      featured: rawService?.featured ?? !!featured,
      journey_id: rawService?.journey_id ?? journey_id ?? null,
    };
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'service', entityId: svc.id, action: 'create', after: { name, price_cents } }).catch(e => console.warn('[async]', e?.message));
    res.json({ success: true, service: svc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: update service
app.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const { active, name, description, price_cents, category, featured, journey_id } = req.body;
    const updates = {};
    if (active      !== undefined) updates.active      = active;
    if (name        !== undefined) { updates.name = name; updates.title = name; }
    if (description !== undefined) updates.description = description;
    if (price_cents !== undefined) { updates.price_cents = parseInt(price_cents); updates.price = parseInt(price_cents) / 100; }
    if (category    !== undefined) updates.category    = category;
    if (featured    !== undefined) updates.featured    = featured;
    if (journey_id  !== undefined) updates.journey_id  = journey_id || null;
    let updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, updates, {
      returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
      requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
    });
    if (updateResult.error && category !== undefined && /invalid input value.*category|violates .*category/i.test(String(updateResult.error.message || ''))) {
      const retryUpdates = { ...updates, category: null };
      updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, retryUpdates, {
        returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      });
    }
    if (updateResult.error && journey_id !== undefined && /journey_id/i.test(String(updateResult.error.message || ''))) {
      const retryUpdates = { ...updates, journey_id: null };
      updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, retryUpdates, {
        returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      });
    }
    const { data: svc, error } = updateResult;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'featured', 'journey_id', 'active'])) {
        return res.status(503).json({ error: 'Serviços temporariamente indisponíveis até concluir a atualização do banco.' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true, service: svc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: list all service orders
app.get('/api/admin/service-orders', requireAdmin, async (req, res) => {
  try {
    const { data: orders } = await sb.from('re_service_orders')
      .select('*,re_users!re_service_orders_user_id_fkey(name,email),re_services(name,category)')
      .order('created_at', { ascending: false })
      .limit(200);
    res.json({ orders: orders || [] });
  } catch (e) { res.json({ orders: [] }); }
});

// Admin: update order status
app.put('/api/admin/service-orders/:id', requireAdmin, async (req, res) => {
  try {
    const { status, admin_notes, delivered_at } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (status       !== undefined) updates.status       = status;
    if (admin_notes  !== undefined) updates.admin_notes  = admin_notes;
    if (delivered_at !== undefined) updates.delivered_at = delivered_at;
    if (status === 'active')    updates.activated_at  = new Date().toISOString();
    if (status === 'delivered') updates.completed_at  = new Date().toISOString();
    if (status === 'cancelled') updates.cancelled_at  = new Date().toISOString();

    const { data: order, error } = await sb.from('re_service_orders')
      .update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Load service info for notifications + journey
    const { data: o } = await sb.from('re_service_orders')
      .select('user_id,re_services(id,name,title,journey_id)')
      .eq('id', req.params.id).single();
    const svcName = o?.re_services?.name || o?.re_services?.title || 'Serviço';

    // On activation: auto-assign journey if service has one
    if (status === 'active' && o?.re_services?.journey_id && o?.user_id) {
      sb.from('re_journey_assignments').upsert({
        journey_id:  o.re_services.journey_id,
        user_id:     o.user_id,
        assigned_by: req.user.id,
        status:      'active',
        notes:       `Ativado pelo consultor via pedido de serviço "${svcName}"`,
      }, { onConflict: 'journey_id,user_id' }).then(() => {}).catch(e => console.warn('[async journey assign]', e?.message));
    }

    // Notify client on key status changes
    if (status === 'active') {
      pushNotification(o?.user_id, 'service', 'Serviço ativo!',
        `"${svcName}" foi ativado. Acesse Jornadas para ver as etapas.`,
        'service_order', req.params.id).catch(e => console.warn('[async]', e?.message));
    }
    if (status === 'delivered') {
      pushNotification(o?.user_id, 'service', 'Serviço entregue!',
        `"${svcName}" foi concluído e entregue.`,
        'service_order', req.params.id).catch(e => console.warn('[async]', e?.message));
    }
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Audit Log ───────────────────────────────────────────────────────────────
app.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const { entity_type, actor_id, from, to, limit = '50', offset = '0' } = req.query;
    let q = sb.from('re_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (entity_type) q = q.eq('entity_type', entity_type);
    if (actor_id)    q = q.eq('actor_id', actor_id);
    if (from)        q = q.gte('created_at', from);
    if (to)          q = q.lte('created_at', to);
    const { data: rows } = await q;
    res.json({ entries: rows || [] });
  } catch (e) {
    console.error('[AUDIT LOG GET]', e.message);
    res.json({ entries: [] });
  }
});

// Audit log export CSV (sem paginação — retorna até 10.000 registros)
app.get('/api/admin/audit-log/export', requireAdmin, async (req, res) => {
  try {
    const { entity_type, actor_id, from, to } = req.query;
    let q = sb.from('re_audit_log')
      .select('created_at,actor_id,actor_email,action,entity_type,entity_id,details,before_data,after_data')
      .order('created_at', { ascending: false })
      .limit(10000);
    if (entity_type) q = q.eq('entity_type', entity_type);
    if (actor_id)    q = q.eq('actor_id', actor_id);
    if (from)        q = q.gte('created_at', from);
    if (to)          q = q.lte('created_at', to);
    const { data: rows } = await q;

    const header = ['Data/Hora', 'Actor ID', 'E-mail', 'Ação', 'Entidade', 'Entidade ID', 'Detalhes'];
    const csvRows = (rows || []).map(r => [
      new Date(r.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      r.actor_id   || '',
      r.actor_email|| '',
      r.action     || '',
      r.entity_type|| '',
      r.entity_id  || '',
      r.after_data ? JSON.stringify(r.after_data) : (r.before_data ? JSON.stringify(r.before_data) : ''),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [header.join(','), ...csvRows].join('\r\n');
    const filename = `audit_log_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM para Excel abrir corretamente
  } catch (e) {
    console.error('[AUDIT LOG EXPORT]', e.message);
    res.status(500).json({ error: 'Erro ao exportar log.' });
  }
});

// ─── Booking reminders cron (call daily, e.g. via Render cron job) ───────────
app.post('/api/cron/booking-reminders', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  if (secret !== (process.env.CRON_SECRET || JWT_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Find confirmed bookings starting in the next 23–25 hours, reminder not yet sent
  const from = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  const to   = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

  const { data: slots } = await sb.from('re_agenda_slots')
    .select('id,title,starts_at')
    .gte('starts_at', from)
    .lte('starts_at', to);

  if (!slots?.length) return res.json({ sent: 0 });

  const slotIds = slots.map(s => s.id);
  const { data: bookings } = await sb.from('re_bookings')
    .select('id,user_id,slot_id,reminder_sent')
    .in('slot_id', slotIds)
    .eq('status', 'confirmed')
    .neq('reminder_sent', true);

  if (!bookings?.length) return res.json({ sent: 0 });

  // Also include external_contact bookings (no user_id)
  const { data: extBookings } = await sb.from('re_bookings')
    .select('id,slot_id,external_contact,reminder_sent')
    .in('slot_id', slotIds).eq('status', 'confirmed').neq('reminder_sent', true)
    .is('user_id', null);

  const allBookings = [...(bookings||[]), ...(extBookings||[])];
  if (!allBookings.length) return res.json({ sent: 0 });

  const slotMap = Object.fromEntries(slots.map(s => [s.id, s]));
  let sent = 0;

  for (const booking of allBookings) {
    const slot = slotMap[booking.slot_id];
    if (!slot) continue;

    // Resolve recipient
    let email, name, company;
    if (booking.user_id) {
      const user = await findUserById(booking.user_id);
      if (!user?.email) continue;
      email = user.email; name = user.name || user.email; company = user.company || '';
    } else if (booking.external_contact?.email) {
      email = booking.external_contact.email;
      name  = booking.external_contact.name || email;
      company = booking.external_contact.company || '';
    } else continue;

    const startsAtFmt = new Date(slot.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const meetingLine = slot.meeting_link ? `<p><b>Link:</b> <a href="${slot.meeting_link}">${slot.meeting_link}</a></p>` : '';

    // Reminder to client/contact
    await sendMail(email, '⏰ Lembrete: sessão amanhã — Recupera Empresas', emailWrapper(
      'Lembrete de sessão — amanhã',
      `<p>Olá, <b>${name}</b>!</p>
       <p>Você tem uma sessão agendada para <b>amanhã</b>:</p>
       ${emailFactTable([
         emailFactRow('Sessão', slot.title||'Consultoria'),
         emailFactRow('Data e hora', startsAtFmt),
       ].join(''))}
       ${meetingLine}
       <p ${emailStyle('metaText', 'margin-top:0')}>Em caso de imprevistos, acesse o portal para cancelar com antecedência.</p>`
    )).catch(e => console.warn('[async]', e?.message));

    // Reminder to admin
    sendMail(EMAIL_TO, `⏰ Lembrete: sessão amanhã — ${name}`, emailWrapper(
      'Lembrete de sessão',
      `<p>Lembrete: sessão confirmada para amanhã.</p>
       <p><b>Cliente:</b> ${name}${company ? ' — '+company : ''}<br>
          <b>Sessão:</b> ${slot.title||'Consultoria'}<br>
          <b>Data:</b> ${startsAtFmt}</p>
       ${meetingLine}`
    )).catch(e => console.warn('[async]', e?.message));

    await sb.from('re_bookings').update({ reminder_sent: true }).eq('id', booking.id);
    sent++;
  }

  console.log(`[CRON] booking-reminders: ${sent} enviados`);
  res.json({ sent });
});

// ─── Invoice overdue cron (mark overdue + notify) ─────────────────────────────
app.post('/api/cron/invoice-overdue', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  if (secret !== (process.env.CRON_SECRET || JWT_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const today = new Date().toISOString().split('T')[0];

  // Mark past-due pending invoices as overdue
  const { data: overdueInvs } = await sb.from('re_invoices')
    .select('id,user_id,description,amount_cents,due_date')
    .eq('status', 'pending')
    .lt('due_date', today);

  let marked = 0;
  for (const inv of overdueInvs || []) {
    await sb.from('re_invoices').update({ status: 'overdue' }).eq('id', inv.id);
    const user = await findUserById(inv.user_id);
    if (user?.email) {
      const dueFmt = new Date(inv.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
      const valor  = 'R$ ' + (inv.amount_cents / 100).toFixed(2).replace('.', ',');
      sendMail(user.email, 'Fatura vencida — Recupera Empresas', emailWrapper(
        'Fatura em atraso',
        `<p>Olá, <b>${user.name || user.email}</b>!</p>
         <p>Sua fatura está em atraso:</p>
         ${emailFactTable([
           emailFactRow('Descrição', inv.description),
           emailFactRow('Valor', valor, 'color:#DC2626'),
           emailFactRow('Vencimento', dueFmt),
         ].join(''))}
         <p>Entre em contato com nossa equipe para regularizar.</p>`
      )).catch(e => console.warn('[async]', e?.message));
    }
    marked++;
  }

  // Also notify admin summary
  if (marked > 0) {
    sendMail(EMAIL_TO, `[Financeiro] ${marked} fatura(s) vencida(s) hoje`, emailWrapper(
      'Faturas vencidas',
      `<p>${marked} fatura(s) venceu/venceram hoje (${today}) e foram marcadas como em atraso.</p>`
    )).catch(e => console.warn('[async]', e?.message));
  }

  console.log(`[CRON] invoice-overdue: ${marked} marcadas`);
  res.json({ marked });
});

// ─── Health check (used by Render.com and uptime monitors) ───────────────────
app.get(['/api/health', '/healthz'], (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ─── Startup: seed admin accounts ────────────────────────────────────────────
async function seedAdminAccounts() {
  if (!SUPABASE_SERVICE_KEY) {
    console.warn('[SEED] Pulando seed — VITE_SUPABASE_SERVICE_ROLE não definido.');
    return;
  }
  const defaultPwd = process.env.ADMIN_DEFAULT_PASSWORD || 'RecuperaAdmin@2025';

  for (const email of ADMIN_EMAILS) {
    try {
      // Check if Supabase Auth account already exists
      const { data: listData } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const authUsers   = listData?.users || [];
      let   authUser    = authUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());

      if (!authUser) {
        // Use the native Supabase invite flow so the configured "Invite user"
        // email template is used instead of bypassing auth emails with a
        // pre-confirmed account and shared default password.
        const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
          redirectTo: AUTH_EMAIL_REDIRECTS.inviteUser,
          data: { name: email.split('@')[0], company: 'Recupera Empresas' },
        });
        if (inviteErr) {
          console.warn(`[SEED] Erro Supabase Auth ao convidar ${email}:`, inviteErr.message);
          continue;
        }
        authUser = invited.user;
        console.log(`[SEED] Convite Supabase enviado: ${email}`);
      }

      // Ensure re_users profile exists and is marked as admin
      if (!authUser?.id) continue;
      const existing = await findUserByEmail(email);
      if (!existing) {
        await sb.from('re_users').insert({
          id:       authUser.id,
          name:     authUser.user_metadata?.name || email.split('@')[0],
          email,
          company:  'Recupera Empresas',
          is_admin: true,
        });
        console.log(`[SEED] Perfil admin criado: ${email}`);
      } else {
        const updates = {};
        if (existing.id !== authUser.id) updates.id = authUser.id;
        if (!existing.is_admin)          updates.is_admin = true;
        if (Object.keys(updates).length) {
          if (updates.id) {
            try { await sb.from('re_users').insert({ ...existing, ...updates }); } catch {}
            try { await sb.from('re_users').delete().eq('id', existing.id); } catch {}
          } else {
            await sb.from('re_users').update(updates).eq('id', existing.id);
          }
          console.log(`[SEED] Perfil admin sincronizado: ${email}`);
        }
      }
    } catch (err) {
      console.warn(`[SEED] Erro ao processar ${email}:`, err.message);
    }
  }
}

app.listen(PORT, async () => {
  console.log(`\n  Recupera Empresas — Portal http://localhost:${PORT}`);
  console.log(`  Login:     http://localhost:${PORT}/login.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  Admin:     http://localhost:${PORT}/admin.html\n`);
  await seedAdminAccounts();
});
