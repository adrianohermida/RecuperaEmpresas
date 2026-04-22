'use strict';

(function () {
  const SLOT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const BOOKING_STATUS_MAP = {
    pending:            { className: 'agenda-booking-badge-pending',    label: 'Pendente' },
    confirmed:          { className: 'agenda-booking-badge-confirmed',  label: 'Confirmado' },
    cancelled:          { className: 'agenda-booking-badge-cancelled',  label: 'Cancelado' },
    rescheduled:        { className: 'agenda-booking-badge-rescheduled',label: 'Remarcado' },
    pending_reschedule: { className: 'agenda-booking-badge-reschedule', label: '↔ Remarcar pedido' },
    no_show:            { className: 'agenda-booking-badge-cancelled',  label: 'Não compareceu' },
  };

  const SLOT_STATUS_MAP = {
    past:      { className: 'agenda-slot-status-past',      label: 'Encerrado' },
    full:      { className: 'agenda-slot-status-full',      label: 'Lotado' },
    available: { className: 'agenda-slot-status-available', label: 'Disponível' },
  };

  // ─── helpers ────────────────────────────────────────────────────────────────

  function bookingStatusBadge(status) {
    const badge = BOOKING_STATUS_MAP[status] || { className: 'agenda-booking-badge-default', label: status };
    return `<span class="agenda-booking-badge ${badge.className}">${badge.label}</span>`;
  }

  function bookingClientName(booking) {
    if (booking.booker_name) return booking.booker_name;
    if (booking.re_users?.name || booking.re_users?.email) return booking.re_users.name || booking.re_users.email;
    return 'Cliente';
  }

  function fmtDt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ─── Sub-tab navigation ─────────────────────────────────────────────────────

  let _currentAgendaTab = 'availability';

  function switchAgendaTab(name) {
    const tabs   = ['availability', 'slots', 'bookings'];
    tabs.forEach(t => {
      const btn   = document.getElementById(`agendaTab-${t}`);
      const panel = document.getElementById(`agendaPanel-${t}`);
      if (btn)   btn.classList.toggle('agenda-tab-active', t === name);
      if (panel) panel.hidden = (t !== name);
    });
    _currentAgendaTab = name;
    if (name === 'bookings')     loadAllBookings();
    if (name === 'slots')        loadAdminAgenda();
    if (name === 'availability') loadAvailabilityPanel();
  }

  // ─── All bookings flat list ──────────────────────────────────────────────────

  async function loadAllBookings() {
    const el = document.getElementById('adminAllBookings');
    if (!el) return;
    el.innerHTML = '<div class="agenda-loading-state">Carregando...</div>';

    const status = document.getElementById('agendaBookingStatusFilter')?.value || '';
    const url    = '/api/admin/agenda/bookings' + (status ? `?status=${encodeURIComponent(status)}` : '');
    const res    = await fetch(url, { headers: authH() });
    const data   = await readAdminResponse(res);

    if (!res.ok) {
      el.innerHTML = `<div class="empty-state"><p>${data.error || 'Erro ao carregar.'}</p></div>`;
      return;
    }

    const bookings = data.bookings || [];
    if (!bookings.length) {
      el.innerHTML = '<div class="empty-state"><p>Nenhuma reserva encontrada.</p></div>';
      return;
    }

    el.innerHTML = `<div class="agenda-all-bookings-list">
      ${bookings.map(b => {
        const slot       = b.slot || b.re_agenda_slots || {};
        const clientName = (b.booker_name || b.re_users?.name || b.re_users?.email || 'Cliente').replace(/'/g, '&#39;');
        const clientNamePlain = clientName.replace(/<[^>]+>/g,'').trim();
        const isNoShow   = b.no_show;
        const statusKey  = isNoShow ? 'no_show' : b.status;
        const badge      = BOOKING_STATUS_MAP[statusKey] || { className: 'agenda-booking-badge-default', label: statusKey };
        const slotDate   = slot.starts_at ? fmtDt(slot.starts_at) : '—';
        const meetUrl    = slot.meet_link || null;

        let actions = '';
        if (b.status === 'pending') {
          actions = `
            <button onclick="agendaConfirmBooking('${b.id}')" class="agenda-booking-action agenda-booking-action-confirm">✅ Confirmar</button>
            <button onclick="agendaCancelBooking('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>`;
        } else if (b.status === 'confirmed') {
          const slotPast = slot.starts_at ? new Date(slot.starts_at) < new Date() : false;
          actions = `
            <button onclick="agendaRescheduleBooking('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-reschedule">↕️ Remarcar</button>
            <button onclick="agendaCancelBooking('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>
            ${slotPast && !isNoShow ? `<button onclick="agendaMarkNoShow('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-noshow">👻 Não compareceu</button>` : ''}`;
        } else if (b.status === 'pending_reschedule') {
          actions = `
            <button onclick="agendaApproveReschedule('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-confirm">✅ Aprovar</button>
            <button onclick="agendaRejectReschedule('${b.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Rejeitar</button>`;
        }

        return `
        <div class="agenda-all-booking-row${b.status === 'pending_reschedule' ? ' agenda-booking-row-highlight' : ''}">
          <div class="agenda-all-booking-main">
            <div class="agenda-all-booking-client">${clientName}</div>
            <div class="agenda-all-booking-slot">${slot.title || 'Consultoria'} · ${slotDate}</div>
            ${meetUrl ? `<a href="${meetUrl}" target="_blank" class="agenda-slot-link" style="font-size:11px">🔗 Meet</a>` : ''}
            ${b.notes ? `<div class="agenda-booking-note">${b.notes}</div>` : ''}
          </div>
          <div class="agenda-all-booking-actions">
            <span class="agenda-booking-badge ${badge.className}">${badge.label}</span>
            ${actions}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ─── Slot list ──────────────────────────────────────────────────────────────

  async function loadAdminAgenda() {
    const listEl = document.getElementById('adminSlotsList');
    if (listEl) listEl.innerHTML = '<div class="agenda-loading-state">Carregando...</div>';

    const response = await fetch('/api/admin/agenda/slots', { headers: authH() });
    const payload  = await readAdminResponse(response);
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
      ${slots.map(slot => _renderSlotCard(slot)).join('')}
    </div>`;
  }

  function _renderSlotCard(slot) {
    const startDate  = new Date(slot.starts_at);
    const endDate    = new Date(slot.ends_at);
    const isPast     = startDate < new Date();
    const bookings   = (slot.bookings || []).filter(b => b.status !== 'rescheduled');
    const activeCount = bookings.filter(b => b.status === 'pending' || b.status === 'confirmed' || b.status === 'pending_reschedule').length;
    const meetUrl    = slot.meet_link || slot.meeting_link || null;
    const locationLabel = slot.location === 'presencial' ? '📍 Presencial' : slot.location === 'hibrido' ? '🔗 Híbrido' : '🖥 Online';
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
            ${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}
            – ${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}
            &nbsp;·&nbsp; ${slot.duration_min}min
            &nbsp;·&nbsp; ${slot.credits_cost} crédito${slot.credits_cost > 1 ? 's' : ''}
            &nbsp;·&nbsp; ${activeCount}/${slot.max_bookings} vagas
            &nbsp;·&nbsp; ${locationLabel}
          </div>
          ${meetUrl ? `<div class="agenda-slot-link-wrap"><a href="${meetUrl}" target="_blank" class="agenda-slot-link">🔗 ${meetUrl}</a></div>` : ''}
          ${slot.description ? `<div class="agenda-slot-description">${slot.description}</div>` : ''}
        </div>
        <span class="agenda-slot-status ${slotStatus.className}">${slotStatus.label}</span>
        ${!isPast ? `<button onclick="openBookForClientModal('${slot.id}')" title="Agendar cliente" class="agenda-slot-action agenda-slot-action-book">+ Agendar</button>` : ''}
        <button onclick="deleteSlot('${slot.id}')" title="Remover horário" class="agenda-slot-action agenda-slot-action-delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      ${bookings.length ? `
      <div class="agenda-bookings-section">
        <div class="agenda-bookings-title">RESERVAS</div>
        <div class="agenda-bookings-list">
          ${bookings.map(b => _renderBookingRow(b, isPast)).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }

  function _renderBookingRow(booking, slotIsPast) {
    const clientName      = bookingClientName(booking).replace(/'/g, '&#39;');
    const clientNamePlain = clientName.replace(/<[^>]+>/g, '').trim();
    const isNoShow        = booking.no_show || booking.status === 'no_show';

    let actions = '';
    if (booking.status === 'pending') {
      actions = `
        <button onclick="agendaConfirmBooking('${booking.id}')" class="agenda-booking-action agenda-booking-action-confirm">✅ Confirmar</button>
        <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-reschedule">↕️ Remarcar</button>
        <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>`;
    } else if (booking.status === 'confirmed') {
      actions = `
        <button onclick="agendaRescheduleBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-reschedule">↕️ Remarcar</button>
        <button onclick="agendaCancelBooking('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Cancelar</button>
        ${slotIsPast && !isNoShow ? `<button onclick="agendaMarkNoShow('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-noshow">👻 Não compareceu</button>` : ''}`;
    } else if (booking.status === 'pending_reschedule') {
      const reqSlot = booking.reschedule_requested_slot_id ? `Horário pedido: slot ${booking.reschedule_requested_slot_id.slice(-6)}` : '';
      actions = `
        <span class="agenda-booking-reschedule-info" title="${reqSlot}">📅 Solicitou remarcação</span>
        <button onclick="agendaApproveReschedule('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-confirm">✅ Aprovar</button>
        <button onclick="agendaRejectReschedule('${booking.id}','${clientNamePlain}')" class="agenda-booking-action agenda-booking-action-cancel">❌ Rejeitar</button>`;
    }

    return `
    <div class="agenda-booking-row${booking.status === 'pending_reschedule' ? ' agenda-booking-row-highlight' : ''}">
      <div class="agenda-booking-main">
        <span class="agenda-booking-name">${clientName}</span>
        ${booking.booker_email ? `<span class="agenda-booking-meta"> · ${booking.booker_email}</span>` : ''}
        ${booking.notes ? `<div class="agenda-booking-note">${booking.notes}</div>` : ''}
        ${booking.cancel_reason && (booking.status === 'cancelled' || booking.status === 'rescheduled')
          ? `<div class="agenda-booking-reason">Motivo: ${booking.cancel_reason}</div>` : ''}
        ${booking.reschedule_reject_reason
          ? `<div class="agenda-booking-reason">Motivo rejeição: ${booking.reschedule_reject_reason}</div>` : ''}
      </div>
      ${bookingStatusBadge(isNoShow ? 'no_show' : booking.status)}
      ${actions}
    </div>`;
  }

  // ─── Availability panel ─────────────────────────────────────────────────────

  async function loadAvailabilityPanel() {
    const container = document.getElementById('agendaAvailabilityPanel');
    if (!container) return;

    container.innerHTML = '<div class="agenda-loading-state">Carregando disponibilidade do Google Calendar...</div>';

    let payload;
    try {
      const response = await fetch('/api/admin/agenda/camila-availability', { headers: authH() });
      payload = await response.json();

      // 503 = credentials not configured
      if (response.status === 503 || payload.unconfigured) {
        container.innerHTML = `
          <div class="agenda-avail-warn">
            <strong>⚠️ Google Calendar não configurado</strong><br>
            Configure as variáveis de ambiente para habilitar a integração:<br>
            <code style="font-size:11px;background:#F1F5F9;padding:2px 6px;border-radius:4px">
              GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_OAUTH_REFRESH_TOKEN
            </code>
            <br><small style="color:#64748B">Sem esta integração, os horários podem ser criados manualmente pela aba "Horários &amp; Reservas".</small>
          </div>`;
        return;
      }

      if (!response.ok) {
        container.innerHTML = `<div class="agenda-avail-warn">⚠️ Erro ao carregar agenda: ${payload.error || response.status}</div>`;
        return;
      }
    } catch (e) {
      container.innerHTML = '<div class="agenda-avail-warn">⚠️ Erro de rede ao carregar agenda Google.</div>';
      return;
    }

    // Backend returns { free_windows: { "YYYY-MM-DD": [{start,end},...] }, calendar_connected: true }
    const freeWindows = payload.free_windows || {};
    const days = Object.entries(freeWindows)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, windows]) => ({ date, windows }));

    if (!days.length) {
      container.innerHTML = `
        <div class="agenda-avail-empty">
          ✅ Google Calendar conectado — nenhuma janela livre nos próximos dias úteis.<br>
          <small style="color:#64748B">Todos os horários estão ocupados, ou a agenda está fora do horário de trabalho (08:00–18:00).</small>
        </div>`;
      return;
    }

    // Display windows in America/Sao_Paulo local time
    // The ISO strings from the server are UTC; convert to BRT (UTC-3) for display
    function fmtBRT(iso) {
      return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit',
      });
    }

    container.innerHTML = `
      <div class="agenda-avail-title">
        🗓 Janelas livres de Camila
        <span class="agenda-avail-connected">● Conectado</span>
      </div>
      <div class="agenda-avail-hint">Clique em uma janela para pré-preencher o formulário de novo horário.</div>
      <div class="agenda-avail-grid">
        ${days.map(day => `
          <div class="agenda-avail-day">
            <div class="agenda-avail-day-header">
              ${new Date(day.date + 'T12:00:00-03:00').toLocaleDateString('pt-BR', {
                weekday: 'short', day: '2-digit', month: 'short',
              })}
            </div>
            ${(day.windows || []).map(w => `
              <div class="agenda-avail-window"
                title="Criar horário: ${fmtBRT(w.start)} – ${fmtBRT(w.end)}"
                onclick="_prefillSlotFromWindow('${day.date}','${w.start}','${w.end}')">
                ${fmtBRT(w.start)} – ${fmtBRT(w.end)}
              </div>`).join('')}
          </div>`).join('')}
      </div>`;
  }

  // ─── Prefill slot form from a free window click ─────────────────────────────

  function prefillSlotFromWindow(dateStr, startIso, endIso) {
    // Switch to the slots tab first so the form is visible
    switchAgendaTab('slots');

    const formCard = document.getElementById('slotFormCard');
    if (!formCard) return;
    formCard.hidden = false;

    // Convert UTC ISO to local datetime-local value (browser renders in local tz)
    const toDatetimeLocal = iso => {
      const d = new Date(iso);
      // Format as YYYY-MM-DDTHH:MM in America/Sao_Paulo
      const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000); // subtract UTC-3
      return brt.toISOString().slice(0, 16);
    };

    document.getElementById('slotStart').value = toDatetimeLocal(startIso);
    document.getElementById('slotEnd').value   = toDatetimeLocal(endIso);

    const diffMin = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
    const durEl = document.getElementById('slotDuration');
    if (durEl) durEl.value = Math.min(diffMin, 120);

    setTimeout(() => {
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('slotTitle')?.focus();
    }, 100); // small delay to let the tab switch render first

    showToast('Horário pré-preenchido — revise e publique.', 'success');
  }

  // ─── Slot form ──────────────────────────────────────────────────────────────

  function toggleSlotForm() {
    const formCard = document.getElementById('slotFormCard');
    formCard.hidden = !formCard.hidden;
    if (!formCard.hidden) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(11, 0, 0, 0);
      const fmt = v => v.toISOString().slice(0, 16);
      document.getElementById('slotStart').value = fmt(tomorrow);
      document.getElementById('slotEnd').value   = fmt(tomorrowEnd);
      document.getElementById('slotTitle').focus();
      // Reset optional fields
      const loc = document.getElementById('slotLocation');
      if (loc) loc.value = 'online';
      const ml = document.getElementById('slotMeetingLink');
      if (ml) ml.value = '';
      const desc = document.getElementById('slotDescription');
      if (desc) desc.value = '';
    }
  }

  async function createSlot() {
    const startsAt     = document.getElementById('slotStart').value;
    const endsAt       = document.getElementById('slotEnd').value;
    const title        = document.getElementById('slotTitle').value.trim() || 'Consultoria';
    const creditsCost  = parseInt(document.getElementById('slotCredits').value, 10) || 1;
    const maxBookings  = parseInt(document.getElementById('slotMax').value, 10) || 1;
    const durationMin  = parseInt(document.getElementById('slotDuration').value, 10) || 60;
    const location     = document.getElementById('slotLocation')?.value || 'online';
    const meetingLink  = document.getElementById('slotMeetingLink')?.value.trim() || null;
    const description  = document.getElementById('slotDescription')?.value.trim() || null;

    if (!startsAt || !endsAt) { showToast('Preencha data/hora de início e fim.', 'error'); return; }
    if (new Date(endsAt) <= new Date(startsAt)) { showToast('Fim deve ser após o início.', 'error'); return; }

    const response = await fetch('/api/admin/agenda/slots', {
      method:  'POST',
      headers: authH(),
      body:    JSON.stringify({
        starts_at:    new Date(startsAt).toISOString(),
        ends_at:      new Date(endsAt).toISOString(),
        title,
        credits_cost: creditsCost,
        max_bookings: maxBookings,
        duration_min: durationMin,
        location,
        meet_link: meetingLink,
        description,
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
    if (response.ok) { showToast('Horário removido.', 'success'); loadAdminAgenda(); return; }
    showToast('Erro ao remover.', 'error');
  }

  // ─── Booking actions ────────────────────────────────────────────────────────

  function _refreshActivePanel() {
    if (_currentAgendaTab === 'bookings') loadAllBookings();
    else loadAdminAgenda();
  }

  async function agendaConfirmBooking(bookingId) {
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/confirm`, { method: 'PUT', headers: authH() });
    const payload  = await readAdminResponse(response);
    if (response.ok) { showToast('Reserva confirmada! E-mail enviado ao cliente.', 'success'); _refreshActivePanel(); return; }
    showToast(payload.error || 'Erro ao confirmar.', 'error');
  }

  async function agendaCancelBooking(bookingId, clientName) {
    const reason = prompt(`Motivo do cancelamento para ${clientName || 'este cliente'}:\n(obrigatório – será enviado por e-mail)`);
    if (reason === null) return;
    if (!reason.trim()) { showToast('O motivo é obrigatório.', 'error'); return; }
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/cancel`, {
      method: 'PUT', headers: authH(),
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) { showToast('Reserva cancelada e cliente notificado.', 'success'); _refreshActivePanel(); return; }
    showToast(payload.error || 'Erro ao cancelar.', 'error');
  }

  async function agendaMarkNoShow(bookingId, clientName) {
    if (!confirm(`Marcar ${clientName || 'este cliente'} como não compareceu?`)) return;
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/no-show`, { method: 'PUT', headers: authH() });
    const payload  = await readAdminResponse(response);
    if (response.ok) { showToast('Marcado como não compareceu.', 'success'); _refreshActivePanel(); return; }
    showToast(payload.error || 'Erro.', 'error');
  }

  async function agendaApproveReschedule(bookingId, clientName) {
    if (!confirm(`Aprovar pedido de remarcação de ${clientName || 'este cliente'}?`)) return;
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/approve-reschedule`, { method: 'PUT', headers: authH() });
    const payload  = await readAdminResponse(response);
    if (response.ok) { showToast('Remarcação aprovada e cliente notificado.', 'success'); _refreshActivePanel(); return; }
    showToast(payload.error || 'Erro ao aprovar.', 'error');
  }

  async function agendaRejectReschedule(bookingId, clientName) {
    const reason = prompt(`Motivo da rejeição do pedido de remarcação de ${clientName || 'este cliente'}:\n(obrigatório)`);
    if (reason === null) return;
    if (!reason.trim()) { showToast('O motivo é obrigatório.', 'error'); return; }
    const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/reject-reschedule`, {
      method: 'PUT', headers: authH(),
      body: JSON.stringify({ reason: reason.trim() }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) { showToast('Pedido rejeitado e cliente notificado.', 'success'); _refreshActivePanel(); return; }
    showToast(payload.error || 'Erro ao rejeitar.', 'error');
  }

  async function agendaRescheduleBooking(bookingId, clientName) {
    const response = await fetch('/api/admin/agenda/slots?include_bookings=0', { headers: authH() });
    const payload  = await readAdminResponse(response);
    if (!response.ok) { showToast(payload.error || 'Erro ao carregar horários.', 'error'); return; }

    const futureSlots = (payload.slots || []).filter(s => new Date(s.starts_at) > new Date());
    if (!futureSlots.length) { showToast('Nenhum horário futuro disponível para remarcar.', 'error'); return; }

    const modal = document.createElement('div');
    modal.id = 'rescheduleModal';
    modal.className = 'admin-modal-overlay admin-modal-overlay-high';
    modal.innerHTML = `
      <div class="admin-modal agenda-modal-card agenda-modal-card-md">
        <div class="agenda-modal-title">↕️ Remarcar agendamento</div>
        <div class="agenda-modal-subtitle">Cliente: ${clientName}</div>
        <label class="agenda-modal-label">Novo horário</label>
        <select id="rescheduleSlotSelect" class="portal-select agenda-modal-field agenda-modal-field-lg">
          ${futureSlots.map(s => {
            const sd = new Date(s.starts_at), ed = new Date(s.ends_at);
            const pad = n => String(n).padStart(2,'0');
            return `<option value="${s.id}">${sd.toLocaleDateString('pt-BR')} ${pad(sd.getHours())}:${pad(sd.getMinutes())}–${pad(ed.getHours())}:${pad(ed.getMinutes())} · ${s.title}</option>`;
          }).join('')}
        </select>
        <label class="agenda-modal-label">Motivo / observação (obrigatório)</label>
        <textarea id="rescheduleReason" rows="3" class="portal-input agenda-modal-field agenda-modal-textarea" placeholder="Ex.: Solicitação da empresa, conflito de agenda..."></textarea>
        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('rescheduleModal','admin-agenda:reschedule-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="_submitReschedule('${bookingId}')" class="btn-primary admin-modal-btn">Remarcar</button>
        </div>
      </div>`;
    window.REAdminModal?.append?.(modal, 'admin-agenda:reschedule');
  }

  async function submitReschedule(bookingId) {
    const newSlotId = document.getElementById('rescheduleSlotSelect').value;
    const reason    = document.getElementById('rescheduleReason').value.trim();
    if (!reason) { showToast('O motivo é obrigatório.', 'error'); return; }

    const btn = document.querySelector('#rescheduleModal .btn-primary');
    const originalLabel = btn ? btn.textContent : 'Remarcar';
    if (btn) { btn.disabled = true; btn.textContent = 'Remarcando...'; }

    try {
      const response = await fetch(`/api/admin/agenda/bookings/${bookingId}/reschedule`, {
        method: 'PUT', headers: authH(),
        body: JSON.stringify({ new_slot_id: newSlotId, reason }),
      });
      const payload = await readAdminResponse(response);
      if (response.ok) {
        window.REAdminModal?.closeById?.('rescheduleModal', 'admin-agenda:reschedule-submit');
        showToast('Agendamento remarcado e cliente notificado.', 'success');
        _refreshActivePanel();
        return;
      }
      showToast(payload.error || 'Erro ao remarcar.', 'error');
    } catch (error) {
      showToast('Erro de conexão ao remarcar.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
  }

  // ─── Book-for-client modal (from slot card) ─────────────────────────────────

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
          <button id="bfcTabExisting" onclick="_bfcTab('existing')" class="agenda-book-tab agenda-book-tab-active">Cliente existente</button>
          <button id="bfcTabExternal" onclick="_bfcTab('external')" class="agenda-book-tab">Novo contato externo</button>
        </div>

        <div id="bfcPanelExisting">
          <label class="agenda-modal-label">Selecionar cliente</label>
          <select id="bfcClientSelect" class="portal-select agenda-modal-field">
            <option value="">— selecione —</option>
            ${clients.map(c => `<option value="${c.id}">${c.company || c.name} (${c.email})</option>`).join('')}
          </select>
        </div>

        <div id="bfcPanelExternal" class="agenda-book-panel-hidden">
          <div class="agenda-book-grid">
            <div><label class="agenda-book-grid-label">Nome *</label>
              <input id="bfcExtName" placeholder="Nome completo" class="portal-input agenda-book-grid-input"></div>
            <div><label class="agenda-book-grid-label">E-mail *</label>
              <input id="bfcExtEmail" type="email" placeholder="email@empresa.com" class="portal-input agenda-book-grid-input"></div>
            <div><label class="agenda-book-grid-label">Telefone</label>
              <input id="bfcExtPhone" placeholder="(11) 99999-9999" class="portal-input agenda-book-grid-input"></div>
            <div><label class="agenda-book-grid-label">Empresa</label>
              <input id="bfcExtCompany" placeholder="Empresa S.A." class="portal-input agenda-book-grid-input"></div>
          </div>
        </div>

        <label class="agenda-book-notes-label">Observações (opcional)</label>
        <textarea id="bfcNotes" rows="2" placeholder="Pauta, objetivo da reunião..." class="portal-input agenda-modal-field agenda-modal-textarea"></textarea>

        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('bookForClientModal','admin-agenda:book-for-client-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
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
    const body  = { slot_id: slotId, notes };

    if (window._bfcMode === 'existing') {
      const userId = document.getElementById('bfcClientSelect').value;
      if (!userId) { showToast('Selecione um cliente.', 'error'); return; }
      body.user_id = userId;
    } else {
      const name    = document.getElementById('bfcExtName').value.trim();
      const email   = document.getElementById('bfcExtEmail').value.trim();
      const phone   = document.getElementById('bfcExtPhone').value.trim();
      const company = document.getElementById('bfcExtCompany').value.trim();
      if (!name || !email) { showToast('Nome e e-mail são obrigatórios.', 'error'); return; }
      body.external_contact = { name, email, phone: phone || null, company: company || null };
    }

    const btn = document.querySelector('#bookForClientModal .btn-primary');
    const originalLabel = btn ? btn.textContent : 'Confirmar agendamento';
    if (btn) { btn.disabled = true; btn.textContent = 'Agendando...'; }

    try {
      const response = await fetch('/api/admin/agenda/book-for-client', {
        method: 'POST', headers: authH(), body: JSON.stringify(body),
      });
      const payload = await readAdminResponse(response);
      if (response.ok) {
        window.REAdminModal?.closeById?.('bookForClientModal', 'admin-agenda:book-for-client-submit');
        showToast('Agendamento criado e confirmado!', 'success');
        _refreshActivePanel();
        return;
      }
      showToast(payload.error || 'Erro ao agendar.', 'error');
    } catch (error) {
      showToast('Erro de conexão ao agendar.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
  }

  // ─── Book-from-drawer (client detail panel) ─────────────────────────────────

  async function openBookForClientFromDrawer(clientId) {
    const response = await fetch('/api/admin/agenda/slots?include_bookings=0', { headers: authH() });
    const payload  = await readAdminResponse(response);
    if (!response.ok) { showToast(payload.error || 'Erro ao carregar horários.', 'error'); return; }

    const futureSlots = (payload.slots || []).filter(s => new Date(s.starts_at) > new Date());
    if (!futureSlots.length) { showToast('Nenhum horário futuro disponível.', 'error'); return; }

    const modal = document.createElement('div');
    modal.id = 'bookDrawerModal';
    modal.className = 'admin-modal-overlay admin-modal-overlay-high';
    modal.innerHTML = `
      <div class="admin-modal agenda-modal-card agenda-modal-card-sm">
        <div class="agenda-modal-title agenda-modal-title-spaced">📅 Novo agendamento</div>
        <label class="agenda-modal-label">Horário disponível</label>
        <select id="bookDrawerSlot" class="portal-select agenda-modal-field">
          ${futureSlots.map(s => {
            const sd = new Date(s.starts_at), ed = new Date(s.ends_at);
            const pad = n => String(n).padStart(2,'0');
            return `<option value="${s.id}">${sd.toLocaleDateString('pt-BR')} ${pad(sd.getHours())}:${pad(sd.getMinutes())}–${pad(ed.getHours())}:${pad(ed.getMinutes())} · ${s.title}</option>`;
          }).join('')}
        </select>
        <label class="agenda-book-notes-label">Observações (opcional)</label>
        <textarea id="bookDrawerNotes" rows="2" placeholder="Pauta, objetivo..." class="portal-input agenda-modal-field agenda-modal-textarea"></textarea>
        <div class="admin-modal-actions agenda-modal-actions-tight">
          <button onclick="window.REAdminModal?.closeById?.('bookDrawerModal','admin-agenda:book-drawer-cancel')" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="_submitBookFromDrawer('${clientId}')" class="btn-primary admin-modal-btn">Agendar</button>
        </div>
      </div>`;
    window.REAdminModal?.append?.(modal, 'admin-agenda:book-drawer');
  }

  async function submitBookFromDrawer(clientId) {
    const slotId = document.getElementById('bookDrawerSlot').value;
    const notes  = document.getElementById('bookDrawerNotes').value.trim() || null;
    const response = await fetch('/api/admin/agenda/book-for-client', {
      method: 'POST', headers: authH(),
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

  // ─── Exports ────────────────────────────────────────────────────────────────

  window.loadAdminAgenda           = loadAdminAgenda;
  window.loadAvailabilityPanel     = loadAvailabilityPanel;
  window.switchAgendaTab           = switchAgendaTab;
  window.loadAllBookings           = loadAllBookings;
  window.toggleSlotForm            = toggleSlotForm;
  window.createSlot                = createSlot;
  window.deleteSlot                = deleteSlot;
  window.agendaConfirmBooking      = agendaConfirmBooking;
  window.agendaCancelBooking       = agendaCancelBooking;
  window.agendaMarkNoShow          = agendaMarkNoShow;
  window.agendaApproveReschedule   = agendaApproveReschedule;
  window.agendaRejectReschedule    = agendaRejectReschedule;
  window.agendaRescheduleBooking   = agendaRescheduleBooking;
  window._submitReschedule         = submitReschedule;
  window.openBookForClientModal    = openBookForClientModal;
  window._bfcTab                   = switchBookForClientTab;
  window._submitBookForClient      = submitBookForClient;
  window.openBookForClientFromDrawer = openBookForClientFromDrawer;
  window._submitBookFromDrawer     = submitBookFromDrawer;
  window._prefillSlotFromWindow    = prefillSlotFromWindow;

  // ─── Recover from deep-link race condition ───────────────────────────────────
  // admin-shell-core.js may have fired showSection('agenda') before this script
  // loaded. It stores the pending tab name in window._pendingAgendaTab.
  if (window._pendingAgendaTab) {
    switchAgendaTab(window._pendingAgendaTab);
    delete window._pendingAgendaTab;
  }

  console.info('[RE:admin-agenda] loaded');
})();
