'use strict';

(function () {
  async function loadAdminMarketplace() {
    const servicesWrap = document.getElementById('adminServicesTableWrap');
    const ordersWrap = document.getElementById('adminOrdersTableWrap');
    if (!servicesWrap) return;
    servicesWrap.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Carregando serviços...</div>';
    if (ordersWrap) ordersWrap.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Carregando pedidos...</div>';

    try {
      const [servicesResponse, ordersResponse, journeysResponse] = await Promise.all([
        fetch('/api/admin/services', { headers: authH() }),
        fetch('/api/admin/service-orders', { headers: authH() }),
        fetch('/api/admin/journeys', { headers: authH() }),
      ]);

      window._mktJourneys = journeysResponse.ok ? await journeysResponse.json() : [];

      if (servicesResponse.ok) {
        const { services = [] } = await servicesResponse.json();
        const journeyMap = {};
        (window._mktJourneys || []).forEach(journey => {
          journeyMap[journey.id] = journey.name;
        });

        if (!services.length) {
          servicesWrap.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Nenhum serviço cadastrado.</div>';
        } else {
          servicesWrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Nome</th>
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Categoria</th>
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Jornada vinculada</th>
              <th style="text-align:right;padding:8px 12px;color:var(--text-muted);font-weight:600;">Valor</th>
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Status</th>
              <th style="padding:8px 12px;"></th>
            </tr></thead>
            <tbody>${services.map(service => {
              const serviceName = service.name || service.title || '—';
              const price = ((service.price_cents || Math.round((service.price || 0) * 100)) / 100)
                .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const journeyName = service.journey_id ? (journeyMap[service.journey_id] || service.journey_id) : '—';
              return `<tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:10px 12px;font-weight:600;">${escHtml(serviceName)}</td>
                <td style="padding:10px 12px;color:var(--text-muted);">${escHtml(service.category || '—')}</td>
                <td style="padding:10px 12px;font-size:12px;color:#6366F1;">${service.journey_id ? '🗺️ ' + escHtml(journeyName) : '<span style="color:var(--text-muted);">Nenhuma</span>'}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;">${price}</td>
                <td style="padding:10px 12px;"><span class="badge ${service.active ? 'badge-green' : 'badge-gray'}">${service.active ? 'Ativo' : 'Inativo'}</span></td>
                <td style="padding:10px 12px;display:flex;gap:6px;">
                  <button onclick="openEditServiceModal('${service.id}','${escHtml(serviceName)}','${escHtml(service.category || '')}','${escHtml(service.description || '')}',${service.price_cents || Math.round((service.price || 0) * 100)},'${service.journey_id || ''}')"
                    style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:none;cursor:pointer;">Editar</button>
                  <button onclick="toggleService('${service.id}',${!service.active})"
                    style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:none;cursor:pointer;">
                    ${service.active ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;
        }
      }

      if (ordersResponse.ok && ordersWrap) {
        const { orders = [] } = await ordersResponse.json();
        const statusMap = {
          pending_payment: 'Aguardando pagamento',
          active: 'Ativo',
          in_progress: 'Em andamento',
          delivered: 'Entregue',
          cancelled: 'Cancelado',
        };
        if (!orders.length) {
          ordersWrap.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Nenhum pedido ainda.</div>';
        } else {
          ordersWrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Cliente</th>
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Serviço</th>
              <th style="text-align:right;padding:8px 12px;color:var(--text-muted);font-weight:600;">Valor</th>
              <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Status</th>
              <th style="padding:8px 12px;"></th>
            </tr></thead>
            <tbody>${orders.map(order => {
              const amount = ((order.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const client = order.re_users || {};
              const serviceName = order.re_services?.name || order.re_services?.title || '—';
              return `<tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:10px 12px;">
                  <div style="font-weight:600;">${escHtml(client.name || '—')}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${escHtml(client.email || '')}</div>
                </td>
                <td style="padding:10px 12px;">${escHtml(serviceName)}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;">${amount}</td>
                <td style="padding:10px 12px;"><span class="badge badge-gray">${statusMap[order.status] || order.status}</span></td>
                <td style="padding:10px 12px;">
                  <select onchange="updateOrderStatus('${order.id}',this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;">
                    ${Object.entries(statusMap).map(([value, label]) => `<option value="${value}"${order.status === value ? ' selected' : ''}>${label}</option>`).join('')}
                  </select>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;
        }
      }
    } catch (error) {
      servicesWrap.innerHTML = '<div style="padding:16px;color:var(--danger);">Erro ao carregar.</div>';
      console.error('[ADMIN MARKETPLACE]', error.message);
    }
  }

  function buildServiceModalHtml(id, name, category, description, priceCents, journeyId) {
    const isEdit = !!id;
    const journeys = window._mktJourneys || [];
    const journeySelect = `<select id="svcJourney" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;">
      <option value="">— Nenhuma jornada —</option>
      ${journeys.map(journey => `<option value="${journey.id}"${journeyId === journey.id ? ' selected' : ''}>${escHtml(journey.name)}</option>`).join('')}
    </select>`;
    return `<div id="svcModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div style="background:#fff;border-radius:12px;padding:28px;width:460px;max-width:96vw;max-height:90vh;overflow-y:auto;">
        <div style="font-size:17px;font-weight:700;color:var(--dark);margin-bottom:18px;">${isEdit ? 'Editar Serviço' : 'Novo Serviço'}</div>
        ${isEdit ? `<input type="hidden" id="svcEditId" value="${id}">` : ''}
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Nome *</label>
        <input id="svcName" type="text" value="${escHtml(name || '')}" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Categoria</label>
        <select id="svcCat" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;">
          ${['juridico','financeiro','consultoria','outro'].map(value => `<option value="${value}"${category === value ? ' selected' : ''}>${value.charAt(0).toUpperCase() + value.slice(1)}</option>`).join('')}
        </select>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Descrição</label>
        <textarea id="svcDesc" rows="2" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;resize:vertical;">${escHtml(description || '')}</textarea>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Valor (R$) *</label>
        <input id="svcPrice" type="number" step="0.01" min="0" value="${priceCents ? (priceCents / 100).toFixed(2) : ''}" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Jornada vinculada
          <span style="font-weight:400;color:var(--text-muted);"> — ativada automaticamente ao confirmar o pedido</span>
        </label>
        ${journeySelect}
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="document.getElementById('svcModal').remove()" style="background:none;border:1px solid var(--border);border-radius:7px;padding:9px 18px;font-size:13px;cursor:pointer;">Cancelar</button>
          <button onclick="submitServiceForm()" style="background:var(--primary);color:#fff;border:none;border-radius:7px;padding:9px 18px;font-size:13px;cursor:pointer;font-weight:600;">${isEdit ? 'Salvar' : 'Criar Serviço'}</button>
        </div>
      </div>
    </div>`;
  }

  async function openCreateServiceModal() {
    if (!window._mktJourneys) {
      const response = await fetch('/api/admin/journeys', { headers: authH() });
      window._mktJourneys = response.ok ? await response.json() : [];
    }
    document.getElementById('svcModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', buildServiceModalHtml(null, '', 'consultoria', '', 0, ''));
  }

  function openEditServiceModal(id, name, category, description, priceCents, journeyId) {
    document.getElementById('svcModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', buildServiceModalHtml(id, name, category, description, priceCents, journeyId));
  }

  async function submitServiceForm() {
    const editId = document.getElementById('svcEditId')?.value;
    const name = document.getElementById('svcName')?.value?.trim();
    const category = document.getElementById('svcCat')?.value;
    const description = document.getElementById('svcDesc')?.value?.trim();
    const price = parseFloat(document.getElementById('svcPrice')?.value || 0);
    const journeyId = document.getElementById('svcJourney')?.value || null;

    if (!name || !price) {
      showToast('Nome e valor são obrigatórios.', 'error');
      return;
    }

    const payload = {
      name,
      category,
      description,
      price_cents: Math.round(price * 100),
      journey_id: journeyId || null,
    };

    const url = editId ? `/api/admin/services/${editId}` : '/api/admin/services';
    const method = editId ? 'PUT' : 'POST';
    const response = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
    const payloadResponse = await readAdminResponse(response);
    if (response.ok) {
      document.getElementById('svcModal')?.remove();
      showToast(editId ? 'Serviço atualizado!' : 'Serviço criado!', 'success');
      loadAdminMarketplace();
      return;
    }
    if (payloadResponse.diagnostic) console.error('[ADMIN SERVICES DIAGNOSTIC]', payloadResponse.diagnostic);
    showToast(payloadResponse.error || 'Erro ao salvar.', 'error');
  }

  function submitCreateService() {
    submitServiceForm();
  }

  async function toggleService(id, active) {
    const response = await fetch(`/api/admin/services/${id}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ active }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast(active ? 'Serviço ativado.' : 'Serviço desativado.', 'success');
      loadAdminMarketplace();
      return;
    }
    showToast(payload.error || 'Erro.', 'error');
  }

  async function updateOrderStatus(id, status) {
    const response = await fetch(`/api/admin/service-orders/${id}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status }),
    });
    const payload = await readAdminResponse(response);
    if (!response.ok) {
      showToast(payload.error || 'Erro ao atualizar.', 'error');
      return;
    }
    showToast('Status atualizado.', 'success');
    if (status === 'active') showToast('Jornada ativada automaticamente para o cliente!', 'success');
    loadAdminMarketplace();
  }

  window.loadAdminMarketplace = loadAdminMarketplace;
  window._buildServiceModalHtml = buildServiceModalHtml;
  window.openCreateServiceModal = openCreateServiceModal;
  window.openEditServiceModal = openEditServiceModal;
  window.submitServiceForm = submitServiceForm;
  window.submitCreateService = submitCreateService;
  window.toggleService = toggleService;
  window.updateOrderStatus = updateOrderStatus;
})();