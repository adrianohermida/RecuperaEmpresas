'use strict';

(function () {
  let formConfig = null;
  const STEP_ICONS = ['🔒', '🏢', '👥', '⚙️', '👷', '🏭', '💰', '📋', '📉', '🧠', '📊', '🎯', '📁', '✅'];

  async function loadFormBuilder() {
    const element = document.getElementById('fbStepsList');
    if (!element) return;
    element.innerHTML = '<div class="admin-finance-loading">Carregando...</div>';

    try {
      const response = await fetch('/api/admin/form-config', { headers: authH() });
      if (!response.ok) throw new Error('Erro ao carregar');
      formConfig = await response.json();

      const welcomeMessage = document.getElementById('fbWelcomeMsg');
      if (welcomeMessage) welcomeMessage.value = formConfig.welcomeMessage || '';

      element.innerHTML = `
        <div class="fb-config-shell">
          ${formConfig.steps.map((step, index) => {
            const locked = step.id === 1 || step.id === 14;
            return `
            <div class="fb-config-row${locked ? ' fb-config-row-locked' : ''}" id="fbStep_${step.id}">
              <div class="fb-config-toggle-cell">
                ${locked
                  ? `<span class="fb-config-lock-icon" title="Etapa obrigatória (não pode ser desativada)">${STEP_ICONS[index]}</span>`
                  : `<label class="fb-config-toggle" title="${step.enabled ? 'Clique para desativar' : 'Clique para ativar'}">
                      <input type="checkbox" id="fbEnabled_${step.id}" ${step.enabled ? 'checked' : ''} class="fb-config-toggle-input"
                             onchange="fbToggleStep(${step.id},this.checked)"/>
                      <span id="fbTrack_${step.id}" class="fb-config-toggle-track${step.enabled ? ' fb-config-toggle-track-active' : ''}">
                        <span id="fbThumb_${step.id}" class="fb-config-toggle-thumb${step.enabled ? ' fb-config-toggle-thumb-active' : ''}"></span>
                      </span>
                    </label>`}
              </div>
              <div class="fb-config-copy fb-config-dimmable${!step.enabled ? ' fb-config-copy-disabled' : ''}">
                <div class="fb-config-step-meta">Etapa ${step.id}</div>
                <div class="fb-config-title-row">
                  <span>${STEP_ICONS[index]}</span>
                  <input type="text" id="fbTitle_${step.id}" value="${escHtml(step.title)}"
                    class="fb-config-title-input${locked ? ' fb-config-title-input-readonly' : ''}"
                    ${locked ? 'readonly' : ''}
                    placeholder="Título da etapa"/>
                </div>
              </div>
              <div class="fb-config-desc fb-config-dimmable${!step.enabled ? ' fb-config-copy-disabled' : ''}">
                <input type="text" id="fbDesc_${step.id}" value="${escHtml(step.description || '')}"
                  class="fb-config-desc-input"
                  placeholder="Instrução adicional (opcional)"/>
              </div>
              <div class="fb-config-required fb-config-dimmable${!step.enabled ? ' fb-config-copy-disabled' : ''}">
                <input type="checkbox" id="fbRequired_${step.id}" ${step.required ? 'checked' : ''}
                  ${locked ? 'disabled' : ''}
                  class="fb-config-required-input"/>
                <label for="fbRequired_${step.id}" class="fb-config-required-label">Obrigatória</label>
              </div>
              <div>
                ${locked
                  ? '<span class="badge badge-blue fb-config-badge-sm">Fixo</span>'
                  : step.enabled
                    ? `<span class="badge badge-green fb-config-badge-sm" id="fbBadge_${step.id}">Ativa</span>`
                    : `<span class="badge badge-gray fb-config-badge-sm" id="fbBadge_${step.id}">Inativa</span>`}
              </div>
            </div>`;
          }).join('')}
        </div>
        ${formConfig.lastUpdated ? `<div class="fb-config-updated">Última atualização: ${new Date(formConfig.lastUpdated).toLocaleString('pt-BR')}</div>` : ''}
      `;
    } catch (error) {
      element.innerHTML = '<div class="empty-state"><p>Erro ao carregar configuração do formulário.</p></div>';
    }
  }

  function fbToggleStep(stepId, enabled) {
    const track = document.getElementById(`fbTrack_${stepId}`);
    const thumb = document.getElementById(`fbThumb_${stepId}`);
    const badge = document.getElementById(`fbBadge_${stepId}`);
    const row = document.getElementById(`fbStep_${stepId}`);
    if (track) track.classList.toggle('fb-config-toggle-track-active', enabled);
    if (thumb) thumb.classList.toggle('fb-config-toggle-thumb-active', enabled);
    if (badge) {
      badge.textContent = enabled ? 'Ativa' : 'Inativa';
      badge.className = enabled ? 'badge badge-green fb-config-badge-sm' : 'badge badge-gray fb-config-badge-sm';
    }
    row?.querySelectorAll('.fb-config-dimmable').forEach(element => {
      element.classList.toggle('fb-config-copy-disabled', !enabled);
    });
  }

  async function saveFormConfig() {
    if (!formConfig) return;
    const welcomeMessage = document.getElementById('fbWelcomeMsg')?.value?.trim() || '';
    const steps = formConfig.steps.map(step => ({
      id: step.id,
      title: document.getElementById(`fbTitle_${step.id}`)?.value?.trim() || step.title,
      description: document.getElementById(`fbDesc_${step.id}`)?.value?.trim() || '',
      enabled: step.id === 1 || step.id === 14 ? true : !!document.getElementById(`fbEnabled_${step.id}`)?.checked,
      required: step.id === 1 || step.id === 14 ? true : !!document.getElementById(`fbRequired_${step.id}`)?.checked,
    }));

    try {
      const response = await fetch('/api/admin/form-config', {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify({ steps, welcomeMessage }),
      });
      const json = await response.json();
      if (json.success) {
        formConfig = json.config;
        showToast('Configuração salva com sucesso!', 'success');
        return;
      }
      showToast(json.error || 'Erro ao salvar.', 'error');
    } catch (error) {
      showToast('Erro de conexão.', 'error');
    }
  }

  window.loadFormBuilder = loadFormBuilder;
  window.fbToggleStep = fbToggleStep;
  window.saveFormConfig = saveFormConfig;

console.info('[RE:admin-form-builder] loaded');
})();