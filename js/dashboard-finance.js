'use strict';
/* dashboard-finance.js — Financeiro: faturas Stripe, boletos, comentários de capítulo */

let _commentChapterId = null;
let _commentAction    = 'approve_comment';

function openCommentModal(chId, title, action = 'approve_comment') {
  _commentChapterId = chId;
  _commentAction    = action;
  document.getElementById('commentModalTitle').textContent = title;
  document.getElementById('commentText').value = '';
  document.getElementById('commentModal').classList.remove('dashboard-modal-hidden');
}

function closeCommentModal() {
  document.getElementById('commentModal').classList.add('dashboard-modal-hidden');
}

async function submitComment() {
  const text = document.getElementById('commentText').value.trim();
  if (!text) return;
  await fetch(`/api/plan/chapter/${_commentChapterId}`, {
    method: 'PUT', headers: authH(),
    body: JSON.stringify({ clientAction: _commentAction, comment: text }),
  });
  closeCommentModal();
  showToast('Comentário enviado.', 'success');
  loadData();
}

async function loadFinanceiro() {
  const el = document.getElementById('invoiceList');
  el.innerHTML = '<div class="dashboard-section-loading">Carregando...</div>';
  const res = await fetch('/api/financial/invoices', { headers: authH() });
  if (!res.ok) { el.innerHTML = '<div class="empty-state"><p>Erro ao carregar faturas.</p></div>'; return; }
  const { invoices = [], stripeConfigured } = await res.json();

  const noticeEl = document.getElementById('stripeNotice');
  if (noticeEl) noticeEl.classList.toggle('dashboard-hidden-card', Boolean(stripeConfigured));

  const isPaid = i => i.status === 'paid' || i.status === 'succeeded';
  document.getElementById('finTotal').textContent   = invoices.length;
  document.getElementById('finPaid').textContent    = invoices.filter(isPaid).length;
  document.getElementById('finPending').textContent = invoices.filter(i => !isPaid(i)).length;

  if (!invoices.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <p>Nenhum registro financeiro encontrado. Pagamentos aparecerão aqui após processamento.</p>
    </div>`;
    return;
  }

  let html = '<div class="admin-table-wrap"><table class="admin-simple-table"><thead><tr>'
    + '<th>Descrição</th><th class="admin-invoice-col-amount">Valor</th>'
    + '<th>Data</th><th>Status</th><th></th>'
    + '</tr></thead><tbody>';
  invoices.forEach(inv => {
    const paid      = isPaid(inv);
    const stBadge   = paid ? 'badge-green' : inv.status === 'open' ? 'badge-amber' : 'badge-gray';
    const stLabel   = paid ? 'Pago' : inv.status === 'open' ? 'Em aberto' : inv.status === 'void' ? 'Cancelado' : 'Pendente';
    const amtNum    = parseFloat(inv.amount || inv.amountPaid || 0);
    const amtFmt    = window.REShared.formatCurrencyBRL(amtNum);
    const dateFmt   = inv.date ? window.REShared.formatDateBR(inv.date) : '-';
    const amountCls = paid ? 'dashboard-finance-amount-paid' : 'dashboard-finance-amount';
    const pdfBtn    = inv.pdfUrl    ? `<a href="${inv.pdfUrl}" target="_blank" class="admin-invoice-action-link">📄 PDF</a>` : '';
    const linkBtn   = inv.hostedUrl ? `<a href="${inv.hostedUrl}" target="_blank" class="admin-invoice-action-link">Ver fatura</a>` : '';
    html += `<tr>
      <td class="admin-invoice-description">${inv.description || 'Pagamento'}</td>
      <td class="${amountCls}">${amtFmt}</td>
      <td class="admin-log-muted">${dateFmt}</td>
      <td><span class="badge ${stBadge}">${stLabel}</span></td>
      <td><div class="admin-invoice-actions">${pdfBtn}${linkBtn}</div></td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function requestInvoice() {
  const res  = await fetch('/api/financial/request-invoice', { method: 'POST', headers: authH() });
  const json = await res.json();
  if (json.success) {
    showToast('Solicitação enviada! Nossa equipe entrará em contato.', 'success');
  } else {
    showToast(json.error || 'Erro ao solicitar. Tente novamente.', 'error');
  }
}

async function loadInternalInvoices() {
  const el = document.getElementById('internalInvoiceList');
  if (!el) return;
  el.innerHTML = '<div class="dashboard-inline-loading-sm">Carregando boletos...</div>';
  try {
    const res = await fetch('/api/financial/internal-invoices', { headers: authH() });
    if (!res.ok) { el.innerHTML = ''; return; }
    const { invoices = [] } = await res.json();

    if (!invoices.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p class="dashboard-empty-copy-sm">Nenhum boleto disponível.</p>
      </div>`;
      return;
    }

    const statusLabel = { pending: 'Em aberto', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado' };
    const statusClass = { pending: 'badge-amber', paid: 'badge-green', overdue: 'badge-red', cancelled: 'badge-gray' };

    let html = '<div class="admin-table-wrap"><table class="admin-simple-table"><thead><tr>'
      + '<th>Descrição</th><th class="admin-invoice-col-amount">Valor</th>'
      + '<th>Vencimento</th><th>Status</th><th></th>'
      + '</tr></thead><tbody>';
    invoices.forEach(inv => {
      const amt      = window.REShared.formatCurrencyBRL((inv.amount_cents || 0) / 100);
      const due      = inv.due_date ? window.REShared.formatDateBR(inv.due_date + 'T12:00:00') : '-';
      const sCls     = statusClass[inv.status] || 'badge-gray';
      const sLbl     = statusLabel[inv.status] || inv.status;
      const isOverdue = inv.status === 'pending' && inv.due_date && new Date(inv.due_date) < new Date();
      html += `<tr${isOverdue ? ' class="admin-invoice-row-overdue"' : ''}>
        <td class="admin-invoice-description">${escHtmlD(inv.description)}</td>
        <td class="dashboard-finance-amount">${amt}</td>
        <td class="admin-log-muted">${due}</td>
        <td><span class="badge ${isOverdue ? 'badge-red' : sCls}">${isOverdue ? 'Vencido' : sLbl}</span></td>
        <td>
          ${inv.status !== 'cancelled' && inv.status !== 'paid'
            ? `<a href="/api/financial/internal-invoices/${inv.id}/pdf?token=${encodeURIComponent(localStorage.getItem('re_token') || '')}" target="_blank" class="admin-invoice-action-link">📄 Boleto</a>`
            : ''}
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
    console.warn('[INT INVOICES]', e.message);
  }
}
