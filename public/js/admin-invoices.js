'use strict';

(function () {
  async function loadAdminInvoices() {
    const wrap = document.getElementById('adminInvoiceTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Carregando...</div>';

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
        wrap.innerHTML = '<div style="padding:20px;color:var(--danger);">Erro ao carregar.</div>';
        return;
      }
      const { invoices = [] } = await response.json();

      if (!invoices.length) {
        wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Nenhuma cobrança encontrada.</div>';
        return;
      }

      const statusClass = { pending: 'badge-amber', paid: 'badge-green', overdue: 'badge-red', cancelled: 'badge-gray' };
      const statusLabel = { pending: 'Em aberto', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado' };

      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Cliente</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Descrição</th>
          <th style="text-align:right;padding:8px 12px;color:var(--text-muted);font-weight:600;">Valor</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Vencimento</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Status</th>
          <th style="padding:8px 12px;"></th>
        </tr></thead>
        <tbody>${invoices.map(invoice => {
          const client = invoice.re_users || {};
          const amount = ((invoice.amount_cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const due = invoice.due_date ? new Date(invoice.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
          const badgeClass = statusClass[invoice.status] || 'badge-gray';
          const badgeLabel = statusLabel[invoice.status] || invoice.status;
          const isOverdue = invoice.status === 'pending' && invoice.due_date && new Date(invoice.due_date) < new Date();
          return `<tr style="border-bottom:1px solid #F1F5F9;${isOverdue ? 'background:#FFF7ED;' : ''}">
            <td style="padding:10px 12px;">
              <div style="font-weight:600;font-size:13px;">${escHtml(client.name || '—')}</div>
              <div style="font-size:11px;color:var(--text-muted);">${escHtml(client.email || '')}</div>
            </td>
            <td style="padding:10px 12px;font-weight:500;">${escHtml(invoice.description)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;">${amount}</td>
            <td style="padding:10px 12px;color:var(--text-muted);">${due}</td>
            <td style="padding:10px 12px;"><span class="badge ${isOverdue ? 'badge-red' : badgeClass}">${isOverdue ? 'Vencido' : badgeLabel}</span></td>
            <td style="padding:10px 12px;display:flex;gap:6px;flex-wrap:wrap;">
              <a href="/api/admin/invoices/${invoice.id}/pdf" target="_blank" title="Baixar PDF"
                style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;text-decoration:none;color:var(--text);cursor:pointer;">📄 PDF</a>
              <button onclick="sendInvoiceEmail('${invoice.id}')" title="Enviar e-mail"
                style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:none;cursor:pointer;">📧</button>
              ${invoice.status !== 'paid' && invoice.status !== 'cancelled' ? `
              <button onclick="markInvoicePaid('${invoice.id}')" title="Marcar como pago"
                style="border:1px solid #D1FAE5;background:#ECFDF5;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:#059669;">✓ Pago</button>
              <button onclick="cancelInvoice('${invoice.id}')" title="Cancelar"
                style="border:1px solid #FEE2E2;background:#FFF5F5;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:#DC2626;">✕</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } catch (error) {
      wrap.innerHTML = '<div style="padding:20px;color:var(--danger);">Erro ao carregar cobranças.</div>';
      console.error('[ADMIN INVOICES]', error.message);
    }
  }

  function openCreateInvoiceModal() {
    const clientSel = _allClients.map(client => `<option value="${client.id}">${escHtml(client.name)} (${escHtml(client.email)})</option>`).join('');
    const dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const html = `<div id="createInvoiceModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div style="background:#fff;border-radius:12px;padding:28px;width:440px;max-width:96vw;max-height:90vh;overflow-y:auto;">
        <div style="font-size:17px;font-weight:700;color:var(--dark);margin-bottom:18px;">Nova Cobrança</div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Cliente *</label>
        <select id="ciClient" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;">${clientSel}</select>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Descrição *</label>
        <input id="ciDesc" type="text" placeholder="Ex: Mensalidade Janeiro 2026" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Valor (R$) *</label>
        <input id="ciAmount" type="number" step="0.01" min="0" placeholder="0,00" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Vencimento *</label>
        <input id="ciDue" type="date" value="${dueDefault}" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Linha Digitável / Código de Barras</label>
        <input id="ciLinhaDigitavel" type="text" placeholder="Opcional" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:12px;"/>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Observações</label>
        <textarea id="ciNotes" rows="2" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;margin-bottom:18px;resize:vertical;"></textarea>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="document.getElementById('createInvoiceModal').remove()" style="background:none;border:1px solid var(--border);border-radius:7px;padding:9px 18px;font-size:13px;cursor:pointer;">Cancelar</button>
          <button onclick="submitCreateInvoice()" style="background:var(--primary);color:#fff;border:none;border-radius:7px;padding:9px 18px;font-size:13px;cursor:pointer;font-weight:600;">Criar Cobrança</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
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
      document.getElementById('createInvoiceModal')?.remove();
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
})();