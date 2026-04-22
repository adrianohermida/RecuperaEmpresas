/**
 * Plan Comments UI Module
 * Interface de comentários colaborativos com threads para o Workspace e Portal.
 * 
 * Features:
 * - Renderização de threads de comentários
 * - Suporte a @mentions
 * - Edição e deleção de comentários
 * - Notificações de atividade
 */

'use strict';

// ─── Renderização de Thread de Comentários ─────────────────────────────────

function renderCommentThread(comments, container) {
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!comments || comments.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Nenhum comentário ainda.</p></div>';
    return;
  }

  comments.forEach(comment => {
    const commentEl = createCommentElement(comment);
    container.appendChild(commentEl);

    // Renderizar respostas
    if (comment.replies && comment.replies.length > 0) {
      const repliesContainer = document.createElement('div');
      repliesContainer.className = 'comment-replies';
      
      comment.replies.forEach(reply => {
        const replyEl = createCommentElement(reply, true);
        repliesContainer.appendChild(replyEl);
      });

      container.appendChild(repliesContainer);
    }
  });
}

function createCommentElement(comment, isReply = false) {
  const div = document.createElement('div');
  div.className = `comment-item${isReply ? ' comment-reply' : ''}`;
  div.dataset.commentId = comment.id;

  const authorRole = comment.author_role === 'consultor' ? '👤 Consultor' : '🏢 Cliente';
  const timestamp = new Date(comment.created_at).toLocaleString('pt-BR');
  const isEdited = comment.updated_at && new Date(comment.updated_at) > new Date(comment.created_at);

  div.innerHTML = `
    <div class="comment-header">
      <div class="comment-author">
        <strong>${comment.author_name}</strong>
        <span class="comment-role">${authorRole}</span>
      </div>
      <div class="comment-meta">
        <span class="comment-timestamp">${timestamp}</span>
        ${isEdited ? '<span class="comment-edited">(editado)</span>' : ''}
      </div>
    </div>
    <div class="comment-content">${escapeHtml(comment.content)}</div>
    <div class="comment-actions">
      <button class="btn-comment-reply" onclick="openReplyModal('${comment.id}')">Responder</button>
      ${canEditComment(comment) ? `<button class="btn-comment-edit" onclick="editComment('${comment.id}')">Editar</button>` : ''}
      ${canDeleteComment(comment) ? `<button class="btn-comment-delete" onclick="deleteComment('${comment.id}')">Deletar</button>` : ''}
    </div>
  `;

  return div;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ─── Ações de Comentários ──────────────────────────────────────────────────

async function addComment(userId, chapterId, content, parentCommentId = null) {
  if (!content || !content.trim()) {
    showToast('Por favor, digite um comentário.', 'warning');
    return;
  }

  try {
    showToast('Enviando comentário...', 'info');

    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/comments`, {
      method: 'POST',
      headers: authH(),
      body: JSON.stringify({
        content: content.trim(),
        parentCommentId: parentCommentId,
        mentions: extractMentions(content),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao enviar comentário');
    }

    showToast('Comentário enviado com sucesso!', 'success');
    loadChapterComments(userId, chapterId);
  } catch (err) {
    console.error('[plan-comments-ui] addComment:', err);
    showToast('Erro ao enviar comentário: ' + err.message, 'error');
  }
}

async function editComment(commentId) {
  const modal = document.getElementById('commentEditModal');
  if (!modal) {
    showToast('Modal não disponível.', 'error');
    return;
  }

  const commentEl = document.querySelector(`[data-comment-id="${commentId}"]`);
  if (!commentEl) return;

  const contentEl = commentEl.querySelector('.comment-content');
  const textareaEl = document.getElementById('commentEditText');

  if (textareaEl) {
    textareaEl.value = contentEl.textContent;
    textareaEl.dataset.commentId = commentId;
  }

  modal.classList.remove('hidden');
}

async function saveCommentEdit(commentId, newContent) {
  if (!newContent || !newContent.trim()) {
    showToast('Por favor, digite um comentário.', 'warning');
    return;
  }

  try {
    showToast('Salvando alterações...', 'info');

    const response = await fetch(`/api/admin/plan/${window._currentClientId}/chapter/${window._currentChapterId}/comments/${commentId}`, {
      method: 'PUT',
      headers: authH(),
      body: JSON.stringify({ content: newContent.trim() }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao atualizar comentário');
    }

    showToast('Comentário atualizado!', 'success');
    closeCommentEditModal();
    loadChapterComments(window._currentClientId, window._currentChapterId);
  } catch (err) {
    console.error('[plan-comments-ui] saveCommentEdit:', err);
    showToast('Erro ao atualizar comentário: ' + err.message, 'error');
  }
}

async function deleteComment(commentId) {
  if (!confirm('Tem certeza que deseja deletar este comentário?')) return;

  try {
    showToast('Deletando comentário...', 'info');

    const response = await fetch(`/api/admin/plan/${window._currentClientId}/chapter/${window._currentChapterId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: authH(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao deletar comentário');
    }

    showToast('Comentário deletado!', 'success');
    loadChapterComments(window._currentClientId, window._currentChapterId);
  } catch (err) {
    console.error('[plan-comments-ui] deleteComment:', err);
    showToast('Erro ao deletar comentário: ' + err.message, 'error');
  }
}

// ─── Permissões de Edição ──────────────────────────────────────────────────

function canEditComment(comment) {
  // Apenas o autor ou um consultor pode editar
  return comment.author_id === window._currentUserId || 
         ADMIN_EMAILS?.includes(window._currentUserEmail?.toLowerCase());
}

function canDeleteComment(comment) {
  // Apenas o autor ou um consultor pode deletar
  return comment.author_id === window._currentUserId || 
         ADMIN_EMAILS?.includes(window._currentUserEmail?.toLowerCase());
}

// ─── Carregamento de Comentários e Realtime ────────────────────────────────

let _commentsSubscription = null;

async function loadChapterComments(userId, chapterId) {
  try {
    // 1. Carregar histórico inicial
    const response = await fetch(`/api/admin/plan/${userId}/chapter/${chapterId}/comments`, {
      headers: authH(),
    });

    if (!response.ok) {
      console.error('Erro ao carregar comentários');
      return;
    }

    const data = await response.json();
    const container = document.getElementById('chapterCommentsContainer');
    
    if (container) {
      renderCommentThread(data.comments, container);
      container.scrollTop = container.scrollHeight;
    }

    // 2. Configurar Supabase Realtime para atualizações ao vivo
    setupCommentsRealtime(userId, chapterId);
  } catch (err) {
    console.error('[plan-comments-ui] loadChapterComments:', err);
  }
}

function setupCommentsRealtime(userId, chapterId) {
  // Limpar subscrição anterior se existir
  if (_commentsSubscription) {
    _commentsSubscription.unsubscribe();
  }

  if (!window.supabase) {
    console.warn('[plan-comments-ui] Supabase client não encontrado para Realtime.');
    return;
  }

  _commentsSubscription = window.supabase
    .channel(`plan_comments:${userId}:${chapterId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 're_plan_comments',
      filter: `user_id=eq.${userId} AND chapter_id=eq.${chapterId}`
    }, (payload) => {
      console.log('[Realtime] Mudança detectada:', payload);
      
      // Recarregar comentários para manter a estrutura de thread correta
      // Em uma implementação mais complexa, poderíamos atualizar apenas o item alterado
      loadChapterComments(userId, chapterId);
      
      // Notificar usuário se for uma nova mensagem de outra pessoa
      if (payload.eventType === 'INSERT' && payload.new.author_id !== window._currentUserId) {
        showToast(`Novo comentário de ${payload.new.author_name}`, 'info');
      }
    })
    .subscribe();
}

// ─── Mentions (@) ──────────────────────────────────────────────────────────

function extractMentions(text) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

function renderMentionSuggestions(text, container) {
  const lastWord = text.split(/\s/).pop();
  
  if (!lastWord.startsWith('@')) {
    if (container) container.innerHTML = '';
    return;
  }

  const query = lastWord.substring(1).toLowerCase();
  
  // TODO: Buscar usuários que correspondem à query
  // Por enquanto, apenas mostrar uma lista vazia
  if (container) {
    container.innerHTML = '<div class="mention-suggestion">Nenhum usuário encontrado</div>';
  }
}

// ─── Modais de Comentários ────────────────────────────────────────────────

function openReplyModal(parentCommentId) {
  const modal = document.getElementById('commentReplyModal');
  if (!modal) {
    showToast('Modal não disponível.', 'error');
    return;
  }

  const textareaEl = document.getElementById('commentReplyText');
  if (textareaEl) {
    textareaEl.value = '';
    textareaEl.dataset.parentCommentId = parentCommentId;
    textareaEl.focus();
  }

  modal.classList.remove('hidden');
}

function closeCommentReplyModal() {
  const modal = document.getElementById('commentReplyModal');
  if (modal) modal.classList.add('hidden');
}

function closeCommentEditModal() {
  const modal = document.getElementById('commentEditModal');
  if (modal) modal.classList.add('hidden');
}

async function submitCommentReply() {
  const textareaEl = document.getElementById('commentReplyText');
  const parentCommentId = textareaEl?.dataset.parentCommentId;
  const content = textareaEl?.value?.trim();

  if (!content) {
    showToast('Por favor, digite uma resposta.', 'warning');
    return;
  }

  await addComment(window._currentClientId, window._currentChapterId, content, parentCommentId);
  closeCommentReplyModal();
}

async function submitCommentEdit() {
  const textareaEl = document.getElementById('commentEditText');
  const commentId = textareaEl?.dataset.commentId;
  const content = textareaEl?.value?.trim();

  if (!content) {
    showToast('Por favor, digite um comentário.', 'warning');
    return;
  }

  await saveCommentEdit(commentId, content);
}

// ─── Exportar para uso global ──────────────────────────────────────────────

window.PlanCommentsUI = {
  renderCommentThread,
  addComment,
  editComment,
  deleteComment,
  loadChapterComments,
  openReplyModal,
  closeCommentReplyModal,
  submitCommentReply,
  submitCommentEdit,
};

console.info('[RE:plan-comments-ui] loaded');
