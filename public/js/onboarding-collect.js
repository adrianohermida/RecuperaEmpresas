'use strict';
/* onboarding-collect.js — Onboarding: coleta de dados do DOM para state */

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
    d.total            = el('totalFunc')?.value || '';
    d.administrativo   = el('fAdm')?.value || '';
    d.operacional      = el('fOpe')?.value || '';
    d.comercial        = el('fCom')?.value || '';
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
