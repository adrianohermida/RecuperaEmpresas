'use strict';

(function () {
  function tertiaryLoading(message) {
    return `<div class="admin-finance-loading">${message}</div>`;
  }

  function tertiaryRoleTone(role) {
    const toneMap = {
      financeiro: 'cdt-role-financeiro',
      contador: 'cdt-role-contador',
      operacional: 'cdt-role-operacional',
      visualizador: 'cdt-role-visualizador',
    };
    return toneMap[role] || 'cdt-role-visualizador';
  }

  function tertiaryStatusClass(active) {
    return active ? 'cdt-member-status-active' : 'cdt-member-status-inactive';
  }

  async function renderFinancial(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando financeiro...');

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
        <div class="cdt-summary-grid">
          <div class="stat-card blue cdt-summary-card">
            <div class="stat-value cdt-summary-value">${window.REShared.formatCurrencyBRL(paidTotal)}</div>
            <div class="stat-label">Total pago</div>
          </div>
          <div class="stat-card cdt-summary-card">
            <div class="stat-value cdt-summary-value">${invoices.length}</div>
            <div class="stat-label">Cobranças (${paid.length} pagas)</div>
          </div>
        </div>
        <div class="cdt-section-title">Histórico de cobranças</div>
        <div class="cdt-stack-list">
          ${invoices.map(invoice => {
            const isPaid = invoice.status === 'paid' || invoice.status === 'succeeded';
            const statusClass = isPaid ? 'badge-green' : invoice.status === 'open' ? 'badge-amber' : 'badge-red';
            const statusLabel = isPaid ? 'Pago' : invoice.status === 'open' ? 'Em aberto' : invoice.status;
            const invoiceDate = window.REShared.formatDateBR(invoice.date);
            const amount = window.REShared.formatCurrencyBRL(parseFloat(invoice.amount || 0));
            const link = invoice.pdfUrl || invoice.hostedUrl;
            return `<div class="cdt-invoice-card">
              <div class="cdt-invoice-copy">
                <div class="cdt-invoice-title">${invoice.description || 'Cobrança'}</div>
                <div class="cdt-invoice-date">${invoiceDate}</div>
              </div>
              <div class="cdt-invoice-amount">${amount}</div>
              <span class="badge ${statusClass}">${statusLabel}</span>
              ${link ? `<a href="${link}" target="_blank" class="cdt-invoice-link">Ver</a>` : ''}
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
    body.innerHTML = tertiaryLoading('Carregando equipe...');

    const route = `/api/admin/client/${currentClientId}/members`;
    const response = await fetch(route, { headers: authH() });
    const payload = await readDrawerResponse('Equipe', route, response, ['members'], 'Deveria retornar members com name, email, role, active e last_login quando disponível.');
    if (!response.ok) {
      body.innerHTML = `<div class="empty-state"><p>${escHtml(payload.error || 'Erro ao carregar equipe.')}</p></div>`;
      return;
    }

    const { members = [] } = payload;
    const roleLabels = { financeiro:'Financeiro', contador:'Contador', operacional:'Operacional', visualizador:'Visualizador' };
  let html = `<div class="cdt-team-title">Membros da empresa (${members.length})</div>`;

    if (!members.length) {
      html += `<div class="empty-state"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Nenhum membro cadastrado pelo cliente.</p></div>`;
      body.innerHTML = html;
      return;
    }

    html += `<div class="cdt-stack-list">
      ${members.map(member => `
      <div class="cdt-member-card">
        <div class="cdt-member-avatar ${tertiaryRoleTone(member.role)}">
          ${(member.name || '?')[0].toUpperCase()}
        </div>
        <div class="cdt-member-copy">
          <div class="cdt-member-name">${member.name}</div>
          <div class="cdt-member-email">${member.email}</div>
        </div>
        <span class="cdt-member-role ${tertiaryRoleTone(member.role)}">${roleLabels[member.role] || member.role}</span>
        <span class="cdt-member-status ${tertiaryStatusClass(member.active)}">${member.active ? 'Ativo' : 'Inativo'}</span>
        <div class="cdt-member-login">${member.last_login ? 'Último login: ' + new Date(member.last_login).toLocaleDateString('pt-BR') : 'Nunca logou'}</div>
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