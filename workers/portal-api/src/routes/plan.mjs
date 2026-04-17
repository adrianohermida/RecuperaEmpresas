import { json, readJson } from '../lib/http.mjs';

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

async function readPlan(sb, userId) {
  const { data: rows } = await sb.from('re_plan_chapters')
    .select('*')
    .eq('user_id', userId)
    .order('chapter_id');

  if (rows && rows.length > 0) {
    return {
      chapters: rows.map((row) => ({
        id: row.chapter_id,
        title: row.title,
        status: row.status,
        comments: row.comments || [],
      })),
    };
  }

  return { chapters: PLAN_CHAPTERS.map((chapter) => ({ ...chapter, status: 'pendente', comments: [] })) };
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
  const plan = await readPlan(context.sb, context.user.id);
  const chapter = plan.chapters.find((item) => item.id === chapterId);
  if (!chapter) return json({ error: 'Capítulo não encontrado.' }, { status: 404 });

  const updates = {};
  if (clientAction) updates.client_action = clientAction;
  if (comment) {
    updates.comments = [
      ...(chapter.comments || []),
      {
        text: comment,
        from: 'client',
        fromName: context.user.name || context.user.email,
        ts: new Date().toISOString(),
      },
    ];
  }

  const chapterMeta = PLAN_CHAPTERS.find((item) => item.id === chapterId);
  await context.sb.from('re_plan_chapters').upsert(
    {
      user_id: context.user.id,
      chapter_id: chapterId,
      title: chapterMeta?.title || `Capítulo ${chapterId}`,
      ...updates,
    },
    { onConflict: 'user_id,chapter_id' }
  );

  return json({ success: true });
}