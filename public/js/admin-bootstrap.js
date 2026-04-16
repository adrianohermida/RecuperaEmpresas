'use strict';

(function () {
  const EVENT_LABELS = {
    login: 'Login',
    register: 'Cadastro',
    verify: 'Verificação',
    step_complete: 'Etapa concluída',
    submit: 'Envio final',
  };

  let prevUnreadTotal = 0;

  async function loadLogs() {
    const response = await fetch('/api/admin/logs', { headers: authH() });
    if (!response.ok) return;

    const { logs } = await response.json();
    const tableBody = document.getElementById('logTableBody');
    if (!tableBody) return;

    if (!logs.length) {
      tableBody.innerHTML = '<tr><td colspan="5" class="admin-log-empty-cell">Nenhum log registrado.</td></tr>';
      return;
    }

    tableBody.innerHTML = logs.map(log => `<tr>
      <td>${new Date(log.ts).toLocaleString('pt-BR')}</td>
      <td class="admin-log-email">${log.email}</td>
      <td><span class="badge ${log.event === 'login' ? 'badge-blue' : log.event === 'submit' ? 'badge-green' : 'badge-gray'}">${EVENT_LABELS[log.event] || log.event}</span></td>
      <td class="admin-log-muted">${log.ip}</td>
      <td class="admin-log-muted">${log.step ? `Etapa ${log.step}` : '—'}</td>
    </tr>`).join('');
  }

  async function loadAdminData() {
    const [clientsResponse, statsResponse] = await Promise.all([
      fetch('/api/admin/clients', { headers: authH() }),
      fetch('/api/admin/stats', { headers: authH() }),
    ]);

    if (clientsResponse.ok) {
      const { clients } = await clientsResponse.json();
      _allClients = clients;
      renderClientTable(clients);
      const clientsSub = document.getElementById('clientsSub');
      if (clientsSub) {
        clientsSub.textContent = `${clients.length} cliente${clients.length !== 1 ? 's' : ''} cadastrado${clients.length !== 1 ? 's' : ''}`;
      }
    }

    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      const totalClients = document.getElementById('sTotalClients');
      const concluded = document.getElementById('sConcluido');
      const inProgress = document.getElementById('sEmAndamento');
      const notStarted = document.getElementById('sNaoIniciado');

      if (totalClients) totalClients.textContent = stats.total;
      if (concluded) concluded.textContent = stats.concluido;
      if (inProgress) inProgress.textContent = stats.emAndamento;
      if (notStarted) notStarted.textContent = stats.naoIniciado;
    }
  }

  function downloadBlob(blob, fileName) {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function exportClientXLS(clientId) {
    if (!clientId) return;
    const url = `/api/admin/client/${clientId}/export/xlsx`;
    fetch(url, { headers: authH() })
      .then(response => {
        if (!response.ok) {
          showToast('Erro ao exportar.', 'error');
          return null;
        }
        return response.blob();
      })
      .then(blob => downloadBlob(blob, `recupera_${clientId}.xlsx`))
      .catch(() => showToast('Erro ao exportar.', 'error'));
  }

  function exportClientPDF(clientId) {
    if (!clientId) return;
    const url = `/api/admin/client/${clientId}/export/pdf`;
    fetch(url, { headers: authH() })
      .then(response => {
        if (!response.ok) {
          showToast('Erro ao gerar PDF.', 'error');
          return null;
        }
        return response.blob();
      })
      .then(blob => downloadBlob(blob, `recupera_${clientId}.pdf`))
      .catch(() => showToast('Erro ao gerar PDF.', 'error'));
  }

  async function impersonateClient(clientId) {
    if (!clientId) return;
    try {
      const response = await fetch(`/api/admin/impersonate/${clientId}`, {
        method: 'POST',
        headers: authH(),
      });
      if (!response.ok) {
        showToast('Erro ao gerar token de visualização.', 'error');
        return;
      }

      const { token } = await response.json();
      window.open(`dashboard.html?impersonate=${encodeURIComponent(token)}`, '_blank');
    } catch (error) {
      showToast('Erro ao visualizar como cliente.', 'error');
    }
  }

  function pollFreshchatWidget(callback, attempts) {
    if (typeof window.fcWidget !== 'undefined') {
      callback();
      return;
    }
    if (attempts <= 0) {
      console.warn('[Freshchat] operator widget not ready');
      return;
    }
    setTimeout(() => pollFreshchatWidget(callback, attempts - 1), 500);
  }

  function initFreshchatOperator(user) {
    pollFreshchatWidget(() => {
      try {
        window.fcWidget.setExternalId(user.id || user.email);
        window.fcWidget.user.setFirstName(user.name ? user.name.split(' ')[0] : '');
        window.fcWidget.user.setLastName(user.name ? user.name.split(' ').slice(1).join(' ') : '');
        window.fcWidget.user.setEmail(user.email);
        window.fcWidget.user.setProperties({ role: 'consultor', app: 'Recupera Empresas — Operador' });
      } catch (error) {
        console.warn('[Freshchat] operator init error:', error.message);
      }
    }, 30);
  }

  async function initAdminShell() {
    console.info('[RE:admin-bootstrap] initAdminShell starting');
    const token = getToken();
    if (!token) {
      console.warn('[RE:admin-bootstrap] no token → redirect login');
      location.href = 'login.html';
      return;
    }

    const warmTimer = setTimeout(() => {
      const guard = document.getElementById('authGuard');
      if (guard) {
        const msg = guard.querySelector('.auth-guard-message');
        if (msg) msg.textContent = 'Servidor aquecendo, aguarde...';
      }
    }, 4000);

    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      response = await fetch('/api/auth/verify', {
        headers: { Authorization: 'Bearer ' + token },
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (error) {
      clearTimeout(warmTimer);
      console.error('[RE:admin-bootstrap] verify fetch failed:', error.message);
      location.href = 'login.html?err=timeout';
      return;
    }
    clearTimeout(warmTimer);

    if (!response.ok) {
      console.warn('[RE:admin-bootstrap] verify response not ok:', response.status);
      location.href = 'login.html';
      return;
    }

    let user;
    try {
      const body = await response.json();
      user = body.user;
      if (!user) throw new Error('user field missing from /api/auth/verify response');
    } catch (err) {
      console.error('[RE:admin-bootstrap] verify JSON parse error:', err.message);
      location.href = 'login.html?err=parse';
      return;
    }

    if (!user.isAdmin) {
      console.warn('[RE:admin-bootstrap] user is not admin → redirect dashboard');
      location.href = 'dashboard.html';
      return;
    }

    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    if (userName) userName.textContent = user.name || user.email;
    if (userAvatar) userAvatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
    document.getElementById('authGuard')?.remove();
    console.info('[RE:admin-bootstrap] auth guard removed, loading data...');

    try {
      await loadAdminData();
    } catch (err) {
      console.error('[RE:admin-bootstrap] loadAdminData error:', err.message);
    }

    if (isFreshchatEnabled()) {
      setTimeout(() => initFreshchatOperator(user), 2000);
    }

    startAdminNotifPolling();
    try {
      await pollUnreadMessages();
    } catch (err) {
      console.error('[RE:admin-bootstrap] pollUnreadMessages error:', err.message);
    }
    setInterval(pollUnreadMessages, 15000);
    console.info('[RE:admin-bootstrap] initAdminShell complete');
  }

  async function pollUnreadMessages() {
    try {
      const response = await fetch('/api/admin/messages/unread', { headers: authH() });
      if (!response.ok) return;

      const { unread } = await response.json();
      _unreadMsgs = unread || {};
      const newTotal = Object.values(_unreadMsgs).reduce((sum, count) => sum + count, 0);

      if (document.getElementById('sec-clients')?.classList.contains('active')) {
        renderClientTable(_allClients);
      }

      document.title = newTotal > 0 ? `(${newTotal}) Admin — Recupera Empresas` : 'Admin — Recupera Empresas';

      if (newTotal > prevUnreadTotal && prevUnreadTotal >= 0) {
        const diff = newTotal - prevUnreadTotal;
        if (Notification.permission === 'granted') {
          new Notification('Recupera Empresas', { body: `${diff} nova${diff > 1 ? 's' : ''} mensagem${diff > 1 ? 's' : ''} de cliente${diff > 1 ? 's' : ''}`, icon: '/favicon.ico' });
        } else if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }

      prevUnreadTotal = newTotal;
    } catch (error) {
      // noop
    }
  }

  window.loadLogs = loadLogs;
  window.loadAdminData = loadAdminData;
  window.exportClientXLS = exportClientXLS;
  window.exportClientPDF = exportClientPDF;
  window.impersonateClient = impersonateClient;
  window.initFreshchatOperator = initFreshchatOperator;
  window.initAdminShell = initAdminShell;
  window.pollUnreadMessages = pollUnreadMessages;
})();