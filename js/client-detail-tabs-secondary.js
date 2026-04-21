'use strict';

(function () {
  function secondaryLoading(message) {
    return `<div class="admin-finance-loading">${message}</div>`;
  }

  function agendaStatusClass(status) {
    const toneMap = {
      pending: 'cds-status-pending',
      confirmed: 'cds-status-confirmed',
      cancelled: 'cds-status-cancelled',
      rescheduled: 'cds-status-rescheduled',
    };
    return toneMap[status] || 'cds-status-neutral';
  }

  function renderMessages(context) {
    const { body, messages, currentClientId, currentClientData } = context;
    logDrawerDiagnostic('Mensagens', {
      route: `/api/admin/client/${currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['messages'],
      actualPayload: { messages },
      note: 'Deveria usar o array messages da rota base; ao abrir a guia, o POST de seen Ã© apenas efeito colateral.',
    });

    if (currentClientId) {
      fetch(`/api/admin/messages/seen/${currentClientId}`, { method: 'POST', headers: authH() }).catch(() => {});
      if (_unreadMsgs) { _unreadMsgs[currentClientId] = 0; }
      const btn = document.getElementById('drawerTabMessages');
      if (btn) btn.innerHTML = btn.innerHTML.replace(/\s*<span[^>]*>.*?<\/span>/g, '') + '';
    }

    const messageTemplates = [
      { label: 'Solicitar dados pendentes', icon: 'ðŸ“‹', text: 'Identificamos que algumas informaÃ§Ãµes estÃ£o pendentes no seu cadastro. Para avanÃ§armos na elaboraÃ§Ã£o do Business Plan, precisamos que vocÃª complemente os dados do formulÃ¡rio de onboarding. Caso tenha dÃºvidas, estamos Ã  disposiÃ§Ã£o.' },
      { label: 'Ajuste de documento', icon: 'ðŸ“„', text: 'O documento enviado apresenta algumas inconsistÃªncias. Solicitamos o reenvio com as seguintes correÃ§Ãµes:\n- Verificar perÃ­odo das informaÃ§Ãµes\n- Incluir detalhamento solicitado\n\nAssim que o ajuste for realizado, daremos continuidade Ã  anÃ¡lise.' },
      { label: 'AtualizaÃ§Ã£o de etapa', icon: 'ðŸ“Š', text: 'Informamos que estamos avanÃ§ando na anÃ¡lise do seu processo. Atualmente, estamos na fase de estruturaÃ§Ã£o do Business Plan. Caso haja qualquer atualizaÃ§Ã£o relevante sobre a situaÃ§Ã£o da empresa, por favor nos comunique.' },
      { label: 'Etapa aprovada', icon: 'âœ…', text: 'Temos uma boa notÃ­cia! A etapa de diagnÃ³stico foi concluÃ­da com sucesso. A partir de agora, seguiremos para a estruturaÃ§Ã£o da estratÃ©gia de recuperaÃ§Ã£o. Em breve entraremos em contato com os prÃ³ximos passos.' },
      { label: 'Agendar reuniÃ£o', icon: 'ðŸ“…', text: 'GostarÃ­amos de agendar uma reuniÃ£o para discutir o andamento do seu processo. Por favor, acesse a seÃ§Ã£o "Agenda" no portal e selecione um horÃ¡rio de sua preferÃªncia. Aguardamos sua confirmaÃ§Ã£o.' },
    ];

    body.innerHTML = `
      <div class="msg-templates-label">Mensagens rÃ¡pidas</div>
      <div class="msg-templates">
        ${messageTemplates.map((template, index) => `
          <button class="msg-template-btn" onclick="applyMsgTemplate(${index})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${template.label}
          </button>`).join('')}
      </div>
      <div class="message-thread cds-message-thread" id="adminMsgThread">
        ${!messages.length
          ? '<div class="empty-state"><p>Nenhuma mensagem.</p></div>'
          : messages.map(message => `<div>
              <div class="message-bubble from-${message.fromRole || message.from}">
                <div class="message-from">${(message.fromRole || message.from) === 'admin' ? 'Recupera Empresas' : message.fromName || 'Cliente'}</div>
                ${message.text}
                <div class="message-ts">${new Date(message.ts).toLocaleString('pt-BR')}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="message-input-row cds-message-input-row">
        <input type="text" class="message-input" id="adminMsgInput" placeholder="Escrever mensagem ao cliente..."
               onkeydown="if(event.key==='Enter')sendAdminMessage()"/>
        <button class="btn-send" onclick="sendAdminMessage()">Enviar</button>
      </div>`;

    setTimeout(() => {
      const thread = document.getElementById('adminMsgThread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }, 50);

    window._msgTemplates = messageTemplates;
  }

  async function renderAgenda(context) {
    const { body, currentClientId, currentClientData } = context;
    body.innerHTML = secondaryLoading('Carregando agendamentos...');
    let bookings = [];

    try {
      const route = `/api/admin/client/${currentClientId}/bookings`;
      const response = await fetch(route, { headers: authH() });
      const payload = await readDrawerResponse('Agenda', route, response, ['bookings'], 'Deveria retornar bookings com re_agenda_slots aninhado para cada agendamento.');
      if (response.ok) bookings = payload.bookings || [];
    } catch (error) {
      logDrawerDiagnostic('Agenda', {
        route: `/api/admin/client/${currentClientId}/bookings`,
        source: 'fetch',
        expectedKeys: ['bookings'],
        actualPayload: null,
        note: 'Deveria retornar bookings com dados do slot vinculado.',
        error: error.message,
      });
    }

    const statusMap = {
      pending: { label:'Pendente' },
      confirmed: { label:'Confirmado' },
      cancelled: { label:'Cancelado' },
      rescheduled: { label:'Remarcado' },
    };

    let html = `
      <div class="cds-section-header">
        <div class="cds-section-title">Agendamentos</div>
        <button onclick="openBookForClientFromDrawer('${currentClientId}')"
          class="btn-primary cds-new-booking-btn">
          ðŸ“… Novo agendamento
        </button>
      </div>`;

    if (!bookings.length) {
      html += `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Nenhum agendamento encontrado.</p>
      </div>`;
      body.innerHTML = html;
      return;
    }

    const sorted = [...bookings].sort((left, right) => {
      const leftDate = left.re_agenda_slots?.starts_at || '';
      const rightDate = right.re_agenda_slots?.starts_at || '';
      return rightDate.localeCompare(leftDate);
    });

    html += sorted.map(booking => {
      const slot = booking.re_agenda_slots || {};
      const startsAt = slot.starts_at ? new Date(slot.starts_at) : null;
      const endsAt = slot.ends_at ? new Date(slot.ends_at) : null;
      const status = statusMap[booking.status] || { label: booking.status };
      const isPast = startsAt && startsAt < new Date();
      const clientName = (currentClientData.user?.name || '').replace(/'/g, '');
      const bookingClasses = `cds-booking-item${isPast ? ' cds-booking-item-past' : ''}`;
      return `
        <div class="${bookingClasses}">
          <div class="cds-booking-header-row">
            <div class="cds-booking-copy">
              <div class="cds-booking-title">${slot.title || 'â€”'}</div>
              ${startsAt ? `<div class="cds-booking-time">
                ${startsAt.toLocaleDateString('pt-BR')} Ã s ${String(startsAt.getHours()).padStart(2,'0')}:${String(startsAt.getMinutes()).padStart(2,'0')}
                ${endsAt ? `â€“ ${String(endsAt.getHours()).padStart(2,'0')}:${String(endsAt.getMinutes()).padStart(2,'0')}` : ''}
              </div>` : ''}
              ${booking.notes ? `<div class="cds-booking-note">${booking.notes}</div>` : ''}
              ${booking.cancel_reason ? `<div class="cds-booking-cancel-reason">Motivo: ${booking.cancel_reason}</div>` : ''}
            </div>
            <span class="cds-status-pill ${agendaStatusClass(booking.status)}">${status.label}</span>
          </div>
          ${booking.status === 'pending' ? `
          <div class="cds-booking-actions">
            <button onclick="agendaConfirmBooking('${booking.id}');renderClientDetailTab('agenda');" class="cds-action-btn cds-action-btn-confirm">âœ… Confirmar</button>
            <button onclick="agendaRescheduleBooking('${booking.id}','${clientName}')" class="cds-action-btn cds-action-btn-reschedule">â†•ï¸ Remarcar</button>
            <button onclick="agendaCancelBooking('${booking.id}','${clientName}')" class="cds-action-btn cds-action-btn-cancel">âŒ Cancelar</button>
          </div>` : booking.status === 'confirmed' ? `
          <div class="cds-booking-actions">
            <button onclick="agendaRescheduleBooking('${booking.id}','${clientName}')" class="cds-action-btn cds-action-btn-reschedule">â†•ï¸ Remarcar</button>
            <button onclick="agendaCancelBooking('${booking.id}','${clientName}')" class="cds-action-btn cds-action-btn-cancel">âŒ Cancelar</button>
          </div>` : ''}
        </div>`;
    }).join('');

    body.innerHTML = html;
  }

  const DOC_TYPE_LABELS = {
    dre:'DRE', balanco:'BalanÃ§o', fluxo_caixa:'Fluxo de Caixa',
    contrato_social:'Contrato Social', procuracao:'ProcuraÃ§Ã£o',
    certidao:'CertidÃ£o', extrato:'Extrato', nota_fiscal:'NF', outros:'Outros',
  };
  const DOC_STATUS_MAP = {
    pendente:          { label:'Pendente',          cls:'badge-gray'  },
    em_analise:        { label:'Em anÃ¡lise',        cls:'badge-blue'  },
    aprovado:          { label:'Aprovado',          cls:'badge-green' },
    reprovado:         { label:'Reprovado',         cls:'badge-red'   },
    ajuste_solicitado: { label:'Ajuste solicitado', cls:'badge-amber' },
  };
  const REQ_STATUS = {
    pending:   { label:'Aguardando envio', cls:'badge-amber' },
    uploaded:  { label:'Enviado â€” revisar', cls:'badge-blue' },
    approved:  { label:'Aprovado',         cls:'badge-green' },
    rejected:  { label:'Rejeitado',        cls:'badge-red'  },
    cancelled: { label:'Cancelado',        cls:'badge-gray' },
  };
  const ENTITY_LABELS = {
    company:'Empresa', member:'Membro', creditor:'Credor',
    supplier:'Fornecedor', contract:'Contrato', employee:'FuncionÃ¡rio',
  };

  async function renderDocs(context) {
    const { body, currentClientId } = context;
    body.innerHTML = secondaryLoading('Carregando documentos...');

    const [docsRes, reqsRes] = await Promise.all([
      fetch(`/api/admin/client/${currentClientId}/documents`, { headers: authH() }),
      fetch(`/api/admin/client/${currentClientId}/document-requests`, { headers: authH() }),
    ]);
    const { documents = [] } = docsRes.ok ? await docsRes.json() : {};
    const { requests = [] } = reqsRes.ok ? await reqsRes.json() : {};

    const pending  = requests.filter(r => r.status === 'pending');
    const uploaded = requests.filter(r => r.status === 'uploaded');
    const resolved = requests.filter(r => ['approved','rejected','cancelled'].includes(r.status));

    function reqCard(r) {
      const st = REQ_STATUS[r.status] || REQ_STATUS.pending;
      const deadline = r.deadline ? `<span style="font-size:11px;color:#9ca3af"> Â· Prazo: ${new Date(r.deadline+'T12:00:00').toLocaleDateString('pt-BR')}</span>` : '';
      const entity = (r.entity_type !== 'company' && r.entity_label)
        ? `<span style="font-size:11px;color:#6366f1;margin-left:4px">${ENTITY_LABELS[r.entity_type]}: ${escHtml(r.entity_label)}</span>` : '';
      const docLink = r.fulfilled_doc_id
        ? `<a href="/api/documents/${r.fulfilled_doc_id}/file?token=${getToken()}" target="_blank" class="cds-doc-link" style="font-size:12px">Ver arquivo enviado</a>` : '';
      const actions = r.status === 'uploaded'
        ? `<div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-xs btn-outline" onclick="adminApproveDocReq('${currentClientId}','${r.id}')">Aprovar</button>
            <button class="btn btn-xs btn-outline btn-danger" onclick="adminRejectDocReq('${currentClientId}','${r.id}')">Rejeitar</button>
           </div>` : '';
      const cancel = (r.status === 'pending')
        ? `<button class="btn btn-xs btn-outline btn-danger" onclick="adminCancelDocReq('${currentClientId}','${r.id}')" style="margin-top:6px">Cancelar</button>` : '';
      return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${escHtml(r.name)}</div>
            <div style="font-size:11px;color:#6b7280">${DOC_TYPE_LABELS[r.doc_type] || r.doc_type}${entity}${deadline}</div>
            ${r.description ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${escHtml(r.description)}</div>` : ''}
          </div>
          <span class="badge ${st.cls}" style="margin-left:8px;flex-shrink:0">${st.label}</span>
        </div>
        ${docLink}${actions}${cancel}
      </div>`;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:700;font-size:14px">SolicitaÃ§Ãµes de documentos</div>
        <button class="btn btn-sm btn-primary" onclick="adminRequestDoc('${currentClientId}')">+ Solicitar documento</button>
      </div>`;

    if (!requests.length) {
      html += `<p style="font-size:13px;color:#9ca3af;margin-bottom:16px">Nenhuma solicitaÃ§Ã£o criada.</p>`;
    } else {
      if (pending.length) {
        html += `<div style="font-size:12px;font-weight:600;color:#d97706;margin-bottom:6px">Aguardando envio (${pending.length})</div>`;
        html += pending.map(reqCard).join('');
      }
      if (uploaded.length) {
        html += `<div style="font-size:12px;font-weight:600;color:#1d4ed8;margin-top:10px;margin-bottom:6px">Enviados â€” aguardando revisÃ£o (${uploaded.length})</div>`;
        html += uploaded.map(reqCard).join('');
      }
      if (resolved.length) {
        html += `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:#6b7280;font-weight:600">HistÃ³rico (${resolved.length})</summary>
          <div style="margin-top:8px">${resolved.map(reqCard).join('')}</div></details>`;
      }
    }

    html += `<div style="border-top:1px solid #e5e7eb;margin:20px 0 12px;padding-top:12px;font-weight:700;font-size:14px">
      Documentos enviados (${documents.length})
    </div>`;

    if (!documents.length) {
      html += `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Cliente ainda nÃ£o enviou documentos.</p>
      </div>`;
    } else {
      html += documents.map(doc => {
        const status = DOC_STATUS_MAP[doc.status] || DOC_STATUS_MAP.pendente;
        const typeLabel = DOC_TYPE_LABELS[doc.docType] || doc.docType;
        const createdAt = new Date(doc.createdAt).toLocaleDateString('pt-BR');
        const comments = doc.comments || [];
        // Find linked request
        const linkedReq = requests.find(r => r.fulfilled_doc_id === doc.id);
        return `<div class="cds-doc-card">
          <div class="cds-doc-header">
            <div class="cds-doc-copy">
              <div class="cds-doc-name">${escHtml(doc.name)}</div>
              <div class="cds-doc-meta">${typeLabel} Â· ${createdAt}${linkedReq ? ` Â· <span style="color:#6366f1">Ref: ${escHtml(linkedReq.name)}</span>` : ''}</div>
            </div>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>
          <div class="cds-doc-controls">
            <div>
              <label class="form-label-sm cds-doc-label">Alterar status</label>
              <select class="portal-select cds-doc-select" id="docSt_${doc.id}">
                ${Object.entries(DOC_STATUS_MAP).map(([value, config]) =>
                  `<option value="${value}"${doc.status === value ? ' selected' : ''}>${config.label}</option>`
                ).join('')}
              </select>
            </div>
            <button class="btn-sm btn-sm-approve" onclick="updateDocStatus('${doc.id}')">Salvar</button>
          </div>
          <div class="cds-doc-comment-wrap">
            <input type="text" class="portal-input cds-doc-comment-input" id="docCmt_${doc.id}" placeholder="ComentÃ¡rio para o cliente (opcional)"/>
          </div>
          <div class="cds-doc-link-row">
            <a href="${(window.RE_API_BASE||'').replace(/\/+$/,'')}/api/documents/${doc.id}/file?token=${getToken()}"
               target="_blank" class="cds-doc-link">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Visualizar / baixar
            </a>
          </div>
          ${comments.length ? `<div class="cds-doc-comments">
            ${comments.map(c => `<div class="cds-doc-comment-item">
              <div class="cds-doc-comment-head">
                <strong>${c.from === 'admin' ? 'Equipe' : 'Cliente'}</strong>
                <span class="cds-doc-comment-date">${new Date(c.ts).toLocaleDateString('pt-BR')}</span>
              </div>
              <div>${escHtml(c.text)}</div>
            </div>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('');
    }

    body.innerHTML = html;
  }

  window.REClientDetailSecondaryTabs = {
    async render(tab, context) {
      if (tab === 'messages') {
        renderMessages(context);
        return true;
      }
      if (tab === 'agenda') {
        await renderAgenda(context);
        return true;
      }
      if (tab === 'docs') {
        await renderDocs(context);
        return true;
      }
      return false;
    },
  };
  window.REAdminDrawerSecondaryTabs = window.REClientDetailSecondaryTabs;

console.info('[RE:client-detail-tabs-secondary] loaded');
})();
