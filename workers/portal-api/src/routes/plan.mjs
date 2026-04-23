import { json, readJson, notFound, methodNotAllowed } from '../lib/http.mjs';

// BP-WK-02: Check chapter permissions before returning content
async function checkChapterPermission(sb, userId, chapterId, permissionType = 'view') {
  const { data, error } = await sb.from('re_plan_chapter_permissions')
    .select('permission_type, expires_at')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .in('permission_type', [permissionType, 'edit', 'approve'])
    .single();
  
  if (error || !data) return false;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return false;
  
  return true;
}

// BP-WK-01: Fetch comments from structured re_plan_comments table
async function getChapterComments(sb, userId, chapterId) {
  const { data, error } = await sb.from('re_plan_comments')
    .select('id, author_id, author_name, author_role, content, created_at, parent_comment_id')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  
  if (error || !data) return [];
  return data;
}

// Lê todos os capítulos de um cliente sem filtro de permissão (uso interno/admin)
async function readPlanRaw(sb, userId) {
  const { data: rows, error } = await sb.from('re_plan_chapters')
    .select('*')
    .eq('user_id', userId)
    .order('chapter_id');

  if (error || !rows || rows.length === 0) {
    return { chapters: [] };
  }

  const chapters = [];
  for (const row of rows) {
    const comments = await getChapterComments(sb, userId, row.chapter_id);
    chapters.push({
      id: row.chapter_id,
      title: row.title,
      status: row.status,
      visibility: row.visibility || 'private',
      content: row.content || '',
      comments,
      attachments: row.attachments || [],
      updatedAt: row.updated_at || null,
    });
  }
  return { chapters };
}

async function readPlan(sb, userId) {
  const { data: rows, error } = await sb.from('re_plan_chapters')
    .select('*')
    .eq('user_id', userId)
    .order('chapter_id');

  if (error || !rows || rows.length === 0) {
    return { chapters: [], error: 'Nenhum plano encontrado' };
  }

  // BP-WK-02: Filter chapters by visibility and permissions
  const chapters = [];
  for (const row of rows) {
    const hasPermission = row.visibility === 'public' || 
                         await checkChapterPermission(sb, userId, row.chapter_id, 'view');
    
    if (!hasPermission) continue;
    
    // BP-WK-01: Use structured comments from re_plan_comments table
    const comments = await getChapterComments(sb, userId, row.chapter_id);
    
    chapters.push({
      id: row.chapter_id,
      title: row.title,
      status: row.status,
      visibility: row.visibility || 'private',
      content: row.content || '',
      comments: comments,
      attachments: row.attachments || [],
    });
  }

  return { chapters };
}

