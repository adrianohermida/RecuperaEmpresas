'use strict';

(function () {
  function esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeOptions(options) {
    return Array.isArray(options)
      ? options.map((option) => (typeof option === 'string' ? { label: option, value: option } : {
          label: option.label || option.value || '',
          value: option.value || option.label || '',
        }))
      : [];
  }

  function safeSettings(input) {
    return input && typeof input === 'object' ? input : {};
  }

  function normalizeYoutubeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.hostname.includes('youtu.be')) {
        return `https://www.youtube.com/embed/${parsed.pathname.replace(/^\//, '')}`;
      }
      if (parsed.hostname.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
        if (parsed.pathname.includes('/embed/')) return raw;
      }
      return raw;
    } catch {
      return raw;
    }
  }

  function toComparable(answer) {
    if (Array.isArray(answer)) return answer.map((item) => String(item).toLowerCase());
    if (answer == null) return '';
    if (typeof answer === 'boolean') return answer ? 'true' : 'false';
    return String(answer).trim().toLowerCase();
  }

  function evalCondition(answer, operator, expectedValue) {
    const op = String(operator || 'equals').toLowerCase();
    const actual = toComparable(answer);
    const expected = toComparable(expectedValue);
    if (op === 'else') return false;
    if (Array.isArray(actual)) {
      if (op === 'contains') return actual.includes(expected);
      if (op === 'not_contains') return !actual.includes(expected);
      if (op === 'empty') return actual.length === 0;
      if (op === 'not_empty') return actual.length > 0;
      if (op === 'equals') return actual.length === 1 && actual[0] === expected;
      if (op === 'not_equals') return !(actual.length === 1 && actual[0] === expected);
      return false;
    }
    const actualNum = Number(actual);
    const expectedNum = Number(expected);
    if (op === 'empty') return actual === '';
    if (op === 'not_empty') return actual !== '';
    if (op === 'equals') return actual === expected;
    if (op === 'not_equals') return actual !== expected;
    if (op === 'contains') return actual.includes(expected);
    if (op === 'not_contains') return !actual.includes(expected);
    if (!Number.isNaN(actualNum) && !Number.isNaN(expectedNum)) {
      if (op === 'greater_than') return actualNum > expectedNum;
      if (op === 'greater_or_equal') return actualNum >= expectedNum;
      if (op === 'less_than') return actualNum < expectedNum;
      if (op === 'less_or_equal') return actualNum <= expectedNum;
    }
    return false;
  }

  function resolveConditionalRules(rules, answers) {
    const groups = new Map();
    for (const rule of (rules || [])) {
      const sourceId = String(rule?.source_question_id || '');
      if (!sourceId) continue;
      if (!groups.has(sourceId)) groups.set(sourceId, []);
      groups.get(sourceId).push(rule);
    }
    const resolved = [];
    for (const [sourceId, sourceRules] of groups.entries()) {
      const answer = answers?.[sourceId];
      const primary = sourceRules.filter((rule) => String(rule?.operator || '').toLowerCase() !== 'else');
      const fallback = sourceRules.filter((rule) => String(rule?.operator || '').toLowerCase() === 'else');
      const matched = primary.filter((rule) => evalCondition(answer, rule.operator, rule.condition_value));
      if (matched.length) {
        resolved.push(...matched);
      } else if (fallback.length) {
        resolved.push(...fallback);
      }
    }
    return resolved;
  }

  function computeQuestionScore(question, answerValue) {
    if (!question || !question.weight) return 0;
    const scoreMap = question.score_map || {};
    if (Array.isArray(answerValue)) {
      return answerValue.reduce((sum, item) => {
        const mapped = scoreMap[String(item)];
        return sum + (mapped !== undefined ? (parseFloat(mapped) || 0) : 0);
      }, 0);
    }
    if (answerValue != null && scoreMap[String(answerValue)] !== undefined) {
      return parseFloat(scoreMap[String(answerValue)]) || 0;
    }
    if (typeof answerValue === 'number') {
      return answerValue * (Number(question.weight || 0) / 10);
    }
    const numeric = Number(answerValue);
    if (!Number.isNaN(numeric) && numeric > 0 && ['scale', 'nps', 'rating'].includes(question.type)) {
      return numeric * (Number(question.weight || 0) / 10);
    }
    return 0;
  }

  function createRunner(options) {
    const config = {
      mode: options.mode || 'authenticated',
      root: options.root,
      titleEl: options.titleEl || null,
      progressBarEl: options.progressBarEl || null,
      progressLabelEl: options.progressLabelEl || null,
      statusEl: options.statusEl || null,
      questionPerScreen: options.questionPerScreen === true,
      submitLabel: options.submitLabel || 'Enviar',
      introRenderer: typeof options.introRenderer === 'function' ? options.introRenderer : null,
      onPersist: typeof options.onPersist === 'function' ? options.onPersist : null,
      onSubmit: typeof options.onSubmit === 'function' ? options.onSubmit : null,
      onClose: typeof options.onClose === 'function' ? options.onClose : null,
      onReady: typeof options.onReady === 'function' ? options.onReady : null,
      onStateChange: typeof options.onStateChange === 'function' ? options.onStateChange : null,
      resolveLead: typeof options.resolveLead === 'function' ? options.resolveLead : null,
      resolveCaptchaToken: typeof options.resolveCaptchaToken === 'function' ? options.resolveCaptchaToken : null,
    };

    const state = {
      form: null,
      answers: {},
      visiblePages: [],
      sequence: [],
      currentIndex: 0,
      currentPageId: null,
      responseId: null,
      submitting: false,
      saving: false,
      completed: false,
      completionPayload: null,
      lead: {},
      saveTimer: null,
      syncReady: false,
    };

    const root = config.root;
    if (!root) throw new Error('root é obrigatório para o form runtime');

    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('click', handleClick);

    function setStatus(message, tone) {
      if (!config.statusEl) return;
      config.statusEl.textContent = message || '';
      config.statusEl.dataset.tone = tone || '';
      config.statusEl.classList.toggle('ui-hidden', !message);
    }

    function getQuestion(questionId) {
      for (const page of (state.form?.pages || [])) {
        const found = (page.questions || []).find((question) => String(question.id) === String(questionId));
        if (found) return found;
      }
      return null;
    }

    function getAllQuestions() {
      return (state.form?.pages || []).flatMap((page) => page.questions || []);
    }

    function computeFormula(formula) {
      if (!formula) return null;
      const expression = String(formula).replace(/\{([^}]+)\}/g, (_full, rawId) => {
        const cleanId = String(rawId).replace(/^q/i, '').trim();
        const answer = state.answers[cleanId];
        const numeric = Array.isArray(answer) ? answer.length : Number(answer);
        return Number.isNaN(numeric) ? 0 : numeric;
      });
      try {
        return Function(`return (${expression});`)();
      } catch {
        return null;
      }
    }

    function computeScoreSnapshot() {
      const details = {};
      let total = 0;
      let max = 0;
      for (const question of getAllQuestions()) {
        if (!question.weight) continue;
        max += Number(question.weight || 0);
        const answerValue = state.answers[String(question.id)];
        const points = computeQuestionScore(question, answerValue);
        details[question.id] = points;
        total += points;
      }
      const pct = max > 0 ? (total / max) * 100 : null;
      return {
        total,
        max,
        pct,
        details,
        classification: pct == null ? null : pct >= 70 ? 'saudavel' : pct >= 40 ? 'risco_moderado' : 'risco_alto',
      };
    }

    function isQuestionHidden(questionId) {
      const question = getQuestion(questionId);
      if (!question) return true;
      const ruleList = resolveConditionalRules((state.form?.logic || []).filter((rule) => String(rule.target_question_id || '') === String(questionId)), state.answers);
      let hidden = false;
      for (const rule of ruleList) {
        const action = String(rule.action || '').toLowerCase();
        if (action === 'hide_question') hidden = true;
        if (action === 'show_question') hidden = false;
      }
      return hidden;
    }

    function isPageHidden(pageId) {
      const rules = resolveConditionalRules((state.form?.logic || []).filter((rule) => String(rule.target_page_id || '') === String(pageId)), state.answers);
      let hidden = false;
      for (const rule of rules) {
        const action = String(rule.action || '').toLowerCase();
        if (action === 'hide_page') hidden = true;
        if (action === 'show_page') hidden = false;
      }
      return hidden;
    }

    function rebuildVisibility() {
      const pages = clone(state.form?.pages || []);
      state.visiblePages = pages
        .filter((page) => !isPageHidden(page.id))
        .map((page) => ({
          ...page,
          questions: (page.questions || []).filter((question) => !isQuestionHidden(question.id)),
        }))
        .filter((page) => page.questions.length > 0 || page.title || page.description);

      state.sequence = config.questionPerScreen
        ? state.visiblePages.flatMap((page) => (page.questions || []).map((question) => ({ page, questions: [question], question })))
        : state.visiblePages.map((page) => ({ page, questions: page.questions || [], question: null }));

      if (!state.sequence.length) {
        state.sequence = [{ page: { id: null, title: state.form?.title || '', description: '' }, questions: [], question: null }];
      }
      if (state.currentIndex >= state.sequence.length) state.currentIndex = state.sequence.length - 1;
      if (state.currentIndex < 0) state.currentIndex = 0;
      state.currentPageId = state.sequence[state.currentIndex]?.page?.id || null;
    }

    function getCurrentStep() {
      return state.sequence[state.currentIndex] || null;
    }

    function getJumpTargetIndex(step) {
      const questions = step?.questions || [];
      for (const question of questions) {
        const matchingRule = resolveConditionalRules((state.form?.logic || []).filter((rule) => {
          if (String(rule.source_question_id || '') !== String(question.id)) return false;
          const action = String(rule.action || '').toLowerCase();
          return ['skip_to_page', 'go_to_page'].includes(action);
        }), state.answers)[0];
        if (matchingRule?.target_page_id) {
          const index = state.sequence.findIndex((entry) => String(entry.page?.id) === String(matchingRule.target_page_id));
          if (index >= 0) return index;
        }
      }
      return null;
    }

    function updateChrome() {
      const stepCount = Math.max(state.sequence.length, 1);
      const current = state.completed ? stepCount : Math.min(state.currentIndex + 1, stepCount);
      const pct = Math.round((current / stepCount) * 100);
      if (config.titleEl) config.titleEl.textContent = state.form?.title || 'Formulário';
      if (config.progressLabelEl) config.progressLabelEl.textContent = `${current} de ${stepCount}`;
      if (config.progressBarEl && window.REShared?.applyPercentClass) {
        window.REShared.applyPercentClass(config.progressBarEl, pct, 100);
      } else if (config.progressBarEl) {
        config.progressBarEl.style.width = `${pct}%`;
      }
    }

    function renderMedia(settings) {
      const mediaType = String(settings.media_type || 'image').toLowerCase();
      const mediaUrl = String(settings.media_url || '').trim();
      const caption = settings.caption ? `<div class="fp-media-caption">${esc(settings.caption)}</div>` : '';
      if (!mediaUrl) return '<div class="fp-inline-note">Adicione uma mídia para exibir aqui.</div>';
      if (mediaType === 'youtube') {
        return `<div class="fp-media-frame"><iframe src="${esc(normalizeYoutubeUrl(mediaUrl))}" title="Mídia" loading="lazy" allowfullscreen></iframe></div>${caption}`;
      }
      if (mediaType === 'pdf') {
        return `<div class="fp-media-frame fp-media-frame-pdf"><iframe src="${esc(mediaUrl)}" title="PDF" loading="lazy"></iframe></div>${caption}`;
      }
      if (mediaType === 'attachment') {
        return `<a class="btn-ghost fp-media-link" href="${esc(mediaUrl)}" target="_blank" rel="noopener">Abrir anexo</a>${caption}`;
      }
      return `<div class="fp-media-image-wrap"><img class="fp-media-image" src="${esc(mediaUrl)}" alt="${esc(settings.alt || settings.caption || 'Mídia do formulário')}"></div>${caption}`;
    }

    function getInputPrivacyAttrs(questionId, fieldType) {
      if (config.mode !== 'authenticated') return '';
      const token = fieldType || 'field';
      return ` autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" name="fp-auth-${token}-${questionId || 'lead'}"`;
    }

    function renderInput(question) {
      const questionId = String(question.id);
      const answer = state.answers[questionId];
      const settings = safeSettings(question.settings);
      const options = normalizeOptions(question.options);
      const placeholder = esc(question.placeholder || '');

      if (question.type === 'section' || question.type === 'content') {
        return `<div class="fp-content-block ${settings.variant === 'hero' ? 'fp-content-block-hero' : ''}">
          <div class="fp-content-body">${esc(settings.body || question.description || '')}</div>
        </div>`;
      }
      if (question.type === 'media') {
        return `<div class="fp-media-block">${renderMedia(settings)}</div>`;
      }
      if (question.type === 'short_text') {
        return `<input class="portal-input fp-text-input" data-question-id="${questionId}" type="text" value="${esc(answer || '')}" placeholder="${placeholder}"${getInputPrivacyAttrs(questionId, 'text')}>`;
      }
      if (question.type === 'long_text') {
        return `<textarea class="portal-input fp-textarea-input" data-question-id="${questionId}" rows="5" placeholder="${placeholder}"${getInputPrivacyAttrs(questionId, 'textarea')}>${esc(answer || '')}</textarea>`;
      }
      if (['number', 'currency', 'percentage'].includes(question.type)) {
        return `<input class="portal-input fp-text-input" data-question-id="${questionId}" type="number" value="${esc(answer || '')}" placeholder="${placeholder || '0'}"${getInputPrivacyAttrs(questionId, 'number')}>`;
      }
      if (question.type === 'date') {
        return `<input class="portal-input fp-text-input" data-question-id="${questionId}" type="date" value="${esc(answer || '')}"${getInputPrivacyAttrs(questionId, 'date')}>`;
      }
      if (question.type === 'dropdown') {
        return `<select class="portal-input fp-select-input" data-question-id="${questionId}"${getInputPrivacyAttrs(questionId, 'select')}>
          <option value="">Selecione...</option>
          ${options.map((option) => `<option value="${esc(option.value)}" ${String(answer || '') === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
        </select>`;
      }
      if (question.type === 'single_choice') {
        return `<div class="fp-choice-grid">
          ${options.map((option) => `<label class="fp-choice-card ${String(answer || '') === String(option.value) ? 'is-selected' : ''}">
            <input type="radio" name="fp-single-${questionId}" data-question-id="${questionId}" value="${esc(option.value)}" ${String(answer || '') === String(option.value) ? 'checked' : ''}>
            <span>${esc(option.label)}</span>
          </label>`).join('')}
        </div>`;
      }
      if (question.type === 'multi_choice' || question.type === 'checklist') {
        const selected = Array.isArray(answer) ? answer : [];
        return `<div class="fp-choice-grid fp-choice-grid-checklist">
          ${options.map((option) => `<label class="fp-choice-card ${selected.includes(option.value) ? 'is-selected' : ''}">
            <input type="checkbox" data-question-id="${questionId}" value="${esc(option.value)}" ${selected.includes(option.value) ? 'checked' : ''}>
            <span>${esc(option.label)}</span>
          </label>`).join('')}
        </div>`;
      }
      if (question.type === 'yes_no') {
        return `<div class="fp-binary-row">
          <button type="button" class="fp-pill-btn ${answer === 'Sim' ? 'active' : ''}" data-action="pick" data-question-id="${questionId}" data-value="Sim">Sim</button>
          <button type="button" class="fp-pill-btn ${answer === 'Não' ? 'active' : ''}" data-action="pick" data-question-id="${questionId}" data-value="Não">Não</button>
        </div>`;
      }
      if (question.type === 'scale' || question.type === 'nps') {
        const min = Number(settings.min || (question.type === 'nps' ? 0 : 1));
        const max = Number(settings.max || (question.type === 'nps' ? 10 : 5));
        return `<div>
          <div class="fp-scale-row">
            ${Array.from({ length: Math.max(max - min + 1, 0) }, (_item, index) => {
              const value = String(min + index);
              return `<button type="button" class="fp-scale-btn ${String(answer || '') === value ? 'active' : ''}" data-action="pick" data-question-id="${questionId}" data-value="${value}">${value}</button>`;
            }).join('')}
          </div>
          <div class="fp-scale-labels">
            <span>${esc(settings.label_min || '')}</span>
            <span>${esc(settings.label_max || '')}</span>
          </div>
        </div>`;
      }
      if (question.type === 'rating') {
        const max = Number(settings.max || 5);
        return `<div class="fp-rating-row">
          ${Array.from({ length: max }, (_item, index) => {
            const value = String(index + 1);
            return `<button type="button" class="fp-star-btn ${Number(answer || 0) >= index + 1 ? 'active' : ''}" data-action="pick" data-question-id="${questionId}" data-value="${value}">★</button>`;
          }).join('')}
        </div>`;
      }
      if (question.type === 'file_upload') {
        return `<div class="fp-upload-box">
          <input type="file" data-question-id="${questionId}">
          <div class="fp-upload-copy">${answer ? `Arquivo selecionado: ${esc(answer)}` : 'Escolha um arquivo para registrar o anexo.'}</div>
        </div>`;
      }
      if (question.type === 'calculated') {
        const result = computeFormula(question.formula);
        return `<div class="fp-score-card"><div class="fp-score-value">${result == null ? '—' : esc(result)}</div><div class="fp-score-meta">Campo calculado</div></div>`;
      }
      if (question.type === 'score') {
        const score = computeScoreSnapshot();
        return `<div class="fp-score-card"><div class="fp-score-value">${score.pct == null ? '—' : `${Math.round(score.pct)}%`}</div><div class="fp-score-meta">${score.total.toFixed(1)} / ${score.max} pontos</div></div>`;
      }
      return `<input class="portal-input fp-text-input" data-question-id="${questionId}" type="text" value="${esc(answer || '')}" placeholder="${placeholder}"${getInputPrivacyAttrs(questionId, 'text')}>`;
    }

    function renderQuestion(question) {
      const passive = ['section', 'content', 'media', 'score', 'calculated'].includes(question.type);
      return `<section class="fp-question-card-shell" data-question-shell="${question.id}">
        <div class="fp-question-head">
          <h3 class="fp-question-title">${esc(question.label || '')}${question.required && !passive ? ' <span class="fp-required-mark">*</span>' : ''}</h3>
          ${question.description ? `<div class="fp-question-description">${esc(question.description)}</div>` : ''}
        </div>
        <div class="fp-question-control">${renderInput(question)}</div>
        <div class="fp-question-error ui-hidden" data-question-error="${question.id}"></div>
      </section>`;
    }

    function renderLeadBlock() {
      if (!config.resolveLead) return '';
      const lead = state.lead || {};
      return `<section class="fp-lead-card">
        <div class="fp-lead-title">Identificação</div>
        <div class="fp-lead-grid">
          <input class="portal-input" data-lead-field="name" placeholder="Nome" value="${esc(lead.name || '')}"${getInputPrivacyAttrs('lead-name', 'text')}>
          <input class="portal-input" data-lead-field="email" placeholder="E-mail" value="${esc(lead.email || '')}"${getInputPrivacyAttrs('lead-email', 'email')}>
          <input class="portal-input" data-lead-field="company" placeholder="Empresa" value="${esc(lead.company || '')}"${getInputPrivacyAttrs('lead-company', 'text')}>
          <input class="portal-input" data-lead-field="phone" placeholder="Telefone" value="${esc(lead.phone || '')}"${getInputPrivacyAttrs('lead-phone', 'tel')}>
        </div>
      </section>`;
    }

    function renderCompletion() {
      const payload = state.completionPayload || {};
      const scorePct = payload.score_pct;
      return `<div class="fp-completion-card">
        <div class="fp-completion-kicker">Formulário concluído</div>
        <h2 class="fp-completion-title">Recebemos sua resposta.</h2>
        ${payload.thank_you_message ? `<div class="fp-inline-note">${esc(payload.thank_you_message)}</div>` : ''}
        ${scorePct != null ? `<div class="fp-completion-score">${Math.round(scorePct)}%</div>` : ''}
        ${payload.auto_report ? `<pre class="fp-completion-report">${esc(payload.auto_report)}</pre>` : ''}
        <div class="fp-completion-actions">
          <button type="button" class="btn-primary" data-action="close-runner">Fechar</button>
        </div>
      </div>`;
    }

    function render() {
      updateChrome();
      if (state.completed) {
        root.innerHTML = renderCompletion();
        return;
      }

      const step = getCurrentStep();
      const stepTitle = config.questionPerScreen ? (step?.page?.title || state.form?.title || '') : '';
      const intro = config.introRenderer ? config.introRenderer(state.form, step, state) : '';
      const leadBlock = renderLeadBlock();
      const questionsMarkup = (step?.questions || []).map(renderQuestion).join('') || '<div class="fp-inline-note">Nenhuma pergunta disponível nesta etapa.</div>';
      const canGoBack = state.currentIndex > 0;
      const isLastStep = state.currentIndex >= state.sequence.length - 1;

      root.innerHTML = `<div class="fp-stage-shell ${config.mode === 'public' ? 'fp-stage-shell-public' : ''}">
        ${stepTitle ? `<div class="fp-step-page-title">${esc(stepTitle)}</div>` : ''}
        ${intro || ''}
        ${leadBlock}
        <div class="fp-question-stack">${questionsMarkup}</div>
        <div class="fp-nav-row">
          <button type="button" class="btn-ghost" data-action="prev-step" ${canGoBack ? '' : 'disabled'}>Anterior</button>
          <div class="fp-nav-spacer"></div>
          <button type="button" class="btn-primary" data-action="${isLastStep ? 'submit-form' : 'next-step'}">${isLastStep ? config.submitLabel : 'Próximo'}</button>
        </div>
      </div>`;

      if (typeof config.onStateChange === 'function') {
        config.onStateChange(getSnapshot());
      }
    }

    function getSnapshot() {
      return {
        form: state.form,
        answers: clone(state.answers),
        current_page_id: state.currentPageId,
        response_id: state.responseId,
        step_index: state.currentIndex,
        step_count: state.sequence.length,
        lead: clone(state.lead),
      };
    }

    function validateCurrentStep() {
      let valid = true;
      const step = getCurrentStep();
      for (const question of (step?.questions || [])) {
        const passive = ['section', 'content', 'media', 'score', 'calculated'].includes(question.type);
        const errorEl = root.querySelector(`[data-question-error="${question.id}"]`);
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('ui-hidden');
        }
        if (!question.required || passive) continue;
        const value = state.answers[String(question.id)];
        const empty = Array.isArray(value) ? value.length === 0 : value == null || value === '';
        if (empty) {
          valid = false;
          if (errorEl) {
            errorEl.textContent = 'Resposta obrigatória.';
            errorEl.classList.remove('ui-hidden');
          }
        }
      }
      return valid;
    }

    async function persist(status) {
      if (!config.onPersist || state.saving) return;
      state.saving = true;
      setStatus(status === 'concluido' ? 'Enviando respostas...' : 'Salvando progresso...', 'info');
      try {
        let captchaToken = null;
        if (status === 'concluido' && config.resolveCaptchaToken) {
          captchaToken = await config.resolveCaptchaToken(getSnapshot());
          if (!captchaToken) throw new Error('Não foi possível validar o captcha.');
        }
        const payload = {
          ...getSnapshot(),
          status,
          visitor: config.resolveLead ? config.resolveLead(getSnapshot()) : null,
          captcha_token: captchaToken,
        };
        const result = await config.onPersist(payload);
        if (result?.response_id) state.responseId = result.response_id;
        if (status !== 'concluido') setStatus('Progresso salvo', 'success');
        return result;
      } catch (error) {
        setStatus(error?.message || 'Erro ao salvar', 'error');
        throw error;
      } finally {
        state.saving = false;
      }
    }

    function queueAutoSave() {
      if (!config.onPersist || !state.syncReady || state.completed) return;
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => {
        persist('em_andamento').catch(() => {});
      }, 700);
    }

    async function nextStep() {
      if (!validateCurrentStep()) return;
      await persist('em_andamento').catch(() => null);
      const jumpTarget = getJumpTargetIndex(getCurrentStep());
      if (jumpTarget != null) {
        state.currentIndex = jumpTarget;
      } else {
        state.currentIndex = Math.min(state.currentIndex + 1, state.sequence.length - 1);
      }
      state.currentPageId = getCurrentStep()?.page?.id || null;
      render();
    }

    function prevStep() {
      state.currentIndex = Math.max(state.currentIndex - 1, 0);
      state.currentPageId = getCurrentStep()?.page?.id || null;
      render();
    }

    async function submit() {
      if (!validateCurrentStep() || state.submitting) return;
      state.submitting = true;
      try {
        const persistResult = await persist('concluido');
        let submitResult = persistResult || null;
        if (config.onSubmit) {
          submitResult = await config.onSubmit({
            ...getSnapshot(),
            visitor: config.resolveLead ? config.resolveLead(getSnapshot()) : null,
          }, persistResult);
        }
        state.completed = true;
        state.completionPayload = submitResult || persistResult || {};
        setStatus('', '');
        render();
      } catch {
        state.submitting = false;
        return;
      }
      state.submitting = false;
    }

    function updateAnswer(questionId, value, rerender) {
      state.answers[String(questionId)] = value;
      rebuildVisibility();
      queueAutoSave();
      if (rerender !== false) render();
    }

    function handleInput(event) {
      const leadField = event.target?.dataset?.leadField;
      if (leadField) {
        state.lead[leadField] = event.target.value;
        queueAutoSave();
        return;
      }
      const questionId = event.target?.dataset?.questionId;
      if (!questionId) return;
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
        const question = getQuestion(questionId);
        if (!question) return;
        if (event.target.type === 'checkbox') return;
        if (question.type === 'number' || question.type === 'currency' || question.type === 'percentage') {
          updateAnswer(questionId, event.target.value === '' ? '' : Number(event.target.value), false);
          return;
        }
        updateAnswer(questionId, event.target.value, false);
      }
    }

    function handleChange(event) {
      const questionId = event.target?.dataset?.questionId;
      if (!questionId) return;
      if (event.target.type === 'radio') {
        updateAnswer(questionId, event.target.value);
      }
      if (event.target.type === 'checkbox') {
        const selected = Array.from(root.querySelectorAll(`input[type="checkbox"][data-question-id="${questionId}"]:checked`)).map((checkbox) => checkbox.value);
        updateAnswer(questionId, selected);
      }
      if (event.target.type === 'file') {
        const file = event.target.files?.[0];
        updateAnswer(questionId, file ? file.name : '');
      }
    }

    function handleClick(event) {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'pick') {
        updateAnswer(actionEl.dataset.questionId, actionEl.dataset.value);
        return;
      }
      if (action === 'prev-step') {
        prevStep();
        return;
      }
      if (action === 'next-step') {
        nextStep();
        return;
      }
      if (action === 'submit-form') {
        submit();
        return;
      }
      if (action === 'close-runner') {
        if (config.onClose) config.onClose(getSnapshot());
      }
    }

    function load(payload) {
      state.form = clone(payload.form || {});
      state.answers = {};
      for (const entry of (payload.existingResponse?.answers || payload.answers || [])) {
        if (entry && entry.question_id != null) {
          state.answers[String(entry.question_id)] = entry.value_json != null ? entry.value_json : entry.value;
        }
      }
      if (payload.answers && !Array.isArray(payload.answers)) {
        state.answers = { ...state.answers, ...clone(payload.answers) };
      }
      state.responseId = payload.existingResponse?.id || payload.response_id || null;
      state.lead = payload.lead || payload.existingResponse?.visitor || {};
      state.completed = payload.existingResponse?.status === 'completed';
      state.completionPayload = state.completed ? payload.existingResponse : null;
      rebuildVisibility();
      if (payload.existingResponse?.current_page_id) {
        const idx = state.sequence.findIndex((entry) => String(entry.page?.id) === String(payload.existingResponse.current_page_id));
        if (idx >= 0) state.currentIndex = idx;
      }
      state.currentPageId = getCurrentStep()?.page?.id || null;
      state.syncReady = true;
      render();
      if (config.onReady) config.onReady(getSnapshot());
    }

    function destroy() {
      clearTimeout(state.saveTimer);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('change', handleChange);
      root.removeEventListener('click', handleClick);
    }

    return {
      load,
      destroy,
      getSnapshot,
      setLead(nextLead) {
        state.lead = { ...state.lead, ...(nextLead || {}) };
      },
      close() {
        if (config.onClose) config.onClose(getSnapshot());
      },
    };
  }

  window.REFormRuntime = {
    createRunner,
  };
})();