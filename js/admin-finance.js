'use strict';

(function () {
  function financeState(message) {
    return `<div class="admin-finance-loading">${message}</div>`;
  }

  async function loadAdminFinanceiro() {
    const listEl = document.getElementById('finClientsList');
    listEl.innerHTML = financeState('Carregando dados do Stripe...');

    const response = await fetch('/api/admin/financial', { headers: authH() });
    if (!response.ok) {
      listEl.innerHTML = financeState('Erro ao carregar dados financeiros.');
      return;
    }

    const { configured, clients = [], totalRevenue = 0 } = await response.json();
    if (!configured) {
      listEl.innerHTML = financeState('Stripe não configurado. Defina STRIPE_SECRET_KEY nas variáveis de ambiente.');
      return;
    }

    const payingClients = clients.filter(client => client.paymentsCount > 0);
    const totalPayments = clients.reduce((sum, client) => sum + (client.paymentsCount || 0), 0);

    document.getElementById('finTotalRevenue').textContent = `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('finClientsPaid').textContent = payingClients.length;
    document.getElementById('finTotalPayments').textContent = totalPayments;
    document.getElementById('finSub').textContent = `${clients.length} cliente${clients.length !== 1 ? 's' : ''} — R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em receita total`;

    if (!clients.length) {
      listEl.innerHTML = financeState('Nenhum cliente com histórico financeiro.');
      return;
    }

    const sortedClients = [...clients].sort((left, right) => (right.totalPaid || 0) - (left.totalPaid || 0));
    let html = '<table class="admin-simple-table admin-finance-table">';
    html += '<thead><tr>';
    ['Cliente', 'Empresa', 'Pagamentos', 'Total pago', 'Último pagamento', ''].forEach(header => {
      const headerClass = header === 'Pagamentos' ? ' class="admin-finance-center"' : '';
      html += `<th${headerClass}>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    sortedClients.forEach(client => {
      const lastPaymentDate = client.lastPaymentDate ? new Date(client.lastPaymentDate).toLocaleDateString('pt-BR') : '—';
      const totalPaidClass = client.totalPaid > 0 ? ' admin-finance-total-positive' : '';
      html += `<tr class="admin-finance-row" onclick="openClient('${client.userId}')">
        <td><div class="admin-finance-client-name">${client.name || '—'}</div><div class="admin-finance-client-email">${client.email}</div></td>
        <td class="admin-finance-muted">${client.company || '—'}</td>
        <td class="admin-finance-center">${client.paymentsCount || 0}</td>
        <td class="admin-finance-total${totalPaidClass}">R$ ${(client.totalPaid || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="admin-finance-muted">${lastPaymentDate}</td>
        <td><button class="btn-ghost admin-finance-invoices-btn" onclick="event.stopPropagation();openClientFinanceiro('${client.userId}')">Ver faturas</button></td>
      </tr>`;
    });
    html += '</tbody></table>';
    listEl.innerHTML = html;
  }

  function openClientFinanceiro(clientId) {
    openClient(clientId);
    setTimeout(() => {
      const tabs = document.querySelectorAll('.drawer-tab');
      tabs.forEach(tab => {
        if (tab.textContent.trim() === 'Financeiro') tab.click();
      });
    }, 400);
  }

  window.loadAdminFinanceiro = loadAdminFinanceiro;
  window.openClientFinanceiro = openClientFinanceiro;
})();