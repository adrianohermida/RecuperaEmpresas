import { auditLog, emailWrapper, getBaseUrl, pushNotification, queueSideEffect, sendMail } from '../lib/effects.mjs';
import { json, methodNotAllowed, readJson } from '../lib/http.mjs';

const FORM_CONFIG_DEFAULTS = {
  steps: [
    { id: 1, title: 'Consentimento LGPD', description: '', enabled: true, required: true },
    { id: 2, title: 'Dados da Empresa', description: '', enabled: true, required: true },
    { id: 3, title: 'Socios', description: '', enabled: true, required: true },
    { id: 4, title: 'Estrutura Operacional', description: '', enabled: true, required: false },
    { id: 5, title: 'Quadro de Funcionarios', description: '', enabled: true, required: false },
    { id: 6, title: 'Ativos', description: '', enabled: true, required: false },
    { id: 7, title: 'Dados Financeiros', description: '', enabled: true, required: true },
    { id: 8, title: 'Dividas e Credores', description: '', enabled: true, required: true },
    { id: 9, title: 'Historico da Crise', description: '', enabled: true, required: false },
    { id: 10, title: 'Diagnostico Estrategico', description: '', enabled: true, required: false },
    { id: 11, title: 'Mercado e Operacao', description: '', enabled: true, required: false },
    { id: 12, title: 'Expectativas e Estrategia', description: '', enabled: true, required: false },
    { id: 13, title: 'Documentos', description: '', enabled: true, required: false },
    { id: 14, title: 'Confirmacao e Envio', description: '', enabled: true, required: true },
  ],
  welcomeMessage: 'Preencha as informacoes da sua empresa para que possamos elaborar o Business Plan de recuperacao.',
  lastUpdated: null,
};

const PLAN_CHAPTERS = [
  { id: 1, title: 'Sumario Executivo' },
  { id: 2, title: 'Perfil da Empresa' },
  { id: 3, title: 'Analise do Setor e Mercado' },
  { id: 4, title: 'Diagnostico Financeiro' },
  { id: 5, title: 'Analise de Endividamento' },
  { id: 6, title: 'Plano de Reestruturacao Operacional' },
  { id: 7, title: 'Plano Financeiro e Projecoes' },
  { id: 8, title: 'Cronograma e Gestao de Riscos' },
];

