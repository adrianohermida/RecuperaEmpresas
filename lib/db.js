'use strict';
const { sb } = require('./config');

// ─── Supabase DB helpers ──────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const { data } = await sb.from('re_users').select('*')
    .ilike('email', email).limit(1).single();
  return data;
}
async function findUserById(id) {
  const { data } = await sb.from('re_users').select('*').eq('id', id).single();
  return data;
}
async function saveUser(user) {
  const { id, ...fields } = user;
  if (id) {
    await sb.from('re_users').upsert({ id, ...fields });
  } else {
    const { data } = await sb.from('re_users').insert(fields).select().single();
    return data;
  }
  return user;
}

async function readOnboarding(userId) {
  const { data } = await sb.from('re_onboarding').select('*').eq('user_id', userId).single();
  return data || { step: 1, status: 'nao_iniciado', completed: false, data: {} };
}
async function saveOnboarding(userId, payload) {
  const { step, status, completed, data: formData, last_activity, completedAt } = payload;
  await sb.from('re_onboarding').upsert({
    user_id:       userId,
    step:          step       ?? 1,
    status:        status     ?? 'nao_iniciado',
    completed:     completed  ?? false,
    data:          formData   ?? {},
    last_activity: last_activity ?? new Date().toISOString(),
    completed_at:  completedAt   ?? null,
  }, { onConflict: 'user_id' });
}

const PLAN_CHAPTERS = [
  { id: 1, title: 'Sumário Executivo' },
  { id: 2, title: 'Perfil da Empresa' },
  { id: 3, title: 'Análise do Setor e Mercado' },
  { id: 4, title: 'Diagnóstico Financeiro' },
  { id: 5, title: 'Análise de Endividamento' },
  { id: 6, title: 'Plano de Reestruturação Operacional' },
  { id: 7, title: 'Plano Financeiro e Projeções' },
  { id: 8, title: 'Cronograma e Gestão de Riscos' },
];

async function readPlan(userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).order('chapter_id');
  if (rows && rows.length > 0) {
    return { chapters: rows.map(r => ({
      id: r.chapter_id, title: r.title, status: r.status, comments: r.comments || []
    })) };
  }
  return { chapters: PLAN_CHAPTERS.map(c => ({ ...c, status: 'pendente', comments: [] })) };
}
async function saveChapterStatus(userId, chapterId, updates) {
  const chapter = PLAN_CHAPTERS.find(c => c.id === chapterId);
  const title   = chapter?.title || `Capítulo ${chapterId}`;
  await sb.from('re_plan_chapters').upsert({
    user_id: userId, chapter_id: chapterId, title, ...updates
  }, { onConflict: 'user_id,chapter_id' });
}

// ─── NEW: Business Plan Workspace Functions (Consultor) ──────────────────────

/**
 * Lê o plano completo de um cliente específico (para o consultor).
 * Retorna conteúdo, metadados e histórico de comentários.
 */
