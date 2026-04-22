/**
 * Dashboard Plan Approval Module
 * Interface de visualização e aceite de capítulos do Business Plan para o cliente.
 * 
 * Features:
 * - Visualização de conteúdo publicado pelo consultor
 * - Botões de "Aprovar" e "Solicitar Revisão"
 * - Histórico de auditoria (timestamps)
 * - Integração com o sistema de comentários
 */

'use strict';

// ─── Renderização de Capítulos com Interface de Aprovação ────────────────────

function renderPlanWithApprovalFlow(chapters) {
  const list    = document.getElementById('chapterList');
  const preview = document.getElementById('planPreview');
  const hasContent = chapters.some(c => c.status !== 'pendente');

  if (!hasContent) {
    const emptyHtml = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>O Business Plan será elaborado após a conclusão do onboarding.</p>
    </div>`;
    if (list)    list.innerHTML    = emptyHtml;
    if (preview) preview.innerHTML = emptyHtml;
    return;
  }

  let html = '';
  let previewHtml = '<div class="chapter-list">';
  
  chapters.forEach(ch => {
    const st   = CHAPTER_STATUS[ch.status] || CHAPTER_STATUS.pendente;
    const done = ch.status === 'aprovado';
    const checkIcon = done
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
      : ch.id;
    
    // Botões de ação: aparecem apenas quando o capítulo está "aguardando" ou "em_revisao"
    const isAwaitingApproval = ch.status === 'aguardando' || ch.status === 'em_revisao';
    const actions = isAwaitingApproval
      ? `<div class="chapter-actions">
          <button class="btn-sm btn-sm-approve" onclick="approveChapter(${ch.id})">Aprovar</button>
          <button class="btn-sm btn-sm-comment" onclick="openCommentModal(${ch.id},'Comentário — ${ch.title.replace(/'/g, "\\'")}')">Comentar</button>
          <button class="btn-sm btn-sm-change" onclick="openRevisionModal(${ch.id},'Solicitar alteração — ${ch.title.replace(/'/g, "\\'")}')">Alterar</button>
        </div>` : '';
    
    html += `<div class="chapter-item">
      <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
      <div class="chapter-title">${ch.title}</div>
      <span class="badge ${st.cls}">${st.label}</span>
      ${actions}
    </div>`;
  });
  if (list) list.innerHTML = html;

  chapters.slice(0, 4).forEach(ch => {
    const st = CHAPTER_STATUS[ch.status] || CHAPTER_STATUS.pendente;
    const done = ch.status === 'aprovado';
    const checkIcon = done
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
      : ch.id;
    previewHtml += `<div class="chapter-item dashboard-chapter-preview-item">
      <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
      <div class="chapter-title">${ch.title}</div>
      <span class="badge ${st.cls}">${st.label}</span>
    </div>`;
  });
  previewHtml += '</div>';
  if (preview) preview.innerHTML = previewHtml;
}

// ─── Ações de Aprovação ────────────────────────────────────────────────────────

async function approveChapter(chapterId) {
  if (!confirm('Tem certeza que deseja aprovar este capítulo?')) return;

  try {
    showToast('Aprovando capítulo...', 'info');
    
    const response = await fetch(`/api/plan/chapter/${chapterId}/approve`, {
      method: 'POST',
      headers: authH(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao aprovar');
    }

    showToast('Capítulo aprovado com sucesso!', 'success');
    loadData(); // Recarregar dados
  } catch (err) {
    console.error('[dashboard-plan-approval] approveChapter:', err);
    showToast('Erro ao aprovar capítulo: ' + err.message, 'error');
  }
}

async function requestRevision(chapterId, reason) {
  if (!reason || !reason.trim()) {
    showToast('Por favor, descreva o motivo da revisão.', 'warning');
    return;
  }

  try {
    showToast('Enviando solicitação de revisão...', 'info');
    
    const response = await fetch(`/api/plan/chapter/${chapterId}/request-revision`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({ reason: reason.trim() }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao solicitar revisão');
    }

    showToast('Solicitação de revisão enviada!', 'success');
    closeRevisionModal();
    loadData(); // Recarregar dados
  } catch (err) {
    console.error('[dashboard-plan-approval] requestRevision:', err);
    showToast('Erro ao solicitar revisão: ' + err.message, 'error');
  }
}

// ─── Modal de Revisão (Extensão do Modal de Comentários) ───────────────────────

function openRevisionModal(chapterId, title) {
  const modal = document.getElementById('commentModal');
  const titleEl = document.getElementById('commentModalTitle');
  const textEl = document.getElementById('commentText');
  
  if (titleEl) titleEl.textContent = title || 'Solicitar alteração';
  if (textEl) textEl.value = '';
  if (textEl) textEl.placeholder = 'Descreva as alterações necessárias...';
  
  if (modal) {
    modal.classList.remove('dashboard-modal-hidden');
    modal.dataset.chapterId = chapterId;
    modal.dataset.isRevision = 'true';
    if (textEl) textEl.focus();
  }
}

function closeRevisionModal() {
  const modal = document.getElementById('commentModal');
  if (modal) {
    modal.classList.add('dashboard-modal-hidden');
    modal.dataset.isRevision = 'false';
  }
}

// ─── Override do submitComment para suportar revisões ────────────────────────

const originalSubmitComment = window.submitComment;
window.submitComment = async function() {
  const modal = document.getElementById('commentModal');
  const textEl = document.getElementById('commentText');
  const chapterId = parseInt(modal?.dataset.chapterId || 0);
  const isRevision = modal?.dataset.isRevision === 'true';
  const text = textEl?.value?.trim() || '';

  if (!text) {
    showToast('Por favor, digite um comentário.', 'warning');
    return;
  }

  if (isRevision) {
    await requestRevision(chapterId, text);
  } else if (originalSubmitComment) {
    originalSubmitComment();
  }
};

// ─── Histórico de Auditoria ────────────────────────────────────────────────────

async function loadChapterAuditHistory(chapterId) {
  try {
    const response = await fetch(`/api/plan/chapter/${chapterId}/audit-history`, {
      headers: authH(),
    });

    if (!response.ok) {
      console.error('Erro ao carregar histórico');
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error('[dashboard-plan-approval] loadChapterAuditHistory:', err);
    return null;
  }
}

function renderAuditTimeline(history) {
  if (!history || !history.timeline) return '';

  return `<div class="audit-timeline">
    <div class="audit-timeline-title">Histórico de Alterações</div>
    ${history.timeline.map(event => `
      <div class="audit-timeline-item">
        <div class="audit-timeline-dot"></div>
        <div class="audit-timeline-content">
          <div class="audit-timeline-event">${event.event}</div>
          <div class="audit-timeline-date">${new Date(event.ts).toLocaleString('pt-BR')}</div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

// ─── Exportar para uso global ──────────────────────────────────────────────────

window.DashboardPlanApproval = {
  renderPlanWithApprovalFlow,
  approveChapter,
  requestRevision,
  loadChapterAuditHistory,
  renderAuditTimeline,
};

console.info('[RE:dashboard-plan-approval] loaded');
