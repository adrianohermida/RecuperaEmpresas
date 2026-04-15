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
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Supabase DB helpers ──────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const { data } = await sb.from('re_users').select('*')
    .ilike('email', email).limit(1).single();
  return data;
}
async function findUserById(id) {
  const { data } = await sb.from('re_users').select('*').eq('id', id).single();
  return data;
}
async function saveUser(user) {
  const { id, ...fields } = user;
  if (id) {
    await sb.from('re_users').upsert({ id, ...fields });
  } else {
    const { data } = await sb.from('re_users').insert(fields).select().single();
    return data;
  }
  return user;
}

async function readOnboarding(userId) {
  const { data } = await sb.from('re_onboarding').select('*').eq('user_id', userId).single();
  return data || { step: 1, status: 'nao_iniciado', completed: false, data: {} };
}
async function saveOnboarding(userId, payload) {
  const { step, status, completed, data: formData, last_activity, completedAt } = payload;
  await sb.from('re_onboarding').upsert({
    user_id:       userId,
    step:          step       ?? 1,
    status:        status     ?? 'nao_iniciado',
    completed:     completed  ?? false,
    data:          formData   ?? {},
    last_activity: last_activity ?? new Date().toISOString(),
    completed_at:  completedAt   ?? null,
  }, { onConflict: 'user_id' });
}

const PLAN_CHAPTERS = [
  { id: 1, title: 'Sumário Executivo' },
  { id: 2, title: 'Perfil da Empresa' },
  { id: 3, title: 'Análise do Setor e Mercado' },
  { id: 4, title: 'Diagnóstico Financeiro' },
  { id: 5, title: 'Análise de Endividamento' },
  { id: 6, title: 'Plano de Reestruturação Operacional' },
  { id: 7, title: 'Plano Financeiro e Projeções' },
  { id: 8, title: 'Cronograma e Gestão de Riscos' },
];

async function readPlan(userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).order('chapter_id');
  if (rows && rows.length > 0) {
    return { chapters: rows.map(r => ({
      id: r.chapter_id, title: r.title, status: r.status, comments: r.comments || []
    })) };
  }
  return { chapters: PLAN_CHAPTERS.map(c => ({ ...c, status: 'pendente', comments: [] })) };
}
async function saveChapterStatus(userId, chapterId, updates) {
  const chapter = PLAN_CHAPTERS.find(c => c.id === chapterId);
  const title   = chapter?.title || `Capítulo ${chapterId}`;
  await sb.from('re_plan_chapters').upsert({
    user_id: userId, chapter_id: chapterId, title, ...updates
  }, { onConflict: 'user_id,chapter_id' });
}

async function readTasks(userId) {
  const { data } = await sb.from('re_tasks').select('*')
    .eq('user_id', userId).order('created_at');
  return data || [];
}
async function upsertTask(task) {
  await sb.from('re_tasks').upsert(task);
}

async function readMessages(userId) {
  const { data } = await sb.from('re_messages').select('*')
    .eq('user_id', userId).order('ts');
  return data || [];
}
async function insertMessage(msg) {
  const { data } = await sb.from('re_messages').insert(msg).select().single();
  return data;
}

async function readAppointments(userId) {
  const { data } = await sb.from('re_appointments').select('*')
    .eq('user_id', userId).order('date');
  return data || [];
}
async function insertAppointment(appt) {
  const { data } = await sb.from('re_appointments').insert(appt).select().single();
  return data;
}
async function updateAppointment(id, updates) {
  await sb.from('re_appointments').update(updates).eq('id', id);
}

// ─── In-memory stores (reset on restart — sem schema changes no Supabase) ─────
const _calendarEventIds = new Map(); // slotId → googleCalendarEventId
const _adminMsgSeen     = new Map(); // adminId → { clientId: ISO timestamp }

// ─── Google Calendar (service account via REST) ───────────────────────────────
let _gcToken = null, _gcTokenExp = 0;

async function _gcAccessToken() {
  if (_gcToken && Date.now() < _gcTokenExp - 60_000) return _gcToken;
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return null;
  try {
    const now     = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud:  'https://oauth2.googleapis.com/token',
      iat:  now, exp: now + 3600,
    })).toString('base64url');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(GOOGLE_PRIVATE_KEY, 'base64url');
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${sig}` }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    _gcToken = d.access_token; _gcTokenExp = Date.now() + d.expires_in * 1000;
    return _gcToken;
  } catch (e) { console.warn('[GCAL] auth:', e.message); return null; }
}

async function gcCreateEvent({ summary, description, start, end, attendeeEmail }) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const token = await _gcAccessToken();
  if (!token) return null;
  try {
    const body = {
      summary, description: description || '',
      start: { dateTime: start, timeZone: GOOGLE_CALENDAR_TZ },
      end:   { dateTime: end,   timeZone: GOOGLE_CALENDAR_TZ },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }] },
    };
    if (attendeeEmail) body.attendees = [{ email: attendeeEmail }];
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?sendUpdates=all`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) { console.warn('[GCAL] create:', await res.text()); return null; }
    return (await res.json()).id;
  } catch (e) { console.warn('[GCAL] create:', e.message); return null; }
}

async function gcPatchEvent(eventId, patch) {
  if (!GOOGLE_CALENDAR_ID || !eventId) return;
  const token = await _gcAccessToken();
  if (!token) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}?sendUpdates=all`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
  ).catch(e => console.warn('[GCAL] patch:', e.message));
}

async function gcDeleteEvent(eventId) {
  if (!GOOGLE_CALENDAR_ID || !eventId) return;
  const token = await _gcAccessToken();
  if (!token) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  ).catch(e => console.warn('[GCAL] delete:', e.message));
}

async function logAccess(userId, email, event, ip, extra = {}) {
  try {
    await sb.from('re_access_log').insert({
      user_id: userId || null,
      email, event,
      ip: ip || 'unknown',
      step: extra.step || null,
      ts: new Date().toISOString()
    });
  } catch {
    // Access log failures must never break auth flows.
  }
}

// ─── Audit log helper (fire-and-forget, never blocks) ────────────────────────
async function auditLog({ actorId, actorEmail, actorRole, entityType, entityId, action, before, after, ip, notes } = {}) {
  try {
    await sb.from('re_audit_log').insert({
      actor_id:    actorId    || null,
      actor_email: actorEmail || null,
      actor_role:  actorRole  || null,
      entity_type: entityType || 'unknown',
      entity_id:   entityId   ? String(entityId) : null,
      action:      action     || 'unknown',
      before_data: before     || null,
      after_data:  after      || null,
      ip:          ip         || null,
      notes:       notes      || null,
    });
  } catch { /* audit failures must never break primary flows */ }
}

// ─── Notification helper (fire-and-forget) ────────────────────────────────────
async function pushNotification(userId, type, title, body, entityType, entityId) {
  try {
    if (!userId) return;
    await sb.from('re_notifications').insert({
      user_id:     userId,
      type:        type        || 'info',
      title:       title       || '',
      body:        body        || null,
      entity_type: entityType  || null,
      entity_id:   entityId ? String(entityId) : null,
    });
  } catch { /* notification failures must never block primary responses */ }
}

// ─── JWT ──────────────────────────────────────────────────────────────────────
function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token inválido ou expirado.' });

  // Support impersonation token (admin viewing as client)
  if (decoded.impersonating) {
    const target = await findUserById(decoded.targetId);
    if (!target) return res.status(401).json({ error: 'Usuário não encontrado.' });
    req.user = target;
    req.isImpersonating = true;
    req.realAdminId = decoded.adminId;
    return next();
  }

  // Member token: has company_id field — look up in re_company_users
  if (decoded.company_id) {
    const { data: member } = await sb.from('re_company_users')
      .select('id,name,email,role,active,company_id,permissions')
      .eq('id', decoded.id)
      .eq('active', true)
      .single();
    if (!member) return res.status(401).json({ error: 'Membro inativo ou não encontrado.' });
    // Expose company owner id as user.id so all routes read the correct data
    req.user = {
      id:          member.company_id,   // data owner = the company owner
      member_id:   member.id,
      name:        member.name,
      email:       member.email,
      role:        member.role,
      company_id:  member.company_id,
      permissions: member.permissions || {},
      is_admin:    false,
      is_member:   true,
    };
    return next();
  }

  const user = await findUserById(decoded.userId || decoded.id);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token inválido.' });
  const user = await findUserById(decoded.userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  if (!user.is_admin && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  req.user = user;
  next();
}

// ─── Freshdesk ────────────────────────────────────────────────────────────────
function freshdeskRequest(method, endpoint, body) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: FRESHDESK_HOST,
      path: `/api/v2/${endpoint}`,
      method,
      headers: {
        'Authorization': FD_AUTH, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ ok: r.statusCode < 300, status: r.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, data: {} }); }
      });
    });
    req.on('error', () => resolve({ ok: false, data: {} }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
async function createFreshdeskTicket(email, name, company) {
  const result = await freshdeskRequest('POST', 'tickets', {
    subject: `[Onboarding] ${company || name}`,
    description: `<p>Novo cliente iniciou o processo de onboarding.</p>
      <p><b>Nome:</b> ${name}<br/><b>Email:</b> ${email}<br/><b>Empresa:</b> ${company || 'Não informado'}</p>`,
    email, name, priority: 2, status: 2, tags: ['onboarding']
  });
  return (result.ok && result.data.id) ? result.data.id : null;
}
async function createFreshdeskContact(email, name, phone) {
  const find = await freshdeskRequest('GET', `contacts?email=${encodeURIComponent(email)}`, null);
  if (find.ok && Array.isArray(find.data) && find.data.length > 0) return find.data[0].id;
  const result = await freshdeskRequest('POST', 'contacts', { name, email, phone: phone || undefined });
  return (result.ok && result.data?.id) ? result.data.id : null;
}
async function addFreshdeskNote(ticketId, htmlBody) {
  if (!ticketId) return;
  await freshdeskRequest('POST', `tickets/${ticketId}/notes`, { body: htmlBody, private: false });
}
async function updateFreshdeskTicket(ticketId, updates) {
  if (!ticketId) return;
  await freshdeskRequest('PUT', `tickets/${ticketId}`, updates);
}

// ─── Resend email ─────────────────────────────────────────────────────────────
async function sendMail(to, subject, html, attachments = []) {
  return new Promise((resolve) => {
    const payload = { from: EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html };
    if (attachments.length) {
      payload.attachments = attachments.map(a => ({
        filename: a.filename,
        content: a.path ? fs.readFileSync(a.path).toString('base64')
                        : Buffer.from(a.content || '').toString('base64')
      }));
    }
    const bodyStr = JSON.stringify(payload);
    const opts = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        if (r.statusCode >= 400) console.error('[MAIL] Resend error:', r.statusCode, data);
        else console.log('[MAIL] Sent:', subject, '→', to);
        resolve();
      });
    });
    req.on('error', e => { console.error('[MAIL] Error:', e.message); resolve(); });
    req.write(bodyStr);
    req.end();
  });
}

// ─── Email templates ──────────────────────────────────────────────────────────
const STEP_TITLES = {
  1:'Consentimento LGPD', 2:'Dados da Empresa', 3:'Sócios',
  4:'Estrutura Operacional', 5:'Quadro de Funcionários', 6:'Ativos',
  7:'Dados Financeiros', 8:'Dívidas e Credores', 9:'Histórico da Crise',
  10:'Diagnóstico Estratégico', 11:'Mercado e Operação',
  12:'Expectativas e Estratégia', 13:'Documentos', 14:'Confirmação'
};

function emailWrapper(title, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Recupera Empresas</h1>
      <p style="color:#94A3B8;margin:4px 0 0;font-size:13px;">${title}</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">${body}</div>
    <div style="margin-top:10px;padding:10px 16px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;text-align:center;">
      © 2025 Recupera Empresas · <a href="mailto:contato@recuperaempresas.com.br" style="color:#1A56DB;">contato@recuperaempresas.com.br</a>
    </div>
  </div>`;
}

