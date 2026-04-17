const DEFAULT_BASE_URL = 'https://portal.recuperaempresas.com.br';
const DEFAULT_EMAIL_FROM = 'Recupera Empresas <contato@recuperaempresas.com.br>';
const DEFAULT_EMAIL_TO = 'contato@recuperaempresas.com.br';

export function getBaseUrl(env) {
  return String(env.BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
}

export function getOpsRecipients(env) {
  const primary = String(env.EMAIL_TO || '').trim();
  if (primary) return [primary];

  const admins = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return admins.length ? admins : [DEFAULT_EMAIL_TO];
}

export function emailWrapper(title, body) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0">
      <h1 style="color:#fff;margin:0;font-size:18px">Recupera Empresas</h1>
      <p style="color:#94A3B8;margin:4px 0 0;font-size:13px">${title}</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">${body}</div>
    <div style="margin-top:10px;padding:10px 16px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;text-align:center">
      © 2026 Recupera Empresas · <a href="mailto:contato@recuperaempresas.com.br" style="color:#1A56DB">contato@recuperaempresas.com.br</a>
    </div>
  </div>`;
}

export function queueSideEffect(context, operation, label = 'side-effect') {
  const task = Promise.resolve(typeof operation === 'function' ? operation() : operation)
    .catch((error) => console.warn(`[worker:${label}]`, error?.message || error));

  if (context.executionCtx?.waitUntil) {
    context.executionCtx.waitUntil(task);
    return undefined;
  }

  return task;
}

export async function sendMail(env, { to, subject, html }) {
  const apiKey = String(env.RESEND_API_KEY || env.RESEND_KEY || '').trim();
  const recipients = (Array.isArray(to) ? to : [to])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (!apiKey || recipients.length === 0) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: String(env.EMAIL_FROM || DEFAULT_EMAIL_FROM),
      to: recipients,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body}`);
  }

  return true;
}

export async function pushNotification(sb, userId, type, title, body, entityType, entityId) {
  if (!userId) return false;

  const { error } = await sb.from('re_notifications').insert({
    user_id: userId,
    type: type || 'info',
    title: title || '',
    body: body || null,
    entity_type: entityType || null,
    entity_id: entityId ? String(entityId) : null,
  });

  if (error) throw error;
  return true;
}

export async function auditLog(sb, payload = {}) {
  const { error } = await sb.from('re_audit_log').insert({
    actor_id: payload.actorId || null,
    actor_email: payload.actorEmail || null,
    actor_role: payload.actorRole || null,
    entity_type: payload.entityType || 'unknown',
    entity_id: payload.entityId ? String(payload.entityId) : null,
    action: payload.action || 'unknown',
    before_data: payload.before || null,
    after_data: payload.after || null,
    ip: payload.ip || null,
    notes: payload.notes || null,
  });

  if (error) throw error;
  return true;
}