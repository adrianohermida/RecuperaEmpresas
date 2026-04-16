'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { sendMail, emailWrapper } = require('../lib/email');
const { BASE_URL } = require('../lib/config');
const { pushNotification, auditLog } = require('../lib/logging');
const { findUserById, readOnboarding } = require('../lib/db');

function companyId(user) { return user.company_id || user.id; }

const ENTITY_TYPES = ['company', 'member', 'creditor', 'supplier', 'contract', 'employee'];

// ─── Document catalogue keyed by context ─────────────────────────────────────
// Used to generate onboarding-aware suggestions
function buildSuggestions(onboardingData, members, creditors, suppliers) {
  const d = onboardingData || {};
  const emp = d.empresa || {};
  const socios = Array.isArray(d.socios) ? d.socios : [];
  const dividas = Array.isArray(d.dividas) ? d.dividas : [];

  const suggestions = [];

  // ── Company-level documents (always suggested) ─────────────────────────────
  const companyCoreDoc = [
    { name: 'Contrato Social / Estatuto (consolidado)', doc_type: 'contrato_social', entity_type: 'company', priority: 1 },
    { name: 'Certidão de CNPJ', doc_type: 'certidao', entity_type: 'company', priority: 1 },
    { name: 'Comprovante de Endereço da Empresa', doc_type: 'outros', entity_type: 'company', priority: 1 },
    { name: 'Procuração — representante legal', doc_type: 'procuracao', entity_type: 'company', priority: 2 },
    { name: 'Última alteração contratual registrada', doc_type: 'contrato_social', entity_type: 'company', priority: 2 },
  ];
  companyCoreDoc.forEach(s => suggestions.push(s));

  // ── Financial documents (always suggested) ─────────────────────────────────
  const financialDocs = [
    { name: 'Balanço Patrimonial — Exercício atual', doc_type: 'balanco', entity_type: 'company', priority: 1 },
    { name: 'Balanço Patrimonial — Exercício anterior', doc_type: 'balanco', entity_type: 'company', priority: 1 },
    { name: 'DRE — Demonstração de Resultado (último exercício)', doc_type: 'dre', entity_type: 'company', priority: 1 },
    { name: 'Fluxo de Caixa (últimos 3 meses)', doc_type: 'fluxo_caixa', entity_type: 'company', priority: 1 },
    { name: 'Extratos Bancários (últimos 6 meses)', doc_type: 'extrato', entity_type: 'company', priority: 1 },
    { name: 'Certidão de Débitos Fiscais (Receita Federal)', doc_type: 'certidao', entity_type: 'company', priority: 2 },
    { name: 'Certidão Negativa Estadual / Municipal', doc_type: 'certidao', entity_type: 'company', priority: 2 },
    { name: 'Declaração de Imposto de Renda PJ (IRPJ/CSLL)', doc_type: 'dre', entity_type: 'company', priority: 2 },
  ];
  financialDocs.forEach(s => suggestions.push(s));

  // ── Per-partner / member documents ─────────────────────────────────────────
  socios.forEach(sc => {
    const name = sc.nome || sc.name || 'Sócio';
    suggestions.push(
      { name: `RG / CNH — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 1 },
      { name: `CPF — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 1 },
      { name: `Comprovante de Endereço — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 2 },
      { name: `Declaração de Imposto de Renda PF — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 2 },
    );
  });

  // Also add member suggestions for registered company members
  (members || []).forEach(m => {
    if (!socios.some(s => (s.email || '').toLowerCase() === (m.email || '').toLowerCase())) {
      suggestions.push(
        { name: `RG / CNH — ${m.name}`, doc_type: 'outros', entity_type: 'member', entity_id: m.id, entity_label: m.name, priority: 2 },
        { name: `CPF — ${m.name}`, doc_type: 'outros', entity_type: 'member', entity_id: m.id, entity_label: m.name, priority: 2 },
      );
    }
  });

  // ── Per-creditor documents (for judicial debts) ────────────────────────────
  dividas.forEach(dv => {
    if (dv.estaJudicializada === 'sim' || dv.estaJudicializada === true) {
      const credor = dv.nomeCredor || 'Credor';
      suggestions.push(
        { name: `Petição inicial / processo — ${credor}`, doc_type: 'outros', entity_type: 'creditor', entity_label: credor, priority: 1 },
        { name: `Contrato de crédito original — ${credor}`, doc_type: 'contrato_social', entity_type: 'creditor', entity_label: credor, priority: 1 },
      );
    }
  });

  (creditors || []).forEach(c => {
    suggestions.push(
      { name: `Contrato / escritura de dívida — ${c.name}`, doc_type: 'outros', entity_type: 'creditor', entity_id: c.id, entity_label: c.name, priority: 2 },
    );
  });

  // ── Supplier documents ─────────────────────────────────────────────────────
  (suppliers || []).forEach(s => {
    suggestions.push(
      { name: `Contrato de prestação de serviços — ${s.name}`, doc_type: 'outros', entity_type: 'supplier', entity_id: s.id, entity_label: s.name, priority: 2 },
    );
  });

  return suggestions;
}

// ─── Admin: get onboarding-aware suggestions ──────────────────────────────────
router.get('/api/admin/client/:id/document-requests/suggestions', requireAdmin, async (req, res) => {
  const onboarding = await readOnboarding(req.params.id);
  const [membersRes, creditorsRes, suppliersRes] = await Promise.all([
    sb.from('re_company_users').select('id,name,email').eq('company_id', req.params.id),
    sb.from('re_creditors').select('id,name').eq('company_id', req.params.id),
    sb.from('re_suppliers').select('id,name').eq('company_id', req.params.id),
  ]);
  const suggestions = buildSuggestions(
    onboarding?.data,
    membersRes.data || [],
    creditorsRes.data || [],
    suppliersRes.data || [],
  );
  res.json({ suggestions });
});

