'use strict';
const https = require('https');
const fs    = require('fs');
const { RESEND_KEY, EMAIL_FROM, BASE_URL } = require('./config');

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

const EMAIL_STYLE = {
  wrapper600: 'font-family:Arial,sans-serif;max-width:600px;margin:0 auto',
  wrapper700: 'font-family:Arial,sans-serif;max-width:700px;margin:0 auto',
  wrapper800: 'font-family:Arial,sans-serif;max-width:800px;margin:0 auto',
  header: 'background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0',
  headerTitle: 'color:#fff;margin:0;font-size:18px',
  headerTitleLg: 'color:#fff;margin:0;font-size:20px',
  headerSubtitle: 'color:#94A3B8;margin:4px 0 0;font-size:13px',
  panel: 'background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px',
  panelCompact: 'background:#fff;padding:20px 24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none',
  footer: 'margin-top:10px;padding:10px 16px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;text-align:center',
  footerLink: 'color:#1A56DB',
  progressBox: 'background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin:16px 0',
  progressRow: 'display:flex;align-items:center;gap:12px',
  progressValue: 'font-size:28px;font-weight:800;color:#1A56DB',
  progressTitle: 'font-weight:700;color:#1E40AF',
  progressCopy: 'font-size:13px;color:#3B82F6',
  progressTrack: 'background:#DBEAFE;border-radius:4px;height:6px;margin-top:12px',
  centerCta: 'text-align:center;margin:20px 0',
  primaryButton: 'background:#1A56DB;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px',
  successBox: 'background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:16px;margin:16px 0',
  successTitle: 'margin:0;color:#065F46;font-weight:700',
  successCopy: 'margin:4px 0 0;font-size:13px;color:#047857',
  metaText: 'color:#64748B;font-size:13px;margin-top:16px',
  timeText: 'font-size:12px;color:#94A3B8',
  table: 'width:100%;border-collapse:collapse;margin-bottom:16px',
  tableLabel: 'padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:38%;font-weight:600;font-size:13px;color:#334155',
  tableValue: 'padding:6px 12px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b',
  factTable: 'width:100%;border-collapse:collapse;font-size:14px;margin:16px 0',
  factLabel: 'padding:6px 0;color:#64748B;width:40%',
  factValue: 'padding:6px 0;font-weight:600',
  infoBar: 'background:#EFF6FF;padding:12px 24px;border-bottom:1px solid #BFDBFE',
  infoLabel: 'font-size:13px;color:#1E40AF',
  infoValue: 'font-size:13px;color:#1E3A5F',
  infoTime: 'float:right;font-size:12px;color:#64748B',
  sectionHeading: 'font-weight:700;color:#1A56DB;margin:12px 0 6px',
  sectionNote: 'color:#64748b',
  generatedBox: 'margin-top:12px;padding:10px 16px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b',
  completeHeading: 'font-size:15px;color:#1A56DB;margin:20px 0 8px;padding-bottom:6px;border-bottom:2px solid #DBEAFE',
};

function emailStyle(name, extra = '') {
  const base = EMAIL_STYLE[name] || '';
  const full = [base, extra].filter(Boolean).join(';');
  return `style="${full}"`;
}

function emailFactRow(label, value, valueExtra = '') {
  return `<tr><td ${emailStyle('factLabel')}>${label}</td><td ${emailStyle('factValue', valueExtra)}>${value}</td></tr>`;
}

function emailFactTable(rows) {
  return `<table ${emailStyle('factTable')}>${rows}</table>`;
}

