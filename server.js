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
const XLSX = require('xlsx');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT            || 3000;
const JWT_SECRET     = process.env.JWT_SECRET      || crypto.randomBytes(64).toString('hex');
const BASE_URL       = process.env.BASE_URL        || `http://localhost:${PORT}`;
const FRESHDESK_HOST = 'recuperaempresas-support.freshdesk.com';
const FRESHDESK_KEY  = process.env.FRESHDESK_KEY   || '6wvjwNiWfTtY0sloBJSK';
const FD_AUTH        = 'Basic ' + Buffer.from(FRESHDESK_KEY + ':X').toString('base64');
const RESEND_KEY     = process.env.RESEND_KEY      || 're_XWdsBrtW_LfFJm7PTcjKaGxjxnLVncRd3';
const EMAIL_FROM     = process.env.EMAIL_FROM      || 'Recupera Empresas <contato@recuperaempresas.com.br>';
const EMAIL_TO       = process.env.EMAIL_TO        || 'contato@recuperaempresas.com.br';
const ADMIN_EMAILS   = (process.env.ADMIN_EMAILS   || 'contato@recuperaempresas.com.br,camilagbhmaia@gmail.com,adrianohermida@gmail.com')
                         .split(',').map(e => e.trim().toLowerCase());
const FRESHCHAT_JWT_SECRET = Buffer.from(
  process.env.FRESHCHAT_JWT_SECRET || '8p6UT0bSzLGGahXjd+nPo7BrYc7oXT7KLdgctXABMxE=', 'base64'
);

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL      || 'https://sspvizogbcyigquqycsz.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('[SUPABASE] SUPABASE_SERVICE_ROLE_KEY not set — add it to .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
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

  const user = await findUserById(decoded.userId);
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
    id:      u.id,
    name:    u.name || u.full_name || '',
    email:   u.email,
    company: u.company || '',
    isAdmin: u.is_admin || ADMIN_EMAILS.includes((u.email||'').toLowerCase()),
    freshdeskTicketId:  u.freshdesk_ticket_id  || null,
    freshdeskContactId: u.freshdesk_contact_id || null,
    createdAt: u.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, company, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });

    const hash    = await bcrypt.hash(password, 10);
    const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

    const { data: newUser, error: insertErr } = await sb.from('re_users').insert({
      email, name, company: company || '',
      password_hash: hash,
      is_admin: isAdmin,
    }).select().single();

    if (insertErr) throw insertErr;

    // Freshdesk contact + ticket (fire and forget, update user after)
    Promise.all([
      createFreshdeskContact(email, name),
      createFreshdeskTicket(email, name, company)
    ]).then(async ([contactId, ticketId]) => {
      if (contactId || ticketId) {
        await sb.from('re_users').update({
          freshdesk_contact_id: contactId || null,
          freshdesk_ticket_id:  ticketId  || null,
        }).eq('id', newUser.id);
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

    logAccess(newUser.id, email, 'register', req.ip);
    const token = signToken({ userId: newUser.id, email: newUser.email });
    res.json({ success: true, token, user: safeUser(newUser) });
  } catch(e) {
    console.error('[REGISTER]', e.message);
    res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Preencha todos os campos.' });

    const user = await findUserByEmail(email);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

    // Promote to admin if in list but not flagged
    if (ADMIN_EMAILS.includes(email.toLowerCase()) && !user.is_admin) {
      await sb.from('re_users').update({ is_admin: true }).eq('id', user.id);
      user.is_admin = true;
    }

    logAccess(user.id, email, 'login', req.ip);

    const token = signToken({ userId: user.id, email: user.email });
    res.json({ success: true, token, user: safeUser(user) });
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
    const user = await findUserByEmail(email);
    if (!user) return res.json({ success: true }); // silent

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600*1000).toISOString();
    await sb.from('re_users').update({ reset_token: token, reset_expiry: expiry }).eq('id', user.id);

    const resetLink = `${BASE_URL}/reset-password.html?token=${token}`;
    await sendMail(email, 'Recuperação de senha — Recupera Empresas',
      emailWrapper('Redefinição de senha', `
        <p>Olá, <b>${user.name || ''}</b>!</p>
        <p>Clique abaixo para criar uma nova senha:</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${resetLink}" style="background:#1A56DB;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Redefinir Senha</a>
        </p>
        <p style="color:#64748B;font-size:13px;">Link válido por 1 hora. Se não solicitou, ignore este e-mail.</p>
      `)
    );
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro ao enviar e-mail.' }); }
});

app.post('/api/auth/reset', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token||!password) return res.status(400).json({ error: 'Dados inválidos.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres.' });

    const { data: user } = await sb.from('re_users')
      .select('*').eq('reset_token', token).single();
    if (!user) return res.status(400).json({ error: 'Token inválido ou já utilizado.' });
    if (new Date(user.reset_expiry) < new Date()) return res.status(400).json({ error: 'Token expirado.' });

    const hash = await bcrypt.hash(password, 10);
    await sb.from('re_users').update({
      password_hash: hash, reset_token: null, reset_expiry: null
    }).eq('id', user.id);

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erro interno.' }); }
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

// ─── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Recupera Empresas — Portal http://localhost:${PORT}`);
  console.log(`  Login:     http://localhost:${PORT}/login.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  Admin:     http://localhost:${PORT}/admin.html\n`);
});
