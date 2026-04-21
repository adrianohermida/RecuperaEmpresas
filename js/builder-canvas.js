'use strict';
/* builder-canvas.js — Form Builder: canvas, páginas, questões, configurações */

let FB_DRAG_QUESTION_ID = null;

/* ──────────────────────────────────────────────────────────────────────────────
   Builder — open & page management
──────────────────────────────────────────────────────────────────────────────*/
async function fbOpenBuilder(formId, readOnly = false) {
  FB.currentFormId = formId;
  FB.selectedQ = null;
  FB.readOnly = readOnly;
  fbShowView('builder');

  const titleEl = document.getElementById('fb-builder-title');
  if (titleEl) titleEl.textContent = 'Carregando...';

  const res = await fetch(`/api/admin/forms/${formId}`, { headers: fbAuthH() });
  const jf = await fbRead(res);
  if (!res.ok) { fbToast(jf.error || 'Erro ao carregar formulário.','error'); return; }
  FB.currentForm = jf.form || jf;

  if (titleEl) titleEl.textContent = FB.currentForm.title;

  fbRenderPageTabs();

  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages[0] || null;
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
}

function fbRenderPageTabs() {
  const pages = FB.currentForm.pages || [];
  const bar   = document.getElementById('fb-page-tabs');
  if (!bar) return;
  bar.innerHTML = pages.map((p, i) => `
    <button class="fb-page-tab ${FB.currentPage && FB.currentPage.id === p.id ? 'active' : ''}"
      onclick="fbSelectPage(${p.id})">
      Página ${i+1}${p.title ? ': '+fbEsc(p.title) : ''}
    </button>
  `).join('') + (FB.readOnly ? '' : `
    <button onclick="fbAddPage()" class="fb-page-tab-add">
      + Página
    </button>
  `);
}

function fbSelectPage(pageId) {
  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages.find(p => p.id === pageId) || null;
  FB.selectedQ   = null;
  fbRenderPageTabs();
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
}

async function fbAddPage() {
  const title = prompt('Título da nova página (opcional):') ?? '';
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/pages`, {
    method:'POST', headers: fbAuthH(),
    body: JSON.stringify({ title, order_index: (FB.currentForm.pages||[]).length })
  });
  if (!res.ok) { fbToast('Erro ao criar página.','error'); return; }
  await fbRefreshForm();
  const pages = FB.currentForm.pages || [];
  FB.currentPage = pages[pages.length - 1] || null;
  fbRenderPageTabs();
  fbRenderCanvas();
}

async function fbRefreshForm() {
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}`, { headers: fbAuthH() });
  if (res.ok) { const j = await fbRead(res); FB.currentForm = j.form || j; }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Canvas rendering
──────────────────────────────────────────────────────────────────────────────*/
function fbRenderCanvas() {
  const canvas = document.getElementById('fb-canvas');
  if (!canvas) return;

  if (!FB.currentPage) {
    canvas.innerHTML = `<div class="form-builder-canvas-empty">
      <div class="form-builder-canvas-empty-icon">📄</div>
      <div class="form-builder-canvas-empty-copy">${FB.readOnly ? 'Nenhuma página.' : 'Nenhuma página. Clique em "+ Página" para criar.'}</div>
    </div>`;
    return;
  }

  const questions = (FB.currentPage.questions || []).sort((a,b) => a.order_index - b.order_index);

  if (!questions.length) {
    canvas.innerHTML = `<div class="form-builder-canvas-empty">
      <div class="form-builder-canvas-empty-icon">❓</div>
      <div class="form-builder-canvas-empty-copy">${FB.readOnly ? 'Nenhuma questão nesta página.' : 'Nenhuma questão nesta página.<br>Arraste um tipo da paleta ou clique para adicionar.'}</div>
    </div>`;
    return;
  }

  canvas.innerHTML = questions.map((q, i) => {
    const typeInfo = QB_TYPES.find(t => t.type === q.type) || { icon:'❓', label: q.type };
    const isActive = FB.selectedQ === q.id;
    return `
        <div class="fb-question-card ${isActive ? 'fb-q-active' : ''}"
         id="fb-q-${q.id}"
          data-question-id="${q.id}"
          draggable="${FB.readOnly ? 'false' : 'true'}"
         onclick="fbSelectQuestion(${q.id})">
      <div class="fb-question-card-row">
        <span class="fb-question-card-icon">${typeInfo.icon}</span>
        <div class="fb-question-card-copy">
          <div class="fb-question-card-badges">
            <span class="fb-question-card-badge">${typeInfo.label}</span>
            ${q.required ? '<span class="fb-question-card-badge fb-question-card-badge-required">Obrigatório</span>' : ''}
            ${q.weight ? `<span class="fb-question-card-badge fb-question-card-badge-weight">Peso: ${q.weight}</span>` : ''}
          </div>
          <div class="fb-question-card-title">${fbEsc(q.label) || '<em class="fb-question-card-title-empty">Sem título</em>'}</div>
          ${q.description ? `<div class="fb-question-card-description">${fbEsc(q.description)}</div>` : ''}
        </div>
        ${FB.readOnly ? '' : `<div class="fb-question-card-actions">
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'up')" title="Mover para cima"
            class="fb-question-card-action-btn"
            ${i === 0 ? 'disabled' : ''}>↑</button>
          <button onclick="event.stopPropagation();fbMoveQuestion(${q.id},'down')" title="Mover para baixo"
            class="fb-question-card-action-btn"
            ${i === questions.length-1 ? 'disabled' : ''}>↓</button>
          <button onclick="event.stopPropagation();fbDuplicateQuestion(${q.id})" title="Duplicar"
            class="fb-question-card-action-btn">⧉</button>
          <button onclick="event.stopPropagation();fbDeleteQuestion(${q.id})" title="Excluir"
            class="fb-question-card-action-btn fb-question-card-action-delete">🗑</button>
        </div>`}
      </div>
      ${fbRenderQuestionPreview(q)}
    </div>`;
  }).join('');

  fbBindQuestionDnD();
}

