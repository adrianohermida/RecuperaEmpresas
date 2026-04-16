'use strict';
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { sb, EMAIL_TO, STRIPE_SECRET_KEY, FRESHCHAT_JWT_SECRET } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { sendMail, emailWrapper } = require('../lib/email');
const { freshdeskRequest } = require('../lib/crm');

router.get('/api/freshchat-token', requireAuth, (req, res) => {
  const name = req.user.name || req.user.full_name || '';
  const [firstName, ...rest] = name.split(' ');
  const token = jwt.sign({
    sub: req.user.email,
    first_name: firstName || '',
    last_name: rest.join(' ') || '',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }, FRESHCHAT_JWT_SECRET, { algorithm: 'HS256' });
  res.json({ token });
});

router.get('/api/support/tickets', requireAuth, async (req, res) => {
  const result = await freshdeskRequest(
    'GET',
    `tickets?email=${encodeURIComponent(req.user.email)}&include=stats&per_page=30`,
    null
  );
  const tickets = result.ok && Array.isArray(result.data) ? result.data : [];
  res.json({ tickets });
});

router.post('/api/support/ticket', requireAuth, async (req, res) => {
  const { subject, description } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'Assunto obrigatório.' });

  const result = await freshdeskRequest('POST', 'tickets', {
    subject: subject.trim(),
    description: (description || subject).trim(),
    email: req.user.email,
    name: req.user.name || req.user.email,
    priority: 2,
    status: 2,
    tags: ['portal'],
  });

  if (result.ok) return res.json({ success: true, ticket: result.data });
  res.status(503).json({ error: 'Suporte temporariamente indisponível. Tente novamente mais tarde.' });
});

router.get('/api/financial/invoices', requireAuth, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ invoices: [], stripeConfigured: false });

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);
    const user = req.user;

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = found.data[0]?.id || null;
      if (customerId) {
        await sb.from('re_users').update({ stripe_customer_id: customerId }).eq('id', user.id);
      }
    }
    if (!customerId) return res.json({ invoices: [], stripeConfigured: true });

    const [invoiceList, paymentIntentList] = await Promise.all([
      stripe.invoices.list({ customer: customerId, limit: 50 }),
      stripe.paymentIntents.list({ customer: customerId, limit: 50 }),
    ]);

    const invoices = invoiceList.data.map((invoice) => ({
      id: invoice.id,
      type: 'invoice',
      amount: (invoice.amount_due / 100).toFixed(2),
      amountPaid: (invoice.amount_paid / 100).toFixed(2),
      currency: invoice.currency.toUpperCase(),
      status: invoice.status,
      date: new Date(invoice.created * 1000).toISOString(),
      dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      pdfUrl: invoice.invoice_pdf || null,
      hostedUrl: invoice.hosted_invoice_url || null,
      description: invoice.description || invoice.lines?.data?.[0]?.description || 'Fatura',
    }));

    const payments = paymentIntentList.data
      .filter((payment) => payment.status === 'succeeded' && !invoices.find((invoice) => invoice.id === payment.invoice))
      .map((payment) => ({
        id: payment.id,
        type: 'payment',
        amount: (payment.amount / 100).toFixed(2),
        amountPaid: (payment.amount / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
        status: 'paid',
        date: new Date(payment.created * 1000).toISOString(),
        description: payment.description || 'Pagamento',
      }));

    const all = [...invoices, ...payments].sort((left, right) => right.date.localeCompare(left.date));
    res.json({ invoices: all, stripeConfigured: true });
  } catch (error) {
    console.error('[FINANCIAL]', error.message);
    res.json({ invoices: [], stripeConfigured: true, error: error.message });
  }
});

router.post('/api/financial/request-invoice', requireAuth, async (req, res) => {
  const { description } = req.body;

  await Promise.all([
    freshdeskRequest('POST', 'tickets', {
      subject: `2ª via boleto — ${req.user.company || req.user.name || req.user.email}`,
      description: `<p>Solicitação de 2ª via.</p>
        <p><b>Cliente:</b> ${req.user.name || ''}<br/><b>E-mail:</b> ${req.user.email}<br/>
        <b>Empresa:</b> ${req.user.company || '—'}</p>
        ${description ? `<p><b>Detalhe:</b> ${description}</p>` : ''}`,
      email: req.user.email,
      name: req.user.name || req.user.email,
      priority: 2,
      status: 2,
      tags: ['financeiro', '2a-via'],
    }),
    sendMail(
      EMAIL_TO,
      `Solicitação 2ª via — ${req.user.company || req.user.name || req.user.email}`,
      emailWrapper('Solicitação de fatura', `
        <p>Cliente <b>${req.user.name || ''}</b> (${req.user.email}) solicita 2ª via do boleto.</p>
        ${description ? `<p><b>Detalhe:</b> ${description}</p>` : ''}
      `)
    ),
  ]).catch((error) => console.warn('[async]', error?.message));

  res.json({ success: true, message: 'Solicitação enviada. Nossa equipe entrará em contato.' });
});

router.get('/api/admin/financial', requireAdmin, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ configured: false, clients: [], totalRevenue: 0 });

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);

    const { data: users } = await sb.from('re_users')
      .select('id, name, email, company, stripe_customer_id')
      .eq('is_admin', false);

    const results = await Promise.all((users || []).map(async (user) => {
      try {
        if (!user.stripe_customer_id) {
          return {
            userId: user.id,
            name: user.name,
            email: user.email,
            company: user.company,
            totalPaid: 0,
            paymentsCount: 0,
            lastPaymentDate: null,
          };
        }

        const paymentIntentList = await stripe.paymentIntents.list({ customer: user.stripe_customer_id, limit: 20 });
        const paid = paymentIntentList.data.filter((payment) => payment.status === 'succeeded');
        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          company: user.company,
          customerId: user.stripe_customer_id,
          totalPaid: paid.reduce((sum, payment) => sum + payment.amount, 0) / 100,
          paymentsCount: paid.length,
          lastPaymentDate: paid[0] ? new Date(paid[0].created * 1000).toISOString() : null,
        };
      } catch {
        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          company: user.company,
          totalPaid: 0,
          paymentsCount: 0,
          lastPaymentDate: null,
        };
      }
    }));

    const totalRevenue = results.reduce((sum, client) => sum + (client.totalPaid || 0), 0);
    res.json({ configured: true, clients: results, totalRevenue });
  } catch (error) {
    console.error('[ADMIN FINANCIAL]', error.message);
    res.json({ configured: false, clients: [], totalRevenue: 0, error: error.message });
  }
});

router.get('/api/admin/client/:id/financial', requireAdmin, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ invoices: [], configured: false });

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(STRIPE_SECRET_KEY);
    const { data: user } = await sb.from('re_users').select('stripe_customer_id, email').eq('id', req.params.id).single();
    if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = found.data[0]?.id || null;
    }
    if (!customerId) return res.json({ invoices: [], configured: true });

    const paymentIntentList = await stripe.paymentIntents.list({ customer: customerId, limit: 30 });
    const invoices = paymentIntentList.data.map((payment) => ({
      id: payment.id,
      amount: (payment.amount / 100).toFixed(2),
      currency: payment.currency.toUpperCase(),
      status: payment.status,
      date: new Date(payment.created * 1000).toISOString(),
      description: payment.description || 'Pagamento',
    }));

    res.json({ invoices, configured: true });
  } catch (error) {
    res.json({ invoices: [], configured: true, error: error.message });
  }
});

module.exports = router;