async function maybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function list(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function listSafe(query, fallback = []) {
  try {
    return await list(query);
  } catch (error) {
    console.warn('[worker:admin-read-models:listSafe]', error?.message || error);
    return fallback;
  }
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function findUserById(sb, id) {
  return maybeSingle(sb.from('re_users').select('*').eq('id', id));
}

async function readOnboarding(sb, userId) {
  return (await maybeSingle(sb.from('re_onboarding').select('*').eq('user_id', userId))) || {
    step: 1,
    status: 'nao_iniciado',
    completed: false,
    data: {},
  };
}

async function readTasks(sb, userId) {
  return list(sb.from('re_tasks').select('*').eq('user_id', userId).order('created_at'));
}

async function readMessages(sb, userId) {
  return list(sb.from('re_messages').select('*').eq('user_id', userId).order('ts'));
}

async function readAppointments(sb, userId) {
  return list(sb.from('re_appointments').select('*').eq('user_id', userId).order('date'));
}

async function readPlan(sb, userId) {
  const rows = await list(sb.from('re_plan_chapters').select('*').eq('user_id', userId).order('chapter_id'));
  if (rows.length) {
    return {
      chapters: rows.map((row) => ({
        id: row.chapter_id,
        title: row.title,
        status: row.status,
        comments: row.comments || [],
      })),
    };
  }
  return { chapters: PLAN_CHAPTERS.map((chapter) => ({ ...chapter, status: 'pendente', comments: [] })) };
}

async function handleClients(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const users = await list(
    context.sb.from('re_users').select('*').eq('is_admin', false).order('created_at', { ascending: false })
  );
  const clients = await Promise.all(users.map(async (user) => {
    const [onboarding, tasks] = await Promise.all([
      readOnboarding(context.sb, user.id),
      readTasks(context.sb, user.id),
    ]);
    return {
      id: user.id,
      name: user.name || '',
      email: user.email,
      company: user.company || '',
      createdAt: user.created_at,
      freshdeskTicketId: user.freshdesk_ticket_id || null,
      step: onboarding.step || 1,
      status: onboarding.status || 'nao_iniciado',
      completed: Boolean(onboarding.completed),
      progress: Math.round((((onboarding.step || 1) - 1) / 14) * 100),
      lastActivity: onboarding.last_activity || user.created_at,
      pendingTasks: tasks.filter((task) => task.status === 'pendente').length,
    };
  }));
  return json({ clients });
}

async function handleClientDetail(request, context) {
  if (request.method === 'DELETE') {
    const body = await readJson(request);
    if (body.confirm !== 'CONFIRMAR_EXCLUSAO') {
      return json({ error: 'Para excluir, envie { confirm: "CONFIRMAR_EXCLUSAO" } no body.' }, { status: 400 });
    }

    const user = await findUserById(context.sb, context.params.clientId);
    if (!user) return json({ error: 'Cliente nao encontrado.' }, { status: 404 });
    if (user.is_admin) return json({ error: 'Nao e possivel excluir uma conta admin.' }, { status: 403 });

    queueSideEffect(context, () => auditLog(context.sb, {
      actorId: context.user.id,
      actorEmail: context.user.email,
      actorRole: 'admin',
      entityType: 're_users',
      entityId: context.params.clientId,
      action: 'delete',
      before: { email: user.email, company: user.company },
    }), 'audit-log');

    const { error } = await context.sb.from('re_users').delete().eq('id', context.params.clientId);
    if (error) return json({ error: error.message }, { status: 500 });

    queueSideEffect(context, () => sendMail(context.env, {
      to: user.email,
      subject: 'Conta encerrada - Recupera Empresas',
      html: emailWrapper('Conta encerrada',
        `<p>Ola, ${user.name || user.email}!</p>
         <p>Sua conta no portal Recupera Empresas foi encerrada pelo consultor responsavel.</p>
         <p>Todos os seus dados foram removidos conforme a LGPD.</p>
         <p>Se tiver duvidas, entre em contato com nossa equipe.</p>`),
    }), 'delete-account-email');

    return json({ success: true, message: 'Conta excluida com sucesso.' });
  }

  if (request.method !== 'GET') return methodNotAllowed();
  const user = await findUserById(context.sb, context.params.clientId);
  if (!user) return json({ error: 'Cliente nao encontrado.' }, { status: 404 });

  const [onboarding, tasks, plan, messages, appointments] = await Promise.all([
    readOnboarding(context.sb, user.id),
    readTasks(context.sb, user.id),
    readPlan(context.sb, user.id),
    readMessages(context.sb, user.id),
    readAppointments(context.sb, user.id),
  ]);

  return json({ user, onboarding, tasks, plan, messages, appointments });
}

async function handleClientBookings(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  let bookings = await listSafe(
    context.sb
      .from('re_bookings')
      .select('id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,notes,created_at,re_agenda_slots(id,starts_at,ends_at,title,location,meeting_link)')
      .eq('user_id', context.params.clientId)
      .order('created_at', { ascending: false })
      .limit(30)
  );
  if (!bookings.length) {
    bookings = await listSafe(
      context.sb
        .from('re_bookings')
        .select('id,slot_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,notes,created_at')
        .eq('user_id', context.params.clientId)
        .order('created_at', { ascending: false })
        .limit(30)
    );
  }
  return json({ bookings });
}

async function handleClientDocuments(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const documents = await listSafe(
    context.sb
      .from('re_documents')
      .select('*')
      .eq('user_id', context.params.clientId)
      .order('created_at', { ascending: false })
  );
  return json({ documents });
}

async function handleClientMembers(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const members = await listSafe(
    context.sb
      .from('re_company_users')
      .select('id,name,email,role,active,department_id,job_title,phone,last_login,invited_at,created_at')
      .eq('company_id', context.params.clientId)
      .order('created_at', { ascending: false })
  );
  return json({
    members: members.map((member) => ({
      ...member,
      name: member.name || member.email || 'Membro',
      role: member.role || 'visualizador',
      active: member.active !== false,
    })),
  });
}

async function handleClientSuppliers(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const [suppliers, contracts] = await Promise.all([
    listSafe(
      context.sb
        .from('re_suppliers')
        .select('*')
        .eq('company_id', context.params.clientId)
        .order('name', { ascending: true })
    ),
    listSafe(
      context.sb
        .from('re_supplier_contracts')
        .select('*,re_suppliers(id,name)')
        .eq('company_id', context.params.clientId)
        .order('created_at', { ascending: false })
    ),
  ]);
  return json({ suppliers, contracts });
}

async function handleClientFinancial(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const invoices = await list(
    context.sb
      .from('re_invoices')
      .select('id,description,amount_cents,due_date,status,paid_at,payment_method,bank_data,created_at')
      .eq('user_id', context.params.clientId)
      .order('created_at', { ascending: false })
  );
  return json({ invoices, configured: true });
}

async function handleFinancial(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const users = await list(
    context.sb.from('re_users').select('id,name,email,company').eq('is_admin', false).order('created_at', { ascending: false })
  );
  const invoices = await list(
    context.sb.from('re_invoices').select('user_id,amount_cents,status,paid_at,created_at').order('created_at', { ascending: false }).limit(5000)
  );

  const byUser = new Map();
  for (const invoice of invoices) {
    const key = invoice.user_id;
    if (!key) continue;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(invoice);
  }

  const clients = users.map((user) => {
    const userInvoices = byUser.get(user.id) || [];
    const paid = userInvoices.filter((invoice) => invoice.status === 'paid');
    const totalPaid = paid.reduce((sum, invoice) => sum + Number(invoice.amount_cents || 0), 0) / 100;
    const lastPayment = paid
      .map((invoice) => invoice.paid_at || invoice.created_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      totalPaid,
      paymentsCount: paid.length,
      lastPaymentDate: lastPayment,
    };
  });

  const totalRevenue = clients.reduce((sum, client) => sum + client.totalPaid, 0);
  return json({ configured: true, clients, totalRevenue });
}

async function handleFormConfig(request) {
  if (request.method !== 'GET') return methodNotAllowed();
  return json(FORM_CONFIG_DEFAULTS);
}

async function handleAuditLog(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const url = new URL(request.url);
  const entityType = url.searchParams.get('entity_type');
  const actorId = url.searchParams.get('actor_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

  let query = context.sb
    .from('re_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (entityType) query = query.eq('entity_type', entityType);
  if (actorId) query = query.eq('actor_id', actorId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const entries = await list(query);

  if (context.params.action === 'export') {
    const header = ['Data/Hora', 'Actor ID', 'E-mail', 'Acao', 'Entidade', 'Entidade ID', 'Detalhes'];
    const rows = entries.map((entry) => [
      new Date(entry.created_at || entry.ts || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      entry.actor_id || '',
      entry.actor_email || '',
      entry.action || '',
      entry.entity_type || '',
      entry.entity_id || '',
      entry.after_data ? JSON.stringify(entry.after_data) : (entry.before_data ? JSON.stringify(entry.before_data) : ''),
    ].map(csvEscape).join(','));
    return new Response(`\uFEFF${[header.join(','), ...rows].join('\r\n')}`, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit_log_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return json({ entries });
}

async function handleInvoices(request, context) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const invoiceMatch = pathname.match(/^\/api\/admin\/invoices(?:\/(?<id>[^/]+)(?:\/(?<action>pdf|send-email))?)?$/);
  const invoiceId = invoiceMatch?.groups?.id || null;
  const action = invoiceMatch?.groups?.action || null;

  if (!invoiceId && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.user_id || !body.description || !body.amount_cents || !body.due_date) {
      return json({ error: 'user_id, description, amount_cents e due_date sao obrigatorios.' }, { status: 400 });
    }

    const invoiceUser = await maybeSingle(
      context.sb.from('re_users').select('id,email,name,company').eq('id', body.user_id)
    );
    if (!invoiceUser) {
      return json({ error: 'Cliente informado nao foi encontrado para a cobranca.' }, { status: 400 });
    }

    const { data: invoice, error } = await context.sb.from('re_invoices').insert({
      user_id: body.user_id,
      description: String(body.description).trim(),
      amount_cents: Number.parseInt(body.amount_cents, 10),
      due_date: body.due_date,
      status: 'pending',
      payment_method: body.payment_method || 'boleto',
      bank_data: body.bank_data || null,
      notes: body.notes || null,
      created_by: context.user.id,
    }).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });

    queueSideEffect(context, async () => {
      await pushNotification(
        context.sb,
        body.user_id,
        'payment',
        'Nova cobranca disponivel',
        `${invoice.description} — vencimento: ${new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('pt-BR')}`,
        'invoice',
        invoice.id
      );

      await auditLog(context.sb, {
        actorId: context.user.id,
        actorEmail: context.user.email,
        actorRole: 'admin',
        entityType: 'invoice',
        entityId: invoice.id,
        action: 'create',
        after: {
          user_id: invoice.user_id,
          description: invoice.description,
          amount_cents: invoice.amount_cents,
          due_date: invoice.due_date,
        },
      });
    }, 'admin-invoice-create');

    return json({ success: true, invoice });
  }

  if (invoiceId && request.method === 'PUT') {
    const body = await readJson(request);
    const before = await maybeSingle(context.sb.from('re_invoices').select('*').eq('id', invoiceId));
    if (!before) return json({ error: 'Boleto nao encontrado.' }, { status: 404 });

    const updates = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.paid_at !== undefined) updates.paid_at = body.paid_at;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.bank_data !== undefined) updates.bank_data = body.bank_data;

    const { data: invoice, error } = await context.sb.from('re_invoices').update(updates).eq('id', invoiceId).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });

    queueSideEffect(context, async () => {
      if (updates.status && updates.status !== before.status) {
        const labels = {
          paid: 'Pagamento confirmado',
          overdue: 'Boleto vencido',
          cancelled: 'Boleto cancelado',
        };
        if (labels[updates.status]) {
          await pushNotification(context.sb, before.user_id, 'payment', labels[updates.status], before.description, 'invoice', invoiceId);
        }
      }

      await auditLog(context.sb, {
        actorId: context.user.id,
        actorEmail: context.user.email,
        actorRole: 'admin',
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'update',
        before,
        after: updates,
      });
    }, 'admin-invoice-update');

    return json({ success: true, invoice });
  }

  if (invoiceId && request.method === 'DELETE') {
    const before = await maybeSingle(context.sb.from('re_invoices').select('*').eq('id', invoiceId));
    if (!before) return json({ error: 'Boleto nao encontrado.' }, { status: 404 });

    const { error } = await context.sb.from('re_invoices').update({ status: 'cancelled' }).eq('id', invoiceId);
    if (error) return json({ error: error.message }, { status: 500 });

    queueSideEffect(context, () => auditLog(context.sb, {
      actorId: context.user.id,
      actorEmail: context.user.email,
      actorRole: 'admin',
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'cancel',
      before: { status: before.status },
      after: { status: 'cancelled' },
    }), 'admin-invoice-cancel');

    return json({ success: true });
  }

  if (invoiceId && action === 'send-email' && request.method === 'POST') {
    const invoice = await maybeSingle(
      context.sb.from('re_invoices').select('*,re_users!re_invoices_user_id_fkey(name,email)').eq('id', invoiceId)
    );
    if (!invoice) return json({ error: 'Boleto nao encontrado.' }, { status: 404 });

    const client = invoice.re_users || {};
    const amountFormatted = ((invoice.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dueFormatted = new Date(`${invoice.due_date}T12:00:00`).toLocaleDateString('pt-BR');
    const portalUrl = `${getBaseUrl(context.env)}/dashboard.html`;

    queueSideEffect(context, async () => {
      await sendMail(context.env, {
        to: client.email,
        subject: `Boleto disponivel: ${invoice.description}`,
        html: emailWrapper('Nova cobranca disponivel', `
          <p>Ola, ${client.name || 'Cliente'}!</p>
          <p>Uma nova cobranca foi disponibilizada no seu portal:</p>
          <ul>
            <li><strong>Descricao:</strong> ${invoice.description}</li>
            <li><strong>Valor:</strong> ${amountFormatted}</li>
            <li><strong>Vencimento:</strong> ${dueFormatted}</li>
          </ul>
          <p><a href="${portalUrl}">Acessar portal</a></p>
        `),
      });
      await context.sb.from('re_invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', invoiceId);
    }, 'admin-invoice-email');

    return json({ success: true });
  }

  if (request.method !== 'GET') return methodNotAllowed();

  const status = url.searchParams.get('status');
  const userId = url.searchParams.get('user_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

  let query = context.sb
    .from('re_invoices')
    .select('*,re_users!re_invoices_user_id_fkey(name,email,company)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) query = query.eq('status', status);
  if (userId) query = query.eq('user_id', userId);
  if (from) query = query.gte('due_date', from);
  if (to) query = query.lte('due_date', to);

  const { data, error, count } = await query;
  if (error) throw error;

  if (invoiceId && action === 'pdf') {
    const invoice = (data || []).find((item) => item.id === invoiceId)
      || await maybeSingle(context.sb.from('re_invoices').select('*').eq('id', invoiceId));
    if (!invoice) return json({ error: 'Boleto nao encontrado.' }, { status: 404 });
    return json({
      error: 'Geracao de PDF ainda nao portada para o Worker.',
      invoice,
    }, { status: 501 });
  }

  return json({ invoices: data || [], total: count || 0 });
}

async function handleServices(request, context) {
  const pathname = new URL(request.url).pathname;
  const serviceId = pathname.match(/^\/api\/admin\/services(?:\/(?<id>[^/]+))?$/)?.groups?.id || null;

  if (!serviceId && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.name || !body.price_cents) return json({ error: 'name e price_cents sao obrigatorios.' }, { status: 400 });

    const parsedPriceCents = parseInt(body.price_cents, 10);
    const parsedPrice = parsedPriceCents / 100;
    const { data: service, error } = await context.sb
      .from('re_services')
      .insert({
        name: body.name,
        title: body.name,
        description: body.description || null,
        category: body.category || null,
        price_cents: parsedPriceCents,
        price: parsedPrice,
        delivery_days: body.delivery_days || null,
        features: body.features || null,
        featured: !!body.featured,
        journey_id: body.journey_id || null,
        active: true,
        created_by: context.user.id,
      })
      .select('id,name,title,description,category,price_cents,price,delivery_days,features,featured,journey_id,active,created_by,created_at,updated_at')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });

    queueSideEffect(context, () => auditLog(context.sb, {
      actorId: context.user.id,
      actorEmail: context.user.email,
      actorRole: 'admin',
      entityType: 'service',
      entityId: service.id,
      action: 'create',
      after: { name: body.name, price_cents: parsedPriceCents },
    }), 'audit-log');

    return json({ success: true, service });
  }

  if (serviceId && request.method === 'PUT') {
    const body = await readJson(request);
    const updates = {};
    if (body.active !== undefined) updates.active = body.active;
    if (body.name !== undefined) {
      updates.name = body.name;
      updates.title = body.name;
    }
    if (body.description !== undefined) updates.description = body.description;
    if (body.price_cents !== undefined) {
      updates.price_cents = parseInt(body.price_cents, 10);
      updates.price = parseInt(body.price_cents, 10) / 100;
    }
    if (body.category !== undefined) updates.category = body.category;
    if (body.featured !== undefined) updates.featured = body.featured;
    if (body.journey_id !== undefined) updates.journey_id = body.journey_id || null;

    const { data: service, error } = await context.sb
      .from('re_services')
      .update(updates)
      .eq('id', serviceId)
      .select('id,name,title,description,category,price_cents,price,delivery_days,features,featured,journey_id,active,created_by,created_at,updated_at')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, service });
  }

  if (request.method !== 'GET') return methodNotAllowed();
  const services = await list(
    context.sb
      .from('re_services')
      .select('id,name,title,description,category,price_cents,price,delivery_days,features,featured,journey_id,active,created_by,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(500)
  );
  return json({ services });
}