function fbBindQuestionDnD() {
  if (FB.readOnly) return;
  const canvas = document.getElementById('fb-canvas');
  if (!canvas) return;
  canvas.querySelectorAll('.fb-question-card[data-question-id]').forEach((card) => {
    card.addEventListener('dragstart', () => {
      FB_DRAG_QUESTION_ID = Number(card.dataset.questionId);
      card.classList.add('fb-q-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('fb-q-dragging');
      FB_DRAG_QUESTION_ID = null;
      canvas.querySelectorAll('.fb-q-drop-target').forEach((node) => node.classList.remove('fb-q-drop-target'));
    });
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!FB_DRAG_QUESTION_ID || FB_DRAG_QUESTION_ID === Number(card.dataset.questionId)) return;
      card.classList.add('fb-q-drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('fb-q-drop-target'));
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      card.classList.remove('fb-q-drop-target');
      if (!FB_DRAG_QUESTION_ID || FB_DRAG_QUESTION_ID === Number(card.dataset.questionId)) return;
      await fbReorderQuestions(FB_DRAG_QUESTION_ID, Number(card.dataset.questionId));
    });
  });
}

async function fbReorderQuestions(sourceId, targetId) {
  const ordered = [...(FB.currentPage?.questions || [])].sort((a, b) => a.order_index - b.order_index);
  const sourceIndex = ordered.findIndex((question) => question.id === sourceId);
  const targetIndex = ordered.findIndex((question) => question.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, moved);
  const payload = ordered.map((question, index) => ({ id: question.id, order_index: index }));
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions/reorder`, {
    method: 'POST',
    headers: fbAuthH(),
    body: JSON.stringify({ order: payload }),
  });
  if (!res.ok) {
    fbToast('Erro ao reordenar questões.','error');
    return;
  }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages || []).find((page) => page.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
}

function fbRenderQuestionPreview(q) {
  if (q.type === 'section') return '';
  if (q.type === 'content') {
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-formula">${fbEsc(q.settings?.body || q.description || 'Bloco de conteúdo')}</div></div>`;
  }
  if (q.type === 'media') {
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-upload">${fbEsc(q.settings?.media_type || 'media')} · ${fbEsc(q.settings?.media_url || 'sem URL')}</div></div>`;
  }
  if (q.type === 'short_text')  return `<div class="fb-question-preview-wrap"><input disabled placeholder="${fbEsc(q.placeholder || 'Resposta curta...')}" class="fb-question-preview-input"></div>`;
  if (q.type === 'long_text')   return `<div class="fb-question-preview-wrap"><textarea disabled placeholder="${fbEsc(q.placeholder || 'Resposta longa...')}" rows="2" class="fb-question-preview-input fb-question-preview-textarea"></textarea></div>`;
  if (q.type === 'number' || q.type === 'currency' || q.type === 'percentage')
    return `<div class="fb-question-preview-wrap"><input type="number" disabled placeholder="0" class="fb-question-preview-input fb-question-preview-input-sm"></div>`;
  if (q.type === 'date')
    return `<div class="fb-question-preview-wrap"><input type="date" disabled class="fb-question-preview-input fb-question-preview-input-auto"></div>`;
  if (q.type === 'single_choice' || q.type === 'multi_choice' || q.type === 'checklist' || q.type === 'dropdown') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (!opts.length) return `<div class="fb-question-preview-empty">(Sem opções configuradas)</div>`;
    return `<div class="fb-question-preview-wrap fb-question-preview-options">
      ${opts.slice(0,3).map(o => `<label class="fb-question-preview-option-row">
        <input type="${q.type==='multi_choice' || q.type==='checklist'?'checkbox':'radio'}" disabled class="fb-question-preview-option-input"> ${fbEsc(typeof o === 'string' ? o : o.label || o)}
      </label>`).join('')}
      ${opts.length > 3 ? `<span class="fb-question-preview-empty">+ ${opts.length-3} mais opções...</span>` : ''}
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps' || q.type === 'rating') {
    const max = q.type === 'rating' ? 5 : (q.type === 'nps' ? 10 : (q.settings?.max || 10));
    return `<div class="fb-question-preview-wrap fb-question-preview-scale-row">
      ${Array.from({length: Math.min(max,10)}, (_,i) => `<button disabled class="fb-question-preview-scale-btn">${q.type==='rating'?'★':i+(q.type==='nps'?0:1)}</button>`).join('')}
      ${max > 10 ? `<span class="fb-question-preview-scale-more">...</span>` : ''}
    </div>`;
  }
  if (q.type === 'yes_no')
    return `<div class="fb-question-preview-wrap fb-question-preview-binary-row"><button disabled class="fb-question-preview-binary-btn">✅ Sim</button><button disabled class="fb-question-preview-binary-btn">❌ Não</button></div>`;
  if (q.type === 'file_upload')
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-upload">📎 Clique ou arraste o arquivo aqui</div></div>`;
  if (q.type === 'score')
    return `<div class="fb-question-preview-wrap"><div class="fp-score-card"><div class="fp-score-value">84%</div><div class="fp-score-meta">Painel de score em tempo real</div></div></div>`;
  if (q.type === 'calculated')
    return `<div class="fb-question-preview-wrap"><div class="fb-question-preview-formula">${fbEsc(q.formula || 'Sem fórmula configurada')}</div></div>`;
  return '';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Question selection