function buildClientStepConfirmHtml(stepNum, user, ts) {
  const total = 14;
  const pct   = Math.round((stepNum / total) * 100);
  const name  = user.name || user.full_name || '';
  return emailWrapper(`Etapa ${stepNum} concluída — Onboarding`, `
    <p>Olá, <b>${name}</b>!</p>
    <p>Recebemos as informações da <b>Etapa ${stepNum} de ${total} — ${STEP_TITLES[stepNum]}</b>.</p>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin:16px 0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;font-weight:800;color:#1A56DB;">${pct}%</div>
        <div>
          <div style="font-weight:700;color:#1E40AF;">Progresso do onboarding</div>
          <div style="font-size:13px;color:#3B82F6;">${stepNum} de ${total} etapas concluídas</div>
        </div>
      </div>
      <div style="background:#DBEAFE;border-radius:4px;height:6px;margin-top:12px;">
        <div style="background:#1A56DB;border-radius:4px;height:6px;width:${pct}%;"></div>
      </div>
    </div>
    ${stepNum < 14
      ? `<p style="text-align:center;margin:20px 0;">
          <a href="${BASE_URL}/dashboard.html" style="background:#1A56DB;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Acessar o Portal</a>
         </p>`
      : `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#065F46;font-weight:700;">Onboarding concluído!</p>
          <p style="margin:4px 0 0;font-size:13px;color:#047857;">Nossa equipe iniciará a análise e elaboração do Business Plan em até 2 dias úteis.</p>
         </div>`
    }
    <p style="color:#64748B;font-size:13px;margin-top:16px;">Dúvidas? <a href="mailto:contato@recuperaempresas.com.br" style="color:#1A56DB;">contato@recuperaempresas.com.br</a></p>
    <p style="font-size:12px;color:#94A3B8;">Enviado em ${ts}</p>
  `);
}

