'use strict';
/* builder-properties.js — Form Builder: painel de propriedades da questão */

function fbRenderPropertiesEmpty() {
  const panel = document.getElementById('fb-props-panel');
  if (!panel) return;
  panel.innerHTML = `<div class="fb-props-empty">
    <div class="fb-props-empty-icon">👈</div>
    <div class="fb-props-empty-copy">Clique em uma questão para editar suas propriedades</div>
  </div>`;
}

function fbRenderPropertiesPanel(qId) {
  const panel = document.getElementById('fb-props-panel');
  if (!panel) return;
  const questions = (FB.currentPage?.questions || []);
  const q = questions.find(x => x.id === qId);
  if (!q) { fbRenderPropertiesEmpty(); return; }

  const typeInfo = QB_TYPES.find(t => t.type === q.type) || { icon:'❓', label: q.type };

  panel.innerHTML = `
  <div class="fb-props-panel-inner">
    ${FB.readOnly ? '<div class="fb-props-readonly-banner">🔒 Somente leitura</div>' : ''}
    <div class="fb-props-type-badge">
      ${typeInfo.icon} ${typeInfo.label}
    </div>

    <!-- Label -->
    <div class="fb-prop-group">
      <label class="fb-prop-label">Título da questão</label>
      <input id="fp-label" class="fb-prop-input" value="${fbEsc(q.label)}" placeholder="Qual é a pergunta?"
        oninput="fbSavePropDebounced(${q.id})">
    </div>
    <!-- Description -->
    <div class="fb-prop-group">
      <label class="fb-prop-label">Descrição / dica</label>
      <input id="fp-description" class="fb-prop-input" value="${fbEsc(q.description||'')}" placeholder="Descrição opcional..."
        oninput="fbSavePropDebounced(${q.id})">
    </div>
    <!-- Placeholder -->
    ${['short_text','long_text','number','currency','percentage'].includes(q.type) ? `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Placeholder</label>
      <input id="fp-placeholder" class="fb-prop-input" value="${fbEsc(q.placeholder||'')}" placeholder="Texto de exemplo..."
        oninput="fbSavePropDebounced(${q.id})">
    </div>` : ''}
    <!-- Required -->
    <div class="fb-prop-group fb-prop-toggle-row">
      <label class="fb-prop-label fb-prop-label-inline">Obrigatório</label>
      <input type="checkbox" id="fp-required" ${q.required?'checked':''} onchange="fbSavePropDebounced(${q.id})"
        class="fb-prop-checkbox">
    </div>

    ${fbRenderTypeSpecificProps(q)}

    <!-- Scoring -->
    <div class="fb-props-section-divider">
      <div class="fb-props-section-title">Pontuação</div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Peso da questão</label>
        <input id="fp-weight" type="number" min="0" class="fb-prop-input" value="${q.weight||0}"
          oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>

    <!-- Buttons -->
    ${FB.readOnly ? '' : `<div class="fb-props-actions">
      <button class="btn-primary fb-props-action-btn" onclick="fbSaveQuestion(${q.id})">
        💾 Salvar questão
      </button>
      ${['single_choice','multi_choice','checklist','dropdown','scale','nps','rating'].includes(q.type) ? `
      <button class="btn-ghost fb-props-action-btn" onclick="fbOpenLogicEditor(${q.id})">
        🔀 Editar lógica condicional
      </button>` : ''}
    </div>`}
  </div>`;
}

function fbRenderTypeSpecificProps(q) {
  if (['single_choice','multi_choice','checklist','dropdown'].includes(q.type)) {
    const opts = Array.isArray(q.options) ? q.options : [];
    return `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Opções (uma por linha)</label>
      <textarea id="fp-options" class="fb-prop-input" rows="5"
        oninput="fbSavePropDebounced(${q.id})">${opts.map(o=>typeof o==='string'?o:(o.label||o)).join('\n')}</textarea>
    </div>`;
  }
  if (q.type === 'scale' || q.type === 'nps') {
    const s = q.settings || {};
    return `
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Mínimo</label>
        <input id="fp-scale-min" type="number" class="fb-prop-input" value="${s.min||1}" oninput="fbSavePropDebounced(${q.id})">
      </div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Máximo</label>
        <input id="fp-scale-max" type="number" class="fb-prop-input" value="${s.max||(q.type==='nps'?10:5)}" oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Label mínimo</label>
        <input id="fp-scale-lmin" class="fb-prop-input" value="${fbEsc(s.label_min||'')}" placeholder="Ex: Ruim" oninput="fbSavePropDebounced(${q.id})">
      </div>
      <div class="fb-prop-group">
        <label class="fb-prop-label">Label máximo</label>
        <input id="fp-scale-lmax" class="fb-prop-input" value="${fbEsc(s.label_max||'')}" placeholder="Ex: Ótimo" oninput="fbSavePropDebounced(${q.id})">
      </div>
    </div>`;
  }
  if (q.type === 'calculated') {
    return `
    <div class="fb-prop-group">
      <label class="fb-prop-label">Fórmula (use {question_id})</label>
      <textarea id="fp-formula" class="fb-prop-input" rows="3"
        oninput="fbSavePropDebounced(${q.id})"
        placeholder="Ex: {q1} * {q2} / 100">${fbEsc(q.formula||'')}</textarea>
    </div>`;
  }
  if (q.type === 'content') {
    const s = q.settings || {};
    return `
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Estilo</label>
        <select id="fp-content-variant" class="fb-prop-input" onchange="fbSavePropDebounced(${q.id})">
          <option value="text" ${s.variant === 'text' || !s.variant ? 'selected' : ''}>Texto</option>
          <option value="hero" ${s.variant === 'hero' ? 'selected' : ''}>Destaque</option>
        </select>
      </div>
    </div>
    <div class="fb-prop-group">
      <label class="fb-prop-label">Conteúdo</label>
      <textarea id="fp-content-body" class="fb-prop-input" rows="5" oninput="fbSavePropDebounced(${q.id})">${fbEsc(s.body || q.description || '')}</textarea>
    </div>`;
  }
  if (q.type === 'media') {
    const s = q.settings || {};
    return `
    <div class="fb-props-grid-2">
      <div class="fb-prop-group">
        <label class="fb-prop-label">Tipo de mídia</label>
        <select id="fp-media-type" class="fb-prop-input" onchange="fbSavePropDebounced(${q.id})">
          <option value="image" ${s.media_type === 'image' || !s.media_type ? 'selected' : ''}>Imagem</option>
          <option value="youtube" ${s.media_type === 'youtube' ? 'selected' : ''}>YouTube</option>
          <option value="pdf" ${s.media_type === 'pdf' ? 'selected' : ''}>PDF</option>
          <option value="attachment" ${s.media_type === 'attachment' ? 'selected' : ''}>Anexo</option>
        </select>
      </div>
    </div>
    <div class="fb-prop-group">
      <label class="fb-prop-label">URL</label>
      <input id="fp-media-url" class="fb-prop-input" value="${fbEsc(s.media_url || '')}" placeholder="https://..." oninput="fbSavePropDebounced(${q.id})">
    </div>
    <div class="fb-prop-group">
      <label class="fb-prop-label">Legenda</label>
      <input id="fp-media-caption" class="fb-prop-input" value="${fbEsc(s.caption || '')}" placeholder="Legenda opcional" oninput="fbSavePropDebounced(${q.id})">
    </div>`;
  }
  return '';
}
