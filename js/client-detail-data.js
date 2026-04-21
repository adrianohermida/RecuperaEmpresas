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
    if (value === 'nao') return 'NÃ£o';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  function calcTotalDebt(dividas) {
    if (!Array.isArray(dividas) || !dividas.length) return 'â€”';
    const total = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
    if (!total) return 'â€”';
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
      insights.push('Custos operacionais superam a receita â€” empresa operando no negativo');
    } else if (receita > 0 && custos > 0 && (receita - custos) / receita < 0.1) {
      insights.push('Margem de contribuiÃ§Ã£o muito estreita â€” risco elevado de insolvÃªncia');
    }

    const totalDebt = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
    if (receita > 0 && totalDebt > receita * 12) {
      insights.push('Endividamento superior a 12 meses de receita â€” reestruturaÃ§Ã£o urgente');
    } else if (receita > 0 && totalDebt > receita * 6) {
      insights.push('DÃ­vida elevada (>6Ã— receita mensal) â€” priorizar renegociaÃ§Ã£o');
    }

    const judicializadas = dividas.filter(debt => debt.estaJudicializada === 'sim');
    if (judicializadas.length > 0) {
      insights.push(`${judicializadas.length} dÃ­vida(s) judicializadas â€” risco de penhora de ativos`);
    }
    if (func.folhaEmAtraso === 'sim') insights.push('Folha de pagamento em atraso â€” risco trabalhista imediato');
    if (func.acoesTrabalhistasAndamento === 'sim') insights.push('AÃ§Ãµes trabalhistas em andamento â€” passivo oculto a quantificar');
    if (func.demissoesRecentes === 'sim') insights.push('DemissÃµes em massa recentes â€” avaliar impacto operacional e trabalhista');
    if (['mais3a', '2a3a'].includes(crise.inicioDificuldades)) {
      insights.push('Crise financeira prolongada â€” risco de insolvÃªncia sem intervenÃ§Ã£o estruturada');
    }
    const causes = crise.causasCrise || [];
    if (causes.includes('endividamento') && causes.includes('queda_receita')) {
      insights.push('Dupla pressÃ£o: queda de receita + endividamento crescente â€” cenÃ¡rio crÃ­tico');
    }

    return insights;
  }

  function calcSuggestions(data, score) {
    const suggestions = [];
    const fin = data.financeiro || {};
    const dividas = data.dividas || [];
    const func = data.funcionarios || {};

    if (score < 40) suggestions.push('Iniciar processo de recuperaÃ§Ã£o judicial extrajudicial imediatamente');
    if (dividas.length > 0) suggestions.push('Elaborar proposta de parcelamento para credores prioritÃ¡rios');

    const receita = parseCurrencyVal(fin.receitaMediaMensal);
    const custos = parseCurrencyVal(fin.custosFixosMensais);
    if (receita > 0 && custos > receita * 0.7) {
      suggestions.push('RevisÃ£o urgente da estrutura de custos fixos â€” meta: reduzir para <60% da receita');
    }
    if (fin.possuiControleFinanceiro === 'nao') {
      suggestions.push('Implementar controle financeiro sistemÃ¡tico (Conta Azul, Omie ou planilha estruturada)');
    }
    if (func.demissoesRecentes !== 'sim' && func.folhaEmAtraso !== 'sim') {
      suggestions.push('Manter equipe estÃ¡vel â€” capital humano Ã© ativo crÃ­tico na recuperaÃ§Ã£o');
    }
    if (score >= 50 && score < 70) {
      suggestions.push('Focar em renegociaÃ§Ã£o extrajudicial â€” evitar judicializaÃ§Ã£o desnecessÃ¡ria');
    }
    return suggestions;
  }

  function execSectionHtml(title, rows) {
    const validRows = rows.filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== 'â€”');
    if (!validRows.length) return '';
    return `<div class="acdd-exec-section">
      <div class="acdd-exec-section-title">${title}</div>
      <table class="acdd-exec-table">
        ${validRows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}
      </table>
    </div>`;
  }

  function execMarginToneClass(value) {
    if (value > 20) return 'acdd-tone-positive';
    if (value > 0) return 'acdd-tone-warning';
    return 'acdd-tone-danger';
  }

  function execScoreToneClass(score) {
    if (score >= 70) return 'acdd-tone-positive';
    if (score >= 50) return 'acdd-tone-warning';
    if (score >= 30) return 'acdd-tone-alert';
    return 'acdd-tone-danger';
  }

  function execOnboardingToneClass(completed) {
    return completed ? 'acdd-tone-complete' : 'acdd-tone-progress';
  }

  function switchDataTab(idx, el) {
    document.querySelectorAll('.acdd-data-tab-btn').forEach(button => button.classList.remove('active'));
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
    const RAMO_LABELS = { comercio:'ComÃ©rcio', industria:'IndÃºstria', servicos:'ServiÃ§os', agronegocio:'AgronegÃ³cio', construcao:'ConstruÃ§Ã£o Civil', outros:'Outros' };
    const TEMPO_LABELS = { menos1:'Menos de 1 ano', '1a3':'1 a 3 anos', '3a5':'3 a 5 anos', '5a10':'5 a 10 anos', mais10:'Mais de 10 anos' };
    const TIPO_LABELS = { banco:'Banco/Financeira', fornecedor:'Fornecedor', tributo:'Tributo', trabalhista:'Trabalhista', aluguel:'Aluguel', outros:'Outros' };

    const tabs = ['resumo', 'financeiro', 'dividas', 'operacao', 'crise', 'estrategia', 'socios'];
    const tab = tabs[idx] || 'resumo';

    let html = '';

    if (tab === 'resumo') {
      html += execSectionHtml('Empresa', [
        ['RazÃ£o Social', fmtVal(emp.razaoSocial)],
        ['Nome Fantasia', fmtVal(emp.nomeFantasia)],
        ['CNPJ', fmtVal(emp.cnpj)],
        ['EndereÃ§o', fmtVal(emp.endereco)],
        ['Cidade / UF', emp.cidade && emp.estado ? `${emp.cidade} / ${emp.estado}` : fmtVal(emp.cidade || emp.estado)],
        ['CEP', fmtVal(emp.cep)],
        ['E-mail', fmtVal(emp.email || emp.email2)],
        ['Telefone', fmtVal(emp.telefone || emp.tel2)],
      ]);
      html += execSectionHtml('ResponsÃ¡vel pelo Cadastro', [
        ['Nome', fmtVal(resp.nome)],
        ['CPF', fmtVal(resp.cpf)],
        ['Cargo', fmtVal(resp.cargo)],
        ['E-mail', fmtVal(resp.email)],
        ['Telefone', fmtVal(resp.telefone)],
      ]);
    }

    if (tab === 'financeiro') {
      html += execSectionHtml('Receitas', [
        ['Receita mÃ©dia mensal', fmtCur(fin.receitaMediaMensal)],
        ['Principais fontes de receita', fmtVal(fin.principaisFontesReceita)],
      ]);
      html += execSectionHtml('Custos', [
        ['Custos fixos mensais', fmtCur(fin.custosFixosMensais)],
        ['Custos variÃ¡veis mensais', fmtCur(fin.custosVariaveis)],
        ['Principais despesas', fmtVal(fin.principaisDespesas)],
      ]);
      html += execSectionHtml('Controle Financeiro', [
        ['Possui controle sistemÃ¡tico', fmtVal(fin.possuiControleFinanceiro)],
        ['Sistema utilizado', fmtVal(fin.sistemaControle)],
      ]);
      const rec = parseCurrencyVal(fin.receitaMediaMensal);
      const cst = parseCurrencyVal(fin.custosFixosMensais) + parseCurrencyVal(fin.custosVariaveis);
      if (rec > 0 && cst > 0) {
        const margin = ((rec - cst) / rec * 100).toFixed(1);
        const marginToneClass = execMarginToneClass(parseFloat(margin));
        html += `<div class="acdd-exec-section">
          <div class="acdd-exec-section-title">Indicadores calculados</div>
          <table class="acdd-exec-table">
            <tr><td>Margem de contribuiÃ§Ã£o estimada</td><td class="acdd-emphasis-cell ${marginToneClass}">${margin}%</td></tr>
            <tr><td>Resultado mensal estimado</td><td class="acdd-result-cell ${marginToneClass}">${fmtCur(rec - cst)}</td></tr>
          </table>
        </div>`;
      }
    }

    if (tab === 'dividas') {
      if (!dividas.length) {
        html = '<div class="empty-state acdd-empty-state"><p>Nenhuma dÃ­vida cadastrada.</p></div>';
      } else {
        const total = dividas.reduce((sum, debt) => sum + parseCurrencyVal(debt.saldoAtual || debt.valorOriginal), 0);
        const judicializadas = dividas.filter(debt => debt.estaJudicializada === 'sim').length;
        html += `<div class="acdd-exec-section">
          <div class="acdd-exec-section-title">Resumo</div>
          <table class="acdd-exec-table">
            <tr><td>Total de credores</td><td><strong>${dividas.length}</strong></td></tr>
            <tr><td>Total estimado de dÃ­vidas</td><td class="acdd-emphasis-cell acdd-tone-danger">R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>
            <tr><td>DÃ­vidas judicializadas</td><td>${judicializadas > 0 ? `<span class="badge badge-red">${judicializadas}</span>` : '<span class="badge badge-green">Nenhuma</span>'}</td></tr>
          </table>
        </div>`;
        html += `<div class="acdd-exec-section">
          <div class="acdd-exec-section-title">Detalhamento</div>
          <div class="admin-table-wrap acdd-debt-wrap">
            <table class="acdd-debt-table">
              <thead><tr>
                <th>Credor</th><th>Tipo</th><th>Valor original</th><th>Saldo atual</th><th>Garantia</th><th>Judicial</th>
              </tr></thead>
              <tbody>
                ${dividas.map(debt => `<tr>
                  <td class="acdd-debt-creditor">${debt.nomeCredor||'â€”'}</td>
                  <td>${TIPO_LABELS[debt.tipoDivida]||debt.tipoDivida||'â€”'}</td>
                  <td>${fmtCur(debt.valorOriginal)||'â€”'}</td>
                  <td class="acdd-debt-balance">${fmtCur(debt.saldoAtual)||'â€”'}</td>
                  <td>${debt.possuiGarantia==='sim'?'<span class="badge badge-amber">Sim</span>':'<span class="badge badge-gray">NÃ£o</span>'}</td>
                  <td>${debt.estaJudicializada==='sim'?'<span class="badge badge-red">Sim</span>':'<span class="badge badge-green">NÃ£o</span>'}</td>
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
        ['Tempo de operaÃ§Ã£o', TEMPO_LABELS[op.tempoOperacao] || fmtVal(op.tempoOperacao)],
        ['NÂº de unidades', fmtVal(op.quantidadeUnidades)],
        ['Possui filiais', fmtVal(op.possuiFiliais)],
        ['DescriÃ§Ã£o da operaÃ§Ã£o', fmtVal(op.descricaoOperacao)],
      ]);
      html += execSectionHtml('Quadro de FuncionÃ¡rios', [
        ['Total de funcionÃ¡rios', fmtVal(func.total)],
        ['Administrativo', fmtVal(func.administrativo)],
        ['Operacional', fmtVal(func.operacional)],
        ['Comercial', fmtVal(func.comercial)],
        ['Folha em atraso', fmtVal(func.folhaEmAtraso)],
        ['AÃ§Ãµes trabalhistas', fmtVal(func.acoesTrabalhistasAndamento)],
        ['DemissÃµes recentes', fmtVal(func.demissoesRecentes)],
        ['Detalhe demissÃµes', fmtVal(func.detalheDemissoes)],
      ]);
      html += execSectionHtml('Ativos', [
        ['Possui ativos relevantes', fmtVal(ativos.possuiAtivos)],
        ['DescriÃ§Ã£o dos ativos', fmtVal(ativos.descricaoAtivos)],
        ['Estimativa de valor', fmtCur(ativos.estimativaValor)],
        ['Ativos financiados/alienados', fmtVal(ativos.ativosFinanciadosAliendados)],
        ['Ativos ociosos', fmtVal(ativos.ativosOciosos)],
        ['DescriÃ§Ã£o ociosos', fmtVal(ativos.descricaoAtivosOciosos)],
      ]);
    }

    if (tab === 'crise') {
      html += execSectionHtml('HistÃ³rico da Crise', [
        ['InÃ­cio das dificuldades', DURATION_LABELS[crise.inicioDificuldades] || fmtVal(crise.inicioDificuldades)],
        ['Principais eventos', fmtVal(crise.principaisEventos)],
        ['Causas identificadas', Array.isArray(crise.causasCrise) ? crise.causasCrise.join(', ') : fmtVal(crise.causasCrise)],
        ['Eventos Ãºltimos 24 meses', Array.isArray(crise.eventos24m) ? crise.eventos24m.join(', ') : fmtVal(crise.eventos24m)],
        ['Medidas jÃ¡ tomadas', fmtVal(crise.medidasJaTomadas)],
      ]);
      html += execSectionHtml('DiagnÃ³stico EstratÃ©gico', [
        ['AnÃ¡lise SWOT â€” ForÃ§as', fmtVal(diag.forcas)],
        ['AnÃ¡lise SWOT â€” Fraquezas', fmtVal(diag.fraquezas)],
        ['AnÃ¡lise SWOT â€” Oportunidades', fmtVal(diag.oportunidades)],
        ['AnÃ¡lise SWOT â€” AmeaÃ§as', fmtVal(diag.ameacas)],
      ]);
      html += execSectionHtml('Mercado', [
        ['DescriÃ§Ã£o do mercado', fmtVal(merc.descricaoMercado)],
        ['Principais concorrentes', fmtVal(merc.principaisConcorrentes)],
        ['Diferenciais', fmtVal(merc.diferenciais)],
      ]);
    }

    if (tab === 'estrategia') {
      html += execSectionHtml('Expectativas e EstratÃ©gia', [
        ['Objetivos', fmtVal(exp.objetivos)],
        ['EstratÃ©gia de recuperaÃ§Ã£o', fmtVal(exp.estrategia)],
        ['Prazo esperado', fmtVal(exp.prazoEsperado)],
        ['Investimento previsto', fmtCur(exp.investimentoPrevisto)],
        ['Parceiros estratÃ©gicos', fmtVal(exp.parceiros)],
      ]);
    }

    if (tab === 'socios') {
      const socios = Array.isArray(d.socios) ? d.socios : [];
      if (!socios.length) {
        html = '<div class="empty-state acdd-empty-state"><p>Nenhum sÃ³cio cadastrado.</p></div>';
      } else {
        socios.forEach((socio, index) => {
          html += execSectionHtml(`SÃ³cio ${index + 1}`, [
            ['Nome', fmtVal(socio.nome)],
            ['CPF', fmtVal(socio.cpf)],
            ['Data de nascimento', fmtVal(socio.dataNascimento)],
            ['EndereÃ§o', fmtVal(socio.endereco)],
            ['E-mail', fmtVal(socio.email)],
            ['Telefone', fmtVal(socio.telefone)],
            ['ParticipaÃ§Ã£o', socio.participacao ? socio.participacao + '%' : null],
            ['Cargo', fmtVal(socio.cargo)],
          ]);
        });
      }
    }

    content.innerHTML = html || '<p class="acdd-empty-copy">Dados nÃ£o preenchidos nesta seÃ§Ã£o.</p>';
  }

  function renderDataTab(context) {
    const { body, user, onboarding } = context;
    const data = onboarding.data || {};
    const score = calcRecoveryScore(data, onboarding);
    const insights = calcInsights(data);
    const suggestions = calcSuggestions(data, score);
    const scoreToneClass = execScoreToneClass(score);
    const scoreLabel = score >= 70 ? 'Bom' : score >= 50 ? 'Moderado' : score >= 30 ? 'AtenÃ§Ã£o' : 'CrÃ­tico';
    const pct = onboarding.completed ? 100 : Math.round(((onboarding.step || 1) - 1) / 14 * 100);
    const empresa = data.empresa || {};
    const statusCls = score >= 70 ? 'badge-green' : score >= 50 ? 'badge-amber' : 'badge-red';
    const statusLabel = score >= 70 ? 'EstÃ¡vel' : score >= 50 ? 'AtenÃ§Ã£o' : 'CrÃ­tico';
    const onboardingToneClass = execOnboardingToneClass(onboarding.completed);

    body.innerHTML = `
      <div class="acdd-exec-header">
        <div class="acdd-exec-company">${empresa.razaoSocial || user.company || 'â€”'}</div>
        <div class="acdd-exec-cnpj">CNPJ: ${empresa.cnpj || 'â€”'} &nbsp;Â·&nbsp; <span class="badge ${statusCls} acdd-badge-sm">${statusLabel}</span></div>
        <div class="acdd-exec-kpis">
          <div class="acdd-exec-kpi">
            <div class="acdd-exec-kpi-val ${scoreToneClass}">${score}%</div>
            <div class="acdd-exec-kpi-lbl">Score de RecuperaÃ§Ã£o</div>
            <div class="acdd-exec-kpi-sub ${scoreToneClass}">${scoreLabel}</div>
          </div>
          <div class="acdd-exec-kpi acdd-exec-divider acdd-kpi-divider">
            <div class="acdd-exec-kpi-val">${pct}%</div>
            <div class="acdd-exec-kpi-lbl">Onboarding</div>
            <div class="acdd-exec-kpi-sub ${onboardingToneClass}">${onboarding.completed ? 'ConcluÃ­do' : 'Em andamento'}</div>
          </div>
          <div class="acdd-exec-kpi acdd-exec-divider acdd-kpi-divider">
            <div class="acdd-exec-kpi-val">${calcTotalDebt(data.dividas)}</div>
            <div class="acdd-exec-kpi-lbl">Total dÃ­vidas</div>
          </div>
        </div>
      </div>

      <div class="acdd-data-tab-bar">
        ${['Resumo','Financeiro','DÃ­vidas','OperaÃ§Ã£o','Crise','EstratÃ©gia','SÃ³cios'].map((title, index) =>
          `<button class="acdd-data-tab-btn${index === 0 ? ' active' : ''}" onclick="switchDataTab(${index},this)">${title}</button>`
        ).join('')}
      </div>

      <div id="dataTabContent"></div>

      ${insights.length ? `
      <div class="acdd-insights-box">
        <div class="acdd-insights-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Pontos de atenÃ§Ã£o identificados
        </div>
        <ul class="acdd-insights-list">${insights.map(insight => `<li>${insight}</li>`).join('')}</ul>
      </div>` : ''}

      ${suggestions.length ? `
      <div class="acdd-suggestions-box">
        <div class="acdd-suggestions-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          SugestÃµes estratÃ©gicas
        </div>
        <ul class="acdd-suggestions-list">${suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}</ul>
      </div>` : ''}
    `;

    window._execData = { d: data, user, onboarding };
    switchDataTab(0, body.querySelector('.acdd-data-tab-btn'));
  }

  window.switchDataTab = switchDataTab;
  window.REClientDetailDataTab = {
    render(context) {
      renderDataTab(context);
      return true;
    },
  };
  window.REAdminDrawerDataTab = window.REClientDetailDataTab;

console.info('[RE:client-detail-data] loaded');
})();
