/**
 * Plan Permissions Module
 * Controle de acesso e permissões para capítulos do Business Plan.
 * 
 * Features:
 * - Verificação de permissões antes de renderizar
 * - Gerenciamento de permissões por membro
 * - Controle de visibilidade (private, team, public)
 */

'use strict';

// ─── Verificação de Permissões ────────────────────────────────────────────

/**
 * Verifica se o usuário pode visualizar um capítulo.
 */
async function canViewChapter(userId, chapterId, memberId = null) {
  try {
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      headers: authH(),
    });

    if (!response.ok) {
      console.error('Erro ao verificar permissões');
      return false;
    }

    const data = await response.json();
    const permissions = data.permissions || [];

    // Verificar se há permissão de visualização
    const hasViewPermission = permissions.some(p => 
      p.permission_type === 'view' && 
      (!p.expires_at || new Date(p.expires_at) > new Date())
    );

    return hasViewPermission;
  } catch (err) {
    console.error('[plan-permissions] canViewChapter:', err);
    return false;
  }
}

/**
 * Verifica se o usuário pode comentar em um capítulo.
 */
async function canCommentChapter(userId, chapterId, memberId = null) {
  try {
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      headers: authH(),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const permissions = data.permissions || [];

    // Verificar se há permissão de comentário
    const hasCommentPermission = permissions.some(p => 
      (p.permission_type === 'comment' || p.permission_type === 'edit') && 
      (!p.expires_at || new Date(p.expires_at) > new Date())
    );

    return hasCommentPermission;
  } catch (err) {
    console.error('[plan-permissions] canCommentChapter:', err);
    return false;
  }
}

/**
 * Verifica se o usuário pode editar um capítulo.
 */
async function canEditChapter(userId, chapterId, memberId = null) {
  try {
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      headers: authH(),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const permissions = data.permissions || [];

    // Verificar se há permissão de edição
    const hasEditPermission = permissions.some(p => 
      p.permission_type === 'edit' && 
      (!p.expires_at || new Date(p.expires_at) > new Date())
    );

    return hasEditPermission;
  } catch (err) {
    console.error('[plan-permissions] canEditChapter:', err);
    return false;
  }
}

/**
 * Verifica se o usuário pode aprovar um capítulo.
 */
async function canApproveChapter(userId, chapterId, memberId = null) {
  try {
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      headers: authH(),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const permissions = data.permissions || [];

    // Verificar se há permissão de aprovação
    const hasApprovePermission = permissions.some(p => 
      p.permission_type === 'approve' && 
      (!p.expires_at || new Date(p.expires_at) > new Date())
    );

    return hasApprovePermission;
  } catch (err) {
    console.error('[plan-permissions] canApproveChapter:', err);
    return false;
  }
}

// ─── Gerenciamento de Permissões ──────────────────────────────────────────

/**
 * Concede permissão a um membro.
 */
async function grantPermission(userId, chapterId, memberId, permissionType, expiresAt = null) {
  try {
    showToast('Concedendo permissão...', 'info');

    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({
        memberId,
        permissionType,
        expiresAt,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao conceder permissão');
    }

    showToast('Permissão concedida com sucesso!', 'success');
    loadChapterPermissions(userId, chapterId);
  } catch (err) {
    console.error('[plan-permissions] grantPermission:', err);
    showToast('Erro ao conceder permissão: ' + err.message, 'error');
  }
}

/**
 * Remove permissão de um membro.
 */
async function revokePermission(userId, chapterId, memberId, permissionType) {
  if (!confirm('Tem certeza que deseja remover esta permissão?')) return;

  try {
    showToast('Removendo permissão...', 'info');

    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions/${memberId}`, {
      method: 'DELETE',
      headers: authH(),
      body: JSON.stringify({
        memberId,
        permissionType,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao remover permissão');
    }

    showToast('Permissão removida!', 'success');
    loadChapterPermissions(userId, chapterId);
  } catch (err) {
    console.error('[plan-permissions] revokePermission:', err);
    showToast('Erro ao remover permissão: ' + err.message, 'error');
  }
}

/**
 * Carrega e renderiza as permissões de um capítulo.
 */
async function loadChapterPermissions(userId, chapterId) {
  try {
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/permissions`, {
      headers: authH(),
    });

    if (!response.ok) {
      console.error('Erro ao carregar permissões');
      return;
    }

    const data = await response.json();
    const container = document.getElementById('chapterPermissionsContainer');

    if (container) {
      renderPermissionsList(data.permissions, userId, chapterId, container);
    }
  } catch (err) {
    console.error('[plan-permissions] loadChapterPermissions:', err);
  }
}

