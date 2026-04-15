'use strict';

(function () {
  const SLOT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  function bookingStatusBadge(status) {
    const map = {
      pending: { bg: '#FEF3C7', color: '#92400e', label: 'Pendente' },
      confirmed: { bg: '#DCFCE7', color: '#166534', label: 'Confirmado' },
      cancelled: { bg: '#FEE2E2', color: '#991B1B', label: 'Cancelado' },
      rescheduled: { bg: '#E0E7FF', color: '#3730A3', label: 'Remarcado' },
    };
    const badge = map[status] || { bg: '#F1F5F9', color: '#64748b', label: status };
    return `<span style="font-size:10px;padding:2px 8px;border-radius:12px;background:${badge.bg};color:${badge.color};font-weight:600;">${badge.label}</span>`;
  }

  function bookingClientName(booking) {
    if (booking.re_users?.name || booking.re_users?.email) return booking.re_users.name || booking.re_users.email;
    if (booking.external_contact) {
      const externalContact = typeof booking.external_contact === 'string'
        ? JSON.parse(booking.external_contact)
        : booking.external_contact;
      return (externalContact.name || externalContact.email || 'Contato externo') + ' <span style="font-size:10px;color:#94a3b8;">(externo)</span>';
    }
    return 'Cliente';
  }

  async function loadAdminAgenda() {
    const listEl = document.getElementById('adminSlotsList');
    if (listEl) listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando...</div>';

    const response = await fetch('/api/admin/agenda/slots', { headers: authH() });
    const payload = await readAdminResponse(response);
    if (!response.ok) {
      if (listEl) listEl.innerHTML = `<div class="empty-state"><p>${payload.error || 'Erro ao carregar.'}</p></div>`;
      return;
    }

    const slots = payload.slots || [];
    if (!listEl) return;

    if (!slots.length) {
      listEl.innerHTML = `<div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Nenhum horário publicado. Clique em "Novo horário" para começar.</p>
      </div>`;
      return;
    }

    listEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
      ${slots.map(slot => {
        const startDate = new Date(slot.starts_at);
        const endDate = new Date(slot.ends_at);
        const isPast = startDate < new Date();
        const bookings = (slot.bookings || []).filter(booking => booking.status !== 'rescheduled');
        const activeCount = bookings.filter(booking => booking.status === 'pending' || booking.status === 'confirmed').length;
        const locationIcon = slot.location === 'presencial' ? '📍' : '🔗';
        const locationLabel = slot.location === 'presencial' ? 'Presencial' : 'Online';
        const slotStatusStyle = isPast
          ? 'background:#F1F5F9;color:#94a3b8;'
          : activeCount >= slot.max_bookings
            ? 'background:#FEE2E2;color:#DC2626;'
            : 'background:#DCFCE7;color:#16A34A;';
        const slotStatusLabel = isPast ? 'Encerrado' : activeCount >= slot.max_bookings ? 'Lotado' : 'Disponível';

        return `
        <div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:14px 18px;${isPast ? 'opacity:.65' : ''}">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="min-width:52px;text-align:center;background:#F8FAFC;border-radius:8px;padding:6px 4px;">
              <div style="font-size:18px;font-weight:800;color:#1e3a5f;">${startDate.getDate()}</div>
              <div style="font-size:10px;color:#64748b;font-weight:600;">${SLOT_MONTHS[startDate.getMonth()]} ${startDate.getFullYear()}</div>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;color:#1e293b;">${slot.title}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">
                ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}
                – ${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}
                &nbsp;·&nbsp; ${slot.duration_min}min &nbsp;·&nbsp; ${slot.credits_cost} crédito${slot.credits_cost > 1 ? 's' : ''}
                &nbsp;·&nbsp; ${activeCount}/${slot.max_bookings} vagas
                &nbsp;·&nbsp; ${locationIcon} ${locationLabel}
              </div>
              ${slot.meeting_link ? `<div style="font-size:11px;margin-top:3px;"><a href="${slot.meeting_link}" target="_blank" style="color:#1e3a5f;">🔗 ${slot.meeting_link}</a></div>` : ''}
            </div>
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;white-space:nowrap;${slotStatusStyle}">${slotStatusLabel}</span>
            ${!isPast ? `<button onclick="openBookForClientModal('${slot.id}')" title="Agendar cliente"
              style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:5px 10px;cursor:pointer;color:#1e3a5f;font-size:11px;font-weight:600;white-space:nowrap;">
              + Agendar
            </button>` : ''}
            <button onclick="deleteSlot('${slot.id}')" title="Remover horário"
              style="background:none;border:1px solid #fecaca;border-radius:6px;padding:5px 8px;cursor:pointer;color:#ef4444;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
          ${bookings.length ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid #F1F5F9;">
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:8px;">RESERVAS</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${bookings.map(booking => {
                const clientName = bookingClientName(booking).replace(/'/g, '&#39;');
                const clientNamePlain = clientName.replace(/<[^>]+>/g, '').trim();
                return `
              <div style="display:flex;align-items:center;gap:8px;background:#F8FAFC;border-radius:8px;padding:8px 12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:0;">
                  <span style="font-size:12px;font-weight:600;color:#1e293b;">${clientName}</span>
                  ${booking.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:1px;">${booking.notes}</div>` : ''}
                  ${booking.cancel_reason && (booking.status === 'cancelled' || booking.status === 'rescheduled') ? `<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:1px;">Motivo: ${booking.cancel_reason}</div>` : ''}
                </div>
                ${bookingStatusBadge(booking.status)}
                ${booking.status === 'pending' ? `
                  <button onclick="agendaConfirmBooking('${booking.id}')" style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#15803D;font-size:11px;font-weight:600;">✅ Confirmar</button>
                  <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
                  <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
                ` : booking.status === 'confirmed' ? `
                  <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" style="background:#EEF2FF;border:1px solid #A5B4FC;border-radius:5px;padding:3px 8px;cursor:pointer;color:#4338CA;font-size:11px;font-weight:600;">↕️ Remarcar</button>
                  <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:5px;padding:3px 8px;cursor:pointer;color:#DC2626;font-size:11px;font-weight:600;">❌ Cancelar</button>
                ` : ''}
              </div>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  function toggleSlotForm() {
    const formCard = document.getElementById('slotFormCard');
    formCard.style.display = formCard.style.display === 'none' ? 'block' : 'none';
    if (formCard.style.display === 'block') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(11, 0, 0, 0);
      const formatDateTimeLocal = value => value.toISOString().slice(0, 16);
      document.getElementById('slotStart').value = formatDateTimeLocal(tomorrow);
      document.getElementById('slotEnd').value = formatDateTimeLocal(tomorrowEnd);
      document.getElementById('slotTitle').focus();
    }
  }

  async function createSlot() {
    const startsAt = document.getElementById('slotStart').value;
    const endsAt = document.getElementById('slotEnd').value;
    const title = document.getElementById('slotTitle').value.trim() || 'Consultoria';
    const creditsCost = parseInt(document.getElementById('slotCredits').value, 10) || 1;
    const maxBookings = parseInt(document.getElementById('slotMax').value, 10) || 1;
    const durationMin = parseInt(document.getElementById('slotDuration').value, 10) || 60;
    const location = document.getElementById('slotLocation').value || 'online';
    const meetingLink = document.getElementById('slotMeetingLink').value.trim() || null;

    if (!startsAt || !endsAt) {
      showToast('Preencha data/hora de início e fim.', 'error');
      return;
    }
    if (new Date(endsAt) <= new Date(startsAt)) {
      showToast('Fim deve ser após o início.', 'error');
      return;
    }

    const response = await fetch('/api/admin/agenda/slots', {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        title,
        credits_cost: creditsCost,
        max_bookings: maxBookings,
        duration_min: durationMin,
        location,
        meeting_link: meetingLink,
      }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('Horário publicado!', 'success');
      toggleSlotForm();
      loadAdminAgenda();
      return;
    }
    if (payload.diagnostic) console.error('[ADMIN AGENDA DIAGNOSTIC]', payload.diagnostic);
    showToast(payload.error || 'Erro ao publicar.', 'error');
  }

  async function deleteSlot(slotId) {
    if (!confirm('Remover este horário? Reservas existentes serão canceladas.')) return;
    const response = await fetch(`/api/admin/agenda/slots/${slotId}`, { method: 'DELETE', headers: authH() });
    if (response.ok) {
      showToast('Horário removido.', 'success');
      loadAdminAgenda();
      return;
    }
    showToast('Erro ao remover.', 'error');
  }

  async function agendaConfirmBooking(bookingId) {
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/confirm`, { method: 'PUT', headers: authH() });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('Reserva confirmada! E-mail enviado ao cliente.', 'success');
      loadAdminAgenda();
      return;
    }
    showToast(payload.error || 'Erro ao confirmar.', 'error');
  }

  async function agendaCancelBooking(bookingId, clientName) {
    const reason = prompt(`Motivo do cancelamento para ${clientName || 'este cliente'}:\n(obrigatório – será enviado por e-mail)`);
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('O motivo é obrigatório.', 'error');
      return;
    }
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/cancel`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('Reserva cancelada e cliente notificado.', 'success');
      loadAdminAgenda();
      return;
    }
    showToast(payload.error || 'Erro ao cancelar.', 'error');
  }

  async function agendaRescheduleBooking(bookingId, clientName) {
    const response = await fetch('/api/admin/agenda/slots?include_bookings=0', { headers: authH() });
    const payload = await readAdminResponse(response);
    if (!response.ok) {
      showToast(payload.error || 'Erro ao carregar horários.', 'error');
      return;
    }
    const futureSlots = (payload.slots || []).filter(slot => new Date(slot.starts_at) > new Date());
    if (!futureSlots.length) {
      showToast('Nenhum horário futuro disponível para remarcar.', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'rescheduleModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:440px;max-width:94vw;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="font-weight:700;font-size:16px;color:#1e3a5f;margin-bottom:4px;">↕️ Remarcar agendamento</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:16px;">Cliente: ${clientName}</div>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Novo horário</label>
        <select id="rescheduleSlotSelect" style="width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;margin-bottom:14px;">
          ${futureSlots.map(slot => {
            const startDate = new Date(slot.starts_at);
            const endDate = new Date(slot.ends_at);
            return `<option value="${slot.id}">${startDate.toLocaleDateString('pt-BR')} ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}–${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')} · ${slot.title}</option>`;
          }).join('')}
        </select>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Motivo / observação (obrigatório)</label>
        <textarea id="rescheduleReason" rows="3" placeholder="Ex.: Solicitação da empresa, conflito de agenda..." style="width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:18px;"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('rescheduleModal').remove()" style="padding:8px 16px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Cancelar</button>
          <button onclick="_submitReschedule('${bookingId}')" style="padding:8px 18px;border:none;border-radius:6px;background:#1e3a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Remarcar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  async function submitReschedule(bookingId) {
    const newSlotId = document.getElementById('rescheduleSlotSelect').value;
    const reason = document.getElementById('rescheduleReason').value.trim();
    if (!reason) {
      showToast('O motivo é obrigatório.', 'error');
      return;
    }
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/reschedule`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ new_slot_id: newSlotId, reason }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      document.getElementById('rescheduleModal')?.remove();
      showToast('Agendamento remarcado e cliente notificado.', 'success');
      loadAdminAgenda();
      return;
    }
    showToast(payload.error || 'Erro ao remarcar.', 'error');
  }

  async function openBookForClientModal(slotId) {
    const clientsResponse = await fetch('/api/admin/clients', { headers: authH() });
    const clients = clientsResponse.ok ? ((await clientsResponse.json()).clients || []) : [];

    const modal = document.createElement('div');
    modal.id = 'bookForClientModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:480px;max-width:94vw;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="font-weight:700;font-size:16px;color:#1e3a5f;margin-bottom:16px;">📅 Agendar cliente neste horário</div>

        <div style="display:flex;gap:0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:18px;">
          <button id="bfcTabExisting" onclick="_bfcTab('existing')"
            style="flex:1;padding:8px;border:none;background:#1e3a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">
            Cliente existente
          </button>
          <button id="bfcTabExternal" onclick="_bfcTab('external')"
            style="flex:1;padding:8px;border:none;background:#F1F5F9;color:#64748b;cursor:pointer;font-size:13px;font-weight:600;">
            Novo contato externo
          </button>
        </div>

        <div id="bfcPanelExisting">
          <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Selecionar cliente</label>
          <select id="bfcClientSelect" style="width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;margin-bottom:12px;">
            <option value="">— selecione —</option>
            ${clients.map(client => `<option value="${client.id}">${client.company || client.name} (${client.email})</option>`).join('')}
          </select>
        </div>

        <div id="bfcPanelExternal" style="display:none;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Nome *</label>
              <input id="bfcExtName" placeholder="Nome completo" style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">E-mail *</label>
              <input id="bfcExtEmail" type="email" placeholder="email@empresa.com" style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Telefone</label>
              <input id="bfcExtPhone" placeholder="(11) 99999-9999" style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Empresa</label>
              <input id="bfcExtCompany" placeholder="Empresa S.A." style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;">
            </div>
          </div>
        </div>

        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Observações (opcional)</label>
        <textarea id="bfcNotes" rows="2" placeholder="Pauta, objetivo da reunião..." style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:18px;"></textarea>

        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('bookForClientModal').remove()" style="padding:8px 16px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Cancelar</button>
          <button onclick="_submitBookForClient('${slotId}')" style="padding:8px 18px;border:none;border-radius:6px;background:#1e3a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Confirmar agendamento</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window._bfcMode = 'existing';
  }

  function switchBookForClientTab(mode) {
    window._bfcMode = mode;
    document.getElementById('bfcPanelExisting').style.display = mode === 'existing' ? '' : 'none';
    document.getElementById('bfcPanelExternal').style.display = mode === 'external' ? '' : 'none';
    document.getElementById('bfcTabExisting').style.cssText += mode === 'existing' ? ';background:#1e3a5f;color:#fff;' : ';background:#F1F5F9;color:#64748b;';
    document.getElementById('bfcTabExternal').style.cssText += mode === 'external' ? ';background:#1e3a5f;color:#fff;' : ';background:#F1F5F9;color:#64748b;';
  }

  async function submitBookForClient(slotId) {
    const notes = document.getElementById('bfcNotes').value.trim() || null;
    const body = { slot_id: slotId, notes };

    if (window._bfcMode === 'existing') {
      const userId = document.getElementById('bfcClientSelect').value;
      if (!userId) {
        showToast('Selecione um cliente.', 'error');
        return;
      }
      body.user_id = userId;
    } else {
      const name = document.getElementById('bfcExtName').value.trim();
      const email = document.getElementById('bfcExtEmail').value.trim();
      const phone = document.getElementById('bfcExtPhone').value.trim();
      const company = document.getElementById('bfcExtCompany').value.trim();
      if (!name || !email) {
        showToast('Nome e e-mail são obrigatórios.', 'error');
        return;
      }
      body.external_contact = { name, email, phone: phone || null, company: company || null };
    }

    const response = await fetch('/api/admin/agenda/book-for-client', {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify(body),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      document.getElementById('bookForClientModal')?.remove();
      showToast('Agendamento criado e confirmado!', 'success');
      loadAdminAgenda();
      return;
    }
    showToast(payload.error || 'Erro ao agendar.', 'error');
  }

  async function openBookForClientFromDrawer(clientId) {
    const response = await fetch('/api/admin/agenda/slots?include_bookings=0', { headers: authH() });
    const payload = await readAdminResponse(response);
    if (!response.ok) {
      showToast(payload.error || 'Erro ao carregar horários.', 'error');
      return;
    }
    const futureSlots = (payload.slots || []).filter(slot => new Date(slot.starts_at) > new Date());
    if (!futureSlots.length) {
      showToast('Nenhum horário futuro disponível.', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'bookDrawerModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px;width:420px;max-width:94vw;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="font-weight:700;font-size:16px;color:#1e3a5f;margin-bottom:16px;">📅 Novo agendamento</div>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Horário disponível</label>
        <select id="bookDrawerSlot" style="width:100%;padding:9px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;margin-bottom:12px;">
          ${futureSlots.map(slot => {
            const startDate = new Date(slot.starts_at);
            const endDate = new Date(slot.ends_at);
            return `<option value="${slot.id}">${startDate.toLocaleDateString('pt-BR')} ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}–${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')} · ${slot.title}</option>`;
          }).join('')}
        </select>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Observações (opcional)</label>
        <textarea id="bookDrawerNotes" rows="2" placeholder="Pauta, objetivo..." style="width:100%;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:18px;"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('bookDrawerModal').remove()" style="padding:8px 16px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Cancelar</button>
          <button onclick="_submitBookFromDrawer('${clientId}')" style="padding:8px 18px;border:none;border-radius:6px;background:#1e3a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Agendar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  async function submitBookFromDrawer(clientId) {
    const slotId = document.getElementById('bookDrawerSlot').value;
    const notes = document.getElementById('bookDrawerNotes').value.trim() || null;
    const response = await fetch('/api/admin/agenda/book-for-client', {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ slot_id: slotId, user_id: clientId, notes }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      document.getElementById('bookDrawerModal')?.remove();
      showToast('Agendamento criado!', 'success');
      renderDrawerTab('agenda');
      return;
    }
    showToast(payload.error || 'Erro ao agendar.', 'error');
  }

  window.loadAdminAgenda = loadAdminAgenda;
  window.toggleSlotForm = toggleSlotForm;
  window.createSlot = createSlot;
  window.deleteSlot = deleteSlot;
  window.agendaConfirmBooking = agendaConfirmBooking;
  window.agendaCancelBooking = agendaCancelBooking;
  window.agendaRescheduleBooking = agendaRescheduleBooking;
  window._submitReschedule = submitReschedule;
  window.openBookForClientModal = openBookForClientModal;
  window._bfcTab = switchBookForClientTab;
  window._submitBookForClient = submitBookForClient;
  window.openBookForClientFromDrawer = openBookForClientFromDrawer;
  window._submitBookFromDrawer = submitBookFromDrawer;
})();