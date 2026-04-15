'use strict';

(function () {
  function parseCurrencyVal(value) {
    if (!value) return 0;
    return parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
  }

  function fmtCur(value) {
    const amount = parseCurrencyVal(value);
    if (!amount) return null;
    return window.REShared.formatCurrencyBRL(amount);
  }

  function fmtVal(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value === 'sim') return 'Sim';
    if (value === 'nao') return 'Não';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  function calcTotalDebt(dividas) {
    if (!Array.isArray(dividas) || !dividas.length) return '—';
    const total = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
    if (!total) return '—';
    return window.REShared.formatCurrencyBRL(total);
  }

  function calcRecoveryScore(data, onboarding) {
    let score = 50;
    const fin = data.financeiro || {};
    const func = data.funcionarios || {};
    const crise = data.crise || {};
    const ativos = data.ativos || {};

    const receita = parseCurrencyVal(fin.receitaMediaMensal);
    const custos = parseCurrencyVal(fin.custosFixosMensais) + parseCurrencyVal(fin.custosVariaveis);
    if (receita > 0 && custos > 0) {
      const margin = (receita - custos) / receita;
      if (margin > 0.3) score += 12;
      else if (margin > 0.1) score += 6;
      else if (margin < 0) score -= 15;
    }

    const dividas = data.dividas || [];
    const totalDebt = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
    if (receita > 0 && totalDebt > 0) {
      const ratio = totalDebt / receita;
      if (ratio < 6) score += 10;
      else if (ratio >= 12) score -= 15;
    }

    const durationMap = { menos6m:5, '6a12m':0, '1a2a':-5, '2a3a':-10, mais3a:-15 };
    score += durationMap[crise.inicioDificuldades] || 0;

    if (func.folhaEmAtraso === 'sim') score -= 8;
    if (func.acoesTrabalhistasAndamento === 'sim') score -= 5;
    if (func.demissoesRecentes === 'sim') score -= 4;
    if (ativos.possuiAtivos === 'sim') score += 5;
    if (fin.possuiControleFinanceiro === 'sim') score += 5;
    else if (fin.possuiControleFinanceiro === 'nao') score -= 5;
    if (onboarding && onboarding.completed) score += 8;

    return Math.min(95, Math.max(10, Math.round(score)));
  }

  function calcInsights(data) {
    const insights = [];
    const fin = data.financeiro || {};
    const func = data.funcionarios || {};
    const crise = data.crise || {};
    const dividas = data.dividas || [];

    const receita = parseCurrencyVal(fin.receitaMediaMensal);
    const custos = parseCurrencyVal(fin.custosFixosMensais) + parseCurrencyVal(fin.custosVariaveis);
    if (receita > 0 && custos > 0 && custos > receita) {
      insights.push('Custos operacionais superam a receita — empresa operando no negativo');
    } else if (receita > 0 && custos > 0 && (receita - custos) / receita < 0.1) {
      insights.push('Margem de contribuição muito estreita — risco elevado de insolvência');
    }

    const totalDebt = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
    if (receita > 0 && totalDebt > receita * 12) {
      insights.push('Endividamento superior a 12 meses de receita — reestruturação urgente');
    } else if (receita > 0 && totalDebt > receita * 6) {
      insights.push('Dívida elevada (>6× receita mensal) — priorizar renegociação');
    }

    const judicializadas = dividas.filter(debt => debt.estaJudicializada === 'sim');
    if (judicializadas.length > 0) {
      insights.push(`${judicializadas.length} dívida(s) judicializadas — risco de penhora de ativos`);
    }
    if (func.folhaEmAtraso === 'sim') insights.push('Folha de pagamento em atraso — risco trabalhista imediato');
    if (func.acoesTrabalhistasAndamento === 'sim') insights.push('Ações trabalhistas em andamento — passivo oculto a quantificar');
    if (func.demissoesRecentes === 'sim') insights.push('Demissões em massa recentes — avaliar impacto operacional e trabalhista');
    if (['mais3a', '2a3a'].includes(crise.inicioDificuldades)) {
      insights.push('Crise financeira prolongada — risco de insolvência sem intervenção estruturada');
    }
    const causes = crise.causasCrise || [];
    if (causes.includes('endividamento') && causes.includes('queda_receita')) {
      insights.push('Dupla pressão: queda de receita + endividamento crescente — cenário crítico');
    }

    return insights;
  }

  function calcSuggestions(data, score) {
    const suggestions = [];
    const fin = data.financeiro || {};
    const dividas = data.dividas || [];
    const func = data.funcionarios || {};

    if (score < 40) suggestions.push('Iniciar processo de recuperação judicial extrajudicial imediatamente');
    if (dividas.length > 0) suggestions.push('Elaborar proposta de parcelamento para credores prioritários');

    const receita = parseCurrencyVal(fin.receitaMediaMensal);
    const custos = parseCurrencyVal(fin.custosFixosMensais);
    if (receita > 0 && custos > receita * 0.7) {
      suggestions.push('Revisão urgente da estrutura de custos fixos — meta: reduzir para <60% da receita');
    }
    if (fin.possuiControleFinanceiro === 'nao') {
      suggestions.push('Implementar controle financeiro sistemático (Conta Azul, Omie ou planilha estruturada)');
    }
    if (func.demissoesRecentes !== 'sim' && func.folhaEmAtraso !== 'sim') {
      suggestions.push('Manter equipe estável — capital humano é ativo crítico na recuperação');
    }
    if (score >= 50 && score < 70) {
      suggestions.push('Focar em renegociação extrajudicial — evitar judicialização desnecessária');
    }
    return suggestions;
  }

  function execSectionHtml(title, rows) {
    const validRows = rows.filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== '—');
    if (!validRows.length) return '';
    return `<div class="exec-section">
      <div class="exec-section-title">${title}</div>
      <table class="exec-table">
        ${validRows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}
      </table>
    </div>`;
  }

  function switchDataTab(idx, el) {
    document.querySelectorAll('.data-tab-btn').forEach(button => button.classList.remove('active'));
    if (el) el.classList.add('active');
    const content = document.getElementById('dataTabContent');
    if (!content || !window._execData) return;

    const { d } = window._execData;
    const fin = d.financeiro || {};
    const op = d.operacional || {};
    const func = d.funcionarios || {};
    const crise = d.crise || {};
    const diag = d.diagnostico || {};
    const merc = d.mercado || {};
    const exp = d.expectativas || {};
    const emp = d.empresa || {};
    const resp = d.responsavel || {};
    const ativos = d.ativos || {};
    const dividas = Array.isArray(d.dividas) ? d.dividas : [];

    const DURATION_LABELS = { menos6m:'Menos de 6 meses', '6a12m':'6 a 12 meses', '1a2a':'1 a 2 anos', '2a3a':'2 a 3 anos', mais3a:'Mais de 3 anos' };
    const RAMO_LABELS = { comercio:'Comércio', industria:'Indústria', servicos:'Serviços', agronegocio:'Agronegócio', construcao:'Construção Civil', outros:'Outros' };
    const TEMPO_LABELS = { menos1:'Menos de 1 ano', '1a3':'1 a 3 anos', '3a5':'3 a 5 anos', '5a10':'5 a 10 anos', mais10:'Mais de 10 anos' };
    const TIPO_LABELS = { banco:'Banco/Financeira', fornecedor:'Fornecedor', tributo:'Tributo', trabalhista:'Trabalhista', aluguel:'Aluguel', outros:'Outros' };

    const tabs = ['resumo', 'financeiro', 'dividas', 'operacao', 'crise', 'estrategia', 'socios'];
    const tab = tabs[idx] || 'resumo';

    let html = '';

    if (tab === 'resumo') {
      html += execSectionHtml('Empresa', [
        ['Razão Social', fmtVal(emp.razaoSocial)],
        ['Nome Fantasia', fmtVal(emp.nomeFantasia)],
        ['CNPJ', fmtVal(emp.cnpj)],
        ['Endereço', fmtVal(emp.endereco)],
        ['Cidade / UF', emp.cidade && emp.estado ? `${emp.cidade} / ${emp.estado}` : fmtVal(emp.cidade || emp.estado)],
        ['CEP', fmtVal(emp.cep)],
        ['E-mail', fmtVal(emp.email || emp.email2)],
        ['Telefone', fmtVal(emp.telefone || emp.tel2)],
      ]);
      html += execSectionHtml('Responsável pelo Cadastro', [
        ['Nome', fmtVal(resp.nome)],
        ['CPF', fmtVal(resp.cpf)],
        ['Cargo', fmtVal(resp.cargo)],
        ['E-mail', fmtVal(resp.email)],
        ['Telefone', fmtVal(resp.telefone)],
      ]);
    }

    if (tab === 'financeiro') {
      html += execSectionHtml('Receitas', [
        ['Receita média mensal', fmtCur(fin.receitaMediaMensal)],
        ['Principais fontes de receita', fmtVal(fin.principaisFontesReceita)],
      ]);
      html += execSectionHtml('Custos', [
        ['Custos fixos mensais', fmtCur(fin.custosFixosMensais)],
        ['Custos variáveis mensais', fmtCur(fin.custosVariaveis)],
        ['Principais despesas', fmtVal(fin.principaisDespesas)],
      ]);
      html += execSectionHtml('Controle Financeiro', [
        ['Possui controle sistemático', fmtVal(fin.possuiControleFinanceiro)],
        ['Sistema utilizado', fmtVal(fin.sistemaControle)],
      ]);
      const rec = parseCurrencyVal(fin.receitaMediaMensal);
      const cst = parseCurrencyVal(fin.custosFixosMensais) + parseCurrencyVal(fin.custosVariaveis);
      if (rec > 0 && cst > 0) {
        const margin = ((rec - cst) / rec * 100).toFixed(1);
        const marginColor = parseFloat(margin) > 20 ? 'var(--success)' : parseFloat(margin) > 0 ? '#F59E0B' : 'var(--error)';
        html += `<div class="exec-section">
          <div class="exec-section-title">Indicadores calculados</div>
          <table class="exec-table">
            <tr><td>Margem de contribuição estimada</td><td style="color:${marginColor};font-weight:700;">${margin}%</td></tr>
            <tr><td>Resultado mensal estimado</td><td style="color:${marginColor};font-weight:600;">${fmtCur(rec - cst)}</td></tr>
          </table>
        </div>`;
      }
    }

    if (tab === 'dividas') {
      if (!dividas.length) {
        html = '<div class="empty-state" style="padding:24px 0;"><p>Nenhuma dívida cadastrada.</p></div>';
      } else {
        const total = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
        const judicializadas = dividas.filter(debt => debt.estaJudicializada === 'sim').length;
        html += `<div class="exec-section">
          <div class="exec-section-title">Resumo</div>
          <table class="exec-table">
            <tr><td>Total de credores</td><td><strong>${dividas.length}</strong></td></tr>
            <tr><td>Total estimado de dívidas</td><td style="font-weight:700;color:var(--error);">R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>
            <tr><td>Dívidas judicializadas</td><td>${judicializadas > 0 ? `<span class="badge badge-red">${judicializadas}</span>` : '<span class="badge badge-green">Nenhuma</span>'}</td></tr>
          </table>
        </div>`;
        html += `<div class="exec-section">
          <div class="exec-section-title">Detalhamento</div>
          <div style="overflow-x:auto;">
            <table class="debt-table">
              <thead><tr>
                <th>Credor</th><th>Tipo</th><th>Valor original</th><th>Saldo atual</th><th>Garantia</th><th>Judicial</th>
              </tr></thead>
              <tbody>
                ${dividas.map(debt => `<tr>
                  <td style="font-weight:500;">${debt.nomeCredor||'—'}</td>
                  <td>${TIPO_LABELS[debt.tipoDivida]||debt.tipoDivida||'—'}</td>
                  <td>${fmtCur(debt.valorOriginal)||'—'}</td>
                  <td style="font-weight:600;color:var(--error);">${fmtCur(debt.saldoAtual)||'—'}</td>
                  <td>${debt.possuiGarantia==='sim'?'<span class="badge badge-amber">Sim</span>':'<span class="badge badge-gray">Não</span>'}</td>
                  <td>${debt.estaJudicializada==='sim'?'<span class="badge badge-red">Sim</span>':'<span class="badge badge-green">Não</span>'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      }
    }

    if (tab === 'operacao') {
      html += execSectionHtml('Estrutura Operacional', [
        ['Ramo de atividade', RAMO_LABELS[op.ramoAtividade] || fmtVal(op.ramoAtividade)],
        ['Atividade principal', fmtVal(op.atividadePrincipal)],
        ['Tempo de operação', TEMPO_LABELS[op.tempoOperacao] || fmtVal(op.tempoOperacao)],
        ['Nº de unidades', fmtVal(op.quantidadeUnidades)],
        ['Possui filiais', fmtVal(op.possuiFiliais)],
        ['Descrição da operação', fmtVal(op.descricaoOperacao)],
      ]);
      html += execSectionHtml('Quadro de Funcionários', [
        ['Total de funcionários', fmtVal(func.total)],
        ['Administrativo', fmtVal(func.administrativo)],
        ['Operacional', fmtVal(func.operacional)],
        ['Comercial', fmtVal(func.comercial)],
        ['Folha em atraso', fmtVal(func.folhaEmAtraso)],
        ['Ações trabalhistas', fmtVal(func.acoesTrabalhistasAndamento)],
        ['Demissões recentes', fmtVal(func.demissoesRecentes)],
        ['Detalhe demissões', fmtVal(func.detalheDemissoes)],
      ]);
      html += execSectionHtml('Ativos', [
        ['Possui ativos relevantes', fmtVal(ativos.possuiAtivos)],
        ['Descrição dos ativos', fmtVal(ativos.descricaoAtivos)],
        ['Estimativa de valor', fmtCur(ativos.estimativaValor)],
        ['Ativos financiados/alienados', fmtVal(ativos.ativosFinanciadosAliendados)],
        ['Ativos ociosos', fmtVal(ativos.ativosOciosos)],
        ['Descrição ociosos', fmtVal(ativos.descricaoAtivosOciosos)],
      ]);
    }

    if (tab === 'crise') {
      html += execSectionHtml('Histórico da Crise', [
        ['Início das dificuldades', DURATION_LABELS[crise.inicioDificuldades] || fmtVal(crise.inicioDificuldades)],
        ['Principais eventos', fmtVal(crise.principaisEventos)],
        ['Causas identificadas', Array.isArray(crise.causasCrise) ? crise.causasCrise.join(', ') : fmtVal(crise.causasCrise)],
        ['Eventos últimos 24 meses', Array.isArray(crise.eventos24m) ? crise.eventos24m.join(', ') : fmtVal(crise.eventos24m)],
        ['Medidas já tomadas', fmtVal(crise.medidasJaTomadas)],
      ]);
      html += execSectionHtml('Diagnóstico Estratégico', [
        ['Análise SWOT — Forças', fmtVal(diag.forcas)],
        ['Análise SWOT — Fraquezas', fmtVal(diag.fraquezas)],
        ['Análise SWOT — Oportunidades', fmtVal(diag.oportunidades)],
        ['Análise SWOT — Ameaças', fmtVal(diag.ameacas)],
      ]);
      html += execSectionHtml('Mercado', [
        ['Descrição do mercado', fmtVal(merc.descricaoMercado)],
        ['Principais concorrentes', fmtVal(merc.principaisConcorrentes)],
        ['Diferenciais', fmtVal(merc.diferenciais)],
      ]);
    }

    if (tab === 'estrategia') {
      html += execSectionHtml('Expectativas e Estratégia', [
        ['Objetivos', fmtVal(exp.objetivos)],
        ['Estratégia de recuperação', fmtVal(exp.estrategia)],
        ['Prazo esperado', fmtVal(exp.prazoEsperado)],
        ['Investimento previsto', fmtCur(exp.investimentoPrevisto)],
        ['Parceiros estratégicos', fmtVal(exp.parceiros)],
      ]);
    }

    if (tab === 'socios') {
      const socios = Array.isArray(d.socios) ? d.socios : [];
      if (!socios.length) {
        html = '<div class="empty-state" style="padding:24px 0;"><p>Nenhum sócio cadastrado.</p></div>';
      } else {
        socios.forEach((socio, index) => {
          html += execSectionHtml(`Sócio ${index + 1}`, [
            ['Nome', fmtVal(socio.nome)],
            ['CPF', fmtVal(socio.cpf)],
            ['Data de nascimento', fmtVal(socio.dataNascimento)],
            ['Endereço', fmtVal(socio.endereco)],
            ['E-mail', fmtVal(socio.email)],
            ['Telefone', fmtVal(socio.telefone)],
            ['Participação', socio.participacao ? socio.participacao + '%' : null],
            ['Cargo', fmtVal(socio.cargo)],
          ]);
        });
      }
    }

    content.innerHTML = html || '<p style="color:var(--text-muted);font-size:13px;padding:12px 0;">Dados não preenchidos nesta seção.</p>';
  }

  function renderDataTab(context) {
    const { body, user, onboarding } = context;
    const data = onboarding.data || {};
    const score = calcRecoveryScore(data, onboarding);
    const insights = calcInsights(data);
    const suggestions = calcSuggestions(data, score);
    const scoreColor = score >= 70 ? '#059669' : score >= 50 ? '#F59E0B' : score >= 30 ? '#EF4444' : '#DC2626';
    const scoreLabel = score >= 70 ? 'Bom' : score >= 50 ? 'Moderado' : score >= 30 ? 'Atenção' : 'Crítico';
    const pct = onboarding.completed ? 100 : Math.round(((onboarding.step || 1) - 1) / 14 * 100);
    const empresa = data.empresa || {};
    const statusCls = score >= 70 ? 'badge-green' : score >= 50 ? 'badge-amber' : 'badge-red';
    const statusLabel = score >= 70 ? 'Estável' : score >= 50 ? 'Atenção' : 'Crítico';

    body.innerHTML = `
      <div class="exec-header">
        <div class="exec-company">${empresa.razaoSocial || user.company || '—'}</div>
        <div class="exec-cnpj">CNPJ: ${empresa.cnpj || '—'} &nbsp;·&nbsp; <span class="badge ${statusCls}" style="font-size:11px;">${statusLabel}</span></div>
        <div class="exec-kpis">
          <div class="exec-kpi">
            <div class="exec-kpi-val" style="color:${scoreColor};">${score}%</div>
            <div class="exec-kpi-lbl">Score de Recuperação</div>
            <div class="exec-kpi-sub" style="color:${scoreColor};">${scoreLabel}</div>
          </div>
          <div class="exec-kpi exec-divider" style="padding-left:20px;">
            <div class="exec-kpi-val">${pct}%</div>
            <div class="exec-kpi-lbl">Onboarding</div>
            <div class="exec-kpi-sub" style="color:${onboarding.completed ? '#34D399' : '#93C5FD'};">${onboarding.completed ? 'Concluído' : 'Em andamento'}</div>
          </div>
          <div class="exec-kpi exec-divider" style="padding-left:20px;">
            <div class="exec-kpi-val">${calcTotalDebt(data.dividas)}</div>
            <div class="exec-kpi-lbl">Total dívidas</div>
          </div>
        </div>
      </div>

      <div class="data-tab-bar">
        ${['Resumo','Financeiro','Dívidas','Operação','Crise','Estratégia','Sócios'].map((title, index) =>
          `<button class="data-tab-btn${index === 0 ? ' active' : ''}" onclick="switchDataTab(${index},this)">${title}</button>`
        ).join('')}
      </div>

      <div id="dataTabContent"></div>

      ${insights.length ? `
      <div class="insights-box">
        <div class="insights-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Pontos de atenção identificados
        </div>
        <ul class="insights-list">${insights.map(insight => `<li>${insight}</li>`).join('')}</ul>
      </div>` : ''}

      ${suggestions.length ? `
      <div class="suggestions-box">
        <div class="suggestions-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Sugestões estratégicas
        </div>
        <ul class="suggestions-list">${suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}</ul>
      </div>` : ''}
    `;

    window._execData = { d: data, user, onboarding };
    switchDataTab(0, body.querySelector('.data-tab-btn'));
  }

  window.switchDataTab = switchDataTab;
  window.REAdminDrawerDataTab = {
    render(context) {
      renderDataTab(context);
      return true;
    },
  };
})();