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
const journeyRoutes = require('./routes/journeys');
const notificationRoutes = require('./routes/notifications');
const internalInvoiceRoutes = require('./routes/internal-invoices');
const serviceRoutes = require('./routes/services');
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
app.use(journeyRoutes);
app.use(notificationRoutes);
app.use(internalInvoiceRoutes);
app.use(serviceRoutes);

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
