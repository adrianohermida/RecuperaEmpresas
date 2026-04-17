import { auditLog, emailWrapper, getBaseUrl, pushNotification, queueSideEffect, sendMail } from '../lib/effects.mjs';
import { json, readJson } from '../lib/http.mjs';

function companyId(user) {
  return user.company_id || user.id;
}

const ENTITY_TYPES = ['company', 'member', 'creditor', 'supplier', 'contract', 'employee'];

async function readOnboarding(sb, userId) {
  const { data } = await sb.from('re_onboarding').select('*').eq('user_id', userId).single();
  return data || { data: {} };
}

function buildSuggestions(onboardingData, members, creditors, suppliers) {
  const data = onboardingData || {};
  const socios = Array.isArray(data.socios) ? data.socios : [];
  const dividas = Array.isArray(data.dividas) ? data.dividas : [];
  const suggestions = [];

  const companyCoreDocs = [
    { name: 'Contrato Social / Estatuto (consolidado)', doc_type: 'contrato_social', entity_type: 'company', priority: 1 },
    { name: 'Certidão de CNPJ', doc_type: 'certidao', entity_type: 'company', priority: 1 },
    { name: 'Comprovante de Endereço da Empresa', doc_type: 'outros', entity_type: 'company', priority: 1 },
  ];
  companyCoreDocs.forEach((item) => suggestions.push(item));

  socios.forEach((socio) => {
    const name = socio.nome || socio.name || 'Sócio';
    suggestions.push(
      { name: `RG / CNH — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 1 },
      { name: `CPF — ${name}`, doc_type: 'outros', entity_type: 'member', entity_label: name, priority: 1 },
    );
  });

  (members || []).forEach((member) => {
    if (!socios.some((socio) => String(socio.email || '').toLowerCase() === String(member.email || '').toLowerCase())) {
      suggestions.push({ name: `RG / CNH — ${member.name}`, doc_type: 'outros', entity_type: 'member', entity_id: member.id, entity_label: member.name, priority: 2 });
    }
  });

  dividas.forEach((divida) => {
    if (divida.estaJudicializada === 'sim' || divida.estaJudicializada === true) {
      const creditor = divida.nomeCredor || 'Credor';
      suggestions.push({ name: `Petição inicial / processo — ${creditor}`, doc_type: 'outros', entity_type: 'creditor', entity_label: creditor, priority: 1 });
    }
  });

  (creditors || []).forEach((creditor) => {
    suggestions.push({ name: `Contrato / escritura de dívida — ${creditor.name}`, doc_type: 'outros', entity_type: 'creditor', entity_id: creditor.id, entity_label: creditor.name, priority: 2 });
  });

  (suppliers || []).forEach((supplier) => {
    suggestions.push({ name: `Contrato de prestação de serviços — ${supplier.name}`, doc_type: 'outros', entity_type: 'supplier', entity_id: supplier.id, entity_label: supplier.name, priority: 2 });
  });

  return suggestions;
}

export async function handleDocumentRequests(request, context) {
  if (context.scope === 'admin') {
    if (context.params.action === 'suggestions' && request.method === 'GET') {
      const onboarding = await readOnboarding(context.sb, context.params.clientId);
      const [membersRes, creditorsRes, suppliersRes] = await Promise.all([
        context.sb.from('re_company_users').select('id,name,email').eq('company_id', context.params.clientId),
        context.sb.from('re_creditors').select('id,name').eq('company_id', context.params.clientId),
        context.sb.from('re_suppliers').select('id,name').eq('company_id', context.params.clientId),
      ]);
      return json({ suggestions: buildSuggestions(onboarding?.data, membersRes.data || [], creditorsRes.data || [], suppliersRes.data || []) });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.name?.trim()) return json({ error: 'Nome do documento é obrigatório.' }, { status: 400 });
      if (!ENTITY_TYPES.includes(body.entity_type || 'company')) return json({ error: 'Tipo de entidade inválido.' }, { status: 400 });

      const { data, error } = await context.sb.from('re_document_requests').insert({
        company_id: context.params.clientId,
        requested_by: context.user.id,
        name: body.name.trim(),
        doc_type: body.doc_type || 'outros',
        description: body.description?.trim() || null,
        entity_type: body.entity_type || 'company',
        entity_id: body.entity_id || null,
        entity_label: body.entity_label?.trim() || null,
        deadline: body.deadline || null,
        admin_notes: body.admin_notes?.trim() || null,
      }).select().single();
      if (error) return json({ error: error.message }, { status: 500 });

      const { data: owner } = await context.sb.from('re_users')
        .select('email,name')
        .eq('id', context.params.clientId)
        .single();
      const portalUrl = `${getBaseUrl(context.env)}/dashboard.html#documentos`;

      queueSideEffect(context, async () => {
        if (owner?.email) {
          await sendMail(context.env, {
            to: owner.email,
            subject: `[Recupera Empresas] Novo documento solicitado: ${body.name.trim()}`,
            html: emailWrapper('Documento solicitado pelo consultor', `
              <p>Ola, <b>${owner?.name || 'Cliente'}</b>!</p>
              <p>O seu consultor solicitou o seguinte documento:</p>
              <table style="border-collapse:collapse;width:100%;margin:12px 0">
                <tr><td style="font-weight:600;padding:6px 0;width:130px">Documento:</td><td>${body.name.trim()}</td></tr>
                ${body.entity_label ? `<tr><td style="font-weight:600;padding:6px 0">Entidade:</td><td>${body.entity_label}</td></tr>` : ''}
                ${body.deadline ? `<tr><td style="font-weight:600;padding:6px 0">Prazo:</td><td>${new Date(`${body.deadline}T12:00:00`).toLocaleDateString('pt-BR')}</td></tr>` : ''}
                ${body.description ? `<tr><td style="font-weight:600;padding:6px 0">Instrucoes:</td><td>${body.description}</td></tr>` : ''}
              </table>
              <p>Acesse o portal para fazer o upload:</p>
              <p><a href="${portalUrl}" style="background:#1A56DB;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Enviar documento</a></p>
            `),
          });
        }

        await pushNotification(
          context.sb,
          context.params.clientId,
          'info',
          'Documento solicitado',
          `Seu consultor solicitou: ${body.name.trim()}`,
          'document_request',
          data.id,
        );

        await auditLog(context.sb, {
          actorId: context.user.id,
          actorEmail: context.user.email,
          actorRole: 'admin',
          entityType: 're_document_requests',
          entityId: data.id,
          action: 'create',
          after: { name: body.name.trim(), company_id: context.params.clientId },
        });
      }, 'document-request-create');

      return json({ success: true, request: data });
    }

    if (request.method === 'GET') {
      const { data } = await context.sb.from('re_document_requests')
        .select('*')
        .eq('company_id', context.params.clientId)
        .order('created_at', { ascending: false });
      return json({ requests: data || [] });
    }

    if (request.method === 'DELETE') {
      const { error } = await context.sb.from('re_document_requests')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', context.params.reqId)
        .eq('company_id', context.params.clientId);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    if (request.method === 'PUT') {
      const body = await readJson(request);
      if (!['approved', 'rejected', 'pending', 'cancelled'].includes(body.status)) {
        return json({ error: 'Status inválido.' }, { status: 400 });
      }
      const updates = { status: body.status, updated_at: new Date().toISOString() };
      if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes?.trim() || null;
      const { error } = await context.sb.from('re_document_requests')
        .update(updates)
        .eq('id', context.params.reqId)
        .eq('company_id', context.params.clientId);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (request.method === 'GET') {
    const cid = companyId(context.user);
    const { data } = await context.sb.from('re_document_requests')
      .select('*')
      .eq('company_id', cid)
      .in('status', ['pending', 'uploaded'])
      .order('created_at', { ascending: false });
    return json({ requests: data || [] });
  }

  if (request.method === 'PUT') {
    const body = await readJson(request);
    const cid = companyId(context.user);
    if (!body.doc_id) return json({ error: 'doc_id é obrigatório.' }, { status: 400 });

    const { data: documentRequest } = await context.sb.from('re_document_requests')
      .select('*')
      .eq('id', context.params.reqId)
      .eq('company_id', cid)
      .single();
    if (!documentRequest) return json({ error: 'Solicitação não encontrada.' }, { status: 404 });
    if (!['pending'].includes(documentRequest.status)) return json({ error: 'Solicitação já atendida.' }, { status: 409 });

    await context.sb.from('re_document_requests').update({
      status: 'uploaded',
      fulfilled_doc_id: body.doc_id,
      fulfilled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', context.params.reqId);

    await context.sb.from('re_documents').update({ request_id: context.params.reqId }).eq('id', body.doc_id);
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}