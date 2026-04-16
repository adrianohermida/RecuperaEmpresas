'use strict';
/* onboarding-validate.js — Onboarding: validação de cada etapa */

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
      if (!state.data.dividas[i]?.possuiGarantia)     { showError(`d${i}_possuiGarantia`,'Selecione'); valid = false; }
      if (!state.data.dividas[i]?.estaJudicializada)   { showError(`d${i}_estaJudicializada`,'Selecione'); valid = false; }
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
