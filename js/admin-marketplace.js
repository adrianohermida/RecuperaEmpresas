'use strict';

(function () {
  function mktState(message, tone) {
    const toneClass = tone === 'error' ? ' mkt-state-error' : '';
    return `<div class="mkt-state${toneClass}">${message}</div>`;
  }

  async function loadAdminMarketplace() {
    const servicesWrap = document.getElementById('adminServicesTableWrap');
    const ordersWrap = document.getElementById('adminOrdersTableWrap');
    if (!servicesWrap) return;
    servicesWrap.innerHTML = mktState('Carregando serviços...');
    if (ordersWrap) ordersWrap.innerHTML = mktState('Carregando pedidos...');

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
          servicesWrap.innerHTML = mktState('Nenhum serviço cadastrado.');
        } else {
          servicesWrap.innerHTML = `<table class="admin-simple-table mkt-table">
            <thead><tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Jornada vinculada</th>
              <th class="mkt-table-head-right">Valor</th>
              <th>Status</th>
              <th class="mkt-table-head-actions"></th>
            </tr></thead>
            <tbody>${services.map(service => {
              const serviceName = service.name || service.title || '—';
              const serviceIdJs = mktEscInline(service.id);
              const serviceNameJs = mktEscInline(serviceName);
              const categoryJs = mktEscInline(service.category || '');
              const descriptionJs = mktEscInline(service.description || '');
              const journeyIdJs = mktEscInline(service.journey_id || '');
              const price = ((service.price_cents || Math.round((service.price || 0) * 100)) / 100)
                .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const journeyName = service.journey_id ? (journeyMap[service.journey_id] || service.journey_id) : '—';
              return `<tr>
                <td class="mkt-service-name">${escHtml(serviceName)}</td>
                <td class="mkt-cell-muted">${escHtml(service.category || '—')}</td>
                <td class="mkt-journey-cell">${service.journey_id ? `<span class="mkt-journey-link">🗺️ ${escHtml(journeyName)}</span>` : '<span class="mkt-cell-muted">Nenhuma</span>'}</td>
                <td class="mkt-table-price">${price}</td>
                <td><span class="badge ${service.active ? 'badge-green' : 'badge-gray'}">${service.active ? 'Ativo' : 'Inativo'}</span></td>
                <td class="mkt-table-actions">
                  <button onclick="openEditServiceModal('${serviceIdJs}','${serviceNameJs}','${categoryJs}','${descriptionJs}',${service.price_cents || Math.round((service.price || 0) * 100)},'${journeyIdJs}')"
                    class="mkt-action-btn">Editar</button>
                  <button onclick="toggleService('${serviceIdJs}',${!service.active})"
                    class="mkt-action-btn">
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
          ordersWrap.innerHTML = mktState('Nenhum pedido ainda.');
        } else {
          ordersWrap.innerHTML = `<table class="admin-simple-table mkt-table">
            <thead><tr>
              <th>Cliente</th>
              <th>Serviço</th>
              <th class="mkt-table-head-right">Valor</th>
              <th>Status</th>
              <th class="mkt-table-head-actions"></th>
            </tr></thead>
            <tbody>${orders.map(order => {
              const amount = ((order.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const client = order.re_users || {};
              const serviceName = order.re_services?.name || order.re_services?.title || '—';
              return `<tr>
                <td>
                  <div class="mkt-customer-name">${escHtml(client.name || '—')}</div>
                  <div class="mkt-customer-email">${escHtml(client.email || '')}</div>
                </td>
                <td>${escHtml(serviceName)}</td>
                <td class="mkt-table-price">${amount}</td>
                <td><span class="badge badge-gray">${statusMap[order.status] || order.status}</span></td>
                <td>
                  <select onchange="updateOrderStatus('${order.id}',this.value)" class="mkt-status-select">
                    ${Object.entries(statusMap).map(([value, label]) => `<option value="${value}"${order.status === value ? ' selected' : ''}>${label}</option>`).join('')}
                  </select>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;
        }
      }
    } catch (error) {
      servicesWrap.innerHTML = mktState('Erro ao carregar.', 'error');
      console.error('[ADMIN MARKETPLACE]', error.message);
    }
  }

  function buildServiceModalHtml(id, name, category, description, priceCents, journeyId) {
    const isEdit = !!id;
    const journeys = window._mktJourneys || [];
    const journeySelect = `<select id="svcJourney" class="mkt-modal-control">
      <option value="">— Nenhuma jornada —</option>
      ${journeys.map(journey => `<option value="${journey.id}"${journeyId === journey.id ? ' selected' : ''}>${escHtml(journey.name)}</option>`).join('')}
    </select>`;
    return `<div id="svcModal" class="mkt-modal-overlay">
      <div class="mkt-modal-card">
        <div class="mkt-modal-title">${isEdit ? 'Editar Serviço' : 'Novo Serviço'}</div>
        ${isEdit ? `<input type="hidden" id="svcEditId" value="${id}">` : ''}
        <label class="mkt-modal-label">Nome *</label>
        <input id="svcName" type="text" value="${escHtml(name || '')}" class="mkt-modal-control"/>
        <label class="mkt-modal-label">Categoria</label>
        <select id="svcCat" class="mkt-modal-control">
          ${['juridico','financeiro','consultoria','outro'].map(value => `<option value="${value}"${category === value ? ' selected' : ''}>${value.charAt(0).toUpperCase() + value.slice(1)}</option>`).join('')}
        </select>
        <label class="mkt-modal-label">Descrição</label>
        <textarea id="svcDesc" rows="2" class="mkt-modal-control mkt-modal-textarea">${escHtml(description || '')}</textarea>
        <label class="mkt-modal-label">Valor (R$) *</label>
        <input id="svcPrice" type="number" step="0.01" min="0" value="${priceCents ? (priceCents / 100).toFixed(2) : ''}" class="mkt-modal-control"/>
        <label class="mkt-modal-label">Jornada vinculada
          <span class="mkt-modal-help"> — ativada automaticamente ao confirmar o pedido</span>
        </label>
        ${journeySelect}
        <div class="mkt-modal-actions">
          <button onclick="window.REAdminModal?.closeById?.('svcModal', 'admin-marketplace:cancel')" class="mkt-modal-btn mkt-modal-btn-secondary">Cancelar</button>
          <button onclick="submitServiceForm()" class="mkt-modal-btn mkt-modal-btn-primary">${isEdit ? 'Salvar' : 'Criar Serviço'}</button>
        </div>
      </div>
    </div>`;
  }

  async function openCreateServiceModal() {
    if (!window._mktJourneys) {
      const response = await fetch('/api/admin/journeys', { headers: authH() });
      window._mktJourneys = response.ok ? await response.json() : [];
    }
    window.REAdminModal?.insertHtml?.('svcModal', buildServiceModalHtml(null, '', 'consultoria', '', 0, ''), 'admin-marketplace:create');
  }

  function openEditServiceModal(id, name, category, description, priceCents, journeyId) {
    window.REAdminModal?.insertHtml?.('svcModal', buildServiceModalHtml(id, name, category, description, priceCents, journeyId), 'admin-marketplace:edit');
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
      window.REAdminModal?.closeById?.('svcModal', 'admin-marketplace:submit');
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

console.info('[RE:admin-marketplace] loaded');
})();

function mktEscInline(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
