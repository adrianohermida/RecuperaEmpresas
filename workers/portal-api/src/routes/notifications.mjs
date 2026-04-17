import { json } from '../lib/http.mjs';

export async function handleNotifications(request, context) {
  if (request.method === 'GET') {
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 30, 100);
    const { data: rows } = await context.sb.from('re_notifications')
      .select('*')
      .eq('user_id', context.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    const items = rows || [];
    return json({ notifications: items, unread_count: items.filter((item) => !item.read).length });
  }

  if (request.method === 'POST' && context.params.id === 'read-all') {
    await context.sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', context.user.id)
      .eq('read', false);
    return json({ success: true });
  }

  if (request.method === 'POST') {
    await context.sb.from('re_notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', context.params.id)
      .eq('user_id', context.user.id);
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}