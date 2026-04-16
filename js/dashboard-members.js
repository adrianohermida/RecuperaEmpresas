'use strict';
/* dashboard-members.js — Equipe: membros da empresa */

const ROLE_LABELS = {
  financeiro:   'Financeiro',
  contador:     'Contador',
  operacional:  'Operacional',
  visualizador: 'Visualizador',
};
const ROLE_CLASSES = {
  financeiro:   'dashboard-member-role-financeiro',
  contador:     'dashboard-member-role-contador',
  operacional:  'dashboard-member-role-operacional',
  visualizador: 'dashboard-member-role-visualizador',
};

async function loadMembers() {
  const el = document.getElementById('membersList');
  if (!el) return;
  el.innerHTML = '<div class="dashboard-section-loading">Carregando...</div>';
  const res = await fetch('/api/company/members', { headers: authH() });
  const j   = await dashboardReadResponse(res);
  if (!res.ok) {
    el.innerHTML = `<div class="dashboard-inline-error">${j.error || 'Erro ao carregar equipe.'}</div>`;
    return;
  }
  const { members = [] } = j;
  if (!members.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <p>Nenhum membro cadastrado. Adicione o primeiro membro da equipe.</p>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="dashboard-member-list">
    ${members.map(m => `
    <div class="dashboard-member-item">
      <div class="dashboard-member-avatar ${ROLE_CLASSES[m.role] || 'dashboard-member-role-visualizador'}">
        ${(m.name || '?')[0].toUpperCase()}
      </div>
      <div class="dashboard-member-copy">
        <div class="dashboard-member-name">${m.name}</div>
        <div class="dashboard-member-email">${m.email}</div>
      </div>
      <span class="dashboard-member-role ${ROLE_CLASSES[m.role] || 'dashboard-member-role-visualizador'}">
        ${ROLE_LABELS[m.role] || m.role}
      </span>
      <span class="dashboard-member-status ${m.active ? 'dashboard-member-status-active' : 'dashboard-member-status-inactive'}">
        ${m.active ? 'Ativo' : 'Inativo'}
      </span>
      <div class="dashboard-member-actions">
        <button onclick="toggleMemberActive('${m.id}',${!m.active})" class="dashboard-member-action">
          ${m.active ? 'Desativar' : 'Ativar'}
        </button>
        <button onclick="removeMember('${m.id}','${m.name.replace(/'/g, "\\'")}')"
          class="dashboard-member-action dashboard-member-action-danger">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`).join('')}
  </div>`;
}

function toggleMemberForm() {
  const f = document.getElementById('memberForm');
  const willShow = f.classList.contains('dashboard-hidden-panel');
  f.classList.toggle('dashboard-hidden-panel');
  if (willShow) document.getElementById('memberName').focus();
}

async function addMember() {
  const name     = document.getElementById('memberName').value.trim();
  const email    = document.getElementById('memberEmail').value.trim();
  const role     = document.getElementById('memberRole').value;
  const password = document.getElementById('memberPassword').value;
  if (!name || !email || !password) { showToast('Preencha todos os campos obrigatórios.', 'error'); return; }
  if (password.length < 6) { showToast('Senha deve ter pelo menos 6 caracteres.', 'error'); return; }

  const res = await fetch('/api/company/members', {
    method: 'POST', headers: authH(),
    body: JSON.stringify({ name, email, role, password }),
  });
  const json = await dashboardReadResponse(res);
  if (res.ok) {
    showToast(`${name} adicionado com sucesso!`, 'success');
    document.getElementById('memberName').value     = '';
    document.getElementById('memberEmail').value    = '';
    document.getElementById('memberPassword').value = '';
    toggleMemberForm();
    loadMembers();
  } else {
    showToast(json.error || 'Erro ao adicionar membro.', 'error');
  }
}

async function toggleMemberActive(memberId, active) {
  const res = await fetch(`/api/company/members/${memberId}`, {
    method: 'PUT', headers: authH(),
    body: JSON.stringify({ active }),
  });
  if (res.ok) {
    showToast(active ? 'Membro ativado.' : 'Membro desativado.', 'success');
    loadMembers();
  } else {
    const j = await dashboardReadResponse(res);
    showToast(j.error || 'Erro.', 'error');
  }
}

async function removeMember(memberId, name) {
  if (!confirm(`Remover ${name} da equipe? Esta ação não pode ser desfeita.`)) return;
  const res = await fetch(`/api/company/members/${memberId}`, {
    method: 'DELETE', headers: authH(),
  });
  if (res.ok) {
    showToast('Membro removido.', 'success');
    loadMembers();
  } else {
    const j = await dashboardReadResponse(res);
    showToast(j.error || 'Erro ao remover.', 'error');
  }
}
console.info('[RE:dashboard-members] loaded');
