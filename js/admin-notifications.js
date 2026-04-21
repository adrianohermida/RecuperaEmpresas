'use strict';

(function () {
  const iconMap = { message: '💬', task: '✅', payment: '💰', plan: '📋', appointment: '📅', service: '🛒', info: 'ℹ️' };
  let adminNotifOpen = false;
  let adminNotifInterval = null;
  let adminNotifLastMarkup = '';
  let adminNotifLastUnreadCount = null;

  function toggleAdminNotifDropdown() {
    const dropdown = document.getElementById('adminNotifDropdown');
    adminNotifOpen = !adminNotifOpen;
    dropdown.classList.toggle('admin-notif-dropdown-open', adminNotifOpen);
    if (adminNotifOpen) loadAdminNotifications();
  }

  document.addEventListener('click', event => {
    const wrap = document.getElementById('adminNotifBellWrap');
    if (wrap && !wrap.contains(event.target) && adminNotifOpen) {
      adminNotifOpen = false;
      document.getElementById('adminNotifDropdown').classList.remove('admin-notif-dropdown-open');
    }
  });

  function renderEmptyState(message) {
    return `<div class="admin-notif-empty">${message}</div>`;
  }

  function renderNotificationItem(notification) {
    const ts = new Date(notification.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const unread = !notification.read;
    const titleClass = unread ? 'admin-notif-item-title admin-notif-item-title-unread' : 'admin-notif-item-title';
    const unreadDot = unread ? '<div class="admin-notif-item-dot"></div>' : '';
    const dataAttrs = [
      notification.entity_type ? `data-entity-type="${escHtml(notification.entity_type)}"` : '',
      notification.entity_id   ? `data-entity-id="${escHtml(notification.entity_id)}"` : '',
      notification.type        ? `data-type="${escHtml(notification.type)}"` : '',
    ].filter(Boolean).join(' ');

    return `<button type="button" class="admin-notif-item${unread ? ' admin-notif-item-unread' : ''}" data-id="${notification.id}" onclick="adminReadNotif('${notification.id}', this)" ${dataAttrs}>
      <span class="admin-notif-item-icon">${iconMap[notification.type] || 'ℹ️'}</span>
      <span class="admin-notif-item-content">
        <span class="${titleClass}">${escHtml(notification.title)}</span>
        ${notification.body ? `<span class="admin-notif-item-body">${escHtml(notification.body)}</span>` : ''}
        <span class="admin-notif-item-time">${ts}</span>
      </span>
      ${unreadDot}
    </button>`;
  }

  async function loadAdminNotifications() {
    const listEl = document.getElementById('adminNotifList');
    const badgeEl = document.getElementById('adminNotifBadge');
    if (!listEl || !badgeEl) return;
    try {
      const response = await fetch('/api/notifications?limit=20', { headers: authH() });
      if (!response.ok) return;
      const { notifications = [], unread_count: unreadCount = 0 } = await response.json();
      if (adminNotifLastUnreadCount !== unreadCount) {
        if (unreadCount > 0) {
          badgeEl.classList.add('admin-notif-badge-visible');
          badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
          badgeEl.classList.remove('admin-notif-badge-visible');
        }
        adminNotifLastUnreadCount = unreadCount;
      }
      let markup = '';
      if (!notifications.length) {
        markup = renderEmptyState('Nenhuma notificação.');
        if (markup !== adminNotifLastMarkup) {
          listEl.innerHTML = markup;
          adminNotifLastMarkup = markup;
        }
        return;
      }
      markup = notifications.map(renderNotificationItem).join('');
      if (markup !== adminNotifLastMarkup) {
        listEl.innerHTML = markup;
        adminNotifLastMarkup = markup;
      }
    } catch (error) {
      console.warn('[ADMIN NOTIF]', error.message);
    }
  }

  async function adminReadNotif(id, el) {
    el.classList.remove('admin-notif-item-unread');
    const title = el.querySelector('.admin-notif-item-title');
    if (title) title.classList.remove('admin-notif-item-title-unread');
    const dot = el.querySelector('.admin-notif-item-dot');
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

  function autoStartAdminNotifications() {
    if (document.getElementById('adminNotifBellWrap')) startAdminNotifPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStartAdminNotifications, { once: true });
  } else {
    autoStartAdminNotifications();
  }

console.info('[RE:admin-notifications] loaded');
})();