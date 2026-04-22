# BP-FE-02: Proteção de URLs de Download de Anexos

## Problema Identificado
As URLs de download de anexos são previsíveis e não validam token de sessão de forma robusta no frontend antes de tentar o acesso, criando risco de acesso não autorizado a documentos anexos.

## Solução Implementada

### 1. Backend: Validação Robusta de Acesso (routes/admin-business-plan.js)

```javascript
// GET /api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId
router.get('/api/admin/plan/:userId/chapter/:chapterId/attachment/:attachmentId', requireAuth, async (req, res) => {
  // Validar acesso: apenas o cliente ou um consultor pode acessar
  if (req.user.id !== userId && !ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  
  // Validar que o arquivo pertence ao capítulo correto
  const attachment = await getChapterAttachment(userId, parseInt(chapterId), attachmentId);
  if (!attachment) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  
  // Retornar URL assinada (se usando S3) ou stream seguro
  res.json(attachment);
});
```

### 2. Frontend: Geração de URLs com Token (js/admin-business-plan.js)

```javascript
// Gerar URL de download com token de sessão
function getSecureDownloadUrl(userId, chapterId, attachmentId) {
  const token = window.REShared.getStoredToken();
  return `/api/admin/plan/${userId}/chapter/${chapterId}/attachment/${attachmentId}?token=${encodeURIComponent(token)}`;
}

// Usar em links de download
renderAttachments(attachments) {
  attachments.forEach(att => {
    const url = getSecureDownloadUrl(currentClientId, currentChapterId, att.id);
    const link = document.createElement('a');
    link.href = url;
    link.download = att.name;
    link.textContent = att.name;
    container.appendChild(link);
  });
}
```

### 3. Recomendação: Integração com S3/Supabase Storage

Para máxima segurança, implementar:

- **Presigned URLs**: Gerar URLs temporárias assinadas pelo backend (válidas por 15 minutos)
- **S3 Bucket Policies**: Restringir acesso apenas a URLs assinadas
- **Supabase Storage**: Usar RLS policies para validar acesso

```javascript
// Exemplo com Supabase Storage
async function getSecureAttachmentUrl(userId, chapterId, attachmentId) {
  const { data, error } = await sb.storage
    .from('business-plan-attachments')
    .createSignedUrl(`${userId}/${chapterId}/${attachmentId}`, 900); // 15 min
  
  if (error) throw error;
  return data.signedUrl;
}
```

## Status de Implementação
- ✅ Validação de acesso no backend
- ✅ Proteção de token no frontend
- ⏳ Integração com S3/Supabase Storage (próxima fase)

## Testes Recomendados
1. Tentar acessar anexo de outro cliente (deve falhar)
2. Tentar acessar anexo sem token (deve falhar)
3. Tentar acessar anexo com token expirado (deve falhar)
4. Acessar anexo próprio com token válido (deve funcionar)
