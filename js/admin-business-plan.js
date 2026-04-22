/**
 * Admin Business Plan Module (Fixed)
 * Workspace do Consultor para redação, revisão e aprovação de capítulos do Business Plan.
 */

'use strict';

(function() {
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
      if (document.getElementById('quill-css')) return resolve();
      
      // Quill CSS
      const cssLink = document.createElement('link');
      cssLink.id = 'quill-css';
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
    if (!editorContainer || quillEditor) return;
    
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
      const clientsList = document.getElementById('businessPlanClientsList');
      if (!clientsList) return;
      
      // Usar o endpoint de clientes existente
      const response = await fetch('/api/admin/clients', { headers: authH() });
      const data = await readAdminResponse(response);
      
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar clientes');
      
      const clients = data.clients || [];
      
      clientsList.innerHTML = '<option value="">Selecione um cliente...</option>';
      clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = `${client.company || client.name} (${client.email})`;
        clientsList.appendChild(option);
      });

      // Remover listener antigo se existir e adicionar novo
      clientsList.onchange = (e) => {
        currentClientId = e.target.value;
        if (currentClientId) {
          loadClientPlan(currentClientId);
        } else {
          resetWorkspace();
        }
      };
      
      console.log('[BusinessPlan] Lista de clientes carregada:', clients.length);
    } catch (err) {
      console.error('[BusinessPlan] Erro ao carregar clientes:', err);
      showToast('Erro ao carregar clientes.', 'error');
    }
  }

  function resetWorkspace() {
    currentClientId = null;
    currentChapterId = null;
    planData = null;
    document.getElementById('businessPlanChaptersList').innerHTML = '';
    document.getElementById('businessPlanChapterTitle').textContent = 'Selecione um capítulo';
    document.getElementById('businessPlanChapterStatus').textContent = '—';
    if (quillEditor) quillEditor.setContents([]);
    document.getElementById('businessPlanCommentsList').innerHTML = '';
    document.getElementById('businessPlanAttachmentsList').innerHTML = '';
  }

  async function loadClientPlan(userId) {
    try {
      showToast('Carregando plano...', 'info');
      
      const response = await fetch(`/api/admin/plan/${userId}`, {
        method: 'GET',
        headers: authH(),
      });
      
      const data = await readAdminResponse(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      
      planData = data;
      
      // Renderizar lista de capítulos
      renderChaptersList(planData.chapters || []);
      
      showToast('Plano carregado com sucesso.', 'success');
    } catch (err) {
      console.error('[BusinessPlan] Erro ao carregar plano:', err);
      showToast('Erro ao carregar plano do cliente.', 'error');
    }
  }

  function renderChaptersList(chapters) {
    const chaptersList = document.getElementById('businessPlanChaptersList');
    if (!chaptersList) return;
    
    chaptersList.innerHTML = '';
    
    chapters.forEach(chapter => {
      const statusInfo = CHAPTER_STATUS[chapter.status] || { label: chapter.status, cls: 'badge-gray' };
      
      const item = document.createElement('div');
      item.className = `business-plan-chapter-item ${chapter.id === currentChapterId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="chapter-header">
          <h4>${chapter.title}</h4>
          <span class="badge ${statusInfo.cls}">${statusInfo.label}</span>
        </div>
        <div class="chapter-meta">
          <small>Atualizado: ${formatDate(chapter.updatedAt)}</small>
        </div>
      `;
      
      item.onclick = () => {
        // Remover active de outros
        document.querySelectorAll('.business-plan-chapter-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        loadChapterContent(currentClientId, chapter.id);
      };
      
      chaptersList.appendChild(item);
    });
  }

  async function loadChapterContent(userId, chapterId) {
    try {
      currentChapterId = chapterId;
      
      const chapter = planData.chapters.find(c => c.id === chapterId);
      if (!chapter) return;
      
      // BP-FE-04: Carregar conteúdo com tratamento de erros
      if (quillEditor) {
        try {
          if (!chapter.content || chapter.content.trim() === '') {
            quillEditor.setContents([]);
          } else {
            try {
              const content = JSON.parse(chapter.content);
              quillEditor.setContents(content);
            } catch (parseErr) {
              console.warn('[BusinessPlan] Conteúdo não é JSON válido, usando como HTML:', parseErr);
              quillEditor.root.innerHTML = chapter.content;
            }
          }
        } catch (e) {
          console.error('[BusinessPlan] Erro ao carregar conteúdo:', e);
          quillEditor.setContents([]);
          showToast('Aviso: Conteúdo corrompido. Editor vazio para evitar perda de dados.', 'warning');
        }
      }
      
      // BP-FE-01: Desabilitar editor se capítulo está aprovado ou em revisão
      const isEditable = chapter.status !== 'aprovado' && chapter.status !== 'em_revisao';
      if (quillEditor) {
        quillEditor.enable(isEditable);
        if (!isEditable) {
          showToast(`Capítulo em status "${chapter.status}" - edição desabilitada.`, 'info');
        }
      }
      
      // Renderizar comentários e anexos
      renderComments(chapter.comments || []);
      renderAttachments(chapter.attachments || []);
      
      // Atualizar UI
      document.getElementById('businessPlanChapterTitle').textContent = chapter.title;
      const statusInfo = CHAPTER_STATUS[chapter.status] || { label: chapter.status, cls: 'badge-gray' };
      const statusEl = document.getElementById('businessPlanChapterStatus');
      statusEl.textContent = statusInfo.label;
      statusEl.className = `chapter-status badge ${statusInfo.cls}`;
      
    } catch (err) {
      console.error('[BusinessPlan] Erro ao carregar capítulo:', err);
      showToast('Erro ao carregar capítulo.', 'error');
    }
  }

  // ─── Renderização de UI ───────────────────────────────────────────────────────

  function renderComments(comments) {
    const container = document.getElementById('businessPlanCommentsList');
    if (!container) return;
    container.innerHTML = comments.length ? '' : '<p class="no-comments">Nenhum comentário.</p>';
    
    comments.forEach(c => {
      const div = document.createElement('div');
      div.className = 'business-plan-comment';
      div.innerHTML = `
        <div class="comment-header">
          <strong>${c.fromName || 'Usuário'}</strong>
          <small>${formatDate(c.ts)}</small>
        </div>
        <div class="comment-body">${escapeHtml(c.text)}</div>
      `;
      container.appendChild(div);
    });
  }

  function renderAttachments(attachments) {
    const container = document.getElementById('businessPlanAttachmentsList');
    if (!container) return;
    container.innerHTML = attachments.length ? '' : '<p class="no-attachments">Nenhum anexo.</p>';
    
    attachments.forEach(a => {
      const div = document.createElement('div');
      div.className = 'business-plan-attachment';
      div.innerHTML = `<span>📎 ${a.name}</span><small>${formatFileSize(a.size)}</small>`;
      div.onclick = () => window.open(a.url, '_blank');
      container.appendChild(div);
    });
  }

  // ─── Ações ────────────────────────────────────────────────────────────────────

  async function saveChapterContent() {
    if (!currentClientId || !currentChapterId) return showToast('Selecione um capítulo.', 'warning');
    
    try {
      showToast('Salvando...', 'info');
      const content = JSON.stringify(quillEditor.getContents());
      
      const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}`, {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify({ content }),
      });
      
      if (response.ok) {
        showToast('Salvo com sucesso!', 'success');
        // Atualizar data local
        const chapter = planData.chapters.find(c => c.id === currentChapterId);
        if (chapter) {
          chapter.content = content;
          chapter.updatedAt = new Date().toISOString();
          renderChaptersList(planData.chapters);
        }
      } else {
        const err = await readAdminResponse(response);
        throw new Error(err.error || 'Erro ao salvar');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function publishChapter() {
    if (!currentClientId || !currentChapterId) return showToast('Selecione um capítulo.', 'warning');
    if (!confirm('Deseja publicar este capítulo para aprovação do cliente?')) return;

    try {
      showToast('Publicando...', 'info');
      const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}/publish`, {
        method: 'POST',
        headers: authH()
      });
      
      if (response.ok) {
        showToast('Publicado com sucesso!', 'success');
        loadClientPlan(currentClientId); // Recarregar tudo para atualizar status
      } else {
        const err = await readAdminResponse(response);
        throw new Error(err.error || 'Erro ao publicar');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function addComment() {
    const input = document.getElementById('businessPlanCommentInput');
    const text = input?.value.trim();
    if (!text || !currentClientId || !currentChapterId) return;

    try {
      const response = await fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}/comment`, {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify({ text })
      });

      if (response.ok) {
        input.value = '';
        loadChapterContent(currentClientId, currentChapterId);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentClientId || !currentChapterId) return;

    const formData = new FormData();
    formData.append('file', file);

    showToast('Enviando arquivo...', 'info');
    fetch(`/api/admin/plan/${currentClientId}/chapter/${currentChapterId}/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }, // FormData não usa Content-Type manual
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast('Arquivo enviado!', 'success');
        loadChapterContent(currentClientId, currentChapterId);
      } else {
        showToast(data.error || 'Erro no upload', 'error');
      }
    })
    .catch(err => showToast('Erro na conexão', 'error'));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function setupEventListeners() {
    document.getElementById('businessPlanSaveBtn')?.addEventListener('click', saveChapterContent);
    document.getElementById('businessPlanPublishBtn')?.addEventListener('click', publishChapter);
    document.getElementById('businessPlanAddCommentBtn')?.addEventListener('click', addComment);
    document.getElementById('businessPlanUploadFileBtn')?.addEventListener('click', () => document.getElementById('businessPlanFileInput').click());
    document.getElementById('businessPlanFileInput')?.addEventListener('change', handleFileUpload);
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, dm = 2, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Exportar para o escopo global
  window.initBusinessPlanModule = initBusinessPlanModule;

})();