──────────────────────────────────────────────────────────────────────────────*/
function fbSelectQuestion(qId) {
  FB.selectedQ = qId;
  fbRenderCanvas();
  fbRenderPropertiesPanel(qId);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Add question from palette
──────────────────────────────────────────────────────────────────────────────*/
async function fbAddQuestion(type) {
  if (!FB.currentPage) { fbToast('Selecione ou crie uma página primeiro.','error'); return; }
  const questions = FB.currentPage.questions || [];
  const body = {
    page_id:     FB.currentPage.id,
    type,
    label:       '',
    order_index: questions.length,
    required:    false,
  };
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions`, {
    method:'POST', headers: fbAuthH(), body: JSON.stringify(body)
  });
  if (!res.ok) { fbToast('Erro ao adicionar questão.','error'); return; }
  const newQ = await res.json();
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  FB.selectedQ = newQ.id;
  fbRenderCanvas();
  fbRenderPropertiesPanel(newQ.id);
  const canvas = document.getElementById('fb-canvas');
  if (canvas) canvas.scrollTop = canvas.scrollHeight;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Save question properties
──────────────────────────────────────────────────────────────────────────────*/
let _fbSaveTimer = null;

function fbSavePropDebounced(qId) {
  if (FB.readOnly) return;
  clearTimeout(_fbSaveTimer);
  _fbSaveTimer = setTimeout(() => fbSaveQuestion(qId), 1200);
}

async function fbSaveQuestion(qId) {
  if (FB.readOnly) return;
  clearTimeout(_fbSaveTimer);
  const q = (FB.currentPage?.questions || []).find(x => x.id === qId);
  if (!q) return;

  const label       = document.getElementById('fp-label')?.value || '';
  const description = document.getElementById('fp-description')?.value || '';
  const placeholder = document.getElementById('fp-placeholder')?.value || '';
  const required    = document.getElementById('fp-required')?.checked || false;
  const weight      = parseFloat(document.getElementById('fp-weight')?.value) || 0;

  let options = q.options;
  const optTA = document.getElementById('fp-options');
  if (optTA) options = optTA.value.split('\n').map(s=>s.trim()).filter(Boolean);

  let settings = q.settings || {};
  const smin = document.getElementById('fp-scale-min');
  const smax = document.getElementById('fp-scale-max');
  const slmin = document.getElementById('fp-scale-lmin');
  const slmax = document.getElementById('fp-scale-lmax');
  if (smin) settings = { ...settings, min: parseFloat(smin.value)||1, max: parseFloat(smax?.value)||10, label_min: slmin?.value||'', label_max: slmax?.value||'' };

  const contentBody = document.getElementById('fp-content-body');
  const contentVariant = document.getElementById('fp-content-variant');
  if (contentBody || contentVariant) {
    settings = { ...settings, body: contentBody?.value || '', variant: contentVariant?.value || 'text' };
  }

  const mediaType = document.getElementById('fp-media-type');
  const mediaUrl = document.getElementById('fp-media-url');
  const mediaCaption = document.getElementById('fp-media-caption');
  if (mediaType || mediaUrl || mediaCaption) {
    settings = {
      ...settings,
      media_type: mediaType?.value || 'image',
      media_url: mediaUrl?.value || '',
      caption: mediaCaption?.value || '',
    };
  }

  let formula = q.formula || '';
  const fEl = document.getElementById('fp-formula');
  if (fEl) formula = fEl.value;

  const body = { label, description, placeholder, required, weight, options, settings, formula };

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions/${qId}`, {
    method:'PUT', headers: fbAuthH(), body: JSON.stringify(body)
  });
  if (!res.ok) { fbToast('Erro ao salvar questão.','error'); return; }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
  fbToast('Questão salva!','success');
}

