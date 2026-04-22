'use strict';
const router = require('express').Router();
const path = require('path');
const { requireAuth } = require('../lib/auth');
const { upload, UPLOADS_DIR } = require('../lib/config');
const { sb } = require('../lib/config');
const { ADMIN_EMAILS } = require('../lib/config');
const fs = require('fs').promises;

// Middleware: Verifica se o usuário é consultor (admin)
function requireConsultor(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado. Apenas consultores.' });
  }
  next();
}

// ─── POST /api/admin/plan/:userId/chapter/:chapterId/upload ──────────────────
// Upload de documentos para um capítulo do Business Plan.
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
      
      const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const filePath = req.file.path;
      
      // TODO: Fazer upload para S3 ou Supabase Storage
      // Por enquanto, apenas salvar metadados
      
      const attachment = {
        id: fileId,
        name: fileName,
        size: fileSize,
        type: req.file.mimetype,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.id,
        url: `/api/admin/plan/${userId}/chapter/${chapterId}/attachment/${fileId}/download`,
      };
      
      // Recuperar attachments existentes
      const { data: chapter } = await sb.from('re_plan_chapters')
        .select('attachments').eq('user_id', userId).eq('chapter_id', chapterId).single();
      
      const attachments = chapter?.attachments || [];
      attachments.push(attachment);
      
      // Atualizar capítulo com novo attachment
      await sb.from('re_plan_chapters').update({ attachments })
        .eq('user_id', userId).eq('chapter_id', chapterId);
      
      // Salvar arquivo no disco (ou S3)
      // TODO: Implementar persistência em S3
      
      res.json({
        success: true,
        attachment,
        message: 'Arquivo enviado com sucesso.',
      });
    } catch (err) {
      console.error('[admin-business-plan-upload] POST upload', err);
      res.status(500).json({ error: 'Erro ao fazer upload do arquivo.' });
    }
  }
);

// ─── GET /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId/download ──
// Download de um arquivo anexado.
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
      
      // TODO: Implementar download de S3 ou disco local
      // Por enquanto, retornar metadados
      
      res.json({
        success: true,
        attachment,
        message: 'Metadados do arquivo recuperados.',
      });
    } catch (err) {
      console.error('[admin-business-plan-upload] GET download', err);
      res.status(500).json({ error: 'Erro ao recuperar arquivo.' });
    }
  }
);

// ─── DELETE /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId ──
// Remover um arquivo anexado.
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
      
      const attachments = chapter.attachments.filter(a => a.id !== attachmentId);
      
      // Atualizar capítulo removendo o attachment
      await sb.from('re_plan_chapters').update({ attachments })
        .eq('user_id', userId).eq('chapter_id', chapterId);
      
      // TODO: Remover arquivo de S3 ou disco local
      
      res.json({ success: true, message: 'Arquivo removido.' });
    } catch (err) {
      console.error('[admin-business-plan-upload] DELETE attachment', err);
      res.status(500).json({ error: 'Erro ao remover arquivo.' });
    }
  }
);

module.exports = router;
