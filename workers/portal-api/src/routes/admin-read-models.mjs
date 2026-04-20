import { json, methodNotAllowed } from '../lib/http.mjs';

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
  if (request.method !== 'GET') return methodNotAllowed();
  const url = new URL(request.url);
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

  if (context.params.id && context.params.action === 'pdf') {
    const invoice = (data || []).find((item) => item.id === context.params.id)
      || await maybeSingle(context.sb.from('re_invoices').select('*').eq('id', context.params.id));
    if (!invoice) return json({ error: 'Boleto nao encontrado.' }, { status: 404 });
    return json({
      error: 'Geracao de PDF ainda nao portada para o Worker.',
      invoice,
    }, { status: 501 });
  }

  return json({ invoices: data || [], total: count || 0 });
}

async function handleServices(request, context) {
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
  if (request.method !== 'GET') return methodNotAllowed();
  const { id, asnId } = context.params;

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

  if (context.params.action === 'assignments') {
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
  if (/^\/api\/admin\/invoices(?:\/[^/]+\/pdf)?$/.test(pathname)) return handleInvoices(request, context);
  if (pathname === '/api/admin/services') return handleServices(request, context);
  if (pathname === '/api/admin/service-orders') return handleServiceOrders(request, context);
  if (/^\/api\/admin\/forms(?:\/[^/]+)?$/.test(pathname)) return handleForms(request, context);
  if (/^\/api\/admin\/journeys(?:\/[^/]+(?:\/assignments(?:\/[^/]+\/progress)?)?)?$/.test(pathname)) return handleJourneys(request, context);
  if (pathname === '/api/admin/agenda/slots') return handleAgendaSlots(request, context);

  return null;
}
