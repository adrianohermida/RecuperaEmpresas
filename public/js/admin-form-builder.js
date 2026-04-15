'use strict';

(function () {
  let formConfig = null;
  const STEP_ICONS = ['🔒', '🏢', '👥', '⚙️', '👷', '🏭', '💰', '📋', '📉', '🧠', '📊', '🎯', '📁', '✅'];

  async function loadFormBuilder() {
    const element = document.getElementById('fbStepsList');
    if (!element) return;
    element.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:14px;">Carregando...</div>';

    try {
      const response = await fetch('/api/admin/form-config', { headers: authH() });
      if (!response.ok) throw new Error('Erro ao carregar');
      formConfig = await response.json();

      const welcomeMessage = document.getElementById('fbWelcomeMsg');
      if (welcomeMessage) welcomeMessage.value = formConfig.welcomeMessage || '';

      element.innerHTML = `
        <div style="border-top:1px solid var(--border);">
          ${formConfig.steps.map((step, index) => {
            const locked = step.id === 1 || step.id === 14;
            return `
            <div style="display:grid;grid-template-columns:36px 1fr 1fr auto auto;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border-light,#F1F5F9);${locked ? 'background:#FAFBFF;' : ''}" id="fbStep_${step.id}">
              <div style="display:flex;align-items:center;justify-content:center;">
                ${locked
                  ? `<span style="font-size:17px;" title="Etapa obrigatória (não pode ser desativada)">${STEP_ICONS[index]}</span>`
                  : `<label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;" title="${step.enabled ? 'Clique para desativar' : 'Clique para ativar'}">
                      <input type="checkbox" id="fbEnabled_${step.id}" ${step.enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;"
                             onchange="fbToggleStep(${step.id},this.checked)"/>
                      <span id="fbTrack_${step.id}" style="position:absolute;inset:0;border-radius:20px;background:${step.enabled ? '#2563eb' : '#cbd5e1'};transition:background .2s;">
                        <span style="position:absolute;left:${step.enabled ? '18px' : '2px'};top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2);" id="fbThumb_${step.id}"></span>
                      </span>
                    </label>`}
              </div>
              <div style="${!step.enabled ? 'opacity:.45' : ''}">
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:2px;">Etapa ${step.id}</div>
                <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;">
                  <span>${STEP_ICONS[index]}</span>
                  <input type="text" id="fbTitle_${step.id}" value="${escHtml(step.title)}"
                    style="border:1px solid transparent;border-radius:4px;padding:2px 6px;font-size:13px;font-weight:600;color:var(--dark);background:transparent;width:200px;outline:none;"
                    onfocus="this.style.borderColor='var(--primary)';this.style.background='#fff';"
                    onblur="this.style.borderColor='transparent';this.style.background='transparent';"
                    ${locked ? 'readonly style="cursor:default;"' : ''}
                    placeholder="Título da etapa"/>
                </div>
              </div>
              <div style="${!step.enabled ? 'opacity:.45' : ''}">
                <input type="text" id="fbDesc_${step.id}" value="${escHtml(step.description || '')}"
                  style="width:100%;border:1px solid transparent;border-radius:4px;padding:4px 8px;font-size:12px;color:var(--text-muted);background:transparent;outline:none;box-sizing:border-box;"
                  onfocus="this.style.borderColor='var(--primary)';this.style.background='#fff';"
                  onblur="this.style.borderColor='transparent';this.style.background='transparent';"
                  placeholder="Instrução adicional (opcional)"/>
              </div>
              <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;${!step.enabled ? 'opacity:.45' : ''}">
                <input type="checkbox" id="fbRequired_${step.id}" ${step.required ? 'checked' : ''}
                  ${locked ? 'disabled' : ''}
                  style="width:14px;height:14px;accent-color:var(--primary);cursor:pointer;"/>
                <label for="fbRequired_${step.id}" style="font-size:12px;color:var(--text-muted);cursor:pointer;">Obrigatória</label>
              </div>
              <div>
                ${locked
                  ? '<span class="badge badge-blue" style="font-size:10px;">Fixo</span>'
                  : step.enabled
                    ? `<span class="badge badge-green" id="fbBadge_${step.id}" style="font-size:10px;">Ativa</span>`
                    : `<span class="badge badge-gray" id="fbBadge_${step.id}" style="font-size:10px;">Inativa</span>`}
              </div>
            </div>`;
          }).join('')}
        </div>
        ${formConfig.lastUpdated ? `<div style="padding:10px 20px;font-size:11px;color:var(--text-muted);">Última atualização: ${new Date(formConfig.lastUpdated).toLocaleString('pt-BR')}</div>` : ''}
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
    if (track) track.style.background = enabled ? '#2563eb' : '#cbd5e1';
    if (thumb) thumb.style.left = enabled ? '18px' : '2px';
    if (badge) {
      badge.textContent = enabled ? 'Ativa' : 'Inativa';
      badge.className = enabled ? 'badge badge-green' : 'badge badge-gray';
      badge.style.fontSize = '10px';
    }
    row?.querySelectorAll('[style*="opacity"]').forEach(element => {
      element.style.opacity = enabled ? '' : '.45';
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
})();