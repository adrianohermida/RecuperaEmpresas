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

  const [docsRes, reqsRes] = await Promise.all([
    fetch('/api/documents', { headers: authH() }),
    fetch('/api/document-requests', { headers: authH() }),
  ]);
  if (!docsRes.ok) { el.innerHTML = '<div class="empty-state"><p>Erro ao carregar documentos.</p></div>'; return; }

  const { documents } = await docsRes.json();
  const { requests = [] } = reqsRes.ok ? await reqsRes.json() : {};

  const pendingReqs  = requests.filter(r => r.status === 'pending');
  const uploadedReqs = requests.filter(r => r.status === 'uploaded');

  let html = '';

  // ── Pending document requests (most prominent) ─────────────────────────────
  if (pendingReqs.length) {
    html += `<div class="dashboard-doc-requests-banner">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="font-weight:700;font-size:14px;color:#92400e">${pendingReqs.length} documento${pendingReqs.length > 1 ? 's' : ''} solicitado${pendingReqs.length > 1 ? 's' : ''} pelo consultor</span>
      </div>
      ${pendingReqs.map(r => {
        const ent = (r.entity_type && r.entity_type !== 'company' && r.entity_label)
          ? `<span class="dashboard-doc-req-entity">${{'member':'Membro','creditor':'Credor','supplier':'Fornecedor','contract':'Contrato','employee':'Funcionário'}[r.entity_type]||r.entity_type}: ${r.entity_label}</span>` : '';
        const deadline = r.deadline
          ? `<span style="font-size:11px;color:#dc2626;margin-left:6px">Prazo: ${new Date(r.deadline+'T12:00:00').toLocaleDateString('pt-BR')}</span>` : '';
        return `<div class="dashboard-doc-req-card">
          <div class="dashboard-doc-req-info">
            <div class="dashboard-doc-req-name">${r.name}</div>
            <div class="dashboard-doc-req-meta">${DOC_TYPES_CLIENT[r.doc_type] || r.doc_type}${ent}${deadline}</div>
            ${r.description ? `<div class="dashboard-doc-req-desc">${r.description}</div>` : ''}
          </div>
          <button class="dashboard-doc-req-btn" onclick="fulfillDocRequest('${r.id}','${r.name.replace(/'/g,"&#39;")}','${r.doc_type}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Enviar
          </button>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Uploaded (awaiting approval) ───────────────────────────────────────────
  if (uploadedReqs.length) {
    html += `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;margin-bottom:16px">
      <div style="font-weight:600;font-size:13px;color:#1d4ed8;margin-bottom:8px">Documentos enviados — aguardando revisão</div>
      ${uploadedReqs.map(r => `<div style="font-size:13px;color:#374151;padding:4px 0;border-bottom:1px solid #dbeafe">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" style="vertical-align:-1px"><polyline points="20 6 9 17 4 12"/></svg>
        ${r.name}
      </div>`).join('')}
    </div>`;
  }

  // ── Uploaded documents list ────────────────────────────────────────────────
  if (!documents.length && !pendingReqs.length) {
    html += `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Nenhum documento enviado. Clique em "Enviar documento" para começar.</p>
    </div>`;
  } else if (documents.length) {
    html += documents.map(doc => {
      const st       = DOC_STATUS_CLIENT[doc.status] || DOC_STATUS_CLIENT.pendente;
      const tipo     = DOC_TYPES_CLIENT[doc.docType] || doc.docType;
      const date     = new Date(doc.createdAt).toLocaleDateString('pt-BR');
      const size     = doc.fileSize ? (doc.fileSize / 1024 < 1000
        ? (doc.fileSize / 1024).toFixed(0) + ' KB'
        : (doc.fileSize / 1048576).toFixed(1) + ' MB') : '';
      const canDelete = ['pendente', 'ajuste_solicitado'].includes(doc.status);
      const comments  = (doc.comments || []).filter(c => c.from === 'admin');
      // Check if this doc was linked to a fulfilled request
      const linkedReq = requests.find(r => r.fulfilled_doc_id === doc.id);

      return `<div class="dashboard-doc-item">
        <div class="dashboard-doc-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="dashboard-doc-copy">
          <div class="dashboard-doc-name">${doc.name}</div>
          <div class="dashboard-doc-meta">${tipo} &nbsp;·&nbsp; ${date}${size ? ' &nbsp;·&nbsp; ' + size : ''}${linkedReq ? ' &nbsp;·&nbsp; <span style="color:#6366f1">Ref: ' + linkedReq.name + '</span>' : ''}</div>
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

  el.innerHTML = html;
}

// ── Fulfill a document request: inline upload linked to the request ────────────
function fulfillDocRequest(reqId, reqName, docType) {
  // Remove any existing modal
  document.getElementById('fulfillReqModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'fulfillReqModal';
  modal.className = 'admin-modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:460px">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px">Enviar documento</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px">${reqName}</div>
      <div style="margin-bottom:10px">
        <label style="font-size:12px;font-weight:500;display:block;margin-bottom:4px">Nome (opcional)</label>
        <input id="frName" class="form-control" placeholder="${reqName}">
      </div>
      <div id="frDropZone" style="border:2px dashed #d1d5db;border-radius:8px;padding:24px;text-align:center;cursor:pointer;margin-bottom:12px"
           onclick="document.getElementById('frFileInput').click()"
           ondragover="event.preventDefault()"
           ondrop="event.preventDefault();_frSetFile(event.dataTransfer.files[0])">
        <input type="file" id="frFileInput" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip"
               onchange="_frSetFile(this.files[0])">
        <div id="frFileLabel" style="font-size:13px;color:#6b7280">Clique ou arraste o arquivo aqui</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn-ghost admin-modal-btn" onclick="document.getElementById('fulfillReqModal').remove()">Cancelar</button>
        <button id="frSubmitBtn" class="btn-primary admin-modal-btn" onclick="_submitFulfillReq('${reqId}','${docType}')" disabled>Enviar</button>
      </div>
    </div>`;
  modal.addEventListener('mousedown', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

let _frFile = null;
function _frSetFile(file) {
  if (!file) return;
  _frFile = file;
  const lbl = document.getElementById('frFileLabel');
  const btn = document.getElementById('frSubmitBtn');
  if (lbl) lbl.textContent = file.name;
  if (btn) btn.disabled = false;
  const zone = document.getElementById('frDropZone');
  if (zone) zone.style.borderColor = '#6366f1';
}

async function _submitFulfillReq(reqId, docType) {
  if (!_frFile) return;
  const btn = document.getElementById('frSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  const name = document.getElementById('frName')?.value.trim() || _frFile.name;
  const fd = new FormData();
  fd.append('file', _frFile);
  fd.append('name', name);
  fd.append('docType', docType || 'outros');
  fd.append('request_id', reqId);

  try {
    const res  = await fetch('/api/documents/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd });
    const json = await res.json();
    if (json.success) {
      showToast('Documento enviado!', 'success');
      document.getElementById('fulfillReqModal')?.remove();
      _frFile = null;
      loadDocuments();
    } else {
      showToast(json.error || 'Erro ao enviar.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
    }
  } catch {
    showToast('Erro de conexão.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  }
}