function emailWrapper(title, body) {
  return `<div ${emailStyle('wrapper600')}>
    <div ${emailStyle('header')}>
      <h1 ${emailStyle('headerTitle')}>Recupera Empresas</h1>
      <p ${emailStyle('headerSubtitle')}>${title}</p>
    </div>
    <div ${emailStyle('panel')}>${body}</div>
    <div ${emailStyle('footer')}>
      © 2025 Recupera Empresas · <a href="mailto:contato@recuperaempresas.com.br" ${emailStyle('footerLink')}>contato@recuperaempresas.com.br</a>
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
    <div ${emailStyle('progressBox')}>
      <div ${emailStyle('progressRow')}>
        <div ${emailStyle('progressValue')}>${pct}%</div>
        <div>
          <div ${emailStyle('progressTitle')}>Progresso do onboarding</div>
          <div ${emailStyle('progressCopy')}>${stepNum} de ${total} etapas concluídas</div>
        </div>
      </div>
      <div ${emailStyle('progressTrack')}>
        <div ${emailStyle('progressTrack', `background:#1A56DB;width:${pct}%`)}></div>
      </div>
    </div>
    ${stepNum < 14
      ? `<p ${emailStyle('centerCta')}>
          <a href="${BASE_URL}/dashboard.html" ${emailStyle('primaryButton')}>Acessar o Portal</a>
         </p>`
      : `<div ${emailStyle('successBox')}>
          <p ${emailStyle('successTitle')}>Onboarding concluído!</p>
          <p ${emailStyle('successCopy')}>Nossa equipe iniciará a análise e elaboração do Business Plan em até 2 dias úteis.</p>
         </div>`
    }
    <p ${emailStyle('metaText')}>Dúvidas? <a href="mailto:contato@recuperaempresas.com.br" ${emailStyle('footerLink')}>contato@recuperaempresas.com.br</a></p>
    <p ${emailStyle('timeText')}>Enviado em ${ts}</p>
  `);
}

function buildStepHtml(stepNum, allData, user, timestamp) {
  const s  = v => v || '<em>não informado</em>';
  const yn = v => v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : s(v);
  const row = (k, v) => `<tr>
    <td ${emailStyle('tableLabel')}>${k}</td>
    <td ${emailStyle('tableValue')}>${v}</td></tr>`;
  const tbl = rows => `<table ${emailStyle('table')}>${rows}</table>`;

  const empresa  = allData.empresa || {};
  const userName = user.name || user.full_name || user.email || '';
  let body = `
  <div ${emailStyle('wrapper700')}>
    <div ${emailStyle('header')}>
      <h1 ${emailStyle('headerTitle')}>Recupera Empresas — Onboarding</h1>
      <p ${emailStyle('headerSubtitle')}>Etapa ${stepNum} concluída: ${STEP_TITLES[stepNum] || ''}</p>
    </div>
    <div ${emailStyle('infoBar')}>
      <b ${emailStyle('infoLabel')}>Cliente:</b>
      <span ${emailStyle('infoValue')}> ${userName} — ${empresa.razaoSocial || user.company || 'empresa'} &lt;${user.email}&gt;</span>
      <span ${emailStyle('infoTime')}>${timestamp}</span>
    </div>
    <div ${emailStyle('panelCompact')}>`;

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
      body += `<p ${emailStyle('sectionHeading')}>Sócio ${i+1}</p>`;
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
      body += `<p ${emailStyle('sectionHeading')}>Dívida ${i+1}</p>`;
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
  if (stepNum === 13) body += `<p ${emailStyle('sectionNote')}>Documentos anexados — verificar e-mail de envio final.</p>`;
  if (stepNum === 14) {
    const r = D.responsavel||{};
    body += tbl([row('Nome',s(r.nome)),row('Cargo',s(r.cargo)),row('E-mail',s(r.email)),row('Telefone',s(r.telefone)),
      row('Declaração',D.confirmacao?.declaro?'Confirmada':'Nao confirmada')].join(''));
  }
  body += `</div>
    <div ${emailStyle('generatedBox')}>
      Gerado em ${timestamp} via Portal de Onboarding — Recupera Empresas
    </div>
  </div>`;
  return body;
}

module.exports = {
  sendMail,
  STEP_TITLES,
  EMAIL_STYLE,
  emailStyle,
  emailFactRow,
  emailFactTable,
  emailWrapper,
  buildClientStepConfirmHtml,
  buildStepHtml,
};
