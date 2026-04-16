'use strict';

const { sb } = require('./config');

// ── Default onboarding form definition ────────────────────────────────────────
// Mirrors the 14-step portal onboarding flow so Jornadas + Formulários modules
// have working content out of the box.

const SYSTEM_FORM_KEY = 'onboarding_14steps';
const SYSTEM_JOURNEY_KEY = 'jornada_recuperacao_empresarial';

const FORM_DEF = {
  title: 'Formulário de Onboarding — Recuperação Empresarial',
  description: 'Coleta de informações completas para diagnóstico e elaboração do Business Plan de recuperação.',
  type: 'onboarding',
  status: 'published',
  settings: {
    allow_save_draft: true,
    show_progress_bar: true,
    progress_style: 'steps',
  },
  pages: [
    {
      order_index: 0,
      title: 'Consentimento LGPD',
      description: 'Leitura e aceite do termo de uso e política de privacidade.',
      questions: [
        { order_index: 0, type: 'section',    label: 'Termo de Consentimento', description: 'Antes de iniciar, leia atentamente o Termo de Consentimento LGPD.' },
        { order_index: 1, type: 'yes_no',     label: 'Confirmo que li e aceito os Termos de Uso e a Política de Privacidade.', required: true },
        { order_index: 2, type: 'yes_no',     label: 'Autorizo o tratamento dos dados informados neste formulário para fins de elaboração do diagnóstico e do Business Plan.', required: true },
        { order_index: 3, type: 'short_text', label: 'Nome completo do responsável pela empresa', required: true },
        { order_index: 4, type: 'date',       label: 'Data de aceite', required: true },
      ],
    },
    {
      order_index: 1,
      title: 'Dados da Empresa',
      description: 'Informações cadastrais e gerais da empresa.',
      questions: [
        { order_index: 0, type: 'short_text', label: 'Razão Social', required: true },
        { order_index: 1, type: 'short_text', label: 'Nome Fantasia' },
        { order_index: 2, type: 'short_text', label: 'CNPJ', required: true },
        { order_index: 3, type: 'date',       label: 'Data de fundação', required: true },
        { order_index: 4, type: 'dropdown',   label: 'Porte da empresa', required: true, options: ['MEI', 'ME', 'EPP', 'Médio Porte', 'Grande Porte'] },
        { order_index: 5, type: 'dropdown',   label: 'Regime tributário', required: true, options: ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI', 'Outro'] },
        { order_index: 6, type: 'short_text', label: 'CNAE principal (código e descrição)', required: true },
        { order_index: 7, type: 'short_text', label: 'Endereço completo da sede', required: true },
        { order_index: 8, type: 'short_text', label: 'Telefone comercial', required: true },
        { order_index: 9, type: 'short_text', label: 'E-mail comercial', required: true },
        { order_index: 10, type: 'short_text', label: 'Site / redes sociais' },
      ],
    },
    {
      order_index: 2,
      title: 'Sócios',
      description: 'Identificação e participação dos sócios.',
      questions: [
        { order_index: 0, type: 'section',    label: 'Quadro Societário', description: 'Liste todos os sócios da empresa.' },
        { order_index: 1, type: 'short_text', label: 'Nome completo do sócio 1', required: true },
        { order_index: 2, type: 'percentage', label: 'Participação do sócio 1 (%)', required: true },
        { order_index: 3, type: 'short_text', label: 'CPF do sócio 1', required: true },
        { order_index: 4, type: 'short_text', label: 'Nome completo do sócio 2 (se houver)' },
        { order_index: 5, type: 'percentage', label: 'Participação do sócio 2 (%)' },
        { order_index: 6, type: 'short_text', label: 'CPF do sócio 2' },
        { order_index: 7, type: 'short_text', label: 'Nome completo do sócio 3 (se houver)' },
        { order_index: 8, type: 'percentage', label: 'Participação do sócio 3 (%)' },
        { order_index: 9, type: 'yes_no',     label: 'Há sócios com restrições financeiras (SPC/Serasa/protestos)?' },
        { order_index: 10, type: 'long_text', label: 'Descreva as restrições, se houver' },
      ],
    },
    {
      order_index: 3,
      title: 'Estrutura Operacional',
      description: 'Detalhes sobre a estrutura e operação da empresa.',
      questions: [
        { order_index: 0, type: 'dropdown',   label: 'Setor de atuação', required: true, options: ['Indústria', 'Comércio', 'Serviços', 'Agronegócio', 'Tecnologia', 'Construção Civil', 'Saúde', 'Educação', 'Outro'] },
        { order_index: 1, type: 'long_text',  label: 'Descreva o produto ou serviço principal da empresa', required: true },
        { order_index: 2, type: 'short_text', label: 'Quantos anos de operação a empresa possui?', required: true },
        { order_index: 3, type: 'single_choice', label: 'A empresa possui filiais?', required: true, options: ['Sim', 'Não'] },
        { order_index: 4, type: 'number',     label: 'Quantas filiais? (se houver)' },
        { order_index: 5, type: 'dropdown',   label: 'Abrangência geográfica de atuação', options: ['Local', 'Regional', 'Estadual', 'Nacional', 'Internacional'] },
        { order_index: 6, type: 'multi_choice', label: 'Canais de venda utilizados', options: ['Loja física', 'E-commerce', 'Representantes', 'Distribuidores', 'Licitações', 'Redes sociais', 'Marketplace', 'Outros'] },
        { order_index: 7, type: 'long_text',  label: 'Descreva o processo produtivo ou de prestação de serviço' },
      ],
    },
    {
      order_index: 4,
      title: 'Quadro de Funcionários',
      description: 'Informações sobre o corpo de colaboradores.',
      questions: [
        { order_index: 0, type: 'number',     label: 'Total de funcionários (CLT)', required: true },
        { order_index: 1, type: 'number',     label: 'Total de terceirizados / autônomos' },
        { order_index: 2, type: 'number',     label: 'Total de sócios ativos na operação' },
        { order_index: 3, type: 'yes_no',     label: 'Há passivo trabalhista em aberto (ações, acordos pendentes)?', required: true },
        { order_index: 4, type: 'currency',   label: 'Valor estimado do passivo trabalhista (R$)' },
        { order_index: 5, type: 'yes_no',     label: 'Há atraso no pagamento de salários?' },
        { order_index: 6, type: 'long_text',  label: 'Descreva a situação dos salários em atraso, se houver' },
      ],
    },
    {
      order_index: 5,
      title: 'Ativos',
      description: 'Levantamento dos bens e ativos da empresa.',
      questions: [
        { order_index: 0, type: 'section',    label: 'Bens Imóveis' },
        { order_index: 1, type: 'yes_no',     label: 'A empresa possui imóveis próprios?', required: true },
        { order_index: 2, type: 'currency',   label: 'Valor estimado dos imóveis (R$)' },
        { order_index: 3, type: 'long_text',  label: 'Descreva os imóveis (tipo, localização, situação)' },
        { order_index: 4, type: 'section',    label: 'Bens Móveis e Equipamentos' },
        { order_index: 5, type: 'yes_no',     label: 'A empresa possui veículos ou maquinários relevantes?' },
        { order_index: 6, type: 'currency',   label: 'Valor estimado de veículos e maquinários (R$)' },
        { order_index: 7, type: 'section',    label: 'Estoque e Recebíveis' },
        { order_index: 8, type: 'currency',   label: 'Valor do estoque atual (R$)' },
        { order_index: 9, type: 'currency',   label: 'Total de contas a receber (R$)' },
        { order_index: 10, type: 'long_text', label: 'Há ativos intangíveis relevantes (marcas, patentes, contratos)? Descreva.' },
      ],
    },
    {
      order_index: 6,
      title: 'Dados Financeiros',
      description: 'Situação financeira atual da empresa.',
      questions: [
        { order_index: 0, type: 'currency',   label: 'Faturamento médio mensal nos últimos 12 meses (R$)', required: true },
        { order_index: 1, type: 'currency',   label: 'Faturamento anual no último exercício (R$)', required: true },
        { order_index: 2, type: 'currency',   label: 'Custo fixo mensal total (R$)', required: true },
        { order_index: 3, type: 'currency',   label: 'Custo variável mensal estimado (R$)' },
        { order_index: 4, type: 'currency',   label: 'Lucro ou prejuízo médio mensal (R$)' },
        { order_index: 5, type: 'yes_no',     label: 'A empresa possui contabilidade atualizada?', required: true },
        { order_index: 6, type: 'yes_no',     label: 'Há inadimplência com fornecedores acima de 30 dias?' },
        { order_index: 7, type: 'yes_no',     label: 'A empresa possui certidões negativas em dia?' },
        { order_index: 8, type: 'file_upload', label: 'Anexe os últimos 3 balancetes ou DRE (PDF)' },
        { order_index: 9, type: 'file_upload', label: 'Anexe os últimos 3 extratos bancários (PDF)' },
      ],
    },
    {
      order_index: 7,
      title: 'Dívidas e Credores',
      description: 'Mapeamento completo das obrigações financeiras.',
      questions: [
        { order_index: 0, type: 'currency',   label: 'Total da dívida com bancos / financeiras (R$)', required: true },
        { order_index: 1, type: 'currency',   label: 'Total da dívida com fornecedores (R$)', required: true },
        { order_index: 2, type: 'currency',   label: 'Total da dívida tributária (R$)', required: true },
        { order_index: 3, type: 'currency',   label: 'Total da dívida trabalhista (R$)' },
        { order_index: 4, type: 'currency',   label: 'Outras dívidas — total estimado (R$)' },
        { order_index: 5, type: 'yes_no',     label: 'Há execuções fiscais ou penhoras em curso?', required: true },
        { order_index: 6, type: 'yes_no',     label: 'Há protesto de títulos?' },
        { order_index: 7, type: 'yes_no',     label: 'Há CNPJ com restrição nos órgãos de crédito (SPC/Serasa)?' },
        { order_index: 8, type: 'long_text',  label: 'Liste os principais credores (nome, valor, situação)' },
        { order_index: 9, type: 'file_upload', label: 'Anexe relatório de dívidas ou planilha de credores (PDF/XLS)' },
      ],
    },
    {
      order_index: 8,
      title: 'Histórico da Crise',
      description: 'Contexto e origem das dificuldades financeiras.',
      questions: [
        { order_index: 0, type: 'long_text',  label: 'Descreva como e quando se iniciou a crise financeira da empresa', required: true },
        { order_index: 1, type: 'multi_choice', label: 'Quais foram as principais causas da crise?', required: true, options: ['Queda de faturamento', 'Perda de clientes', 'Aumento de custos', 'Endividamento excessivo', 'Problemas de gestão', 'Impacto externo (pandemia, regulação)', 'Concorrência', 'Desvios ou fraudes', 'Outros'] },
        { order_index: 2, type: 'long_text',  label: 'Quais medidas já foram tomadas para contornar a crise?' },
        { order_index: 3, type: 'yes_no',     label: 'A empresa já solicitou recuperação judicial anteriormente?' },
        { order_index: 4, type: 'long_text',  label: 'Se sim, descreva o resultado' },
        { order_index: 5, type: 'scale',      label: 'Nível de urgência para solução (1 = pode esperar, 10 = emergência imediata)', required: true, settings: { min: 1, max: 10 } },
      ],
    },
    {
      order_index: 9,
      title: 'Diagnóstico Estratégico',
      description: 'Análise das forças, fraquezas e diferenciais da empresa.',
      questions: [
        { order_index: 0, type: 'long_text',  label: 'Quais são os principais pontos fortes da empresa?', required: true },
        { order_index: 1, type: 'long_text',  label: 'Quais são os principais pontos fracos ou gargalos operacionais?' },
        { order_index: 2, type: 'long_text',  label: 'Quais oportunidades de mercado a empresa ainda não explorou?' },
        { order_index: 3, type: 'long_text',  label: 'Quais ameaças externas comprometem a viabilidade da empresa?' },
        { order_index: 4, type: 'yes_no',     label: 'A empresa possui algum diferencial competitivo claro?' },
        { order_index: 5, type: 'long_text',  label: 'Descreva o diferencial competitivo, se houver' },
      ],
    },
    {
      order_index: 10,
      title: 'Mercado e Operação',
      description: 'Análise do mercado e posicionamento competitivo.',
      questions: [
        { order_index: 0, type: 'long_text',  label: 'Descreva o perfil do cliente ideal (ICP) da empresa', required: true },
        { order_index: 1, type: 'number',     label: 'Quantos clientes ativos a empresa possui atualmente?', required: true },
        { order_index: 2, type: 'percentage', label: 'Qual o percentual de receita concentrado nos 3 maiores clientes (%)?' },
        { order_index: 3, type: 'long_text',  label: 'Quem são os principais concorrentes diretos?' },
        { order_index: 4, type: 'dropdown',   label: 'Como a empresa se posiciona em relação aos concorrentes?', options: ['Líder', 'Challenger', 'Seguidor', 'Nicho', 'Sem posicionamento definido'] },
        { order_index: 5, type: 'long_text',  label: 'Há sazonalidade relevante no faturamento? Descreva.' },
        { order_index: 6, type: 'yes_no',     label: 'A empresa possui contratos de longo prazo com clientes ou parceiros?' },
      ],
    },
    {
      order_index: 11,
      title: 'Expectativas e Estratégia',
      description: 'Objetivos e plano desejado para a recuperação.',
      questions: [
        { order_index: 0, type: 'multi_choice', label: 'Qual(is) alternativa(s) de recuperação você considera viável(is)?', required: true, options: ['Recuperação Extrajudicial', 'Recuperação Judicial', 'Acordo direto com credores', 'Venda de ativos', 'Busca de investidores', 'Fusão ou aquisição', 'Encerramento ordenado'] },
        { order_index: 1, type: 'long_text',  label: 'Qual é o objetivo principal da empresa ao buscar a recuperação?', required: true },
        { order_index: 2, type: 'currency',   label: 'Qual o capital mínimo necessário para estabilizar a operação (R$)?' },
        { order_index: 3, type: 'number',     label: 'Em quantos meses você espera que a empresa esteja equilibrada?' },
        { order_index: 4, type: 'yes_no',     label: 'Há sócios ou investidores dispostos a aportar capital?' },
        { order_index: 5, type: 'long_text',  label: 'Descreva qualquer outra informação relevante para o processo de recuperação.' },
      ],
    },
    {
      order_index: 12,
      title: 'Documentos',
      description: 'Envio dos documentos necessários para análise.',
      questions: [
        { order_index: 0, type: 'section',    label: 'Documentos Obrigatórios', description: 'Envie os documentos listados abaixo. Formatos aceitos: PDF, JPG, PNG (máx. 10 MB por arquivo).' },
        { order_index: 1, type: 'file_upload', label: 'Contrato Social e alterações (PDF)', required: true },
        { order_index: 2, type: 'file_upload', label: 'Comprovante de inscrição no CNPJ — Cartão CNPJ (PDF)', required: true },
        { order_index: 3, type: 'file_upload', label: 'Certidões Negativas (Federal, Estadual, Municipal, FGTS, Trabalhista)' },
        { order_index: 4, type: 'file_upload', label: 'Última declaração de IR da empresa (ECF/IRPJ)' },
        { order_index: 5, type: 'file_upload', label: 'Relatório de faturamento dos últimos 12 meses' },
        { order_index: 6, type: 'file_upload', label: 'Documentos de identidade dos sócios (RG/CNH)' },
      ],
    },
    {
      order_index: 13,
      title: 'Confirmação',
      description: 'Revisão e envio final do formulário.',
      questions: [
        { order_index: 0, type: 'section',    label: 'Revisão Final', description: 'Por favor, revise as informações antes de enviar. Após o envio, nossa equipe entrará em contato em até 2 dias úteis.' },
        { order_index: 1, type: 'long_text',  label: 'Observações adicionais ou informações que deseja destacar para a equipe' },
        { order_index: 2, type: 'yes_no',     label: 'Confirmo que todas as informações fornecidas são verdadeiras e completas.', required: true },
      ],
    },
  ],
};

const JOURNEY_DEF = {
  name: 'Jornada de Recuperação Empresarial',
  description: 'Jornada padrão do sistema: coleta de dados via onboarding, diagnóstico e elaboração do plano de recuperação.',
  status: 'active',
  step: {
    title: 'Onboarding — Coleta de Dados',
    description: 'Preenchimento completo do formulário de diagnóstico inicial da empresa.',
    order_index: 0,
    is_optional: false,
  },
};

// ── Seed function ──────────────────────────────────────────────────────────────
async function seedDefaultContent() {
  try {
    // ── 1. Find an admin user to use as created_by ───────────────────────────
    const { data: adminUsers } = await sb.from('re_users')
      .select('id').eq('is_admin', true).order('created_at').limit(1);
    const adminId = adminUsers?.[0]?.id;
    if (!adminId) {
      console.warn('[SEED] seedDefaultContent: nenhum usuário admin encontrado, pulando seed de conteúdo.');
      return;
    }

    // ── 2. Seed the default form ─────────────────────────────────────────────
    const { data: existingForm } = await sb.from('re_forms')
      .select('id').eq('system_key', SYSTEM_FORM_KEY).maybeSingle();

    let formId = existingForm?.id;

    if (!formId) {
      const { data: newForm, error: formErr } = await sb.from('re_forms').insert({
        title: FORM_DEF.title,
        description: FORM_DEF.description,
        type: FORM_DEF.type,
        status: FORM_DEF.status,
        settings: FORM_DEF.settings,
        is_system: true,
        system_key: SYSTEM_FORM_KEY,
        created_by: adminId,
      }).select('id').single();

      if (formErr) {
        console.warn('[SEED] Erro ao criar formulário padrão:', formErr.message);
        return;
      }
      formId = newForm.id;
      console.log('[SEED] Formulário padrão criado:', formId);

      // Insert pages + questions
      for (const pageDef of FORM_DEF.pages) {
        const { data: newPage, error: pageErr } = await sb.from('re_form_pages').insert({
          form_id: formId,
          title: pageDef.title,
          description: pageDef.description || null,
          order_index: pageDef.order_index,
        }).select('id').single();

        if (pageErr) {
          console.warn('[SEED] Erro ao criar página', pageDef.order_index, ':', pageErr.message);
          continue;
        }

        const pageId = newPage.id;
        const questionsToInsert = pageDef.questions.map((q) => ({
          form_id: formId,
          page_id: pageId,
          order_index: q.order_index,
          type: q.type,
          label: q.label,
          description: q.description || null,
          required: q.required || false,
          options: q.options ? JSON.stringify(q.options) : null,
          settings: q.settings ? JSON.stringify(q.settings) : null,
        }));

        const { error: qErr } = await sb.from('re_form_questions').insert(questionsToInsert);
        if (qErr) {
          console.warn('[SEED] Erro ao criar perguntas da página', pageDef.order_index, ':', qErr.message);
        }
      }
      console.log('[SEED] Páginas e perguntas do formulário padrão criadas.');
    } else {
      console.log('[SEED] Formulário padrão já existe:', formId);
    }

    // ── 3. Seed the default journey ──────────────────────────────────────────
    // Try system_key first; fall back to name match if column doesn't exist yet
    let existingJourney = null;
    try {
      const { data } = await sb.from('re_journeys')
        .select('id').eq('system_key', SYSTEM_JOURNEY_KEY).maybeSingle();
      existingJourney = data;
    } catch {
      const { data } = await sb.from('re_journeys')
        .select('id').eq('name', JOURNEY_DEF.name).maybeSingle();
      existingJourney = data;
    }
    if (!existingJourney) {
      // Double-check by name in case system_key column missing
      const { data: byName } = await sb.from('re_journeys')
        .select('id').eq('name', JOURNEY_DEF.name).maybeSingle();
      if (byName) existingJourney = byName;
    }

    if (!existingJourney) {
      const { data: newJourney, error: journeyErr } = await sb.from('re_journeys').insert({
        name: JOURNEY_DEF.name,
        description: JOURNEY_DEF.description,
        status: JOURNEY_DEF.status,
        system_key: SYSTEM_JOURNEY_KEY,
        is_system: true,
        created_by: adminId,
      }).select('id').single();

      if (journeyErr) {
        // If system_key or is_system columns don't exist yet, retry without them
        if (journeyErr.message?.includes('system_key') || journeyErr.message?.includes('is_system')) {
          const { data: fallbackJourney, error: fallbackErr } = await sb.from('re_journeys').insert({
            name: JOURNEY_DEF.name,
            description: JOURNEY_DEF.description,
            status: JOURNEY_DEF.status,
            created_by: adminId,
          }).select('id').single();
          if (fallbackErr) {
            console.warn('[SEED] Erro ao criar jornada padrão (fallback):', fallbackErr.message);
            return;
          }
          const journeyId = fallbackJourney.id;
          await _seedJourneyStep(journeyId, formId);
          console.log('[SEED] Jornada padrão criada (sem system_key):', journeyId);
          return;
        }
        console.warn('[SEED] Erro ao criar jornada padrão:', journeyErr.message);
        return;
      }

      const journeyId = newJourney.id;
      await _seedJourneyStep(journeyId, formId);
      console.log('[SEED] Jornada padrão criada:', journeyId);
    } else {
      console.log('[SEED] Jornada padrão já existe:', existingJourney.id);
    }
  } catch (err) {
    console.warn('[SEED] seedDefaultContent error:', err.message);
  }
}

async function _seedJourneyStep(journeyId, formId) {
  const { error } = await sb.from('re_journey_steps').insert({
    journey_id: journeyId,
    form_id: formId,
    title: JOURNEY_DEF.step.title,
    description: JOURNEY_DEF.step.description,
    order_index: JOURNEY_DEF.step.order_index,
    is_optional: JOURNEY_DEF.step.is_optional,
  });
  if (error) console.warn('[SEED] Erro ao criar etapa da jornada:', error.message);
}

module.exports = { seedDefaultContent };
