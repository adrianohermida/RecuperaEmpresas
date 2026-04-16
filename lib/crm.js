'use strict';
const https = require('https');
const { FRESHDESK_HOST, FD_AUTH, FRESHSALES_HOST, FRESHSALES_KEY } = require('./config');

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

// ─── Freshsales CRM ──────────────────────────────────────────────────────────
function freshsalesRequest(method, endpoint, body) {
  return new Promise((resolve) => {
    if (!FRESHSALES_KEY) return resolve({ ok: false, data: {} });
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: FRESHSALES_HOST,
      path: `/crm/sales/api/${endpoint}`,
      method,
      headers: {
        'Authorization': `Token token=${FRESHSALES_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ ok: r.statusCode < 300, status: r.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: r.statusCode < 300, data: {} }); }
      });
    });
    req.on('error', () => resolve({ ok: false, data: {} }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function syncFreshsalesContact(email, name, company, phone, extra = {}) {
  if (!FRESHSALES_KEY) return null;
  const search = await freshsalesRequest('GET',
    `contacts/search?q=${encodeURIComponent(email)}&include=owner`, null);
  const existing = search.ok && search.data?.contacts?.[0];

  const [firstName, ...rest] = (name || email).split(' ');
  const payload = {
    contact: {
      first_name:   firstName,
      last_name:    rest.join(' ') || '',
      email,
      work_number:  phone || undefined,
      job_title:    extra.job_title || undefined,
      company_name: company || undefined,
    },
  };

  if (existing) {
    const upd = await freshsalesRequest('PUT', `contacts/${existing.id}`, payload);
    return upd.ok ? (upd.data?.contact?.id || existing.id) : existing.id;
  }
  const created = await freshsalesRequest('POST', 'contacts', payload);
  return created.ok ? created.data?.contact?.id : null;
}

async function createFreshsalesDeal(contactId, name, amount) {
  if (!FRESHSALES_KEY || !contactId) return null;
  const result = await freshsalesRequest('POST', 'deals', {
    deal: {
      name,
      amount: amount || 0,
      contacts_list: [{ id: contactId }],
    },
  });
  return result.ok ? result.data?.deal?.id : null;
}

module.exports = {
  freshdeskRequest,
  createFreshdeskTicket,
  createFreshdeskContact,
  addFreshdeskNote,
  updateFreshdeskTicket,
  freshsalesRequest,
  syncFreshsalesContact,
  createFreshsalesDeal,
};
