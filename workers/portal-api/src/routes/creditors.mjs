import { json, readJson } from '../lib/http.mjs';

function companyId(user) {
  return user.company_id || user.id;
}

async function listCreditors(sb, cid) {
  const { data } = await sb.from('re_creditors')
    .select('*')
    .eq('company_id', cid)
    .order('created_at', { ascending: false });
  return data || [];
}

function buildCreditorPayload(body, companyIdValue, actorId) {
  return {
    company_id: companyIdValue,
    name: body.name.trim(),
    document: body.document || null,
    creditor_type: body.creditor_type || 'bank',
    debt_type: body.debt_type || 'unsecured',
    original_amount: body.original_amount || null,
    current_balance: body.current_balance || null,
    interest_rate: body.interest_rate || null,
    due_date: body.due_date || null,
    last_payment_date: body.last_payment_date || null,
    contact_name: body.contact_name || null,
    contact_phone: body.contact_phone || null,
    contact_email: body.contact_email || null,
    collateral: body.collateral || null,
    is_judicial: Boolean(body.is_judicial),
    process_number: body.process_number || null,
    notes: body.notes || null,
    created_by: actorId,
  };
}

function buildCreditorUpdates(body) {
  const allowed = ['name', 'document', 'creditor_type', 'debt_type', 'original_amount', 'current_balance', 'interest_rate', 'due_date', 'last_payment_date', 'status', 'contact_name', 'contact_phone', 'contact_email', 'collateral', 'is_judicial', 'process_number', 'notes'];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (updates.name !== undefined) updates.name = String(updates.name).trim();
  return updates;
}

export async function handleCreditors(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'GET') {
      return json({ creditors: await listCreditors(context.sb, context.params.clientId) });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.name?.trim()) return json({ error: 'Nome do credor é obrigatório.' }, { status: 400 });
      const { data, error } = await context.sb.from('re_creditors')
        .insert(buildCreditorPayload(body, context.params.clientId, context.user.id))
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, creditor: data });
    }

    if (request.method === 'PUT') {
      const body = await readJson(request);
      const { data, error } = await context.sb.from('re_creditors')
        .update(buildCreditorUpdates(body))
        .eq('id', context.params.creditorId)
        .eq('company_id', context.params.clientId)
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      if (!data) return json({ error: 'Credor não encontrado.' }, { status: 404 });
      return json({ success: true, creditor: data });
    }

    if (request.method === 'DELETE') {
      const { error } = await context.sb.from('re_creditors')
        .delete()
        .eq('id', context.params.creditorId)
        .eq('company_id', context.params.clientId);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (request.method === 'GET') {
    return json({ creditors: await listCreditors(context.sb, companyId(context.user)) });
  }

  if (request.method === 'POST') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode gerenciar credores.' }, { status: 403 });
    const body = await readJson(request);
    if (!body.name?.trim()) return json({ error: 'Nome do credor é obrigatório.' }, { status: 400 });
    const { data, error } = await context.sb.from('re_creditors')
      .insert(buildCreditorPayload(body, context.user.id, context.user.id))
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, creditor: data });
  }

  if (request.method === 'PUT') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode editar credores.' }, { status: 403 });
    const body = await readJson(request);
    const { data, error } = await context.sb.from('re_creditors')
      .update(buildCreditorUpdates(body))
      .eq('id', context.params.id)
      .eq('company_id', context.user.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    if (!data) return json({ error: 'Credor não encontrado.' }, { status: 404 });
    return json({ success: true, creditor: data });
  }

  if (request.method === 'DELETE') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode excluir credores.' }, { status: 403 });
    const { error } = await context.sb.from('re_creditors')
      .delete()
      .eq('id', context.params.id)
      .eq('company_id', context.user.id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}