// ─── Admin: create document request ──────────────────────────────────────────
router.post('/api/admin/client/:id/document-requests', requireAdmin, async (req, res) => {
  const { name, doc_type, description, entity_type, entity_id, entity_label, deadline, admin_notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome do documento é obrigatório.' });
  if (!ENTITY_TYPES.includes(entity_type || 'company')) {
    return res.status(400).json({ error: 'Tipo de entidade inválido.' });
  }

  const { data: dr, error } = await sb.from('re_document_requests').insert({
    company_id:   req.params.id,
    requested_by: req.user.id,
    name:         name.trim(),
    doc_type:     doc_type || 'outros',
    description:  description?.trim() || null,
    entity_type:  entity_type || 'company',
    entity_id:    entity_id || null,
    entity_label: entity_label?.trim() || null,
    deadline:     deadline || null,
    admin_notes:  admin_notes?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify client
  const owner = await findUserById(req.params.id);
  const portalUrl = `${BASE_URL}/dashboard.html#documentos`;

  sendMail(
    owner?.email,
    `[Recupera Empresas] Novo documento solicitado: ${name}`,
    emailWrapper(
      'Documento solicitado pelo consultor',
      `<p>Olá, <b>${owner?.name || 'Cliente'}</b>!</p>
       <p>O seu consultor solicitou o seguinte documento:</p>
       <table style="border-collapse:collapse;width:100%;margin:12px 0">
         <tr><td style="font-weight:600;padding:6px 0;width:130px">Documento:</td><td>${name}</td></tr>
         ${entity_label ? `<tr><td style="font-weight:600;padding:6px 0">Entidade:</td><td>${entity_label}</td></tr>` : ''}
         ${deadline ? `<tr><td style="font-weight:600;padding:6px 0">Prazo:</td><td>${new Date(deadline + 'T12:00:00').toLocaleDateString('pt-BR')}</td></tr>` : ''}
         ${description ? `<tr><td style="font-weight:600;padding:6px 0">Instruções:</td><td>${description}</td></tr>` : ''}
       </table>
       <p>Acesse o portal para fazer o upload:</p>
       <p><a href="${portalUrl}" style="background:#1A56DB;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Enviar documento</a></p>`
    )
  ).catch(e => console.warn('[async]', e?.message));

  pushNotification(req.params.id, 'info', 'Documento solicitado',
    `Seu consultor solicitou: ${name}`, 'document_request', dr.id)
    .catch(e => console.warn('[async]', e?.message));

  auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin',
    entityType: 're_document_requests', entityId: dr.id, action: 'create',
    after: { name, company_id: req.params.id } }).catch(e => console.warn('[async]', e?.message));

  res.json({ success: true, request: dr });
});

// ─── Admin: list document requests for a client ───────────────────────────────
router.get('/api/admin/client/:id/document-requests', requireAdmin, async (req, res) => {
  const { data } = await sb.from('re_document_requests')
    .select('*')
    .eq('company_id', req.params.id)
    .order('created_at', { ascending: false });
  res.json({ requests: data || [] });
});

// ─── Admin: cancel a document request ────────────────────────────────────────
router.delete('/api/admin/client/:id/document-requests/:reqId', requireAdmin, async (req, res) => {
  const { error } = await sb.from('re_document_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.reqId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Client: list pending document requests ───────────────────────────────────
router.get('/api/document-requests', requireAuth, async (req, res) => {
  const cid = companyId(req.user);
  const { data } = await sb.from('re_document_requests')
    .select('*')
    .eq('company_id', cid)
    .in('status', ['pending', 'uploaded'])
    .order('created_at', { ascending: false });
  res.json({ requests: data || [] });
});

// ─── Client: fulfill a document request (upload + link) ──────────────────────
// The client uploads a file via POST /api/documents/upload?request_id=xxx
// That route will call fulfillRequest() below to update the request status.
router.put('/api/document-requests/:reqId/fulfill', requireAuth, async (req, res) => {
  const cid = companyId(req.user);
  const { doc_id } = req.body;
  if (!doc_id) return res.status(400).json({ error: 'doc_id é obrigatório.' });

  const { data: dr } = await sb.from('re_document_requests')
    .select('*').eq('id', req.params.reqId).eq('company_id', cid).single();
  if (!dr) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (!['pending'].includes(dr.status)) return res.status(409).json({ error: 'Solicitação já atendida.' });

  // Link the uploaded document to the request
  await sb.from('re_document_requests').update({
    status: 'uploaded', fulfilled_doc_id: doc_id, fulfilled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.reqId);

  // Also mark the re_documents row with the request_id
  await sb.from('re_documents').update({ request_id: req.params.reqId }).eq('id', doc_id);

  res.json({ success: true });
});

// ─── Admin: mark request approved/rejected (after reviewing the upload) ────────
router.put('/api/admin/client/:id/document-requests/:reqId', requireAdmin, async (req, res) => {
  const { status, admin_notes } = req.body;
  if (!['approved', 'rejected', 'pending', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  const updates = { status, updated_at: new Date().toISOString() };
  if (admin_notes !== undefined) updates.admin_notes = admin_notes?.trim() || null;
  const { error } = await sb.from('re_document_requests')
    .update(updates).eq('id', req.params.reqId).eq('company_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