function buildStepHtml(stepNum, allData, user, timestamp) {
  const s  = v => v || '<em>não informado</em>';
  const yn = v => v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : s(v);
  const row = (k, v) => `<tr>
    <td style="padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:38%;font-weight:600;font-size:13px;color:#334155;">${k}</td>
    <td style="padding:6px 12px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${v}</td></tr>`;
  const tbl = rows => `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${rows}</table>`;

  const empresa  = allData.empresa || {};
  const userName = user.name || user.full_name || user.email || '';
  let body = `
  <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
    <div style="background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Recupera Empresas — Onboarding</h1>
      <p style="color:#94A3B8;margin:4px 0 0;font-size:13px;">Etapa ${stepNum} concluída: ${STEP_TITLES[stepNum] || ''}</p>
    </div>
    <div style="background:#EFF6FF;padding:12px 24px;border-bottom:1px solid #BFDBFE;">
      <b style="font-size:13px;color:#1E40AF;">Cliente:</b>
      <span style="font-size:13px;color:#1E3A5F;"> ${userName} — ${empresa.razaoSocial || user.company || 'empresa'} &lt;${user.email}&gt;</span>
      <span style="float:right;font-size:12px;color:#64748B;">${timestamp}</span>
    </div>
    <div style="background:#fff;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;">`;

  const D = allData;
  if (stepNum === 1)  body += tbl(row('Consentimento LGPD', D.lgpd?.concordo ? 'Aceito' : 'Nao aceito'));
  if (stepNum === 2) {
    const e = D.empresa || {};
    body += tbl([row('Razão Social',s(e.razaoSocial)),row('Nome Fantasia',s(e.nomeFantasia)),
      row('CNPJ',s(e.cnpj)),row('Endereço',s(e.endereco)),
      row('Cidade/UF',`${s(e.cidade)} / ${s(e.estado)}`),row('CEP',s(e.cep)),
      row('E-mail',s(e.email)),row('Telefone',s(e.telefone))].join(''));
  }
  if (stepNum === 3) {
    (D.socios||[]).forEach((sc,i) => {
      body += `<p style="font-weight:700;color:#1A56DB;margin:12px 0 6px;">Sócio ${i+1}</p>`;
      body += tbl([row('Nome',s(sc.nome)),row('CPF',s(sc.cpf)),row('Data Nasc.',s(sc.dataNascimento)),
        row('Endereço',s(sc.endereco)),row('E-mail',s(sc.email)),row('Telefone',s(sc.telefone)),
        row('Participação',sc.participacao?`${sc.participacao}%`:'não informado'),row('Cargo',s(sc.cargo))].join(''));
    });
  }
  if (stepNum === 4) {
    const o = D.operacional||{};
    body += tbl([row('Ramo de Atividade',s(o.ramoAtividade)),row('Atividade Principal',s(o.atividadePrincipal)),
      row('Tempo de Operação',s(o.tempoOperacao)),row('Qtd. Unidades',s(o.quantidadeUnidades)),
      row('Possui Filiais',yn(o.possuiFiliais)),row('Descrição',s(o.descricaoOperacao))].join(''));
  }
  if (stepNum === 5) {
    const f = D.funcionarios||{};
    body += tbl([row('Total',s(f.total)),row('Administrativo',s(f.administrativo)),
      row('Operacional',s(f.operacional)),row('Comercial',s(f.comercial)),
      row('Folha em Atraso',yn(f.folhaEmAtraso)),row('Ações Trabalhistas',yn(f.acoesTrabalhistasAndamento)),
      row('Demissões Recentes',yn(f.demissoesRecentes)),row('Detalhe',s(f.detalheDemissoes))].join(''));
  }
  if (stepNum === 6) {
    const a = D.ativos||{};
    body += tbl([row('Possui Ativos',yn(a.possuiAtivos)),row('Descrição',s(a.descricaoAtivos)),
      row('Estimativa de Valor',s(a.estimativaValor)),row('Financiados/Alienados',yn(a.ativosFinanciadosAliendados)),
      row('Ociosos',yn(a.ativosOciosos)),row('Desc. Ociosos',s(a.descricaoAtivosOciosos))].join(''));
  }
  if (stepNum === 7) {
    const f = D.financeiro||{};
    body += tbl([row('Receita Média Mensal',s(f.receitaMediaMensal)),row('Fontes de Receita',s(f.principaisFontesReceita)),
      row('Custos Fixos',s(f.custosFixosMensais)),row('Custos Variáveis',s(f.custosVariaveis)),
      row('Principais Despesas',s(f.principaisDespesas)),row('Controle Financeiro',yn(f.possuiControleFinanceiro)),
      row('Sistema de Controle',s(f.sistemaControle))].join(''));
  }
  if (stepNum === 8) {
    (D.dividas||[]).forEach((d,i) => {
      body += `<p style="font-weight:700;color:#1A56DB;margin:12px 0 6px;">Dívida ${i+1}</p>`;
      body += tbl([row('Credor',s(d.nomeCredor)),row('Tipo',s(d.tipoDivida)),
        row('Valor Original',s(d.valorOriginal)),row('Saldo Atual',s(d.saldoAtual)),
        row('Garantia',yn(d.possuiGarantia)),row('Judicializada',yn(d.estaJudicializada)),
        row('Nº Processo',s(d.numeroProcesso))].join(''));
    });
  }
  if (stepNum === 9) {
    const c = D.crise||{};
    body += tbl([row('Início das Dificuldades',s(c.inicioDificuldades)),
      row('Principais Eventos',s(c.principaisEventos)),
      row('Causas',Array.isArray(c.causasCrise)?c.causasCrise.join(', '):s(c.causasCrise)),
      row('Eventos 24 meses',Array.isArray(c.eventos24m)?c.eventos24m.join(', '):s(c.eventos24m)),
      row('Tentou Reestruturação',yn(c.tentouReestruturacao)),
      row('Descrição Reestruturação',s(c.descricaoReestruturacao))].join(''));
  }
  if (stepNum === 10) {
    const d = D.diagnostico||{};
    body += tbl([row('Principal Problema',s(d.principalProblema)),
      row('Áreas Críticas',Array.isArray(d.areasCriticas)?d.areasCriticas.join(', '):s(d.areasCriticas)),
      row('O que Funciona Bem',s(d.oqueFuncionaBem)),row('Unidade Lucrativa',yn(d.existeUnidadeLucrativa)),
      row('Descrição Unidade',s(d.descricaoUnidade)),row('Deve ser Encerrado',s(d.deveSerEncerrado))].join(''));
  }
  if (stepNum === 11) {
    const m = D.mercado||{};
    body += tbl([row('Principais Clientes',s(m.principaisClientes)),row('Concentração de Receita',yn(m.concentracaoReceita)),
      row('Dependência de Contratos',yn(m.dependenciaContratos)),row('Demanda do Mercado',s(m.demandaMercado)),
      row('Potencial de Crescimento',yn(m.potencialCrescimento)),row('Desc. Potencial',s(m.descricaoPotencial))].join(''));
  }
  if (stepNum === 12) {
    const e = D.expectativas||{};
    body += tbl([row('Objetivo com o Plano',Array.isArray(e.objetivoPlano)?e.objetivoPlano.join(', '):s(e.objetivoPlano)),
      row('Disposto a',Array.isArray(e.dispostoA)?e.dispostoA.join(', '):s(e.dispostoA)),
      row('Interesse em RJ',s(e.interesseRJ))].join(''));
  }
  if (stepNum === 13) body += `<p style="color:#64748b;">Documentos anexados — verificar e-mail de envio final.</p>`;
  if (stepNum === 14) {
    const r = D.responsavel||{};
    body += tbl([row('Nome',s(r.nome)),row('Cargo',s(r.cargo)),row('E-mail',s(r.email)),row('Telefone',s(r.telefone)),
      row('Declaração',D.confirmacao?.declaro?'Confirmada':'Nao confirmada')].join(''));
  }
  body += `</div>
    <div style="margin-top:12px;padding:10px 16px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;">
      Gerado em ${timestamp} via Portal de Onboarding — Recupera Empresas
    </div>
  </div>`;
  return body;
}

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
`);
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

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: find or create re_users profile from a Supabase Auth user ────────
async function upsertProfileFromAuth(authUser, extra = {}) {
  const email   = authUser.email;
  const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

  // Try to find by Supabase Auth UUID first (id column), then by email
  let { data: profile } = await sb.from('re_users').select('*').eq('id', authUser.id).single();
  if (!profile) {
    ({ data: profile } = await sb.from('re_users').select('*').ilike('email', email).limit(1).single());
  }

  if (profile) {
    // Sync id + admin flag if needed
    const updates = {};
    if (profile.id !== authUser.id) updates.id = authUser.id;
    if (!profile.is_admin && isAdmin) updates.is_admin = true;
    if (Object.keys(updates).length) {
      if (updates.id) {
        // id changed — insert new row then delete old
        try { await sb.from('re_users').insert({ ...profile, ...updates }); } catch {}
        try { await sb.from('re_users').delete().eq('id', profile.id); } catch {}
      } else {
        await sb.from('re_users').update(updates).eq('id', profile.id);
      }
      profile = { ...profile, ...updates };
    }
    return profile;
  }

  // Create new profile
  const name    = extra.name || authUser.user_metadata?.name || email.split('@')[0];
  const company = extra.company || authUser.user_metadata?.company || '';
  const { data: newProfile, error } = await sb.from('re_users').insert({
    id:       authUser.id,
    email,
    name,
    company,
    is_admin: isAdmin,
  }).select().single();
  if (error) throw error;
  return newProfile;
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, company, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });

    // Create Supabase Auth account
    const { data: authData, error: signUpErr } = await sbAnon.auth.signUp({
      email, password,
      options: {
        data: { name, company: company || '' },
        emailRedirectTo: AUTH_EMAIL_REDIRECTS.confirmSignUp,
      }
    });
    if (signUpErr) {
      if (signUpErr.message?.toLowerCase().includes('already registered') ||
          signUpErr.message?.toLowerCase().includes('already been registered') ||
          signUpErr.status === 422) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      }
      throw signUpErr;
    }

    const authUser = authData.user;
    const profile  = await upsertProfileFromAuth(authUser, { name, company: company || '' });

    // Freshdesk contact + ticket (fire and forget)
    Promise.all([
      createFreshdeskContact(email, name),
      createFreshdeskTicket(email, name, company)
    ]).then(async ([contactId, ticketId]) => {
      if (contactId || ticketId) {
        await sb.from('re_users').update({
          freshdesk_contact_id: contactId || null,
          freshdesk_ticket_id:  ticketId  || null,
        }).eq('id', profile.id);
      }
    }).catch(() => {});

    logAccess(profile.id, email, 'register', req.ip);

    // If Supabase requires email confirmation, session is null.
    // Return pending_confirmation so the frontend shows "check your email".
    if (!authData.session) {
      return res.json({ success: true, pending_confirmation: true, email });
    }

    // When email confirmation is disabled in Supabase, the account is already
    // active and we can continue. We intentionally do not send a parallel auth
    // email here so the Supabase templates remain the single source of truth
    // for sign-up / invite / recovery communications.
    const token = signToken({ userId: profile.id, email: profile.email });
    res.json({ success: true, token, user: safeUser(profile) });
  } catch(e) {
    console.error('[REGISTER]', e.message);
    res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });

    // Validate credentials via Supabase Auth
    const { data: authData, error: signInErr } = await sbAnon.auth.signInWithPassword({ email, password });
    if (signInErr || !authData?.user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Look up / create re_users profile
    const profile = await upsertProfileFromAuth(authData.user);

    logAccess(profile.id, email, 'login', req.ip);

    const token = signToken({ userId: profile.id, email: profile.email });

    // Also return the Supabase session so the browser can store it for the
    // OAuth consent page (supabase.auth.oauth.approveAuthorization requires
    // a live Supabase session in localStorage, not just our custom JWT).
    const supabaseSession = authData.session
      ? { access_token: authData.session.access_token, refresh_token: authData.session.refresh_token, expires_at: authData.session.expires_at }
      : null;

    res.json({ success: true, token, user: safeUser(profile), supabase_session: supabaseSession });
  } catch(e) {
    console.error('[LOGIN]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.get('/api/auth/verify', requireAuth, async (req, res) => {
  logAccess(req.user.id, req.user.email, 'verify', req.ip);
  const pub = safeUser(req.user);
  if (req.isImpersonating) pub._impersonating = true;
  res.json({ valid: true, user: pub });
});

app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    // Supabase Auth sends the recovery email with a link pointing to redirectTo
    // The link will contain #access_token=...&type=recovery in the hash fragment
    const resetRedirect = AUTH_EMAIL_REDIRECTS.resetPassword;
    const { error } = await sbAnon.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirect,
    });
    // Always respond success to avoid email enumeration
    if (error) console.warn('[FORGOT]', error.message);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro ao enviar e-mail.' }); }
});

// /api/auth/reset — called by reset-password.html with the Supabase access_token
// from the recovery URL hash fragment.  We validate the token server-side and
// update the password via the Auth admin API so bcrypt is never involved.
app.post('/api/auth/reset', async (req, res) => {
  try {
    const { access_token, refresh_token, password } = req.body;
    if (!access_token || !password) return res.status(400).json({ error: 'Dados inválidos.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres.' });

    // Set session with the recovery tokens
    const { data: sessionData, error: sessionErr } = await sbAnon.auth.setSession({
      access_token,
      refresh_token: refresh_token || access_token,
    });
    if (sessionErr || !sessionData?.user) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }

    // Update password via admin API (service role)
    const userId = sessionData.user.id;
    const { error: updateErr } = await sb.auth.admin.updateUserById(userId, { password });
    if (updateErr) {
      console.error('[RESET]', updateErr.message);
      return res.status(400).json({ error: 'Erro ao atualizar senha. Solicite um novo link.' });
    }

    res.json({ success: true });
  } catch(e) {
    console.error('[RESET]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// /api/auth/confirm — auto-login after user clicks email confirmation / magic-link
// Receives the Supabase access_token from the URL hash fragment and exchanges it for our JWT
app.post('/api/auth/confirm', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Token ausente.' });

    const { data, error } = await sbAnon.auth.setSession({
      access_token,
      refresh_token: refresh_token || access_token,
    });
    if (error || !data?.user) return res.status(401).json({ error: 'Token de confirmação inválido ou expirado.' });

    const profile = await upsertProfileFromAuth(data.user);
    await sbAnon.auth.signOut().catch(() => {}); // clear Supabase session — we use our own JWT
    logAccess(profile.id, profile.email, 'confirm', req.ip);
    const token = signToken({ userId: profile.id, email: profile.email });
    res.json({ success: true, token, user: safeUser(profile) });
  } catch(e) {
    console.error('[CONFIRM]', e.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// /api/auth/resend-confirmation — resend Supabase confirmation email
app.post('/api/auth/resend-confirmation', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });
    await sbAnon.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: AUTH_EMAIL_REDIRECTS.confirmSignUp },
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[RESEND]', e.message);
    res.status(500).json({ error: 'Erro ao reenviar.' });
  }
});

// /api/auth/magic-link — send Supabase magic-link email using the configured
// "Magic link" template in the Supabase dashboard.
app.post('/api/auth/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    const { error } = await sbAnon.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: AUTH_EMAIL_REDIRECTS.magicLink,
      },
    });

    if (error) {
      console.warn('[MAGIC LINK]', error.message);
      return res.status(400).json({ error: 'Não foi possível enviar o magic link.' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[MAGIC LINK]', e.message);
    res.status(500).json({ error: 'Erro ao enviar magic link.' });
  }
});

// /api/admin/invite-user — send Supabase invite email using the configured
// "Invite user" template in the Supabase dashboard.
app.post('/api/admin/invite-user', requireAdmin, async (req, res) => {
  try {
    const { email, name, company } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: AUTH_EMAIL_REDIRECTS.inviteUser,
      data: {
        name: name || email.split('@')[0],
        company: company || '',
      },
    });

    if (error) {
      console.error('[INVITE USER]', error.message);
      return res.status(400).json({ error: 'Não foi possível enviar o convite.' });
    }

    res.json({ success: true, invited: data?.user?.email || email });
  } catch (e) {
    console.error('[INVITE USER]', e.message);
    res.status(500).json({ error: 'Erro ao enviar convite.' });
  }
});

// ─── OAuth PKCE store (in-memory, TTL 10 min) ─────────────────────────────────
const _pkceStore = new Map();
function _pkceClean() {
  const now = Date.now();
  for (const [k, v] of _pkceStore) if (v.exp < now) _pkceStore.delete(k);
}
function _b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _codeVerifier() { return _b64url(crypto.randomBytes(32)); }
function _codeChallenge(v) {
  return _b64url(crypto.createHash('sha256').update(v).digest());
}

// ─── OAuth Start — generates PKCE and redirects to Supabase authorize ──────────
// Use this URL to initiate the OAuth flow instead of calling Supabase directly:
//   https://recuperaempresas.onrender.com/api/auth/oauth/start
// Optional query params: scope (default "openid email profile")
app.get('/api/auth/oauth/start', (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID || '';
  if (!clientId) return res.status(500).send('OAUTH_CLIENT_ID não configurado no Render.');

  // Supabase OAuth Server requires PKCE for ALL clients (public and confidential).
  _pkceClean();
  const verifier  = _codeVerifier();
  const challenge = _codeChallenge(verifier);
  const state     = crypto.randomBytes(16).toString('hex');
  _pkceStore.set(state, { verifier, challenge, exp: Date.now() + 10 * 60 * 1000 });

  // Cookie carries the state through the consent redirect so /api/auth/oauth/decide
  // can look up code_challenge and include it in the Supabase authorize call.
  res.cookie('_oauth_st', state, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          `${BASE_URL}/api/auth/oauth/callback`,
    scope:                 req.query.scope || 'email profile',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`${SUPABASE_URL}/auth/v1/oauth/authorize?${params}`);
});

// ─── OAuth Decide — server proxies the consent decision to Supabase ───────────
// The browser calls GET /api/auth/oauth/decide?authorization_id=...&allow=true
// The server adds client_id from env var (never exposed to the browser this way)
// then redirects to Supabase's authorize endpoint.
app.get('/api/auth/oauth/decide', (req, res) => {
  const clientId        = process.env.OAUTH_CLIENT_ID || '';
  const authorizationId = req.query.authorization_id  || '';
  const allow           = req.query.allow === 'true' ? 'true' : 'false';

  if (!clientId)        return res.status(500).send('OAUTH_CLIENT_ID não configurado no Render.');
  if (!authorizationId) return res.status(400).send('authorization_id ausente.');

  // Retrieve the original code_challenge from the PKCE store via the state cookie.
  // Supabase requires all original PKCE params even on the consent-decision call.
  const state = req.cookies?._oauth_st || '';
  const pkce  = state ? _pkceStore.get(state) : null;

  const params = new URLSearchParams({
    authorization_id: authorizationId,
    client_id:        clientId,
    redirect_uri:     `${BASE_URL}/api/auth/oauth/callback`,
    allow,
  });

  if (pkce?.challenge) {
    params.set('code_challenge',        pkce.challenge);
    params.set('code_challenge_method', 'S256');
  } else {
    console.warn('[OAUTH DECIDE] code_challenge not found — state cookie missing or expired');
  }

  res.redirect(`${SUPABASE_URL}/auth/v1/oauth/authorize?${params}`);
});

// ─── OAuth Consent page ────────────────────────────────────────────────────────
app.get('/oauth/consent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'oauth-consent.html'));
});

// ─── OAuth Callback — exchanges code for tokens using stored PKCE verifier ─────
// Registered Redirect URI in Supabase OAuth App:
//   https://recuperaempresas.onrender.com/api/auth/oauth/callback
app.get('/api/auth/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[OAUTH CALLBACK] error:', error, error_description);
    return res.redirect(`/login.html?err=oauth&desc=${encodeURIComponent(error_description || error)}`);
  }
  if (!code) return res.redirect('/login.html?err=oauth&desc=no_code');

  const clientId     = process.env.OAUTH_CLIENT_ID     || '';
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
  const pkce         = state ? _pkceStore.get(state) : null;
  if (pkce) _pkceStore.delete(state);

  try {
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: `${BASE_URL}/api/auth/oauth/callback`,
      client_id:    clientId,
    });

    // Supabase requires code_verifier (PKCE) for all clients.
    // Confidential clients also send client_secret alongside it.
    if (pkce?.verifier) {
      body.set('code_verifier', pkce.verifier);
    } else {
      console.error('[OAUTH CALLBACK] PKCE verifier missing (state expired or mismatch)');
      return res.redirect('/login.html?err=oauth&desc=session_expired_retry');
    }
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const tokenRes  = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: SUPABASE_ANON_KEY },
      body,
    });
    const tokenData = await tokenRes.json();
    console.log('[OAUTH CALLBACK] token response:', JSON.stringify(tokenData).slice(0, 200));

    if (!tokenData.access_token) {
      console.error('[OAUTH CALLBACK] token exchange failed:', tokenData);
      return res.redirect('/login.html?err=oauth&desc=' + encodeURIComponent(tokenData.error_description || tokenData.msg || 'token_exchange_failed'));
    }

    const { data } = await sbAnon.auth.setSession({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token || tokenData.access_token,
    });
    if (!data?.user) return res.redirect('/login.html?err=oauth&desc=no_user');

    const profile     = await upsertProfileFromAuth(data.user);
    const portalToken = signToken({ userId: profile.id, email: profile.email });

    // Pass token to browser via hash — login.html will store and redirect
    return res.redirect(
      `/login.html#oauth_token=${encodeURIComponent(portalToken)}&oauth_user=${encodeURIComponent(JSON.stringify(safeUser(profile)))}`
    );
  } catch (e) {
    console.error('[OAUTH CALLBACK]', e.message);
    return res.redirect('/login.html?err=oauth&desc=' + encodeURIComponent(e.message));
  }
});

