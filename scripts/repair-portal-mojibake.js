'use strict';

const fs = require('fs');
const path = require('path');

const DASH = '\uFFFD\u001D';

const files = [
  'public/admin.html',
  'public/js/client-detail-tabs-primary.js',
  'public/js/client-detail-data.js',
  'public/js/client-detail-tabs-secondary.js',
  'public/js/client-detail-tabs-tertiary.js',
];

function updateFile(file, transform) {
  const abs = path.resolve(file);
  const source = fs.readFileSync(abs, 'utf8');
  const next = transform(source);
  if (next !== source) {
    fs.writeFileSync(abs, next, 'utf8');
    console.log('updated', file);
  } else {
    console.log('unchanged', file);
  }
}

function fixAdminHtml(text) {
  return text
    .replaceAll(`<title>Painel do Consultor ${DASH} Recupera Empresas</title>`, '<title>Painel do Consultor — Recupera Empresas</title>')
    .replaceAll('<!-- Hamburger ' + DASH + ' mobile only -->', '<!-- Hamburger: mobile only -->')
    .replaceAll('<!-- Sidebar footer ' + DASH + ' user avatar + dropup -->', '<!-- Sidebar footer: user avatar + dropup -->')
    .replaceAll('id="dropupUserName">' + DASH + '<', 'id="dropupUserName">—<')
    .replaceAll('id="dropupUserEmail">' + DASH + '<', 'id="dropupUserEmail">—<')
    .replaceAll('id="sTotalClients">' + DASH + '<', 'id="sTotalClients">—<')
    .replaceAll('id="sConcluido">' + DASH + '<', 'id="sConcluido">—<')
    .replaceAll('id="sEmAndamento">' + DASH + '<', 'id="sEmAndamento">—<')
    .replaceAll('id="sNaoIniciado">' + DASH + '<', 'id="sNaoIniciado">—<')
    .replaceAll('id="finTotalRevenue">' + DASH + '<', 'id="finTotalRevenue">—<')
    .replaceAll('id="finClientsPaid">' + DASH + '<', 'id="finClientsPaid">—<')
    .replaceAll('id="finTotalPayments">' + DASH + '<', 'id="finTotalPayments">—<')
    .replaceAll(`Clientes ${DASH} histórico financeiro`, 'Clientes — histórico financeiro')
    .replace(/<!-- .*VIEW: LIST.*-->/g, '<!-- VIEW: LIST -->')
    .replace(/<!-- .*VIEW: BUILDER.*-->/g, '<!-- VIEW: BUILDER -->')
    .replace(/<!-- .*VIEW: RESPONSES.*-->/g, '<!-- VIEW: RESPONSES -->')
    .replace(/<!-- .*VIEW: EDITOR.*-->/g, '<!-- VIEW: EDITOR -->')
    .replace(/<!-- .*VIEW: PROGRESS.*-->/g, '<!-- VIEW: PROGRESS -->')
    .replace(/<!-- .*MODAL: New\/Edit Journey.*-->/g, '<!-- MODAL: New/Edit Journey -->')
    .replace(/<!-- .*MODAL: Add Step.*-->/g, '<!-- MODAL: Add Step -->')
    .replace(/<!-- .*MODAL: Assign client to Journey.*-->/g, '<!-- MODAL: Assign client to Journey -->')
    .replace(/<!-- .*MODAL: New Form.*-->/g, '<!-- MODAL: New Form -->')
    .replace(/<!-- .*MODAL: Logic Editor.*-->/g, '<!-- MODAL: Logic Editor -->')
    .replace(/<!-- .*MODAL: Assign Clients.*-->/g, '<!-- MODAL: Assign Clients -->')
    .replace(/<!-- .*MODAL: Response detail.*-->/g, '<!-- MODAL: Response detail -->')
    .replaceAll('            \uFFFD \uFFFD Todos os formulários', '            ← Todos os formulários')
    .replaceAll('id="fb-builder-title" class="journey-editor-title form-builder-title">' + DASH + '<', 'id="fb-builder-title" class="journey-editor-title form-builder-title">—<')
    .replaceAll('\uFFFDa"\uFFFD¸\u008f Configurações', 'Configurações')
    .replaceAll('\uFFFDx\u0018\uFFFD Atribuir clientes', 'Atribuir clientes')
    .replaceAll('\uFFFDx\u001c` Estatísticas', 'Estatísticas')
    .replaceAll('form-builder-canvas-empty-icon">\uFFFDx\u001c9<', 'form-builder-canvas-empty-icon">🧩<')
    .replaceAll('form-builder-props-empty-icon">\uFFFDx\u0018\uFFFD<', 'form-builder-props-empty-icon">👆<')
    .replaceAll('\uFFFDx\u001c\uFFFD Exportar CSV', 'Exportar CSV')
    .replaceAll('\uFFFD \uFFFD Voltar', '← Voltar')
    .replaceAll('onclick="jrnLoadList()">\uFFFD \uFFFD Todas as jornadas</button>', 'onclick="jrnLoadList()">← Todas as jornadas</button>')
    .replaceAll('id="jrn-editor-title" class="journey-editor-title">' + DASH + '<', 'id="jrn-editor-title" class="journey-editor-title">—<')
    .replaceAll('\uFFFDS\uFFFD\uFFFD¸\u008f Editar', 'Editar')
    .replaceAll('\uFFFDx\u0018\uFFFD Atribuir cliente', 'Atribuir cliente')
    .replaceAll('id="jrn-progress-back-btn">\uFFFD \uFFFD Voltar</button>', 'id="jrn-progress-back-btn">← Voltar</button>')
    .replaceAll(`<option value="">${DASH} Nenhum formulário ${DASH}</option>`, '<option value="">— Nenhum formulário —</option>')
    .replaceAll('Criar formulário \uFFFD \u0019', 'Criar formulário')
    .replaceAll('form-builder-modal-title">\uFFFDx\u001d\uFFFD Lógica Condicional<', 'form-builder-modal-title">Lógica Condicional<')
    .replaceAll('form-builder-modal-title">\uFFFDx\u0018\uFFFD Atribuir Clientes<', 'form-builder-modal-title">Atribuir Clientes<')
    .replaceAll('form-builder-modal-title">\uFFFDx\u001c` Detalhes da Resposta<', 'form-builder-modal-title">Detalhes da Resposta<');
}

