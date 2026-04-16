'use strict';
/* dashboard-marketplace.js — Marketplace: serviços e pedidos */

async function loadMarketplace() {
  const gridEl   = document.getElementById('marketplaceGrid');
  const ordersEl = document.getElementById('myOrdersList');
  if (!gridEl) return;
  gridEl.innerHTML = '<div class="dashboard-grid-empty-state">Carregando serviços...</div>';

  try {
    const [svcRes, ordRes] = await Promise.all([
      fetch('/api/services',       { headers: authH() }),
      fetch('/api/service-orders', { headers: authH() }),
    ]);

    if (svcRes.ok) {
      const { services = [] } = await svcRes.json();
      if (!services.length) {
        gridEl.innerHTML = '<div class="dashboard-grid-empty-state">Nenhum serviço disponível no momento.</div>';
      } else {
        const catLabel = { juridico: 'Jurídico', financeiro: 'Financeiro', consultoria: 'Consultoria', outro: 'Outro' };
        gridEl.innerHTML = services.map(s => {
          const price = window.REShared.formatCurrencyBRL((s.price_cents || 0) / 100);
          const feats = Array.isArray(s.features) ? s.features : [];
          return `<div class="dashboard-service-card">
            ${s.featured ? '<span class="dashboard-service-featured">⭐ Destaque</span>' : ''}
            <div class="dashboard-service-category">${catLabel[s.category] || s.category || ''}</div>
            <div class="dashboard-service-title">${escHtmlD(s.name)}</div>
            ${s.description ? `<div class="dashboard-service-description">${escHtmlD(s.description)}</div>` : ''}
            ${feats.length ? `<ul class="dashboard-service-features">${feats.map(f => `<li>${escHtmlD(f)}</li>`).join('')}</ul>` : ''}
            <div class="dashboard-service-price">${price}</div>
            <button onclick="contractService('${s.id}')" class="dashboard-service-cta">Contratar</button>
          </div>`;
        }).join('');
      }
    } else {
      gridEl.innerHTML = '<div class="dashboard-grid-empty-state">Serviços indisponíveis.</div>';
    }

    if (ordRes.ok && ordersEl) {
      const { orders = [] } = await ordRes.json();
      if (!orders.length) {
        ordersEl.innerHTML = `<div class="empty-state"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg><p class="dashboard-empty-copy-sm">Nenhum pedido ainda.</p></div>`;
      } else {
        const stMap = {
          pending_payment: 'Aguardando pagamento', paid: 'Pago',
          in_progress: 'Em andamento', delivered: 'Entregue', cancelled: 'Cancelado',
        };
        ordersEl.innerHTML = `<div class="admin-table-wrap"><table class="admin-simple-table">
          <thead><tr>
            <th>Serviço</th>
            <th class="admin-invoice-col-amount">Valor</th>
            <th>Data</th>
            <th>Status</th>
          </tr></thead><tbody>
          ${orders.map(o => {
            const amt = ((o.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const dt  = new Date(o.created_at).toLocaleDateString('pt-BR');
            return `<tr>
              <td class="dashboard-support-subject">${escHtmlD(o.re_services?.name || '—')}</td>
              <td class="dashboard-finance-amount">${amt}</td>
              <td class="admin-log-muted">${dt}</td>
              <td><span class="badge badge-gray">${stMap[o.status] || o.status}</span></td>
            </tr>`;
          }).join('')}
          </tbody></table></div>`;
      }
    }
  } catch (e) {
    gridEl.innerHTML = '<div class="dashboard-grid-empty-state">Erro ao carregar marketplace.</div>';
    console.warn('[MARKETPLACE]', e.message);
  }
}

async function contractService(serviceId) {
  if (!confirm('Confirmar contratação deste serviço?')) return;
  const res = await fetch(`/api/services/${serviceId}/order`, {
    method: 'POST', headers: authH(), body: JSON.stringify({}),
  });
  const j = await res.json();
  if (j.url) { window.location.href = j.url; return; }
  if (res.ok) {
    showToast('Pedido criado! Nossa equipe entrará em contato.', 'success');
    loadMarketplace();
  } else {
    showToast(j.error || 'Erro ao contratar serviço.', 'error');
  }
}
console.info('[RE:dashboard-marketplace] loaded');
