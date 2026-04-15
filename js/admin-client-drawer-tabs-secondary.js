'use strict';

(function () {
  function renderMessages(context) {
    const { body, messages, currentClientId, currentClientData } = context;
    logDrawerDiagnostic('Mensagens', {
      route: `/api/admin/client/${currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['messages'],
      actualPayload: { messages },
      note: 'Deveria usar o array messages da rota base; ao abrir a guia, o POST de seen é apenas efeito colateral.',
    });

    if (currentClientId) {
      fetch(`/api/admin/messages/seen/${currentClientId}`, { method: 'POST', headers: authH() }).catch(() => {});
      if (_unreadMsgs) { _unreadMsgs[currentClientId] = 0; }
      const btn = document.getElementById('drawerTabMessages');
      if (btn) btn.innerHTML = btn.innerHTML.replace(/\s*<span[^>]*>.*?<\/span>/g, '') + '';
    }

    const messageTemplates = [
      { label: 'Solicitar dados pendentes', icon: '📋', text: 'Identificamos que algumas informações estão pendentes no seu cadastro. Para avançarmos na elaboração do Business Plan, precisamos que você complemente os dados do formulário de onboarding. Caso tenha dúvidas, estamos à disposição.' },
      { label: 'Ajuste de documento', icon: '📄', text: 'O documento enviado apresenta algumas inconsistências. Solicitamos o reenvio com as seguintes correções:\n- Verificar período das informações\n- Incluir detalhamento solicitado\n\nAssim que o ajuste for realizado, daremos continuidade à análise.' },
      { label: 'Atualização de etapa', icon: '📊', text: 'Informamos que estamos avançando na análise do seu processo. Atualmente, estamos na fase de estruturação do Business Plan. Caso haja qualquer atualização relevante sobre a situação da empresa, por favor nos comunique.' },
      { label: 'Etapa aprovada', icon: '✅', text: 'Temos uma boa notícia! A etapa de diagnóstico foi concluída com sucesso. A partir de agora, seguiremos para a estruturação da estratégia de recuperação. Em breve entraremos em contato com os próximos passos.' },
      { label: 'Agendar reunião', icon: '📅', text: 'Gostaríamos de agendar uma reunião para discutir o andamento do seu processo. Por favor, acesse a seção "Agenda" no portal e selecione um horário de sua preferência. Aguardamos sua confirmação.' },
    ];

    body.innerHTML = `
      <div class="msg-templates-label">Mensagens rápidas</div>
      <div class="msg-templates">
        ${messageTemplates.map((template, index) => `
          <button class="msg-template-btn" onclick="applyMsgTemplate(${index})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${template.label}
          </button>`).join('')}
      </div>
      <div class="message-thread" style="max-height:260px;" id="adminMsgThread">
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
      <div class="message-input-row" style="margin-top:12px;">
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
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando agendamentos...</div>';
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
      pending: { bg:'#FEF3C7', color:'#D97706', label:'Pendente' },
      confirmed: { bg:'#DCFCE7', color:'#16A34A', label:'Confirmado' },
      cancelled: { bg:'#FEE2E2', color:'#DC2626', label:'Cancelado' },
      rescheduled: { bg:'#EDE9FE', color:'#7C3AED', label:'Remarcado' },
    };

    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:14px;font-weight:700;">Agendamentos</div>
        <button onclick="openBookForClientFromDrawer('${currentClientId}')"
          style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">
          📅 Novo agendamento
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
      const status = statusMap[booking.status] || { bg:'#F1F5F9', color:'#64748b', label: booking.status };
      const isPast = startsAt && startsAt < new Date();
      const clientName = (currentClientData.user?.name || '').replace(/'/g, '');
      return `
        <div style="padding:11px 0;border-bottom:1px solid var(--border);${isPast ? 'opacity:.7' : ''}">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:#1e293b;">${slot.title || '—'}</div>
              ${startsAt ? `<div style="font-size:12px;color:var(--text-muted);">
                ${startsAt.toLocaleDateString('pt-BR')} às ${String(startsAt.getHours()).padStart(2,'0')}:${String(startsAt.getMinutes()).padStart(2,'0')}
                ${endsAt ? `– ${String(endsAt.getHours()).padStart(2,'0')}:${String(endsAt.getMinutes()).padStart(2,'0')}` : ''}
              </div>` : ''}
              ${booking.notes ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px;">${booking.notes}</div>` : ''}
              ${booking.cancel_reason ? `<div style="font-size:11px;color:#DC2626;margin-top:2px;">Motivo: ${booking.cancel_reason}</div>` : ''}
            </div>
            <span style="font-size:10px;padding:2px 8px;border-radius:12px;background:${status.bg};color:${status.color};font-weight:600;white-space:nowrap;">${status.label}</span>
          </div>
          ${booking.status === 'pending' ? `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="agendaConfirmBooking('${booking.id}');renderDrawerTab('agenda');" style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#15803D;font-size:11px;font-weight:600;">✅ Confirmar</button>
            <button onclick="agendaRescheduleBooking('${booking.id}','${clientName}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
            <button onclick="agendaCancelBooking('${booking.id}','${clientName}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
          </div>` : booking.status === 'confirmed' ? `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="agendaRescheduleBooking('${booking.id}','${clientName}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
            <button onclick="agendaCancelBooking('${booking.id}','${clientName}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
          </div>` : ''}
        </div>`;
    }).join('');

    body.innerHTML = html;
  }

  async function renderDocs(context) {
    const { body, currentClientId } = context;
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando...</div>';

    const route = `/api/admin/client/${currentClientId}/documents`;
    const response = await fetch(route, { headers: authH() });
    const payload = await readDrawerResponse('Documentos', route, response, ['documents'], 'Deveria retornar documents com name, status, createdAt e comentários quando existirem.');
    if (!response.ok) {
      body.innerHTML = `<div class="empty-state"><p>${escHtml(payload.error || 'Erro ao carregar documentos.')}</p></div>`;
      return;
    }

    const { documents } = payload;
    const docStatusMap = {
      pendente: { label:'Pendente', cls:'badge-gray' },
      em_analise: { label:'Em análise', cls:'badge-blue' },
      aprovado: { label:'Aprovado', cls:'badge-green' },
      reprovado: { label:'Reprovado', cls:'badge-red' },
      ajuste_solicitado: { label:'Ajuste solicitado', cls:'badge-amber' },
    };
    const docTypeMap = {
      dre:'DRE', balanco:'Balanço', fluxo_caixa:'Fluxo de Caixa',
      contrato_social:'Contrato Social', procuracao:'Procuração',
      certidao:'Certidão', extrato:'Extrato', nota_fiscal:'NF', outros:'Outros',
    };

    if (!documents.length) {
      body.innerHTML = `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Cliente ainda não enviou documentos.</p>
      </div>`;
      return;
    }

    body.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:12px;">
        ${documents.length} documento(s) — clique no status para alterar
      </div>
      ${documents.map(documentItem => {
        const status = docStatusMap[documentItem.status] || docStatusMap.pendente;
        const typeLabel = docTypeMap[documentItem.docType] || documentItem.docType;
        const createdAt = new Date(documentItem.createdAt).toLocaleDateString('pt-BR');
        const comments = documentItem.comments || [];
        return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13px;">${documentItem.name}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${typeLabel} · ${createdAt}</div>
            </div>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>

          <div style="margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;">
            <div>
              <label class="form-label-sm" style="font-size:11px;">Alterar status</label>
              <select class="portal-select" id="docSt_${documentItem.id}" style="font-size:12px;">
                ${Object.entries(docStatusMap).map(([value, config]) => `<option value="${value}"${documentItem.status === value ? ' selected' : ''}>${config.label}</option>`).join('')}
              </select>
            </div>
            <button class="btn-sm btn-sm-approve" onclick="updateDocStatus('${documentItem.id}')">Salvar</button>
          </div>
          <div style="margin-top:8px;">
            <input type="text" class="portal-input" id="docCmt_${documentItem.id}" placeholder="Comentário para o cliente (opcional)" style="font-size:12px;"/>
          </div>

          <div style="margin-top:10px;display:flex;gap:12px;align-items:center;">
            <a href="${(window.RE_API_BASE || '').replace(/\/+$/, '')}/api/documents/${documentItem.id}/file?token=${getToken()}" target="_blank"
               style="font-size:12px;color:var(--primary);text-decoration:none;display:flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Visualizar / baixar
            </a>
          </div>

          ${comments.length ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">
            ${comments.map(comment => `<div style="font-size:11px;background:#F8FAFC;padding:6px 8px;border-radius:6px;margin-top:4px;">
              <strong>${comment.from === 'admin' ? 'Equipe' : 'Cliente'}</strong>: ${comment.text}
              <span style="float:right;color:var(--text-muted);">${new Date(comment.ts).toLocaleDateString('pt-BR')}</span>
            </div>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('')}`;
  }

  window.REAdminDrawerSecondaryTabs = {
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
})();