// ─── Admin: impersonate a client (view portal as client) ──────────────────────
app.post('/api/admin/impersonate/:clientId', requireAdmin, async (req, res) => {
  const target = await findUserById(req.params.clientId);
  if (!target) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (target.is_admin) return res.status(400).json({ error: 'Não é possível impersonar um administrador.' });

  const token = signToken({
    impersonating: true,
    adminId:       req.user.id,
    targetId:      target.id,
    email:         target.email,
    userId:        target.id,  // needed for requireAuth
  });
  res.json({ success: true, token, user: safeUser(target) });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/step-complete', requireAuth, async (req, res) => {
  try {
    const { stepNum, allData } = req.body;
    const user = req.user;
    const ts   = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const progress = await readOnboarding(user.id);
    const newStep  = Math.max(progress.step || 1, stepNum);
    await saveOnboarding(user.id, {
      step:     newStep,
      status:   newStep >= 14 ? 'concluido' : 'em_andamento',
      data:     allData,
      last_activity: new Date().toISOString(),
      completed: progress.completed || false,
    });

    const empresa  = allData.empresa || {};
    const stepHtml = buildStepHtml(stepNum, allData, user, ts);
    const subject  = `[Onboarding] ${empresa.razaoSocial||user.company||user.name||user.email} — Etapa ${stepNum}: ${STEP_TITLES[stepNum]||''}`;

    // Email to company (internal) + client confirmation — parallel
    await Promise.all([
      sendMail(EMAIL_TO, subject, stepHtml),
      sendMail(user.email, `Etapa ${stepNum} recebida — Recupera Empresas`, buildClientStepConfirmHtml(stepNum, user, ts)),
    ]);

    // Freshdesk: add public note for every step
    const ticketId = user.freshdesk_ticket_id;
    if (ticketId) {
      const noteHtml = `<h3>Etapa ${stepNum} / 14 — ${STEP_TITLES[stepNum]}</h3>${stepHtml}`;
      addFreshdeskNote(ticketId, noteHtml).catch(() => {});
    }

    logAccess(user.id, user.email, 'step_complete', req.ip, { step: stepNum });
    res.json({ success: true });
  } catch(e) { console.error('[STEP]', e); res.status(500).json({ error: 'Erro ao registrar etapa.' }); }
});

app.get('/api/progress', requireAuth, async (req, res) => {
  res.json(await readOnboarding(req.user.id));
});

