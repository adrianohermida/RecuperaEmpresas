'use strict';
/* player-inputs.js — Form Player: renderização e wiring de inputs por tipo */

function fpRenderQuestion(q) {
  const reqMark = q.required ? '<span class="fp-question-required">*</span>' : '';
  return `
  <div class="fp-question" id="fpq-${q.id}">
    ${q.type !== 'section' ? `
    <label class="fp-question-label">
      ${fpEsc(q.label)}${reqMark}
    </label>
    ${q.description ? `<div class="fp-question-desc">${fpEsc(q.description)}</div>` : ''}
    ` : `<div class="fp-question-section">${fpEsc(q.label)}</div>`}
    ${fpRenderInput(q)}
    <div id="fpq-err-${q.id}" class="fp-question-error"></div>
  </div>`;
}

function fpRenderInput(q) {
  const id = `fpinput-${q.id}`;
  switch (q.type) {
    case 'section': return '';
    case 'short_text':
      return `<input id="${id}" type="text" class="portal-input fp-input-limit-lg" placeholder="${fpEsc(q.placeholder||'')}">`;
    case 'long_text':
      return `<textarea id="${id}" class="portal-input fp-input-textarea" rows="4" placeholder="${fpEsc(q.placeholder||'')}"></textarea>`;
    case 'number':
      return `<input id="${id}" type="number" class="portal-input fp-input-limit-sm" placeholder="${fpEsc(q.placeholder||'0')}">`;
    case 'currency':
      return `<div class="fp-inline-input fp-inline-input-md">
        <span class="fp-inline-input-prefix">R$</span>
        <input id="${id}" type="number" min="0" step="0.01" class="portal-input fp-inline-input-control" placeholder="0,00">
      </div>`;
    case 'percentage':
      return `<div class="fp-inline-input fp-inline-input-sm">
        <input id="${id}" type="number" min="0" max="100" step="0.1" class="portal-input fp-inline-input-control" placeholder="0">
        <span class="fp-inline-input-prefix">%</span>
      </div>`;
    case 'date':
      return `<input id="${id}" type="date" class="portal-input fp-input-limit-md">`;
    case 'single_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div class="fp-choice-list" id="${id}-wrap">
        ${opts.map(o => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label class="fp-choice-option"
            onclick="fpSelectRadio(this, '${id}', '${fpEsc(label)}')">
            <input type="radio" name="${id}" value="${fpEsc(label)}" class="fp-choice-input">
            <span class="fp-choice-copy">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'multi_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div class="fp-choice-list" id="${id}-wrap">
        ${opts.map(o => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label class="fp-choice-option">
            <input type="checkbox" value="${fpEsc(label)}" data-mcq="${q.id}" class="fp-choice-input"
              onchange="fpCheckboxChange(${q.id})">
            <span class="fp-choice-copy">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'dropdown': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<select id="${id}" class="portal-input fp-input-limit-select">
        <option value="">Selecione...</option>
        ${opts.map(o => { const l = typeof o==='string'?o:(o.label||o); return `<option value="${fpEsc(l)}">${fpEsc(l)}</option>`; }).join('')}
      </select>`;
    }
    case 'scale': {
      const s   = q.settings || {};
      const min = parseInt(s.min) || 1;
      const max = parseInt(s.max) || 10;
      const range = [];
      for (let i = min; i <= max; i++) range.push(i);
      return `<div>
        <div class="fp-scale-wrap fp-scale-wrap-default" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            class="fp-scale-btn">
            ${v}
          </button>`).join('')}
        </div>
        ${s.label_min||s.label_max ? `<div class="fp-scale-labels">
          <span>${fpEsc(s.label_min||'')}</span><span>${fpEsc(s.label_max||'')}</span>
        </div>` : ''}
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'nps': {
      const range = [];
      for (let i = 0; i <= 10; i++) range.push(i);
      return `<div>
        <div class="fp-scale-wrap fp-scale-wrap-nps" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            class="fp-scale-btn ${fpGetNpsToneClass(v)}">
            ${v}
          </button>`).join('')}
        </div>
        <div class="fp-scale-labels">
          <span>Detrator</span><span>Promotor</span>
        </div>
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'rating':
      return `<div class="fp-rating-wrap" id="${id}-wrap">
        ${[1,2,3,4,5].map(v => `<button type="button" data-rating="${q.id}" data-val="${v}"
          onclick="fpSelectRating(${q.id}, ${v})"
          class="fp-rating-btn">★</button>`).join('')}
        <input type="hidden" id="${id}">
      </div>`;
    case 'yes_no':
      return `<div class="fp-yesno-wrap" id="${id}-wrap">
        <button type="button" data-yn="${q.id}" data-val="sim"
          onclick="fpSelectYesNo(${q.id}, 'sim')"
          class="fp-yesno-btn">
          ${ICONS.check(16)} Sim
        </button>
        <button type="button" data-yn="${q.id}" data-val="nao"
          onclick="fpSelectYesNo(${q.id}, 'nao')"
          class="fp-yesno-btn">
          ${ICONS.x(16)} Não
        </button>
        <input type="hidden" id="${id}">
      </div>`;
    case 'file_upload':
      return `<div class="fp-upload-dropzone"
          onclick="document.getElementById('${id}').click()">
        <div class="fp-upload-icon">📎</div>
        <div class="fp-upload-copy">Clique para selecionar o arquivo</div>
        <input type="file" id="${id}" class="fp-upload-input" onchange="fpFileChange(${q.id}, this)">
        <div id="fpfile-name-${q.id}" class="fp-upload-file-name"></div>
      </div>`;
    case 'calculated':
      return `<div id="${id}-result" class="fp-calculated-result">
        Calculado automaticamente
      </div><input type="hidden" id="${id}">`;
    default:
      return `<input id="${id}" type="text" class="portal-input" placeholder="Resposta...">`;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Wire change handlers & restore saved answers
──────────────────────────────────────────────────────────────────────────────*/
function fpWireQuestion(q) {
  const id = `fpinput-${q.id}`;
  const el = document.getElementById(id);
  if (['short_text','long_text','number','currency','percentage','date','dropdown'].includes(q.type)) {
    if (el) el.addEventListener('input', () => {
      FP.answers[q.id] = el.value;
      fpTriggerLogic();
      fpScheduleAutoSave();
    });
  }
}

function fpRestoreAnswer(q) {
  const val = FP.answers[q.id];
  if (val == null) return;
  const id = `fpinput-${q.id}`;

  if (['short_text','long_text','number','currency','percentage','date'].includes(q.type)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  } else if (q.type === 'dropdown') {
    const el = document.getElementById(id);
    if (el) el.value = val;
  } else if (q.type === 'single_choice') {
    document.querySelectorAll(`input[name="${id}"]`).forEach(r => {
      if (r.value === val) {
        r.checked = true;
        r.closest('label')?.classList.add('fp-choice-option-selected');
      }
    });
  } else if (q.type === 'multi_choice') {
    const vals = Array.isArray(val) ? val : [];
    document.querySelectorAll(`input[data-mcq="${q.id}"]`).forEach(cb => {
      cb.checked = vals.includes(cb.value);
      cb.closest('label')?.classList.toggle('fp-choice-option-selected', cb.checked);
    });
  } else if (q.type === 'scale' || q.type === 'nps') {
    const el = document.getElementById(id);
    if (el) el.value = val;
    fpSelectScale(q.id, parseInt(val), true);
  } else if (q.type === 'rating') {
    fpSelectRating(q.id, parseInt(val), true);
  } else if (q.type === 'yes_no') {
    fpSelectYesNo(q.id, val, true);
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Input interaction helpers
──────────────────────────────────────────────────────────────────────────────*/
function fpSelectRadio(labelEl, inputName, value) {
  document.querySelectorAll(`input[name="${inputName}"]`).forEach(r => {
    r.closest('label')?.classList.remove('fp-choice-option-selected');
  });
  labelEl.classList.add('fp-choice-option-selected');
  const qId = parseInt(inputName.replace('fpinput-',''));
  FP.answers[qId] = value;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpCheckboxChange(qId) {
  const vals = [];
  document.querySelectorAll(`input[data-mcq="${qId}"]`).forEach(cb => {
    if (cb.checked) vals.push(cb.value);
    cb.closest('label')?.classList.toggle('fp-choice-option-selected', cb.checked);
  });
  FP.answers[qId] = vals;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpSelectScale(qId, val, skipSave) {
  document.querySelectorAll(`button[data-scale="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-scale-btn-active', parseInt(b.dataset.val) === val);
  });
  const hidden = document.getElementById(`fpinput-${qId}`);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectRating(qId, val, skipSave) {
  document.querySelectorAll(`button[data-rating="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-rating-btn-active', parseInt(b.dataset.val) <= val);
  });
  const hidden = document.getElementById(`fpinput-${qId}`);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectYesNo(qId, val, skipSave) {
  document.querySelectorAll(`button[data-yn="${qId}"]`).forEach(b => {
    b.classList.toggle('fp-yesno-btn-active', b.dataset.val === val);
  });
  const hidden = document.getElementById(`fpinput-${qId}`);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpFileChange(qId, input) {
  const file = input.files[0];
  if (!file) return;
  const nameEl = document.getElementById('fpfile-name-'+qId);
  if (nameEl) nameEl.textContent = file.name;
  FP.answers[qId] = file.name;
  fpScheduleAutoSave();
}

function fpGetNpsToneClass(value) {
  if (value <= 6) return 'fp-scale-btn-nps-low';
  if (value <= 8) return 'fp-scale-btn-nps-mid';
  return 'fp-scale-btn-nps-high';
}

function fpTriggerLogic() {
  fpRebuildVisiblePages();
  const total = FP.visiblePages.length;
  const idx   = Math.min(FP.currentPageIdx, total - 1);
  const pct   = total > 1 ? Math.round((idx / (total-1)) * 100) : 0;
  const pb    = document.getElementById('fp-player-progress');
  fpApplyPercentClass(pb, pct);
}
