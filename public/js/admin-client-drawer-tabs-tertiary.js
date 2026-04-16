'use strict';

(function () {
  function tertiaryLoading(message) {
    return `<div class="admin-finance-loading">${message}</div>`;
  }

  function roleTone(role) {
    return { financeiro:'cdt-role-financeiro', contador:'cdt-role-contador',
      operacional:'cdt-role-operacional', visualizador:'cdt-role-visualizador' }[role] || 'cdt-role-visualizador';
  }

  function fmtBRL(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtDate(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—'; }

  // ── Financeiro ────────────────────────────────────────────────────────────────
  async function renderFinancial(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando financeiro...');
    try {
      const res = await fetch(`/api/admin/client/${currentClientId}/financial`, { headers: authH() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      const invoices = data.invoices || [];
      const paid = invoices.filter(i => i.status === 'paid' || i.status === 'succeeded');
      const paidTotal = paid.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
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
        <div class="cdt-stack-list">
          ${invoices.map(inv => {
            const isPaid = inv.status === 'paid' || inv.status === 'succeeded';
            const cls = isPaid ? 'badge-green' : 'badge-amber';
            return `<div class="cdt-invoice-card">
              <div class="cdt-invoice-copy">
                <div class="cdt-invoice-title">${escHtml(inv.description || 'Cobrança')}</div>
                <div class="cdt-invoice-date">${window.REShared.formatDateBR(inv.date)}</div>
              </div>
              <div class="cdt-invoice-amount">${window.REShared.formatCurrencyBRL(parseFloat(inv.amount || 0))}</div>
              <span class="badge ${cls}">${isPaid ? 'Pago' : 'Em aberto'}</span>
              ${inv.pdfUrl ? `<a href="${inv.pdfUrl}" target="_blank" class="cdt-invoice-link">Ver</a>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    } catch (e) {
      body.innerHTML = '<div class="empty-state"><p>Erro ao carregar dados financeiros.</p></div>';
    }
  }

  // ── Equipe (enhanced: departments + invite + member docs) ────────────────────
  async function renderTeam(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando equipe...');

    const [membersRes, deptsRes] = await Promise.all([
      fetch(`/api/admin/client/${currentClientId}/members`, { headers: authH() }),
      fetch(`/api/admin/client/${currentClientId}/departments`, { headers: authH() }),
    ]);
    const membersData = await membersRes.json();
    const deptsData = deptsRes.ok ? await deptsRes.json() : { departments: [] };

    const members = membersData.members || [];
    const depts = deptsData.departments || [];
    const deptMap = Object.fromEntries(depts.map(d => [d.id, d.name]));
    const roleLabels = { financeiro:'Financeiro', contador:'Contador', operacional:'Operacional', visualizador:'Visualizador' };

    let html = `
    <!-- Invite form -->
    <div class="cdt-section-box" style="margin-bottom:12px">
      <div class="cdt-section-title">Convidar novo membro</div>
      <div class="cdt-invite-form">
        <input id="inviteName" class="form-control" placeholder="Nome *" style="flex:1;min-width:130px">
        <input id="inviteEmail" class="form-control" placeholder="E-mail *" style="flex:1;min-width:160px">
        <select id="inviteRole" class="form-control" style="width:140px">
          <option value="operacional">Operacional</option>
          <option value="financeiro">Financeiro</option>
          <option value="contador">Contador</option>
          <option value="visualizador">Visualizador</option>
        </select>
        <select id="inviteDept" class="form-control" style="width:150px">
          <option value="">Sem departamento</option>
          ${depts.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('')}
        </select>
        <input id="inviteJobTitle" class="form-control" placeholder="Cargo" style="width:130px">
        <button class="btn btn-primary btn-sm" onclick="adminInviteMember('${currentClientId}')">Convidar</button>
      </div>
    </div>

    <!-- Departments -->
    <div class="cdt-section-box" style="margin-bottom:12px">
      <div class="cdt-section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Departamentos (${depts.length})</span>
        <button class="btn btn-sm btn-outline" onclick="adminAddDept('${currentClientId}')">+ Departamento</button>
      </div>
      ${depts.length ? `<div class="cdt-stack-list" style="margin-top:8px">
        ${depts.map(d => `
          <div class="cdt-dept-card" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
            <span style="width:12px;height:12px;border-radius:3px;background:${d.color || '#6366f1'};display:inline-block"></span>
            <span style="font-weight:500;flex:1">${escHtml(d.name)}</span>
            ${d.re_company_users ? `<span style="font-size:12px;color:#6b7280">Gestor: ${escHtml(d.re_company_users.name)}</span>` : ''}
            <button class="btn btn-xs btn-outline" onclick="adminEditDept('${currentClientId}','${d.id}','${escHtml(d.name)}')">Editar</button>
            <button class="btn btn-xs btn-outline btn-danger" onclick="adminDeleteDept('${currentClientId}','${d.id}')">Excluir</button>
          </div>`).join('')}
      </div>` : `<p style="color:#9ca3af;font-size:13px;margin-top:8px">Nenhum departamento criado.</p>`}
    </div>

    <!-- Members list -->
    <div class="cdt-section-title">Membros (${members.length})</div>`;

    if (!members.length) {
      html += `<div class="empty-state"><p>Nenhum membro cadastrado.</p></div>`;
    } else {
      html += `<div class="cdt-stack-list">
        ${members.map(m => `
        <div class="cdt-member-card">
          <div class="cdt-member-avatar ${roleTone(m.role)}">${(m.name || '?')[0].toUpperCase()}</div>
          <div class="cdt-member-copy">
            <div class="cdt-member-name">${escHtml(m.name)}</div>
            <div class="cdt-member-email">${escHtml(m.email)}</div>
            ${m.job_title ? `<div style="font-size:11px;color:#6b7280">${escHtml(m.job_title)}</div>` : ''}
            ${m.department_id ? `<div style="font-size:11px;color:#6366f1">📁 ${escHtml(deptMap[m.department_id] || 'Dept')}</div>` : ''}
          </div>
          <span class="cdt-member-role ${roleTone(m.role)}">${roleLabels[m.role] || m.role}</span>
          <span class="cdt-member-status ${m.active ? 'cdt-member-status-active' : 'cdt-member-status-inactive'}">${m.active ? 'Ativo' : 'Inativo'}</span>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            <button class="btn btn-xs btn-outline" onclick="adminToggleMember('${currentClientId}','${m.id}',${!m.active})">
              ${m.active ? 'Desativar' : 'Ativar'}
            </button>
            <button class="btn btn-xs btn-outline" onclick="adminMemberDocs('${currentClientId}','${m.id}','${escHtml(m.name)}')">Docs</button>
          </div>
        </div>`).join('')}
      </div>`;
    }

    body.innerHTML = html;
  }

  // ── Organograma ───────────────────────────────────────────────────────────────
  async function renderOrgChart(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando organograma...');

    const [deptsRes, membersRes] = await Promise.all([
      fetch(`/api/admin/client/${currentClientId}/departments`, { headers: authH() }),
      fetch(`/api/admin/client/${currentClientId}/members`, { headers: authH() }),
    ]);
    const { departments: depts = [] } = deptsRes.ok ? await deptsRes.json() : {};
    const { members = [] } = membersRes.ok ? await membersRes.json() : {};

    // Build tree
    const membersByDept = {};
    members.forEach(m => {
      const key = m.department_id || '__none__';
      if (!membersByDept[key]) membersByDept[key] = [];
      membersByDept[key].push(m);
    });

    function buildNode(dept, level = 0) {
      const children = depts.filter(d => d.parent_id === dept.id);
      const deptMembers = membersByDept[dept.id] || [];
      const manager = deptMembers.find(m => m.id === dept.manager_id) || deptMembers[0];
      return `
        <div class="org-node" style="--level:${level}">
          <div class="org-card" style="border-top:3px solid ${dept.color || '#6366f1'}">
            <div class="org-dept-name">${escHtml(dept.name)}</div>
            ${manager ? `<div class="org-manager">👤 ${escHtml(manager.name)}${manager.job_title ? ' · ' + escHtml(manager.job_title) : ''}</div>` : ''}
            <div class="org-members">${deptMembers.length} membro${deptMembers.length !== 1 ? 's' : ''}</div>
          </div>
          ${children.length ? `<div class="org-children">${children.map(c => buildNode(c, level + 1)).join('')}</div>` : ''}
        </div>`;
    }

    const roots = depts.filter(d => !d.parent_id);
    const unassigned = membersByDept['__none__'] || [];

    let html = `<div class="org-chart-wrap">
      <style>
        .org-chart-wrap{padding:12px;overflow-x:auto}
        .org-root{display:flex;gap:24px;justify-content:center;flex-wrap:wrap}
        .org-node{display:flex;flex-direction:column;align-items:center}
        .org-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;
          min-width:150px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06);cursor:default}
        .org-dept-name{font-weight:600;font-size:13px;color:#111827;margin-bottom:4px}
        .org-manager{font-size:11px;color:#6b7280;margin-bottom:2px}
        .org-members{font-size:11px;color:#9ca3af}
        .org-children{display:flex;gap:20px;margin-top:16px;padding-top:16px;
          border-top:2px solid #e5e7eb;position:relative}
        .org-children::before{content:'';position:absolute;top:-10px;left:50%;
          transform:translateX(-50%);width:2px;height:10px;background:#e5e7eb}
        .org-company{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;
          border-radius:10px;padding:14px 20px;text-align:center;margin-bottom:24px;
          font-weight:700;font-size:15px}
      </style>
      <div class="org-company">🏢 Organograma da Empresa</div>`;

    if (!depts.length) {
      html += `<div class="empty-state"><p>Nenhum departamento criado ainda.</p>
        <button class="btn btn-primary btn-sm" onclick="switchDrawerTab('equipe',null)">Criar departamentos</button></div>`;
    } else {
      html += `<div class="org-root">${roots.map(d => buildNode(d, 0)).join('')}</div>`;
    }

    if (unassigned.length) {
      html += `<div style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:8px">
        <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:8px">Sem departamento (${unassigned.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${unassigned.map(m => `<span style="background:#e5e7eb;border-radius:20px;padding:4px 10px;font-size:12px">${escHtml(m.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    html += '</div>';
    body.innerHTML = html;
  }

  // ── Credores ──────────────────────────────────────────────────────────────────
  async function renderCreditors(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando credores...');
    const res = await fetch(`/api/admin/client/${currentClientId}/creditors`, { headers: authH() });
    const { creditors = [] } = res.ok ? await res.json() : {};

    const typeLabels = { bank:'Banco', supplier:'Fornecedor', tax:'Fiscal', judicial:'Judicial', other:'Outros' };
    const statusCls = { active:'badge-red', negotiating:'badge-amber', settled:'badge-green', written_off:'badge-gray' };
    const statusLabels = { active:'Em aberto', negotiating:'Negociando', settled:'Quitado', written_off:'Baixado' };

    const total = creditors.reduce((s, c) => s + (parseFloat(c.current_balance) || 0), 0);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:13px;color:#6b7280">Dívida total ativa</div>
          <div style="font-size:20px;font-weight:700;color:#dc2626">${total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="adminAddCreditor('${currentClientId}')">+ Credor</button>
      </div>`;

    if (!creditors.length) {
      html += `<div class="empty-state"><p>Nenhum credor cadastrado.</p></div>`;
    } else {
      html += `<div class="cdt-stack-list">
        ${creditors.map(c => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:600">${escHtml(c.name)}</div>
                <div style="font-size:12px;color:#6b7280">${typeLabels[c.creditor_type] || c.creditor_type}${c.document ? ' · ' + escHtml(c.document) : ''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-weight:600;color:#dc2626">${c.current_balance != null ? parseFloat(c.current_balance).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—'}</div>
                <span class="badge ${statusCls[c.status] || 'badge-gray'}">${statusLabels[c.status] || c.status}</span>
              </div>
            </div>
            ${c.due_date ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px">Vencimento: ${fmtDate(c.due_date)}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="btn btn-xs btn-outline" onclick="adminEditCreditor('${currentClientId}','${c.id}')">Editar</button>
              <button class="btn btn-xs btn-outline" onclick="adminCreditorDocs('${currentClientId}','${c.id}','${escHtml(c.name)}')">Docs</button>
              <button class="btn btn-xs btn-outline btn-danger" onclick="adminDeleteCreditor('${currentClientId}','${c.id}')">Excluir</button>
            </div>
          </div>`).join('')}
      </div>`;
    }
    body.innerHTML = html;
  }

  // ── Fornecedores ─────────────────────────────────────────────────────────────
  async function renderSuppliers(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando fornecedores...');
    const res = await fetch(`/api/admin/client/${currentClientId}/suppliers`, { headers: authH() });
    const { suppliers = [], contracts = [] } = res.ok ? await res.json() : {};

    const activeContracts = contracts.filter(c => c.status === 'active');
    const totalContractValue = activeContracts.reduce((s, c) => s + (c.value_cents || 0), 0);
    const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:13px;color:#6b7280">Contratos ativos</div>
          <div style="font-size:20px;font-weight:700;color:#1e3a5f">${fmtBRL(totalContractValue)}/mês</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="adminAddSupplier('${currentClientId}')">+ Fornecedor</button>
      </div>
      <div class="cdt-section-title">Fornecedores (${suppliers.length})</div>`;

    if (!suppliers.length) {
      html += `<div class="empty-state"><p>Nenhum fornecedor cadastrado.</p></div>`;
    } else {
      html += `<div class="cdt-stack-list">
        ${suppliers.map(s => {
          const sContracts = contracts.filter(c => c.supplier_id === s.id);
          return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px">
            <div style="display:flex;justify-content:space-between">
              <div>
                <div style="font-weight:600">${escHtml(s.name)}</div>
                <div style="font-size:12px;color:#6b7280">${escHtml(s.category || '—')}${s.document ? ' · ' + escHtml(s.document) : ''}</div>
              </div>
              <span class="badge ${s.status === 'active' ? 'badge-green' : 'badge-gray'}">${s.status === 'active' ? 'Ativo' : 'Inativo'}</span>
            </div>
            ${sContracts.length ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">${sContracts.length} contrato${sContracts.length !== 1 ? 's' : ''}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="btn btn-xs btn-outline" onclick="adminAddContract('${currentClientId}','${s.id}','${escHtml(s.name)}')">+ Contrato</button>
              <button class="btn btn-xs btn-outline" onclick="adminSupplierDocs('${currentClientId}','${s.id}','${escHtml(s.name)}')">Docs</button>
              <button class="btn btn-xs btn-outline btn-danger" onclick="adminDeleteSupplier('${currentClientId}','${s.id}')">Excluir</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="cdt-section-title" style="margin-top:16px">Contratos (${contracts.length})</div>
      ${contracts.length ? `<div class="cdt-stack-list">
        ${contracts.map(c => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:500">${escHtml(c.title)}</div>
                <div style="font-size:12px;color:#6b7280">${escHtml(supplierMap[c.supplier_id]?.name || '—')}</div>
              </div>
              <div style="text-align:right">
                ${c.value_cents ? `<div style="font-weight:600">${fmtBRL(c.value_cents)}</div>` : ''}
                <span class="badge ${c.status === 'active' ? 'badge-green' : c.status === 'expired' ? 'badge-red' : 'badge-gray'}">${c.status}</span>
              </div>
            </div>
            ${c.end_date ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px">Vigência até: ${fmtDate(c.end_date)}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="btn btn-xs btn-outline" onclick="adminContractDocs('${currentClientId}','${c.id}','${escHtml(c.title)}')">Docs</button>
              <button class="btn btn-xs btn-outline btn-danger" onclick="adminDeleteContract('${currentClientId}','${c.id}')">Excluir</button>
            </div>
          </div>`).join('')}
      </div>` : `<p style="font-size:13px;color:#9ca3af">Nenhum contrato cadastrado.</p>`}`;

    body.innerHTML = html;
  }

  // ── Funcionários ─────────────────────────────────────────────────────────────
  async function renderEmployees(context) {
    const { body, currentClientId } = context;
    body.innerHTML = tertiaryLoading('Carregando funcionários...');
    const res = await fetch(`/api/admin/client/${currentClientId}/employees`, { headers: authH() });
    const { employees = [], stats = {} } = res.ok ? await res.json() : {};

    const empTypeLabels = { clt:'CLT', pj:'PJ', estagio:'Estágio', autonomo:'Autônomo', socio:'Sócio' };
    const statusCls = { active:'badge-green', inactive:'badge-gray', terminated:'badge-red' };

    let html = `
      <div class="cdt-summary-grid" style="margin-bottom:12px">
        <div class="stat-card cdt-summary-card">
          <div class="stat-value cdt-summary-value">${stats.active || 0}</div>
          <div class="stat-label">Ativos</div>
        </div>
        <div class="stat-card cdt-summary-card">
          <div class="stat-value cdt-summary-value">${fmtBRL(stats.totalPayroll || 0)}</div>
          <div class="stat-label">Folha (salários)</div>
        </div>
        <div class="stat-card cdt-summary-card">
          <div class="stat-value cdt-summary-value">${fmtBRL(stats.totalCost || 0)}</div>
          <div class="stat-label">Custo total</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
        <button class="btn btn-primary btn-sm" onclick="adminAddEmployee('${currentClientId}')">+ Funcionário</button>
      </div>`;

    if (!employees.length) {
      html += `<div class="empty-state"><p>Nenhum funcionário cadastrado.</p></div>`;
    } else {
      html += `<div class="cdt-stack-list">
        ${employees.map(e => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:600">${escHtml(e.name)}</div>
                <div style="font-size:12px;color:#6b7280">
                  ${escHtml(e.job_title || '—')} · ${empTypeLabels[e.employment_type] || e.employment_type}
                  ${e.re_departments ? ' · ' + escHtml(e.re_departments.name) : ''}
                </div>
                ${e.admission_date ? `<div style="font-size:11px;color:#9ca3af">Admitido: ${fmtDate(e.admission_date)}</div>` : ''}
              </div>
              <div style="text-align:right">
                <div style="font-weight:600">${e.salary_cents ? fmtBRL(e.salary_cents) : '—'}</div>
                ${e.total_cost_cents ? `<div style="font-size:11px;color:#6b7280">Custo: ${fmtBRL(e.total_cost_cents)}</div>` : ''}
                <span class="badge ${statusCls[e.status] || 'badge-gray'}">${e.status === 'active' ? 'Ativo' : e.status === 'terminated' ? 'Desligado' : 'Inativo'}</span>
              </div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
              ${e.has_vale_transporte ? '<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:2px 6px">VT</span>' : ''}
              ${e.has_vale_refeicao ? '<span style="font-size:10px;background:#d1fae5;color:#065f46;border-radius:4px;padding:2px 6px">VR</span>' : ''}
              ${e.has_plano_saude ? '<span style="font-size:10px;background:#ede9fe;color:#5b21b6;border-radius:4px;padding:2px 6px">Saúde</span>' : ''}
            </div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="btn btn-xs btn-outline" onclick="adminEditEmployee('${currentClientId}','${e.id}')">Editar</button>
              <button class="btn btn-xs btn-outline" onclick="adminEmployeeDocs('${currentClientId}','${e.id}','${escHtml(e.name)}')">Docs</button>
              <button class="btn btn-xs btn-outline btn-danger" onclick="adminDeleteEmployee('${currentClientId}','${e.id}')">Excluir</button>
            </div>
          </div>`).join('')}
      </div>`;
    }
    body.innerHTML = html;
  }

  window.REAdminDrawerTertiaryTabs = {
    async render(tab, context) {
      if (tab === 'financeiro_client') { await renderFinancial(context); return true; }
      if (tab === 'equipe')            { await renderTeam(context);      return true; }
      if (tab === 'organograma')       { await renderOrgChart(context);  return true; }
      if (tab === 'credores')          { await renderCreditors(context); return true; }
      if (tab === 'fornecedores')      { await renderSuppliers(context); return true; }
      if (tab === 'funcionarios')      { await renderEmployees(context); return true; }
      return false;
    },
  };

console.info('[RE:admin-client-drawer-tabs-tertiary] loaded');
})();
