'use strict';

/* ═══════════════════════════════════════════════════════════════
   Recupera Empresas — Onboarding App v2
   Auth + 14 etapas + per-step email + Freshdesk
═══════════════════════════════════════════════════════════════ */

const LS_KEY      = 'recupera_onboarding_v2';
let   TOTAL_STEPS = 14;

// Active step IDs — may be a subset of 1-14 if admin disabled some steps
let ACTIVE_STEP_IDS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14];

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getToken()   { return window.REShared.getStoredToken(); }
function getUser()    { return window.REShared.getStoredUser(); }
function authHeaders(extra = {}) {
  return window.REShared.buildAuthHeaders({ extra });
}

function logout() {
  window.REShared.clearStoredAuth({ keys: ['re_token', 're_user', LS_KEY] });
  window.location.href = 'login.html';
}

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  step: 1,
  data: {
    lgpd:        { concordo: false },
    empresa:     {},
    socios:      [{}],
    numSocios:   1,
    operacional: {},
    funcionarios:{},
    ativos:      {},
    financeiro:  {},
    dividas:     [{}],
    crise:       {},
    diagnostico: {},
    mercado:     {},
    expectativas:{},
    documentos:  {},
    responsavel: {},
    confirmacao: { declaro: false }
  },
  files: {}   // { fieldName: FileList }
};

// ─── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1,  title: 'Consentimento LGPD',       icon: '🔒' },
  { id: 2,  title: 'Dados da Empresa',          icon: '🏢' },
  { id: 3,  title: 'Sócios',                   icon: '👥' },
  { id: 4,  title: 'Estrutura Operacional',     icon: '⚙️'  },
  { id: 5,  title: 'Quadro de Funcionários',    icon: '👷' },
  { id: 6,  title: 'Ativos',                   icon: '🏭' },
  { id: 7,  title: 'Dados Financeiros',         icon: '💰' },
  { id: 8,  title: 'Dívidas e Credores',        icon: '📋' },
  { id: 9,  title: 'Histórico da Crise',        icon: '📉' },
  { id: 10, title: 'Diagnóstico Estratégico',   icon: '🧠' },
  { id: 11, title: 'Mercado e Operação',        icon: '📊' },
  { id: 12, title: 'Expectativas e Estratégia', icon: '🎯' },
  { id: 13, title: 'Documentos',               icon: '📁' },
  { id: 14, title: 'Confirmação e Envio',       icon: '✅' }
];

// ─── Masks ────────────────────────────────────────────────────────────────────
function maskCNPJ(v) {
  v = v.replace(/\D/g,'').slice(0,14);
  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5')
         .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/,'$1.$2.$3/$4')
         .replace(/^(\d{2})(\d{3})(\d{3})$/,'$1.$2.$3')
         .replace(/^(\d{2})(\d{3})$/,'$1.$2')
         .replace(/^(\d{2})$/,'$1');
}
function maskCPF(v) {
  v = v.replace(/\D/g,'').slice(0,11);
  return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4')
         .replace(/^(\d{3})(\d{3})(\d{3})$/,'$1.$2.$3')
         .replace(/^(\d{3})(\d{3})$/,'$1.$2')
         .replace(/^(\d{3})$/,'$1');
}
function maskPhone(v) {
  v = v.replace(/\D/g,'').slice(0,11);
  if (v.length === 11) return v.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');
  if (v.length >= 10)  return v.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');
  return v;
}
function maskCEP(v) {
  v = v.replace(/\D/g,'').slice(0,8);
  return v.replace(/^(\d{5})(\d{3})$/,'$1-$2');
}
function maskCurrency(v) {
  let n = v.replace(/\D/g,'');
  if (!n) return '';
  n = (parseInt(n,10)/100).toFixed(2);
  return 'R$ ' + n.replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
}
function parseCurrency(v) {
  return v.replace(/[^\d,]/g,'').replace(',','.');
}

function applyMask(el) {
  const type = el.dataset.mask;
  const raw = el.value;
  if (type === 'cnpj')     el.value = maskCNPJ(raw);
  else if (type === 'cpf') el.value = maskCPF(raw);
  else if (type === 'phone') el.value = maskPhone(raw);
  else if (type === 'cep')   el.value = maskCEP(raw);
  else if (type === 'currency') el.value = maskCurrency(raw);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function el(id)    { return document.getElementById(id); }
function qs(sel)   { return document.querySelector(sel); }
function qsa(sel)  { return document.querySelectorAll(sel); }

function showToast(msg, type = '', duration = 3000) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, duration);
}

// ─── Progress ─────────────────────────────────────────────────────────────────
function updateProgress(step) {
  // Position within active steps (1-based)
  const pos = ACTIVE_STEP_IDS.indexOf(step) + 1 || 1;
  const pct = Math.round(((pos - 1) / TOTAL_STEPS) * 100);
  el('progressLabel').textContent = `Etapa ${pos} de ${TOTAL_STEPS}`;
  el('progressPct').textContent   = `${pct}% concluído`;
  el('progressFill').style.width  = pct + '%';

  // dots — only show active steps
  const dots = el('stepsDots');
  dots.innerHTML = '';
  ACTIVE_STEP_IDS.forEach(id => {
    const s = STEPS[id - 1];
    const d = document.createElement('div');
    d.className = 'step-dot' + (id < step ? ' done' : id === step ? ' active' : '');
    d.title = s?.title || `Etapa ${id}`;
    dots.appendChild(d);
  });
}

// ─── Nav buttons state ────────────────────────────────────────────────────────
function updateNavButtons(step) {
  const back = el('btnBack');
  const next = el('btnNext');
  const isFirst = ACTIVE_STEP_IDS.indexOf(step) === 0;
  const isLast  = ACTIVE_STEP_IDS.indexOf(step) === ACTIVE_STEP_IDS.length - 1;
  back.style.visibility = isFirst ? 'hidden' : 'visible';
  if (isLast) {
    next.style.display = 'none';
  } else {
    next.style.display = '';
    next.innerHTML = 'Próximo <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
  }
}

