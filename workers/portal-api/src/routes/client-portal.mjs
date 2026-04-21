import bcrypt from 'bcryptjs';
import { auditLog, emailWrapper, getOpsRecipients, pushNotification, queueSideEffect, sendMail } from '../lib/effects.mjs';
import { json, methodNotAllowed, readJson } from '../lib/http.mjs';

const FORM_STATUS_MAP = {
  in_progress: 'em_andamento',
  completed: 'concluido',
};

const INVOICE_STATUS_LABEL = {
  pending: 'open',
  paid: 'paid',
  overdue: 'open',
  cancelled: 'void',
};

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
    console.warn('[worker:client-portal:listSafe]', error?.message || error);
    return fallback;
  }
}

function companyId(context) {
  return context.user.company_id || context.user.id;
}

function actorIds(context) {
  const ids = [
    context.user.member_id,
    context.user.id,
    context.auth?.id,
    context.auth?.userId,
  ].filter(Boolean);
  return [...new Set(ids)];
}

function isOwner(context) {
  return !context.user.company_id;
}

async function getCredits(context) {
  const { data } = await context.sb
    .from('re_users')
    .select('credits_balance')
    .eq('id', companyId(context))
    .single();
  return data?.credits_balance ?? 0;
}

async function adjustCredits(context, delta, reason, refId = null) {
  const ownerId = companyId(context);
  const current = await getCredits(context);
  const balanceAfter = current + delta;
  await context.sb.from('re_users').update({ credits_balance: balanceAfter }).eq('id', ownerId);
  await context.sb.from('re_credit_transactions').insert({
    user_id: ownerId,
    delta,
    reason,
    ref_id: refId,
    balance_after: balanceAfter,
  });
  return balanceAfter;
}

async function readOnboarding(sb, userId) {
  return (await maybeSingle(sb.from('re_onboarding').select('*').eq('user_id', userId))) || {
    step: 1,
    status: 'nao_iniciado',
    completed: false,
    data: {},
  };
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
      questions: questions.filter((question) => question.page_id === page.id).sort((left, right) => left.order_index - right.order_index),
    })),
    questions,
    logic,
  };
}

async function handleProgress(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const onboarding = await readOnboarding(context.sb, companyId(context));
  return json({
    step: onboarding.step || 1,
    status: onboarding.status || 'nao_iniciado',
    completed: Boolean(onboarding.completed),
    last_activity: onboarding.last_activity || onboarding.updated_at || null,
  });
}

async function handleSupport(request, context) {
  if (request.method === 'GET' && /\/tickets$/.test(new URL(request.url).pathname)) {
    return json({ tickets: [] });
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    const subject = String(body.subject || '').trim();
    const description = String(body.description || '').trim();
    if (!subject) return json({ error: 'Assunto obrigatório.' }, { status: 400 });

    queueSideEffect(context, () => sendMail(context.env, {
      to: getOpsRecipients(context.env),
      subject: `[Suporte Portal] ${subject} - ${context.user.company || context.user.name || context.user.email}`,
      html: emailWrapper('Novo chamado via portal', `
        <p><b>Cliente:</b> ${context.user.name || ''} (${context.user.email || ''})</p>
        <p><b>Empresa:</b> ${context.user.company || '—'}</p>
        <p><b>Assunto:</b> ${subject}</p>
        ${description ? `<p><b>Descrição:</b> ${description}</p>` : ''}
      `),
    }), 'support-ticket-email');

    queueSideEffect(context, () => auditLog(context.sb, {
      actorId: context.user.member_id || context.user.id,
      actorEmail: context.user.email,
      actorRole: context.user.company_id ? 'company_member' : 'client',
      entityType: 'support_ticket',
      action: 'create',
      after: { subject, description },
    }), 'support-ticket-audit');

    return json({ success: true, fallback: true, message: 'Solicitação recebida. Nossa equipe entrará em contato em breve.' });
  }

  return methodNotAllowed();
}

