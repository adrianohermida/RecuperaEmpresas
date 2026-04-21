'use strict';

(function () {
  const SLOT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const BOOKING_STATUS_MAP = {
    pending: { className: 'agenda-booking-badge-pending', label: 'Pendente' },
    confirmed: { className: 'agenda-booking-badge-confirmed', label: 'Confirmado' },
    cancelled: { className: 'agenda-booking-badge-cancelled', label: 'Cancelado' },
    rescheduled: { className: 'agenda-booking-badge-rescheduled', label: 'Remarcado' },
  };
  const SLOT_STATUS_MAP = {
    past: { className: 'agenda-slot-status-past', label: 'Encerrado' },
    full: { className: 'agenda-slot-status-full', label: 'Lotado' },
    available: { className: 'agenda-slot-status-available', label: 'Disponível' },
  };

  function bookingStatusBadge(status) {
    const badge = BOOKING_STATUS_MAP[status] || { className: 'agenda-booking-badge-default', label: status };
    return `<span class="agenda-booking-badge ${badge.className}">${badge.label}</span>`;
  }

  function bookingClientName(booking) {
    if (booking.re_users?.name || booking.re_users?.email) return booking.re_users.name || booking.re_users.email;
    if (booking.external_contact) {
      const externalContact = typeof booking.external_contact === 'string'
        ? JSON.parse(booking.external_contact)
        : booking.external_contact;
      return (externalContact.name || externalContact.email || 'Contato externo') + ' <span class="agenda-booking-external">(externo)</span>';
    }
    return 'Cliente';
  }

  async function loadAdminAgenda() {
    const listEl = document.getElementById('adminSlotsList');
    if (listEl) listEl.innerHTML = '<div class="agenda-loading-state">Carregando...</div>';

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

    listEl.innerHTML = `<div class="agenda-slot-list">
      ${slots.map(slot => {
        const startDate = new Date(slot.starts_at);
        const endDate = new Date(slot.ends_at);
        const isPast = startDate < new Date();
        const bookings = (slot.bookings || []).filter(booking => booking.status !== 'rescheduled');
        const activeCount = bookings.filter(booking => booking.status === 'pending' || booking.status === 'confirmed').length;
        const locationIcon = slot.location === 'presencial' ? '📍' : '🔗';
        const locationLabel = slot.location === 'presencial' ? 'Presencial' : 'Online';
        const slotStatus = isPast
          ? SLOT_STATUS_MAP.past
          : activeCount >= slot.max_bookings
            ? SLOT_STATUS_MAP.full
            : SLOT_STATUS_MAP.available;

        return `
        <div class="agenda-slot-card${isPast ? ' agenda-slot-card-past' : ''}">
          <div class="agenda-slot-header">
            <div class="agenda-slot-date-card">
              <div class="agenda-slot-day">${startDate.getDate()}</div>
              <div class="agenda-slot-month">${SLOT_MONTHS[startDate.getMonth()]} ${startDate.getFullYear()}</div>
            </div>
            <div class="agenda-slot-main">
              <div class="agenda-slot-title">${slot.title}</div>
              <div class="agenda-slot-meta">
                ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}
                – ${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}
                &nbsp;·&nbsp; ${slot.duration_min}min &nbsp;·&nbsp; ${slot.credits_cost} crédito${slot.credits_cost > 1 ? 's' : ''}
                &nbsp;·&nbsp; ${activeCount}/${slot.max_bookings} vagas
                &nbsp;·&nbsp; ${locationIcon} ${locationLabel}
              </div>
              ${slot.meeting_link ? `<div class="agenda-slot-link-wrap"><a href="${slot.meeting_link}" target="_blank" class="agenda-slot-link">🔗 ${slot.meeting_link}</a></div>` : ''}
            </div>
            <span class="agenda-slot-status ${slotStatus.className}">${slotStatus.label}</span>
            ${!isPast ? `<button onclick="openBookForClientModal('${slot.id}')" title="Agendar cliente" class="agenda-slot-action agenda-slot-action-book">
              + Agendar
            </button>` : ''}
            <button onclick="deleteSlot('${slot.id}')" title="Remover horário" class="agenda-slot-action agenda-slot-action-delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
          ${bookings.length ? `
          <div class="agenda-bookings-section">
            <div class="agenda-bookings-title">RESERVAS</div>
            <div class="agenda-bookings-list">
              ${bookings.map(booking => {
                const clientName = bookingClientName(booking).replace(/'/g, '&#39;');
                const clientNamePlain = clientName.replace(/<[^>]+>/g, '').trim();
                return `
              <div class="agenda-booking-row">
                <div class="agenda-booking-main">
                  <span class="agenda-booking-name">${clientName}</span>
                  ${booking.notes ? `<div class="agenda-booking-note">${booking.notes}</div>` : ''}
                  ${booking.cancel_reason && (booking.status === 'cancelled' || booking.status === 'rescheduled') ? `<div class="agenda-booking-reason">Motivo: ${booking.cancel_reason}</div>` : ''}
                </div>
                ${bookingStatusBadge(booking.status)}
                ${booking.status === 'pending' ? `
                  <button onclick="agendaConfirmBooking('${booking.id}')" class="agenda-booking-action agenda-booking-action-confirm">✅ Confirmar</button>
                  <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-reschedule">↕️ Remarcar</button>
                  <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>
                ` : booking.status === 'confirmed' ? `
                  <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-reschedule">↕️ Remarcar</button>
                  <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>
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
    formCard.hidden = !formCard.hidden;
    if (!formCard.hidden) {
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
    modal.className = 'admin-modal-overlay admin-modal-overlay-high';
    modal.innerHTML = `
      <div class="admin-modal agenda-modal-card agenda-modal-card-md">
        <div class="agenda-modal-title">↕️ Remarcar agendamento</div>
        <div class="agenda-modal-subtitle">Cliente: ${clientName}</div>
        <label class="agenda-modal-label">Novo horário</label>
        <select id="rescheduleSlotSelect" class="portal-select agenda-modal-field agenda-modal-field-lg">
          ${futureSlots.map(slot => {
            const startDate = new Date(slot.starts_at);
            const endDate = new Date(slot.ends_at);
            return `<option value="${slot.id}">${startDate.toLocaleDateString('pt-BR')} ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}–${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')} · ${slot.title}</option>`;
          }).join('')}
        </select>
        <label class="agenda-modal-label">Motivo / observação (obrigatório)</label>
        <textarea id="rescheduleReason" rows="3" class="portal-input agenda-modal-field agenda-modal-textarea" placeholder="Ex.: Solicitação da empresa, conflito de agenda..."></textarea>
        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('rescheduleModal', 'admin-agenda:reschedule-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="_submitReschedule('${bookingId}')" class="btn-primary admin-modal-btn">Remarcar</button>
        </div>
      </div>`;
    window.REAdminModal?.append?.(modal, 'admin-agenda:reschedule');
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
      window.REAdminModal?.closeById?.('rescheduleModal', 'admin-agenda:reschedule-submit');
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
    modal.className = 'admin-modal-overlay admin-modal-overlay-high';
    modal.innerHTML = `
      <div class="admin-modal agenda-modal-card agenda-modal-card-lg">
        <div class="agenda-modal-title agenda-modal-title-spaced">📅 Agendar cliente neste horário</div>

        <div class="agenda-book-tab-strip">
          <button id="bfcTabExisting" onclick="_bfcTab('existing')" class="agenda-book-tab agenda-book-tab-active">
            Cliente existente
          </button>
          <button id="bfcTabExternal" onclick="_bfcTab('external')" class="agenda-book-tab">
            Novo contato externo
          </button>
        </div>

        <div id="bfcPanelExisting">
          <label class="agenda-modal-label">Selecionar cliente</label>
          <select id="bfcClientSelect" class="portal-select agenda-modal-field">
            <option value="">— selecione —</option>
            ${clients.map(client => `<option value="${client.id}">${client.company || client.name} (${client.email})</option>`).join('')}
          </select>
        </div>

        <div id="bfcPanelExternal" class="agenda-book-panel-hidden">
          <div class="agenda-book-grid">
            <div>
              <label class="agenda-book-grid-label">Nome *</label>
              <input id="bfcExtName" placeholder="Nome completo" class="portal-input agenda-book-grid-input">
            </div>
            <div>
              <label class="agenda-book-grid-label">E-mail *</label>
              <input id="bfcExtEmail" type="email" placeholder="email@empresa.com" class="portal-input agenda-book-grid-input">
            </div>
            <div>
              <label class="agenda-book-grid-label">Telefone</label>
              <input id="bfcExtPhone" placeholder="(11) 99999-9999" class="portal-input agenda-book-grid-input">
            </div>
            <div>
              <label class="agenda-book-grid-label">Empresa</label>
              <input id="bfcExtCompany" placeholder="Empresa S.A." class="portal-input agenda-book-grid-input">
            </div>
          </div>
        </div>

        <label class="agenda-book-notes-label">Observações (opcional)</label>
        <textarea id="bfcNotes" rows="2" placeholder="Pauta, objetivo da reunião..." class="portal-input agenda-modal-field agenda-modal-textarea"></textarea>

        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('bookForClientModal', 'admin-agenda:book-for-client-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="_submitBookForClient('${slotId}')" class="btn-primary admin-modal-btn">Confirmar agendamento</button>
        </div>
      </div>`;
    window.REAdminModal?.append?.(modal, 'admin-agenda:book-for-client');
    window._bfcMode = 'existing';
  }

  function switchBookForClientTab(mode) {
    window._bfcMode = mode;
    document.getElementById('bfcPanelExisting').classList.toggle('agenda-book-panel-hidden', mode !== 'existing');
    document.getElementById('bfcPanelExternal').classList.toggle('agenda-book-panel-hidden', mode !== 'external');
    document.getElementById('bfcTabExisting').classList.toggle('agenda-book-tab-active', mode === 'existing');
    document.getElementById('bfcTabExternal').classList.toggle('agenda-book-tab-active', mode === 'external');
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
      window.REAdminModal?.closeById?.('bookForClientModal', 'admin-agenda:book-for-client-submit');
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
    modal.className = 'admin-modal-overlay admin-modal-overlay-high';
    modal.innerHTML = `
      <div class="admin-modal agenda-modal-card agenda-modal-card-sm">
        <div class="agenda-modal-title agenda-modal-title-spaced">📅 Novo agendamento</div>
        <label class="agenda-modal-label">Horário disponível</label>
        <select id="bookDrawerSlot" class="portal-select agenda-modal-field">
          ${futureSlots.map(slot => {
            const startDate = new Date(slot.starts_at);
            const endDate = new Date(slot.ends_at);
            return `<option value="${slot.id}">${startDate.toLocaleDateString('pt-BR')} ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}–${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')} · ${slot.title}</option>`;
          }).join('')}
        </select>
        <label class="agenda-book-notes-label">Observações (opcional)</label>
        <textarea id="bookDrawerNotes" rows="2" placeholder="Pauta, objetivo..." class="portal-input agenda-modal-field agenda-modal-textarea"></textarea>
        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('bookDrawerModal', 'admin-agenda:book-drawer-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="_submitBookFromDrawer('${clientId}')" class="btn-primary admin-modal-btn">Agendar</button>
        </div>
      </div>`;
    window.REAdminModal?.append?.(modal, 'admin-agenda:book-drawer');
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
      window.REAdminModal?.closeById?.('bookDrawerModal', 'admin-agenda:book-drawer-submit');
      showToast('Agendamento criado!', 'success');
      (window.renderClientDetailTab || renderDrawerTab)('agenda');
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

console.info('[RE:admin-agenda] loaded');
})();
