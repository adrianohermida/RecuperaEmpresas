'use strict';

async function getToken() {
  if (window.REShared?.getStoredToken) return window.REShared.getStoredToken();
  return localStorage.getItem('re_token');
}

function authH() {
  if (window.REShared?.buildAuthHeaders) return window.REShared.buildAuthHeaders();
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() };
}

function showToast(msg, type, duration) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show ' + (type || '');
  setTimeout(function () { toast.className = 'toast'; }, duration || 3000);
}

async function loadFreshchatDiagnostics() {
  var container = document.getElementById('freshchatDiagnosticsContainer');
  var btn = document.getElementById('freshchatRefreshBtn');
  
  if (!container) return;
  
  btn?.setAttribute('disabled', 'disabled');
  container.innerHTML = '<div class="diagnostics-loading"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Carregando...</div>';
  
  try {
    var response = await fetch('/api/admin/freshchat/identity', {
      method: 'GET',
      headers: authH()
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Não autenticado. Por favor, faça login novamente.');
      }
      throw new Error('Erro ao carregar diagnóstico: ' + response.status);
    }
    
    var data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error || 'Erro desconhecido');
    }
    
    renderFreshchatDiagnostics(data);
    showToast('Diagnóstico atualizado com sucesso', 'success', 2000);
  } catch (error) {
    container.innerHTML = '<div style="color:var(--error);font-size:13px;">❌ Erro ao carregar: ' + escapeHtml(error.message) + '</div>';
    showToast('Erro ao carregar diagnóstico', 'error', 3000);
  } finally {
    btn?.removeAttribute('disabled');
  }
}

function renderFreshchatDiagnostics(data) {
  var container = document.getElementById('freshchatDiagnosticsContainer');
  if (!container) return;
  
  var html = '';
  
  // Email
  html += '<div class="diagnostics-item diagnostics-status-ok">';
  html += '  <span class="diagnostics-label">Email:</span>';
  html += '  <span class="diagnostics-value">' + escapeHtml(data.email || '—') + '</span>';
  html += '</div>';
  
  // Freshchat External ID
  var idStatus = data.freshchatExternalId ? 'diagnostics-status-ok' : 'diagnostics-status-error';
  html += '<div class="diagnostics-item ' + idStatus + '">';
  html += '  <span class="diagnostics-label">ID Externo Freshchat:</span>';
  html += '  <span class="diagnostics-value">' + escapeHtml(data.freshchatExternalId || '❌ Não mapeado') + '</span>';
  html += '</div>';
  
  // Mapped Admin ID (se existir)
  if (data.mappedAdminId) {
    html += '<div class="diagnostics-item diagnostics-status-ok">';
    html += '  <span class="diagnostics-label">Admin ID Mapeado:</span>';
    html += '  <span class="diagnostics-value">' + escapeHtml(data.mappedAdminId) + '</span>';
    html += '</div>';
  }
  
  // JWT Secret Source
  var secretStatus = data.hasJwtSecret ? 'diagnostics-status-ok' : 'diagnostics-status-error';
  html += '<div class="diagnostics-item ' + secretStatus + '">';
  html += '  <span class="diagnostics-label">Fonte do JWT:</span>';
  html += '  <span class="diagnostics-value">' + escapeHtml(data.secretSource || '❌ Não configurado') + '</span>';
  html += '</div>';
  
  // Status geral
  html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.05);font-size:12px;color:var(--text-muted);">';
  if (data.freshchatExternalId && data.hasJwtSecret) {
    html += '✓ Pronto para autenticação. Seu acesso ao Freshchat foi configurado corretamente.';
  } else {
    html += '⚠️ Há itens não configurados. Verifique o mapeamento de email e as variáveis de ambiente.';
  }
  html += '</div>';
  
  container.innerHTML = html;
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function connectGoogleCalendar() {
  showToast('Google Calendar integration coming soon', 'info', 3000);
  // TODO: Implementar OAuth flow para Google Calendar
}

async function testGoogleCalendarConnection() {
  showToast('Testing Google Calendar connection...', 'info', 3000);
  // TODO: Implementar teste de conexão
}

// Load Freshchat diagnostics on page load
document.addEventListener('DOMContentLoaded', function () {
  // Delay load para garantir que o layout está pronto
  setTimeout(function () {
    loadFreshchatDiagnostics();
    loadSyncHistory();
  }, 500);
});

async function loadSyncHistory() {
  var container = document.getElementById('syncHistoryContainer');
  if (!container) return;
  
  // Mock data for now - will be replaced with real sync history from backend
  var mockHistory = [
    { time: new Date(Date.now() - 2 * 60000).toLocaleString(), type: 'Freshchat', status: 'success', message: 'Diagnóstico carregado' },
    { time: new Date(Date.now() - 15 * 60000).toLocaleString(), type: 'Google Calendar', status: 'error', message: 'Não conectado' },
    { time: new Date(Date.now() - 1 * 3600000).toLocaleString(), type: 'Freshchat', status: 'success', message: 'Sincronização JWT completa' }
  ];
  
  var html = '';
  mockHistory.forEach(function (item) {
    var statusClass = item.status === 'success' ? 'success' : 'error';
    html += '<div class="history-item">';
    html += '  <div>';
    html += '    <div style="font-weight:500;color:var(--text);">' + item.type + '</div>';
    html += '    <div class="history-item-time">' + item.time + '</div>';
    html += '  </div>';
    html += '  <span class="history-item-status ' + statusClass + '">' + (item.status === 'success' ? '✓' : '✗') + ' ' + item.message + '</span>';
    html += '</div>';
  });
  
  container.innerHTML = html;
}