async function handleAgenda(request, context) {
  const pathname = new URL(request.url).pathname;
  const ownerId = companyId(context);

  if (request.method === 'GET' && pathname === '/api/agenda/slots') {
    const from = new URL(request.url).searchParams.get('from') || new Date().toISOString();
    const slots = await listSafe(
      context.sb
        .from('re_agenda_slots')
        .select('id,starts_at,ends_at,duration_min,title,credits_cost,max_bookings,location,meeting_link')
        .gte('starts_at', from)
        .order('starts_at', { ascending: true })
        .limit(60)
    );

    const slotIds = slots.map((slot) => slot.id);
    const [counts, bookings] = await Promise.all([
      slotIds.length
        ? listSafe(
            context.sb.from('re_bookings').select('slot_id,status').in('slot_id', slotIds).in('status', ['pending', 'confirmed']),
            []
          )
        : [],
      slotIds.length
        ? listSafe(
            context.sb
              .from('re_bookings')
              .select('id,slot_id,status,credits_spent,confirmed_at,cancel_reason,cancelled_by,reschedule_reason,rescheduled_to_slot_id,notes,created_at')
              .eq('user_id', ownerId)
              .in('slot_id', slotIds)
              .neq('status', 'rescheduled'),
            []
          )
        : [],
    ]);

    const bookingCounts = {};
    counts.forEach((booking) => {
      bookingCounts[booking.slot_id] = (bookingCounts[booking.slot_id] || 0) + 1;
    });
    const myBookings = new Map(bookings.map((booking) => [booking.slot_id, booking]));
    const credits = await getCredits(context);

    return json({
      slots: slots.map((slot) => ({
        ...slot,
        booked_count: bookingCounts[slot.id] || 0,
        available: (bookingCounts[slot.id] || 0) < Number(slot.max_bookings || 1),
        my_booking: myBookings.has(slot.id),
        my_booking_detail: myBookings.get(slot.id) || null,
      })),
      credits_balance: credits,
    });
  }

  const bookMatch = pathname.match(/^\/api\/agenda\/book\/(?<slotId>[^/]+)$/);
  if (bookMatch && request.method === 'POST') {
    const body = await readJson(request);
    const slot = await maybeSingle(context.sb.from('re_agenda_slots').select('*').eq('id', bookMatch.groups.slotId));
    if (!slot) return json({ error: 'Slot não encontrado.' }, { status: 404 });
    if (new Date(slot.starts_at) < new Date()) return json({ error: 'Horário já passou.' }, { status: 400 });

    const countResult = await context.sb
      .from('re_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('slot_id', slot.id)
      .in('status', ['pending', 'confirmed']);
    if ((countResult.count || 0) >= Number(slot.max_bookings || 1)) {
      return json({ error: 'Horário lotado.' }, { status: 400 });
    }

    const duplicate = await maybeSingle(
      context.sb
        .from('re_bookings')
        .select('id')
        .eq('slot_id', slot.id)
        .eq('user_id', ownerId)
        .neq('status', 'cancelled')
    );
    if (duplicate) return json({ error: 'Você já tem reserva neste horário.' }, { status: 409 });

    const credits = await getCredits(context);
    const cost = Number(slot.credits_cost || 1);
    if (credits < cost) {
      return json({
        error: `Créditos insuficientes. Necessário: ${cost}, disponível: ${credits}.`,
        credits_needed: cost - credits,
      }, { status: 402 });
    }

    const booking = await maybeSingle(
      context.sb
        .from('re_bookings')
        .insert({
          slot_id: slot.id,
          user_id: ownerId,
          status: 'pending',
          credits_spent: cost,
          notes: body.notes?.trim() || null,
        })
        .select()
    );

    const balance = await adjustCredits(context, -cost, 'booking_pending', booking?.id || null);
    return json({ success: true, booking, credits_balance: balance });
  }

  const cancelMatch = pathname.match(/^\/api\/agenda\/cancel-slot\/(?<slotId>[^/]+)$/);
  if (cancelMatch && request.method === 'DELETE') {
    const body = await readJson(request);
    const booking = await maybeSingle(
      context.sb
        .from('re_bookings')
        .select('*')
        .eq('slot_id', cancelMatch.groups.slotId)
        .eq('user_id', ownerId)
        .in('status', ['pending', 'confirmed'])
    );
    if (!booking) return json({ error: 'Reserva não encontrada.' }, { status: 404 });

    const slot = await maybeSingle(context.sb.from('re_agenda_slots').select('starts_at,title').eq('id', booking.slot_id));
    if (slot && new Date(slot.starts_at) < new Date()) return json({ error: 'Sessão já iniciada.' }, { status: 400 });

    await context.sb.from('re_bookings').update({
      status: 'cancelled',
      cancelled_by: 'client',
      cancel_reason: body.reason?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', booking.id);

    const balance = await adjustCredits(context, Number(booking.credits_spent || 0), 'refund_client_cancel', booking.id);
    return json({ success: true, credits_balance: balance });
  }

  return methodNotAllowed();
}

async function handleCredits(request, context) {
  const pathname = new URL(request.url).pathname;
  if (request.method === 'GET' && pathname === '/api/credits/history') {
    const ownerId = companyId(context);
    const transactions = await listSafe(
      context.sb
        .from('re_credit_transactions')
        .select('*')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(50)
    );
    return json({ transactions, balance: await getCredits(context) });
  }

  if (request.method === 'POST' && pathname === '/api/credits/checkout') {
    return json({ error: 'Checkout de créditos ainda não foi portado para o Worker.' }, { status: 501 });
  }

  return methodNotAllowed();
}

async function handleFinancial(request, context) {
  const pathname = new URL(request.url).pathname;
  const ownerId = companyId(context);

  if (request.method === 'GET' && pathname === '/api/financial/invoices') {
    const invoices = await listSafe(
      context.sb
        .from('re_invoices')
        .select('id,description,amount_cents,due_date,status,paid_at,payment_method,created_at')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
    );

    return json({
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        type: 'invoice',
        amount: ((Number(invoice.amount_cents || 0)) / 100).toFixed(2),
        amountPaid: invoice.status === 'paid' ? ((Number(invoice.amount_cents || 0)) / 100).toFixed(2) : '0.00',
        currency: 'BRL',
        status: INVOICE_STATUS_LABEL[invoice.status] || invoice.status || 'open',
        date: invoice.created_at,
        dueDate: invoice.due_date ? `${invoice.due_date}T12:00:00.000Z` : null,
        pdfUrl: null,
        hostedUrl: invoice.status !== 'paid' ? `/api/financial/internal-invoices/${invoice.id}/pdf` : null,
        description: invoice.description || 'Fatura',
      })),
      stripeConfigured: false,
    });
  }

  if (request.method === 'GET' && pathname === '/api/financial/internal-invoices') {
    const invoices = await listSafe(
      context.sb
        .from('re_invoices')
        .select('id,description,amount_cents,due_date,status,paid_at,payment_method,bank_data,created_at')
        .eq('user_id', ownerId)
        .neq('status', 'cancelled')
        .order('due_date', { ascending: false })
    );
    return json({ invoices });
  }

  const pdfMatch = pathname.match(/^\/api\/financial\/internal-invoices\/(?<id>[^/]+)\/pdf$/);
  if (pdfMatch && request.method === 'GET') {
    return json({ error: 'PDF do boleto ainda não foi portado para o Worker.' }, { status: 501 });
  }

  if (request.method === 'POST' && pathname === '/api/financial/request-invoice') {
    const body = await readJson(request);
    const description = String(body.description || '').trim();

    queueSideEffect(context, () => sendMail(context.env, {
      to: getOpsRecipients(context.env),
      subject: `Solicitação 2ª via - ${context.user.company || context.user.name || context.user.email}`,
      html: emailWrapper('Solicitação de fatura', `
        <p>Cliente <b>${context.user.name || ''}</b> (${context.user.email || ''}) solicitou 2ª via do boleto.</p>
        <p><b>Empresa:</b> ${context.user.company || '—'}</p>
        ${description ? `<p><b>Detalhe:</b> ${description}</p>` : ''}
      `),
    }), 'invoice-request-email');

    return json({ success: true, message: 'Solicitação enviada. Nossa equipe entrará em contato.' });
  }

  return methodNotAllowed();
}

