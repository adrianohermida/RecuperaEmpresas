'use strict';
/* dashboard-docs.js — Documentos: upload, listagem, remoção */

const DOC_STATUS_CLIENT = {
  pendente:          { label: 'Aguardando análise', cls: 'badge-gray'  },
  em_analise:        { label: 'Em análise',         cls: 'badge-blue'  },
  aprovado:          { label: 'Aprovado',           cls: 'badge-green' },
  reprovado:         { label: 'Reprovado',          cls: 'badge-red'   },
  ajuste_solicitado: { label: 'Ajuste solicitado',  cls: 'badge-amber' },
};

const DOC_TYPES_CLIENT = {
  dre: 'DRE', balanco: 'Balanço Patrimonial', fluxo_caixa: 'Fluxo de Caixa',
  contrato_social: 'Contrato Social', procuracao: 'Procuração',
  certidao: 'Certidão', extrato: 'Extrato Bancário',
  nota_fiscal: 'Nota Fiscal', outros: 'Outros',
};

let _selectedDocFile = null;

function toggleDocUploadForm() {
  const card     = document.getElementById('docUploadCard');
  const wasHidden = card.classList.contains('dashboard-hidden-card');
  card.classList.toggle('dashboard-hidden-card');
  if (!wasHidden) {
    _selectedDocFile = null;
    document.getElementById('docFileInput').value       = '';
    document.getElementById('docNameInput').value       = '';
    document.getElementById('docDropLabel').textContent = 'Clique ou arraste o arquivo aqui';
    document.getElementById('docSubmitBtn').disabled    = true;
    document.getElementById('docDropZone').classList.remove('dashboard-doc-dropzone-active');
  }
}

function handleDocFileSelect(input) {
  if (input.files && input.files[0]) {
    _selectedDocFile = input.files[0];
    document.getElementById('docDropLabel').textContent = _selectedDocFile.name;
    document.getElementById('docSubmitBtn').disabled    = false;
  }
}

function handleDocDragEnter(event) {
  event.preventDefault();
  document.getElementById('docDropZone').classList.add('dashboard-doc-dropzone-active');
}

function handleDocDragLeave() {
  document.getElementById('docDropZone').classList.remove('dashboard-doc-dropzone-active');
}

function handleDocDrop(event) {
  event.preventDefault();
  document.getElementById('docDropZone').classList.remove('dashboard-doc-dropzone-active');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  _selectedDocFile = file;
  document.getElementById('docDropLabel').textContent = file.name;
  document.getElementById('docSubmitBtn').disabled    = false;
}

async function submitDocument() {
  if (!_selectedDocFile) return;
  const btn = document.getElementById('docSubmitBtn');
  btn.disabled = true; btn.textContent = 'Enviando...';

  const formData = new FormData();
  formData.append('file', _selectedDocFile);
  formData.append('docType', document.getElementById('docTypeSelect').value);
  const name = document.getElementById('docNameInput').value.trim();
  if (name) formData.append('name', name);

  try {
    const res  = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData,
    });
    const json = await res.json();
    if (json.success) {
      showToast('Documento enviado com sucesso!', 'success');
      toggleDocUploadForm();
      loadDocuments();
    } else {
      showToast(json.error || 'Erro ao enviar.', 'error');
    }
  } catch {
    showToast('Erro de conexão.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}

async function deleteDocument(docId) {
  if (!confirm('Remover este documento?')) return;
  const res  = await fetch(`/api/documents/${docId}`, { method: 'DELETE', headers: authH() });
  const json = await res.json();
  if (json.success) { showToast('Documento removido.', 'success'); loadDocuments(); }
  else showToast(json.error || 'Não foi possível remover.', 'error');
}

async function loadDocuments() {
  const el = document.getElementById('docList');
  if (!el) return;
  el.innerHTML = '<div class="dashboard-section-loading">Carregando...</div>';

  const res = await fetch('/api/documents', { headers: authH() });
  if (!res.ok) { el.innerHTML = '<div class="empty-state"><p>Erro ao carregar documentos.</p></div>'; return; }

  const { documents } = await res.json();
  if (!documents.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Nenhum documento enviado. Clique em "Enviar documento" para começar.</p>
    </div>`;
    return;
  }

  el.innerHTML = documents.map(doc => {
    const st       = DOC_STATUS_CLIENT[doc.status] || DOC_STATUS_CLIENT.pendente;
    const tipo     = DOC_TYPES_CLIENT[doc.docType] || doc.docType;
    const date     = new Date(doc.createdAt).toLocaleDateString('pt-BR');
    const size     = doc.fileSize ? (doc.fileSize / 1024 < 1000
      ? (doc.fileSize / 1024).toFixed(0) + ' KB'
      : (doc.fileSize / 1048576).toFixed(1) + ' MB') : '';
    const canDelete = ['pendente', 'ajuste_solicitado'].includes(doc.status);
    const comments  = (doc.comments || []).filter(c => c.from === 'admin');

    return `<div class="dashboard-doc-item">
      <div class="dashboard-doc-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="dashboard-doc-copy">
        <div class="dashboard-doc-name">${doc.name}</div>
        <div class="dashboard-doc-meta">${tipo} &nbsp;·&nbsp; ${date}${size ? ' &nbsp;·&nbsp; ' + size : ''}</div>
        ${comments.length ? `<div class="dashboard-doc-comments">
          ${comments.map(c => `<div class="dashboard-doc-comment"><strong>Equipe:</strong> ${c.text}</div>`).join('')}
        </div>` : ''}
      </div>
      <div class="dashboard-doc-side">
        <span class="badge ${st.cls}">${st.label}</span>
        <div class="dashboard-doc-actions">
          <a href="${(window.RE_API_BASE || '').replace(/\/+$/, '')}/api/documents/${doc.id}/file?token=${getToken()}" target="_blank"
             class="dashboard-doc-link">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Baixar
          </a>
          ${canDelete ? `<button onclick="deleteDocument('${doc.id}')" class="dashboard-doc-delete">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remover
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}