function renderPermissionsList(permissions, userId, chapterId, container) {
  if (!permissions || permissions.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Nenhuma permissão concedida.</p></div>';
    return;
  }

  const now = new Date();
  const html = permissions.map(perm => {
    const isExpired = perm.expires_at && new Date(perm.expires_at) < now;
    const expiresAt = perm.expires_at ? new Date(perm.expires_at).toLocaleDateString('pt-BR') : 'Sem expiração';

    return `
      <div class="permission-item${isExpired ? ' permission-expired' : ''}">
        <div class="permission-info">
          <div class="permission-member">${perm.member_id || 'Usuário'}</div>
          <div class="permission-type">
            <span class="badge badge-${perm.permission_type}">${perm.permission_type}</span>
          </div>
          <div class="permission-expires">Expira: ${expiresAt}</div>
        </div>
        <div class="permission-actions">
          ${!isExpired ? `
            <button class="btn-permission-revoke" onclick="revokePermission('${userId}', ${chapterId}, '${perm.member_id}', '${perm.permission_type}')">
              Remover
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="permissions-list">${html}</div>`;
}

// ─── Controle de Visibilidade ─────────────────────────────────────────────

/**
 * Atualiza a visibilidade de um capítulo.
 */
async function updateChapterVisibility(userId, chapterId, visibility, allowedMembers = []) {
  try {
    showToast('Atualizando visibilidade...', 'info');

    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/visibility`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({
        visibility,
        allowedMembers,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao atualizar visibilidade');
    }

    showToast('Visibilidade atualizada!', 'success');
  } catch (err) {
    console.error('[plan-permissions] updateChapterVisibility:', err);
    showToast('Erro ao atualizar visibilidade: ' + err.message, 'error');
  }
}

// ─── Modal de Permissões ───────────────────────────────────────────────────

function openPermissionModal(userId, chapterId) {
  const modal = document.getElementById('permissionModal');
  if (!modal) {
    showToast('Modal não disponível.', 'error');
    return;
  }

  modal.dataset.userId = userId;
  modal.dataset.chapterId = chapterId;
  modal.classList.remove('hidden');
}

function closePermissionModal() {
  const modal = document.getElementById('permissionModal');
  if (modal) modal.classList.add('hidden');
}

async function submitPermissionForm() {
  const modal = document.getElementById('permissionModal');
  const userIdEl = document.getElementById('permissionMemberId');
  const typeEl = document.getElementById('permissionType');
  const expiresEl = document.getElementById('permissionExpires');

  if (!userIdEl?.value || !typeEl?.value) {
    showToast('Por favor, preencha todos os campos.', 'warning');
    return;
  }

  const userId = modal?.dataset.userId;
  const chapterId = modal?.dataset.chapterId;

  await grantPermission(userId, chapterId, userIdEl.value, typeEl.value, expiresEl?.value || null);
  closePermissionModal();
}

// ─── Exportar para uso global ──────────────────────────────────────────────

window.PlanPermissions = {
  canViewChapter,
  canCommentChapter,
  canEditChapter,
  canApproveChapter,
  grantPermission,
  revokePermission,
  loadChapterPermissions,
  updateChapterVisibility,
  openPermissionModal,
  closePermissionModal,
  submitPermissionForm,
};

console.info('[RE:plan-permissions] loaded');
