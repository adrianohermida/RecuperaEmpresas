'use strict';
const router = require('express').Router();
const path = require('path');
const { requireAuth } = require('../lib/auth');
const { upload, UPLOADS_DIR } = require('../lib/config');
const { sb } = require('../lib/config');
const { ADMIN_EMAILS } = require('../lib/config');
const fs = require('fs').promises;
const {
  uploadFile,
  generateSignedDownloadUrl,
  validateFileAccess,
  deleteFile,
  listChapterFiles,
} = require('../lib/storage-helpers');

// Middleware: Verifica se o usuário é consultor (admin)
function requireConsultor(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado. Apenas consultores.' });
  }
  next();
}

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/upload ──────────────────
// Upload de documentos para um capítulo do Business Plan (BP-BE-02).
router.post('/api/admin/plan/:userId/chapter/:chapterId/upload', 
  requireAuth, 
  requireConsultor, 
  upload.single('file'), 
  async (req, res) => {
    try {
      const { userId, chapterId } = req.params;
      
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo foi enviado.' });
      }
      
      // BP-BE-02: Upload para Supabase Storage
      const fileBuffer = await fs.readFile(req.file.path);
      const storageMetadata = await uploadFile(
        fileBuffer,
        userId,
        parseInt(chapterId),
        req.file.originalname,
        req.file.mimetype
      );
      
      const attachment = {
        id: storageMetadata.id,
        name: storageMetadata.name,
        size: storageMetadata.size,
        type: storageMetadata.type,
        storagePath: storageMetadata.storagePath,
        uploadedAt: storageMetadata.uploadedAt,
        uploadedBy: req.user.id,
      };
      
      // Recuperar attachments existentes
      const { data: chapter } = await sb.from('re_plan_chapters')
        .select('attachments').eq('user_id', userId).eq('chapter_id', chapterId).single();
      
      const attachments = chapter?.attachments || [];
      attachments.push(attachment);
      
      // Atualizar capítulo com novo attachment
      await sb.from('re_plan_chapters').update({ attachments })
        .eq('user_id', userId).eq('chapter_id', chapterId);
      
      // Limpar arquivo temporário
      await fs.unlink(req.file.path).catch(() => {});
      
      res.json({
        success: true,
        attachment,
        message: 'Arquivo enviado com sucesso.',
      });
    } catch (err) {
      console.error('[admin-business-plan-upload] POST upload', err);
      res.status(500).json({ error: err.message || 'Erro ao fazer upload do arquivo.' });
    }
  }
);

// ─── GET /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId/download ──
// Download de um arquivo anexado com URL assinada (BP-BE-02, BP-FE-02).
router.get('/api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId/download', 
  requireAuth, 
  async (req, res) => {
    try {
      const { userId, chapterId, attachmentId } = req.params;
      
      // Validar acesso
      if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
      
      // Recuperar metadados do attachment
      const { data: chapter } = await sb.from('re_plan_chapters')
        .select('attachments').eq('user_id', userId).eq('chapter_id', chapterId).single();
      
      if (!chapter?.attachments) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
      }
      
      const attachment = chapter.attachments.find(a => a.id === attachmentId);
      if (!attachment) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
      }
      
      // BP-BE-02 & BP-FE-02: Validar e gerar URL assinada
      const isValid = await validateFileAccess(userId, parseInt(chapterId), attachment.storagePath);
      if (!isValid) {
        return res.status(403).json({ error: 'Acesso ao arquivo negado.' });
      }
      
      // Gerar URL assinada com expiração de 1 hora
      const signedUrl = await generateSignedDownloadUrl(attachment.storagePath, 3600);
      
      res.json({
        success: true,
        attachment: {
          ...attachment,
          downloadUrl: signedUrl,
        },
      });
    } catch (err) {
      console.error('[admin-business-plan-upload] GET download', err);
      res.status(500).json({ error: err.message || 'Erro ao recuperar arquivo.' });
    }
  }
);

// ─── DELETE /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId ──
// Remover um arquivo anexado (BP-BE-02).
router.delete('/api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId', 
  requireAuth, 
  requireConsultor, 
  async (req, res) => {
    try {
      const { userId, chapterId, attachmentId } = req.params;
      
      // Recuperar attachments existentes
      const { data: chapter } = await sb.from('re_plan_chapters')
        .select('attachments').eq('user_id', userId).eq('chapter_id', chapterId).single();
      
      if (!chapter?.attachments) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
      }
      
      const attachment = chapter.attachments.find(a => a.id === attachmentId);
      if (!attachment) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
      }
      
      // BP-BE-02: Remover arquivo do Supabase Storage
      await deleteFile(attachment.storagePath);
      
      // Remover do array de attachments
      const attachments = chapter.attachments.filter(a => a.id !== attachmentId);
      
      // Atualizar capítulo removendo o attachment
      await sb.from('re_plan_chapters').update({ attachments })
        .eq('user_id', userId).eq('chapter_id', chapterId);
      
      res.json({ success: true, message: 'Arquivo removido.' });
    } catch (err) {
      console.error('[admin-business-plan-upload] DELETE attachment', err);
      res.status(500).json({ error: err.message || 'Erro ao remover arquivo.' });
    }
  }
);

module.exports = router;
