'use strict';

(function () {
  const storageKey = () => `re_public_form_${location.pathname}`;
  let runner = null;
  let currentSlug = '';

  function readResume() {
    try {
      return JSON.parse(localStorage.getItem(storageKey()) || '{}');
    } catch {
      return {};
    }
  }

  function saveResume(payload) {
    localStorage.setItem(storageKey(), JSON.stringify(payload || {}));
  }

  function clearResume() {
    localStorage.removeItem(storageKey());
  }

  async function readApi(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  function resolveSlug() {
    const parts = location.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || '');
  }

  function els() {
    return {
      title: document.getElementById('public-form-title'),
      description: document.getElementById('public-form-description'),
      root: document.getElementById('public-form-runner'),
      progressBar: document.getElementById('public-form-progress-bar'),
      progressLabel: document.getElementById('public-form-progress-label'),
      status: document.getElementById('public-form-status'),
    };
  }

  async function loadPublicForm() {
    currentSlug = resolveSlug();
    if (!currentSlug) {
      els().root.innerHTML = '<div class="fp-inline-note">Slug do formulário não informado.</div>';
      return;
    }

    const resume = readResume();
    const query = resume.response_id ? `?response_id=${encodeURIComponent(resume.response_id)}` : '';
    const res = await fetch(`/api/public/forms/${encodeURIComponent(currentSlug)}${query}`);
    const data = await readApi(res);
    if (!res.ok) {
      els().root.innerHTML = `<div class="fp-inline-note">${data.error || 'Não foi possível carregar o formulário.'}</div>`;
      return;
    }

    const ui = els();
    const publicConfig = data.form?.settings?.public || {};
    ui.title.textContent = publicConfig.title || data.form?.title || 'Formulário';
    ui.description.textContent = publicConfig.description || data.form?.description || 'Preencha as etapas abaixo.';

    if (runner) runner.destroy();
    runner = window.REFormRuntime.createRunner({
      mode: 'public',
      root: ui.root,
      titleEl: ui.title,
      progressBarEl: ui.progressBar,
      progressLabelEl: ui.progressLabel,
      statusEl: ui.status,
      questionPerScreen: publicConfig.layout !== 'list',
      submitLabel: 'Enviar respostas',
      resolveLead(snapshot) {
        return snapshot.lead || {};
      },
      onPersist: async (snapshot) => {
        const response = await fetch(`/api/public/forms/${encodeURIComponent(currentSlug)}/response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response_id: snapshot.response_id,
            answers: snapshot.answers,
            current_page_id: snapshot.current_page_id,
            status: snapshot.status,
            visitor: snapshot.lead,
          }),
        });
        const result = await readApi(response);
        if (!response.ok) throw new Error(result.error || 'Erro ao salvar progresso.');
        saveResume({ response_id: result.response_id, lead: snapshot.lead || {} });
        return result;
      },
      onSubmit: async (_snapshot, persistResult) => {
        clearResume();
        return {
          ...(persistResult || {}),
          thank_you_message: publicConfig.thank_you_message || '',
        };
      },
      onClose: () => {
        if (publicConfig.redirect_after_submit) {
          location.href = publicConfig.redirect_after_submit;
        }
      },
    });

    runner.load({
      form: data.form,
      existingResponse: data.existing_response || null,
      lead: data.existing_response?.visitor || resume.lead || {},
    });
  }

  document.addEventListener('DOMContentLoaded', loadPublicForm);
})();