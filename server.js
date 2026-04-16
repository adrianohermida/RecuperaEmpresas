'use strict';
require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
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
const auditLogRoutes = require('./routes/audit-log');
const cronRoutes = require('./routes/crons');
const stripeWebhookRoutes = require('./routes/stripe-webhook');
const adminSystemRoutes = require('./routes/admin-system');
const departmentRoutes = require('./routes/departments');
const creditorRoutes = require('./routes/creditors');
const supplierRoutes = require('./routes/suppliers');
const employeeRoutes = require('./routes/employees');
const entityDocumentRoutes = require('./routes/entity-documents');
const dataChangeRequestRoutes = require('./routes/data-change-requests');
const documentRequestRoutes = require('./routes/document-requests');

const {
  PORT,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} = require('./lib/config');
const { seedAdminAccounts } = require('./lib/startup');

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
app.use(auditLogRoutes);
app.use(cronRoutes);
app.use(stripeWebhookRoutes);
app.use(adminSystemRoutes);
app.use(departmentRoutes);
app.use(creditorRoutes);
app.use(supplierRoutes);
app.use(employeeRoutes);
app.use(entityDocumentRoutes);
app.use(dataChangeRequestRoutes);
app.use(documentRequestRoutes);

// ─── Health check (used by Render.com and uptime monitors) ───────────────────
app.get(['/api/health', '/healthz'], (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Return JSON 404 for unmatched API routes instead of serving login HTML
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, async () => {
  console.log(`\n  Recupera Empresas — Portal http://localhost:${PORT}`);
  console.log(`  Login:     http://localhost:${PORT}/login.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  Admin:     http://localhost:${PORT}/admin.html\n`);
  await seedAdminAccounts();
});
