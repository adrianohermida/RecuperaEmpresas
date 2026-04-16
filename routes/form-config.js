'use strict';
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { requireAuth, requireAdmin } = require('../lib/auth');

const FORM_CONFIG_PATH = path.join(__dirname, '..', 'form-config.json');

const FORM_CONFIG_DEFAULTS = {
  steps: [
    { id: 1, title: 'Consentimento LGPD', description: '', enabled: true, required: true },
    { id: 2, title: 'Dados da Empresa', description: '', enabled: true, required: true },
    { id: 3, title: 'Sócios', description: '', enabled: true, required: true },
    { id: 4, title: 'Estrutura Operacional', description: '', enabled: true, required: false },
    { id: 5, title: 'Quadro de Funcionários', description: '', enabled: true, required: false },
    { id: 6, title: 'Ativos', description: '', enabled: true, required: false },
    { id: 7, title: 'Dados Financeiros', description: '', enabled: true, required: true },
    { id: 8, title: 'Dívidas e Credores', description: '', enabled: true, required: true },
    { id: 9, title: 'Histórico da Crise', description: '', enabled: true, required: false },
    { id: 10, title: 'Diagnóstico Estratégico', description: '', enabled: true, required: false },
    { id: 11, title: 'Mercado e Operação', description: '', enabled: true, required: false },
    { id: 12, title: 'Expectativas e Estratégia', description: '', enabled: true, required: false },
    { id: 13, title: 'Documentos', description: '', enabled: true, required: false },
    { id: 14, title: 'Confirmação e Envio', description: '', enabled: true, required: true },
  ],
  welcomeMessage: 'Preencha as informações da sua empresa para que possamos elaborar o Business Plan de recuperação.',
  lastUpdated: null,
};

function readFormConfig() {
  try {
    if (fs.existsSync(FORM_CONFIG_PATH)) {
      const raw = fs.readFileSync(FORM_CONFIG_PATH, 'utf8');
      const config = JSON.parse(raw);
      const mergedSteps = FORM_CONFIG_DEFAULTS.steps.map((defaultStep) => {
        const savedStep = (config.steps || []).find((step) => step.id === defaultStep.id);
        return savedStep ? { ...defaultStep, ...savedStep } : defaultStep;
      });
      return { ...FORM_CONFIG_DEFAULTS, ...config, steps: mergedSteps };
    }
  } catch (error) {
    console.warn('[FORM-CONFIG] read error:', error.message);
  }

  return {
    ...FORM_CONFIG_DEFAULTS,
    steps: FORM_CONFIG_DEFAULTS.steps.map((step) => ({ ...step })),
  };
}

function writeFormConfig(config) {
  try {
    fs.writeFileSync(FORM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('[FORM-CONFIG] write error:', error.message);
    throw error;
  }
}

router.get('/api/form-config', requireAuth, (req, res) => {
  const config = readFormConfig();
  res.json({
    steps: config.steps.filter((step) => step.enabled),
    welcomeMessage: config.welcomeMessage || '',
  });
});

router.get('/api/admin/form-config', requireAdmin, (req, res) => {
  res.json(readFormConfig());
});

router.put('/api/admin/form-config', requireAdmin, (req, res) => {
  try {
    const current = readFormConfig();
    const { steps, welcomeMessage } = req.body;
    const merged = FORM_CONFIG_DEFAULTS.steps.map((defaultStep) => {
      const incoming = (steps || []).find((step) => step.id === defaultStep.id);
      if (!incoming) return current.steps.find((step) => step.id === defaultStep.id) || defaultStep;

      return {
        id: defaultStep.id,
        title: (typeof incoming.title === 'string' ? incoming.title.trim() : '') || defaultStep.title,
        description: typeof incoming.description === 'string' ? incoming.description.trim() : '',
        enabled: !!incoming.enabled,
        required: !!incoming.required,
      };
    });

    merged[0] = { ...merged[0], enabled: true, required: true };
    merged[13] = { ...merged[13], enabled: true, required: true };

    const updated = {
      ...current,
      steps: merged,
      welcomeMessage: typeof welcomeMessage === 'string' ? welcomeMessage.trim() : current.welcomeMessage,
      lastUpdated: new Date().toISOString(),
    };

    writeFormConfig(updated);
    res.json({ success: true, config: updated });
  } catch (error) {
    console.error('[FORM-CONFIG PUT]', error.message);
    res.status(500).json({ error: 'Erro ao salvar configuração.' });
  }
});

module.exports = router;