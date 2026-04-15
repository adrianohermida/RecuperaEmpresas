'use strict';

(function () {
  async function renderFinancial(context) {
    const { body, currentClientId } = context;
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando financeiro...</div>';

    try {
      const route = `/api/admin/client/${currentClientId}/financial`;
      const response = await fetch(route, { headers: authH() });
      const data = await readDrawerResponse('Financeiro', route, response, ['invoices'], 'Deveria retornar invoices e, opcionalmente, configured/stripeConfigured.');
      if (!response.ok) throw new Error(data.error || 'Erro');

      const invoices = data.invoices || [];
      const stripeConfigured = data.configured ?? data.stripeConfigured ?? true;
      if (!stripeConfigured) {
        body.innerHTML = '<div class="empty-state"><p>Stripe não configurado.</p></div>';
        return;
      }
      if (!invoices.length) {
        body.innerHTML = '<div class="empty-state"><p>Nenhuma cobrança encontrada.</p></div>';
        return;
      }

      const paid = invoices.filter(invoice => invoice.status === 'paid' || invoice.status === 'succeeded');
      const paidTotal = paid.reduce((sum, invoice) => sum + parseFloat(invoice.amount || 0), 0);

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="stat-card blue" style="margin:0;">
            <div class="stat-value" style="font-size:18px;">${window.REShared.formatCurrencyBRL(paidTotal)}</div>
            <div class="stat-label">Total pago</div>
          </div>
          <div class="stat-card" style="margin:0;">
            <div class="stat-value" style="font-size:18px;">${invoices.length}</div>
            <div class="stat-label">Cobranças (${paid.length} pagas)</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Histórico de cobranças</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${invoices.map(invoice => {
            const isPaid = invoice.status === 'paid' || invoice.status === 'succeeded';
            const statusClass = isPaid ? 'badge-green' : invoice.status === 'open' ? 'badge-amber' : 'badge-red';
            const statusLabel = isPaid ? 'Pago' : invoice.status === 'open' ? 'Em aberto' : invoice.status;
            const invoiceDate = window.REShared.formatDateBR(invoice.date);
            const amount = window.REShared.formatCurrencyBRL(parseFloat(invoice.amount || 0));
            const link = invoice.pdfUrl || invoice.hostedUrl;
            return `<div style="background:#F8FAFC;border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${invoice.description || 'Cobrança'}</div>
                <div style="font-size:11px;color:var(--text-muted);">${invoiceDate}</div>
              </div>
              <div style="font-weight:700;font-size:13px;">${amount}</div>
              <span class="badge ${statusClass}">${statusLabel}</span>
              ${link ? `<a href="${link}" target="_blank" style="font-size:11px;color:var(--primary);">Ver</a>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    } catch (error) {
      logDrawerDiagnostic('Financeiro', {
        route: `/api/admin/client/${currentClientId}/financial`,
        source: 'fetch',
        expectedKeys: ['invoices'],
        actualPayload: null,
        note: 'Deveria retornar invoices e dados de configuração de Stripe.',
        error: error.message,
      });
      body.innerHTML = '<div class="empty-state"><p>Erro ao carregar dados financeiros.</p></div>';
    }
  }

  async function renderTeam(context) {
    const { body, currentClientId } = context;
    body.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">Carregando equipe...</div>';

    const route = `/api/admin/client/${currentClientId}/members`;
    const response = await fetch(route, { headers: authH() });
    const payload = await readDrawerResponse('Equipe', route, response, ['members'], 'Deveria retornar members com name, email, role, active e last_login quando disponível.');
    if (!response.ok) {
      body.innerHTML = `<div class="empty-state"><p>${escHtml(payload.error || 'Erro ao carregar equipe.')}</p></div>`;
      return;
    }

    const { members = [] } = payload;
    const roleLabels = { financeiro:'Financeiro', contador:'Contador', operacional:'Operacional', visualizador:'Visualizador' };
    const roleColors = { financeiro:'#2563eb', contador:'#7c3aed', operacional:'#059669', visualizador:'#6b7280' };
    let html = `<div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:14px;">Membros da empresa (${members.length})</div>`;

    if (!members.length) {
      html += `<div class="empty-state"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Nenhum membro cadastrado pelo cliente.</p></div>`;
      body.innerHTML = html;
      return;
    }

    html += `<div style="display:flex;flex-direction:column;gap:8px;">
      ${members.map(member => `
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px;">
        <div style="width:34px;height:34px;border-radius:50%;background:${roleColors[member.role] || '#6b7280'}22;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:${roleColors[member.role] || '#6b7280'}">
          ${(member.name || '?')[0].toUpperCase()}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:#1e293b;">${member.name}</div>
          <div style="font-size:11px;color:#64748b;">${member.email}</div>
        </div>
        <span style="background:${roleColors[member.role] || '#6b7280'}18;color:${roleColors[member.role] || '#6b7280'};font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;">${roleLabels[member.role] || member.role}</span>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;${member.active ? 'background:#dcfce7;color:#16a34a;' : 'background:#fee2e2;color:#dc2626;'}">${member.active ? 'Ativo' : 'Inativo'}</span>
        <div style="font-size:10px;color:#94a3b8;">${member.last_login ? 'Último login: ' + new Date(member.last_login).toLocaleDateString('pt-BR') : 'Nunca logou'}</div>
      </div>`).join('')}
    </div>`;

    body.innerHTML = html;
  }

  window.REAdminDrawerTertiaryTabs = {
    async render(tab, context) {
      if (tab === 'financeiro_client') {
        await renderFinancial(context);
        return true;
      }
      if (tab === 'equipe') {
        await renderTeam(context);
        return true;
      }
      return false;
    },
  };
})();