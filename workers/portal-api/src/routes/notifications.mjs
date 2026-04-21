import { json } from '../lib/http.mjs';

export async function handleNotifications(request, context) {
  try {
    if (request.method === 'GET') {
      const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 30, 100);
      const { data: rows, error } = await context.sb.from('re_notifications')
        .select('*')
        .eq('user_id', context.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const items = Array.isArray(rows) ? rows : [];
      return json({ notifications: items, unread_count: items.filter((item) => !item.read).length });
    }

    if (request.method === 'POST' && context.params.id === 'read-all') {
      const { error } = await context.sb.from('re_notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('user_id', context.user.id)
        .eq('read', false);
      if (error) throw error;
      return json({ success: true });
    }

    if (request.method === 'POST') {
      const { error } = await context.sb.from('re_notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', context.params.id)
        .eq('user_id', context.user.id);
      if (error) throw error;
      return json({ success: true });
    }
  } catch (error) {
    const message = error?.message || String(error || 'unknown error');
    console.warn('[worker:notifications]', message);
    if (request.method === 'GET') {
      return json({ notifications: [], unread_count: 0, warning: message });
    }
    return json({ error: message }, { status: 500 });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}