// ─── Final submit ─────────────────────────────────────────────────────────────
const fileFields = [
  { name:'balanco',maxCount:5 }, { name:'dre',maxCount:5 },
  { name:'extratos',maxCount:10 }, { name:'contratos',maxCount:10 }
];

app.post('/api/submit', requireAuth, upload.fields(fileFields), async (req, res) => {
  try {
    const user    = req.user;
    const allData = JSON.parse(req.body.formData || '{}');
    const ts      = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const files   = req.files || {};
    const empresa = allData.empresa || {};

    const attachments = [];
    for (const fileList of Object.values(files))
      for (const f of fileList)
        attachments.push({ filename: f.originalname, path: f.path, contentType: f.mimetype });

    await saveOnboarding(user.id, {
      step: 14, status: 'concluido', completed: true,
      data: allData, completedAt: ts, last_activity: new Date().toISOString(),
    });

    // Build full report (all 14 steps)
    let allStepsHtml = '';
    for (let i=1; i<=14; i++) {
      allStepsHtml += `<h2 style="font-size:15px;color:#1A56DB;margin:20px 0 8px;padding-bottom:6px;border-bottom:2px solid #DBEAFE;">
        Etapa ${i} — ${STEP_TITLES[i]}</h2>`;
      allStepsHtml += buildStepHtml(i, allData, user, ts);
    }
    const fullHtml = `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
      <div style="background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:20px;">Onboarding Completo — Recupera Empresas</h1>
        <p style="color:#94A3B8;margin:4px 0 0;font-size:13px;">${empresa.razaoSocial||user.company||user.name||user.email} — ${ts}</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">${allStepsHtml}</div>
    </div>`;

    await Promise.all([
      sendMail(EMAIL_TO,
        `[Onboarding COMPLETO] ${empresa.razaoSocial||user.company||user.name||user.email} — ${new Date().toLocaleDateString('pt-BR')}`,
        fullHtml, attachments
      ),
      sendMail(user.email, 'Onboarding concluído — Recupera Empresas', buildClientStepConfirmHtml(14, user, ts)),
    ]);

    // Freshdesk: final note + resolve ticket
    const ticketId = user.freshdesk_ticket_id;
    if (ticketId) {
      await addFreshdeskNote(ticketId,
        `<h3>Onboarding concluído em ${ts}</h3><p>Todos os dados foram enviados. Relatório completo segue por e-mail.</p>${fullHtml}`
      ).catch(() => {});
      await updateFreshdeskTicket(ticketId, { status: 4 }).catch(() => {});
    }

    for (const fileList of Object.values(files))
      for (const f of fileList) fs.unlink(f.path, () => {});

    logAccess(user.id, user.email, 'submit', req.ip);
    res.json({ success: true, message: 'Formulário enviado com sucesso.' });
  } catch(e) {
    console.error('[SUBMIT]', e);
    res.status(500).json({ success: false, message: 'Erro ao enviar formulário.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/plan', requireAuth, async (req, res) => {
  res.json(await readPlan(req.user.id));
});

app.put('/api/plan/chapter/:id', requireAuth, async (req, res) => {
  const { clientAction, comment } = req.body;
  const chapterId = parseInt(req.params.id);
  const plan = await readPlan(req.user.id);
  const chapter = plan.chapters.find(c => c.id === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Capítulo não encontrado.' });

  const updates = {};
  if (clientAction) updates.client_action = clientAction;
  if (comment) {
    const comments = [...(chapter.comments || []), {
      text: comment, from: 'client', fromName: req.user.name || req.user.email,
      ts: new Date().toISOString()
    }];
    updates.comments = comments;
  }
  await saveChapterStatus(req.user.id, chapterId, updates);
  res.json({ success: true });
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  res.json({ tasks: await readTasks(req.user.id) });
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  if (req.body.status) {
    await sb.from('re_tasks').update({ status: req.body.status }).eq('id', req.params.id).eq('user_id', req.user.id);
  }
  res.json({ success: true });
});

app.get('/api/messages', requireAuth, async (req, res) => {
  res.json({ messages: await readMessages(req.user.id) });
});

app.post('/api/messages', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  const msg = await insertMessage({
    user_id:   req.user.id,
    from_role: 'client',
    from_name: req.user.name || req.user.email,
    text:      text.trim(),
  });
  // Notify admin users that a client sent a message
  const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(20);
  for (const admin of (admins || [])) {
    pushNotification(admin.id, 'message', 'Nova mensagem de cliente',
      `${req.user.name || req.user.email}: ${text.trim().slice(0, 80)}`,
      'message', req.user.id).catch(() => {});
  }
  res.json({ success: true, message: msg });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/clients', requireAdmin, async (req, res) => {
  const { data: users } = await sb.from('re_users').select('*')
    .eq('is_admin', false).order('created_at', { ascending: false });

  const clients = await Promise.all((users || []).map(async u => {
    const [ob, tasks] = await Promise.all([readOnboarding(u.id), readTasks(u.id)]);
    return {
      id: u.id, name: u.name || '', email: u.email, company: u.company || '',
      createdAt: u.created_at, freshdeskTicketId: u.freshdesk_ticket_id,
      step: ob.step || 1, status: ob.status || 'nao_iniciado',
      completed: ob.completed || false,
      progress: Math.round(((ob.step || 1) - 1) / 14 * 100),
      lastActivity: ob.last_activity || u.created_at,
      pendingTasks: tasks.filter(t => t.status === 'pendente').length
    };
  }));

  res.json({ clients });
});

app.get('/api/admin/client/:id', requireAdmin, async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const [onboarding, tasks, plan, messages, appointments] = await Promise.all([
    readOnboarding(user.id),
    readTasks(user.id),
    readPlan(user.id),
    readMessages(user.id),
    readAppointments(user.id),
  ]);

  res.json({
    user: safeUser(user),
    onboarding,
    tasks,
    plan,
    messages,
    appointments,
  });
});

app.post('/api/admin/client/:id/task', requireAdmin, async (req, res) => {
  const { title, description, dueDate } = req.body;
  if (!title) return res.status(400).json({ error: 'Título obrigatório.' });

  const target = await findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const { data: task } = await sb.from('re_tasks').insert({
    user_id:     req.params.id,
    title,
    description: description || '',
    due_date:    dueDate || null,
    status:      'pendente',
    created_by:  req.user.id,
  }).select().single();

  // Notify client about new task (fire-and-forget)
  pushNotification(req.params.id, 'task', 'Nova tarefa atribuída',
    title + (description ? ': ' + description.slice(0, 60) : ''),
    'task', task?.id).catch(() => {});

  // Audit log
  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'task', entityId: task?.id, action: 'create',
    after: { user_id: req.params.id, title, status: 'pendente' } }).catch(() => {});

  res.json({ success: true, task });
});

app.put('/api/admin/client/:id/plan/chapter/:chapterId', requireAdmin, async (req, res) => {
  const { status, content } = req.body;
  const updates = {};
  if (status  !== undefined) updates.status  = status;
  if (content !== undefined) updates.content = content;
  await saveChapterStatus(req.params.id, parseInt(req.params.chapterId), updates);

  // Notify client on chapter status change
  if (status) {
    const chap   = PLAN_CHAPTERS.find(c => c.id === parseInt(req.params.chapterId));
    const stLbl  = status === 'aprovado' ? 'aprovado ✅' : status === 'revisao' ? 'em revisão 🔄' : 'atualizado';
    pushNotification(req.params.id, 'plan', `Business Plan: capítulo ${stLbl}`,
      chap ? '"' + chap.title + '"' : 'Capítulo ' + req.params.chapterId,
      'plan_chapter', req.params.chapterId).catch(() => {});
  }

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'plan_chapter', entityId: req.params.id + ':' + req.params.chapterId,
    action: 'update', after: updates }).catch(() => {});

  res.json({ success: true });
});

app.post('/api/admin/client/:id/message', requireAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  const msg = await insertMessage({
    user_id:   req.params.id,
    from_role: 'admin',
    from_name: req.user.name || req.user.email,
    text:      text.trim(),
  });

  // Notify client about new message from consultant
  pushNotification(req.params.id, 'message', 'Nova mensagem do consultor',
    text.trim().slice(0, 100), 'message', req.params.id).catch(() => {});

  res.json({ success: true, message: msg });
});

