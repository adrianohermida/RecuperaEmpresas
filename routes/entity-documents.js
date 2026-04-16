'use strict';
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { sb, storage } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');

const ALLOWED_ENTITY_TYPES = ['member', 'creditor', 'supplier', 'contract', 'employee'];

function companyId(user) { return user.company_id || user.id; }

const entityDocUpload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (/^(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip|rar|txt|csv)$/.test(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido.'));
  },
});

// ─── List documents for an entity ────────────────────────────────────────────
router.get('/api/entity-documents/:entityType/:entityId', requireAuth, async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Tipo de entidade inválido.' });
  const { data } = await sb.from('re_entity_documents')
    .select('*').eq('entity_type', entityType).eq('entity_id', entityId)
    .eq('company_id', companyId(req.user)).order('created_at', { ascending: false });
  res.json({ documents: data || [] });
});

// ─── Upload document for an entity ───────────────────────────────────────────
router.post('/api/entity-documents/:entityType/:entityId', requireAuth,
  entityDocUpload.single('file'), async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Tipo de entidade inválido.' });
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
  const { name, doc_type, description } = req.body;
  const docName = (name || req.file.originalname).trim().slice(0, 120);
  const cid = companyId(req.user);
  const { data, error } = await sb.from('re_entity_documents').insert({
    company_id: cid,
    entity_type: entityType,
    entity_id: entityId,
    name: docName,
    original_name: req.file.originalname,
    file_path: req.file.filename,
    file_size: req.file.size,
    mime_type: req.file.mimetype,
    doc_type: doc_type || 'outros',
    description: description?.trim() || null,
    uploaded_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, document: data });
});

// ─── Download an entity document ──────────────────────────────────────────────
router.get('/api/entity-documents/:id/file', requireAuth, async (req, res) => {
  const { UPLOADS_DIR } = require('../lib/config');
  const { data: doc } = await sb.from('re_entity_documents')
    .select('*').eq('id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (doc.company_id !== companyId(req.user) && !req.user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  const filePath = path.join(UPLOADS_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

// ─── Delete entity document ───────────────────────────────────────────────────
router.delete('/api/entity-documents/:id', requireAuth, async (req, res) => {
  const { UPLOADS_DIR } = require('../lib/config');
  const { data: doc } = await sb.from('re_entity_documents')
    .select('*').eq('id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (doc.company_id !== companyId(req.user) && !req.user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  const fp = path.join(UPLOADS_DIR, doc.file_path || '');
  if (doc.file_path && fs.existsSync(fp)) fs.unlinkSync(fp);
  await sb.from('re_entity_documents').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ─── Admin: list entity docs for a client's entity ────────────────────────────
router.get('/api/admin/client/:id/entity-documents/:entityType/:entityId', requireAdmin, async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Tipo inválido.' });
  const { data } = await sb.from('re_entity_documents')
    .select('*').eq('entity_type', entityType).eq('entity_id', entityId)
    .eq('company_id', req.params.id).order('created_at', { ascending: false });
  res.json({ documents: data || [] });
});

// ─── Admin: upload entity doc for a client ────────────────────────────────────
router.post('/api/admin/client/:id/entity-documents/:entityType/:entityId', requireAdmin,
  entityDocUpload.single('file'), async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Tipo inválido.' });
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
  const { name, doc_type, description } = req.body;
  const { data, error } = await sb.from('re_entity_documents').insert({
    company_id: req.params.id,
    entity_type: entityType, entity_id: entityId,
    name: (name || req.file.originalname).trim().slice(0, 120),
    original_name: req.file.originalname,
    file_path: req.file.filename,
    file_size: req.file.size,
    mime_type: req.file.mimetype,
    doc_type: doc_type || 'outros',
    description: description?.trim() || null,
    uploaded_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, document: data });
});

module.exports = router;
