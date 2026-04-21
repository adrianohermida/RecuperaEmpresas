'use strict';

// ─── Utility helpers ──────────────────────────────────────────────────────────
(function () {
  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function closeModal(id) {
    if (window.REAdminModal?.closeById) {
      window.REAdminModal.closeById(id, 'admin-client-actions:close');
      return;
    }
    document.getElementById(id)?.remove();
  }

  function openModal(id, title, bodyHtml, footerHtml, size) {
    if (window.REAdminModal?.openDialog) {
      window.REAdminModal.openDialog({
        id,
        name: id,
        title,
        bodyHtml,
        footerHtml,
        size,
        source: 'admin-client-actions:open:' + id,
      });
      return;
    }
    closeModal(id);
  }

  function fmtBRL(cents) { return (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function fmtDate(d) { return d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '—'; }

  // ─── Re-render helper ─────────────────────────────────────────────────────────
  function rerenderTab(tab) { if (typeof renderDrawerTab === 'function') renderDrawerTab(tab); }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ENTITY DOCUMENTS (shared for member/creditor/supplier/contract/employee)
  // ═══════════════════════════════════════════════════════════════════════════════
  async function openEntityDocsModal(clientId, entityType, entityId, entityName) {
    openModal('entityDocsModal', `Documentos — ${esc(entityName)}`,
      `<div id="edocList" style="max-height:300px;overflow-y:auto;margin-bottom:16px">
        <div style="color:#9ca3af;font-size:13px">Carregando...</div>
      </div>
      <div style="border-top:1px solid #e5e7eb;padding-top:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px">Adicionar documento</div>
        <input id="edocName" class="form-control" placeholder="Nome do documento" style="margin-bottom:6px">
        <select id="edocType" class="form-control" style="margin-bottom:6px">
          <option value="outros">Outros</option>
          <option value="identidade">Identidade</option>
          <option value="contrato">Contrato</option>
          <option value="comprovante">Comprovante</option>
          <option value="certidao">Certidão</option>
          <option value="trabalhista">Trabalhista</option>
          <option value="fiscal">Fiscal</option>
        </select>
        <input id="edocDesc" class="form-control" placeholder="Descrição (opcional)" style="margin-bottom:6px">
        <input id="edocFile" type="file" class="form-control" style="margin-bottom:6px">
      </div>`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('entityDocsModal')">Fechar</button>
       <button class="btn-primary admin-modal-btn" onclick="uploadEntityDoc('${clientId}','${entityType}','${entityId}')">Enviar</button>`,
      'lg'
    );
    await loadEntityDocs(clientId, entityType, entityId);
  }

  async function loadEntityDocs(clientId, entityType, entityId) {
    const list = document.getElementById('edocList');
    if (!list) return;
    const res = await fetch(`/api/admin/client/${clientId}/entity-documents/${entityType}/${entityId}`, { headers: authH() });
    const { documents = [] } = res.ok ? await res.json() : {};
    if (!documents.length) { list.innerHTML = '<p style="color:#9ca3af;font-size:13px">Nenhum documento.</p>'; return; }
    list.innerHTML = documents.map(d => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${esc(d.name)}</div>
          <div style="font-size:11px;color:#6b7280">${esc(d.doc_type)} · ${fmtDate(d.created_at?.split('T')[0])}</div>
        </div>
        <a href="/api/entity-documents/${d.id}/file" target="_blank" class="btn btn-xs btn-outline">Ver</a>
        <button class="btn btn-xs btn-outline btn-danger" onclick="deleteEntityDoc('${clientId}','${entityType}','${entityId}','${d.id}')">×</button>
      </div>`).join('');
  }

  async function uploadEntityDoc(clientId, entityType, entityId) {
    const file = document.getElementById('edocFile')?.files[0];
    if (!file) { showToast('Selecione um arquivo.', 'error'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', document.getElementById('edocName')?.value.trim() || file.name);
    fd.append('doc_type', document.getElementById('edocType')?.value || 'outros');
    fd.append('description', document.getElementById('edocDesc')?.value.trim() || '');
    const res = await fetch(`/api/admin/client/${clientId}/entity-documents/${entityType}/${entityId}`, {
      method: 'POST', headers: { Authorization: authH().Authorization }, body: fd,
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro ao enviar.', 'error'); return; }
    showToast('Documento enviado!', 'success');
    document.getElementById('edocFile').value = '';
    document.getElementById('edocName').value = '';
    document.getElementById('edocDesc').value = '';
    await loadEntityDocs(clientId, entityType, entityId);
  }

  async function deleteEntityDoc(clientId, entityType, entityId, docId) {
    if (!confirm('Excluir documento?')) return;
    await fetch(`/api/entity-documents/${docId}`, { method: 'DELETE', headers: authH() });
    await loadEntityDocs(clientId, entityType, entityId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EQUIPE — invite + departments + toggle
  // ═══════════════════════════════════════════════════════════════════════════════
  async function adminInviteMember(clientId) {
    const name  = document.getElementById('inviteName')?.value.trim();
    const email = document.getElementById('inviteEmail')?.value.trim();
    const role  = document.getElementById('inviteRole')?.value || 'operacional';
    const dept  = document.getElementById('inviteDept')?.value || '';
    const job   = document.getElementById('inviteJobTitle')?.value.trim() || '';
    if (!name || !email) { showToast('Nome e e-mail são obrigatórios.', 'error'); return; }
    const res = await fetch(`/api/admin/client/${clientId}/members/invite`, {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ name, email, role, department_id: dept || null, job_title: job || null }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro ao convidar.', 'error'); return; }
    showToast('Convite enviado!', 'success');
    ['inviteName','inviteEmail','inviteJobTitle'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    rerenderTab('equipe');
  }

  async function adminAddDept(clientId) {
    openModal('deptModal', 'Novo Departamento',
      `<label style="font-size:13px;font-weight:500;margin-bottom:4px;display:block">Nome *</label>
       <input id="deptName" class="form-control" placeholder="Ex.: Financeiro" style="margin-bottom:10px">
       <label style="font-size:13px;font-weight:500;margin-bottom:4px;display:block">Cor</label>
       <input id="deptColor" type="color" value="#6366f1" style="height:36px;width:60px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer">`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('deptModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveDept('${clientId}',null)">Criar</button>`
    );
  }

  async function adminEditDept(clientId, deptId, currentName) {
    const res = await fetch(`/api/admin/client/${clientId}/departments`, { headers: authH() });
    const { departments = [] } = res.ok ? await res.json() : {};
    const dept = departments.find(d => d.id === deptId) || { name: currentName, color: '#6366f1' };
    openModal('deptModal', 'Editar Departamento',
      `<label style="font-size:13px;font-weight:500;margin-bottom:4px;display:block">Nome *</label>
       <input id="deptName" class="form-control" value="${esc(dept.name)}" style="margin-bottom:10px">
       <label style="font-size:13px;font-weight:500;margin-bottom:4px;display:block">Cor</label>
       <input id="deptColor" type="color" value="${esc(dept.color || '#6366f1')}" style="height:36px;width:60px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer">`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('deptModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveDept('${clientId}','${deptId}')">Salvar</button>`
    );
  }

  async function _saveDept(clientId, deptId) {
    const name  = document.getElementById('deptName')?.value.trim();
    const color = document.getElementById('deptColor')?.value || '#6366f1';
    if (!name) { showToast('Informe o nome.', 'error'); return; }
    const method = deptId ? 'PUT' : 'POST';
    const url = deptId
      ? `/api/admin/client/${clientId}/departments/${deptId}`
      : `/api/admin/client/${clientId}/departments`;
    const res = await fetch(url, { method, headers: authH(), body: JSON.stringify({ name, color }) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro.', 'error'); return; }
    showToast(deptId ? 'Departamento atualizado!' : 'Departamento criado!', 'success');
    closeModal('deptModal');
    rerenderTab('equipe');
  }

  async function adminDeleteDept(clientId, deptId) {
    if (!confirm('Excluir departamento? Membros vinculados perderão o vínculo.')) return;
    const res = await fetch(`/api/admin/client/${clientId}/departments/${deptId}`, { method: 'DELETE', headers: authH() });
    if (!res.ok) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Departamento excluído.', 'success');
    rerenderTab('equipe');
  }

  async function adminToggleMember(clientId, memberId, setActive) {
    const res = await fetch(`/api/admin/client/${clientId}/members/${memberId}`, {
      method: 'PUT', headers: authH(), body: JSON.stringify({ active: setActive }),
    });
    if (!res.ok) { showToast('Erro ao atualizar.', 'error'); return; }
    showToast(setActive ? 'Membro ativado.' : 'Membro desativado.', 'success');
    rerenderTab('equipe');
  }

  function adminMemberDocs(clientId, memberId, name) {
    openEntityDocsModal(clientId, 'member', memberId, name);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREDORES
  // ═══════════════════════════════════════════════════════════════════════════════
  function _creditorFormHtml(c) {
    c = c || {};
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Nome *</label>
          <input id="crName" class="form-control" value="${esc(c.name)}" placeholder="Razão social / nome">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">CNPJ / CPF</label>
          <input id="crDoc" class="form-control" value="${esc(c.document)}" placeholder="00.000.000/0001-00">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Tipo de credor</label>
          <select id="crType" class="form-control">
            ${['bank','supplier','tax','judicial','other'].map(t =>
              `<option value="${t}" ${c.creditor_type===t?'selected':''}>${{bank:'Banco',supplier:'Fornecedor',tax:'Fiscal',judicial:'Judicial',other:'Outros'}[t]}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Valor original (R$)</label>
          <input id="crOriginal" class="form-control" type="number" step="0.01" min="0" value="${c.original_amount ?? ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Saldo atual (R$)</label>
          <input id="crBalance" class="form-control" type="number" step="0.01" min="0" value="${c.current_balance ?? ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Taxa de juros (% a.m.)</label>
          <input id="crInterest" class="form-control" type="number" step="0.01" min="0" value="${c.interest_rate ?? ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Vencimento</label>
          <input id="crDue" class="form-control" type="date" value="${c.due_date ?? ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Status</label>
          <select id="crStatus" class="form-control">
            ${['active','negotiating','settled','written_off'].map(s =>
              `<option value="${s}" ${c.status===s?'selected':''}>${{active:'Em aberto',negotiating:'Negociando',settled:'Quitado',written_off:'Baixado'}[s]}</option>`
            ).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Número do processo (judicial)</label>
          <input id="crProcess" class="form-control" value="${esc(c.process_number)}" placeholder="Opcional">
        </div>
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Observações</label>
          <textarea id="crNotes" class="form-control" rows="2" placeholder="Detalhes adicionais...">${esc(c.notes)}</textarea>
        </div>
      </div>`;
  }

  function _creditorPayload() {
    return {
      name:            document.getElementById('crName')?.value.trim(),
      document:        document.getElementById('crDoc')?.value.trim() || null,
      creditor_type:   document.getElementById('crType')?.value || 'other',
      original_amount: parseFloat(document.getElementById('crOriginal')?.value) || null,
      current_balance: parseFloat(document.getElementById('crBalance')?.value) || null,
      interest_rate:   parseFloat(document.getElementById('crInterest')?.value) || null,
      due_date:        document.getElementById('crDue')?.value || null,
      status:          document.getElementById('crStatus')?.value || 'active',
      process_number:  document.getElementById('crProcess')?.value.trim() || null,
      notes:           document.getElementById('crNotes')?.value.trim() || null,
    };
  }

  async function adminAddCreditor(clientId) {
    openModal('creditorModal', 'Novo Credor', _creditorFormHtml(),
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('creditorModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveCreditor('${clientId}',null)">Criar</button>`, 'lg');
  }

  async function adminEditCreditor(clientId, creditorId) {
    const res = await fetch(`/api/admin/client/${clientId}/creditors`, { headers: authH() });
    const { creditors = [] } = res.ok ? await res.json() : {};
    const c = creditors.find(x => x.id === creditorId) || {};
    openModal('creditorModal', 'Editar Credor', _creditorFormHtml(c),
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('creditorModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveCreditor('${clientId}','${creditorId}')">Salvar</button>`, 'lg');
  }

  async function _saveCreditor(clientId, creditorId) {
    const payload = _creditorPayload();
    if (!payload.name) { showToast('Nome é obrigatório.', 'error'); return; }
    const method = creditorId ? 'PUT' : 'POST';
    const url = creditorId
      ? `/api/admin/client/${clientId}/creditors/${creditorId}`
      : `/api/admin/client/${clientId}/creditors`;
    const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro.', 'error'); return; }
    showToast(creditorId ? 'Credor atualizado!' : 'Credor criado!', 'success');
    closeModal('creditorModal');
    rerenderTab('credores');
  }

  function adminCreditorDocs(clientId, creditorId, name) {
    openEntityDocsModal(clientId, 'creditor', creditorId, name);
  }

  async function adminDeleteCreditor(clientId, creditorId) {
    if (!confirm('Excluir este credor e todos os seus dados?')) return;
    const res = await fetch(`/api/admin/client/${clientId}/creditors/${creditorId}`, { method: 'DELETE', headers: authH() });
    if (!res.ok) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Credor excluído.', 'success');
    rerenderTab('credores');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FORNECEDORES + CONTRATOS
  // ═══════════════════════════════════════════════════════════════════════════════
  function _supplierFormHtml(s) {
    s = s || {};
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Nome / razão social *</label>
          <input id="supName" class="form-control" value="${esc(s.name)}" placeholder="Nome do fornecedor">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">CNPJ / CPF</label>
          <input id="supDoc" class="form-control" value="${esc(s.document)}" placeholder="00.000.000/0001-00">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Categoria</label>
          <input id="supCategory" class="form-control" value="${esc(s.category)}" placeholder="Ex.: Tecnologia, Limpeza...">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">E-mail</label>
          <input id="supEmail" class="form-control" type="email" value="${esc(s.email)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Telefone</label>
          <input id="supPhone" class="form-control" value="${esc(s.phone)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Status</label>
          <select id="supStatus" class="form-control">
            <option value="active" ${s.status!=='inactive'?'selected':''}>Ativo</option>
            <option value="inactive" ${s.status==='inactive'?'selected':''}>Inativo</option>
          </select>
        </div>
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Observações</label>
          <textarea id="supNotes" class="form-control" rows="2">${esc(s.notes)}</textarea>
        </div>
      </div>`;
  }

  async function adminAddSupplier(clientId) {
    openModal('supplierModal', 'Novo Fornecedor', _supplierFormHtml(),
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('supplierModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveSupplier('${clientId}',null)">Criar</button>`, 'lg');
  }

  async function _saveSupplier(clientId, supplierId) {
    const payload = {
      name:     document.getElementById('supName')?.value.trim(),
      document: document.getElementById('supDoc')?.value.trim() || null,
      category: document.getElementById('supCategory')?.value.trim() || null,
      email:    document.getElementById('supEmail')?.value.trim() || null,
      phone:    document.getElementById('supPhone')?.value.trim() || null,
      status:   document.getElementById('supStatus')?.value || 'active',
      notes:    document.getElementById('supNotes')?.value.trim() || null,
    };
    if (!payload.name) { showToast('Nome é obrigatório.', 'error'); return; }
    const method = supplierId ? 'PUT' : 'POST';
    const url = supplierId
      ? `/api/admin/client/${clientId}/suppliers/${supplierId}`
      : `/api/admin/client/${clientId}/suppliers`;
    const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro.', 'error'); return; }
    showToast(supplierId ? 'Fornecedor atualizado!' : 'Fornecedor criado!', 'success');
    closeModal('supplierModal');
    rerenderTab('fornecedores');
  }

  async function adminDeleteSupplier(clientId, supplierId) {
    if (!confirm('Excluir este fornecedor e seus contratos?')) return;
    const res = await fetch(`/api/admin/client/${clientId}/suppliers/${supplierId}`, { method: 'DELETE', headers: authH() });
    if (!res.ok) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Fornecedor excluído.', 'success');
    rerenderTab('fornecedores');
  }

  function adminSupplierDocs(clientId, supplierId, name) {
    openEntityDocsModal(clientId, 'supplier', supplierId, name);
  }

  async function adminAddContract(clientId, supplierId, supplierName) {
    openModal('contractModal', `Novo Contrato — ${esc(supplierName)}`,
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Título / objeto *</label>
          <input id="ctTitle" class="form-control" placeholder="Ex.: Manutenção mensal">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Valor mensal (R$)</label>
          <input id="ctValue" class="form-control" type="number" step="0.01" min="0" placeholder="0,00">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Status</label>
          <select id="ctStatus" class="form-control">
            <option value="active">Vigente</option>
            <option value="pending">Pendente</option>
            <option value="expired">Encerrado</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Início</label>
          <input id="ctStart" class="form-control" type="date">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Fim</label>
          <input id="ctEnd" class="form-control" type="date">
        </div>
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Notas</label>
          <textarea id="ctNotes" class="form-control" rows="2"></textarea>
        </div>
      </div>`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('contractModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveContract('${clientId}','${supplierId}')">Criar</button>`, 'lg');
  }

  async function _saveContract(clientId, supplierId) {
    const title = document.getElementById('ctTitle')?.value.trim();
    if (!title) { showToast('Título é obrigatório.', 'error'); return; }
    const valueCents = Math.round((parseFloat(document.getElementById('ctValue')?.value) || 0) * 100);
    const payload = {
      supplier_id: supplierId,
      title,
      value_cents: valueCents || null,
      status:      document.getElementById('ctStatus')?.value || 'active',
      start_date:  document.getElementById('ctStart')?.value || null,
      end_date:    document.getElementById('ctEnd')?.value || null,
      notes:       document.getElementById('ctNotes')?.value.trim() || null,
    };
    const res = await fetch(`/api/admin/client/${clientId}/suppliers/${supplierId}/contracts`, {
      method: 'POST', headers: authH(), body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro.', 'error'); return; }
    showToast('Contrato criado!', 'success');
    closeModal('contractModal');
    rerenderTab('fornecedores');
  }

  function adminContractDocs(clientId, contractId, title) {
    openEntityDocsModal(clientId, 'contract', contractId, title);
  }

  async function adminDeleteContract(clientId, contractId) {
    if (!confirm('Excluir este contrato?')) return;
    const res = await fetch(`/api/admin/client/${clientId}/contracts/${contractId}`, { method: 'DELETE', headers: authH() });
    if (!res.ok) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Contrato excluído.', 'success');
    rerenderTab('fornecedores');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FUNCIONÁRIOS
  // ═══════════════════════════════════════════════════════════════════════════════
  async function _employeeFormHtml(clientId, e) {
    e = e || {};
    const deptsRes = await fetch(`/api/admin/client/${clientId}/departments`, { headers: authH() });
    const { departments: depts = [] } = deptsRes.ok ? await deptsRes.json() : {};
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:70vh;overflow-y:auto;padding-right:4px">
        <div style="grid-column:1/-1">
          <label style="font-size:12px;font-weight:500">Nome completo *</label>
          <input id="empName" class="form-control" value="${esc(e.name)}" placeholder="Nome do funcionário">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">CPF</label>
          <input id="empCpf" class="form-control" value="${esc(e.cpf)}" placeholder="000.000.000-00">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">E-mail</label>
          <input id="empEmail" class="form-control" type="email" value="${esc(e.email)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Cargo</label>
          <input id="empJob" class="form-control" value="${esc(e.job_title)}" placeholder="Ex.: Analista">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Departamento</label>
          <select id="empDept" class="form-control">
            <option value="">Sem departamento</option>
            ${depts.map(d => `<option value="${d.id}" ${e.department_id===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Tipo de contrato</label>
          <select id="empType" class="form-control">
            ${['clt','pj','estagio','autonomo','socio'].map(t =>
              `<option value="${t}" ${e.employment_type===t?'selected':''}>${{clt:'CLT',pj:'PJ',estagio:'Estágio',autonomo:'Autônomo',socio:'Sócio'}[t]}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Status</label>
          <select id="empStatus" class="form-control">
            <option value="active" ${e.status==='active'?'selected':''}>Ativo</option>
            <option value="inactive" ${e.status==='inactive'?'selected':''}>Inativo</option>
            <option value="terminated" ${e.status==='terminated'?'selected':''}>Desligado</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Admissão</label>
          <input id="empAdm" class="form-control" type="date" value="${e.admission_date ?? ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Desligamento</label>
          <input id="empTerm" class="form-control" type="date" value="${e.termination_date ?? ''}">
        </div>
        <div style="grid-column:1/-1;border-top:1px solid #e5e7eb;padding-top:10px;margin-top:4px;font-weight:600;font-size:13px">Remuneração e encargos</div>
        <div>
          <label style="font-size:12px;font-weight:500">Salário (R$)</label>
          <input id="empSalary" class="form-control" type="number" step="0.01" min="0" value="${e.salary_cents ? (e.salary_cents/100).toFixed(2) : ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Vale Transporte (R$/mês)</label>
          <input id="empVT" class="form-control" type="number" step="0.01" min="0" value="${e.vt_value_cents ? (e.vt_value_cents/100).toFixed(2) : ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Vale Refeição (R$/mês)</label>
          <input id="empVR" class="form-control" type="number" step="0.01" min="0" value="${e.vr_value_cents ? (e.vr_value_cents/100).toFixed(2) : ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Plano de Saúde (R$/mês)</label>
          <input id="empPS" class="form-control" type="number" step="0.01" min="0" value="${e.ps_value_cents ? (e.ps_value_cents/100).toFixed(2) : ''}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Plano Odonto (R$/mês)</label>
          <input id="empPO" class="form-control" type="number" step="0.01" min="0" value="${e.po_value_cents ? (e.po_value_cents/100).toFixed(2) : ''}">
        </div>
        <div style="grid-column:1/-1;display:flex;gap:20px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="empHasVT" ${e.has_vale_transporte?'checked':''}> Vale Transporte
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="empHasVR" ${e.has_vale_refeicao?'checked':''}> Vale Refeição
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="empHasPS" ${e.has_plano_saude?'checked':''}> Plano Saúde
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="empHasPO" ${e.has_plano_odonto?'checked':''}> Plano Odonto
          </label>
        </div>
      </div>`;
  }

  function _employeePayload() {
    const cents = id => Math.round((parseFloat(document.getElementById(id)?.value) || 0) * 100) || null;
    return {
      name:               document.getElementById('empName')?.value.trim(),
      cpf:                document.getElementById('empCpf')?.value.trim() || null,
      email:              document.getElementById('empEmail')?.value.trim() || null,
      job_title:          document.getElementById('empJob')?.value.trim() || null,
      department_id:      document.getElementById('empDept')?.value || null,
      employment_type:    document.getElementById('empType')?.value || 'clt',
      status:             document.getElementById('empStatus')?.value || 'active',
      admission_date:     document.getElementById('empAdm')?.value || null,
      termination_date:   document.getElementById('empTerm')?.value || null,
      salary_cents:       cents('empSalary'),
      vt_value_cents:     cents('empVT'),
      vr_value_cents:     cents('empVR'),
      ps_value_cents:     cents('empPS'),
      po_value_cents:     cents('empPO'),
      has_vale_transporte: document.getElementById('empHasVT')?.checked ?? false,
      has_vale_refeicao:   document.getElementById('empHasVR')?.checked ?? false,
      has_plano_saude:     document.getElementById('empHasPS')?.checked ?? false,
      has_plano_odonto:    document.getElementById('empHasPO')?.checked ?? false,
    };
  }

  async function adminAddEmployee(clientId) {
    const bodyHtml = await _employeeFormHtml(clientId, null);
    openModal('employeeModal', 'Novo Funcionário', bodyHtml,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('employeeModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveEmployee('${clientId}',null)">Criar</button>`, 'lg');
  }

  async function adminEditEmployee(clientId, employeeId) {
    const res = await fetch(`/api/admin/client/${clientId}/employees`, { headers: authH() });
    const { employees = [] } = res.ok ? await res.json() : {};
    const e = employees.find(x => x.id === employeeId) || {};
    const bodyHtml = await _employeeFormHtml(clientId, e);
    openModal('employeeModal', 'Editar Funcionário', bodyHtml,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('employeeModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_saveEmployee('${clientId}','${employeeId}')">Salvar</button>`, 'lg');
  }

  async function _saveEmployee(clientId, employeeId) {
    const payload = _employeePayload();
    if (!payload.name) { showToast('Nome é obrigatório.', 'error'); return; }
    const method = employeeId ? 'PUT' : 'POST';
    const url = employeeId
      ? `/api/admin/client/${clientId}/employees/${employeeId}`
      : `/api/admin/client/${clientId}/employees`;
    const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro.', 'error'); return; }
    showToast(employeeId ? 'Funcionário atualizado!' : 'Funcionário criado!', 'success');
    closeModal('employeeModal');
    rerenderTab('funcionarios');
  }

  function adminEmployeeDocs(clientId, employeeId, name) {
    openEntityDocsModal(clientId, 'employee', employeeId, name);
  }

  async function adminDeleteEmployee(clientId, employeeId) {
    if (!confirm('Excluir este funcionário?')) return;
    const res = await fetch(`/api/admin/client/${clientId}/employees/${employeeId}`, { method: 'DELETE', headers: authH() });
    if (!res.ok) { showToast('Erro ao excluir.', 'error'); return; }
    showToast('Funcionário excluído.', 'success');
    rerenderTab('funcionarios');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EDIT / DELETE CLIENT (LGPD)
  // ═══════════════════════════════════════════════════════════════════════════════
  async function adminEditClient(clientId) {
    // Fetch current client data
    const res = await fetch(`/api/admin/client/${clientId}`, { headers: authH() });
    if (!res.ok) { showToast('Erro ao carregar dados.', 'error'); return; }
    const data = await res.json();
    const c = data.client || data;

    openModal('editClientModal', 'Editar Cliente (LGPD)',
      `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
        <strong>Aviso LGPD:</strong> Alterações serão enviadas ao cliente por e-mail para confirmação antes de serem aplicadas.
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:500">Nome</label>
          <input id="ecName" class="form-control" value="${esc(c.name)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">E-mail</label>
          <input id="ecEmail" class="form-control" type="email" value="${esc(c.email)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Telefone</label>
          <input id="ecPhone" class="form-control" value="${esc(c.phone)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">CNPJ</label>
          <input id="ecCnpj" class="form-control" value="${esc(c.cnpj)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Razão social</label>
          <input id="ecRazao" class="form-control" value="${esc(c.razao_social)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500">Motivo da alteração</label>
          <textarea id="ecReason" class="form-control" rows="2" placeholder="Descreva brevemente o motivo (opcional)"></textarea>
        </div>
      </div>`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('editClientModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_submitEditClient('${clientId}')">Solicitar alteração</button>`,
      'lg'
    );
    // Store original data for diff
    window._editClientOriginal = { name: c.name, email: c.email, phone: c.phone, cnpj: c.cnpj, razao_social: c.razao_social };
  }

  async function _submitEditClient(clientId) {
    const orig = window._editClientOriginal || {};
    const current = {
      name:         document.getElementById('ecName')?.value.trim(),
      email:        document.getElementById('ecEmail')?.value.trim(),
      phone:        document.getElementById('ecPhone')?.value.trim() || null,
      cnpj:         document.getElementById('ecCnpj')?.value.trim() || null,
      razao_social: document.getElementById('ecRazao')?.value.trim() || null,
    };
    const reason = document.getElementById('ecReason')?.value.trim() || null;

    // Build field_changes: only changed fields
    const field_changes = {};
    Object.entries(current).forEach(([k, v]) => {
      if (v !== orig[k]) field_changes[k] = { from: orig[k] ?? null, to: v ?? null };
    });

    if (!Object.keys(field_changes).length) {
      showToast('Nenhuma alteração detectada.', 'error'); return;
    }

    const res = await fetch(`/api/admin/client/${clientId}/change-request`, {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ entity_type: 're_users', entity_id: clientId, field_changes, reason }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro ao enviar solicitação.', 'error'); return; }
    showToast('Solicitação enviada! O cliente receberá um e-mail para confirmar.', 'success');
    closeModal('editClientModal');
  }

  async function adminDeleteClient(clientId) {
    openModal('deleteClientModal', 'Excluir conta do cliente',
      `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin-bottom:14px;font-size:13px">
        <strong>Ação irreversível.</strong> Esta operação excluirá a conta e todos os dados do cliente.
        O cliente será notificado por e-mail conforme a LGPD.
      </div>
      <p style="font-size:13px;margin-bottom:10px">Digite <code>CONFIRMAR_EXCLUSAO</code> para confirmar:</p>
      <input id="deleteConfirmText" class="form-control" placeholder="CONFIRMAR_EXCLUSAO">`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('deleteClientModal')">Cancelar</button>
       <button class="btn btn-danger admin-modal-btn" onclick="_submitDeleteClient('${clientId}')">Excluir conta</button>`,
      'sm'
    );
  }

  async function _submitDeleteClient(clientId) {
    const text = document.getElementById('deleteConfirmText')?.value.trim();
    if (text !== 'CONFIRMAR_EXCLUSAO') {
      showToast('Digite o texto de confirmação exato.', 'error'); return;
    }
    const res = await fetch(`/api/admin/client/${clientId}`, {
      method: 'DELETE', headers: authH(),
      body: JSON.stringify({ confirm: 'CONFIRMAR_EXCLUSAO' }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro ao excluir.', 'error'); return; }
    showToast('Conta excluída com sucesso.', 'success');
    closeModal('deleteClientModal');
    if (typeof closeDrawer === 'function') closeDrawer();
    // Reload client list
    if (typeof loadAdminClients === 'function') loadAdminClients();
    else location.reload();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DOCUMENT REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  async function adminRequestDoc(clientId) {
    // Load suggestions based on onboarding data
    const [suggestRes, membersRes, creditorsRes, suppliersRes] = await Promise.all([
      fetch(`/api/admin/client/${clientId}/document-requests/suggestions`, { headers: authH() }),
      fetch(`/api/admin/client/${clientId}/members`, { headers: authH() }),
      fetch(`/api/admin/client/${clientId}/creditors`, { headers: authH() }),
      fetch(`/api/admin/client/${clientId}/suppliers`, { headers: authH() }),
    ]);
    const { suggestions = [] } = suggestRes.ok ? await suggestRes.json() : {};
    const { members = [] } = membersRes.ok ? await membersRes.json() : {};
    const { creditors = [] } = creditorsRes.ok ? await creditorsRes.json() : {};
    const { suppliers = [] } = suppliersRes.ok ? await suppliersRes.json() : {};

    // Group suggestions by priority
    const priority1 = suggestions.filter(s => s.priority === 1);
    const priority2 = suggestions.filter(s => s.priority === 2);

    const entityOptions = {
      company:  [{ id: '', label: 'Empresa' }],
      member:   members.map(m => ({ id: m.id, label: m.name })),
      creditor: creditors.map(c => ({ id: c.id, label: c.name })),
      supplier: suppliers.map(s => ({ id: s.id, label: s.name })),
    };

    const suggestHtml = (list, groupLabel) => list.length ? `
      <optgroup label="${groupLabel}">
        ${list.map((s, i) => `<option value="__s${i}_${groupLabel}" data-sug='${JSON.stringify(s).replace(/'/g,"&#39;")}'>${esc(s.name)} (${s.entity_type === 'company' ? 'Empresa' : esc(s.entity_label || s.entity_type)})</option>`).join('')}
      </optgroup>` : '';

    const docTypeOpts = [
      ['outros','Outros'], ['contrato_social','Contrato Social'], ['procuracao','Procuração'],
      ['certidao','Certidão'], ['balanco','Balanço Patrimonial'], ['dre','DRE'],
      ['fluxo_caixa','Fluxo de Caixa'], ['extrato','Extrato Bancário'], ['nota_fiscal','Nota Fiscal'],
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    const entTypeOpts = [
      ['company','Empresa'], ['member','Membro/Sócio'], ['creditor','Credor'],
      ['supplier','Fornecedor'], ['contract','Contrato'], ['employee','Funcionário'],
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    openModal('docReqModal', 'Solicitar documento',
      `<!-- Quick suggestions -->
       <div style="margin-bottom:14px">
         <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Sugestões baseadas no onboarding</label>
         <select id="drSuggestion" class="form-control" onchange="_applyDocSuggestion(this)">
           <option value="">— Selecionar sugestão (opcional) —</option>
           ${suggestHtml(priority1, 'Prioritários')}
           ${suggestHtml(priority2, 'Adicionais')}
         </select>
       </div>
       <div style="display:grid;gap:10px">
         <div>
           <label style="font-size:12px;font-weight:500">Nome do documento *</label>
           <input id="drName" class="form-control" placeholder="Ex.: Balanço Patrimonial 2023">
         </div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
           <div>
             <label style="font-size:12px;font-weight:500">Tipo</label>
             <select id="drDocType" class="form-control">${docTypeOpts}</select>
           </div>
           <div>
             <label style="font-size:12px;font-weight:500">Prazo</label>
             <input id="drDeadline" class="form-control" type="date">
           </div>
         </div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
           <div>
             <label style="font-size:12px;font-weight:500">Entidade relacionada</label>
             <select id="drEntType" class="form-control" onchange="_updateDocReqEntityPicker('${clientId}')">${entTypeOpts}</select>
           </div>
           <div id="drEntPickerWrap">
             <label style="font-size:12px;font-weight:500">Qual entidade</label>
             <select id="drEntId" class="form-control"><option value="">Empresa (geral)</option></select>
           </div>
         </div>
         <div>
           <label style="font-size:12px;font-weight:500">Instruções para o cliente</label>
           <textarea id="drDesc" class="form-control" rows="2" placeholder="Descreva o que deve ser enviado, período, etc."></textarea>
         </div>
       </div>`,
      `<button class="btn-ghost admin-modal-btn" onclick="closeModal('docReqModal')">Cancelar</button>
       <button class="btn-primary admin-modal-btn" onclick="_submitDocRequest('${clientId}')">Solicitar</button>`,
      'lg'
    );

    // Store entity options for dynamic picker
    window._docReqEntityOptions = entityOptions;
  }

  function _applyDocSuggestion(sel) {
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.dataset.sug) return;
    try {
      const s = JSON.parse(opt.dataset.sug.replace(/&#39;/g, "'"));
      const nameEl = document.getElementById('drName');
      const typeEl = document.getElementById('drDocType');
      const entTypeEl = document.getElementById('drEntType');
      if (nameEl) nameEl.value = s.name || '';
      if (typeEl) typeEl.value = s.doc_type || 'outros';
      if (entTypeEl) {
        entTypeEl.value = s.entity_type || 'company';
        entTypeEl.dispatchEvent(new Event('change'));
      }
      // Pre-fill entity_label in the picker if we have entity_id
      setTimeout(() => {
        const entIdEl = document.getElementById('drEntId');
        if (entIdEl && s.entity_id) {
          entIdEl.value = s.entity_id;
        }
      }, 50);
    } catch (e) { console.warn('suggestion parse error', e); }
  }

  function _updateDocReqEntityPicker(clientId) {
    const type = document.getElementById('drEntType')?.value || 'company';
    const wrap = document.getElementById('drEntPickerWrap');
    const opts = (window._docReqEntityOptions || {})[type] || [];
    if (!wrap) return;
    if (type === 'company' || !opts.length) {
      wrap.innerHTML = `<label style="font-size:12px;font-weight:500">Qual entidade</label>
        <select id="drEntId" class="form-control"><option value="">Empresa (geral)</option></select>`;
    } else {
      wrap.innerHTML = `<label style="font-size:12px;font-weight:500">Qual entidade</label>
        <select id="drEntId" class="form-control">
          <option value="">— Selecionar —</option>
          ${opts.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}
        </select>`;
    }
  }

  async function _submitDocRequest(clientId) {
    const name      = document.getElementById('drName')?.value.trim();
    const doc_type  = document.getElementById('drDocType')?.value || 'outros';
    const deadline  = document.getElementById('drDeadline')?.value || null;
    const desc      = document.getElementById('drDesc')?.value.trim() || null;
    const entType   = document.getElementById('drEntType')?.value || 'company';
    const entId     = document.getElementById('drEntId')?.value || null;
    const entOpts   = (window._docReqEntityOptions || {})[entType] || [];
    const entLabel  = entId ? (entOpts.find(o => o.id === entId)?.label || null) : null;
    if (!name) { showToast('Nome do documento é obrigatório.', 'error'); return; }

    const res = await fetch(`/api/admin/client/${clientId}/document-requests`, {
      method: 'POST', headers: authH(),
      body: JSON.stringify({
        name, doc_type, description: desc, deadline,
        entity_type: entType, entity_id: entId || null, entity_label: entLabel,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Erro ao solicitar.', 'error'); return; }
    showToast('Solicitação enviada ao cliente!', 'success');
    closeModal('docReqModal');
    rerenderTab('docs');
  }

  async function adminApproveDocReq(clientId, reqId) {
    const res = await fetch(`/api/admin/client/${clientId}/document-requests/${reqId}`, {
      method: 'PUT', headers: authH(), body: JSON.stringify({ status: 'approved' }),
    });
    if (!res.ok) { showToast('Erro ao aprovar.', 'error'); return; }
    showToast('Documento aprovado!', 'success');
    rerenderTab('docs');
  }

  async function adminRejectDocReq(clientId, reqId) {
    const notes = prompt('Motivo da rejeição (opcional):') ?? null;
    if (notes === null) return; // cancelled
    const res = await fetch(`/api/admin/client/${clientId}/document-requests/${reqId}`, {
      method: 'PUT', headers: authH(),
      body: JSON.stringify({ status: 'rejected', admin_notes: notes || null }),
    });
    if (!res.ok) { showToast('Erro ao rejeitar.', 'error'); return; }
    showToast('Documento rejeitado.', 'success');
    rerenderTab('docs');
  }

  async function adminCancelDocReq(clientId, reqId) {
    if (!confirm('Cancelar esta solicitação de documento?')) return;
    const res = await fetch(`/api/admin/client/${clientId}/document-requests/${reqId}`, {
      method: 'DELETE', headers: authH(),
    });
    if (!res.ok) { showToast('Erro ao cancelar.', 'error'); return; }
    showToast('Solicitação cancelada.', 'success');
    rerenderTab('docs');
  }

  // ─── Expose all functions globally ───────────────────────────────────────────
  Object.assign(window, {
    // internal
    closeModal,
    _saveDept,
    _saveCreditor,
    _saveSupplier,
    _saveContract,
    _saveEmployee,
    _submitEditClient,
    _submitDeleteClient,
    uploadEntityDoc,
    deleteEntityDoc,
    // public API
    adminInviteMember,
    adminAddDept,
    adminEditDept,
    adminDeleteDept,
    adminToggleMember,
    adminMemberDocs,
    adminAddCreditor,
    adminEditCreditor,
    adminCreditorDocs,
    adminDeleteCreditor,
    adminAddSupplier,
    adminDeleteSupplier,
    adminSupplierDocs,
    adminAddContract,
    adminContractDocs,
    adminDeleteContract,
    adminAddEmployee,
    adminEditEmployee,
    adminEmployeeDocs,
    adminDeleteEmployee,
    adminEditClient,
    adminDeleteClient,
    // document requests
    adminRequestDoc,
    _applyDocSuggestion,
    _updateDocReqEntityPicker,
    _submitDocRequest,
    adminApproveDocReq,
    adminRejectDocReq,
    adminCancelDocReq,
  });

console.info('[RE:admin-client-actions-extended] loaded');
})();