async function handleServiceOrders(request, context) {
  const pathname = new URL(request.url).pathname;
  const orderId = pathname.match(/^\/api\/admin\/service-orders(?:\/(?<id>[^/]+))?$/)?.groups?.id || null;

  if (orderId && request.method === 'PUT') {
    const body = await readJson(request);
    const updates = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
    if (body.delivered_at !== undefined) updates.delivered_at = body.delivered_at;
    if (body.status === 'active') updates.activated_at = new Date().toISOString();
    if (body.status === 'delivered') updates.completed_at = new Date().toISOString();
    if (body.status === 'cancelled') updates.cancelled_at = new Date().toISOString();

    const { data: order, error } = await context.sb
      .from('re_service_orders')
      .update(updates)
      .eq('id', orderId)
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });

    const orderDetails = await maybeSingle(
      context.sb.from('re_service_orders').select('user_id,re_services(id,name,title,journey_id)').eq('id', orderId)
    );
    const serviceName = orderDetails?.re_services?.name || orderDetails?.re_services?.title || 'Servico';

    if (body.status === 'active' && orderDetails?.re_services?.journey_id && orderDetails?.user_id) {
      queueSideEffect(context, () => context.sb.from('re_journey_assignments').upsert({
        journey_id: orderDetails.re_services.journey_id,
        user_id: orderDetails.user_id,
        assigned_by: context.user.id,
        status: 'active',
        notes: `Ativado pelo consultor via pedido de servico "${serviceName}"`,
      }, { onConflict: 'journey_id,user_id' }), 'journey-assignment');
    }

    if (body.status === 'active') {
      queueSideEffect(context, () => pushNotification(
        context.sb,
        orderDetails?.user_id,
        'service',
        'Servico ativo!',
        `"${serviceName}" foi ativado. Acesse Jornadas para ver as etapas.`,
        'service_order',
        orderId
      ), 'service-order-notification');
    }

    if (body.status === 'delivered') {
      queueSideEffect(context, () => pushNotification(
        context.sb,
        orderDetails?.user_id,
        'service',
        'Servico entregue!',
        `"${serviceName}" foi concluido e entregue.`,
        'service_order',
        orderId
      ), 'service-order-notification');
    }

    return json({ success: true, order });
  }

  if (request.method !== 'GET') return methodNotAllowed();
  const orders = await list(
    context.sb
      .from('re_service_orders')
      .select('*,re_users!re_service_orders_user_id_fkey(name,email),re_services(name,category,title)')
      .order('created_at', { ascending: false })
      .limit(500)
  );
  return json({ orders });
}

