'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDoc = require('pdfkit');

const { BASE_URL, sb, JWT_SECRET } = require('../lib/config');
const jwt = require('jsonwebtoken');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog, pushNotification } = require('../lib/logging');
const { sendMail, emailStyle } = require('../lib/email');
const {
  buildRouteDiagnostic,
  insertWithColumnFallback,
  isSchemaCompatibilityError,
} = require('../lib/schema');

const router = express.Router();

function resolveInvoicePdfPath(relativePath) {
  if (!relativePath) return null;
  return path.join(__dirname, '..', relativePath);
}

function renderInvoicePdf(res, invoice, adminCopy = false) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="boleto-${invoice.id}.pdf"`);

  const doc = new PDFDoc({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const amountFormatted = (invoice.amount_cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const dueFormatted = new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('pt-BR');
  const bankData = invoice.bank_data || {};
  const statusLabel = invoice.status === 'paid'
    ? 'PAGO'
    : invoice.status === 'overdue'
      ? 'VENCIDO'
      : invoice.status === 'cancelled'
        ? 'CANCELADO'
        : 'EM ABERTO';

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a5f').text('Recupera Empresas', { align: 'center' });
  doc.fontSize(13).font('Helvetica').fillColor('#374151').text(
    adminCopy ? 'BOLETO DE COBRANÇA — CÓPIA ADMINISTRATIVA' : 'BOLETO DE COBRANÇA',
    { align: 'center' }
  );
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E2E8F0').stroke();
  doc.moveDown(0.5);

  const field = (label, value) => {
    doc.fontSize(9).fillColor('#6B7280').font('Helvetica').text(label.toUpperCase());
    doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text(value || '-');
    doc.font('Helvetica').moveDown(0.4);
  };

  if (!adminCopy) field('Beneficiário', 'Recupera Empresas Consultoria Ltda');
  field('Descrição', invoice.description);
  field('Valor', amountFormatted);
  field('Vencimento', dueFormatted);
  field('Status', statusLabel);
  if (adminCopy) field('ID do Boleto', invoice.id);
  if (bankData.linha_digitavel) field('Linha Digitável', bankData.linha_digitavel);
  if (bankData.banco) field('Banco', bankData.banco);
  if (bankData.agencia) field('Agência / Conta', `${bankData.agencia} / ${bankData.conta}`);
  if (adminCopy && invoice.notes) field('Observações', invoice.notes);

  doc.moveDown();
  doc.fontSize(9).fillColor('#9CA3AF').text(
    adminCopy
      ? `Gerado em ${new Date().toLocaleString('pt-BR')}`
      : `Gerado em ${new Date().toLocaleString('pt-BR')} — ID: ${invoice.id}`,
    { align: 'center' }
  );
  doc.end();
}

router.get('/api/financial/internal-invoices', requireAuth, async (req, res) => {
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

router.get('/api/financial/internal-invoices/:id/pdf', (req, res, next) => {
  // Allow ?token= query param so email links work without browser auth session
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  requireAuth(req, res, next);
}, async (req, res) => {
  try {
    const { data: invoice } = await sb.from('re_invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!invoice) return res.status(404).json({ error: 'Boleto não encontrado.' });

    if (invoice.boleto_pdf_path) {
      const pdfPath = resolveInvoicePdfPath(invoice.boleto_pdf_path);
      if (pdfPath && fs.existsSync(pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleto-${invoice.id}.pdf"`);
        return fs.createReadStream(pdfPath).pipe(res);
      }
    }

    renderInvoicePdf(res, invoice, false);
  } catch (e) {
    console.error('[BOLETO PDF]', e.message);
    res.status(500).json({ error: 'Erro ao gerar PDF.' });
  }
});

router.get('/api/admin/invoices', requireAdmin, async (req, res) => {
  try {
    const { status, user_id, from, to, limit = '50', offset = '0' } = req.query;
    let query = sb.from('re_invoices')
      .select('*,re_users!re_invoices_user_id_fkey(name,email,company)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10))
      .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);
    if (status) query = query.eq('status', status);
    if (user_id) query = query.eq('user_id', user_id);
    if (from) query = query.gte('due_date', from);
    if (to) query = query.lte('due_date', to);
    const { data: invoices, count } = await query;
    res.json({ invoices: invoices || [], total: count || 0 });
  } catch (e) {
    console.error('[ADMIN INVOICES GET]', e.message);
    res.json({ invoices: [], total: 0 });
  }
});

