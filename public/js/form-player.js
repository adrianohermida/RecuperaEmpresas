/**
 * form-player.js  — Client Form Player
 * Recupera Empresas | Professional Form Player with logic engine, scoring, auto-save
 *
 * API:
 *   loadClientForms()          — called by showSection('formularios')
 *   fpPlayForm(formId)         — open the player modal for a form
 */
'use strict';

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────────*/
function fpToken() { return localStorage.getItem('re_token'); }
function fpAuthH() { return { 'Content-Type':'application/json', 'Authorization':'Bearer '+fpToken() }; }

function fpEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fpToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log('[FP]', type, msg);
}

/* ──────────────────────────────────────────────────────────────────────────────
   State
──────────────────────────────────────────────────────────────────────────────*/
const FP = {
  forms:         [],    // assigned forms list
  currentForm:   null,  // full form object (pages, questions, logic)
  currentFormId: null,
  responseId:    null,  // active response ID
  currentPageIdx:0,     // current page index (visible pages array)
  visiblePages:  [],    // pages after applying logic
  answers:       {},    // { questionId: value }
  saving:        false,
  autoSaveTimer: null,
};

/* ──────────────────────────────────────────────────────────────────────────────
   Load forms list (client section)
──────────────────────────────────────────────────────────────────────────────*/
async function loadClientForms() {
  const el = document.getElementById('fp-forms-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando formulários...</div>';

  const res = await fetch('/api/my-forms', { headers: fpAuthH() });
  if (!res.ok) { el.innerHTML = '<div style="padding:24px;color:#EF4444;">Erro ao carregar formulários.</div>'; return; }
  FP.forms = await res.json();

  if (!FP.forms.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
      <div style="font-size:40px;margin-bottom:12px;">📋</div>
      <div style="font-size:15px;font-weight:600;color:#64748B;margin-bottom:8px;">Nenhum formulário atribuído</div>
      <div style="font-size:13px;">Quando seu consultor atribuir formulários, eles aparecerão aqui.</div>
    </div>`;
    return;
  }

  const TYPE_LABELS = { diagnostico:'Diagnóstico', pesquisa:'Pesquisa', avaliacao:'Avaliação', onboarding:'Onboarding', outro:'Outro' };
  const STATUS_MAP  = {
    nao_iniciado: { label:'Não iniciado', cls:'badge-gray',  icon:'⬜', btn:'Iniciar' },
    em_andamento: { label:'Em andamento', cls:'badge-blue',  icon:'⏳', btn:'Continuar' },
    concluido:    { label:'Concluído',    cls:'badge-green', icon:'✅', btn:'Ver resultado' },
  };

  el.innerHTML = FP.forms.map(f => {
    const st = STATUS_MAP[f.response_status] || STATUS_MAP.nao_iniciado;
    return `
    <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:flex;align-items:flex-start;gap:16px;transition:box-shadow .15s;"
         onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
      <div style="font-size:32px;flex-shrink:0;">${st.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="font-weight:700;font-size:15px;color:#1E293B;">${fpEsc(f.title)}</div>
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:2px;">${TYPE_LABELS[f.type] || f.type || ''}</div>
        ${f.description ? `<div style="font-size:13px;color:#64748B;margin-top:6px;line-height:1.5;">${fpEsc(f.description)}</div>` : ''}
        ${f.response_status === 'em_andamento' ? `
          <div style="margin-top:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:4px;">
              <span>Progresso</span><span>${f.response_progress || 0}%</span>
            </div>
            <div style="height:4px;background:#E2E8F0;border-radius:99px;overflow:hidden;">
              <div style="height:100%;background:#1A56DB;border-radius:99px;width:${f.response_progress||0}%;transition:width .3s;"></div>
            </div>
          </div>` : ''}
        ${f.response_status === 'concluido' && f.score_pct != null ? `
          <div style="margin-top:8px;font-size:13px;color:#16A34A;font-weight:600;">
            Pontuação: ${Math.round(f.score_pct)}%
          </div>` : ''}
      </div>
      <div style="flex-shrink:0;">
        <button class="btn-primary" style="font-size:13px;padding:8px 16px;" onclick="fpPlayForm(${f.id})">
          ${st.btn} →
        </button>
      </div>
    </div>`;
  }).join('');
}

/* ──────────────────────────────────────────────────────────────────────────────
   Open form player modal
──────────────────────────────────────────────────────────────────────────────*/
async function fpPlayForm(formId) {
  FP.currentFormId = formId;
  FP.answers       = {};
  FP.responseId    = null;
  FP.currentPageIdx= 0;

  // Open modal early, show loading
  const modal = document.getElementById('fp-player-modal');
  if (!modal) { fpToast('Player não disponível.','error'); return; }
  modal.style.display = 'flex';

  const content = document.getElementById('fp-player-content');
  if (content) content.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
    <div style="font-size:32px;margin-bottom:12px;">⏳</div>
    <div style="font-size:14px;">Carregando formulário...</div>
  </div>`;

  // Load full form
  const res = await fetch(`/api/my-forms/${formId}`, { headers: fpAuthH() });
  if (!res.ok) {
    if (content) content.innerHTML = '<div style="padding:40px;text-align:center;color:#EF4444;">Erro ao carregar formulário.</div>';
    return;
  }
  FP.currentForm = await res.json();

  // Restore any existing response
  if (FP.currentForm.existing_response) {
    const er = FP.currentForm.existing_response;
    FP.responseId = er.id;
    // Pre-fill answers
    (er.answers || []).forEach(a => {
      FP.answers[a.question_id] = a.value_json !== undefined ? a.value_json : a.value;
    });
  }

  // Build visible pages (apply logic to initial state)
  fpRebuildVisiblePages();

  // Find resume page
  if (FP.currentForm.existing_response?.current_page_id) {
    const cpId = FP.currentForm.existing_response.current_page_id;
    const idx  = FP.visiblePages.findIndex(p => p.id === cpId);
    if (idx >= 0) FP.currentPageIdx = idx;
  }

  // Render
  fpRenderPlayer();
}

function fpClosePlayer() {
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.style.display = 'none';
  clearTimeout(FP.autoSaveTimer);
  // Refresh forms list
  loadClientForms();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic engine — rebuild visible pages
──────────────────────────────────────────────────────────────────────────────*/
function fpRebuildVisiblePages() {
  const allPages = (FP.currentForm.pages || []).sort((a,b) => a.order_index - b.order_index);
  const logic    = FP.currentForm.logic || [];

  // Determine hidden questions first, then hidden pages
  const hiddenQIds   = new Set();
  const hiddenPageIds = new Set();

  logic.forEach(rule => {
    const srcQ   = fpFindQuestion(rule.source_question_id);
    if (!srcQ) return;
    const answer = FP.answers[rule.source_question_id];
    if (fpEvalCondition(answer, rule.operator, rule.condition_value)) {
      if (rule.action === 'hide_question' && rule.target_question_id)
        hiddenQIds.add(rule.target_question_id);
      if (rule.action === 'skip_to_page' && rule.target_page_id)
        hiddenPageIds.add(rule.target_page_id);
    }
  });

  FP.visiblePages = allPages.map(p => ({
    ...p,
    questions: (p.questions||[])
      .sort((a,b) => a.order_index - b.order_index)
      .filter(q => !hiddenQIds.has(q.id))
  })).filter(p => !hiddenPageIds.has(p.id));
}

function fpFindQuestion(qId) {
  for (const page of (FP.currentForm.pages||[])) {
    const q = (page.questions||[]).find(q => q.id === qId);
    if (q) return q;
  }
  return null;
}

function fpEvalCondition(answer, operator, condValue) {
  const a = answer == null ? '' : String(answer);
  const c = String(condValue);
  switch (operator) {
    case 'equals':        return a === c;
    case 'not_equals':    return a !== c;
    case 'contains':      return a.includes(c);
    case 'greater_than':  return parseFloat(a) > parseFloat(c);
    case 'less_than':     return parseFloat(a) < parseFloat(c);
    case 'is_answered':   return a.trim() !== '';
    case 'is_empty':      return a.trim() === '';
    default:              return false;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Render player
──────────────────────────────────────────────────────────────────────────────*/
function fpRenderPlayer() {
  const content = document.getElementById('fp-player-content');
  if (!content) return;

  const total   = FP.visiblePages.length;
  const idx     = Math.min(FP.currentPageIdx, total - 1);
  const page    = FP.visiblePages[idx];
  const pct     = total > 1 ? Math.round((idx / (total - 1)) * 100) : (idx === 0 ? 0 : 100);
  const isFirst = idx === 0;
  const isLast  = idx === total - 1;

  // Title
  const titleEl = document.getElementById('fp-player-title');
  if (titleEl) titleEl.textContent = FP.currentForm.title || 'Formulário';

  // Progress bar
  const pb = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = pct + '%';
  const pbLabel = document.getElementById('fp-player-progress-label');
  if (pbLabel) pbLabel.textContent = `Página ${idx+1} de ${total}`;

  if (!page) {
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#94A3B8;">Formulário sem páginas.</div>';
    return;
  }

  const questions = page.questions || [];

  content.innerHTML = `
    ${page.title ? `<div style="margin-bottom:20px;">
      <h2 style="font-size:20px;font-weight:700;color:#1E293B;margin:0 0 4px;">${fpEsc(page.title)}</h2>
      ${page.description ? `<div style="font-size:14px;color:#64748B;">${fpEsc(page.description)}</div>` : ''}
    </div>` : ''}
    <div id="fp-questions" style="display:flex;flex-direction:column;gap:24px;">
      ${questions.map(q => fpRenderQuestion(q)).join('')}
    </div>
    <!-- Nav -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:32px;padding-top:20px;border-top:1px solid #F1F5F9;">
      <button onclick="fpPrevPage()" class="btn-ghost"
        style="${isFirst ? 'visibility:hidden;' : ''}font-size:14px;padding:10px 20px;">
        ← Anterior
      </button>
      <button onclick="${isLast ? 'fpSubmitForm()' : 'fpNextPage()'}"
        class="btn-primary" id="fp-next-btn"
        style="font-size:14px;padding:10px 24px;">
        ${isLast ? '✅ Enviar formulário' : 'Próxima →'}
      </button>
    </div>
  `;

  // Wire up change handlers
  questions.forEach(q => fpWireQuestion(q));
  // Re-fill saved answers
  questions.forEach(q => fpRestoreAnswer(q));
}

/* ──────────────────────────────────────────────────────────────────────────────
   Question renderers
──────────────────────────────────────────────────────────────────────────────*/
function fpRenderQuestion(q) {
  const reqMark = q.required ? '<span style="color:#EF4444;margin-left:2px;">*</span>' : '';
  return `
  <div class="fp-question" id="fpq-${q.id}" style="display:flex;flex-direction:column;gap:8px;">
    ${q.type !== 'section' ? `
    <label style="font-size:15px;font-weight:600;color:#1E293B;line-height:1.4;">
      ${fpEsc(q.label)}${reqMark}
    </label>
    ${q.description ? `<div style="font-size:13px;color:#64748B;margin-top:-4px;">${fpEsc(q.description)}</div>` : ''}
    ` : `<div style="font-size:18px;font-weight:700;color:#1e3a5f;border-bottom:2px solid #E2E8F0;padding-bottom:8px;">${fpEsc(q.label)}</div>`}
    ${fpRenderInput(q)}
    <div id="fpq-err-${q.id}" style="display:none;font-size:12px;color:#EF4444;font-weight:500;"></div>
  </div>`;
}

function fpRenderInput(q) {
  const id = `fpinput-${q.id}`;
  switch (q.type) {
    case 'section': return '';
    case 'short_text':
      return `<input id="${id}" type="text" class="portal-input" placeholder="${fpEsc(q.placeholder||'')}" style="max-width:480px;">`;
    case 'long_text':
      return `<textarea id="${id}" class="portal-input" rows="4" placeholder="${fpEsc(q.placeholder||'')}" style="resize:vertical;"></textarea>`;
    case 'number':
      return `<input id="${id}" type="number" class="portal-input" placeholder="${fpEsc(q.placeholder||'0')}" style="max-width:200px;">`;
    case 'currency':
      return `<div style="display:flex;align-items:center;gap:8px;max-width:240px;">
        <span style="color:#64748B;font-size:14px;font-weight:600;">R$</span>
        <input id="${id}" type="number" min="0" step="0.01" class="portal-input" placeholder="0,00" style="flex:1;">
      </div>`;
    case 'percentage':
      return `<div style="display:flex;align-items:center;gap:8px;max-width:180px;">
        <input id="${id}" type="number" min="0" max="100" step="0.1" class="portal-input" placeholder="0" style="flex:1;">
        <span style="color:#64748B;font-size:14px;font-weight:600;">%</span>
      </div>`;
    case 'date':
      return `<input id="${id}" type="date" class="portal-input" style="max-width:220px;">`;
    case 'single_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div style="display:flex;flex-direction:column;gap:8px;" id="${id}-wrap">
        ${opts.map((o,i) => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s;"
            onmouseover="this.style.background='#F8FAFC'" onmouseout="if(!this.querySelector('input').checked)this.style.background=''"
            onclick="fpSelectRadio(this, '${id}', '${fpEsc(label)}')">
            <input type="radio" name="${id}" value="${fpEsc(label)}" style="width:16px;height:16px;flex-shrink:0;cursor:pointer;">
            <span style="font-size:14px;color:#1E293B;">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'multi_choice': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<div style="display:flex;flex-direction:column;gap:8px;" id="${id}-wrap">
        ${opts.map((o,i) => {
          const label = typeof o === 'string' ? o : (o.label || o);
          return `<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s;"
            onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background=''">
            <input type="checkbox" value="${fpEsc(label)}" data-mcq="${q.id}" style="width:16px;height:16px;flex-shrink:0;cursor:pointer;"
              onchange="fpCheckboxChange(${q.id})">
            <span style="font-size:14px;color:#1E293B;">${fpEsc(label)}</span>
          </label>`;
        }).join('')}
      </div>`;
    }
    case 'dropdown': {
      const opts = Array.isArray(q.options) ? q.options : [];
      return `<select id="${id}" class="portal-input" style="max-width:320px;">
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            style="min-width:36px;height:36px;border:1px solid #E2E8F0;border-radius:6px;background:#fff;color:#64748B;font-size:13px;cursor:pointer;transition:all .15s;font-weight:500;">
            ${v}
          </button>`).join('')}
        </div>
        ${s.label_min||s.label_max ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:#94A3B8;margin-top:4px;">
          <span>${fpEsc(s.label_min||'')}</span><span>${fpEsc(s.label_max||'')}</span>
        </div>` : ''}
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'nps': {
      const range = [];
      for (let i = 0; i <= 10; i++) range.push(i);
      return `<div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;" id="${id}-wrap">
          ${range.map(v => `<button type="button" data-scale="${q.id}" data-val="${v}"
            onclick="fpSelectScale(${q.id}, ${v})"
            style="min-width:36px;height:36px;border:1px solid #E2E8F0;border-radius:6px;background:#fff;font-size:13px;cursor:pointer;transition:all .15s;font-weight:500;color:${v<=6?'#EF4444':v<=8?'#F59E0B':'#16A34A'}">
            ${v}
          </button>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#94A3B8;margin-top:4px;">
          <span>Detrator</span><span>Promotor</span>
        </div>
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'rating': {
      return `<div style="display:flex;gap:4px;" id="${id}-wrap">
        ${[1,2,3,4,5].map(v => `<button type="button" data-rating="${q.id}" data-val="${v}"
          onclick="fpSelectRating(${q.id}, ${v})"
          style="font-size:28px;background:none;border:none;cursor:pointer;color:#E2E8F0;transition:color .1s;padding:2px;">★</button>`).join('')}
        <input type="hidden" id="${id}">
      </div>`;
    }
    case 'yes_no':
      return `<div style="display:flex;gap:10px;" id="${id}-wrap">
        <button type="button" data-yn="${q.id}" data-val="sim"
          onclick="fpSelectYesNo(${q.id}, 'sim')"
          style="padding:10px 28px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;font-size:14px;cursor:pointer;transition:all .15s;font-weight:500;">
          ✅ Sim
        </button>
        <button type="button" data-yn="${q.id}" data-val="nao"
          onclick="fpSelectYesNo(${q.id}, 'nao')"
          style="padding:10px 28px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;font-size:14px;cursor:pointer;transition:all .15s;font-weight:500;">
          ❌ Não
        </button>
        <input type="hidden" id="${id}">
      </div>`;
    case 'file_upload':
      return `<div style="border:2px dashed #CBD5E1;border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .15s;"
          onmouseover="this.style.borderColor='#1A56DB'" onmouseout="this.style.borderColor='#CBD5E1'"
          onclick="document.getElementById('${id}').click()">
        <div style="font-size:24px;margin-bottom:8px;">📎</div>
        <div style="font-size:13px;color:#64748B;">Clique para selecionar o arquivo</div>
        <input type="file" id="${id}" style="display:none;" onchange="fpFileChange(${q.id}, this)">
        <div id="fpfile-name-${q.id}" style="font-size:12px;color:#1A56DB;margin-top:8px;"></div>
      </div>`;
    case 'calculated':
      return `<div id="${id}-result" style="padding:12px 16px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;font-size:15px;font-weight:700;color:#16A34A;">
        Calculado automaticamente
      </div><input type="hidden" id="${id}">`;
    default:
      return `<input id="${id}" type="text" class="portal-input" placeholder="Resposta...">`;
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Wire change handlers
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
  // radio / checkbox / scale / rating / yes_no handled by onclick
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
      if (r.value === val) { r.checked = true; r.closest('label').style.background = '#EFF6FF'; r.closest('label').style.borderColor = '#1A56DB'; }
    });
  } else if (q.type === 'multi_choice') {
    const vals = Array.isArray(val) ? val : [];
    document.querySelectorAll(`input[data-mcq="${q.id}"]`).forEach(cb => {
      cb.checked = vals.includes(cb.value);
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
  // Reset all labels in this group
  document.querySelectorAll(`input[name="${inputName}"]`).forEach(r => {
    r.closest('label').style.background = '';
    r.closest('label').style.borderColor = '#E2E8F0';
  });
  labelEl.style.background = '#EFF6FF';
  labelEl.style.borderColor = '#1A56DB';
  const qId = parseInt(inputName.replace('fpinput-',''));
  FP.answers[qId] = value;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpCheckboxChange(qId) {
  const vals = [];
  document.querySelectorAll(`input[data-mcq="${qId}"]`).forEach(cb => {
    if (cb.checked) vals.push(cb.value);
  });
  FP.answers[qId] = vals;
  fpTriggerLogic();
  fpScheduleAutoSave();
}

function fpSelectScale(qId, val, skipSave) {
  const id = `fpinput-${qId}`;
  document.querySelectorAll(`button[data-scale="${qId}"]`).forEach(b => {
    const bv = parseInt(b.dataset.val);
    b.style.background  = bv === val ? '#1A56DB' : '#fff';
    b.style.color       = bv === val ? '#fff'    : '#64748B';
    b.style.borderColor = bv === val ? '#1A56DB' : '#E2E8F0';
  });
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectRating(qId, val, skipSave) {
  const id = `fpinput-${qId}`;
  document.querySelectorAll(`button[data-rating="${qId}"]`).forEach(b => {
    b.style.color = parseInt(b.dataset.val) <= val ? '#F59E0B' : '#E2E8F0';
  });
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = val;
  FP.answers[qId] = val;
  if (!skipSave) { fpTriggerLogic(); fpScheduleAutoSave(); }
}

function fpSelectYesNo(qId, val, skipSave) {
  document.querySelectorAll(`button[data-yn="${qId}"]`).forEach(b => {
    const bv = b.dataset.val;
    b.style.background  = bv === val ? '#1A56DB' : '#fff';
    b.style.color       = bv === val ? '#fff'    : '#64748B';
    b.style.borderColor = bv === val ? '#1A56DB' : '#E2E8F0';
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
  FP.answers[qId] = file.name; // actual upload would be a separate endpoint
  fpScheduleAutoSave();
}

/* ──────────────────────────────────────────────────────────────────────────────
   Logic — rebuild pages after each answer change
──────────────────────────────────────────────────────────────────────────────*/
function fpTriggerLogic() {
  fpRebuildVisiblePages();
  // Update progress bar without full re-render
  const total = FP.visiblePages.length;
  const idx   = Math.min(FP.currentPageIdx, total - 1);
  const pct   = total > 1 ? Math.round((idx / (total-1)) * 100) : 0;
  const pb    = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = pct + '%';
}

/* ──────────────────────────────────────────────────────────────────────────────
   Navigation
──────────────────────────────────────────────────────────────────────────────*/
function fpNextPage() {
  if (!fpValidatePage()) return;
  fpSaveProgress();
  FP.currentPageIdx = Math.min(FP.currentPageIdx + 1, FP.visiblePages.length - 1);
  fpRenderPlayer();
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.scrollTop = 0;
}

function fpPrevPage() {
  FP.currentPageIdx = Math.max(FP.currentPageIdx - 1, 0);
  fpRenderPlayer();
  const modal = document.getElementById('fp-player-modal');
  if (modal) modal.scrollTop = 0;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Validation
──────────────────────────────────────────────────────────────────────────────*/
function fpValidatePage() {
  const page = FP.visiblePages[FP.currentPageIdx];
  if (!page) return true;
  let valid = true;
  (page.questions||[]).forEach(q => {
    const errEl = document.getElementById(`fpq-err-${q.id}`);
    if (!q.required) { if(errEl) errEl.style.display='none'; return; }
    const val = FP.answers[q.id];
    const isEmpty = val == null || val === '' || (Array.isArray(val) && val.length === 0);
    if (isEmpty) {
      if (errEl) { errEl.textContent = 'Esta questão é obrigatória.'; errEl.style.display='block'; }
      // Highlight question
      const qEl = document.getElementById(`fpq-${q.id}`);
      if (qEl) { qEl.style.border = '1px solid #FCA5A5'; qEl.style.borderRadius = '8px'; qEl.style.padding = '12px'; }
      valid = false;
    } else {
      if (errEl) errEl.style.display='none';
      const qEl = document.getElementById(`fpq-${q.id}`);
      if (qEl) { qEl.style.border=''; qEl.style.padding=''; }
    }
  });
  if (!valid) { fpToast('Responda as questões obrigatórias antes de continuar.','error'); }
  return valid;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Auto-save progress
──────────────────────────────────────────────────────────────────────────────*/
function fpScheduleAutoSave() {
  clearTimeout(FP.autoSaveTimer);
  FP.autoSaveTimer = setTimeout(() => fpSaveProgress(), 2000);
}

async function fpSaveProgress() {
  if (FP.saving) return;
  FP.saving = true;
  try {
    const currentPage = FP.visiblePages[FP.currentPageIdx];
    const body = {
      answers:         FP.answers,
      current_page_id: currentPage?.id || null,
      status:          'em_andamento',
    };
    const res = await fetch(`/api/my-forms/${FP.currentFormId}/response`, {
      method: 'POST', headers: fpAuthH(), body: JSON.stringify(body)
    });
    if (res.ok) {
      const j = await res.json();
      FP.responseId = j.response_id || FP.responseId;
    }
  } catch(e) { /* silent */ }
  FP.saving = false;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Submit form
──────────────────────────────────────────────────────────────────────────────*/
async function fpSubmitForm() {
  if (!fpValidatePage()) return;

  const btn = document.getElementById('fp-next-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  try {
    const body = {
      answers: FP.answers,
      status:  'concluido',
    };
    const res = await fetch(`/api/my-forms/${FP.currentFormId}/response`, {
      method:'POST', headers: fpAuthH(), body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Erro ao enviar');
    const j = await res.json();
    fpShowCompletion(j);
  } catch(e) {
    fpToast('Erro ao enviar formulário. Tente novamente.','error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Enviar formulário'; }
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Completion screen
──────────────────────────────────────────────────────────────────────────────*/
function fpShowCompletion(data) {
  const content = document.getElementById('fp-player-content');
  if (!content) return;

  const score = data.score_pct != null ? Math.round(data.score_pct) : null;
  const CLASS_LBL = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };
  const CLASS_CLR = { saudavel:'#16A34A', risco_moderado:'#D97706', risco_alto:'#DC2626' };

  const pb = document.getElementById('fp-player-progress');
  if (pb) pb.style.width = '100%';

  content.innerHTML = `
    <div style="text-align:center;padding:32px 20px;">
      <div style="font-size:56px;margin-bottom:16px;">🎉</div>
      <h2 style="font-size:22px;font-weight:800;color:#1E293B;margin:0 0 8px;">Formulário enviado!</h2>
      <p style="font-size:15px;color:#64748B;margin:0 0 24px;">Suas respostas foram registradas com sucesso.</p>

      ${score != null ? `
      <div style="background:linear-gradient(135deg,#1e3a5f,#1A56DB);border-radius:16px;padding:24px;margin-bottom:24px;color:#fff;">
        <div style="font-size:48px;font-weight:900;margin-bottom:4px;">${score}%</div>
        <div style="font-size:15px;opacity:.85;margin-bottom:${data.score_classification?'12px':'0'};">Pontuação total: ${data.score_total||0} / ${data.score_max||0}</div>
        ${data.score_classification ? `<div style="display:inline-block;background:rgba(255,255,255,.2);border-radius:8px;padding:4px 16px;font-size:14px;font-weight:700;">${CLASS_LBL[data.score_classification]||data.score_classification}</div>` : ''}
      </div>` : ''}

      ${data.auto_report ? `
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
        <div style="font-size:13px;font-weight:700;color:#16A34A;margin-bottom:8px;">📄 Seu relatório de diagnóstico</div>
        <div style="font-size:13px;color:#166534;line-height:1.6;white-space:pre-wrap;">${fpEsc(data.auto_report)}</div>
      </div>` : ''}

      <button class="btn-primary" onclick="fpClosePlayer()" style="font-size:14px;padding:12px 28px;">
        ← Voltar ao portal
      </button>
    </div>
  `;

  // Hide nav
  const titleEl = document.getElementById('fp-player-title');
  if (titleEl) titleEl.textContent = 'Concluído';
}

/* ══════════════════════════════════════════════════════════════════════════════
   CLIENT JOURNEYS
══════════════════════════════════════════════════════════════════════════════*/

async function loadClientJourneys() {
  const el = document.getElementById('client-journeys-list');
  if (!el) return;

  // Show nav button only when there are journeys
  el.innerHTML = '<div style="padding:24px;color:#94A3B8;text-align:center;">Carregando...</div>';

  let journeys = [];
  try {
    const res = await fetch('/api/my-journeys', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (res.ok) journeys = await res.json();
  } catch {}

  // Show/hide sidebar button
  const btn = document.getElementById('jornadasSideLink');
  if (btn) btn.style.display = journeys.length ? '' : 'none';

  if (!journeys.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:#94A3B8;">
      <div style="font-size:36px;margin-bottom:12px;">🗺️</div>
      <div style="font-size:15px;font-weight:600;color:#64748B;margin-bottom:8px;">Nenhuma jornada atribuída</div>
      <div style="font-size:13px;">Sua consultoria ainda não atribuiu nenhuma jornada à sua conta.</div>
    </div>`;
    return;
  }

  const STATUS_LBL   = { active:'Em andamento', completed:'Concluída', paused:'Pausada', cancelled:'Cancelada' };
  const STATUS_COLOR = { active:'#1A56DB', completed:'#10B981', paused:'#F59E0B', cancelled:'#EF4444' };

  el.innerHTML = journeys.map(j => {
    const done  = j.steps.filter(s => s.completed).length;
    const total = j.steps.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;
    const stepsHtml = j.steps.map((s, i) => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;${i < j.steps.length-1 ? 'border-bottom:1px solid #F1F5F9;' : ''}">
        <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
             background:${s.completed ? '#10B981' : (i === j.current_step_index ? '#1A56DB' : '#E2E8F0')};
             color:${s.completed || i === j.current_step_index ? '#fff' : '#94A3B8'};">
          ${s.completed ? '✓' : i + 1}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${i === j.current_step_index && !s.completed ? '700' : '500'};color:${s.completed ? '#64748B' : '#1E293B'};
               ${s.completed ? 'text-decoration:line-through;' : ''}">
            ${fpEsc(s.title)}
          </div>
          ${s.re_forms ? `<div style="font-size:11px;color:#6366F1;margin-top:2px;">📋 ${fpEsc(s.re_forms.title)}</div>` : ''}
          ${i === j.current_step_index && !s.completed && s.re_forms
            ? `<button class="btn-primary" style="font-size:11px;padding:4px 12px;margin-top:6px;" onclick="fpOpenPlayer('${s.re_forms.id}')">Responder formulário →</button>`
            : ''}
        </div>
      </div>
    `).join('');

    return `
    <div class="portal-card" style="padding:0;overflow:hidden;">
      <div style="padding:16px 20px;background:linear-gradient(135deg,#1e3a5f,#1A56DB);color:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div style="font-size:16px;font-weight:700;">${fpEsc(j.journey_name)}</div>
          <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${STATUS_LBL[j.status] || j.status}</span>
        </div>
        ${j.journey_description ? `<div style="font-size:12px;opacity:.8;margin-bottom:8px;">${fpEsc(j.journey_description)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
          <div style="flex:1;height:6px;background:rgba(255,255,255,.25);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:#fff;border-radius:4px;transition:width .4s;"></div>
          </div>
          <span style="font-size:12px;opacity:.9;white-space:nowrap;">${done}/${total} etapas • ${pct}%</span>
        </div>
      </div>
      <div style="padding:4px 20px 16px;">
        ${stepsHtml || '<div style="padding:16px 0;color:#94A3B8;font-size:13px;">Nenhuma etapa configurada.</div>'}
      </div>
    </div>`;
  }).join('');
}
