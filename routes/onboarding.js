'use strict';
const router = require('express').Router();
const fs     = require('fs');
const { sb, EMAIL_TO, FRESHSALES_KEY, upload } = require('../lib/config');
const { requireAuth } = require('../lib/auth');
const { readOnboarding, saveOnboarding } = require('../lib/db');
const { sendMail, emailStyle, buildStepHtml, buildClientStepConfirmHtml, STEP_TITLES } = require('../lib/email');
const { addFreshdeskNote, updateFreshdeskTicket, syncFreshsalesContact, createFreshsalesDeal } = require('../lib/crm');
const { logAccess } = require('../lib/logging');

router.post('/api/step-complete', requireAuth, async (req, res) => {
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
      addFreshdeskNote(ticketId, noteHtml).catch(e => console.warn('[async]', e?.message));
    }

    logAccess(user.id, user.email, 'step_complete', req.ip, { step: stepNum });
    res.json({ success: true });
  } catch(e) { console.error('[STEP]', e); res.status(500).json({ error: 'Erro ao registrar etapa.' }); }
});

router.get('/api/progress', requireAuth, async (req, res) => {
  res.json(await readOnboarding(req.user.id));
});

// ─── Final submit ─────────────────────────────────────────────────────────────
const fileFields = [
  { name:'balanco',maxCount:5 }, { name:'dre',maxCount:5 },
  { name:'extratos',maxCount:10 }, { name:'contratos',maxCount:10 }
];

router.post('/api/submit', requireAuth, upload.fields(fileFields), async (req, res) => {
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
      allStepsHtml += `<h2 ${emailStyle('completeHeading')}>
        Etapa ${i} — ${STEP_TITLES[i]}</h2>`;
      allStepsHtml += buildStepHtml(i, allData, user, ts);
    }
    const fullHtml = `<div ${emailStyle('wrapper800')}>
      <div ${emailStyle('header')}>
        <h1 ${emailStyle('headerTitleLg')}>Onboarding Completo — Recupera Empresas</h1>
        <p ${emailStyle('headerSubtitle')}>${empresa.razaoSocial||user.company||user.name||user.email} — ${ts}</p>
      </div>
      <div ${emailStyle('panel')}>${allStepsHtml}</div>
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
      ).catch(e => console.warn('[async]', e?.message));
      await updateFreshdeskTicket(ticketId, { status: 4 }).catch(e => console.warn('[async]', e?.message));
    }

    // Freshsales CRM: update contact + create deal (fire and forget)
    if (FRESHSALES_KEY) {
      const fin = allData.financeiro || {};
      const faturamento = parseFloat(String(fin.faturamento12meses || '0').replace(/\D/g, '')) / 100 || 0;
      const phone = empresa.telefone || allData.responsavel?.telefone || null;
      syncFreshsalesContact(user.email, user.name || empresa.razaoSocial, empresa.razaoSocial, phone, {
        job_title: allData.responsavel?.cargo || undefined,
      }).then(async (fsContactId) => {
        const storedId = user.freshsales_contact_id || fsContactId;
        const dealName = `Recuperação — ${empresa.razaoSocial || user.company || user.name}`;
        if (storedId) await createFreshsalesDeal(storedId, dealName, faturamento).catch(e => console.warn('[async]', e?.message));
        if (fsContactId && !user.freshsales_contact_id) {
          await sb.from('re_users').update({ freshsales_contact_id: fsContactId }).eq('id', user.id);
        }
      }).catch(e => console.warn('[async]', e?.message));
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

module.exports = router;