router.post('/api/admin/invoices', requireAdmin, async (req, res) => {
  try {
    const { user_id, description, amount_cents, due_date, payment_method, bank_data, notes } = req.body;
    if (!user_id || !description || !amount_cents || !due_date) {
      return res.status(400).json({ error: 'user_id, description, amount_cents e due_date são obrigatórios.' });
    }

    const { data: invoiceUser, error: invoiceUserError } = await sb.from('re_users')
      .select('id,email,name,company')
      .eq('id', user_id)
      .single();
    if (invoiceUserError || !invoiceUser) {
      return res.status(400).json({
        error: 'Cliente informado não foi encontrado para a cobrança.',
        diagnostic: { route: '/api/admin/invoices', user_id },
      });
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
    const returningColumns = ['id', 'user_id', 'description', 'amount_cents', 'due_date', 'status', 'paid_at', 'payment_method', 'boleto_pdf_path', 'bank_data', 'notes', 'created_by', 'created_at', 'updated_at'];
    const insertAttempts = [
      { payload: basePayload, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'] },
      { payload: { ...basePayload, payment_method: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'] },
      { payload: { ...basePayload, created_by: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'] },
      { payload: { ...basePayload, bank_data: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'] },
      { payload: { ...basePayload, notes: null }, requiredColumns: ['user_id', 'description', 'amount_cents', 'due_date'] },
    ];

    let invoiceInsert = null;
    for (const attempt of insertAttempts) {
      invoiceInsert = await insertWithColumnFallback('re_invoices', attempt.payload, {
        requiredColumns: attempt.requiredColumns,
        returningColumns,
        requiredReturningColumns: ['id', 'user_id', 'description', 'amount_cents', 'due_date'],
      });
      if (!invoiceInsert.error) break;
      const message = String(invoiceInsert.error.message || '');
      if (
        (attempt.payload.payment_method === null || !/payment_method/i.test(message)) &&
        (attempt.payload.created_by === null || !/created_by/i.test(message)) &&
        (attempt.payload.bank_data === null || !/bank_data/i.test(message)) &&
        (attempt.payload.notes === null || !/notes/i.test(message))
      ) {
        continue;
      }
    }

    const { data: invoice, error } = invoiceInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_invoices', 'user_id', 'description', 'amount_cents', 'due_date', 'status', 'payment_method', 'bank_data', 'notes', 'created_by'])) {
        return res.status(503).json({
          error: 'Cobranças temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/invoices', error, insertAttempts.map((attempt) => ({
            payload: attempt.payload,
            requiredColumns: attempt.requiredColumns,
            returningColumns,
          }))),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    pushNotification(
      user_id,
      'payment',
      'Nova cobrança disponível',
      `${description} — vencimento: ${new Date(`${due_date}T12:00:00`).toLocaleDateString('pt-BR')}`,
      'invoice',
      invoice.id
    ).catch((pushError) => console.warn('[async]', pushError?.message));

    auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'admin',
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'create',
      after: { user_id, description, amount_cents, due_date },
    }).catch((auditError) => console.warn('[async]', auditError?.message));

    res.json({ success: true, invoice });
  } catch (e) {
    console.error('[ADMIN INVOICE POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
  try {
    const { status, paid_at, notes, bank_data } = req.body;
    const { data: before } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!before) return res.status(404).json({ error: 'Boleto não encontrado.' });

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (paid_at !== undefined) updates.paid_at = paid_at;
    if (notes !== undefined) updates.notes = notes;
    if (bank_data !== undefined) updates.bank_data = bank_data;

    const { data: invoice, error } = await sb.from('re_invoices')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    if (status && status !== before.status) {
      const labels = {
        paid: 'Pagamento confirmado',
        overdue: 'Boleto vencido',
        cancelled: 'Boleto cancelado',
      };
      if (labels[status]) {
        pushNotification(before.user_id, 'payment', labels[status], before.description, 'invoice', req.params.id)
          .catch((pushError) => console.warn('[async]', pushError?.message));
      }
    }

    auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'admin',
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'update',
      before,
      after: updates,
    }).catch((auditError) => console.warn('[async]', auditError?.message));

    res.json({ success: true, invoice });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
  try {
    const { data: before } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!before) return res.status(404).json({ error: 'Boleto não encontrado.' });

    await sb.from('re_invoices').update({ status: 'cancelled' }).eq('id', req.params.id);
    auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'admin',
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'cancel',
      before: { status: before.status },
      after: { status: 'cancelled' },
    }).catch((auditError) => console.warn('[async]', auditError?.message));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/invoices/:id/send-email', requireAdmin, async (req, res) => {
  try {
    const { data: invoice } = await sb.from('re_invoices')
      .select('*,re_users!re_invoices_user_id_fkey(name,email)')
      .eq('id', req.params.id)
      .single();
    if (!invoice) return res.status(404).json({ error: 'Boleto não encontrado.' });

    const client = invoice.re_users || {};
    const amountFormatted = ((invoice.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dueFormatted = new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('pt-BR');
    // Short-lived token (7 days) so the email link works without browser login
    const downloadToken = jwt.sign(
      { id: invoice.user_id, email: client.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const pdfUrl = `${BASE_URL}/api/financial/internal-invoices/${invoice.id}/pdf?token=${downloadToken}`;

    await sendMail(
      client.email,
      `Boleto disponível: ${invoice.description}`,
      `<p>Olá, ${client.name || 'Cliente'}!</p>
       <p>Um novo boleto está disponível no seu portal:</p>
       <ul>
         <li><strong>Descrição:</strong> ${invoice.description}</li>
         <li><strong>Valor:</strong> ${amountFormatted}</li>
         <li><strong>Vencimento:</strong> ${dueFormatted}</li>
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

router.get('/api/admin/invoices/:id/pdf', requireAdmin, async (req, res) => {
  try {
    const { data: invoice } = await sb.from('re_invoices').select('*').eq('id', req.params.id).single();
    if (!invoice) return res.status(404).json({ error: 'Boleto não encontrado.' });
    renderInvoicePdf(res, invoice, true);
  } catch (e) {
    console.error('[ADMIN BOLETO PDF]', e.message);
    res.status(500).json({ error: 'Erro ao gerar PDF.' });
  }
});

module.exports = router;