// ─── Admin: XLS export ────────────────────────────────────────────────────────
app.get('/api/admin/client/:id/export/xlsx', requireAdmin, async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const [onboarding] = await Promise.all([ readOnboarding(user.id) ]);
  const d = onboarding.data || {};

  const wb = XLSX.utils.book_new();

  // Helper: object → sheet rows
  function objToRows(obj, prefix = '') {
    const rows = [];
    if (!obj || typeof obj !== 'object') return rows;
    Object.entries(obj).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'object') {
            objToRows(item, `${prefix}${k}[${i+1}].`).forEach(r => rows.push(r));
          } else {
            rows.push([`${prefix}${k}[${i+1}]`, String(item)]);
          }
        });
      } else if (v && typeof v === 'object') {
        objToRows(v, `${prefix}${k}.`).forEach(r => rows.push(r));
      } else {
        rows.push([`${prefix}${k}`, v !== null && v !== undefined ? String(v) : '']);
      }
    });
    return rows;
  }

  // Sheet 1: Empresa
  const empRows = [['Campo', 'Valor'], ...objToRows(d.empresa || {})];
  const wsEmp = XLSX.utils.aoa_to_sheet(empRows);
  wsEmp['!cols'] = [{ wch: 35 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsEmp, 'Empresa');

  // Sheet 2: Sócios
  const socios = Array.isArray(d.socios) ? d.socios : [];
  let socioRows = [['#', 'Nome', 'CPF', 'Data Nasc.', 'E-mail', 'Telefone', 'Participação (%)', 'Cargo']];
  socios.forEach((s, i) => socioRows.push([
    i + 1, s.nome || '', s.cpf || '', s.dataNascimento || '',
    s.email || '', s.telefone || '', s.participacao || '', s.cargo || ''
  ]));
  const wsSocios = XLSX.utils.aoa_to_sheet(socioRows);
  wsSocios['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsSocios, 'Socios');

  // Sheet 3: Financeiro
  const finRows = [['Campo', 'Valor'], ...objToRows(d.financeiro || {})];
  const wsFin = XLSX.utils.aoa_to_sheet(finRows);
  wsFin['!cols'] = [{ wch: 35 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsFin, 'Financeiro');

  // Sheet 4: Dívidas
  const dividas = Array.isArray(d.dividas) ? d.dividas : [];
  let divRows = [['#', 'Credor', 'Tipo', 'Valor Original', 'Saldo Atual', 'Garantia', 'Judicializada', 'Nº Processo']];
  dividas.forEach((dv, i) => divRows.push([
    i + 1, dv.nomeCredor || '', dv.tipoDivida || '',
    dv.valorOriginal || '', dv.saldoAtual || '',
    dv.possuiGarantia || '', dv.estaJudicializada || '', dv.numeroProcesso || ''
  ]));
  const wsDiv = XLSX.utils.aoa_to_sheet(divRows);
  wsDiv['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsDiv, 'Dividas');

  // Sheet 5: Operação
  const opRows = [['Campo', 'Valor'], ...objToRows(d.operacional || {}), ...objToRows(d.funcionarios || {}), ...objToRows(d.ativos || {})];
  const wsOp = XLSX.utils.aoa_to_sheet(opRows);
  wsOp['!cols'] = [{ wch: 35 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsOp, 'Operacao');

  // Sheet 6: Crise + Estratégia
  const criseRows = [['Campo', 'Valor'], ...objToRows(d.crise || {}), ...objToRows(d.diagnostico || {}), ...objToRows(d.mercado || {}), ...objToRows(d.expectativas || {})];
  const wsCrise = XLSX.utils.aoa_to_sheet(criseRows);
  wsCrise['!cols'] = [{ wch: 35 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsCrise, 'Crise_Estrategia');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `recupera_${(user.company || user.name || user.id).replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ─── Admin: PDF export ────────────────────────────────────────────────────────
app.get('/api/admin/client/:id/export/pdf', requireAdmin, async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const [onboarding] = await Promise.all([ readOnboarding(user.id) ]);
  const d  = onboarding.data || {};
  const ob = onboarding;

  // ── Recovery score (same algo as front-end) ──────────────────────────────
  function parseCur(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    return parseFloat(String(v).replace(/[R$\s.]/g,'').replace(',','.')) || 0;
  }
  function calcScore() {
    let s = 50;
    const fin = d.financeiro || {};
    const rec = parseCur(fin.receitaMensalAtual);
    const cst = parseCur(fin.custosMensais);
    if (rec > 0 && cst > 0) {
      const margin = (rec - cst) / rec;
      s += margin > 0.1 ? 12 : margin > 0 ? 6 : -15;
    }
    const dv = Array.isArray(d.dividas) ? d.dividas : [];
    const totalDv = dv.reduce((a,x) => a + parseCur(x.saldoAtual), 0);
    if (rec > 0 && totalDv > 0) {
      const ratio = totalDv / rec;
      s += ratio < 6 ? 10 : ratio < 12 ? 0 : -15;
    }
    const crm = { '1_3_meses': -5, '4_6_meses': -10, '7_12_meses': -15, 'mais_1_ano': -20 };
    s += crm[(d.crise||{}).tempoCrise] || 0;
    const func = d.funcionarios || {};
    const prob = func.problemasRecentes || [];
    if (prob.includes('demissoes_em_massa')) s -= 8;
    else if (prob.includes('reducao_carga')) s -= 5;
    else if (prob.includes('atraso_salarios')) s -= 4;
    if ((d.ativos||{}).possuiBens === 'sim') s += 5;
    const controle = (fin.controleFinanceiro||'');
    s += controle === 'planilha_avancada' || controle === 'sistema' ? 5 : controle === 'nenhum' ? -5 : 0;
    if (ob.completed) s += 8;
    return Math.min(95, Math.max(10, Math.round(s)));
  }
  const score = calcScore();
  const scoreLabel = score >= 70 ? 'Alta' : score >= 45 ? 'Média' : 'Crítica';
  const scoreColor = score >= 70 ? '#16a34a' : score >= 45 ? '#d97706' : '#dc2626';

  const filename = `recupera_${(user.company || user.name || user.id).replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().slice(0,10)}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const W = 595 - 100; // usable width
  const BRAND = '#1e3a5f';
  const GRAY  = '#6b7280';
  const LIGHT = '#f3f4f6';

  function hLine(y) {
    doc.moveTo(50, y || doc.y).lineTo(545, y || doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
  }
  function sectionTitle(title) {
    doc.moveDown(0.6)
       .fontSize(11).fillColor(BRAND).font('Helvetica-Bold').text(title.toUpperCase())
       .moveDown(0.2);
    hLine();
    doc.fillColor('#111827').font('Helvetica').fontSize(9.5);
  }
  function row(label, value) {
    if (!value || value === 'undefined') return;
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).text(label, 50, y, { width: 190, continued: false });
    doc.font('Helvetica').fillColor('#111827').text(String(value), 250, y, { width: 295 });
    doc.moveDown(0.25);
  }
  function subTitle(t) {
    doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text(t).moveDown(0.2);
    doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  doc.rect(50, 50, W, 110).fill(BRAND);
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#ffffff')
     .text('RELATÓRIO EXECUTIVO', 66, 70, { width: W - 30 });
  doc.fontSize(13).font('Helvetica').fillColor('#93c5fd')
     .text('Recuperação Empresarial', 66, 100);
  doc.fontSize(10).fillColor('#bfdbfe')
     .text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, 66, 120);

  // Score box
  doc.rect(380, 60, 115, 80).fill(scoreColor);
  doc.fontSize(30).font('Helvetica-Bold').fillColor('#ffffff')
     .text(`${score}%`, 385, 72, { width: 105, align: 'center' });
  doc.fontSize(9).fillColor('#ffffff')
     .text(`Score: ${scoreLabel}`, 385, 112, { width: 105, align: 'center' });

  doc.y = 175;
  doc.fillColor('#111827').font('Helvetica');

  // ── Identificação ──────────────────────────────────────────────────────────
  sectionTitle('Identificação do Cliente');
  row('Nome', user.name);
  row('E-mail', user.email);
  const emp = d.empresa || {};
  row('Empresa', emp.nomeFantasia || emp.razaoSocial || user.company);
  row('CNPJ', emp.cnpj);
  row('Razão Social', emp.razaoSocial);
  row('Segmento', emp.segmento);
  row('Porte', emp.porte);
  row('Cidade/UF', emp.cidade ? `${emp.cidade} / ${emp.uf || ''}` : undefined);
  row('Status Onboarding', ob.completed ? 'Concluído' : `Em andamento (etapa ${ob.step || 1}/14)`);

  // ── Panorama Financeiro ────────────────────────────────────────────────────
  const fin = d.financeiro || {};
  sectionTitle('Panorama Financeiro');
  row('Receita Mensal Atual', fin.receitaMensalAtual);
  row('Custos Mensais', fin.custosMensais);
  row('Pró-labore', fin.proLabore);
  row('Faturamento 12m', fin.faturamento12meses);
  row('Controle Financeiro', fin.controleFinanceiro);
  row('Regime Tributário', fin.regimeTributario);
  row('Inadimplência', fin.possuiInadimplencia === 'sim' ? `Sim — ${fin.percentualInadimplencia || ''}` : 'Não');
  row('Conta Bancária', fin.possuiContaBancaria);
  row('Limite de Crédito', fin.possuiLimiteCredito);

  // ── Dívidas ────────────────────────────────────────────────────────────────
  const dividas = Array.isArray(d.dividas) ? d.dividas : [];
  if (dividas.length) {
    sectionTitle(`Dívidas (${dividas.length} credor${dividas.length > 1 ? 'es' : ''})`);
    let totalDv = 0;
    dividas.forEach((dv, i) => {
      const sal = parseCur(dv.saldoAtual);
      totalDv += sal;
      subTitle(`${i+1}. ${dv.nomeCredor || 'Credor não informado'}`);
      row('Tipo', dv.tipoDivida);
      row('Valor Original', dv.valorOriginal);
      row('Saldo Atual', dv.saldoAtual);
      row('Garantia', dv.possuiGarantia);
      row('Judicializada', dv.estaJudicializada);
      if (dv.numeroProcesso) row('Nº Processo', dv.numeroProcesso);
    });
    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor(BRAND)
       .text(`Total de dívidas: R$ ${totalDv.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
  }

  // ── Operacional ────────────────────────────────────────────────────────────
  const op = d.operacional || {};
  const func = d.funcionarios || {};
  const ativos = d.ativos || {};
  sectionTitle('Operação');
  row('Funcionários CLT', func.qtdFuncionariosCLT);
  row('Funcionários PJ/Temp.', func.qtdFuncionariosPJ);
  row('Problemas Recentes', Array.isArray(func.problemasRecentes) ? func.problemasRecentes.join(', ') : func.problemasRecentes);
  row('Possui Bens/Ativos', ativos.possuiBens);
  if (ativos.possuiBens === 'sim') {
    row('Tipo de Bens', Array.isArray(ativos.tipoBens) ? ativos.tipoBens.join(', ') : ativos.tipoBens);
    row('Valor Estimado', ativos.valorEstimado);
  }
  row('Modelo de Operação', op.modeloNegocio);
  row('Clientes Principais', op.temClientesPrincipais);

  // ── Crise e Estratégia ────────────────────────────────────────────────────
  if (doc.y > 680) doc.addPage();
  const crise = d.crise || {};
  const diag  = d.diagnostico || {};
  sectionTitle('Crise e Estratégia');
  row('Tempo em Crise', crise.tempoCrise);
  row('Origem da Crise', Array.isArray(crise.causasCrise) ? crise.causasCrise.join(', ') : crise.causasCrise);
  row('Tentativas Anteriores', crise.tentativasAnteriores);
  row('Diagnóstico Principal', diag.principalProblema);
  row('Decisões Urgentes', diag.decisoesUrgentes);
  row('Objetivos 6 meses', (d.expectativas||{}).objetivos6meses);
  row('Maior Receio', (d.expectativas||{}).maiorReceio);

  // ── Sócios ────────────────────────────────────────────────────────────────
  const socios = Array.isArray(d.socios) ? d.socios : [];
  if (socios.length) {
    if (doc.y > 650) doc.addPage();
    sectionTitle(`Sócios (${socios.length})`);
    socios.forEach((s, i) => {
      subTitle(`${i+1}. ${s.nome || 'Sócio não identificado'} — ${s.participacao || '?'}%`);
      row('CPF', s.cpf);
      row('Cargo', s.cargo);
      row('E-mail', s.email);
      row('Telefone', s.telefone);
    });
  }

  // ── Insights Automáticos ──────────────────────────────────────────────────
  if (doc.y > 600) doc.addPage();
  sectionTitle('Insights Automáticos');
  const insights = [];
  const rec = parseCur(fin.receitaMensalAtual), cst = parseCur(fin.custosMensais);
  if (rec > 0 && cst > 0) {
    const mg = ((rec - cst) / rec * 100).toFixed(1);
    insights.push(`Margem operacional estimada: ${mg}% ${parseFloat(mg) < 0 ? '⚠ Custos superam receita' : ''}`);
  }
  const totalDivPdf = dividas.reduce((a,x) => a + parseCur(x.saldoAtual), 0);
  if (totalDivPdf > 0) insights.push(`Endividamento total: R$ ${totalDivPdf.toLocaleString('pt-BR',{minimumFractionDigits:2})}`);
  if (rec > 0 && totalDivPdf > 0) insights.push(`Relação dívida/receita mensal: ${(totalDivPdf/rec).toFixed(1)}x`);
  if (crise.tempoCrise) insights.push(`Empresa em crise há: ${crise.tempoCrise.replace(/_/g,' ')}`);
  if (score >= 70) insights.push('Perfil com bom potencial de recuperação estruturada.');
  else if (score >= 45) insights.push('Situação requer ação imediata em múltiplas frentes.');
  else insights.push('Situação crítica — prioridade máxima de atendimento.');
  insights.forEach(ins => {
    doc.fontSize(9.5).fillColor('#374151').font('Helvetica')
       .text(`• ${ins}`, { indent: 10 }).moveDown(0.15);
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  doc.fontSize(8).fillColor(GRAY)
     .text('Recupera Empresas — Documento confidencial. Uso interno.', 50, 790, { align: 'center', width: W });

  doc.end();
});

// ─── Multi-user companies ─────────────────────────────────────────────────────
// List members of a client company
app.get('/api/company/members', requireAuth, async (req, res) => {
  const companyId = req.user.company_id || req.user.id;
  const { data, error } = await sb.from('re_company_users')
    .select('id,name,email,role,active,invited_at,last_login')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
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
  const { data: existing } = await sb.from('re_company_users')
    .select('id').eq('company_id', companyId).eq('email', email.toLowerCase()).single();
  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa.' });

  const hash = await bcrypt.hash(password, 10);
  const { data: member, error } = await sb.from('re_company_users').insert({
    company_id:    companyId,
    name:          name.trim(),
    email:         email.toLowerCase().trim(),
    role:          role || 'operacional',
    password_hash: hash,
  }).select('id,name,email,role,active,invited_at').single();

  if (error) return res.status(500).json({ error: error.message });
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
  await sb.from('re_company_users').update({ last_login: new Date().toISOString() }).eq('id', member.id);

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
  const { data, error } = await sb.from('re_company_users')
    .select('id,name,email,role,active,invited_at,last_login')
    .eq('company_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
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
    .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings')
    .gte('starts_at', from)
    .order('starts_at', { ascending: true })
    .limit(60);

  // Count bookings per slot
  const slotIds = (slots||[]).map(s => s.id);
  let bookingCounts = {};
  if (slotIds.length) {
    const { data: counts } = await sb.from('re_bookings')
      .select('slot_id')
      .in('slot_id', slotIds)
      .neq('status', 'cancelled');
    (counts||[]).forEach(b => { bookingCounts[b.slot_id] = (bookingCounts[b.slot_id]||0) + 1; });
  }

  // Client's own bookings
  const { data: myBookings } = await sb.from('re_bookings')
    .select('slot_id,status')
    .eq('user_id', userId)
    .in('slot_id', slotIds.length ? slotIds : ['00000000-0000-0000-0000-000000000000']);

  const mySlotIds = new Set((myBookings||[]).filter(b => b.status !== 'cancelled').map(b => b.slot_id));
  const credits = await getCredits(userId);

  const enriched = (slots||[]).map(s => ({
    ...s,
    booked_count: bookingCounts[s.id] || 0,
    available: (bookingCounts[s.id] || 0) < s.max_bookings,
    my_booking: mySlotIds.has(s.id),
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
    status: 'confirmed', credits_spent: slot.credits_cost, notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const newBal = await adjustCredits(userId, -slot.credits_cost, 'booking', booking.id);

  // Google Calendar — adicionar cliente como attendee no evento do slot
  const evId = _calendarEventIds.get(slotId);
  if (evId && req.user.email) {
    gcPatchEvent(evId, {
      summary: `${slot.title || 'Consultoria'} — ${req.user.company || req.user.name || req.user.email}`,
      attendees: [{ email: req.user.email, displayName: req.user.name || req.user.email }],
    }).catch(() => {});
  } else if (!evId && GOOGLE_CALENDAR_ID) {
    // Slot criado antes do server restart — criar evento agora com attendee
    gcCreateEvent({
      summary: `${slot.title || 'Consultoria'} — ${req.user.company || req.user.name || req.user.email}`,
      description: `Cliente: ${req.user.name || req.user.email} (${req.user.company || ''})\nBooking: ${booking.id}`,
      start: slot.starts_at, end: slot.ends_at,
      attendeeEmail: req.user.email,
    }).then(id => { if (id) _calendarEventIds.set(slotId, id); }).catch(() => {});
  }

  res.json({ success: true, booking, credits_balance: newBal });
});

// ── Client: cancel a booking (refund credits) ────────────────────────────────
app.delete('/api/agenda/book/:bookingId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('id', req.params.bookingId).eq('user_id', userId).single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (booking.status === 'cancelled') return res.status(400).json({ error: 'Reserva já cancelada.' });

  // Only allow cancel if slot hasn't started
  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at, title').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({ status: 'cancelled' }).eq('id', booking.id);
  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund', booking.id);

  // Google Calendar — restaurar título do slot (remove attendee via patch)
  const evId = _calendarEventIds.get(booking.slot_id);
  if (evId) {
    gcPatchEvent(evId, {
      summary: `[Disponível] ${slot?.title || 'Consultoria'} — Recupera Empresas`,
      attendees: [],
    }).catch(() => {});
  }

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
    res.json({ received: true });
  }
);

// ── Admin: agenda slots management ───────────────────────────────────────────
app.get('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const { data: slots } = await sb.from('re_agenda_slots')
    .select('*').gte('starts_at', from).order('starts_at', { ascending: true }).limit(100);

  const slotIds = (slots||[]).map(s => s.id);
  let bookings = [];
  if (slotIds.length) {
    const { data } = await sb.from('re_bookings')
      .select('slot_id,user_id,status,re_users(name,email,company)')
      .in('slot_id', slotIds).neq('status', 'cancelled');
    bookings = data || [];
  }
  const bySlot = {};
  bookings.forEach(b => { (bySlot[b.slot_id] = bySlot[b.slot_id]||[]).push(b); });

  res.json({ slots: (slots||[]).map(s => ({ ...s, bookings: bySlot[s.id]||[] })) });
});

app.post('/api/admin/agenda/slots', requireAdmin, async (req, res) => {
  const { starts_at, ends_at, title, credits_cost, max_bookings, duration_min } = req.body;
  if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at e ends_at são obrigatórios.' });
  const { data, error } = await sb.from('re_agenda_slots').insert({
    starts_at, ends_at, title: title || 'Consultoria',
    credits_cost: credits_cost || 1,
    max_bookings: max_bookings || 1,
    duration_min: duration_min || 60,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Google Calendar — criar evento de disponibilidade
  gcCreateEvent({
    summary: `[Disponível] ${title || 'Consultoria'} — Recupera Empresas`,
    description: `Slot disponível para reserva de clientes.\nVagas: ${max_bookings || 1}  |  Créditos: ${credits_cost || 1}`,
    start: starts_at, end: ends_at,
  }).then(evId => { if (evId) _calendarEventIds.set(data.id, evId); }).catch(() => {});

  res.json({ success: true, slot: data });
});

app.delete('/api/admin/agenda/slots/:slotId', requireAdmin, async (req, res) => {
  const { slotId } = req.params;
  await sb.from('re_agenda_slots').delete().eq('id', slotId);
  // Google Calendar — remover evento
  const evId = _calendarEventIds.get(slotId);
  if (evId) { gcDeleteEvent(evId).catch(() => {}); _calendarEventIds.delete(slotId); }
  res.json({ success: true });
});

// Client: cancel booking by slot id (convenience — finds the booking first)
app.delete('/api/agenda/cancel-slot/:slotId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { data: booking } = await sb.from('re_bookings')
    .select('*').eq('slot_id', req.params.slotId).eq('user_id', userId)
    .neq('status', 'cancelled').single();
  if (!booking) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada — não é possível cancelar.' });

  await sb.from('re_bookings').update({ status: 'cancelled' }).eq('id', booking.id);
  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund', booking.id);
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
  else res.status(500).json({ error: 'Erro ao criar ticket. Tente novamente.' });
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
app.get('/api/appointments', requireAuth, async (req, res) => {
  res.json({ appointments: await readAppointments(req.user.id) });
});

// Appointments: create
app.post('/api/appointments', requireAuth, async (req, res) => {
  const { date, time, type, notes } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'Preencha data e tipo.' });

  const appt = await insertAppointment({
    user_id: req.user.id, date, time: time || null,
    type, notes: notes || '', status: 'pendente',
  });

  const typeLabels = {
    diagnostico:'Diagnóstico Inicial', revisao:'Revisão do Business Plan',
    financeiro:'Análise Financeira', estrategia:'Planejamento Estratégico', outro:'Outro'
  };
  sendMail(EMAIL_TO,
    `[Agenda] ${typeLabels[type]||type} — ${req.user.company || req.user.name || req.user.email}`,
    emailWrapper('Novo agendamento solicitado', `
      <p><b>Cliente:</b> ${req.user.name || ''} (${req.user.email})</p>
      <p><b>Empresa:</b> ${req.user.company || '—'}</p>
      <p><b>Tipo:</b> ${typeLabels[type] || type}</p>
      <p><b>Data/Hora:</b> ${new Date(date+'T12:00:00').toLocaleDateString('pt-BR')}${time ? ' às '+time : ''}</p>
      ${notes ? `<p><b>Observações:</b> ${notes}</p>` : ''}
    `)
  ).catch(() => {});

  res.json({ success: true, appointment: appt });
});

// Appointments: cancel
app.delete('/api/appointments/:id', requireAuth, async (req, res) => {
  await sb.from('re_appointments')
    .delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Admin: all appointments
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
  ]).catch(() => {});
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
    let q = sb.from('re_forms').select('*').order('created_at', { ascending: false });
    if (type)   q = q.eq('type', type);
    if (status) q = q.eq('status', status);
    const { data: forms } = await q;
    // Attach response counts
    const ids = (forms || []).map(f => f.id);
    let counts = {};
    if (ids.length) {
      const { data: resp } = await sb.from('re_form_responses')
        .select('form_id').in('form_id', ids).eq('status', 'completed');
      (resp || []).forEach(r => { counts[r.form_id] = (counts[r.form_id] || 0) + 1; });
    }
    res.json({ forms: (forms || []).map(f => ({ ...f, response_count: counts[f.id] || 0 })) });
  } catch (e) { console.error('[FORMS LIST]', e.message); res.json({ forms: [] }); }
});

// ── Admin: Create form ────────────────────────────────────────────────────────
app.post('/api/admin/forms', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, settings, linked_plan_chapter } = req.body;
    if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });
    const { data: form, error } = await sb.from('re_forms').insert({
      title, description: description || null, type: type || 'custom',
      settings: settings || { scoring_enabled: false, show_progress: true, allow_resume: true },
      linked_plan_chapter: linked_plan_chapter || null,
      created_by: req.user.id, status: 'draft',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Auto-create first page
    await sb.from('re_form_pages').insert({ form_id: form.id, title: 'Página 1', order_index: 0 });
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'form', entityId: form.id, action: 'create', after: { title, type } }).catch(() => {});
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
    const { data: form, error } = await sb.from('re_forms').update(updates).eq('id', req.params.id).select().single();
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

    const { data: newForm } = await sb.from('re_forms').insert({
      title: src.title + ' (cópia)', description: src.description,
      type: src.type, settings: src.settings, status: 'draft',
      linked_plan_chapter: src.linked_plan_chapter,
      created_by: req.user.id, template_id: src.id, version: 1,
    }).select().single();

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
        form?.title || 'Formulário', 'form', req.params.id).catch(() => {});
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
      form?.title || 'Formulário', 'form', req.params.id).catch(() => {});
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
        'form_response', req.params.responseId).catch(() => {});
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

    if (!resp) {
      const { data: newResp } = await sb.from('re_form_responses').insert({
        form_id: formId, user_id: uid, status: dbStatus,
        current_page_id: current_page_id || null,
        updated_at: new Date().toISOString(),
      }).select('id,status').single();
      resp = newResp;
    } else {
      const upd = { status: dbStatus, updated_at: new Date().toISOString() };
      if (current_page_id) upd.current_page_id = current_page_id;
      if (isCompleting)    upd.completed_at     = new Date().toISOString();
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
          'form_response', responseId).catch(() => {});
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
    const { data: inv, error } = await sb.from('re_invoices').insert({
      user_id, description,
      amount_cents: parseInt(amount_cents),
      due_date,
      status:         'pending',
      payment_method: payment_method || 'boleto',
      bank_data:      bank_data      || null,
      notes:          notes          || null,
      created_by:     req.user.id,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Push notification to client
    pushNotification(user_id, 'payment', 'Nova cobrança disponível',
      `${description} — vencimento: ${new Date(due_date + 'T12:00:00').toLocaleDateString('pt-BR')}`,
      'invoice', inv.id).catch(() => {});

    // Audit log
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'invoice', entityId: inv.id, action: 'create',
      after: { user_id, description, amount_cents, due_date } }).catch(() => {});

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
          before.description, 'invoice', req.params.id).catch(() => {});
      }
    }

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'invoice', entityId: req.params.id, action: 'update',
      before: before, after: updates }).catch(() => {});

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
      before: { status: before.status }, after: { status: 'cancelled' } }).catch(() => {});
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
       <p><a href="${pdfUrl}" style="background:#1A56DB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Baixar Boleto PDF</a></p>
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

    // Create internal invoice
    const { data: inv } = await sb.from('re_invoices').insert({
      user_id:        req.user.id,
      description:    `Serviço: ${svc.name}`,
      amount_cents:   svc.price_cents,
      due_date:       new Date(Date.now() + 3*86400000).toISOString().split('T')[0],
      status:         'pending',
      payment_method: 'boleto',
      created_by:     null,
    }).select().single();

    // Create order referencing the invoice
    const { data: order } = await sb.from('re_service_orders').insert({
      user_id:        req.user.id,
      service_id:     svc.id,
      amount_cents:   svc.price_cents,
      status:         'pending_payment',
      payment_method: 'boleto',
      invoice_id:     inv?.id || null,
    }).select().single();

    pushNotification(req.user.id, 'service', 'Pedido recebido!',
      `Seu pedido para "${svc.name}" foi registrado. Aguarde o boleto.`,
      'service_order', order?.id).catch(() => {});

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
    const { data: services } = await sb.from('re_services')
      .select('*').order('created_at', { ascending: false });
    res.json({ services: services || [] });
  } catch (e) { res.json({ services: [] }); }
});

// Admin: create service
app.post('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { name, description, category, price_cents, delivery_days, features, featured } = req.body;
    if (!name || !price_cents) return res.status(400).json({ error: 'name e price_cents são obrigatórios.' });
    const { data: svc, error } = await sb.from('re_services').insert({
      name, description, category, price_cents: parseInt(price_cents),
      delivery_days: delivery_days || null,
      features: features || null,
      featured: featured || false,
      active: true,
      created_by: req.user.id,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
      entityType: 'service', entityId: svc.id, action: 'create', after: { name, price_cents } }).catch(() => {});
    res.json({ success: true, service: svc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: update service
app.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const { active, name, description, price_cents, category, featured } = req.body;
    const updates = {};
    if (active      !== undefined) updates.active      = active;
    if (name        !== undefined) updates.name        = name;
    if (description !== undefined) updates.description = description;
    if (price_cents !== undefined) updates.price_cents = parseInt(price_cents);
    if (category    !== undefined) updates.category    = category;
    if (featured    !== undefined) updates.featured    = featured;
    const { data: svc, error } = await sb.from('re_services').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
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
    if (status      !== undefined) updates.status      = status;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (delivered_at !== undefined) updates.delivered_at = delivered_at;
    const { data: order, error } = await sb.from('re_service_orders')
      .update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Notify client on key status changes
    if (status === 'delivered') {
      const { data: o } = await sb.from('re_service_orders').select('user_id,re_services(name)').eq('id', req.params.id).single();
      if (o) pushNotification(o.user_id, 'service', 'Serviço entregue!',
        `"${o.re_services?.name}" foi concluído e entregue.`, 'service_order', req.params.id).catch(() => {});
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
      .order('ts', { ascending: false })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (entity_type) q = q.eq('entity_type', entity_type);
    if (actor_id)    q = q.eq('actor_id', actor_id);
    if (from)        q = q.gte('ts', from);
    if (to)          q = q.lte('ts', to);
    const { data: rows } = await q;
    res.json({ entries: rows || [] });
  } catch (e) {
    console.error('[AUDIT LOG GET]', e.message);
    res.json({ entries: [] });
  }
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
