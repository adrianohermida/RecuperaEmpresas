import { json, readJson } from '../lib/http.mjs';

function mapAppointmentForAdmin(item) {
  return {
    ...item,
    clientName: item.re_users?.name || '',
    clientEmail: item.re_users?.email || '',
    userId: item.user_id,
  };
}

export async function handleAppointments(request, context) {
  if (context.scope === 'admin') {
    if (request.method === 'GET') {
      const { data: appts } = await context.sb.from('re_appointments')
        .select('*, re_users(name, email, company)')
        .order('date');
      return json({ appointments: (appts || []).map(mapAppointmentForAdmin) });
    }

    if (request.method === 'PUT') {
      const body = await readJson(request);
      const updates = {};
      if (body.status !== undefined) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;
      await context.sb.from('re_appointments').update(updates).eq('id', context.params.id);
      return json({ success: true });
    }

    return json({ error: 'Método não permitido.' }, { status: 405 });
  }

  if (request.method === 'GET') {
    const { data } = await context.sb.from('re_appointments')
      .select('*')
      .eq('user_id', context.user.id)
      .order('date');
    return json({ appointments: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    const { date, time, type, notes } = body;
    if (!date || !type) return json({ error: 'Preencha data e tipo.' }, { status: 400 });

    const { data } = await context.sb.from('re_appointments').insert({
      user_id: context.user.id,
      date,
      time: time || null,
      type,
      notes: notes || '',
      status: 'pendente',
    }).select().single();

    return json({
      success: true,
      appointment: data,
      warning: 'TODO: replicar notificação por email antes de rotear tráfego de produção para este endpoint.',
    });
  }

  if (request.method === 'DELETE') {
    await context.sb.from('re_appointments')
      .delete()
      .eq('id', context.params.id)
      .eq('user_id', context.user.id);
    return json({ success: true });
  }

  return json({ error: 'Método não permitido.' }, { status: 405 });
}