async function fbDeleteQuestion(qId) {
  if (!confirm('Excluir esta questão?')) return;
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions/${qId}`, {
    method:'DELETE', headers: fbAuthH()
  });
  if (!res.ok) { fbToast('Erro ao excluir.','error'); return; }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  FB.selectedQ = null;
  fbRenderCanvas();
  fbRenderPropertiesEmpty();
  fbToast('Questão excluída.','success');
}

async function fbDuplicateQuestion(qId) {
  const source = (FB.currentPage?.questions || []).find((question) => question.id === qId);
  if (!source) return;
  const body = {
    page_id: source.page_id,
    type: source.type,
    label: `${source.label || 'Questão'} (cópia)`,
    description: source.description,
    placeholder: source.placeholder,
    required: source.required,
    options: source.options,
    settings: source.settings,
    weight: source.weight,
    score_map: source.score_map,
    formula: source.formula,
  };
  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/questions`, {
    method: 'POST',
    headers: fbAuthH(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    fbToast('Erro ao duplicar questão.','error');
    return;
  }
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages || []).find((page) => page.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
  fbToast('Questão duplicada!','success');
}

async function fbMoveQuestion(qId, dir) {
  const questions = [...(FB.currentPage?.questions || [])].sort((a,b) => a.order_index - b.order_index);
  const idx = questions.findIndex(q => q.id === qId);
  if (idx < 0) return;
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= questions.length) return;

  const aOrd = questions[idx].order_index;
  const bOrd = questions[swap].order_index;

  await Promise.all([
    fetch(`/api/admin/forms/${FB.currentFormId}/questions/${questions[idx].id}`, {
      method:'PUT', headers: fbAuthH(), body: JSON.stringify({ order_index: bOrd })
    }),
    fetch(`/api/admin/forms/${FB.currentFormId}/questions/${questions[swap].id}`, {
      method:'PUT', headers: fbAuthH(), body: JSON.stringify({ order_index: aOrd })
    }),
  ]);
  await fbRefreshForm();
  FB.currentPage = (FB.currentForm.pages||[]).find(p => p.id === FB.currentPage.id) || FB.currentPage;
  fbRenderCanvas();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Form settings panel
──────────────────────────────────────────────────────────────────────────────*/
async function fbSaveFormSettings() {
  const title  = document.getElementById('fb-settings-title')?.value.trim();
  const desc   = document.getElementById('fb-settings-desc')?.value.trim();
  const status = document.getElementById('fb-settings-status')?.value;
  const publicEnabled = document.getElementById('fb-settings-public-enabled')?.checked || false;
  const publicResume = document.getElementById('fb-settings-public-resume')?.checked !== false;
  const publicCapture = document.getElementById('fb-settings-public-capture')?.checked !== false;
  const publicCaptcha = document.getElementById('fb-settings-public-captcha')?.checked === true;
  const publicSlugInput = document.getElementById('fb-settings-public-slug');
  const publicSlug = fbSlugify(publicSlugInput?.value || title || 'formulario');
  const publicLayout = document.getElementById('fb-settings-public-layout')?.value || 'focus';
  if (!title) { fbToast('Título obrigatório.','error'); return; }
  if (publicSlugInput) publicSlugInput.value = publicSlug;

  const settings = {
    ...(FB.currentForm?.settings || {}),
    public: {
      ...((FB.currentForm?.settings || {}).public || {}),
      enabled: publicEnabled,
      slug: publicSlug,
      allow_resume: publicResume,
      capture_lead: publicCapture,
      require_captcha: publicCaptcha,
      layout: publicLayout,
      title,
      description: desc,
    },
  };

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}`, {
    method:'PUT', headers: fbAuthH(), body: JSON.stringify({ title, description: desc, status, settings })
  });
  if (res.ok) {
    const jset = await res.json(); FB.currentForm = jset.form || jset;
    document.getElementById('fb-builder-title').textContent = title;
    fbToast('Configurações salvas!','success');
    document.getElementById('fb-settings-panel').classList.add('ui-hidden');
  } else fbToast('Erro ao salvar.','error');
}

function fbHasRecaptchaSiteKey() {
  return Boolean(String(window.RE_GOOGLE_RECAPTCHA_SITE_KEY || '').trim());
}

function fbUpdatePublicSettingsState() {
  const title = document.getElementById('fb-settings-title')?.value.trim() || FB.currentForm?.title || 'formulario';
  const slugInput = document.getElementById('fb-settings-public-slug');
  const urlInput = document.getElementById('fb-settings-public-url');
  const captchaToggle = document.getElementById('fb-settings-public-captcha');
  const warning = document.getElementById('fb-settings-public-captcha-warning');

  if (slugInput) {
    const normalizedSlug = fbSlugify(slugInput.value || title || 'formulario');
    slugInput.value = normalizedSlug;
    if (urlInput) urlInput.value = `${location.origin}/formulario/${normalizedSlug}`;
  }

  if (warning) {
    const showWarning = captchaToggle?.checked === true && !fbHasRecaptchaSiteKey();
    warning.classList.toggle('ui-hidden', !showWarning);
  }
}

function fbBindPublicSettingsListeners() {
  const panel = document.getElementById('fb-settings-panel');
  if (!panel || panel.dataset.publicBindingsReady === 'true') return;

  ['fb-settings-title', 'fb-settings-public-slug', 'fb-settings-public-captcha'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    const eventName = element.tagName === 'INPUT' && element.type === 'checkbox' ? 'change' : 'input';
    element.addEventListener(eventName, fbUpdatePublicSettingsState);
  });

  panel.dataset.publicBindingsReady = 'true';
}

function fbToggleSettings() {
  const p = document.getElementById('fb-settings-panel');
  if (!p) return;
  const show = p.classList.contains('ui-hidden');
  p.classList.toggle('ui-hidden', !show);
  if (show && FB.currentForm) {
    fbBindPublicSettingsListeners();
    const publicConfig = (FB.currentForm.settings || {}).public || {};
    document.getElementById('fb-settings-title').value  = FB.currentForm.title || '';
    document.getElementById('fb-settings-desc').value   = FB.currentForm.description || '';
    document.getElementById('fb-settings-status').value = FB.currentForm.status || 'draft';
    document.getElementById('fb-settings-public-enabled').checked = publicConfig.enabled === true;
    document.getElementById('fb-settings-public-resume').checked = publicConfig.allow_resume !== false;
    document.getElementById('fb-settings-public-capture').checked = publicConfig.capture_lead !== false;
    document.getElementById('fb-settings-public-captcha').checked = publicConfig.require_captcha === true;
    document.getElementById('fb-settings-public-slug').value = publicConfig.slug || fbSlugify(FB.currentForm.title || 'formulario');
    document.getElementById('fb-settings-public-layout').value = publicConfig.layout || 'focus';
    fbUpdatePublicSettingsState();
  }
}
