'use strict';
const router  = require('express').Router();
const XLSX    = require('xlsx');
const PDFDoc  = require('pdfkit');
const { sb } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');
const { safeUser } = require('../lib/auth');
const { findUserById, readOnboarding, readTasks, readPlan, readMessages, readAppointments,
        saveChapterStatus, insertMessage, PLAN_CHAPTERS } = require('../lib/db');
const { pushNotification, auditLog } = require('../lib/logging');

router.get('/api/admin/clients', requireAdmin, async (req, res) => {
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

router.get('/api/admin/client/:id', requireAdmin, async (req, res) => {
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

// Admin: list a client's bookings (for drawer Agenda tab)
router.get('/api/admin/client/:id/bookings', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_bookings')
      .select('id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,notes,created_at,re_agenda_slots(id,starts_at,ends_at,title,location,meeting_link)')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(30);
    res.json({ bookings: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/admin/client/:id/task', requireAdmin, async (req, res) => {
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
    'task', task?.id).catch(e => console.warn('[async]', e?.message));

  // Audit log
  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'task', entityId: task?.id, action: 'create',
    after: { user_id: req.params.id, title, status: 'pendente' } }).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, task });
});

router.put('/api/admin/client/:id/plan/chapter/:chapterId', requireAdmin, async (req, res) => {
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
      'plan_chapter', req.params.chapterId).catch(e => console.warn('[async]', e?.message));
  }

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 'plan_chapter', entityId: req.params.id + ':' + req.params.chapterId,
    action: 'update', after: updates }).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true });
});

router.post('/api/admin/client/:id/message', requireAdmin, async (req, res) => {
  const { text, to_member_id } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });

  // If targeting a specific team member, insert with to_member_id
  const msgPayload = {
    user_id:   req.params.id,
    from_role: 'admin',
    from_name: req.user.name || req.user.email,
    text:      text.trim(),
  };
  if (to_member_id) msgPayload.to_member_id = to_member_id;

  const { data: msg } = await sb.from('re_messages').insert(msgPayload).select().single();

  // Notify client about new message from consultant
  pushNotification(req.params.id, 'message', 'Nova mensagem do consultor',
    text.trim().slice(0, 100), 'message', req.params.id).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, message: msg });
});

// ─── Admin: Edit client details ───────────────────────────────────────────────
router.put('/api/admin/client/:id', requireAdmin, async (req, res) => {
  const { name, company, email } = req.body;
  if (!name?.trim() && !company?.trim() && !email?.trim()) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  }
  const before = await findUserById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const { sendMail, emailWrapper } = require('../lib/email');
  const { BASE_URL } = require('../lib/config');

  const updates = { updated_at: new Date().toISOString() };
  if (name?.trim())    updates.name    = name.trim();
  if (company?.trim()) updates.company = company.trim();
  if (email?.trim())   updates.email   = email.toLowerCase().trim();

  // LGPD: create a change request instead of directly updating sensitive fields
  const { dataChangeRequestRoutes } = require('./data-change-requests');
  const fieldChanges = {};
  if (updates.name    && updates.name    !== before.name)    fieldChanges.name    = { from: before.name,    to: updates.name };
  if (updates.company && updates.company !== before.company) fieldChanges.company = { from: before.company, to: updates.company };
  if (updates.email   && updates.email   !== before.email)   fieldChanges.email   = { from: before.email,   to: updates.email };

  if (!Object.keys(fieldChanges).length) {
    return res.json({ success: true, message: 'Nenhuma alteração detectada.' });
  }

  // Insert a LGPD change request and notify the client to confirm
  const { data: cr } = await sb.from('re_data_change_requests').insert({
    company_id: req.params.id,
    requested_by: req.user.id,
    requester_role: 'admin',
    entity_type: 're_users',
    entity_id: req.params.id,
    field_changes: fieldChanges,
    reason: req.body.reason || 'Atualização de dados pelo consultor.',
  }).select().single();

  const fields = Object.entries(fieldChanges)
    .map(([k, v]) => `<li><b>${k}:</b> ${v.from ?? '—'} → ${v.to ?? '—'}</li>`).join('');
  const confirmUrl = `${BASE_URL}/dashboard.html?change_request=${cr?.token}`;
  sendMail(before.email,
    'Confirmação de alteração de dados — Recupera Empresas',
    emailWrapper('Solicitação de alteração de dados',
      `<p>O consultor solicitou as seguintes alterações:</p>
       <ul>${fields}</ul>
       <p>Acesse o portal para confirmar ou recusar:</p>
       <p><a href="${confirmUrl}">Revisar alterações</a></p>
       <p style="font-size:12px;color:#9ca3af">Esta solicitação expira em 48 horas.</p>`
    )
  ).catch(e => console.warn('[async]', e?.message));

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 're_users', entityId: req.params.id, action: 'change_requested',
    after: fieldChanges }).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, pending: true, message: 'Solicitação de alteração enviada. O cliente receberá um e-mail para confirmar.' });
});

// ─── Admin: Delete client account ────────────────────────────────────────────
router.delete('/api/admin/client/:id', requireAdmin, async (req, res) => {
  const { sendMail, emailWrapper } = require('../lib/email');
  const { confirm } = req.body;
  if (confirm !== 'CONFIRMAR_EXCLUSAO') {
    return res.status(400).json({
      error: 'Para excluir, envie { confirm: "CONFIRMAR_EXCLUSAO" } no body.',
    });
  }
  const user = await findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (user.is_admin) return res.status(403).json({ error: 'Não é possível excluir uma conta admin.' });

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 're_users', entityId: req.params.id, action: 'delete',
    before: { email: user.email, company: user.company } }).catch(e => console.warn('[async]', e?.message));

  // Cascade delete via FK (all user data will be removed)
  const { error } = await sb.from('re_users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  // Notify the user their account was deleted (LGPD)
  sendMail(user.email, 'Conta encerrada — Recupera Empresas',
    emailWrapper('Conta encerrada',
      `<p>Olá, ${user.name || user.email}!</p>
       <p>Sua conta no portal Recupera Empresas foi encerrada pelo consultor responsável.</p>
       <p>Todos os seus dados foram removidos conforme a LGPD.</p>
       <p>Se tiver dúvidas, entre em contato com nossa equipe.</p>`
    )
  ).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, message: 'Conta excluída com sucesso.' });
});

// ─── Admin: XLS export ────────────────────────────────────────────────────────
router.get('/api/admin/client/:id/export/xlsx', requireAdmin, async (req, res) => {
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
router.get('/api/admin/client/:id/export/pdf', requireAdmin, async (req, res) => {
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
  doc.fontSize(8).fillColor(GRAY)
     .text('Recupera Empresas — Documento confidencial. Uso interno.', 50, 790, { align: 'center', width: W });

  doc.end();
});

module.exports = router;