async function readPlanForConsultor(userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).order('chapter_id');
  if (rows && rows.length > 0) {
    return { chapters: rows.map(r => ({
      id: r.chapter_id,
      title: r.title,
      status: r.status,
      content: r.content || '',
      attachments: r.attachments || [],
      comments: r.comments || [],
      clientAction: r.client_action || 'pendente',
      lastEditorId: r.last_editor_id,
      updatedAt: r.updated_at,
    })) };
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

/**
 * Salva o conteúdo de um capítulo (redação pelo consultor).
 */
async function saveChapterContent(userId, chapterId, content, editorId, attachments = []) {
  const chapter = PLAN_CHAPTERS.find(c => c.id === chapterId);
  const title   = chapter?.title || `Capítulo ${chapterId}`;
  await sb.from('re_plan_chapters').upsert({
    user_id: userId,
    chapter_id: chapterId,
    title,
    content,
    last_editor_id: editorId,
    attachments: attachments,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,chapter_id' });
}

/**
 * Adiciona um comentário ao capítulo (thread de discussão).
 */
async function addChapterComment(userId, chapterId, commentText, fromUserId, fromName) {
  const { data: chapter } = await sb.from('re_plan_chapters')
    .select('comments').eq('user_id', userId).eq('chapter_id', chapterId).single();
  
  const comments = chapter?.comments || [];
  comments.push({
    id: Date.now().toString(),
    text: commentText,
    from: fromUserId,
    fromName: fromName,
    ts: new Date().toISOString(),
  });
  
  await sb.from('re_plan_chapters').update({ comments })
    .eq('user_id', userId).eq('chapter_id', chapterId);
}

/**
 * Atualiza o status de aprovação do capítulo (cliente).
 */
async function updateChapterClientAction(userId, chapterId, clientAction) {
  await sb.from('re_plan_chapters').update({ client_action: clientAction })
    .eq('user_id', userId).eq('chapter_id', chapterId);
}

/**
 * Retorna metadados de um arquivo anexado (para preview).
 */
async function getChapterAttachment(userId, chapterId, attachmentId) {
  const { data: chapter } = await sb.from('re_plan_chapters')
    .select('attachments').eq('user_id', userId).eq('chapter_id', chapterId).single();
  
  if (!chapter?.attachments) return null;
  return chapter.attachments.find(a => a.id === attachmentId);
}

// ─── NEW: Approval Flow Functions (Fase 2) ────────────────────────────────────

/**
 * Marca um capítulo como "pronto para aprovação" pelo consultor.
 * Status muda de 'em_elaboracao' para 'aguardando'.
 */
async function publishChapterForApproval(userId, chapterId, consultorId) {
  const chapter = PLAN_CHAPTERS.find(c => c.id === chapterId);
  const title   = chapter?.title || `Capítulo ${chapterId}`;
  
  const now = new Date().toISOString();
  
  await sb.from('re_plan_chapters').upsert({
    user_id: userId,
    chapter_id: chapterId,
    title,
    status: 'aguardando',
    client_action: 'pendente',
    last_editor_id: consultorId,
    updated_at: now,
    published_at: now, // Novo campo para auditoria
  }, { onConflict: 'user_id,chapter_id' });
}

/**
 * Cliente aprova um capítulo.
 * Status muda de 'aguardando' para 'aprovado'.
 */
async function approveChapter(userId, chapterId, clientId) {
  const now = new Date().toISOString();
  
  await sb.from('re_plan_chapters').update({
    status: 'aprovado',
    client_action: 'aprovado',
    approved_at: now,
    approved_by: clientId,
  }).eq('user_id', userId).eq('chapter_id', chapterId);
}

/**
 * Cliente solicita revisão de um capítulo.
 * Status muda de 'aguardando' para 'em_revisao'.
 */
async function requestChapterRevision(userId, chapterId, clientId, revisionReason) {
  const now = new Date().toISOString();
  
  const { data: chapter } = await sb.from('re_plan_chapters')
    .select('comments').eq('user_id', userId).eq('chapter_id', chapterId).single();
  
  const comments = chapter?.comments || [];
  comments.push({
    id: Date.now().toString(),
    text: revisionReason,
    from: clientId,
    fromName: 'Cliente',
    ts: now,
    type: 'revision_request',
  });
  
  await sb.from('re_plan_chapters').update({
    status: 'em_revisao',
    client_action: 'revisao_solicitada',
    comments: comments,
    revision_requested_at: now,
    revision_requested_by: clientId,
  }).eq('user_id', userId).eq('chapter_id', chapterId);
}

/**
 * Retorna o histórico de auditoria de um capítulo.
 */
async function getChapterAuditHistory(userId, chapterId) {
  const { data: chapter } = await sb.from('re_plan_chapters')
    .select('*').eq('user_id', userId).eq('chapter_id', chapterId).single();
  
  if (!chapter) return null;
  
  return {
    chapterId,
    title: chapter.title,
    status: chapter.status,
    timeline: [
      chapter.created_at && { event: 'Criado', ts: chapter.created_at, by: 'Sistema' },
      chapter.published_at && { event: 'Publicado para aprovação', ts: chapter.published_at, by: chapter.last_editor_id },
      chapter.approved_at && { event: 'Aprovado', ts: chapter.approved_at, by: chapter.approved_by },
      chapter.revision_requested_at && { event: 'Revisão solicitada', ts: chapter.revision_requested_at, by: chapter.revision_requested_by },
      chapter.updated_at && { event: 'Última atualização', ts: chapter.updated_at, by: chapter.last_editor_id },
    ].filter(Boolean),
  };
}

async function readTasks(userId) {
  const { data } = await sb.from('re_tasks').select('*')
    .eq('user_id', userId).order('created_at');
  return data || [];
}
async function upsertTask(task) {
  await sb.from('re_tasks').upsert(task);
}

async function readMessages(userId) {
  const { data } = await sb.from('re_messages').select('*')
    .eq('user_id', userId).order('ts');
  return data || [];
}
async function insertMessage(msg) {
  const { data } = await sb.from('re_messages').insert(msg).select().single();
  return data;
}

async function readAppointments(userId) {
  const { data } = await sb.from('re_appointments').select('*')
    .eq('user_id', userId).order('date');
  return data || [];
}
async function insertAppointment(appt) {
  const { data } = await sb.from('re_appointments').insert(appt).select().single();
  return data;
}
async function updateAppointment(id, updates) {
  await sb.from('re_appointments').update(updates).eq('id', id);
}

module.exports = {
  findUserByEmail,
  findUserById,
  saveUser,
  readOnboarding,
  saveOnboarding,
  PLAN_CHAPTERS,
  readPlan,
  saveChapterStatus,
  // Business Plan Workspace Functions
  readPlanForConsultor,
  saveChapterContent,
  addChapterComment,
  updateChapterClientAction,
  getChapterAttachment,
  // Approval Flow Functions (Fase 2)
  publishChapterForApproval,
  approveChapter,
  requestChapterRevision,
  getChapterAuditHistory,
  readTasks,
  upsertTask,
  readMessages,
  insertMessage,
  readAppointments,
  insertAppointment,
  updateAppointment,
};
