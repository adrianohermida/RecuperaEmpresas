'use strict';
const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { sb, UPLOADS_DIR, ADMIN_EMAILS, storage } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');

const DOC_TYPES = {
  dre:             'DRE (Demonstrativo de Resultado)',
  balanco:         'Balanço Patrimonial',
  fluxo_caixa:     'Fluxo de Caixa',
  contrato_social: 'Contrato Social',
  procuracao:      'Procuração',
  certidao:        'Certidão (CNPJ/Dívida)',
  extrato:         'Extrato Bancário',
  nota_fiscal:     'Nota Fiscal',
  outros:          'Outros',
};

const DOC_STATUS = {
  pendente:           { label: 'Pendente',           cls: 'badge-gray'   },
  em_analise:         { label: 'Em análise',         cls: 'badge-blue'   },
  aprovado:           { label: 'Aprovado',           cls: 'badge-green'  },
  reprovado:          { label: 'Reprovado',          cls: 'badge-red'    },
  ajuste_solicitado:  { label: 'Ajuste solicitado',  cls: 'badge-amber'  },
};

async function readDocuments(userId) {
  const { data } = await sb.from('re_documents')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return (data || []).map(d => ({
    id: d.id, userId: d.user_id, name: d.name, originalName: d.original_name,
    filePath: d.file_path, fileSize: d.file_size, mimeType: d.mime_type,
    docType: d.doc_type, status: d.status, comments: d.comments || [],
    createdAt: d.created_at, updatedAt: d.updated_at,
  }));
}

// Client: list own documents
router.get('/api/documents', requireAuth, async (req, res) => {
  const docs = await readDocuments(req.user.id);
  res.json({ documents: docs, docTypes: DOC_TYPES, docStatus: DOC_STATUS });
});

// Client: upload a document
const docUpload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (/^(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar)$/.test(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido.'));
  },
});

router.post('/api/documents/upload', requireAuth, docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const { docType = 'outros', name, request_id } = req.body;

  const docName = (name || req.file.originalname).trim().slice(0, 120);
  const { data: doc } = await sb.from('re_documents').insert({
    user_id:       req.user.id,
    name:          docName,
    original_name: req.file.originalname,
    file_path:     req.file.filename,
    file_size:     req.file.size,
    mime_type:     req.file.mimetype,
    doc_type:      docType,
    status:        'pendente',
    comments:      [],
    request_id:    request_id || null,
  }).select().single();

  // If upload is linked to a pending request, auto-fulfill it
  if (request_id && doc) {
    const cid = req.user.company_id || req.user.id;
    await sb.from('re_document_requests').update({
      status: 'uploaded', fulfilled_doc_id: doc.id,
      fulfilled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', request_id).eq('company_id', cid).eq('status', 'pending');
  }

  res.json({ success: true, document: doc });
});

// Serve document file (auth-gated — accepts ?token= for direct download links)
router.get('/api/documents/:docId/file', async (req, res, next) => {
  // Allow token via query param so browser <a href> downloads work
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  requireAuth(req, res, next);
}, async (req, res) => {
  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  // Only owner or admin can download
  if (doc.user_id !== req.user.id && !req.user.is_admin &&
      !ADMIN_EMAILS.includes((req.user.email||'').toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const filePath = path.join(UPLOADS_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });

  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

// Client: delete own document (only if pendente or ajuste_solicitado)
router.delete('/api/documents/:docId', requireAuth, async (req, res) => {
  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).eq('user_id', req.user.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (!['pendente','ajuste_solicitado'].includes(doc.status))
    return res.status(400).json({ error: 'Não é possível excluir um documento em análise ou aprovado.' });

  // Remove physical file
  const fp = path.join(UPLOADS_DIR, doc.file_path);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  await sb.from('re_documents').delete().eq('id', req.params.docId);
  res.json({ success: true });
});

// Admin: list all client documents
router.get('/api/admin/client/:id/documents', requireAdmin, async (req, res) => {
  const docs = await readDocuments(req.params.id);
  res.json({ documents: docs, docTypes: DOC_TYPES, docStatus: DOC_STATUS });
});

// Admin: update document status + optional comment
router.put('/api/admin/client/:id/documents/:docId', requireAdmin, async (req, res) => {
  const { status, comment } = req.body;
  if (!DOC_STATUS[status]) return res.status(400).json({ error: 'Status inválido.' });

  const { data: doc } = await sb.from('re_documents')
    .select('*').eq('id', req.params.docId).eq('user_id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  const comments = Array.isArray(doc.comments) ? [...doc.comments] : [];
  if (comment?.trim()) {
    comments.push({ from: 'admin', name: req.user.name || req.user.email, text: comment.trim(), ts: new Date().toISOString() });
  }

  await sb.from('re_documents')
    .update({ status, comments, updated_at: new Date().toISOString() })
    .eq('id', req.params.docId);

  res.json({ success: true });
});

module.exports = router;
