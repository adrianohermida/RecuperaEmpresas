'use strict';

const express = require('express');

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, sb } = require('../lib/config');
const { adjustCredits } = require('./agenda');
const { sendMail, emailStyle, emailWrapper } = require('../lib/email');

const router = express.Router();

router.post('/api/stripe/webhook', async (req, res) => {
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

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    console.log(`[STRIPE] invoice.paid: ${invoice.id} customer=${invoice.customer} amount=${invoice.amount_paid}`);
    if (invoice.customer) {
      const { data: user } = await sb.from('re_users')
        .select('email,name,company')
        .eq('stripe_customer_id', invoice.customer)
        .single();
      if (user) {
        sendMail(user.email, 'Pagamento confirmado — Recupera Empresas', emailWrapper(
          'Pagamento recebido',
          `<p>Olá, <b>${user.name || user.company || user.email}</b>!</p>
           <p>Confirmamos o recebimento do seu pagamento referente à fatura
              <b>${invoice.number || invoice.id}</b>
              no valor de <b>R$ ${(invoice.amount_paid / 100).toFixed(2).replace('.', ',')}</b>.</p>
           <p>Obrigado pela confiança.</p>`
        )).catch((error) => console.warn('[async]', error?.message));
      }
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    console.warn(`[STRIPE] invoice.payment_failed: ${invoice.id} customer=${invoice.customer}`);
    if (invoice.customer && invoice.hosted_invoice_url) {
      const { data: user } = await sb.from('re_users')
        .select('email,name,company')
        .eq('stripe_customer_id', invoice.customer)
        .single();
      if (user) {
        sendMail(user.email, 'Falha no pagamento — Recupera Empresas', emailWrapper(
          'Falha no pagamento',
          `<p>Olá, <b>${user.name || user.company || user.email}</b>!</p>
           <p>Não foi possível processar o pagamento da fatura <b>${invoice.number || invoice.id}</b>.</p>
           <p><a href="${invoice.hosted_invoice_url}" ${emailStyle('footerLink')}>Clique aqui para regularizar o pagamento.</a></p>`
        )).catch((error) => console.warn('[async]', error?.message));
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;