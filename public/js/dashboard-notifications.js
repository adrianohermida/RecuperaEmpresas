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
      const dataAttrs = [
        n.entity_type ? `data-entity-type="${escHtmlD(n.entity_type)}"` : '',
        n.entity_id   ? `data-entity-id="${escHtmlD(n.entity_id)}"` : '',
        n.type        ? `data-type="${escHtmlD(n.type)}"` : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="admin-notif-item${unr ? ' admin-notif-item-unread' : ''}" onclick="readNotif('${n.id}',this)" ${dataAttrs}>
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

// Maps notification entity_type (and type) to the client portal section name
const _NOTIF_NAV_MAP = {
  // entity_type values
  task:                 'tasks',
  message:              'messages',
  document:             'documentos',
  document_request:     'documentos',
  re_document_requests: 'documentos',
  change_request:       'documentos',
  appointment:          'agenda',
  service:              'marketplace',
  payment:              'financeiro',
  plan:                 'plan',
  journey:              'jornadas',
  form:                 'formularios',
  support:              'support',
  // notification type values (fallback)
  info:                 null,
};

async function readNotif(id, el) {
  el.classList.remove('admin-notif-item-unread');
  const title = el.querySelector('.admin-notif-item-title');
  if (title) title.classList.remove('admin-notif-item-title-unread');
  const dot = el.querySelector('.admin-notif-item-dot');
  if (dot) dot.remove();

  // Retrieve entity_type from data attributes set during render
  const entityType = el.dataset.entityType || el.dataset.type || null;
  const entityId   = el.dataset.entityId   || null;

  fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: authH() }).catch(() => {});

  // Navigate to the relevant section
  const section = _NOTIF_NAV_MAP[entityType] || null;
  if (section && typeof navigateTo === 'function') {
    // Close dropdown before navigating
    _notifOpen = false;
    document.getElementById('notifDropdown')?.classList.remove('admin-notif-dropdown-open');
    navigateTo(section, entityId);
    return;
  }

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
console.info('[RE:dashboard-notifications] loaded');
