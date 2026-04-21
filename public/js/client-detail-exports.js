'use strict';

(function () {
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

  function sanitizeFileName(value) {
    return String(value || 'cliente').replace(/[^\w.-]+/g, '_');
  }

  async function exportClientXLS(clientId) {
    if (!clientId) return;
    const response = await fetch('/api/admin/client/' + clientId + '/export/xlsx', { headers: authH() });
    if (!response.ok) {
      showToast('Erro ao exportar XLS.', 'error');
      return;
    }
    const currentClient = window.REClientDetailState?.currentClientData || window._currentClientData;
    const label = sanitizeFileName(currentClient?.user?.company || currentClient?.user?.name || clientId);
    downloadBlob(await response.blob(), label + '.xlsx');
  }

  async function exportClientPDF(clientId) {
    if (!clientId) return;
    const response = await fetch('/api/admin/client/' + clientId + '/export/pdf', { headers: authH() });
    if (!response.ok) {
      showToast('Erro ao exportar PDF.', 'error');
      return;
    }
    const currentClient = window.REClientDetailState?.currentClientData || window._currentClientData;
    const label = sanitizeFileName(currentClient?.user?.company || currentClient?.user?.name || clientId);
    downloadBlob(await response.blob(), label + '.pdf');
  }

  async function impersonateClient(clientId) {
    if (!clientId) return;
    try {
      const response = await fetch('/api/admin/impersonate/' + clientId, {
        method: 'POST',
        headers: authH(),
      });
      if (!response.ok) {
        showToast('Erro ao gerar token de visualizaÃ§Ã£o.', 'error');
        return;
      }
      const payload = await response.json();
      if (!payload.token) {
        showToast('Token de visualizaÃ§Ã£o nÃ£o retornado.', 'error');
        return;
      }
      window.open(window.REShared.getRoute('dashboard') + '?impersonate=' + encodeURIComponent(payload.token), '_blank');
    } catch (error) {
      showToast('Erro ao visualizar como cliente.', 'error');
    }
  }

  window.exportClientXLS = exportClientXLS;
  window.exportClientPDF = exportClientPDF;
  window.impersonateClient = impersonateClient;
  window.REClientDetailExports = {
    exportClientPDF,
    exportClientXLS,
    impersonateClient,
  };
})();