async function handleServices(request, context) {
  const pathname = new URL(request.url).pathname;
  const ownerId = companyId(context);

  if (request.method === 'GET' && pathname === '/api/services') {
    const services = await listSafe(
      context.sb
        .from('re_services')
        .select('id,name,title,description,category,price_cents,price,delivery_days,features,featured,journey_id,active')
        .eq('active', true)
        .order('featured', { ascending: false })
        .order('created_at')
    );
    return json({ services });
  }

  const orderMatch = pathname.match(/^\/api\/services\/(?<id>[^/]+)\/order$/);
  if (orderMatch && request.method === 'POST') {
    const service = await maybeSingle(
      context.sb.from('re_services').select('*').eq('id', orderMatch.groups.id).eq('active', true)
    );
    if (!service) return json({ error: 'Serviço não encontrado.' }, { status: 404 });

    const amountCents = Number(service.price_cents || Math.round(Number(service.price || 0) * 100) || 0);
    const invoice = await maybeSingle(
      context.sb
        .from('re_invoices')
        .insert({
          user_id: ownerId,
          description: `Serviço: ${service.name || service.title || 'Serviço'}`,
          amount_cents: amountCents,
          due_date: new Date(Date.now() + (3 * 86400000)).toISOString().slice(0, 10),
          status: 'pending',
          payment_method: 'boleto',
          created_by: null,
        })
        .select()
    );

    const order = await maybeSingle(
      context.sb
        .from('re_service_orders')
        .insert({
          user_id: ownerId,
          service_id: service.id,
          amount_cents: amountCents,
          status: 'pending_payment',
          payment_method: 'boleto',
          invoice_id: invoice?.id || null,
          contracted_at: new Date().toISOString(),
        })
        .select()
    );

    if (service.journey_id) {
      queueSideEffect(context, () => context.sb.from('re_journey_assignments').upsert({
        journey_id: service.journey_id,
        user_id: ownerId,
        assigned_by: null,
        status: 'active',
        notes: `Atribuído automaticamente pela contratação do serviço "${service.name || service.title || 'Serviço'}"`,
      }, { onConflict: 'journey_id,user_id' }), 'service-order-journey');
    }

    queueSideEffect(context, () => pushNotification(
      context.sb,
      ownerId,
      'service',
      'Pedido recebido!',
      `Seu pedido para "${service.name || service.title || 'Serviço'}" foi registrado. Aguarde o boleto.`,
      'service_order',
      order?.id
    ), 'service-order-notification');

    return json({ success: true, order, invoice });
  }

  if (request.method === 'GET' && pathname === '/api/service-orders') {
    const orders = await listSafe(
      context.sb
        .from('re_service_orders')
        .select('*,re_services(name,category,title)')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
    );
    return json({ orders });
  }

  return methodNotAllowed();
}

