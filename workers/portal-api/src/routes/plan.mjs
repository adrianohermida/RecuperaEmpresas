import { json, readJson } from '../lib/http.mjs';

// BP-WK-03: Fetch chapter titles from database instead of hardcoding
async function getChapterTitles(sb) {
  const { data, error } = await sb.from('re_plan_chapters')
    .select('chapter_id, title')
    .limit(8);
  
  if (error || !data) return null;
  
  const titleMap = {};
  data.forEach(row => {
    titleMap[row.chapter_id] = row.title;
  });
  return titleMap;
}

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