// ─── Render dispatcher ───────────────────────────────────────────────────────
function renderStep(step) {
  const main = el('mainContent');
  main.innerHTML = '';

  const renderers = [
    null,
    renderStep1,  renderStep2,  renderStep3,  renderStep4,
    renderStep5,  renderStep6,  renderStep7,  renderStep8,
    renderStep9,  renderStep10, renderStep11, renderStep12,
    renderStep13, renderStep14
  ];

  if (renderers[step]) renderers[step](main);
  updateProgress(step);
  updateNavButtons(step);
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Attach mask listeners
  qsa('[data-mask]').forEach(inp => {
    inp.addEventListener('input', () => applyMask(inp));
  });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function card(content) {
  return `<div class="card">${content}</div>`;
}
function stepHeader(step, desc = '') {
  const s   = STEPS[step - 1];
  const pos = ACTIVE_STEP_IDS.indexOf(step) + 1 || step;
  // Config description overrides built-in desc
  const cfgStep    = window._formCfg?.steps?.find(x => x.id === step);
  const configDesc = cfgStep?.description || '';
  const finalDesc  = configDesc || desc;
  return `<div class="step-header">
    <div class="step-chip">Etapa ${pos} de ${TOTAL_STEPS}</div>
    <h1 class="step-title">${s.icon} ${s.title}</h1>
    ${finalDesc ? `<p class="step-desc">${finalDesc}</p>` : ''}
  </div>`;
}
function field(id, label, input, required = true, hint = '') {
  const req = required ? '<span class="req">*</span>' : '<span class="opt">(opcional)</span>';
  return `<div class="field" id="wrap_${id}">
    <label for="${id}">${label}${req}</label>
    ${input}
    ${hint ? `<span class="field-hint" style="font-size:12px;color:var(--text-muted);">${hint}</span>` : ''}
    <span class="field-error" id="err_${id}"></span>
  </div>`;
}
function textInput(id, placeholder = '', mask = '', extra = '') {
  return `<input type="text" id="${id}" name="${id}" placeholder="${placeholder}"
    ${mask ? `data-mask="${mask}"` : ''} ${extra} />`;
}
function emailInput(id, placeholder = '') {
  return `<input type="email" id="${id}" name="${id}" placeholder="${placeholder}" />`;
}
function telInput(id) {
  return `<input type="tel" id="${id}" name="${id}" placeholder="(00) 00000-0000" data-mask="phone" />`;
}
function selectInput(id, options, placeholder = 'Selecione...') {
  const opts = options.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  return `<select id="${id}" name="${id}"><option value="">${placeholder}</option>${opts}</select>`;
}
function radioGroup(name, options, valueKey, onChange = '') {
  return `<div class="radio-group" id="rg_${name}">
    ${options.map(([v,l]) => `
      <label class="radio-option${state.data[valueKey]?.[name] === v ? ' selected' : ''}"
             onclick="if(event.target.tagName==='INPUT')return; setRadio('${name}','${v}','${valueKey}',this.closest('.radio-group'))${onChange ? ';'+onChange : ''}">
        <input type="radio" name="${name}" value="${v}" ${state.data[valueKey]?.[name] === v ? 'checked' : ''}/>
        <span class="indicator"></span>${l}
      </label>`).join('')}
  </div>`;
}
function checkGroup(name, options, valueKey) {
  const cur = state.data[valueKey]?.[name] || [];
  return `<div class="check-group" id="cg_${name}">
    ${options.map(([v,l]) => `
      <label class="check-option${cur.includes(v) ? ' selected' : ''}"
             onclick="if(event.target.tagName==='INPUT')return; toggleCheck('${name}','${v}','${valueKey}',this)">
        <input type="checkbox" name="${name}" value="${v}" ${cur.includes(v) ? 'checked' : ''}/>
        <span class="indicator"></span>${l}
      </label>`).join('')}
  </div>`;
}

function setRadio(name, value, dataKey, group) {
  if (!state.data[dataKey]) state.data[dataKey] = {};
  state.data[dataKey][name] = value;
  group.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
  // find the option with matching value and mark it selected
  group.querySelectorAll('.radio-option').forEach(opt => {
    if (opt.querySelector('input')?.value === value) opt.classList.add('selected');
  });
  saveToLS();
}

function toggleCheck(name, value, dataKey, el) {
  if (!state.data[dataKey]) state.data[dataKey] = {};
  if (!state.data[dataKey][name]) state.data[dataKey][name] = [];
  const arr = state.data[dataKey][name];
  const idx = arr.indexOf(value);
  if (idx === -1) { arr.push(value); el.classList.add('selected'); }
  else            { arr.splice(idx,1); el.classList.remove('selected'); }
  saveToLS();
}

// ─── Step 1: LGPD ────────────────────────────────────────────────────────────
function renderStep1(main) {
  main.innerHTML = card(`
    ${stepHeader(1)}
    <div class="lgpd-box">
      <p><strong>Aviso de Privacidade — Recupera Empresas</strong></p>
      <br/>
      <p>Os dados fornecidos neste formulário serão utilizados <strong>exclusivamente</strong>
      para execução do Business Plan e das estratégias de reestruturação empresarial contratadas,
      em conformidade com a <strong>Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD)</strong>.</p>
      <br/>
      <p>As informações coletadas incluem dados da empresa, dados dos sócios/representantes legais,
      dados financeiros e documentos societários. Esses dados serão tratados com confidencialidade
      absoluta e não serão compartilhados com terceiros sem autorização expressa do titular.</p>
      <br/>
      <p>Você tem o direito de acessar, corrigir ou solicitar a exclusão de seus dados a qualquer momento
      pelo e-mail <strong>contato@recuperaempresas.com.br</strong>.</p>
    </div>
    <label class="consent-check${state.data.lgpd.concordo ? ' checked' : ''}" id="lgpdLabel"
           onclick="if(event.target.tagName==='INPUT')return; toggleLGPD()">
      <input type="checkbox" id="lgpdCheck" ${state.data.lgpd.concordo ? 'checked' : ''}/>
      <span class="consent-check-box" id="lgpdBox"></span>
      <span class="consent-check-text">
        Li e concordo com o tratamento dos meus dados conforme a LGPD para execução dos serviços contratados.
      </span>
    </label>
    <span class="field-error" id="err_lgpd"></span>
  `);
}

function toggleLGPD() {
  state.data.lgpd.concordo = !state.data.lgpd.concordo;
  const lbl = el('lgpdLabel');
  lbl.classList.toggle('checked', state.data.lgpd.concordo);
  saveToLS();
}

// ─── Step 2: Dados da Empresa ─────────────────────────────────────────────────
function renderStep2(main) {
  const d = state.data.empresa;
  const UF = [['AC','AC'],['AL','AL'],['AP','AP'],['AM','AM'],['BA','BA'],
    ['CE','CE'],['DF','DF'],['ES','ES'],['GO','GO'],['MA','MA'],['MT','MT'],
    ['MS','MS'],['MG','MG'],['PA','PA'],['PB','PB'],['PR','PR'],['PE','PE'],
    ['PI','PI'],['RJ','RJ'],['RN','RN'],['RS','RS'],['RO','RO'],['RR','RR'],
    ['SC','SC'],['SP','SP'],['SE','SE'],['TO','TO']];

  main.innerHTML = card(`
    ${stepHeader(2,'Dados cadastrais da empresa.')}
    <div class="form-grid">
      ${field('razaoSocial','Razão Social', textInput('razaoSocial','Nome jurídico completo'))}
      ${field('nomeFantasia','Nome Fantasia', textInput('nomeFantasia','Nome comercial'), false)}
      ${field('cnpj','CNPJ', textInput('cnpj','00.000.000/0001-00','cnpj'))}
      ${field('endereco','Endereço Completo', textInput('endereco','Rua, número, bairro, complemento'),'true')}
      <div class="field form-grid form-grid-3" style="gap:12px;">
        <div class="field" id="wrap_cidade">
          <label for="cidade">Cidade<span class="req">*</span></label>
          <input type="text" id="cidade" name="cidade" placeholder="Cidade"/>
          <span class="field-error" id="err_cidade"></span>
        </div>
        <div class="field" id="wrap_estado">
          <label for="estado">Estado<span class="req">*</span></label>
          ${selectInput('estado', UF, 'UF')}
          <span class="field-error" id="err_estado"></span>
        </div>
        <div class="field" id="wrap_cep">
          <label for="cep">CEP<span class="req">*</span></label>
          <input type="text" id="cep" name="cep" placeholder="00000-000" data-mask="cep"/>
          <span class="field-error" id="err_cep"></span>
        </div>
      </div>
      ${field('email2','E-mail da Empresa', emailInput('email2','empresa@dominio.com.br'))}
      ${field('tel2','Telefone', telInput('tel2'))}
    </div>
  `);

  // Fill saved values
  fillFields(['razaoSocial','nomeFantasia','cnpj','endereco','cidade','estado','cep','email2','tel2'], d, {
    email2: 'email', tel2: 'telefone'
  });
}

// ─── Step 3: Sócios ───────────────────────────────────────────────────────────
function renderStep3(main) {
  const num = state.data.numSocios || 1;
  let sociosHtml = '';
  for (let i = 0; i < num; i++) sociosHtml += buildSocioSection(i);

  main.innerHTML = card(`
    ${stepHeader(3,'Dados dos sócios e representantes legais.')}
    <div class="field" style="margin-bottom:20px;">
      <label>Quantos sócios/representantes legais?<span class="req">*</span></label>
      <div class="num-select">
        ${[1,2,3,4,5].map(n => `
          <button class="num-btn${num===n?' active':''}" onclick="setNumSocios(${n})">${n}</button>`).join('')}
        <button class="num-btn${num>5?' active':''}" onclick="setNumSocios(6)" title="6 ou mais">6+</button>
      </div>
    </div>
    <div id="sociosList">${sociosHtml}</div>
    ${num >= 6 ? '<p class="step-desc" style="margin-top:8px;">Para mais de 5 sócios, adicione os restantes manualmente:</p><button class="btn-add" onclick="addSocio()">+ Adicionar sócio</button>' : ''}
  `);

  for (let i = 0; i < num; i++) fillSocioFields(i);
}

function buildSocioSection(i) {
  return `<div class="repeat-section" id="socio_${i}">
    <div class="repeat-section-header">
      <span class="repeat-section-title">Sócio ${i+1}</span>
      ${i > 0 ? `<button class="btn-remove" onclick="removeSocio(${i})">Remover</button>` : ''}
    </div>
    <div class="form-grid form-grid-2">
      <div class="field field-full" id="wrap_s${i}_nome">
        <label>Nome Completo<span class="req">*</span></label>
        <input type="text" id="s${i}_nome" placeholder="Nome completo"/>
        <span class="field-error" id="err_s${i}_nome"></span>
      </div>
      <div class="field" id="wrap_s${i}_cpf">
        <label>CPF<span class="req">*</span></label>
        <input type="text" id="s${i}_cpf" placeholder="000.000.000-00" data-mask="cpf"/>
        <span class="field-error" id="err_s${i}_cpf"></span>
      </div>
      <div class="field" id="wrap_s${i}_dataNascimento">
        <label>Data de Nascimento<span class="req">*</span></label>
        <input type="date" id="s${i}_dataNascimento"/>
        <span class="field-error" id="err_s${i}_dataNascimento"></span>
      </div>
      <div class="field field-full" id="wrap_s${i}_endereco">
        <label>Endereço Completo<span class="req">*</span></label>
        <input type="text" id="s${i}_endereco" placeholder="Rua, número, bairro, cidade/UF"/>
        <span class="field-error" id="err_s${i}_endereco"></span>
      </div>
      <div class="field" id="wrap_s${i}_email">
        <label>E-mail<span class="req">*</span></label>
        <input type="email" id="s${i}_email" placeholder="email@dominio.com"/>
        <span class="field-error" id="err_s${i}_email"></span>
      </div>
      <div class="field" id="wrap_s${i}_telefone">
        <label>Telefone<span class="req">*</span></label>
        <input type="tel" id="s${i}_telefone" placeholder="(00) 00000-0000" data-mask="phone"/>
        <span class="field-error" id="err_s${i}_telefone"></span>
      </div>
      <div class="field" id="wrap_s${i}_participacao">
        <label>Participação (%)<span class="req">*</span></label>
        <input type="number" id="s${i}_participacao" placeholder="Ex: 50" min="0" max="100" step="0.01"/>
        <span class="field-error" id="err_s${i}_participacao"></span>
      </div>
      <div class="field" id="wrap_s${i}_cargo">
        <label>Cargo<span class="req">*</span></label>
        <input type="text" id="s${i}_cargo" placeholder="Ex: Diretor, Sócio-Administrador"/>
        <span class="field-error" id="err_s${i}_cargo"></span>
      </div>
    </div>
  </div>`;
}

function fillSocioFields(i) {
  const sc = state.data.socios[i] || {};
  const fields = ['nome','cpf','dataNascimento','endereco','email','telefone','participacao','cargo'];
  fields.forEach(f => {
    const inp = el(`s${i}_${f}`);
    if (inp && sc[f]) inp.value = sc[f];
    if (inp) inp.addEventListener('input', () => {
      if (!state.data.socios[i]) state.data.socios[i] = {};
      state.data.socios[i][f] = inp.value;
      saveToLS();
    });
  });
}

function setNumSocios(n) {
  state.data.numSocios = n;
  // Ensure socios array matches length
  while (state.data.socios.length < n) state.data.socios.push({});
  saveToLS();
  renderStep(3);
}

function addSocio() {
  state.data.socios.push({});
  state.data.numSocios = state.data.socios.length;
  saveToLS();
  renderStep(3);
}

function removeSocio(i) {
  state.data.socios.splice(i, 1);
  state.data.numSocios = state.data.socios.length;
  saveToLS();
  renderStep(3);
}

// ─── Step 4: Estrutura Operacional ────────────────────────────────────────────
function renderStep4(main) {
  const d = state.data.operacional;
  main.innerHTML = card(`
    ${stepHeader(4,'Informações sobre a operação e estrutura da empresa.')}
    <div class="form-grid">
      ${field('ramoAtividade','Ramo de Atividade',
        selectInput('ramoAtividade',[
          ['comercio','Comércio'],['industria','Indústria'],['servicos','Serviços'],
          ['agronegocio','Agronegócio'],['construcao','Construção Civil'],['outros','Outros']
        ]))}
      ${field('atividadePrincipal','Atividade Principal', textInput('atividadePrincipal','Descreva a atividade principal'))}
      ${field('tempoOperacao','Tempo de Operação',
        selectInput('tempoOperacao',[
          ['menos1','Menos de 1 ano'],['1a3','1 a 3 anos'],['3a5','3 a 5 anos'],
          ['5a10','5 a 10 anos'],['mais10','Mais de 10 anos']
        ]))}
      ${field('quantidadeUnidades','Quantidade de Unidades/Estabelecimentos',
        '<input type="number" id="quantidadeUnidades" name="quantidadeUnidades" min="1" placeholder="1"/>')}
      <div class="field">
        <label>Possui filiais?<span class="req">*</span></label>
        ${radioGroup('possuiFiliais',[['sim','Sim'],['nao','Não']],'operacional')}
        <span class="field-error" id="err_possuiFiliais"></span>
      </div>
      <div class="field field-full">
        <label for="descricaoOperacao">Descreva brevemente a operação<span class="req">*</span></label>
        <textarea id="descricaoOperacao" placeholder="Como a empresa opera, principais produtos/serviços, clientes atendidos..."></textarea>
        <span class="field-error" id="err_descricaoOperacao"></span>
      </div>
    </div>
  `);
  fillFields(['ramoAtividade','atividadePrincipal','tempoOperacao','quantidadeUnidades','descricaoOperacao'], d);
}

// ─── Step 5: Funcionários ─────────────────────────────────────────────────────
function renderStep5(main) {
  const d = state.data.funcionarios;
  main.innerHTML = card(`
    ${stepHeader(5,'Quadro atual de funcionários e situação trabalhista.')}
    <div class="form-grid">
      ${field('totalFunc','Total de Funcionários (CLT + terceirizados)',
        '<input type="number" id="totalFunc" name="totalFunc" min="0" placeholder="0"/>')}
      <div class="field form-grid form-grid-3" style="gap:12px;">
        <div class="field">
          <label for="fAdm">Administrativo</label>
          <input type="number" id="fAdm" min="0" placeholder="0"/>
        </div>
        <div class="field">
          <label for="fOpe">Operacional</label>
          <input type="number" id="fOpe" min="0" placeholder="0"/>
        </div>
        <div class="field">
          <label for="fCom">Comercial</label>
          <input type="number" id="fCom" min="0" placeholder="0"/>
        </div>
      </div>
      <div class="field">
        <label>Folha de pagamento em atraso?<span class="req">*</span></label>
        ${radioGroup('folhaEmAtraso',[['sim','Sim'],['nao','Não']],'funcionarios')}
        <span class="field-error" id="err_folhaEmAtraso"></span>
      </div>
      <div class="field">
        <label>Ações trabalhistas em andamento?<span class="req">*</span></label>
        ${radioGroup('acoesTrabalhistasAndamento',[['sim','Sim'],['nao','Não']],'funcionarios')}
        <span class="field-error" id="err_acoesTrabalhistasAndamento"></span>
      </div>
      <div class="field">
        <label>Houve demissões em massa nos últimos 12 meses?<span class="req">*</span></label>
        ${radioGroup('demissoesRecentes',[['sim','Sim'],['nao','Não']],'funcionarios','showDetalheDemissoes()')}
        <span class="field-error" id="err_demissoesRecentes"></span>
      </div>
      <div class="field field-full" id="detalheDemissoesWrap" style="${d.demissoesRecentes==='sim'?'':'display:none'}">
        <label for="detalheDemissoes">Detalhe as demissões<span class="req">*</span></label>
        <textarea id="detalheDemissoes" placeholder="Quantos, quando, motivo..."></textarea>
      </div>
    </div>
  `);
  const fm = { totalFunc:'total', fAdm:'administrativo', fOpe:'operacional', fCom:'comercial', detalheDemissoes:'detalheDemissoes' };
  fillFields(Object.keys(fm), d, fm);
}

function showDetalheDemissoes() {
  const wrap = el('detalheDemissoesWrap');
  if (wrap) wrap.style.display = state.data.funcionarios.demissoesRecentes === 'sim' ? '' : 'none';
}

// ─── Step 6: Ativos ───────────────────────────────────────────────────────────
function renderStep6(main) {
  const d = state.data.ativos;
  main.innerHTML = card(`
    ${stepHeader(6,'Máquinas, equipamentos e outros ativos relevantes.')}
    <div class="form-grid">
      <div class="field">
        <label>A empresa possui máquinas/equipamentos relevantes?<span class="req">*</span></label>
        ${radioGroup('possuiAtivos',[['sim','Sim'],['nao','Não']],'ativos','toggleAtivosDetails()')}
        <span class="field-error" id="err_possuiAtivos"></span>
      </div>
      <div id="ativosDetailsWrap" style="${d.possuiAtivos==='sim'?'':'display:none'}">
        <div class="form-grid">
          <div class="field field-full">
            <label for="descricaoAtivos">Descreva os principais ativos<span class="req">*</span></label>
            <textarea id="descricaoAtivos" placeholder="Tipo, modelo, estado de conservação..."></textarea>
            <span class="field-error" id="err_descricaoAtivos"></span>
          </div>
          <div class="field">
            <label for="estimativaValor">Estimativa de Valor Total<span class="req">*</span></label>
            <input type="text" id="estimativaValor" placeholder="R$ 0,00" data-mask="currency"/>
            <span class="field-error" id="err_estimativaValor"></span>
          </div>
          <div class="field">
            <label>Ativos financiados ou alienados?<span class="req">*</span></label>
            ${radioGroup('ativosFinanciadosAliendados',[['sim','Sim'],['nao','Não'],['parcial','Parcialmente']],'ativos')}
            <span class="field-error" id="err_ativosFinanciadosAliendados"></span>
          </div>
          <div class="field">
            <label>Existem ativos ociosos?<span class="req">*</span></label>
            ${radioGroup('ativosOciosos',[['sim','Sim'],['nao','Não']],'ativos','toggleAtivosOciosos()')}
            <span class="field-error" id="err_ativosOciosos"></span>
          </div>
          <div class="field field-full" id="ativosOciososWrap" style="${d.ativosOciosos==='sim'?'':'display:none'}">
            <label for="descricaoAtivosOciosos">Descreva os ativos ociosos</label>
            <textarea id="descricaoAtivosOciosos" placeholder="Quais ativos estão parados e por quê..."></textarea>
          </div>
        </div>
      </div>
    </div>
  `);
  fillFields(['descricaoAtivos','estimativaValor','descricaoAtivosOciosos'], d);
}

function toggleAtivosDetails() {
  const w = el('ativosDetailsWrap');
  if (w) w.style.display = state.data.ativos.possuiAtivos === 'sim' ? '' : 'none';
}
function toggleAtivosOciosos() {
  const w = el('ativosOciososWrap');
  if (w) w.style.display = state.data.ativos.ativosOciosos === 'sim' ? '' : 'none';
}

// ─── Step 7: Financeiro ───────────────────────────────────────────────────────
function renderStep7(main) {
  const d = state.data.financeiro;
  main.innerHTML = card(`
    ${stepHeader(7,'Situação financeira atual da empresa.')}
    <div class="form-grid">
      ${field('receitaMediaMensal','Receita Média Mensal (últimos 12 meses)',
        '<input type="text" id="receitaMediaMensal" placeholder="R$ 0,00" data-mask="currency"/>')}
      ${field('principaisFontesReceita','Principais Fontes de Receita',
        '<textarea id="principaisFontesReceita" placeholder="Ex: vendas a prazo, contratos recorrentes, serviços avulsos..."></textarea>')}
      ${field('custosFixosMensais','Custos Fixos Mensais',
        '<input type="text" id="custosFixosMensais" placeholder="R$ 0,00" data-mask="currency"/>')}
      ${field('custosVariaveis','Custos Variáveis Mensais (estimativa)',
        '<input type="text" id="custosVariaveis" placeholder="R$ 0,00" data-mask="currency"/>')}
      ${field('principaisDespesas','Principais Despesas',
        '<textarea id="principaisDespesas" placeholder="Ex: aluguel, folha, matéria-prima, fornecedores..."></textarea>')}
      <div class="field">
        <label>Possui controle financeiro sistemático?<span class="req">*</span></label>
        ${radioGroup('possuiControleFinanceiro',[['sim','Sim'],['nao','Não'],['parcial','Parcialmente']],'financeiro','toggleSistemaControle()')}
        <span class="field-error" id="err_possuiControleFinanceiro"></span>
      </div>
      <div class="field" id="sistemaControleWrap" style="${d.possuiControleFinanceiro==='sim'||d.possuiControleFinanceiro==='parcial'?'':'display:none'}">
        <label for="sistemaControle">Qual sistema ou método utiliza?</label>
        <input type="text" id="sistemaControle" placeholder="Ex: Excel, Conta Azul, Omie, planilha..."/>
      </div>
    </div>
  `);
  fillFields(['receitaMediaMensal','principaisFontesReceita','custosFixosMensais','custosVariaveis','principaisDespesas','sistemaControle'], d);
}

function toggleSistemaControle() {
  const w = el('sistemaControleWrap');
  const v = state.data.financeiro.possuiControleFinanceiro;
  if (w) w.style.display = (v === 'sim' || v === 'parcial') ? '' : 'none';
}

// ─── Step 8: Dívidas ──────────────────────────────────────────────────────────
function renderStep8(main) {
  let listHtml = state.data.dividas.map((d, i) => buildDividaSection(i)).join('');
  main.innerHTML = card(`
    ${stepHeader(8,'Liste todas as dívidas e credores da empresa.')}
    <div class="info-badge">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Inclua todas as dívidas: bancárias, fornecedores, tributos, trabalhistas e outras. Seja o mais completo possível.
    </div>
    <div id="dividasList">${listHtml}</div>
    <button class="btn-add" onclick="addDivida()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Adicionar nova dívida
    </button>
  `);
  state.data.dividas.forEach((_, i) => fillDividaFields(i));
}

function buildDividaSection(i) {
  return `<div class="repeat-section" id="divida_${i}">
    <div class="repeat-section-header">
      <span class="repeat-section-title">Dívida ${i+1}</span>
      ${i > 0 ? `<button class="btn-remove" onclick="removeDivida(${i})">Remover</button>` : ''}
    </div>
    <div class="form-grid form-grid-2">
      <div class="field" id="wrap_d${i}_nomeCredor">
        <label>Nome do Credor<span class="req">*</span></label>
        <input type="text" id="d${i}_nomeCredor" placeholder="Ex: Banco Bradesco, Receita Federal..."/>
        <span class="field-error" id="err_d${i}_nomeCredor"></span>
      </div>
      <div class="field">
        <label>Tipo de Dívida<span class="req">*</span></label>
        <select id="d${i}_tipoDivida">
          <option value="">Selecione...</option>
          <option value="banco">Banco / Instituição Financeira</option>
          <option value="fornecedor">Fornecedor</option>
          <option value="tributo">Tributo (Impostos/INSS)</option>
          <option value="trabalhista">Trabalhista</option>
          <option value="aluguel">Aluguel</option>
          <option value="outros">Outros</option>
        </select>
        <span class="field-error" id="err_d${i}_tipoDivida"></span>
      </div>
      <div class="field">
        <label>Valor Original<span class="req">*</span></label>
        <input type="text" id="d${i}_valorOriginal" placeholder="R$ 0,00" data-mask="currency"/>
        <span class="field-error" id="err_d${i}_valorOriginal"></span>
      </div>
      <div class="field">
        <label>Saldo Atual<span class="req">*</span></label>
        <input type="text" id="d${i}_saldoAtual" placeholder="R$ 0,00" data-mask="currency"/>
        <span class="field-error" id="err_d${i}_saldoAtual"></span>
      </div>
      <div class="field">
        <label>Possui garantia?<span class="req">*</span></label>
        <div class="radio-group">
          <label class="radio-option" onclick="if(event.target.tagName==='INPUT')return; setDividaRadio(${i},'possuiGarantia','sim',this)">
            <span class="indicator"></span>Sim
          </label>
          <label class="radio-option" onclick="if(event.target.tagName==='INPUT')return; setDividaRadio(${i},'possuiGarantia','nao',this)">
            <span class="indicator"></span>Não
          </label>
        </div>
        <span class="field-error" id="err_d${i}_possuiGarantia"></span>
      </div>
      <div class="field">
        <label>Está judicializada?<span class="req">*</span></label>
        <div class="radio-group" id="d${i}_judRG">
          <label class="radio-option" onclick="if(event.target.tagName==='INPUT')return; setDividaRadio(${i},'estaJudicializada','sim',this);toggleProcesso(${i})">
            <span class="indicator"></span>Sim
          </label>
          <label class="radio-option" onclick="if(event.target.tagName==='INPUT')return; setDividaRadio(${i},'estaJudicializada','nao',this);toggleProcesso(${i})">
            <span class="indicator"></span>Não
          </label>
        </div>
        <span class="field-error" id="err_d${i}_estaJudicializada"></span>
      </div>
      <div class="field field-full" id="d${i}_processoWrap" style="display:none">
        <label>Número do Processo <span class="opt">(opcional)</span></label>
        <input type="text" id="d${i}_numeroProcesso" placeholder="0000000-00.0000.0.00.0000"/>
      </div>
    </div>
  </div>`;
}

function fillDividaFields(i) {
  const d = state.data.dividas[i] || {};
  const flds = ['nomeCredor','tipoDivida','valorOriginal','saldoAtual','numeroProcesso'];
  flds.forEach(f => {
    const inp = el(`d${i}_${f}`);
    if (inp && d[f]) { inp.value = d[f]; }
    if (inp) inp.addEventListener('input', () => {
      if (!state.data.dividas[i]) state.data.dividas[i] = {};
      state.data.dividas[i][f] = inp.value;
      saveToLS();
    });
  });
  // Restore radio states
  ['possuiGarantia','estaJudicializada'].forEach(radio => {
    if (d[radio]) {
      const sec = el(`divida_${i}`);
      if (!sec) return;
      const opts = sec.querySelectorAll(`.radio-group`);
      opts.forEach(rg => {
        rg.querySelectorAll('.radio-option').forEach(opt => {
          const val = opt.textContent.trim() === 'Sim' ? 'sim' : 'nao';
          if (d[radio] === val) opt.classList.add('selected');
        });
      });
    }
  });
  if (d.estaJudicializada === 'sim') {
    const w = el(`d${i}_processoWrap`);
    if (w) w.style.display = '';
  }
}

function setDividaRadio(i, field, value, el) {
  if (!state.data.dividas[i]) state.data.dividas[i] = {};
  state.data.dividas[i][field] = value;
  el.closest('.radio-group').querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  saveToLS();
}

function toggleProcesso(i) {
  const w = el(`d${i}_processoWrap`);
  if (w) w.style.display = state.data.dividas[i]?.estaJudicializada === 'sim' ? '' : 'none';
}

function addDivida() {
  state.data.dividas.push({});
  saveToLS();
  renderStep(8);
}
function removeDivida(i) {
  state.data.dividas.splice(i, 1);
  saveToLS();
  renderStep(8);
}

// ─── Step 9: Histórico da Crise ───────────────────────────────────────────────
function renderStep9(main) {
  const d = state.data.crise;
  main.innerHTML = card(`
    ${stepHeader(9,'Entender a origem e evolução da crise é fundamental para o Business Plan.')}
    <div class="form-grid">
      ${field('inicioDificuldades','Quando a empresa começou a enfrentar dificuldades financeiras?',
        selectInput('inicioDificuldades',[
          ['menos6m','Menos de 6 meses'],['6a12m','6 a 12 meses'],
          ['1a2a','1 a 2 anos'],['2a3a','2 a 3 anos'],['mais3a','Mais de 3 anos']
        ]))}
      ${field('principaisEventos','Quais foram os principais eventos que levaram à crise?',
        '<textarea id="principaisEventos" placeholder="Descreva em detalhes os fatos que desencadearam as dificuldades..."></textarea>')}
      <div class="field field-full">
        <label>Causas da crise (marque todas que se aplicam)<span class="req">*</span></label>
        ${checkGroup('causasCrise',[
          ['queda_receita','Queda de Receita'],
          ['aumento_custos','Aumento de Custos'],
          ['endividamento','Endividamento Excessivo'],
          ['perda_clientes','Perda de Clientes/Contratos'],
          ['problema_gestao','Problema de Gestão'],
          ['crise_setor','Crise Setorial/Mercado'],
          ['pandemia','Impacto da Pandemia'],
          ['outros','Outros']
        ],'crise')}
        <span class="field-error" id="err_causasCrise"></span>
      </div>
      <div class="field">
        <label>Nos últimos 24 meses (marque o que ocorreu)</label>
        ${checkGroup('eventos24m',[
          ['queda_fat','Queda de faturamento'],
          ['aumento_divida','Aumento de dívida'],
          ['perda_contratos','Perda de contratos'],
          ['inadimplencia','Aumento de inadimplência de clientes'],
          ['reducao_equipe','Redução de equipe']
        ],'crise')}
      </div>
      <div class="field">
        <label>A empresa já tentou alguma reestruturação?<span class="req">*</span></label>
        ${radioGroup('tentouReestruturacao',[['sim','Sim'],['nao','Não']],'crise','toggleReestruturacao()')}
        <span class="field-error" id="err_tentouReestruturacao"></span>
      </div>
      <div class="field field-full" id="reestruturacaoWrap" style="${d.tentouReestruturacao==='sim'?'':'display:none'}">
        <label for="descricaoReestruturacao">Descreva a reestruturação tentada<span class="req">*</span></label>
        <textarea id="descricaoReestruturacao" placeholder="O que foi feito, quando, resultados obtidos..."></textarea>
      </div>
    </div>
  `);
  fillFields(['inicioDificuldades','principaisEventos','descricaoReestruturacao'], d);
}
function toggleReestruturacao() {
  const w = el('reestruturacaoWrap');
  if (w) w.style.display = state.data.crise.tentouReestruturacao === 'sim' ? '' : 'none';
}

// ─── Step 10: Diagnóstico Estratégico ─────────────────────────────────────────
function renderStep10(main) {
  const d = state.data.diagnostico;
  main.innerHTML = card(`
    ${stepHeader(10,'Sua visão estratégica sobre os problemas e oportunidades da empresa.')}
    <div class="info-badge">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Esta é uma das etapas mais importantes. Responda com sinceridade — suas respostas alimentarão diretamente o Business Plan.
    </div>
    <div class="form-grid">
      ${field('principalProblema','Na sua visão, qual é o principal problema da empresa hoje?',
        '<textarea id="principalProblema" placeholder="Descreva o que você considera o maior obstáculo atual..."></textarea>')}
      <div class="field field-full">
        <label>Quais áreas estão mais críticas? (marque todas que se aplicam)<span class="req">*</span></label>
        ${checkGroup('areasCriticas',[
          ['financeiro','Financeiro'],['comercial','Comercial/Vendas'],
          ['operacional','Operacional'],['rh','Recursos Humanos'],
          ['juridico','Jurídico'],['tecnologia','Tecnologia'],
          ['gestao','Gestão/Liderança'],['relacionamento','Relacionamento com clientes']
        ],'diagnostico')}
        <span class="field-error" id="err_areasCriticas"></span>
      </div>
      ${field('oqueFuncionaBem','O que ainda funciona bem na empresa?',
        '<textarea id="oqueFuncionaBem" placeholder="Pontos fortes, diferenciais que ainda existem..."></textarea>')}
      <div class="field">
        <label>Existe alguma unidade, produto ou área lucrativa?<span class="req">*</span></label>
        ${radioGroup('existeUnidadeLucrativa',[['sim','Sim'],['nao','Não'],['talvez','Incerto']],'diagnostico','toggleUnidadeLucrativa()')}
      </div>
      <div class="field field-full" id="unidadeLucrativaWrap" style="${d.existeUnidadeLucrativa==='sim'?'':'display:none'}">
        <label for="descricaoUnidade">Descreva qual área/produto ainda é lucrativo</label>
        <textarea id="descricaoUnidade" placeholder="Nome, faturamento aproximado, margem..."></textarea>
      </div>
      ${field('deveSerEncerrado','Na sua avaliação, existe algo que deveria ser encerrado ou descontinuado?',
        '<textarea id="deveSerEncerrado" placeholder="Produtos, serviços, unidades, filiais que estão drenando recursos..."></textarea>', false)}
    </div>
  `);
  fillFields(['principalProblema','oqueFuncionaBem','descricaoUnidade','deveSerEncerrado'], d);
}
function toggleUnidadeLucrativa() {
  const w = el('unidadeLucrativaWrap');
  if (w) w.style.display = state.data.diagnostico.existeUnidadeLucrativa === 'sim' ? '' : 'none';
}

// ─── Step 11: Mercado e Operação ──────────────────────────────────────────────
function renderStep11(main) {
  const d = state.data.mercado;
  main.innerHTML = card(`
    ${stepHeader(11,'Contexto de mercado e posicionamento da empresa.')}
    <div class="form-grid">
      ${field('principaisClientes','Quem são seus principais clientes?',
        '<textarea id="principaisClientes" placeholder="Perfil, segmento, localização, ticket médio..."></textarea>')}
      <div class="field">
        <label>Existe concentração de receita em poucos clientes?<span class="req">*</span></label>
        ${radioGroup('concentracaoReceita',[['sim','Sim'],['nao','Não'],['parcial','Parcialmente']],'mercado')}
        <span class="field-error" id="err_concentracaoReceita"></span>
      </div>
      <div class="field">
        <label>A empresa depende de poucos contratos/pedidos grandes?<span class="req">*</span></label>
        ${radioGroup('dependenciaContratos',[['sim','Sim'],['nao','Não']],'mercado')}
        <span class="field-error" id="err_dependenciaContratos"></span>
      </div>
      ${field('demandaMercado','Como está a demanda do mercado pelo seu produto/serviço?',
        selectInput('demandaMercado',[
          ['alta','Alta / Crescendo'],['estavel','Estável'],
          ['queda','Em queda'],['muito_baixa','Muito baixa / Estagnada']
        ]))}
      <div class="field">
        <label>Existe potencial real de crescimento?<span class="req">*</span></label>
        ${radioGroup('potencialCrescimento',[['sim','Sim'],['nao','Não'],['talvez','Depende de condições']],'mercado','togglePotencial()')}
        <span class="field-error" id="err_potencialCrescimento"></span>
      </div>
      <div class="field field-full" id="potencialWrap" style="${d.potencialCrescimento==='sim'||d.potencialCrescimento==='talvez'?'':'display:none'}">
        <label for="descricaoPotencial">Descreva o potencial de crescimento</label>
        <textarea id="descricaoPotencial" placeholder="Mercados não atendidos, novos produtos, expansão geográfica..."></textarea>
      </div>
    </div>
  `);
  fillFields(['principaisClientes','demandaMercado','descricaoPotencial'], d);
}
function togglePotencial() {
  const w = el('potencialWrap');
  const v = state.data.mercado.potencialCrescimento;
  if (w) w.style.display = (v === 'sim' || v === 'talvez') ? '' : 'none';
}

// ─── Step 12: Expectativas e Estratégia ──────────────────────────────────────
function renderStep12(main) {
  main.innerHTML = card(`
    ${stepHeader(12,'Objetivos e disposição para as medidas necessárias.')}
    <div class="form-grid">
      <div class="field field-full">
        <label>Qual o objetivo com o Business Plan? (marque todos que se aplicam)<span class="req">*</span></label>
        ${checkGroup('objetivoPlano',[
          ['sobreviver','Sobreviver / Evitar falência'],
          ['estabilizar','Estabilizar a operação'],
          ['crescer','Retomar crescimento'],
          ['rj','Entrar em Recuperação Judicial'],
          ['venda','Preparar empresa para venda'],
          ['negociacao','Negociar dívidas extrajudicialmente']
        ],'expectativas')}
        <span class="field-error" id="err_objetivoPlano"></span>
      </div>
      <div class="field field-full">
        <label>Está disposto a adotar as seguintes medidas? (marque todas que aceita)<span class="req">*</span></label>
        ${checkGroup('dispostoA',[
          ['reduzir_custos','Reduzir custos operacionais'],
          ['vender_ativos','Vender ativos'],
          ['renegociar','Renegociar dívidas'],
          ['mudar_operacao','Mudar modelo de operação'],
          ['demitir','Reduzir quadro de funcionários'],
          ['aporte','Aportar capital próprio'],
          ['captar','Buscar investidor/sócio']
        ],'expectativas')}
        <span class="field-error" id="err_dispostoA"></span>
      </div>
      <div class="field">
        <label>Interesse em Recuperação Judicial?<span class="req">*</span></label>
        <div class="radio-group" id="rg_interesseRJ">
          ${[['sim','Sim, tenho interesse'],['nao','Não tenho interesse'],['avaliando','Estou avaliando']].map(([v,l]) => `
            <label class="radio-option${state.data.expectativas?.interesseRJ===v?' selected':''}"
                   onclick="if(event.target.tagName==='INPUT')return; setRadio('interesseRJ','${v}','expectativas',this.closest('.radio-group'))">
              <input type="radio" value="${v}" ${state.data.expectativas?.interesseRJ===v?'checked':''}/>
              <span class="indicator"></span>${l}
            </label>`).join('')}
        </div>
        <span class="field-error" id="err_interesseRJ"></span>
      </div>
    </div>
  `);
}

// ─── Step 13: Documentos ──────────────────────────────────────────────────────
function renderStep13(main) {
  main.innerHTML = card(`
    ${stepHeader(13,'Faça o upload dos documentos da empresa.')}
    <div class="info-badge">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Formatos aceitos: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP. Tamanho máximo: 20 MB por arquivo.
    </div>
    ${buildUploadGroup('balanco','Balanço Patrimonial (últimos 2 anos)',true)}
    ${buildUploadGroup('dre','DRE — Demonstração de Resultado (últimos 2 anos)',true)}
    ${buildUploadGroup('extratos','Extratos Bancários (últimos 6 meses)',true)}
    ${buildUploadGroup('contratos','Contratos Relevantes (financiamentos, locações, clientes)',false)}
  `);

  ['balanco','dre','extratos','contratos'].forEach(name => {
    const input = el(`file_${name}`);
    if (!input) return;
    const area = el(`area_${name}`);
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('dragover');
      handleFiles(name, e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleFiles(name, input.files));
    renderFileList(name);
  });
}

function buildUploadGroup(name, label, required) {
  return `<div class="upload-group">
    <div class="upload-group-label">${label}${required ? '<span class="req"> *</span>' : ' <span class="opt">(opcional)</span>'}</div>
    <div class="upload-area" id="area_${name}">
      <input type="file" id="file_${name}" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar"/>
      <div class="upload-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div class="upload-label">Clique ou arraste os arquivos aqui</div>
      <div class="upload-hint">Múltiplos arquivos permitidos</div>
    </div>
    <div class="file-list" id="list_${name}"></div>
    <span class="field-error" id="err_${name}"></span>
  </div>`;
}

function handleFiles(name, newFiles) {
  if (!state.files[name]) state.files[name] = [];
  Array.from(newFiles).forEach(f => state.files[name].push(f));
  renderFileList(name);
}

function renderFileList(name) {
  const list = el(`list_${name}`);
  if (!list) return;
  const files = state.files[name] || [];
  list.innerHTML = files.map((f, i) => `
    <div class="file-item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="file-item-name">${f.name}</span>
      <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${(f.size/1024/1024).toFixed(1)} MB</span>
      <button class="file-remove" onclick="removeFile('${name}',${i})" title="Remover">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`).join('');
}

function removeFile(name, idx) {
  state.files[name].splice(idx, 1);
  renderFileList(name);
}

// ─── Step 14: Confirmação ─────────────────────────────────────────────────────
function renderStep14(main) {
  const d    = state.data.responsavel;
  const user = getUser();
  // Determine if "sou o responsavel" is checked: true if not explicitly set to false
  const souResp = state.data.responsavel._souResponsavel !== false;

  main.innerHTML = card(`
    ${stepHeader(14,'Responsável pelo projeto e confirmação final.')}
    <p class="section-group-title">Responsável pelo Projeto</p>

    <label class="confirm-checkbox${souResp?' checked':''}" id="souRespLabel"
           onclick="if(event.target.tagName==='INPUT')return; toggleSouResponsavel()">
      <input type="checkbox" id="souRespCheck" ${souResp?'checked':''}/>
      <span class="confirm-cb-box"></span>
      <span><strong>Sou o responsável pelo projeto</strong> — usar meus dados de cadastro</span>
    </label>

    <div id="respFields" style="${souResp?'display:none':''}">
      <div class="form-grid form-grid-2" style="margin-top:16px;">
        <div class="field" id="wrap_rNome">
          <label for="rNome">Nome Completo<span class="req">*</span></label>
          <input type="text" id="rNome" placeholder="Nome do responsável"/>
          <span class="field-error" id="err_rNome"></span>
        </div>
        <div class="field" id="wrap_rCargo">
          <label for="rCargo">Cargo<span class="req">*</span></label>
          <input type="text" id="rCargo" placeholder="Ex: Diretor, Sócio-Gerente"/>
          <span class="field-error" id="err_rCargo"></span>
        </div>
        <div class="field" id="wrap_rEmail">
          <label for="rEmail">E-mail<span class="req">*</span></label>
          <input type="email" id="rEmail" placeholder="email@empresa.com.br"/>
          <span class="field-error" id="err_rEmail"></span>
        </div>
        <div class="field" id="wrap_rTel">
          <label for="rTel">Telefone<span class="req">*</span></label>
          <input type="tel" id="rTel" placeholder="(00) 00000-0000" data-mask="phone"/>
          <span class="field-error" id="err_rTel"></span>
        </div>
      </div>
    </div>

    <hr class="divider"/>
    <div class="confirm-box">
      <strong>⚠️ Atenção:</strong> Ao enviar este formulário, você confirma que todas as informações prestadas
      são verídicas e que possui poderes para representar a empresa neste processo.
    </div>
    <label class="confirm-checkbox${state.data.confirmacao.declaro?' checked':''}" id="declaroLabel"
           onclick="if(event.target.tagName==='INPUT')return; toggleDeclaro()">
      <input type="checkbox" id="declaroCheck" ${state.data.confirmacao.declaro?'checked':''}/>
      <span class="confirm-cb-box" id="declaroCbBox"></span>
      <span>
        <strong>Declaro que as informações fornecidas são verdadeiras</strong> e que possuo autorização
        para compartilhar os dados e documentos desta empresa com a equipe Recupera Empresas.
      </span>
    </label>
    <span class="field-error" id="err_declaro"></span>
    <div class="submit-btn-wrapper">
      <button class="btn-submit" id="btnSubmit" onclick="submitForm()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Enviar informações
      </button>
    </div>
  `);

  // If "sou o responsavel", pre-fill from logged user
  if (souResp) {
    state.data.responsavel.nome     = user.name  || '';
    state.data.responsavel.email    = user.email || '';
    state.data.responsavel.cargo    = state.data.responsavel.cargo || '';
    state.data.responsavel.telefone = state.data.responsavel.telefone || '';
  }

  // Wire up manual fields
  const fieldMap = { rNome:'nome', rCargo:'cargo', rEmail:'email', rTel:'telefone' };
  Object.entries(fieldMap).forEach(([id, key]) => {
    const inp = el(id);
    if (!inp) return;
    if (d[key]) inp.value = d[key];
    inp.addEventListener('input', () => { state.data.responsavel[key] = inp.value; saveToLS(); });
  });
}

function toggleSouResponsavel() {
  const user = getUser();
  const checked = !el('souRespCheck').checked; // will be toggled
  state.data.responsavel._souResponsavel = !checked; // store inverse so default=true

  const lbl    = el('souRespLabel');
  const fields = el('respFields');

  if (checked) {
    // Switching ON: auto-fill from user
    state.data.responsavel.nome  = user.name  || '';
    state.data.responsavel.email = user.email || '';
    lbl.classList.add('checked');
    if (fields) fields.style.display = 'none';
  } else {
    // Switching OFF: show manual fields
    lbl.classList.remove('checked');
    if (fields) fields.style.display = '';
    // Re-wire inputs after show
    const fieldMap = { rNome:'nome', rCargo:'cargo', rEmail:'email', rTel:'telefone' };
    Object.entries(fieldMap).forEach(([id, key]) => {
      const inp = el(id);
      if (!inp) return;
      if (state.data.responsavel[key]) inp.value = state.data.responsavel[key];
      inp.addEventListener('input', () => { state.data.responsavel[key] = inp.value; saveToLS(); });
    });
  }
  saveToLS();
}

function toggleDeclaro() {
  state.data.confirmacao.declaro = !state.data.confirmacao.declaro;
  const lbl = el('declaroLabel');
  if (lbl) lbl.classList.toggle('checked', state.data.confirmacao.declaro);
  saveToLS();
}

// ─── Collect step data from DOM ───────────────────────────────────────────────
function collectStepData(step) {
  if (step === 2) {
    const d = state.data.empresa;
    collectFields(['razaoSocial','nomeFantasia','cnpj','endereco','cidade','estado','cep'], d);
    d.email = el('email2')?.value || '';
    d.telefone = el('tel2')?.value || '';
  }
  if (step === 3) {
    const num = state.data.numSocios || 1;
    for (let i = 0; i < num; i++) {
      if (!state.data.socios[i]) state.data.socios[i] = {};
      const sc = state.data.socios[i];
      ['nome','cpf','dataNascimento','endereco','email','telefone','participacao','cargo'].forEach(f => {
        const inp = el(`s${i}_${f}`);
        if (inp) sc[f] = inp.value;
      });
    }
  }
  if (step === 4) {
    const d = state.data.operacional;
    collectFields(['ramoAtividade','atividadePrincipal','tempoOperacao','quantidadeUnidades','descricaoOperacao'], d);
  }
  if (step === 5) {
    const d = state.data.funcionarios;
    d.total          = el('totalFunc')?.value || '';
    d.administrativo = el('fAdm')?.value || '';
    d.operacional    = el('fOpe')?.value || '';
    d.comercial      = el('fCom')?.value || '';
    d.detalheDemissoes = el('detalheDemissoes')?.value || '';
  }
  if (step === 6) {
    const d = state.data.ativos;
    collectFields(['descricaoAtivos','estimativaValor','descricaoAtivosOciosos'], d);
  }
  if (step === 7) {
    const d = state.data.financeiro;
    collectFields(['receitaMediaMensal','principaisFontesReceita','custosFixosMensais','custosVariaveis','principaisDespesas','sistemaControle'], d);
  }
  if (step === 8) {
    state.data.dividas.forEach((_, i) => {
      const d = state.data.dividas[i];
      ['nomeCredor','tipoDivida','valorOriginal','saldoAtual','numeroProcesso'].forEach(f => {
        const inp = el(`d${i}_${f}`);
        if (inp) d[f] = inp.value;
      });
    });
  }
  if (step === 9) {
    const d = state.data.crise;
    collectFields(['inicioDificuldades','principaisEventos','descricaoReestruturacao'], d);
  }
  if (step === 10) {
    const d = state.data.diagnostico;
    collectFields(['principalProblema','oqueFuncionaBem','descricaoUnidade','deveSerEncerrado'], d);
  }
  if (step === 11) {
    const d = state.data.mercado;
    collectFields(['principaisClientes','demandaMercado','descricaoPotencial'], d);
  }
  if (step === 14) {
    const d = state.data.responsavel;
    d.nome     = el('rNome')?.value || '';
    d.cargo    = el('rCargo')?.value || '';
    d.email    = el('rEmail')?.value || '';
    d.telefone = el('rTel')?.value || '';
  }
  saveToLS();
}

function collectFields(ids, target) {
  ids.forEach(id => {
    const inp = el(id);
    if (inp !== null) target[id] = inp.value;
  });
}

// ─── Fill fields from state ───────────────────────────────────────────────────
function fillFields(ids, source, map = {}) {
  ids.forEach(id => {
    const key = map[id] || id;
    const inp = el(id);
    if (inp && source[key] !== undefined) inp.value = source[key];
    if (inp) inp.addEventListener('input', () => {
      source[key] = inp.value;
      saveToLS();
    });
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validateStep(step) {
  clearErrors();
  let valid = true;

  function require(id, msg = 'Campo obrigatório') {
    const inp = el(id);
    if (!inp) return;
    const val = inp.value?.trim();
    if (!val) { showError(id, msg); valid = false; }
    else inp.classList.remove('error');
  }
  function requireRadio(name, dataKey, msg = 'Selecione uma opção') {
    if (!state.data[dataKey]?.[name]) { showError(name, msg); valid = false; }
  }
  function requireCheck(name, dataKey, msg = 'Selecione ao menos uma opção') {
    const arr = state.data[dataKey]?.[name];
    if (!arr || arr.length === 0) { showError(name, msg); valid = false; }
  }

  if (step === 1) {
    if (!state.data.lgpd.concordo) { showError('lgpd','Você precisa concordar para continuar.'); valid = false; }
  }
  if (step === 2) {
    require('razaoSocial'); require('cnpj'); require('endereco');
    require('cidade'); require('estado'); require('cep');
    require('email2'); require('tel2');
  }
  if (step === 3) {
    const num = state.data.numSocios || 1;
    for (let i = 0; i < num; i++) {
      ['nome','cpf','dataNascimento','endereco','email','telefone','participacao','cargo'].forEach(f => {
        const inp = el(`s${i}_${f}`);
        if (inp && !inp.value.trim()) { showError(`s${i}_${f}`,'Obrigatório'); valid = false; }
      });
    }
  }
  if (step === 4) {
    require('ramoAtividade'); require('atividadePrincipal');
    require('tempoOperacao'); require('descricaoOperacao');
    requireRadio('possuiFiliais','operacional');
  }
  if (step === 5) {
    require('totalFunc');
    requireRadio('folhaEmAtraso','funcionarios');
    requireRadio('acoesTrabalhistasAndamento','funcionarios');
    requireRadio('demissoesRecentes','funcionarios');
  }
  if (step === 6) {
    requireRadio('possuiAtivos','ativos');
    if (state.data.ativos.possuiAtivos === 'sim') {
      require('descricaoAtivos'); require('estimativaValor');
      requireRadio('ativosFinanciadosAliendados','ativos');
      requireRadio('ativosOciosos','ativos');
    }
  }
  if (step === 7) {
    require('receitaMediaMensal'); require('principaisFontesReceita');
    require('custosFixosMensais'); require('principaisDespesas');
    requireRadio('possuiControleFinanceiro','financeiro');
  }
  if (step === 8) {
    state.data.dividas.forEach((_, i) => {
      ['nomeCredor','tipoDivida','valorOriginal','saldoAtual'].forEach(f => {
        const inp = el(`d${i}_${f}`);
        if (inp && !inp.value.trim()) { showError(`d${i}_${f}`,'Obrigatório'); valid = false; }
      });
      if (!state.data.dividas[i]?.possuiGarantia) { showError(`d${i}_possuiGarantia`,'Selecione'); valid = false; }
      if (!state.data.dividas[i]?.estaJudicializada) { showError(`d${i}_estaJudicializada`,'Selecione'); valid = false; }
    });
  }
  if (step === 9) {
    require('inicioDificuldades'); require('principaisEventos');
    requireCheck('causasCrise','crise');
    requireRadio('tentouReestruturacao','crise');
  }
  if (step === 10) {
    require('principalProblema');
    requireCheck('areasCriticas','diagnostico');
    require('oqueFuncionaBem');
  }
  if (step === 11) {
    require('principaisClientes'); require('demandaMercado');
    requireRadio('concentracaoReceita','mercado');
    requireRadio('dependenciaContratos','mercado');
    requireRadio('potencialCrescimento','mercado');
  }
  if (step === 12) {
    requireCheck('objetivoPlano','expectativas');
    requireCheck('dispostoA','expectativas');
    requireRadio('interesseRJ','expectativas');
  }
  if (step === 13) {
    ['balanco','dre','extratos'].forEach(name => {
      if (!state.files[name] || state.files[name].length === 0) {
        showError(name,'Por favor, faça o upload deste documento obrigatório.'); valid = false;
      }
    });
  }
  if (step === 14) {
    require('rNome'); require('rCargo'); require('rEmail'); require('rTel');
    if (!state.data.confirmacao.declaro) { showError('declaro','É necessário marcar esta declaração.'); valid = false; }
  }

  if (!valid) {
    // Scroll to first error
    const firstErr = qs('.field-error.visible') || qs('.error');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Por favor, preencha todos os campos obrigatórios.', 'error');
  }
  return valid;
}

function showError(id, msg) {
  const errEl = el(`err_${id}`);
  const inp   = el(id);
  if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
  if (inp)   inp.classList.add('error');
}
function clearErrors() {
  qsa('.field-error').forEach(e => { e.textContent = ''; e.classList.remove('visible'); });
  qsa('.error').forEach(e => e.classList.remove('error'));
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const app = {
  async nextStep() {
    collectStepData(state.step);
    if (!validateStep(state.step)) return;

    // Send completed step data to server
    await notifyStepComplete(state.step);

    const idx = ACTIVE_STEP_IDS.indexOf(state.step);
    if (idx !== -1 && idx < ACTIVE_STEP_IDS.length - 1) {
      state.step = ACTIVE_STEP_IDS[idx + 1];
      renderStep(state.step);
      saveToLS();
    }
  },
  prevStep() {
    collectStepData(state.step);
    const idx = ACTIVE_STEP_IDS.indexOf(state.step);
    if (idx > 0) {
      state.step = ACTIVE_STEP_IDS[idx - 1];
      renderStep(state.step);
      saveToLS();
    }
  },
  saveProgress() {
    collectStepData(state.step);
    saveToLS();
    showToast('Progresso salvo! Você pode fechar e continuar depois.', 'success', 4000);
  }
};

// ─── Per-step API notification ────────────────────────────────────────────────
async function notifyStepComplete(stepNum) {
  const token = getToken();
  if (!token) return;
  try {
    await fetch('/api/step-complete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ stepNum, allData: state.data })
    });
  } catch (e) { console.warn('Step notify failed:', e.message); }
}

// ─── Local Storage ────────────────────────────────────────────────────────────
function saveToLS() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ step: state.step, data: state.data }));
  } catch(e) { /* storage full */ }
}

