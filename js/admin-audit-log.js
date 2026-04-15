'use strict';

(function () {
  async function loadAuditLog() {
    const wrap = document.getElementById('auditLogTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="admin-data-state">Carregando...</div>';

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
        wrap.innerHTML = '<div class="admin-data-state admin-data-state-error">Erro ao carregar.</div>';
        return;
      }

      const { entries = [] } = await response.json();
      if (!entries.length) {
        wrap.innerHTML = '<div class="admin-data-state">Nenhum registro encontrado.</div>';
        return;
      }

      const actionIcon = { create: '➕', update: '✏️', delete: '🗑️', cancel: '❌', status_change: '🔄', payment: '💰' };
      wrap.innerHTML = `<table class="admin-simple-table">
        <thead><tr>
          <th>Data/Hora</th>
          <th>Ator</th>
          <th>Entidade</th>
          <th>Ação</th>
          <th></th>
        </tr></thead>
        <tbody>${entries.map((entry, index) => {
          const timestamp = new Date(entry.ts).toLocaleString('pt-BR');
          const hasDiff = entry.before_data || entry.after_data;
          return `<tr>
            <td class="admin-simple-cell-meta">${timestamp}</td>
            <td>
              <div class="admin-audit-actor-email">${escHtml(entry.actor_email || '—')}</div>
              <div class="admin-audit-actor-role">${escHtml(entry.actor_role || '')}</div>
            </td>
            <td>
              <span class="badge badge-gray">${escHtml(entry.entity_type)}</span>
            </td>
            <td>
              <span>${actionIcon[entry.action] || '•'} ${escHtml(entry.action)}</span>
            </td>
            <td>
              ${hasDiff ? `<button onclick="toggleAuditDetail(${index})" class="admin-detail-toggle">Detalhes</button>
              <div id="auditDetail${index}" class="admin-audit-detail">${hasDiff ? escHtml(JSON.stringify({ before: entry.before_data, after: entry.after_data }, null, 2)) : ''}
              </div>` : '—'}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } catch (error) {
      wrap.innerHTML = '<div class="admin-data-state admin-data-state-error">Erro ao carregar auditoria.</div>';
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