/**
 * Admin Business Plan Module
 * Workspace do Consultor para redação, revisão e aprovação de capítulos do Business Plan.
 * 
 * Features:
 * - Seleção de cliente
 * - Editor de texto rico (Quill.js)
 * - Visualização de comentários
 * - Upload de documentos
 * - Histórico de edições
 */

'use strict';

let currentClientId = null;
let currentChapterId = null;
let quillEditor = null;
let planData = null;

// ─── Inicialização ───────────────────────────────────────────────────────────

async function initBusinessPlanModule() {
  console.log('[BusinessPlan] Inicializando módulo...');
  
  // Carregar Quill.js dinamicamente se não estiver carregado
  if (typeof Quill === 'undefined') {
    await loadQuillLibrary();
  }
  
  // Inicializar o editor Quill
  initializeQuillEditor();
  
  // Carregar lista de clientes
  await loadClientsList();
  
  // Configurar event listeners
  setupEventListeners();
  
  console.log('[BusinessPlan] Módulo inicializado com sucesso.');
}

// ─── Quill Editor Setup ───────────────────────────────────────────────────────

function loadQuillLibrary() {
  return new Promise((resolve, reject) => {
    // Quill CSS
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://cdn.quilljs.com/1.3.6/quill.snow.css';
    document.head.appendChild(cssLink);
    
    // Quill JS
    const script = document.createElement('script');
    script.src = 'https://cdn.quilljs.com/1.3.6/quill.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function initializeQuillEditor() {
  const editorContainer = document.getElementById('businessPlanEditor');
  if (!editorContainer) return;
  
  quillEditor = new Quill('#businessPlanEditor', {
    theme: 'snow',
    placeholder: 'Digite o conteúdo do capítulo aqui...',
    modules: {
      toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['link', 'image'],
        ['clean'],
      ]
    }
  });
  
  console.log('[BusinessPlan] Editor Quill inicializado.');
}

// ─── Carregamento de Dados ────────────────────────────────────────────────────

async function loadClientsList() {
  try {
    // TODO: Implementar endpoint para listar clientes do consultor
    // Por enquanto, usar dados mockados
    const clientsList = document.getElementById('businessPlanClientsList');
    if (!clientsList) return;
    
    clientsList.innerHTML = '<option value="">Selecione um cliente...</option>';
    clientsList.addEventListener('change', (e) => {
      currentClientId = e.target.value;
      if (currentClientId) {
        loadClientPlan(currentClientId);
      }
    });
    
    console.log('[BusinessPlan] Lista de clientes carregada.');
  } catch (err) {
    console.error('[BusinessPlan] Erro ao carregar clientes:', err);
    showNotification('Erro ao carregar clientes.', 'error');
  }
}

async function loadClientPlan(userId) {
  try {
    showNotification('Carregando plano...', 'info');
    
    const response = await fetch(`/api/admin/plan/${userId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    planData = await response.json();
    
    // Renderizar lista de capítulos
    renderChaptersList(planData.chapters);
    
    showNotification('Plano carregado com sucesso.', 'success');
  } catch (err) {
    console.error('[BusinessPlan] Erro ao carregar plano:', err);
    showNotification('Erro ao carregar plano do cliente.', 'error');
  }
}

function renderChaptersList(chapters) {
  const chaptersList = document.getElementById('businessPlanChaptersList');
  if (!chaptersList) return;
  
  chaptersList.innerHTML = '';
  
  chapters.forEach(chapter => {
    const statusClass = `status-${chapter.status}`;
    const statusLabel = getStatusLabel(chapter.status);
    
    const item = document.createElement('div');
    item.className = `business-plan-chapter-item ${statusClass}`;
    item.innerHTML = `
      <div class="chapter-header">
        <h4>${chapter.title}</h4>
        <span class="chapter-status">${statusLabel}</span>
      </div>
      <div class="chapter-meta">
        <small>Última atualização: ${formatDate(chapter.updatedAt)}</small>
      </div>
    `;
    
    item.addEventListener('click', () => {
      loadChapterContent(currentClientId, chapter.id);
    });
    
    chaptersList.appendChild(item);
  });
}

async function loadChapterContent(userId, chapterId) {
  try {
    currentChapterId = chapterId;
    
    // Encontrar o capítulo nos dados já carregados
    const chapter = planData.chapters.find(c => c.id === chapterId);
    if (!chapter) {
      showNotification('Capítulo não encontrado.', 'error');
      return;
    }
    
    // Carregar conteúdo no editor
    if (quillEditor) {
      quillEditor.setContents(JSON.parse(chapter.content || '{"ops":[]}'));
    }
    
    // Renderizar comentários
    renderComments(chapter.comments || []);
    
    // Renderizar anexos
    renderAttachments(chapter.attachments || []);
    
    // Atualizar UI
    updateChapterUI(chapter);
    
    showNotification('Capítulo carregado.', 'success');
  } catch (err) {
    console.error('[BusinessPlan] Erro ao carregar capítulo:', err);
    showNotification('Erro ao carregar capítulo.', 'error');
  }
}

// ─── Renderização de UI ───────────────────────────────────────────────────────

function updateChapterUI(chapter) {
  const chapterTitle = document.getElementById('businessPlanChapterTitle');
  const chapterStatus = document.getElementById('businessPlanChapterStatus');
  
  if (chapterTitle) chapterTitle.textContent = chapter.title;
  if (chapterStatus) chapterStatus.textContent = getStatusLabel(chapter.status);
}

function renderComments(comments) {
  const commentsList = document.getElementById('businessPlanCommentsList');
  if (!commentsList) return;
  
  commentsList.innerHTML = '';
  
  if (comments.length === 0) {
    commentsList.innerHTML = '<p class="no-comments">Nenhum comentário ainda.</p>';
    return;
  }
  
  comments.forEach(comment => {
    const item = document.createElement('div');
    item.className = 'business-plan-comment';
    item.innerHTML = `
      <div class="comment-header">
        <strong>${comment.fromName}</strong>
        <small>${formatDate(comment.ts)}</small>
      </div>
      <div class="comment-body">${escapeHtml(comment.text)}</div>
    `;
    commentsList.appendChild(item);
  });
}

function renderAttachments(attachments) {
  const attachmentsList = document.getElementById('businessPlanAttachmentsList');
  if (!attachmentsList) return;
  
  attachmentsList.innerHTML = '';
  
  if (attachments.length === 0) {
    attachmentsList.innerHTML = '<p class="no-attachments">Nenhum arquivo anexado.</p>';
    return;
  }
  
  attachments.forEach(attachment => {
    const item = document.createElement('div');
    item.className = 'business-plan-attachment';
    item.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>${attachment.name}</span>
      <small>${formatFileSize(attachment.size)}</small>
    `;
    
    item.addEventListener('click', () => {
      window.open(attachment.url, '_blank');
    });
    
    attachmentsList.appendChild(item);
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
  const saveBtn = document.getElementById('businessPlanSaveBtn');
  const publishBtn = document.getElementById('businessPlanPublishBtn');
  const addCommentBtn = document.getElementById('businessPlanAddCommentBtn');
  const uploadFileBtn = document.getElementById('businessPlanUploadFileBtn');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', saveChapterContent);
  }
  
  if (publishBtn) {
    publishBtn.addEventListener('click', publishChapter);
  }
  
  if (addCommentBtn) {
    addCommentBtn.addEventListener('click', addComment);
  }
  
  if (uploadFileBtn) {
    uploadFileBtn.addEventListener('click', () => {
      document.getElementById('businessPlanFileInput')?.click();
    });
  }
  
  const fileInput = document.getElementById('businessPlanFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }
}

// ─── Ações ────────────────────────────────────────────────────────────────────

async function saveChapterContent() {
  if (!currentClientId || !currentChapterId) {
    showNotification('Selecione um capítulo primeiro.', 'warning');
    return;
  }
  
  try {
    showNotification('Salvando...', 'info');
    
    const content = JSON.stringify(quillEditor.getContents());
    
    const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        attachments: planData.chapters.find(c => c.id === currentChapterId)?.attachments || [],
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    showNotification('Capítulo salvo com sucesso.', 'success');
  } catch (err) {
    console.error('[BusinessPlan] Erro ao salvar:', err);
    showNotification('Erro ao salvar capítulo.', 'error');
  }
}

async function publishChapter() {
  if (!currentClientId || !currentChapterId) {
    showNotification('Selecione um capítulo primeiro.', 'warning');
    return;
  }
  
  try {
    showNotification('Publicando para aprovação...', 'info');
    
    // Primeiro salvar o conteúdo
    await saveChapterContent();
    
    // Depois atualizar o status
    const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientAction: 'pendente' }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    showNotification('Capítulo publicado para aprovação do cliente.', 'success');
    
    // Recarregar dados
    await loadClientPlan(currentClientId);
  } catch (err) {
    console.error('[BusinessPlan] Erro ao publicar:', err);
    showNotification('Erro ao publicar capítulo.', 'error');
  }
}

async function addComment() {
  if (!currentClientId || !currentChapterId) {
    showNotification('Selecione um capítulo primeiro.', 'warning');
    return;
  }
  
  const commentInput = document.getElementById('businessPlanCommentInput');
  const comment = commentInput?.value?.trim();
  
  if (!comment) {
    showNotification('Digite um comentário.', 'warning');
    return;
  }
  
  try {
    showNotification('Adicionando comentário...', 'info');
    
    const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    if (commentInput) commentInput.value = '';
    
    showNotification('Comentário adicionado.', 'success');
    
    // Recarregar capítulo
    await loadClientPlan(currentClientId);
  } catch (err) {
    console.error('[BusinessPlan] Erro ao adicionar comentário:', err);
    showNotification('Erro ao adicionar comentário.', 'error');
  }
}

async function handleFileUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  // TODO: Implementar upload de arquivos
  showNotification('Upload de arquivos em desenvolvimento.', 'info');
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function getStatusLabel(status) {
  const labels = {
    'pendente': 'Pendente',
    'em_revisao': 'Em Revisão',
    'aprovado': 'Aprovado',
    'revisao_solicitada': 'Revisão Solicitada',
  };
  return labels[status] || status;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showNotification(message, type = 'info') {
  console.log(`[BusinessPlan] [${type.toUpperCase()}] ${message}`);
  // TODO: Integrar com sistema de notificações do portal
}

// ─── Exportar para uso global ──────────────────────────────────────────────────

window.BusinessPlanModule = {
  init: initBusinessPlanModule,
  loadClientPlan,
  loadChapterContent,
  saveChapterContent,
  publishChapter,
  addComment,
};
