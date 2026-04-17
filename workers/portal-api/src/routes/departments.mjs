import bcrypt from 'bcryptjs';
import { auditLog, emailWrapper, getBaseUrl, queueSideEffect, sendMail } from '../lib/effects.mjs';
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

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let password = '';
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }
  return `${password}X1!`;
}

export async function handleDepartments(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'GET') {
      return json({ departments: await listDepartments(context.sb, context.params.clientId) });
    }

    if (request.method === 'POST' && context.params.action === 'invite') {
      const body = await readJson(request);
      const email = String(body.email || '').toLowerCase().trim();
      const name = String(body.name || '').trim();
      if (!name || !email) return json({ error: 'name e email sao obrigatorios.' }, { status: 400 });

      const { data: existing } = await context.sb.from('re_company_users')
        .select('id')
        .eq('company_id', context.params.clientId)
        .eq('email', email)
        .single();
      if (existing) return json({ error: 'E-mail ja cadastrado nesta empresa.' }, { status: 409 });

      const tmpPwd = generateTemporaryPassword();
      const hash = await bcrypt.hash(tmpPwd, 10);

      const { data: member, error } = await context.sb.from('re_company_users').insert({
        company_id: context.params.clientId,
        name,
        email,
        role: body.role || 'operacional',
        password_hash: hash,
        job_title: body.job_title?.trim() || null,
        department_id: body.department_id || null,
        active: true,
      }).select().single();
      if (error) return json({ error: error.message }, { status: 500 });

      const { data: owner } = await context.sb.from('re_users')
        .select('name,company')
        .eq('id', context.params.clientId)
        .single();

      const loginUrl = `${getBaseUrl(context.env)}/login.html`;
      queueSideEffect(context, async () => {
        await sendMail(context.env, {
          to: email,
          subject: `Convite: acesso ao portal da ${owner?.company || owner?.name || 'empresa'}`,
          html: emailWrapper('Voce foi convidado!', `
            <p>Ola, <b>${name}</b>!</p>
            <p>Voce foi adicionado a equipe de <b>${owner?.company || owner?.name || 'sua empresa'}</b> no portal Recupera Empresas.</p>
            <p><b>Papel:</b> ${body.role || 'Operacional'}</p>
            <p><b>Seu acesso temporario:</b><br>
               E-mail: <code>${email}</code><br>
               Senha temporaria: <code>${tmpPwd}</code></p>
            <p>Acesse o portal e altere sua senha no primeiro acesso:</p>
            <p><a href="${loginUrl}">Acessar portal</a></p>
            <p style="font-size:12px;color:#9ca3af">Se voce nao esperava este convite, ignore este e-mail.</p>
          `),
        });

        await auditLog(context.sb, {
          actorId: context.user.id,
          actorEmail: context.user.email,
          actorRole: 'admin',
          entityType: 'company_member',
          entityId: member.id,
          action: 'invite',
          after: { name, email, role: body.role || 'operacional' },
        });
      }, 'member-invite');

      return json({ success: true, member: { ...member, password_hash: undefined } });
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