'use strict';

(function () {
  async function loadAdminFinanceiro() {
    const listEl = document.getElementById('finClientsList');
    listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:14px;">Carregando dados do Stripe...</div>';

    const response = await fetch('/api/admin/financial', { headers: authH() });
    if (!response.ok) {
      listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Erro ao carregar dados financeiros.</div>';
      return;
    }

    const { configured, clients = [], totalRevenue = 0 } = await response.json();
    if (!configured) {
      listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Stripe não configurado. Defina STRIPE_SECRET_KEY nas variáveis de ambiente.</div>';
      return;
    }

    const payingClients = clients.filter(client => client.paymentsCount > 0);
    const totalPayments = clients.reduce((sum, client) => sum + (client.paymentsCount || 0), 0);

    document.getElementById('finTotalRevenue').textContent = `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('finClientsPaid').textContent = payingClients.length;
    document.getElementById('finTotalPayments').textContent = totalPayments;
    document.getElementById('finSub').textContent = `${clients.length} cliente${clients.length !== 1 ? 's' : ''} — R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em receita total`;

    if (!clients.length) {
      listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Nenhum cliente com histórico financeiro.</div>';
      return;
    }

    const sortedClients = [...clients].sort((left, right) => (right.totalPaid || 0) - (left.totalPaid || 0));
    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="border-bottom:1px solid var(--border);">';
    ['Cliente', 'Empresa', 'Pagamentos', 'Total pago', 'Último pagamento', ''].forEach(header => {
      html += `<th style="text-align:left;padding:10px 14px;color:var(--text-muted);font-weight:600;">${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    sortedClients.forEach(client => {
      const lastPaymentDate = client.lastPaymentDate ? new Date(client.lastPaymentDate).toLocaleDateString('pt-BR') : '—';
      html += `<tr style="border-bottom:1px solid var(--border-light,#F1F5F9);cursor:pointer;" onclick="openClient('${client.userId}')">
        <td style="padding:10px 14px;"><div style="font-weight:600;">${client.name || '—'}</div><div style="font-size:11px;color:var(--text-muted);">${client.email}</div></td>
        <td style="padding:10px 14px;color:var(--text-muted);">${client.company || '—'}</td>
        <td style="padding:10px 14px;text-align:center;">${client.paymentsCount || 0}</td>
        <td style="padding:10px 14px;font-weight:700;color:${client.totalPaid > 0 ? '#059669' : 'var(--text-muted)'};">R$ ${(client.totalPaid || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:10px 14px;color:var(--text-muted);">${lastPaymentDate}</td>
        <td style="padding:10px 14px;"><button class="btn-ghost" style="font-size:12px;padding:4px 10px;" onclick="event.stopPropagation();openClientFinanceiro('${client.userId}')">Ver faturas</button></td>
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