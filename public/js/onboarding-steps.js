'use strict';
/* onboarding-steps.js — Onboarding: renderização de cada etapa (1-14) */

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
      <div class="field form-grid form-grid-3 app-form-grid-gap-md">
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
    <div class="field app-field-spaced-lg">
      <label>Quantos sócios/representantes legais?<span class="req">*</span></label>
      <div class="num-select">
        ${[1,2,3,4,5].map(n => `
          <button class="num-btn${num===n?' active':''}" onclick="setNumSocios(${n})">${n}</button>`).join('')}
        <button class="num-btn${num>5?' active':''}" onclick="setNumSocios(6)" title="6 ou mais">6+</button>
      </div>
    </div>
    <div id="sociosList">${sociosHtml}</div>
    ${num >= 6 ? '<p class="step-desc app-step-desc-spaced">Para mais de 5 sócios, adicione os restantes manualmente:</p><button class="btn-add" onclick="addSocio()">+ Adicionar sócio</button>' : ''}
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
      <div class="field form-grid form-grid-3 app-form-grid-gap-md">
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
      <div class="field field-full ${d.demissoesRecentes==='sim' ? '' : 'ui-hidden'}" id="detalheDemissoesWrap">
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
  if (wrap) wrap.classList.toggle('ui-hidden', state.data.funcionarios.demissoesRecentes !== 'sim');
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
      <div id="ativosDetailsWrap" class="${d.possuiAtivos==='sim' ? '' : 'ui-hidden'}">
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
          <div class="field field-full ${d.ativosOciosos==='sim' ? '' : 'ui-hidden'}" id="ativosOciososWrap">
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
  if (w) w.classList.toggle('ui-hidden', state.data.ativos.possuiAtivos !== 'sim');
}
function toggleAtivosOciosos() {
  const w = el('ativosOciososWrap');
  if (w) w.classList.toggle('ui-hidden', state.data.ativos.ativosOciosos !== 'sim');
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
      <div class="field ${d.possuiControleFinanceiro==='sim'||d.possuiControleFinanceiro==='parcial' ? '' : 'ui-hidden'}" id="sistemaControleWrap">
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
  if (w) w.classList.toggle('ui-hidden', !(v === 'sim' || v === 'parcial'));
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
      <div class="field field-full ui-hidden" id="d${i}_processoWrap">
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
    if (w) w.classList.remove('ui-hidden');
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
  if (w) w.classList.toggle('ui-hidden', state.data.dividas[i]?.estaJudicializada !== 'sim');
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
      <div class="field field-full ${d.tentouReestruturacao==='sim' ? '' : 'ui-hidden'}" id="reestruturacaoWrap">
        <label for="descricaoReestruturacao">Descreva a reestruturação tentada<span class="req">*</span></label>
        <textarea id="descricaoReestruturacao" placeholder="O que foi feito, quando, resultados obtidos..."></textarea>
      </div>
    </div>
  `);
  fillFields(['inicioDificuldades','principaisEventos','descricaoReestruturacao'], d);
}
function toggleReestruturacao() {
  const w = el('reestruturacaoWrap');
  if (w) w.classList.toggle('ui-hidden', state.data.crise.tentouReestruturacao !== 'sim');
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
      <div class="field field-full ${d.existeUnidadeLucrativa==='sim' ? '' : 'ui-hidden'}" id="unidadeLucrativaWrap">
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
  if (w) w.classList.toggle('ui-hidden', state.data.diagnostico.existeUnidadeLucrativa !== 'sim');
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
      <div class="field field-full ${d.potencialCrescimento==='sim'||d.potencialCrescimento==='talvez' ? '' : 'ui-hidden'}" id="potencialWrap">
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
  if (w) w.classList.toggle('ui-hidden', !(v === 'sim' || v === 'talvez'));
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
      <span class="app-file-size">${(f.size/1024/1024).toFixed(1)} MB</span>
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

    <div id="respFields" class="${souResp ? 'ui-hidden' : ''}">
      <div class="form-grid form-grid-2 app-form-grid-top-md">
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
    if (fields) fields.classList.add('ui-hidden');
  } else {
    // Switching OFF: show manual fields
    lbl.classList.remove('checked');
    if (fields) fields.classList.remove('ui-hidden');
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

