'use strict';
require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
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

// ─── Supabase — aceita nomes VITE_* (convenção do projeto) ou nomes genéricos ─
const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL      ||
  'https://sspvizogbcyigquqycsz.supabase.co'
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
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzcHZpem9nYmN5aWdxdXF5Y3N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3OTYxNTYsImV4cCI6MjA4MzM3MjE1Nn0.C1P4wlanONGA9EDNR4nBujJ136sSXlZCioFyd_CWIfs'
);

// Service role bypasses RLS — OBRIGATÓRIO para queries server-side
const SUPABASE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.warn('[SUPABASE] ⚠️  VITE_SUPABASE_SERVICE_ROLE não definido — usando anon key.');
  console.warn('[SUPABASE] ⚠️  Queries de escrita/leitura admin serão bloqueadas por RLS.');
  console.warn('[SUPABASE] ⚠️  Defina VITE_SUPABASE_SERVICE_ROLE no .env para operação completa.');
}

// sb = service role (DB + Auth admin operations)
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// sbAnon = anon key (Supabase Auth sign-in/sign-up — validates user credentials)
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

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

async function logAccess(userId, email, event, ip, extra = {}) {
  await sb.from('re_access_log').insert({
    user_id: userId || null,
    email, event,
    ip: ip || 'unknown',
    step: extra.step || null,
    ts: new Date().toISOString()
  }).catch(() => {}); // fire and forget
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
      .select('id,name,email,role,active,company_id')
      .eq('id', decoded.id)
      .eq('active', true)
      .single();
    if (!member) return res.status(401).json({ error: 'Membro inativo ou não encontrado.' });
    // Expose company owner id as user.id so all routes read the correct data
    req.user = {
      id:         member.company_id,   // data owner = the company owner
      member_id:  member.id,
      name:       member.name,
      email:      member.email,
      role:       member.role,
      company_id: member.company_id,
      is_admin:   false,
      is_member:  true,
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

app.use(express.json({ limit: '5mb' }));
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
        await sb.from('re_users').insert({ ...profile, ...updates }).catch(() => {});
        await sb.from('re_users').delete().eq('id', profile.id).catch(() => {});
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
        emailRedirectTo: `${BASE_URL}/login.html?confirmed=1`,
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

    // Welcome email
    sendMail(email, 'Bem-vindo ao Portal Recupera Empresas',
      emailWrapper('Acesso criado com sucesso', `
        <p>Olá, <b>${name}</b>!</p>
        <p>Seu acesso ao portal foi criado. Inicie agora o preenchimento dos dados da sua empresa:</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${BASE_URL}/login.html" style="background:#1A56DB;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Acessar o Portal</a>
        </p>
        <p style="color:#64748B;font-size:13px;">Dúvidas: contato@recuperaempresas.com.br</p>
      `)
    ).catch(() => {});

    logAccess(profile.id, email, 'register', req.ip);
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
    res.json({ success: true, token, user: safeUser(profile) });
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
    const resetRedirect = `${BASE_URL}/reset-password.html`;
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
      options: { emailRedirectTo: `${BASE_URL}/login.html?confirmed=1` },
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[RESEND]', e.message);
    res.status(500).json({ error: 'Erro ao reenviar.' });
  }
});

// ─── OAuth Consent (Supabase OAuth Server) ────────────────────────────────────
// GET /oauth/consent — serve the consent UI
app.get('/oauth/consent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'oauth-consent.html'));
});

// POST /oauth/consent — user approved; forward decision to Supabase and redirect
app.post('/oauth/consent', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { allow, ...params } = req.body; // allow = '1' or '0'
    const qs = new URLSearchParams(params).toString();
    const supabaseAuthorize = `${SUPABASE_URL}/auth/v1/oauth/authorize?${qs}&allow=${allow === '1' ? 'true' : 'false'}`;

    // Proxy the decision to Supabase and follow their redirect
    const r = await fetch(supabaseAuthorize, {
      method: 'GET',
      redirect: 'manual',
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const location = r.headers.get('location');
    if (location) return res.redirect(302, location);
    res.status(400).send('Não foi possível processar a autorização.');
  } catch(e) {
    console.error('[OAUTH CONSENT]', e.message);
    res.status(500).send('Erro interno.');
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

  res.json({ success: true, task });
});

app.put('/api/admin/client/:id/plan/chapter/:chapterId', requireAdmin, async (req, res) => {
  const { status, content } = req.body;
  const updates = {};
  if (status  !== undefined) updates.status  = status;
  if (content !== undefined) updates.content = content;
  await saveChapterStatus(req.params.id, parseInt(req.params.chapterId), updates);
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
  const { data: slot } = await sb.from('re_agenda_slots').select('starts_at').eq('id', booking.slot_id).single();
  if (slot && new Date(slot.starts_at) < new Date()) return res.status(400).json({ error: 'Sessão já iniciada.' });

  await sb.from('re_bookings').update({ status: 'cancelled' }).eq('id', booking.id);
  const newBal = await adjustCredits(userId, booking.credits_spent, 'refund', booking.id);
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
  res.json({ success: true, slot: data });
});

app.delete('/api/admin/agenda/slots/:slotId', requireAdmin, async (req, res) => {
  await sb.from('re_agenda_slots').delete().eq('id', req.params.slotId);
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

// Financial: invoices (Stripe placeholder)
app.get('/api/financial/invoices', requireAuth, (req, res) => {
  res.json({ invoices: [], stripeConfigured: !!process.env.STRIPE_SECRET_KEY });
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
        // Create Supabase Auth account with email confirmed
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
          email,
          password:       defaultPwd,
          email_confirm:  true,
          user_metadata:  { name: email.split('@')[0], company: 'Recupera Empresas' },
        });
        if (createErr) {
          console.warn(`[SEED] Erro Supabase Auth ao criar ${email}:`, createErr.message);
          continue;
        }
        authUser = created.user;
        console.log(`[SEED] Supabase Auth criado: ${email}`);
      }

      // Ensure re_users profile exists and is marked as admin
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
            await sb.from('re_users').insert({ ...existing, ...updates }).catch(() => {});
            await sb.from('re_users').delete().eq('id', existing.id).catch(() => {});
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
