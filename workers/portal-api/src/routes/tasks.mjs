import { json, readJson } from '../lib/http.mjs';

export async function handleTasks(request, context) {
  if (request.method === 'GET') {
    const { data } = await context.sb.from('re_tasks')
      .select('*')
      .eq('user_id', context.user.id)
      .order('created_at');
    return json({ tasks: data || [] });
  }

  if (request.method !== 'PUT') {
    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  const body = await readJson(request);
  if (!body.status) return json({ error: 'status é obrigatório.' }, { status: 400 });

  const { data, error } = await context.sb.from('re_tasks')
    .update({ status: body.status })
    .eq('id', context.params.id)
    .eq('user_id', context.user.id)
    .select('id')
    .single();

  if (error || !data) return json({ error: 'Tarefa não encontrada.' }, { status: 404 });
  return json({ success: true });
}