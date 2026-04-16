'use strict';
require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
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
const companyMemberRoutes = require('./routes/company-members');
const documentRoutes = require('./routes/documents');
const appointmentRoutes = require('./routes/appointments');
const agendaRoutes = require('./routes/agenda');
const adminAgendaRoutes = require('./routes/admin-agenda');
const supportFinancialRoutes = require('./routes/support-financial');
const formConfigRoutes = require('./routes/form-config');
const formRoutes = require('./routes/forms');
const { adjustCredits } = agendaRoutes;

const {
  PORT,
  JWT_SECRET,
  BASE_URL,
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
} = require('./lib/db');
const { logAccess, auditLog, pushNotification } = require('./lib/logging');
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
app.use(companyMemberRoutes);
app.use(documentRoutes);
app.use(appointmentRoutes);
app.use(agendaRoutes);
app.use(adminAgendaRoutes);
app.use(supportFinancialRoutes);
app.use(formConfigRoutes);
app.use(formRoutes);

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
