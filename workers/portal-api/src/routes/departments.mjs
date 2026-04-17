import { json, readJson } from '../lib/http.mjs';

function companyId(user) {
  return user.company_id || user.id;
}

async function listDepartments(sb, cid) {
  const { data } = await sb.from('re_departments')
    .select('*,re_company_users!re_departments_manager_id_fkey(id,name,job_title)')
    .eq('company_id', cid)
    .order('order_index')
    .order('name');
  return data || [];
}

function buildDepartmentUpdates(body) {
  const updates = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.parent_id !== undefined) updates.parent_id = body.parent_id || null;
  if (body.manager_id !== undefined) updates.manager_id = body.manager_id || null;
  if (body.color !== undefined) updates.color = body.color;
  if (body.order_index !== undefined) updates.order_index = body.order_index;
  return updates;
}

function buildDepartmentPayload(body, cid, actorId) {
  return {
    company_id: cid,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    parent_id: body.parent_id || null,
    manager_id: body.manager_id || null,
    color: body.color || '#6366f1',
    order_index: body.order_index ?? 0,
    created_by: actorId,
  };
}

export async function handleDepartments(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'GET') {
      return json({ departments: await listDepartments(context.sb, context.params.clientId) });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.name?.trim()) return json({ error: 'Nome é obrigatório.' }, { status: 400 });
      const { data, error } = await context.sb.from('re_departments')
        .insert(buildDepartmentPayload(body, context.params.clientId, context.user.id))
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, department: data });
    }

    if (request.method === 'PUT' && context.params.memberId) {
      const body = await readJson(request);
      const updates = {};
      if (body.department_id !== undefined) updates.department_id = body.department_id || null;
      if (body.job_title !== undefined) updates.job_title = body.job_title?.trim() || null;
      const { data, error } = await context.sb.from('re_company_users')
        .update(updates)
        .eq('id', context.params.memberId)
        .eq('company_id', context.params.clientId)
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      if (!data) return json({ error: 'Membro não encontrado.' }, { status: 404 });
      return json({ success: true, member: data });
    }

    if (request.method === 'PUT') {
      const body = await readJson(request);
      const { data, error } = await context.sb.from('re_departments')
        .update(buildDepartmentUpdates(body))
        .eq('id', context.params.deptId)
        .eq('company_id', context.params.clientId)
        .select()
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      if (!data) return json({ error: 'Departamento não encontrado.' }, { status: 404 });
      return json({ success: true, department: data });
    }

    if (request.method === 'DELETE') {
      await context.sb.from('re_company_users').update({ department_id: null }).eq('department_id', context.params.deptId);
      await context.sb.from('re_departments').update({ parent_id: null }).eq('parent_id', context.params.deptId);
      const { error } = await context.sb.from('re_departments')
        .delete()
        .eq('id', context.params.deptId)
        .eq('company_id', context.params.clientId);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (request.method === 'GET') {
    return json({ departments: await listDepartments(context.sb, companyId(context.user)) });
  }

  if (request.method === 'POST') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode criar departamentos.' }, { status: 403 });
    const body = await readJson(request);
    if (!body.name?.trim()) return json({ error: 'Nome é obrigatório.' }, { status: 400 });
    const { data, error } = await context.sb.from('re_departments')
      .insert(buildDepartmentPayload(body, context.user.id, context.user.id))
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, department: data });
  }

  if (request.method === 'PUT') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode editar departamentos.' }, { status: 403 });
    const body = await readJson(request);
    const { data, error } = await context.sb.from('re_departments')
      .update(buildDepartmentUpdates(body))
      .eq('id', context.params.id)
      .eq('company_id', context.user.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    if (!data) return json({ error: 'Departamento não encontrado.' }, { status: 404 });
    return json({ success: true, department: data });
  }

  if (request.method === 'DELETE') {
    if (context.user.company_id) return json({ error: 'Apenas o titular pode excluir departamentos.' }, { status: 403 });
    await context.sb.from('re_company_users').update({ department_id: null }).eq('department_id', context.params.id);
    await context.sb.from('re_departments').update({ parent_id: null }).eq('parent_id', context.params.id);
    const { error } = await context.sb.from('re_departments')
      .delete()
      .eq('id', context.params.id)
      .eq('company_id', context.user.id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}