async function handleDocuments(request, context) {
  const pathname = new URL(request.url).pathname;
  const ownerId = companyId(context);

  if (request.method === 'GET' && pathname === '/api/documents') {
    const documents = await listSafe(
      context.sb
        .from('re_documents')
        .select('*')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
    );
    return json({
      documents: documents.map((doc) => ({
        id: doc.id,
        userId: doc.user_id,
        name: doc.name,
        originalName: doc.original_name,
        filePath: doc.file_path,
        fileSize: doc.file_size,
        mimeType: doc.mime_type,
        docType: doc.doc_type,
        status: doc.status,
        comments: doc.comments || [],
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      })),
    });
  }

  if (request.method === 'POST' && pathname === '/api/documents/upload') {
    const form = await request.formData();
    const file = form.get('file');
    const docType = String(form.get('docType') || 'outros').trim();
    const requestId = String(form.get('request_id') || '').trim() || null;
    const name = String(form.get('name') || '').trim();
    if (!file || typeof file === 'string') return json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });

    const doc = await maybeSingle(
      context.sb
        .from('re_documents')
        .insert({
          user_id: ownerId,
          name: (name || file.name || 'Documento').slice(0, 120),
          original_name: file.name || null,
          file_path: null,
          file_size: Number(file.size || 0),
          mime_type: file.type || null,
          doc_type: docType,
          status: 'pendente',
          comments: [],
          request_id: requestId,
        })
        .select()
    );

    if (requestId && doc) {
      await context.sb.from('re_document_requests').update({
        status: 'uploaded',
        fulfilled_doc_id: doc.id,
        fulfilled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', requestId).eq('company_id', ownerId).eq('status', 'pending');
    }

    return json({
      success: true,
      document: doc,
      warning: 'Arquivo recebido pelo portal, mas o armazenamento binário ainda será concluído na migração do Worker.',
    });
  }

  const fileMatch = pathname.match(/^\/api\/documents\/(?<id>[^/]+)\/file$/);
  if (fileMatch && request.method === 'GET') {
    return json({ error: 'Download do arquivo ainda não foi portado para o Worker.' }, { status: 501 });
  }

  const docMatch = pathname.match(/^\/api\/documents\/(?<id>[^/]+)$/);
  if (docMatch && request.method === 'DELETE') {
    const doc = await maybeSingle(
      context.sb
        .from('re_documents')
        .select('*')
        .eq('id', docMatch.groups.id)
        .eq('user_id', ownerId)
    );
    if (!doc) return json({ error: 'Documento não encontrado.' }, { status: 404 });
    if (!['pendente', 'ajuste_solicitado'].includes(doc.status)) {
      return json({ error: 'Não é possível excluir um documento em análise ou aprovado.' }, { status: 400 });
    }
    await context.sb.from('re_documents').delete().eq('id', doc.id);
    return json({ success: true });
  }

  return methodNotAllowed();
}