function fixPrimary(text) {
  return text
    .replaceAll(`user.company || '${DASH}'`, "user.company || '—'")
    .replaceAll(`Etapa \${stepNumber} ${DASH} \${STEP_TITLES[stepNumber]}`, 'Etapa ${stepNumber} — ${STEP_TITLES[stepNumber]}');
}

function fixData(text) {
  return text
    .replaceAll(`return '${DASH}';`, "return '—';")
    .replaceAll(` empresa operando no negativo');`, ` — empresa operando no negativo');`)
    .replaceAll(`${DASH} — empresa operando no negativo`, '— empresa operando no negativo')
    .replaceAll(` risco elevado de insolvência');`, ` — risco elevado de insolvência');`)
    .replaceAll(`${DASH} — risco elevado de insolvência`, '— risco elevado de insolvência')
    .replaceAll(` reestruturação urgente');`, ` — reestruturação urgente');`)
    .replaceAll(`${DASH} — reestruturação urgente`, '— reestruturação urgente')
    .replaceAll(` priorizar renegociação');`, ` — priorizar renegociação');`)
    .replaceAll(`${DASH} — priorizar renegociação`, '— priorizar renegociação')
    .replaceAll(` risco de penhora de ativos\`);`, ` — risco de penhora de ativos\`);`)
    .replaceAll(`${DASH} — risco de penhora de ativos`, '— risco de penhora de ativos')
    .replaceAll(` risco trabalhista imediato');`, ` — risco trabalhista imediato');`)
    .replaceAll(`${DASH} — risco trabalhista imediato`, '— risco trabalhista imediato')
    .replaceAll(` passivo oculto a quantificar');`, ` — passivo oculto a quantificar');`)
    .replaceAll(`${DASH} — passivo oculto a quantificar`, '— passivo oculto a quantificar')
    .replaceAll(` avaliar impacto operacional e trabalhista');`, ` — avaliar impacto operacional e trabalhista');`)
    .replaceAll(`${DASH} — avaliar impacto operacional e trabalhista`, '— avaliar impacto operacional e trabalhista')
    .replaceAll(` risco de insolvência sem intervenção estruturada');`, ` — risco de insolvência sem intervenção estruturada');`)
    .replaceAll(`${DASH} — risco de insolvência sem intervenção estruturada`, '— risco de insolvência sem intervenção estruturada')
    .replaceAll(` cenário crítico');`, ` — cenário crítico');`)
    .replaceAll(`${DASH} — cenário crítico`, '— cenário crítico')
    .replaceAll(` meta: reduzir para <60% da receita');`, ` — meta: reduzir para <60% da receita');`)
    .replaceAll(`${DASH} — meta: reduzir para <60% da receita`, '— meta: reduzir para <60% da receita')
    .replaceAll(` capital humano é ativo crítico na recuperação');`, ` — capital humano é ativo crítico na recuperação');`)
    .replaceAll(`${DASH} — capital humano é ativo crítico na recuperação`, '— capital humano é ativo crítico na recuperação')
    .replaceAll(` evitar judicialização desnecessária');`, ` — evitar judicialização desnecessária');`)
    .replaceAll(`${DASH} — evitar judicialização desnecessária`, '— evitar judicialização desnecessária')
    .replaceAll(`value !== '${DASH}'`, "value !== '—'")
    .replaceAll(`debt.nomeCredor||'${DASH}'`, "debt.nomeCredor||'—'")
    .replaceAll(`debt.tipoDivida||'${DASH}'`, "debt.tipoDivida||'—'")
    .replaceAll(`fmtCur(debt.valorOriginal)||'${DASH}'`, "fmtCur(debt.valorOriginal)||'—'")
    .replaceAll(`fmtCur(debt.saldoAtual)||'${DASH}'`, "fmtCur(debt.saldoAtual)||'—'")
    .replaceAll(`Análise SWOT ${DASH} Forças`, 'Análise SWOT — Forças')
    .replaceAll(`Análise SWOT ${DASH} Fraquezas`, 'Análise SWOT — Fraquezas')
    .replaceAll(`Análise SWOT ${DASH} Oportunidades`, 'Análise SWOT — Oportunidades')
    .replaceAll(`Análise SWOT ${DASH} Ameaças`, 'Análise SWOT — Ameaças')
    .replaceAll(`user.company || '${DASH}'`, "user.company || '—'")
    .replaceAll(`empresa.cnpj || '${DASH}'`, "empresa.cnpj || '—'");
}

