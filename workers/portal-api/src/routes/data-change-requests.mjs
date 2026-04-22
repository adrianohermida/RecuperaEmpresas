import { auditLog, emailWrapper, getBaseUrl, pushNotification, queueSideEffect, sendMail } from '../lib/effects.mjs';
import { json, readJson } from '../lib/http.mjs';

function companyId(user) {
  return user.company_id || user.id;
}

export async function handleDataChangeRequests(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'POST') {
      const body = await readJson(request);
      const { entity_type, entity_id, field_changes, reason } = body;
      if (!entity_type || !entity_id || !field_changes || !Object.keys(field_changes).length) {
        return json({ error: 'entity_type, entity_id e field_changes são obrigatórios.' }, { status: 400 });
      }

      const { data, error } = await context.sb.from('re_data_change_requests').insert({
        user_id: context.params.clientId,
        requested_by: context.user.id,
        requester_role: 'admin',
        entity_type,
        entity_id,
        field_changes,
        reason: reason || null,
      }).select().single();

      if (error) return json({ error: error.message }, { status: 500 });

      const { data: owner } = await context.sb.from('re_users')
        .select('email,name')
        .eq('id', context.params.clientId)
        .single();

      const confirmUrl = `${getBaseUrl(context.env)}/dashboard.html?change_request=${data.token}`;
      const fields = Object.entries(field_changes)
        .map(([key, value]) => `<li><b>${key}:</b> ${value?.from ?? '—'} -> ${value?.to ?? '—'}</li>`)
        .join('');

      queueSideEffect(context, async () => {
        if (owner?.email) {
          await sendMail(context.env, {
            to: owner.email,
            subject: 'Confirmacao de alteracao de dados - Recupera Empresas',
            html: emailWrapper('Solicitacao de alteracao de dados', `
              <p>Ola, <b>${owner?.name || 'Cliente'}</b>!</p>
              <p>O consultor solicitou a alteracao dos seguintes dados da sua empresa:</p>
              <ul>${fields}</ul>
              ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
              <p>Esta solicitacao expira em <b>48 horas</b>.</p>
              <p>Para confirmar ou recusar, acesse o portal:</p>
              <p><a href="${confirmUrl}">Revisar solicitacao</a></p>
            `),
          });
        }

        await pushNotification(
          context.sb,
          context.params.clientId,
          'info',
          'Alteracao de dados pendente',
          'O consultor solicitou alteracoes nos seus dados. Confirme no portal.',
          'change_request',
          data.id,
        );
      }, 'change-request-create');

      return json({ success: true, request: data });
    }

    if (request.method === 'GET') {
      const { data } = await context.sb.from('re_data_change_requests')
        .select('*')
        .eq('user_id', context.params.clientId)
        .order('created_at', { ascending: false })
        .limit(50);
      return json({ requests: data || [] });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (context.params.token && request.method === 'GET') {
    const { data } = await context.sb.from('re_data_change_requests')
      .select('*')
      .eq('token', context.params.token)
      .single();
    if (!data) return json({ error: 'Solicitação não encontrada.' }, { status: 404 });
    return json({ request: data });
  }

  if (request.method === 'GET') {
    const cid = companyId(context.user);
    const { data } = await context.sb.from('re_data_change_requests')
      .select('*')
      .eq('user_id', cid)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return json({ requests: data || [] });
  }

  if (request.method === 'PUT') {
    const body = await readJson(request);
    const { action, rejection_reason } = body;
    if (!['approve', 'reject'].includes(action)) {
      return json({ error: 'action deve ser "approve" ou "reject".' }, { status: 400 });
    }

    const cid = companyId(context.user);
    const { data: changeRequest } = await context.sb.from('re_data_change_requests')
      .select('*')
      .eq('token', context.params.token)
      .eq('user_id', cid)
      .single();

    if (!changeRequest) return json({ error: 'Solicitação não encontrada.' }, { status: 404 });
    if (changeRequest.status !== 'pending') return json({ error: 'Solicitação já processada.' }, { status: 409 });
    if (new Date(changeRequest.expires_at) < new Date()) return json({ error: 'Solicitação expirada.' }, { status: 410 });

    if (action === 'approve') {
      const updates = {};
      for (const [key, value] of Object.entries(changeRequest.field_changes || {})) {
        updates[key] = value?.to;
      }

      const { error: applyError } = await context.sb.from(changeRequest.entity_type)
        .update(updates)
        .eq('id', changeRequest.entity_id);
      if (applyError) return json({ error: 'Erro ao aplicar alterações: ' + applyError.message }, { status: 500 });

      await context.sb.from('re_data_change_requests').update({
        status: 'approved',
        confirmed_by: context.user.id,
        confirmed_at: new Date().toISOString(),
      }).eq('id', changeRequest.id);

      queueSideEffect(context, () => auditLog(context.sb, {
        actorId: context.user.id,
        actorEmail: context.user.email,
        actorRole: 'client',
        entityType: changeRequest.entity_type,
        entityId: changeRequest.entity_id,
        action: 'change_approved',
        after: updates,
      }), 'change-request-audit');

      return json({ success: true, message: 'Alterações aplicadas com sucesso.' });
    }

    await context.sb.from('re_data_change_requests').update({
      status: 'rejected',
      confirmed_by: context.user.id,
      confirmed_at: new Date().toISOString(),
      rejection_reason: rejection_reason?.trim() || null,
    }).eq('id', changeRequest.id);

    return json({ success: true, message: 'Solicitação recusada.' });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}