async function loadFullForm(sb, formId) {
  const form = await maybeSingle(sb.from('re_forms').select('*').eq('id', formId));
  if (!form) return null;

  const [pages, questions, logic] = await Promise.all([
    list(sb.from('re_form_pages').select('*').eq('form_id', formId).order('order_index')),
    list(sb.from('re_form_questions').select('*').eq('form_id', formId).order('order_index')),
    list(sb.from('re_form_logic').select('*').eq('form_id', formId)),
  ]);

  return {
    ...form,
    pages: pages.map((page) => ({
      ...page,
      questions: questions.filter((question) => question.page_id === page.id).sort((a, b) => a.order_index - b.order_index),
    })),
    questions,
    logic,
  };
}

async function handleForms(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  if (context.params.id) {
    const form = await loadFullForm(context.sb, context.params.id);
    if (!form) return json({ error: 'Formulario nao encontrado.' }, { status: 404 });
    return json({ form });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const status = url.searchParams.get('status');
  let query = context.sb
    .from('re_forms')
    .select('id,title,description,type,status,settings,linked_plan_chapter,created_by,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);
  const forms = await list(query);

  const ids = forms.map((form) => form.id);
  let responses = [];
  if (ids.length) {
    responses = await list(context.sb.from('re_form_responses').select('form_id,status').in('form_id', ids).eq('status', 'completed'));
  }
  const counts = {};
  for (const response of responses) counts[response.form_id] = (counts[response.form_id] || 0) + 1;
  return json({ forms: forms.map((form) => ({ ...form, response_count: counts[form.id] || 0 })) });
}

async function handleJourneys(request, context) {
  const pathname = new URL(request.url).pathname;
  const journeyMatch = pathname.match(/^\/api\/admin\/journeys(?:\/(?<id>[^/]+)(?:\/(?<section>steps|assignments)(?:\/(?<itemId>[^/]+)(?:\/(?<subaction>progress|complete-step))?)?)?)?$/);
  const id = journeyMatch?.groups?.id || null;
  const section = journeyMatch?.groups?.section || null;
  const itemId = journeyMatch?.groups?.itemId || null;
  const subaction = journeyMatch?.groups?.subaction || null;

  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.name) return json({ error: 'Nome e obrigatorio.' }, { status: 400 });
    const { data, error } = await context.sb.from('re_journeys').insert({
      name: body.name,
      description: body.description || null,
      status: body.status || 'draft',
      created_by: context.user.id,
    }).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && !section && request.method === 'PUT') {
    const body = await readJson(request);
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    const { data, error } = await context.sb.from('re_journeys').update(updates).eq('id', id).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && !section && request.method === 'DELETE') {
    const journey = await maybeSingle(context.sb.from('re_journeys').select('is_system').eq('id', id));
    if (journey?.is_system) return json({ error: 'Jornadas do sistema nao podem ser excluidas.' }, { status: 403 });
    const { error } = await context.sb.from('re_journeys').delete().eq('id', id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  if (id && section === 'steps' && !itemId && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.title) return json({ error: 'Titulo da etapa e obrigatorio.' }, { status: 400 });
    const { count } = await context.sb.from('re_journey_steps').select('id', { count: 'exact', head: true }).eq('journey_id', id);
    const { data, error } = await context.sb.from('re_journey_steps').insert({
      journey_id: id,
      form_id: body.form_id || null,
      title: body.title,
      description: body.description || null,
      order_index: count || 0,
      is_optional: !!body.is_optional,
      unlock_condition: body.unlock_condition || {},
    }).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && section === 'steps' && itemId === 'reorder' && request.method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body.order)) return json({ error: 'order deve ser um array.' }, { status: 400 });
    for (const entry of body.order) {
      await context.sb.from('re_journey_steps').update({ order_index: entry.order_index }).eq('id', entry.id).eq('journey_id', id);
    }
    return json({ success: true });
  }

  if (id && section === 'steps' && itemId && request.method === 'PUT') {
    const body = await readJson(request);
    const updates = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.form_id !== undefined) updates.form_id = body.form_id || null;
    if (body.is_optional !== undefined) updates.is_optional = !!body.is_optional;
    if (body.order_index !== undefined) updates.order_index = body.order_index;
    if (body.unlock_condition !== undefined) updates.unlock_condition = body.unlock_condition;
    const { data, error } = await context.sb.from('re_journey_steps').update(updates).eq('id', itemId).eq('journey_id', id).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && section === 'steps' && itemId && request.method === 'DELETE') {
    const { error } = await context.sb.from('re_journey_steps').delete().eq('id', itemId).eq('journey_id', id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  if (id && section === 'assignments' && !itemId && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.user_id) return json({ error: 'user_id e obrigatorio.' }, { status: 400 });
    const { data, error } = await context.sb.from('re_journey_assignments').upsert({
      journey_id: id,
      user_id: body.user_id,
      assigned_by: context.user.id,
      status: 'active',
      notes: body.notes || null,
    }, { onConflict: 'journey_id,user_id' }).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && section === 'assignments' && itemId && !subaction && request.method === 'PUT') {
    const body = await readJson(request);
    const updates = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.current_step_index !== undefined) updates.current_step_index = body.current_step_index;
    if (body.status === 'completed') updates.completed_at = new Date().toISOString();
    const { data, error } = await context.sb.from('re_journey_assignments').update(updates).eq('id', itemId).select().single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json(data);
  }

  if (id && section === 'assignments' && itemId && !subaction && request.method === 'DELETE') {
    const { error } = await context.sb.from('re_journey_assignments').delete().eq('id', itemId).eq('journey_id', id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  if (id && section === 'assignments' && itemId && subaction === 'complete-step' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.step_id) return json({ error: 'step_id e obrigatorio.' }, { status: 400 });

    await context.sb.from('re_journey_step_completions').upsert({
      assignment_id: itemId,
      step_id: body.step_id,
      form_response_id: body.form_response_id || null,
      notes: body.notes || null,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,step_id' });

    const steps = await list(context.sb.from('re_journey_steps').select('id,order_index').eq('journey_id', id).order('order_index'));
    const completedIdx = steps.findIndex((step) => step.id === body.step_id);
    const nextIdx = completedIdx + 1;
    if (nextIdx < steps.length) {
      await context.sb.from('re_journey_assignments').update({ current_step_index: nextIdx }).eq('id', itemId);
    } else {
      await context.sb.from('re_journey_assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', itemId);
    }
    return json({ success: true });
  }

  if (request.method !== 'GET') return methodNotAllowed();
  const asnId = section === 'assignments' ? itemId : null;

  if (!id) {
    const journeys = await list(context.sb.from('re_journeys').select('*').order('created_at', { ascending: false }));
    return json(journeys);
  }

  if (asnId) {
    const assignment = await maybeSingle(
      context.sb.from('re_journey_assignments').select('*,re_users(name,email)').eq('id', asnId)
    );
    if (!assignment) return json({ error: 'Atribuicao nao encontrada.' }, { status: 404 });
    const [steps, completions] = await Promise.all([
      list(context.sb.from('re_journey_steps').select('*,re_forms(id,title)').eq('journey_id', id).order('order_index')),
      list(context.sb.from('re_journey_step_completions').select('step_id,completed_at,form_response_id').eq('assignment_id', asnId)),
    ]);
    const completionMap = Object.fromEntries(completions.map((item) => [item.step_id, item]));
    return json({
      assignment,
      steps: steps.map((step) => ({
        ...step,
        completed: Boolean(completionMap[step.id]),
        completed_at: completionMap[step.id]?.completed_at || null,
        form_response_id: completionMap[step.id]?.form_response_id || null,
      })),
    });
  }

  if (section === 'assignments' && !asnId) {
    const assignments = await list(
      context.sb.from('re_journey_assignments').select('*,re_users(id,name,email,company)').eq('journey_id', id).order('assigned_at', { ascending: false })
    );
    return json(assignments);
  }

  const journey = await maybeSingle(context.sb.from('re_journeys').select('*').eq('id', id));
  if (!journey) return json({ error: 'Jornada nao encontrada.' }, { status: 404 });
  const steps = await list(
    context.sb.from('re_journey_steps').select('*,re_forms(id,title,type,status)').eq('journey_id', id).order('order_index')
  );
  return json({ ...journey, steps });
}

async function handleAgendaSlots(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const includeBookings = !['0', 'false', 'no'].includes(String(url.searchParams.get('include_bookings') || '1').toLowerCase());

  let slots = await listSafe(
    context.sb
      .from('re_agenda_slots')
      .select('id,starts_at,ends_at,title,credits_cost,max_bookings,duration_min,location,meeting_link,description,created_at')
      .gte('starts_at', from)
      .order('starts_at', { ascending: true })
      .limit(100)
  );
  if (!slots.length) {
    slots = await listSafe(
      context.sb
        .from('re_agenda_slots')
        .select('id,starts_at,ends_at,title,created_at')
        .gte('starts_at', from)
        .order('starts_at', { ascending: true })
        .limit(100)
    );
  }

  if (!includeBookings || !slots.length) return json({ slots });

  const slotIds = slots.map((slot) => slot.id);
  let bookings = await listSafe(
    context.sb
      .from('re_bookings')
      .select('id,slot_id,user_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,external_contact,notes,created_at,re_users(id,name,email,company)')
      .in('slot_id', slotIds)
      .order('created_at', { ascending: true })
  );
  if (!bookings.length) {
    bookings = await listSafe(
      context.sb
        .from('re_bookings')
        .select('id,slot_id,user_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,external_contact,notes,created_at')
        .in('slot_id', slotIds)
        .order('created_at', { ascending: true })
    );
  }
  const bySlot = {};
  for (const booking of bookings) {
    if (!bySlot[booking.slot_id]) bySlot[booking.slot_id] = [];
    bySlot[booking.slot_id].push(booking);
  }

  return json({ slots: slots.map((slot) => ({ ...slot, bookings: bySlot[slot.id] || [] })) });
}

export async function handleAdminReadModels(request, context) {
  const pathname = new URL(request.url).pathname;

  if (pathname === '/api/admin/clients') return handleClients(request, context);
  if (/^\/api\/admin\/client\/[^/]+$/.test(pathname)) return handleClientDetail(request, context);
  if (/^\/api\/admin\/client\/[^/]+\/bookings$/.test(pathname)) return handleClientBookings(request, context);
  if (/^\/api\/admin\/client\/[^/]+\/documents$/.test(pathname)) return handleClientDocuments(request, context);
  if (/^\/api\/admin\/client\/[^/]+\/members$/.test(pathname)) return handleClientMembers(request, context);
  if (/^\/api\/admin\/client\/[^/]+\/suppliers$/.test(pathname)) return handleClientSuppliers(request, context);
  if (/^\/api\/admin\/client\/[^/]+\/financial$/.test(pathname)) return handleClientFinancial(request, context);
  if (pathname === '/api/admin/financial') return handleFinancial(request, context);
  if (pathname === '/api/admin/form-config') return handleFormConfig(request, context);
  if (/^\/api\/admin\/audit-log(?:\/export)?$/.test(pathname)) return handleAuditLog(request, context);
  if (/^\/api\/admin\/invoices(?:\/.*)?$/.test(pathname)) return handleInvoices(request, context);
  if (/^\/api\/admin\/services(?:\/[^/]+)?$/.test(pathname)) return handleServices(request, context);
  if (/^\/api\/admin\/service-orders(?:\/[^/]+)?$/.test(pathname)) return handleServiceOrders(request, context);
  if (/^\/api\/admin\/forms(?:\/[^/]+)?$/.test(pathname)) return handleForms(request, context);
  if (/^\/api\/admin\/journeys(?:\/.*)?$/.test(pathname)) return handleJourneys(request, context);
  if (pathname === '/api/admin/agenda/slots') return handleAgendaSlots(request, context);

  return null;
}
