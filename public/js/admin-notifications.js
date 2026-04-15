'use strict';

(function () {
  let adminNotifOpen = false;
  let adminNotifInterval = null;

  function toggleAdminNotifDropdown() {
    const dropdown = document.getElementById('adminNotifDropdown');
    adminNotifOpen = !adminNotifOpen;
    dropdown.style.display = adminNotifOpen ? 'block' : 'none';
    if (adminNotifOpen) loadAdminNotifications();
  }

  document.addEventListener('click', event => {
    const wrap = document.getElementById('adminNotifBellWrap');
    if (wrap && !wrap.contains(event.target) && adminNotifOpen) {
      adminNotifOpen = false;
      document.getElementById('adminNotifDropdown').style.display = 'none';
    }
  });

  async function loadAdminNotifications() {
    const listEl = document.getElementById('adminNotifList');
    const badgeEl = document.getElementById('adminNotifBadge');
    try {
      const response = await fetch('/api/notifications?limit=20', { headers: authH() });
      if (!response.ok) return;
      const { notifications = [], unread_count: unreadCount = 0 } = await response.json();
      if (unreadCount > 0) {
        badgeEl.style.display = 'block';
        badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
      } else {
        badgeEl.style.display = 'none';
      }
      if (!notifications.length) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8;font-size:13px;">Nenhuma notificação.</div>';
        return;
      }
      const iconMap = { message: '💬', task: '✅', payment: '💰', plan: '📋', appointment: '📅', service: '🛒', info: 'ℹ️' };
      listEl.innerHTML = notifications.map(notification => {
        const ts = new Date(notification.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const unread = !notification.read;
        return `<div onclick="adminReadNotif('${notification.id}',this)"
          style="padding:12px 16px;cursor:pointer;border-bottom:1px solid #F1F5F9;display:flex;gap:10px;align-items:flex-start;background:${unread ? '#EFF6FF' : '#fff'};"
          onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='${unread ? '#EFF6FF' : '#fff'}'">
          <span style="font-size:18px;line-height:1.4;">${iconMap[notification.type] || 'ℹ️'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:${unread ? 700 : 500};color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(notification.title)}</div>
            ${notification.body ? `<div style="font-size:12px;color:#64748B;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(notification.body)}</div>` : ''}
            <div style="font-size:11px;color:#94A3B8;margin-top:3px;">${ts}</div>
          </div>
          ${unread ? '<div style="width:7px;height:7px;border-radius:50%;background:#2563EB;flex-shrink:0;margin-top:6px;"></div>' : ''}
        </div>`;
      }).join('');
    } catch (error) {
      console.warn('[ADMIN NOTIF]', error.message);
    }
  }

  async function adminReadNotif(id, el) {
    el.style.background = '#fff';
    const dot = el.querySelector('div[style*="border-radius:50%"]');
    if (dot) dot.remove();
    fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: authH() }).catch(() => {});
    loadAdminNotifications();
  }

  async function adminMarkAllNotifRead() {
    await fetch('/api/notifications/read-all', { method: 'POST', headers: authH() });
    loadAdminNotifications();
  }

  function startAdminNotifPolling() {
    if (adminNotifInterval) return;
    loadAdminNotifications();
    adminNotifInterval = setInterval(loadAdminNotifications, 30000);
  }

  window.toggleAdminNotifDropdown = toggleAdminNotifDropdown;
  window.loadAdminNotifications = loadAdminNotifications;
  window.adminReadNotif = adminReadNotif;
  window.adminMarkAllNotifRead = adminMarkAllNotifRead;
  window.startAdminNotifPolling = startAdminNotifPolling;
})();