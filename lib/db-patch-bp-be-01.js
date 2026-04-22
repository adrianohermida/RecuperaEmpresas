// BP-BE-01 Patch: Refactor readPlan and readPlanForConsultor to use structured re_plan_comments table
// This file shows the refactored functions that should replace the existing ones in lib/db.js

async function readPlan(userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).order('chapter_id');
  
  if (rows && rows.length > 0) {
    const chapters = [];
    for (const r of rows) {
      // BP-BE-01 fix: Fetch comments from structured re_plan_comments table
      const { data: comments } = await sb.from('re_plan_comments')
        .select('id, author_id, author_name, author_role, content, created_at, parent_comment_id')
        .eq('user_id', userId)
        .eq('chapter_id', r.chapter_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      
      chapters.push({
        id: r.chapter_id,
        title: r.title,
        status: r.status,
        comments: comments || []
      });
    }
    return { chapters };
  }
  return { chapters: PLAN_CHAPTERS.map(c => ({ ...c, status: 'pendente', comments: [] })) };
}

async function readPlanForConsultor(userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).order('chapter_id');
  
  if (rows && rows.length > 0) {
    const chapters = [];
    for (const r of rows) {
      // BP-BE-01 fix: Fetch comments from structured re_plan_comments table
      const { data: comments } = await sb.from('re_plan_comments')
        .select('id, author_id, author_name, author_role, content, created_at, parent_comment_id')
        .eq('user_id', userId)
        .eq('chapter_id', r.chapter_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      
      chapters.push({
        id: r.chapter_id,
        title: r.title,
        status: r.status,
        content: r.content || '',
        attachments: r.attachments || [],
        comments: comments || [],
        clientAction: r.client_action || 'pendente',
        lastEditorId: r.last_editor_id,
        updatedAt: r.updated_at,
      });
    }
    return { chapters };
  }
  return { chapters: PLAN_CHAPTERS.map(c => ({
    ...c,
    status: 'pendente',
    content: '',
    attachments: [],
    comments: [],
    clientAction: 'pendente',
    lastEditorId: null,
    updatedAt: new Date().toISOString(),
  })) };
}

module.exports = { readPlan, readPlanForConsultor };
