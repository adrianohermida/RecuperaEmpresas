'use strict';

(function () {
  async function loadAdminInvoices() {
    const wrap = document.getElementById('adminInvoiceTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="admin-data-state">Carregando...</div>';

    const status = document.getElementById('invFilterStatus')?.value || '';
    const from = document.getElementById('invFilterFrom')?.value || '';
    const to = document.getElementById('invFilterTo')?.value || '';
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
      const response = await fetch(`/api/admin/invoices?${params}`, { headers: authH() });
      if (!response.ok) {
        wrap.innerHTML = '<div class="admin-data-state admin-data-state-error">Erro ao carregar.</div>';
        return;
      }
      const { invoices = [] } = await response.json();

      if (!invoices.length) {
        wrap.innerHTML = '<div class="admin-data-state">Nenhuma cobrança encontrada.</div>';
        return;
      }

      const statusClass = { pending: 'badge-amber', paid: 'badge-green', overdue: 'badge-red', cancelled: 'badge-gray' };
      const statusLabel = { pending: 'Em aberto', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado' };

      wrap.innerHTML = `<table class="admin-simple-table admin-invoice-table">
        <thead><tr>
          <th>Cliente</th>
          <th>Descrição</th>
          <th class="admin-invoice-col-amount">Valor</th>
          <th>Vencimento</th>
          <th>Status</th>
          <th></th>
        </tr></thead>
        <tbody>${invoices.map(invoice => {
          const client = invoice.re_users || {};
          const amount = ((invoice.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const due = invoice.due_date ? new Date(invoice.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
          const badgeClass = statusClass[invoice.status] || 'badge-gray';
          const badgeLabel = statusLabel[invoice.status] || invoice.status;
          const isOverdue = invoice.status === 'pending' && invoice.due_date && new Date(invoice.due_date) < new Date();
          return `<tr${isOverdue ? ' class="admin-invoice-row-overdue"' : ''}>
            <td>
              <div class="admin-invoice-client-name">${escHtml(client.name || '—')}</div>
              <div class="admin-invoice-client-email">${escHtml(client.email || '')}</div>
            </td>
            <td class="admin-invoice-description">${escHtml(invoice.description)}</td>
            <td class="admin-invoice-amount">${amount}</td>
            <td class="admin-invoice-due">${due}</td>
            <td><span class="badge ${isOverdue ? 'badge-red' : badgeClass}">${isOverdue ? 'Vencido' : badgeLabel}</span></td>
            <td class="admin-invoice-actions">
              <a href="/api/admin/invoices/${invoice.id}/pdf" target="_blank" title="Baixar PDF"
                class="admin-invoice-action-link">📄 PDF</a>
              <button onclick="sendInvoiceEmail('${invoice.id}')" title="Enviar e-mail"
                class="admin-invoice-action-btn">📧</button>
              ${invoice.status !== 'paid' && invoice.status !== 'cancelled' ? `
              <button onclick="markInvoicePaid('${invoice.id}')" title="Marcar como pago"
                class="admin-invoice-action-btn admin-invoice-action-btn-success">✓ Pago</button>
              <button onclick="cancelInvoice('${invoice.id}')" title="Cancelar"
                class="admin-invoice-action-btn admin-invoice-action-btn-danger">✕</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } catch (error) {
      wrap.innerHTML = '<div class="admin-data-state admin-data-state-error">Erro ao carregar cobranças.</div>';
      console.error('[ADMIN INVOICES]', error.message);
    }
  }

  function openCreateInvoiceModal() {
    const clientSel = _allClients.map(client => `<option value="${client.id}">${escHtml(client.name)} (${escHtml(client.email)})</option>`).join('');
    const dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const html = `<div id="createInvoiceModal" class="admin-modal-overlay">
      <div class="admin-modal admin-invoice-modal">
        <div class="admin-modal-title">Nova Cobrança</div>
        <label class="admin-modal-label">Cliente *</label>
        <select id="ciClient" class="portal-select admin-modal-field">${clientSel}</select>
        <label class="admin-modal-label">Descrição *</label>
        <input id="ciDesc" type="text" class="portal-input admin-modal-field" placeholder="Ex: Mensalidade Janeiro 2026"/>
        <label class="admin-modal-label">Valor (R$) *</label>
        <input id="ciAmount" type="number" class="portal-input admin-modal-field" step="0.01" min="0" placeholder="0,00"/>
        <label class="admin-modal-label">Vencimento *</label>
        <input id="ciDue" type="date" class="portal-input admin-modal-field" value="${dueDefault}"/>
        <label class="admin-modal-label">Linha Digitável / Código de Barras</label>
        <input id="ciLinhaDigitavel" type="text" class="portal-input admin-modal-field" placeholder="Opcional"/>
        <label class="admin-modal-label">Observações</label>
        <textarea id="ciNotes" rows="2" class="portal-input admin-modal-field admin-modal-textarea"></textarea>
        <div class="admin-modal-actions">
          <button onclick="document.getElementById('createInvoiceModal').remove()" class="btn-ghost admin-modal-btn">Cancelar</button>
          <button onclick="submitCreateInvoice()" class="btn-primary admin-modal-btn">Criar Cobrança</button>
        </div>
      </div>
    </div>`;
    window.REAdminModal?.insertHtml?.('createInvoiceModal', html, 'admin-invoices:create');
  }

  async function submitCreateInvoice() {
    const user_id = document.getElementById('ciClient')?.value;
    const description = document.getElementById('ciDesc')?.value?.trim();
    const amountRaw = parseFloat(document.getElementById('ciAmount')?.value || 0);
    const due_date = document.getElementById('ciDue')?.value;
    const linha = document.getElementById('ciLinhaDigitavel')?.value?.trim();
    const notes = document.getElementById('ciNotes')?.value?.trim();

    if (!user_id || !description || !amountRaw || !due_date) {
      showToast('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    const body = { user_id, description, amount_cents: Math.round(amountRaw * 100), due_date, notes };
    if (linha) body.bank_data = { linha_digitavel: linha };

    const response = await fetch('/api/admin/invoices', { method: 'POST', headers: authH(), body: JSON.stringify(body) });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      window.REAdminModal?.closeById?.('createInvoiceModal', 'admin-invoices:submit');
      showToast('Cobrança criada com sucesso!', 'success');
      loadAdminInvoices();
      return;
    }
    if (payload.diagnostic) console.error('[ADMIN INVOICES DIAGNOSTIC]', payload.diagnostic);
    showToast(payload.error || 'Erro ao criar cobrança.', 'error');
  }

  async function markInvoicePaid(id) {
    if (!confirm('Marcar este boleto como PAGO?')) return;
    const response = await fetch(`/api/admin/invoices/${id}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() }),
    });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('Marcado como pago!', 'success');
      loadAdminInvoices();
      return;
    }
    showToast(payload.error || 'Erro.', 'error');
  }

  async function cancelInvoice(id) {
    if (!confirm('Cancelar este boleto?')) return;
    const response = await fetch(`/api/admin/invoices/${id}`, { method: 'DELETE', headers: authH() });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('Boleto cancelado.', 'success');
      loadAdminInvoices();
      return;
    }
    showToast(payload.error || 'Erro.', 'error');
  }

  async function sendInvoiceEmail(id) {
    const response = await fetch(`/api/admin/invoices/${id}/send-email`, { method: 'POST', headers: authH() });
    const payload = await readAdminResponse(response);
    if (response.ok) {
      showToast('E-mail enviado ao cliente!', 'success');
      return;
    }
    showToast(payload.error || 'Erro ao enviar e-mail.', 'error');
  }

  window.loadAdminInvoices = loadAdminInvoices;
  window.openCreateInvoiceModal = openCreateInvoiceModal;
  window.submitCreateInvoice = submitCreateInvoice;
  window.markInvoicePaid = markInvoicePaid;
  window.cancelInvoice = cancelInvoice;
  window.sendInvoiceEmail = sendInvoiceEmail;

console.info('[RE:admin-invoices] loaded');
})();