function loadFromLS() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (parsed.data) {
      Object.assign(state.data, parsed.data);
      state.step = parsed.step || 1;
      return state.step > 1;
    }
  } catch(e) { localStorage.removeItem(LS_KEY); }
  return false;
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitForm() {
  collectStepData(14);
  if (!validateStep(14)) return;

  const btn = el('btnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Enviando...';

  const formData = new FormData();
  formData.append('formData', JSON.stringify(state.data));
  Object.entries({ balanco: 'balanco', dre: 'dre', extratos: 'extratos', contratos: 'contratos' })
    .forEach(([key, field]) => (state.files[key] || []).forEach(f => formData.append(field, f)));

  try {
    const res  = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData
    });
    const json = await res.json();
    if (json.success) {
      showSuccessScreen();
      localStorage.removeItem(LS_KEY);
    } else {
      throw new Error(json.message || 'Erro desconhecido');
    }
  } catch(err) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar informações';
    showToast('Erro ao enviar. Tente novamente.', 'error', 5000);
  }
}

function showSuccessScreen() {
  el('progressWrapper').style.display = 'none';
  el('navBar').style.display = 'none';
  el('mainContent').innerHTML = card(`
    <div class="success-screen">
      <div class="success-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h1 class="success-title">Informações enviadas com sucesso!</h1>
      <p class="success-msg">
        Nossa equipe recebeu todos os seus dados e documentos. A análise será iniciada em breve
        e entraremos em contato pelo e-mail e telefone cadastrados.
      </p>
      <div class="success-note">
        <strong>Próximos passos:</strong><br/>
        Nossa equipe iniciará a análise e elaboração do Business Plan. Em até 2 dias úteis
        você receberá um contato para alinhamento das próximas etapas.
      </div>
      <p style="margin-top:24px;">
        <a href="./dashboard.html" style="display:inline-flex;align-items:center;gap:8px;background:#1A56DB;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          Acessar o Portal
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </a>
      </p>
    </div>
  `);
  // Auto-redirect after 6 seconds
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 6000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Auth guard
  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return; }

  const res = await fetch('/api/auth/verify', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { window.location.href = 'login.html'; return; }

  const { user } = await res.json();

  // Show user info in header
  const userEl   = el('userName');
  const avatarEl = el('userAvatar');
  if (userEl)   userEl.textContent   = user.name || user.email;
  if (avatarEl) avatarEl.textContent = (user.name || user.email || '?')[0].toUpperCase();

  // Remove auth guard overlay
  const guard = el('authGuard');
  if (guard) guard.remove();

  // Redirect admin to admin panel
  if (user.isAdmin) { window.location.href = 'admin.html'; return; }

  // ── Load form configuration ───────────────────────────────────────────────
  try {
    const cfgRes = await fetch('/api/form-config', { headers: { Authorization: 'Bearer ' + token } });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      window._formCfg = cfg;
      // Build active step IDs (always includes 1 and 14)
      const activeIds = (cfg.steps || []).map(s => s.id).filter(id => id >= 1 && id <= 14);
      if (activeIds.length >= 2) {
        ACTIVE_STEP_IDS = activeIds;
        TOTAL_STEPS     = ACTIVE_STEP_IDS.length;
      }
      // Patch STEPS titles from config
      (cfg.steps || []).forEach(cs => {
        const s = STEPS.find(x => x.id === cs.id);
        if (s && cs.title) s.title = cs.title;
      });
      // Show welcome message if set
      if (cfg.welcomeMessage) {
        const wm = document.getElementById('welcomeMsg');
        if (wm) wm.textContent = cfg.welcomeMessage;
      }
    }
  } catch { /* fall back to 14-step defaults */ }

  // ── Load server-side progress ─────────────────────────────────────────────
  try {
    const pRes = await fetch('/api/progress', { headers: { Authorization: 'Bearer ' + token } });
    if (pRes.ok) {
      const serverProgress = await pRes.json();
      // If already completed, go to dashboard
      if (serverProgress.completed) { window.location.href = 'dashboard.html'; return; }
      if (serverProgress.step > 1 && serverProgress.data) {
        Object.assign(state.data, serverProgress.data);
        // Snap to nearest active step if saved step is now disabled
        const savedStep = serverProgress.step;
        state.step = ACTIVE_STEP_IDS.includes(savedStep)
          ? savedStep
          : ACTIVE_STEP_IDS.find(id => id >= savedStep) || ACTIVE_STEP_IDS[0];
      }
    }
  } catch { /* fall back to local */ }

  // Also try localStorage as fallback
  if (state.step <= 1) loadFromLS();

  // Snap to valid active step after LS load
  if (!ACTIVE_STEP_IDS.includes(state.step)) {
    state.step = ACTIVE_STEP_IDS.find(id => id >= state.step) || ACTIVE_STEP_IDS[0];
  }

  renderStep(state.step);
  if (state.step > 1) showToast(`Bem-vindo de volta, ${user.name?.split(' ')[0] || ''}! Continuando na etapa ${state.step}.`, 'success', 4000);
})();
