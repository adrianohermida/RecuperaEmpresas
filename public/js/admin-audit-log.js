'use strict';

(function () {
  async function loadAuditLog() {
    const wrap = document.getElementById('auditLogTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Carregando...</div>';

    const type = document.getElementById('auditFilterType')?.value || '';
    const from = document.getElementById('auditFilterFrom')?.value || '';
    const to = document.getElementById('auditFilterTo')?.value || '';
    const params = new URLSearchParams({ limit: '100' });
    if (type) params.set('entity_type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
      const response = await fetch(`/api/admin/audit-log?${params}`, { headers: authH() });
      if (!response.ok) {
        wrap.innerHTML = '<div style="padding:20px;color:var(--danger);">Erro ao carregar.</div>';
        return;
      }

      const { entries = [] } = await response.json();
      if (!entries.length) {
        wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Nenhum registro encontrado.</div>';
        return;
      }

      const actionIcon = { create: '➕', update: '✏️', delete: '🗑️', cancel: '❌', status_change: '🔄', payment: '💰' };
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Data/Hora</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Ator</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Entidade</th>
          <th style="text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;">Ação</th>
          <th style="padding:8px 12px;"></th>
        </tr></thead>
        <tbody>${entries.map((entry, index) => {
          const timestamp = new Date(entry.ts).toLocaleString('pt-BR');
          const hasDiff = entry.before_data || entry.after_data;
          return `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:9px 12px;color:var(--text-muted);white-space:nowrap;font-size:12px;">${timestamp}</td>
            <td style="padding:9px 12px;">
              <div style="font-weight:600;font-size:12px;">${escHtml(entry.actor_email || '—')}</div>
              <div style="font-size:10px;color:var(--text-muted);">${escHtml(entry.actor_role || '')}</div>
            </td>
            <td style="padding:9px 12px;">
              <span class="badge badge-gray">${escHtml(entry.entity_type)}</span>
            </td>
            <td style="padding:9px 12px;">
              <span>${actionIcon[entry.action] || '•'} ${escHtml(entry.action)}</span>
            </td>
            <td style="padding:9px 12px;">
              ${hasDiff ? `<button onclick="toggleAuditDetail(${index})" style="border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11px;background:none;cursor:pointer;">Detalhes</button>
              <div id="auditDetail${index}" style="display:none;margin-top:8px;font-size:11px;font-family:monospace;background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;max-width:340px;word-break:break-all;white-space:pre-wrap;">${hasDiff ? escHtml(JSON.stringify({ before: entry.before_data, after: entry.after_data }, null, 2)) : ''}
              </div>` : '—'}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } catch (error) {
      wrap.innerHTML = '<div style="padding:20px;color:var(--danger);">Erro ao carregar auditoria.</div>';
      console.error('[AUDIT LOG]', error.message);
    }
  }

  function exportAuditLog() {
    const type = document.getElementById('auditFilterType')?.value || '';
    const from = document.getElementById('auditFilterFrom')?.value || '';
    const to = document.getElementById('auditFilterTo')?.value || '';
    const params = new URLSearchParams();
    if (type) params.set('entity_type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const token = localStorage.getItem('re_admin_token') || localStorage.getItem('re_token') || '';
    fetch(`/api/admin/audit-log/export?${params}`, { headers: { Authorization: 'Bearer ' + token } })
      .then(response => response.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => showToast('Erro ao exportar log.', 'error'));
  }

  function toggleAuditDetail(index) {
    const element = document.getElementById(`auditDetail${index}`);
    if (element) element.style.display = element.style.display === 'none' ? 'block' : 'none';
  }

  window.loadAuditLog = loadAuditLog;
  window.exportAuditLog = exportAuditLog;
  window.toggleAuditDetail = toggleAuditDetail;
})();