function fixSecondary(text) {
  return text
    .replaceAll(`icon: '\uFFFDx\u001c9'`, "icon: '📌'")
    .replaceAll(`icon: '\uFFFDx\u001c\u001e'`, "icon: '📄'")
    .replaceAll(`icon: '\uFFFDx\u001c\`'`, "icon: '🔄'")
    .replaceAll(`icon: '\uFFFDS&'`, "icon: '✅'")
    .replaceAll(`icon: '\uFFFDx\u001c&'`, "icon: '📅'")
    .replaceAll('\uFFFDx\u001c& Novo agendamento', 'Novo agendamento')
    .replaceAll(`slot.title || '${DASH}'`, "slot.title || '—'")
    .replaceAll(`\uFFFD\u001c \${String(endsAt.getHours()).padStart(2,'0')}:\${String(endsAt.getMinutes()).padStart(2,'0')}`, '— ${String(endsAt.getHours()).padStart(2,\'0\')}:${String(endsAt.getMinutes()).padStart(2,\'0\')}')
    .replaceAll('\uFFFDS& Confirmar', 'Confirmar')
    .replaceAll('\uFFFD "\uFFFD¸\u008f Remarcar', 'Remarcar')
    .replaceAll('\uFFFDR Cancelar', 'Cancelar')
    .replaceAll(`label:'Enviado ${DASH} revisar'`, "label:'Enviado — revisar'")
    .replaceAll(`Enviados ${DASH} aguardando revisão`, 'Enviados — aguardando revisão');
}

function fixTertiary(text) {
  return text
    .replaceAll(`: '${DASH}';`, ": '—';")
    .replace(/^\s*\/\/ .*Financeiro.*$/m, '  // Financeiro')
    .replace(/^\s*\/\/ .*Equipe.*$/m, '  // Equipe')
    .replace(/^\s*\/\/ .*Organograma.*$/m, '  // Organograma')
    .replace(/^\s*\/\/ .*Credores.*$/m, '  // Credores')
    .replace(/^\s*\/\/ .*Fornecedores.*$/m, '  // Fornecedores')
    .replace(/^\s*\/\/ .*Funcionários.*$/m, '  // Funcionários')
    .replaceAll('\uFFFDx\u001c\uFFFD ${escHtml(deptMap[m.department_id] || \'Dept\')}', 'Departamento: ${escHtml(deptMap[m.department_id] || \'Dept\')}')
    .replaceAll('\uFFFDx\u0018\uFFFD ${escHtml(manager.name)}', 'Gestor: ${escHtml(manager.name)}')
    .replaceAll('\uFFFDx\uFFFD\uFFFD Organograma da Empresa', 'Organograma da Empresa')
    .replaceAll(`parseFloat(c.current_balance).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '${DASH}'`, "parseFloat(c.current_balance).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—'")
    .replaceAll(`escHtml(s.category || '${DASH}')`, "escHtml(s.category || '—')")
    .replaceAll(`escHtml(supplierMap[c.supplier_id]?.name || '${DASH}')`, "escHtml(supplierMap[c.supplier_id]?.name || '—')")
    .replaceAll(`escHtml(e.job_title || '${DASH}')`, "escHtml(e.job_title || '—')")
    .replaceAll(`e.salary_cents ? fmtBRL(e.salary_cents) : '${DASH}'`, "e.salary_cents ? fmtBRL(e.salary_cents) : '—'");
}

for (const file of files) {
  updateFile(file, (text) => {
    if (file.endsWith('public/admin.html')) return fixAdminHtml(text);
    if (file.endsWith('client-detail-tabs-primary.js')) return fixPrimary(text);
    if (file.endsWith('client-detail-data.js')) return fixData(text);
    if (file.endsWith('client-detail-tabs-secondary.js')) return fixSecondary(text);
    if (file.endsWith('client-detail-tabs-tertiary.js')) return fixTertiary(text);
    return text;
  });
}
