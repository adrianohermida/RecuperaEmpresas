import { json, readJson } from '../lib/http.mjs';

function companyId(user) {
  return user.company_id || user.id;
}

const ALLOWED_FIELDS = [
  'department_id', 'name', 'cpf', 'rg', 'birth_date', 'gender', 'email', 'phone', 'address',
  'job_title', 'employment_type', 'admission_date', 'termination_date', 'status', 'salary_cents',
  'fgts_rate', 'inss_rate', 'irrf_rate',
  'has_vale_transporte', 'vt_value_cents', 'has_vale_refeicao', 'vr_value_cents',
  'has_plano_saude', 'ps_value_cents', 'has_plano_odonto', 'po_value_cents',
  'total_cost_cents', 'notes',
];

function calcTotalCost(body) {
  const salary = parseInt(body.salary_cents || 0, 10);
  const fgts = Math.round(salary * (parseFloat(body.fgts_rate || 8) / 100));
  const vt = body.has_vale_transporte ? parseInt(body.vt_value_cents || 0, 10) : 0;
  const vr = body.has_vale_refeicao ? parseInt(body.vr_value_cents || 0, 10) : 0;
  const ps = body.has_plano_saude ? parseInt(body.ps_value_cents || 0, 10) : 0;
  const po = body.has_plano_odonto ? parseInt(body.po_value_cents || 0, 10) : 0;
  return salary + fgts + vt + vr + ps + po;
}

async function listEmployees(sb, cid) {
  const { data } = await sb.from('re_employees')
    .select('*,re_departments(id,name)')
    .eq('company_id', cid)
    .order('status')
    .order('name');
  return data || [];
}

function buildPayload(body, cid, actorId) {
  const payload = { company_id: cid, created_by: actorId, total_cost_cents: calcTotalCost(body) };
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }
  payload.name = String(body.name).trim();
  return payload;
}

function buildUpdates(body) {
  const updates = { updated_at: new Date().toISOString() };
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  updates.total_cost_cents = calcTotalCost(body);
  return updates;
}

export async function handleEmployees(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'GET') {
      const employees = await listEmployees(context.sb, context.params.clientId);
      const active = employees.filter((item) => item.status === 'active');
      const totalPayroll = active.reduce((sum, item) => sum + (item.salary_cents || 0), 0);
      const totalCost = active.reduce((sum, item) => sum + (item.total_cost_cents || 0), 0);
      return json({ employees, stats: { total: employees.length, active: active.length, totalPayroll, totalCost } });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.name?.trim()) return json({ error: 'Nome é obrigatório.' }, { status: 400 });
      const { data, error } = await context.sb.from('re_employees')
        .insert(buildPayload(body, context.params.clientId, context.user.id))
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, employee: data });
    }

    if (request.method === 'PUT') {
      const body = await readJson(request);
      const { data, error } = await context.sb.from('re_employees')
        .update(buildUpdates(body))
        .eq('id', context.params.empId)
        .eq('company_id', context.params.clientId)
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      if (!data) return json({ error: 'Funcionário não encontrado.' }, { status: 404 });
      return json({ success: true, employee: data });
    }

    if (request.method === 'DELETE') {
      const { error } = await context.sb.from('re_employees')
        .delete()
        .eq('id', context.params.empId)
        .eq('company_id', context.params.clientId);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (request.method === 'GET') {
    return json({ employees: await listEmployees(context.sb, companyId(context.user)) });
  }

  if (request.method === 'POST') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode gerenciar funcionários.' }, { status: 403 });
    const body = await readJson(request);
    if (!body.name?.trim()) return json({ error: 'Nome é obrigatório.' }, { status: 400 });
    const { data, error } = await context.sb.from('re_employees')
      .insert(buildPayload(body, context.user.id, context.user.id))
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, employee: data });
  }

  if (request.method === 'PUT') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode editar funcionários.' }, { status: 403 });
    const body = await readJson(request);
    const { data, error } = await context.sb.from('re_employees')
      .update(buildUpdates(body))
      .eq('id', context.params.id)
      .eq('company_id', context.user.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    if (!data) return json({ error: 'Funcionário não encontrado.' }, { status: 404 });
    return json({ success: true, employee: data });
  }

  if (request.method === 'DELETE') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode excluir funcionários.' }, { status: 403 });
    const { error } = await context.sb.from('re_employees')
      .delete()
      .eq('id', context.params.id)
      .eq('company_id', context.user.id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}