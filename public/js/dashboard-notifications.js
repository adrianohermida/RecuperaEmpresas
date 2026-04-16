'use strict';
/* dashboard-notifications.js — Notificações: dropdown, polling, leitura */

let _notifInterval = null;
let _notifOpen     = false;

function toggleNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  _notifOpen = !_notifOpen;
  dd.classList.toggle('admin-notif-dropdown-open', _notifOpen);
  if (_notifOpen) loadNotifications();
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('notifBellWrap');
  if (wrap && !wrap.contains(e.target) && _notifOpen) {
    _notifOpen = false;
    document.getElementById('notifDropdown').classList.remove('admin-notif-dropdown-open');
  }
});

function escHtmlD(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadNotifications() {
  const listEl  = document.getElementById('notifList');
  const badgeEl = document.getElementById('notifBadge');
  try {
    const res = await fetch('/api/notifications?limit=20', { headers: authH() });
    if (!res.ok) return;
    const { notifications = [], unread_count = 0 } = await res.json();

    if (unread_count > 0) {
      badgeEl.classList.add('admin-notif-badge-visible');
      badgeEl.textContent = unread_count > 99 ? '99+' : unread_count;
    } else {
      badgeEl.classList.remove('admin-notif-badge-visible');
    }

    if (!notifications.length) {
      listEl.innerHTML = '<div class="admin-notif-empty">Nenhuma notificação.</div>';
      return;
    }

    const iconMap = {
      message: '💬', task: '✅', payment: '💰', plan: '📋',
      appointment: '📅', service: '🛒', info: 'ℹ️',
    };

    listEl.innerHTML = notifications.map(n => {
      const ts  = new Date(n.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const unr = !n.read;
      return `<button type="button" class="admin-notif-item${unr ? ' admin-notif-item-unread' : ''}" onclick="readNotif('${n.id}',this)">
        <span class="admin-notif-item-icon">${iconMap[n.type] || 'ℹ️'}</span>
        <div class="admin-notif-item-content">
          <div class="admin-notif-item-title${unr ? ' admin-notif-item-title-unread' : ''}">${escHtmlD(n.title)}</div>
          ${n.body ? `<div class="admin-notif-item-body">${escHtmlD(n.body)}</div>` : ''}
          <div class="admin-notif-item-time">${ts}</div>
        </div>
        ${unr ? '<div class="admin-notif-item-dot"></div>' : ''}
      </button>`;
    }).join('');
  } catch (e) {
    console.warn('[NOTIF]', e.message);
  }
}

async function readNotif(id, el) {
  el.classList.remove('admin-notif-item-unread');
  const title = el.querySelector('.admin-notif-item-title');
  if (title) title.classList.remove('admin-notif-item-title-unread');
  const dot = el.querySelector('.admin-notif-item-dot');
  if (dot) dot.remove();
  fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: authH() }).catch(() => {});
  loadNotifications();
}

async function markAllNotifRead() {
  await fetch('/api/notifications/read-all', { method: 'POST', headers: authH() });
  loadNotifications();
}

function startNotifPolling() {
  if (_notifInterval) return;
  loadNotifications();
  _notifInterval = setInterval(loadNotifications, 30000);
}

function stopNotifPolling() {
  clearInterval(_notifInterval);
  _notifInterval = null;
}
