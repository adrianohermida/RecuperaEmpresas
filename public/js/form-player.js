'use strict';

function fpToken() {
  if (window.REShared && typeof window.REShared.getStoredToken === 'function') {
    return window.REShared.getStoredToken({ allowImpersonation: true });
  }
  return localStorage.getItem('re_token') || sessionStorage.getItem('re_impersonate_token') || '';
}

function fpAuthH() {
  if (window.REShared && typeof window.REShared.buildAuthHeaders === 'function') {
    return window.REShared.buildAuthHeaders({ allowImpersonation: true });
  }
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + fpToken() };
}

function fpEsc(value) {
  if (value == null) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fpRead(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

const FP = {
  forms: [],
  currentForm: null,
  runner: null,
  lastFocusEl: null,
};

function fpModalEls() {
  return {
    modal: document.getElementById('fp-player-modal'),
    content: document.getElementById('fp-player-content'),
    title: document.getElementById('fp-player-title'),
    progressBar: document.getElementById('fp-player-progress'),
    progressLabel: document.getElementById('fp-player-progress-label'),
    status: document.getElementById('fp-player-status'),
  };
}

function fpSetModalOpen(open) {
  const { modal } = fpModalEls();
  if (!modal) return;
  modal.classList.toggle('dashboard-player-modal-open', open);
  document.body.classList.toggle('dashboard-modal-active', open);

  if (open) {
    FP.lastFocusEl = document.activeElement;
    modal.querySelector('.dashboard-player-modal-close')?.focus();
    return;
  }

  if (FP.lastFocusEl && typeof FP.lastFocusEl.focus === 'function') {
    FP.lastFocusEl.focus();
  }
  FP.lastFocusEl = null;
}

function fpClosePlayer() {
  if (FP.runner) {
    FP.runner.destroy();
    FP.runner = null;
  }
  FP.currentForm = null;
  fpSetModalOpen(false);
}

async function loadClientForms() {
  const host = document.getElementById('fp-forms-list') || document.getElementById('myFormsList');
  if (!host) return;
  host.innerHTML = '<div class="admin-empty-state-soft">Carregando formulários...</div>';

  try {
    const res = await fetch('/api/my-forms', { headers: fpAuthH() });
    FP.forms = res.ok ? await res.json() : [];
  } catch {
    FP.forms = [];
  }

  if (!FP.forms.length) {
    host.innerHTML = '<div class="admin-empty-state-soft">Nenhum formulário disponível no momento.</div>';
    return;
  }

  const STATUS_LABELS = {
    nao_iniciado: 'Não iniciado',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
  };
  const STATUS_CLASS = {
    nao_iniciado: 'badge-gray',
    em_andamento: 'badge-blue',
    concluido: 'badge-green',
  };

  host.innerHTML = FP.forms.map((form) => `
    <div class="fp-list-card">
      <div class="fp-list-head">
        <div>
          <div class="fp-list-title">${fpEsc(form.title || 'Formulário')}</div>
          ${form.description ? `<div class="fp-list-desc">${fpEsc(form.description)}</div>` : ''}
        </div>
        <span class="badge ${STATUS_CLASS[form.response_status] || 'badge-gray'}">${STATUS_LABELS[form.response_status] || form.response_status}</span>
      </div>
      <div class="fp-list-meta">
        ${form.score_pct != null ? `<span>Pontuação: ${Math.round(form.score_pct)}%</span>` : '<span>Sem pontuação ainda</span>'}
        ${form.score_classification ? `<span>${fpEsc(String(form.score_classification).replace(/_/g, ' '))}</span>` : ''}
      </div>
      <div class="fp-list-actions">
        <button class="btn-primary" onclick="fpPlayForm('${form.id}')">${form.response_status === 'concluido' ? 'Ver resposta' : form.response_status === 'em_andamento' ? 'Continuar' : 'Iniciar'}</button>
      </div>
    </div>
  `).join('');
}

async function loadClientJourneys() {
  const host = document.getElementById('journeysList');
  if (!host) return;
  host.innerHTML = '<div class="admin-empty-state-soft">Carregando jornadas...</div>';
  try {
    const res = await fetch('/api/my-journeys', { headers: fpAuthH() });
    const journeys = res.ok ? await res.json() : [];
    if (!journeys.length) {
      host.innerHTML = '<div class="admin-empty-state-soft">Nenhuma jornada ativa.</div>';
      return;
    }
    host.innerHTML = journeys.map((journey) => {
      const name = journey.journey_name || journey.title || 'Jornada';
      const desc = journey.journey_description || journey.description || '';
      const total = (journey.steps || []).length;
      const done  = (journey.steps || []).filter(s => s.completed).length;
      const pct   = total ? Math.round(done / total * 100) : null;
      return `
      <div class="fp-journey-card">
        <div class="fp-journey-title">${fpEsc(name)}</div>
        ${desc ? `<div class="fp-journey-desc">${fpEsc(desc)}</div>` : ''}
        ${total ? `<div class="fp-journey-progress">${done}/${total} etapas${pct !== null ? ` · ${pct}%` : ''}</div>` : ''}
      </div>`;
    }).join('');
  } catch {
    host.innerHTML = '<div class="admin-empty-state-soft">Não foi possível carregar as jornadas.</div>';
  }
}

async function fpPersist(snapshot) {
  const res = await fetch(`/api/my-forms/${FP.currentForm.id}/response`, {
    method: 'POST',
    headers: fpAuthH(),
    body: JSON.stringify({
      answers: snapshot.answers,
      current_page_id: snapshot.current_page_id,
      status: snapshot.status === 'concluido' ? 'concluido' : 'em_andamento',
    }),
  });
  const data = await fpRead(res);
  if (!res.ok) throw new Error(data.error || 'Erro ao salvar progresso.');
  return data;
}

async function fpPlayForm(formId) {
  const res = await fetch(`/api/my-forms/${formId}`, { headers: fpAuthH() });
  const data = await fpRead(res);
  if (!res.ok) {
    if (typeof showToast === 'function') showToast(data.error || 'Erro ao abrir formulário.', 'error');
    return;
  }

  const els = fpModalEls();
  if (!els.content) return;
  FP.currentForm = data;
  fpSetModalOpen(true);

  if (FP.runner) FP.runner.destroy();
  FP.runner = window.REFormRuntime.createRunner({
    mode: 'authenticated',
    root: els.content,
    titleEl: els.title,
    progressBarEl: els.progressBar,
    progressLabelEl: els.progressLabel,
    statusEl: els.status,
    questionPerScreen: false,
    submitLabel: 'Concluir formulário',
    onPersist: fpPersist,
    onSubmit: async (_snapshot, persistResult) => {
      await loadClientForms();
      return persistResult;
    },
    onClose: async () => {
      fpClosePlayer();
      await loadClientForms();
    },
  });

  FP.runner.load({
    form: data,
    existingResponse: data.existing_response || null,
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fp-player-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'fp-player-modal') fpClosePlayer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fpClosePlayer();
  });
  loadClientForms();
  loadClientJourneys();
});

window.loadClientForms = loadClientForms;
window.loadClientJourneys = loadClientJourneys;
window.fpPlayForm = fpPlayForm;
window.fpClosePlayer = fpClosePlayer;