async function handleCompanyMembers(request, context) {
  const pathname = new URL(request.url).pathname;
  const ownerId = companyId(context);

  if (request.method === 'GET' && pathname === '/api/company/members') {
    const members = await listSafe(
      context.sb
        .from('re_company_users')
        .select('id,name,email,role,active,invited_at,last_login,created_at')
        .eq('company_id', ownerId)
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

  if (request.method === 'POST' && pathname === '/api/company/members') {
    if (!isOwner(context)) return json({ error: 'Apenas o titular pode convidar membros.' }, { status: 403 });
    const body = await readJson(request);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const role = String(body.role || 'operacional').trim();
    if (!name || !email || !password) return json({ error: 'name, email e password são obrigatórios.' }, { status: 400 });

    const existing = await maybeSingle(
      context.sb.from('re_company_users').select('id').eq('company_id', ownerId).eq('email', email)
    );
    if (existing) return json({ error: 'E-mail já cadastrado nesta empresa.' }, { status: 409 });

    const member = await maybeSingle(
      context.sb
        .from('re_company_users')
        .insert({
          company_id: ownerId,
          name,
          email,
          role,
          password_hash: await bcrypt.hash(password, 10),
        })
        .select()
    );
    return json({ success: true, member });
  }

  const memberMatch = pathname.match(/^\/api\/company\/members\/(?<id>[^/]+)$/);
  if (memberMatch && request.method === 'PUT') {
    if (!isOwner(context)) return json({ error: 'Apenas o titular pode editar membros.' }, { status: 403 });
    const body = await readJson(request);
    const updates = {};
    if (body.role !== undefined) updates.role = body.role;
    if (body.active !== undefined) updates.active = body.active;
    if (body.name !== undefined) updates.name = String(body.name || '').trim();
    const member = await maybeSingle(
      context.sb
        .from('re_company_users')
        .update(updates)
        .eq('id', memberMatch.groups.id)
        .eq('company_id', ownerId)
        .select()
    );
    if (!member) return json({ error: 'Membro não encontrado.' }, { status: 404 });
    return json({ success: true, member });
  }

  if (memberMatch && request.method === 'DELETE') {
    if (!isOwner(context)) return json({ error: 'Apenas o titular pode remover membros.' }, { status: 403 });
    await context.sb.from('re_company_users').delete().eq('id', memberMatch.groups.id).eq('company_id', ownerId);
    return json({ success: true });
  }

  return methodNotAllowed();
}

async function handleMyForms(request, context) {
  const pathname = new URL(request.url).pathname;
  const principals = actorIds(context);

  if (request.method === 'GET' && pathname === '/api/my-forms') {
    const assignments = principals.length
      ? await listSafe(context.sb.from('re_form_assignments').select('form_id,user_id').in('user_id', principals))
      : [];
    const formIds = [...new Set(assignments.map((assignment) => assignment.form_id).filter(Boolean))];
    if (!formIds.length) return json([]);

    const forms = await listSafe(
      context.sb
        .from('re_forms')
        .select('id,title,description,type,status')
        .in('id', formIds)
        .in('status', ['active', 'publicado'])
    );

    const items = await Promise.all(forms.map(async (form) => {
      const responses = await listSafe(
        context.sb
          .from('re_form_responses')
          .select('id,status,score_pct,score_classification,current_page_id,updated_at')
          .eq('form_id', form.id)
          .in('user_id', principals)
          .order('updated_at', { ascending: false })
          .limit(1)
      );
      const response = responses[0] || null;
      return {
        ...form,
        response_status: response ? (FORM_STATUS_MAP[response.status] || response.status) : 'nao_iniciado',
        response_id: response?.id || null,
        response_progress: null,
        score_pct: response?.score_pct || null,
        score_classification: response?.score_classification || null,
      };
    }));

    return json(items);
  }

  const formMatch = pathname.match(/^\/api\/my-forms\/(?<id>[^/]+)$/);
  if (formMatch && request.method === 'GET') {
    const assignment = principals.length
      ? await maybeSingle(
          context.sb.from('re_form_assignments').select('id').eq('form_id', formMatch.groups.id).in('user_id', principals)
        )
      : null;
    if (!assignment) return json({ error: 'Sem acesso a este formulário.' }, { status: 403 });

    const form = await loadFullForm(context.sb, formMatch.groups.id);
    if (!form) return json({ error: 'Formulário não encontrado.' }, { status: 404 });

    const responses = await listSafe(
      context.sb
        .from('re_form_responses')
        .select('id,status,current_page_id,score_pct,score_total,score_max,score_classification,auto_report,user_id,updated_at')
        .eq('form_id', formMatch.groups.id)
        .in('user_id', principals)
        .order('updated_at', { ascending: false })
        .limit(1)
    );
    const existing = responses[0] || null;

    let existingWithAnswers = null;
    if (existing) {
      const answers = await listSafe(
        context.sb.from('re_form_answers').select('question_id,value,value_json').eq('response_id', existing.id)
      );
      existingWithAnswers = { ...existing, answers };
    }

    return json({ ...form, existing_response: existingWithAnswers });
  }

  const responseMatch = pathname.match(/^\/api\/my-forms\/(?<id>[^/]+)\/response$/);
  if (responseMatch && request.method === 'POST') {
    const assignment = principals.length
      ? await maybeSingle(
          context.sb.from('re_form_assignments').select('id').eq('form_id', responseMatch.groups.id).in('user_id', principals)
        )
      : null;
    if (!assignment) return json({ error: 'Sem acesso.' }, { status: 403 });

    const body = await readJson(request);
    const principalId = assignment.user_id || principals[0];
    const isCompleting = body.status === 'concluido';
    const dbStatus = isCompleting ? 'completed' : 'in_progress';
    const now = new Date().toISOString();

    let response = await maybeSingle(
      context.sb
        .from('re_form_responses')
        .select('id,status,started_at,user_id')
        .eq('form_id', responseMatch.groups.id)
        .eq('user_id', principalId)
        .not('status', 'eq', 'completed')
        .order('updated_at', { ascending: false })
    );

    if (!response) {
      response = await maybeSingle(
        context.sb
          .from('re_form_responses')
          .insert({
            form_id: responseMatch.groups.id,
            user_id: principalId,
            status: dbStatus,
            current_page_id: body.current_page_id || null,
            last_active_at: now,
            updated_at: now,
          })
          .select()
      );
    } else {
      const updates = {
        status: dbStatus,
        updated_at: now,
        last_active_at: now,
      };
      if (body.current_page_id) updates.current_page_id = body.current_page_id;
      if (isCompleting) {
        updates.completed_at = now;
        if (response.started_at) {
          updates.time_to_complete_seconds = Math.round((Date.now() - new Date(response.started_at).getTime()) / 1000);
        }
      }
      await context.sb.from('re_form_responses').update(updates).eq('id', response.id);
    }

    const responseId = response.id;
    if (body.answers && typeof body.answers === 'object') {
      for (const [questionId, value] of Object.entries(body.answers)) {
        const isComplex = Array.isArray(value) || (typeof value === 'object' && value !== null);
        await context.sb.from('re_form_answers').upsert({
          response_id: responseId,
          question_id: Number(questionId),
          value: isComplex ? null : (value == null ? null : String(value)),
          value_json: isComplex ? value : null,
          updated_at: now,
        }, { onConflict: 'response_id,question_id' });
      }
    }

    if (!isCompleting) return json({ response_id: responseId });

    const questions = await listSafe(
      context.sb.from('re_form_questions').select('id,weight,score_map').eq('form_id', responseMatch.groups.id)
    );
    let scoreTotal = 0;
    let scoreMax = 0;
    const scoreDetails = {};

    for (const question of questions) {
      if (!question.weight) continue;
      scoreMax += Number(question.weight || 0);
      const answerValue = body.answers?.[String(question.id)];
      const scoreMap = question.score_map || {};
      let points = 0;
      if (answerValue != null && scoreMap[String(answerValue)] !== undefined) {
        points = Number(scoreMap[String(answerValue)] || 0);
      } else if (typeof answerValue === 'number') {
        points = Number(answerValue) * (Number(question.weight || 0) / 10);
      }
      scoreTotal += points;
      scoreDetails[question.id] = points;
    }

    const scorePct = scoreMax > 0 ? (scoreTotal / scoreMax) * 100 : null;
    const classification = scorePct == null
      ? null
      : scorePct >= 70
        ? 'saudavel'
        : scorePct >= 40
          ? 'risco_moderado'
          : 'risco_alto';
    const form = await maybeSingle(context.sb.from('re_forms').select('title').eq('id', responseMatch.groups.id));
    const autoReport = scorePct == null
      ? null
      : `Relatório de ${form?.title || 'Diagnóstico'}\n\nPontuação: ${Math.round(scorePct)}% (${scoreTotal.toFixed(1)}/${scoreMax} pontos)\nGerado automaticamente em ${new Date().toLocaleDateString('pt-BR')}.`;

    await context.sb.from('re_form_responses').update({
      score_total: scoreTotal,
      score_max: scoreMax,
      score_pct: scorePct,
      score_classification: classification,
      score_details: scoreDetails,
      auto_report: autoReport,
    }).eq('id', responseId);

    return json({
      response_id: responseId,
      score_total: scoreTotal,
      score_max: scoreMax,
      score_pct: scorePct,
      score_classification: classification,
      auto_report: autoReport,
    });
  }

  return methodNotAllowed();
}

async function handleMyJourneys(request, context) {
  if (request.method !== 'GET') return methodNotAllowed();
  const principals = actorIds(context);
  const ownerId = companyId(context);

  const assignments = principals.length
    ? await listSafe(
        context.sb
          .from('re_journey_assignments')
          .select('*,re_journeys(id,name,description,status)')
          .in('user_id', principals)
          .in('status', ['active', 'completed'])
      )
    : [];

  const onboarding = await maybeSingle(context.sb.from('re_onboarding').select('status').eq('user_id', ownerId));
  const onboardingDone = onboarding?.status === 'completed';

  const journeys = await Promise.all(assignments.map(async (assignment) => {
    const steps = await listSafe(
      context.sb
        .from('re_journey_steps')
        .select('id,title,description,order_index,is_optional,form_id,re_forms(id,title,is_system,system_key)')
        .eq('journey_id', assignment.journey_id)
        .order('order_index')
    );
    const completions = await listSafe(
      context.sb
        .from('re_journey_step_completions')
        .select('step_id,completed_at')
        .eq('assignment_id', assignment.id)
    );
    const doneSet = new Set(completions.map((completion) => completion.step_id));

    if (onboardingDone) {
      for (const step of steps) {
        if (step.re_forms?.system_key === 'onboarding_14steps' && !doneSet.has(step.id)) {
          await context.sb.from('re_journey_step_completions').upsert({
            assignment_id: assignment.id,
            step_id: step.id,
            completed_at: new Date().toISOString(),
            notes: 'Completado automaticamente via onboarding do portal',
          }, { onConflict: 'assignment_id,step_id' });
          doneSet.add(step.id);
        }
      }
    }

    return {
      assignment_id: assignment.id,
      journey_id: assignment.journey_id,
      journey_name: assignment.re_journeys?.name,
      journey_description: assignment.re_journeys?.description,
      status: assignment.status,
      current_step_index: assignment.current_step_index,
      assigned_at: assignment.assigned_at,
      completed_at: assignment.completed_at,
      steps: steps.map((step) => ({
        ...step,
        completed: doneSet.has(step.id),
      })),
      progress_pct: steps.length ? Math.round((doneSet.size / steps.length) * 100) : 0,
    };
  }));

  return json(journeys);
}

export async function handleClientPortal(request, context) {
  const pathname = new URL(request.url).pathname;

  if (pathname === '/api/progress') return handleProgress(request, context);
  if (/^\/api\/support\/tickets$/.test(pathname) || /^\/api\/support\/ticket$/.test(pathname)) return handleSupport(request, context);
  if (/^\/api\/agenda\/slots$/.test(pathname) || /^\/api\/agenda\/book\/[^/]+$/.test(pathname) || /^\/api\/agenda\/cancel-slot\/[^/]+$/.test(pathname)) return handleAgenda(request, context);
  if (/^\/api\/credits\/history$/.test(pathname) || /^\/api\/credits\/checkout$/.test(pathname)) return handleCredits(request, context);
  if (/^\/api\/financial\/invoices$/.test(pathname) || /^\/api\/financial\/internal-invoices(?:\/[^/]+\/pdf)?$/.test(pathname) || /^\/api\/financial\/request-invoice$/.test(pathname)) return handleFinancial(request, context);
  if (/^\/api\/services(?:\/[^/]+\/order)?$/.test(pathname) || /^\/api\/service-orders$/.test(pathname)) return handleServices(request, context);
  if (/^\/api\/documents(?:\/[^/]+(?:\/file)?)?(?:\/upload)?$/.test(pathname)) return handleDocuments(request, context);
  if (/^\/api\/company\/members(?:\/[^/]+)?$/.test(pathname)) return handleCompanyMembers(request, context);
  if (/^\/api\/my-forms(?:\/[^/]+(?:\/response)?)?$/.test(pathname)) return handleMyForms(request, context);
  if (pathname === '/api/my-journeys') return handleMyJourneys(request, context);

  return null;
}