export async function handlePlan(request, context) {
  if (request.method === 'GET') {
    return json(await readPlan(context.sb, context.user.id));
  }

  if (request.method !== 'PUT') {
    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  const chapterId = Number(context.params.id);
  const body = await readJson(request);
  const { clientAction, comment } = body;
  
  // BP-WK-02: Verify permission before allowing action
  const hasPermission = await checkChapterPermission(context.sb, context.user.id, chapterId, 'comment');
  if (!hasPermission) {
    return json({ error: 'Permissão negada para este capítulo.' }, { status: 403 });
  }
  
  const plan = await readPlan(context.sb, context.user.id);
  const chapter = plan.chapters.find((item) => item.id === chapterId);
  if (!chapter) return json({ error: 'Capítulo não encontrado.' }, { status: 404 });

  // BP-WK-01: Insert comment into structured re_plan_comments table
  if (comment) {
    const { error: commentError } = await context.sb.from('re_plan_comments').insert({
      user_id: context.user.id,
      chapter_id: chapterId,
      author_id: context.user.id,
      author_name: context.user.name || context.user.email,
      author_role: context.user.isAdmin ? 'consultor' : 'cliente',
      content: comment,
      created_at: new Date().toISOString(),
    });
    
    if (commentError) {
      return json({ error: 'Erro ao salvar comentário: ' + commentError.message }, { status: 500 });
    }
  }

  // Update chapter status if clientAction is provided
  if (clientAction) {
    const { error: updateError } = await context.sb.from('re_plan_chapters')
      .update({ client_action: clientAction, updated_at: new Date().toISOString() })
      .eq('user_id', context.user.id)
      .eq('chapter_id', chapterId);
    
    if (updateError) {
      return json({ error: 'Erro ao atualizar capítulo: ' + updateError.message }, { status: 500 });
    }
  }

  return json({ success: true });
}

// ─── Handler admin ────────────────────────────────────────────────────────────
// Rotas cobertas:
//   GET  /api/admin/plan/:clientId                                  → carregar plano completo
//   PUT  /api/admin/plan/:clientId/chapter/:chapterId               → salvar conteúdo
//   POST /api/admin/plan/:clientId/chapter/:chapterId/publish       → publicar capítulo
//   POST /api/admin/plan/:clientId/chapter/:chapterId/comment       → comentário do consultor
//   POST /api/admin/plan/:clientId/chapter/:chapterId/upload        → registrar anexo

export async function handleAdminPlan(request, context) {
  const { sb, user, params } = context;
  const { clientId, chapterId, action } = params;

  if (!clientId) return notFound();

  // GET /api/admin/plan/:clientId
  if (request.method === 'GET' && !chapterId) {
    const plan = await readPlanRaw(sb, clientId);
    return json(plan);
  }

  if (!chapterId) return notFound();

  const chapterIdNum = Number(chapterId);

  // PUT /api/admin/plan/:clientId/chapter/:chapterId — salvar conteúdo
  if (request.method === 'PUT' && !action) {
    const body = await readJson(request);
    const { content } = body;

    if (content === undefined) {
      return json({ error: 'Campo "content" obrigatório.' }, { status: 400 });
    }

    const { error } = await sb.from('re_plan_chapters')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('user_id', clientId)
      .eq('chapter_id', chapterIdNum);

    if (error) {
      return json({ error: 'Erro ao salvar capítulo: ' + error.message }, { status: 500 });
    }

    return json({ success: true });
  }

  // POST /api/admin/plan/:clientId/chapter/:chapterId/publish
  if (request.method === 'POST' && action === 'publish') {
    const { error } = await sb.from('re_plan_chapters')
      .update({ status: 'published', visibility: 'public', updated_at: new Date().toISOString() })
      .eq('user_id', clientId)
      .eq('chapter_id', chapterIdNum);

    if (error) {
      return json({ error: 'Erro ao publicar capítulo: ' + error.message }, { status: 500 });
    }

    return json({ success: true });
  }

  // POST /api/admin/plan/:clientId/chapter/:chapterId/comment
  if (request.method === 'POST' && action === 'comment') {
    const body = await readJson(request);
    const text = String(body.text || '').trim();

    if (!text) {
      return json({ error: 'Texto do comentário não pode ser vazio.' }, { status: 400 });
    }

    const { error: commentError } = await sb.from('re_plan_comments').insert({
      user_id: clientId,
      chapter_id: chapterIdNum,
      author_id: user.id,
      author_name: user.name || user.email,
      author_role: 'consultor',
      content: text,
      created_at: new Date().toISOString(),
    });

    if (commentError) {
      return json({ error: 'Erro ao salvar comentário: ' + commentError.message }, { status: 500 });
    }

    return json({ success: true });
  }

  // POST /api/admin/plan/:clientId/chapter/:chapterId/upload
  if (request.method === 'POST' && action === 'upload') {
    let fileName = null;
    let fileSize = 0;
    let mimeType = null;

    try {
      const form = await request.formData();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        fileName = file.name || 'arquivo';
        fileSize = Number(file.size || 0);
        mimeType = file.type || null;
      }
    } catch {
      return json({ error: 'Erro ao processar o arquivo enviado.' }, { status: 400 });
    }

    if (!fileName) {
      return json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    const { data: chapterRow, error: fetchError } = await sb.from('re_plan_chapters')
      .select('attachments')
      .eq('user_id', clientId)
      .eq('chapter_id', chapterIdNum)
      .single();

    if (fetchError || !chapterRow) {
      return json({ error: 'Capítulo não encontrado.' }, { status: 404 });
    }

    const attachments = Array.isArray(chapterRow.attachments) ? chapterRow.attachments : [];
    const newAttachment = {
      id: crypto.randomUUID(),
      name: fileName,
      size: fileSize,
      mime_type: mimeType,
      uploaded_at: new Date().toISOString(),
      uploaded_by: user.id,
      file_path: null,
    };
    attachments.push(newAttachment);

    const { error: updateError } = await sb.from('re_plan_chapters')
      .update({ attachments, updated_at: new Date().toISOString() })
      .eq('user_id', clientId)
      .eq('chapter_id', chapterIdNum);

    if (updateError) {
      return json({ error: 'Erro ao registrar anexo: ' + updateError.message }, { status: 500 });
    }

    return json({ success: true, attachment: newAttachment });
  }

  return notFound();
}