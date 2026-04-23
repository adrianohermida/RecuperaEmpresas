'use strict';
/**
 * ─── Módulo de Notas Fiscais ─────────────────────────────────────────────────
 * Suporta NFS-e Municipal (padrão ABRASF) e NF-e Nacional (DANFE)
 * Funcionalidades:
 *   - Upload de PDF com extração automática de metadados via regex
 *   - Importação de planilha XLS/XLSX/CSV com mapeamento flexível de colunas
 *   - CRUD completo de notas fiscais
 *   - Estatísticas e dados para gráficos
 *   - Download do arquivo original
 */

const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { sb, UPLOADS_DIR } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');

// ─── Multer: upload de PDF e planilhas ────────────────────────────────────────
const fiscalUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, 'fiscal-notes');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ts  = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `fn_${ts}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (/^(pdf|xls|xlsx|csv)$/.test(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido. Use PDF, XLS, XLSX ou CSV.'));
  },
});

// ─── Helpers de formatação ────────────────────────────────────────────────────
/** Converte valor monetário (string BR ou float) para centavos (inteiro) */
function parseBRL(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.round(val * 100);
  const s = String(val).trim()
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/** Converte centavos para float */
function centsToFloat(cents) {
  return (cents || 0) / 100;
}

/** Formata centavos como string BRL */
function formatBRL(cents) {
  return (centsToFloat(cents)).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL'
  });
}

/** Extrai metadados de texto de PDF de NFS-e / NF-e via regex */
function extractNFMetadata(text) {
  const meta = {};

  // Número da NFS-e
  const numMatch = text.match(/(?:NFS-e|N[úu]mero da NFS-e|Número)\s*[:\-]?\s*(\d+)/i);
  if (numMatch) meta.numero_nfe = numMatch[1];

  // Chave de acesso (32 ou 44 dígitos)
  const chaveMatch = text.match(/(?:Chave de Acesso|Chave)\s*[:\-]?\s*(\d{32,44})/i);
  if (chaveMatch) meta.chave_acesso = chaveMatch[1];

  // Data de emissão
  const dataMatch = text.match(/(?:Data|Emiss[aã]o|Data e Hora da emiss[aã]o)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (dataMatch) {
    const [d, m, y] = dataMatch[1].split('/');
    meta.data_emissao = `${y}-${m}-${d}`;
  }

  // Competência
  const compMatch = text.match(/Compet[eê]ncia\s*[:\-]?\s*(\d{2}\/\d{4})/i);
  if (compMatch) meta.competencia = compMatch[1];

  // CNPJ emitente
  const cnpjEmitMatch = text.match(/(?:CNPJ|CPF\/CNPJ)\s*[:\-]?\s*(\d{2}[\.\-]?\d{3}[\.\-]?\d{3}[\/\.\-]?\d{4}[\-]?\d{2})/);
  if (cnpjEmitMatch) meta.emitente_cnpj = cnpjEmitMatch[1].replace(/[^\d]/g, '');

  // Razão social emitente (linha após CNPJ ou "Prestador")
  const prestMatch = text.match(/(?:Prestador de Servi[çc]o|Nome\/Nome Empresarial|Nome\/Raz[aã]o Social)\s*[:\-]?\s*([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇa-záéíóúàâêôãõç\s\.\-&]+?)(?:\n|CPF|CNPJ|Endere[çc]o)/i);
  if (prestMatch) meta.emitente_razao_social = prestMatch[1].trim();

  // Município emitente
  const munMatch = text.match(/Munic[íi]pio\s*[:\-]?\s*([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇa-záéíóúàâêôãõç\s]+?)\s*(?:UF|CEP|\n)/i);
  if (munMatch) meta.emitente_municipio = munMatch[1].trim();

  // UF
  const ufMatch = text.match(/UF\s*[:\-]?\s*([A-Z]{2})/);
  if (ufMatch) meta.emitente_uf = ufMatch[1];

  // Valor do serviço
  const valServMatch = text.match(/Valor do Servi[çc]o\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (valServMatch) meta.valor_servico = parseBRL(valServMatch[1]);

  // Valor líquido
  const valLiqMatch = text.match(/Valor L[íi]quido\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (valLiqMatch) meta.valor_liquido = parseBRL(valLiqMatch[1]);

  // ISSQN
  const issqnMatch = text.match(/ISSQN?\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (issqnMatch) meta.valor_issqn = parseBRL(issqnMatch[1]);

  // Alíquota
  const aliqMatch = text.match(/Al[íi]quota\s*[:\-]?\s*([\d\.,]+)\s*%?/i);
  if (aliqMatch) meta.aliquota_issqn = parseFloat(aliqMatch[1].replace(',', '.'));

  // Desconto
  const descMatch = text.match(/Desconto\s*(?:Incondicionado)?\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (descMatch) meta.valor_desconto = parseBRL(descMatch[1]);

  // PIS
  const pisMatch = text.match(/PIS\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (pisMatch) meta.valor_pis = parseBRL(pisMatch[1]);

  // COFINS
  const cofinsMatch = text.match(/COFINS\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (cofinsMatch) meta.valor_cofins = parseBRL(cofinsMatch[1]);

  // INSS
  const inssMatch = text.match(/INSS\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (inssMatch) meta.valor_inss = parseBRL(inssMatch[1]);

  // IR
  const irMatch = text.match(/\bIR\b\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (irMatch) meta.valor_ir = parseBRL(irMatch[1]);

  // CSLL
  const csllMatch = text.match(/CSLL\s*[:\-]?\s*R?\$?\s*([\d\.,]+)/i);
  if (csllMatch) meta.valor_csll = parseBRL(csllMatch[1]);

  // Simples Nacional
  if (/Simples Nacional/i.test(text)) meta.simples_nacional = true;

  // ISS Retido
  if (/ISS(?:QN)?\s*a\s*Reter\s*[:\-]?\s*(?:\(X\)\s*)?Sim/i.test(text) ||
      /Reten[çc][aã]o do ISSQN\s*[:\-]?\s*Retido/i.test(text)) {
    meta.iss_retido = true;
  }

  // Tipo de nota
  if (/DANFSe|NFS-e|Nota Fiscal de Servi[çc]o/i.test(text)) meta.tipo_nota = 'NFS-e';
  else if (/DANFE|NF-e|Nota Fiscal Eletr[ôo]nica de Produto/i.test(text)) meta.tipo_nota = 'NF-e';
  else if (/CT-e|Conhecimento de Transporte/i.test(text)) meta.tipo_nota = 'CT-e';

  return meta;
}

/** Mapeia cabeçalho de planilha para campos do banco */
function mapColumnHeader(header) {
  const h = String(header).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const MAP = {
    numero_nfe:           /^(numero|numero_nfe|nfe|nota|num_nota|numero_nota)$/,
    data_emissao:         /^(data|data_emissao|emissao|data_nota|dt_emissao|data_emiss)$/,
    competencia:          /^(competencia|compet|mes_competencia|periodo)$/,
    tipo_nota:            /^(tipo|tipo_nota|tipo_nf|tipo_fiscal)$/,
    emitente_cnpj:        /^(cnpj|cnpj_emitente|cnpj_prestador|cpf_cnpj|cnpj_fornecedor)$/,
    emitente_razao_social:/^(emitente|prestador|fornecedor|razao_social|nome_empresa|empresa)$/,
    emitente_municipio:   /^(municipio|municipio_emitente|cidade|municipio_prestador)$/,
    emitente_uf:          /^(uf|estado|uf_emitente)$/,
    tomador_cnpj:         /^(cnpj_tomador|cnpj_cliente|tomador_cnpj|cpf_cnpj_tomador)$/,
    tomador_razao_social: /^(tomador|cliente|nome_cliente|razao_social_tomador)$/,
    descricao_servico:    /^(descricao|servico|discriminacao|descricao_servico|historico)$/,
    valor_servico:        /^(valor|valor_servico|valor_bruto|total|valor_total|vl_servico)$/,
    valor_desconto:       /^(desconto|valor_desconto|descontos|vl_desconto)$/,
    valor_liquido:        /^(valor_liquido|liquido|valor_final|vl_liquido|valor_liq)$/,
    aliquota_issqn:       /^(aliquota|aliq|aliquota_iss|aliquota_issqn|aliq_iss)$/,
    valor_issqn:          /^(issqn|iss|imposto_municipal|valor_iss|vl_issqn)$/,
    iss_retido:           /^(iss_retido|issqn_retido|retencao_iss|retido)$/,
    valor_pis:            /^(pis|valor_pis|vl_pis)$/,
    valor_cofins:         /^(cofins|valor_cofins|vl_cofins)$/,
    valor_inss:           /^(inss|valor_inss|vl_inss)$/,
    valor_ir:             /^(ir|irrf|valor_ir|vl_ir)$/,
    valor_csll:           /^(csll|valor_csll|vl_csll)$/,
    status:               /^(status|situacao|situacao_nota)$/,
    observacoes:          /^(observacoes|obs|notas|comentarios|informacoes)$/,
  };

  for (const [field, regex] of Object.entries(MAP)) {
    if (regex.test(h)) return field;
  }
  return null;
}

/** Serializa nota para resposta JSON (centavos → float) */
function serializeNote(note) {
  return {
    ...note,
    valor_servico:  centsToFloat(note.valor_servico),
    valor_desconto: centsToFloat(note.valor_desconto),
    valor_deducoes: centsToFloat(note.valor_deducoes),
    base_calculo:   centsToFloat(note.base_calculo),
    valor_liquido:  centsToFloat(note.valor_liquido),
    valor_issqn:    centsToFloat(note.valor_issqn),
    valor_pis:      centsToFloat(note.valor_pis),
    valor_cofins:   centsToFloat(note.valor_cofins),
    valor_inss:     centsToFloat(note.valor_inss),
    valor_ir:       centsToFloat(note.valor_ir),
    valor_csll:     centsToFloat(note.valor_csll),
    // Formatted
    valor_servico_fmt:  formatBRL(note.valor_servico),
    valor_liquido_fmt:  formatBRL(note.valor_liquido),
    valor_issqn_fmt:    formatBRL(note.valor_issqn),
  };
}

// ─── GET /api/fiscal-notes — listar notas do usuário ─────────────────────────
router.get('/api/fiscal-notes', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      tipo_nota,
      status,
      competencia,
      search,
      sort = 'data_emissao',
      order = 'desc',
    } = req.query;

    let query = sb.from('re_fiscal_notes')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (tipo_nota)    query = query.eq('tipo_nota', tipo_nota);
    if (status)       query = query.eq('status', status);
    if (competencia)  query = query.eq('competencia', competencia);
    if (search) {
      query = query.or(
        `numero_nfe.ilike.%${search}%,emitente_razao_social.ilike.%${search}%,emitente_cnpj.ilike.%${search}%,descricao_servico.ilike.%${search}%`
      );
    }

    const validSorts = ['data_emissao','created_at','valor_liquido','valor_servico','numero_nfe'];
    const sortField  = validSorts.includes(sort) ? sort : 'data_emissao';
    const ascending  = order === 'asc';

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query
      .order(sortField, { ascending })
      .range(offset, offset + parseInt(limit) - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      notes: (data || []).map(serializeNote),
      total: count || 0,
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil((count || 0) / parseInt(limit)),
    });
  } catch (err) {
    console.error('[fiscal-notes] GET error:', err);
    res.status(500).json({ error: 'Erro ao listar notas fiscais.' });
  }
});

// ─── GET /api/fiscal-notes/stats — estatísticas para gráficos ────────────────
router.get('/api/fiscal-notes/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { months = 12 } = req.query;

    const since = new Date();
    since.setMonth(since.getMonth() - parseInt(months));

    // Faturamento mensal
    const { data: monthly } = await sb.from('re_fiscal_notes')
      .select('data_emissao, valor_servico, valor_liquido, valor_issqn, valor_pis, valor_cofins, valor_inss, valor_ir, valor_csll, tipo_nota')
      .eq('user_id', userId)
      .neq('status', 'cancelado')
      .gte('data_emissao', since.toISOString())
      .order('data_emissao', { ascending: true });

    // Totais gerais
    const { data: totals } = await sb.from('re_fiscal_notes')
      .select('valor_servico, valor_liquido, valor_issqn, status, tipo_nota')
      .eq('user_id', userId);

    // Top emitentes
    const { data: allNotes } = await sb.from('re_fiscal_notes')
      .select('emitente_cnpj, emitente_razao_social, valor_liquido')
      .eq('user_id', userId)
      .neq('status', 'cancelado')
      .not('emitente_cnpj', 'is', null);

    // Processar dados mensais
    const monthlyMap = {};
    (monthly || []).forEach(n => {
      if (!n.data_emissao) return;
      const d   = new Date(n.data_emissao);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) {
        monthlyMap[key] = {
          mes: key,
          label: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
          total_servico:  0,
          total_liquido:  0,
          total_issqn:    0,
          total_federais: 0,
          quantidade:     0,
          tipos: {},
        };
      }
      const m = monthlyMap[key];
      m.total_servico  += n.valor_servico  || 0;
      m.total_liquido  += n.valor_liquido  || 0;
      m.total_issqn    += n.valor_issqn    || 0;
      m.total_federais += (n.valor_pis || 0) + (n.valor_cofins || 0) +
                          (n.valor_inss || 0) + (n.valor_ir || 0) + (n.valor_csll || 0);
      m.quantidade++;
      m.tipos[n.tipo_nota] = (m.tipos[n.tipo_nota] || 0) + 1;
    });

    const monthlyData = Object.values(monthlyMap).map(m => ({
      ...m,
      total_servico_fmt:  formatBRL(m.total_servico),
      total_liquido_fmt:  formatBRL(m.total_liquido),
      total_issqn_fmt:    formatBRL(m.total_issqn),
      total_federais_fmt: formatBRL(m.total_federais),
      // Para Chart.js (float)
      total_servico_f:  centsToFloat(m.total_servico),
      total_liquido_f:  centsToFloat(m.total_liquido),
      total_issqn_f:    centsToFloat(m.total_issqn),
      total_federais_f: centsToFloat(m.total_federais),
    }));

    // Totais gerais
    const summary = {
      total_notas:     (totals || []).length,
      total_servico:   0,
      total_liquido:   0,
      total_issqn:     0,
      por_status:      {},
      por_tipo:        {},
    };
    (totals || []).forEach(n => {
      summary.total_servico += n.valor_servico || 0;
      summary.total_liquido += n.valor_liquido || 0;
      summary.total_issqn   += n.valor_issqn   || 0;
      summary.por_status[n.status]    = (summary.por_status[n.status] || 0) + 1;
      summary.por_tipo[n.tipo_nota]   = (summary.por_tipo[n.tipo_nota] || 0) + 1;
    });
    summary.total_servico_fmt = formatBRL(summary.total_servico);
    summary.total_liquido_fmt = formatBRL(summary.total_liquido);
    summary.total_issqn_fmt   = formatBRL(summary.total_issqn);
    summary.total_servico_f   = centsToFloat(summary.total_servico);
    summary.total_liquido_f   = centsToFloat(summary.total_liquido);

    // Top emitentes
    const emitMap = {};
    (allNotes || []).forEach(n => {
      const key = n.emitente_cnpj;
      if (!emitMap[key]) emitMap[key] = {
        cnpj: n.emitente_cnpj,
        razao_social: n.emitente_razao_social || n.emitente_cnpj,
        total: 0, quantidade: 0,
      };
      emitMap[key].total     += n.valor_liquido || 0;
      emitMap[key].quantidade++;
    });
    const topEmitentes = Object.values(emitMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(e => ({
        ...e,
        total_fmt: formatBRL(e.total),
        total_f:   centsToFloat(e.total),
      }));

    res.json({ monthly: monthlyData, summary, topEmitentes });
  } catch (err) {
    console.error('[fiscal-notes] stats error:', err);
    res.status(500).json({ error: 'Erro ao carregar estatísticas.' });
  }
});

// ─── GET /api/fiscal-notes/:id — detalhe de uma nota ─────────────────────────
router.get('/api/fiscal-notes/:id', requireAuth, async (req, res) => {
  try {
    const { data: note, error } = await sb.from('re_fiscal_notes')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !note) return res.status(404).json({ error: 'Nota fiscal não encontrada.' });
    res.json({ note: serializeNote(note) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar nota fiscal.' });
  }
});

// ─── POST /api/fiscal-notes/upload-pdf — upload de PDF ───────────────────────
router.post('/api/fiscal-notes/upload-pdf',
  requireAuth,
  fiscalUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const filePath = req.file.path;
    let extractedMeta = {};

    try {
      // Tentar extrair texto do PDF via pdftotext (poppler-utils)
      const { execSync } = require('child_process');
      try {
        const pdfText = execSync(`pdftotext "${filePath}" -`, {
          timeout: 15000,
          maxBuffer: 5 * 1024 * 1024,
        }).toString('utf-8');
        extractedMeta = extractNFMetadata(pdfText);
      } catch (pdfErr) {
        console.warn('[fiscal-notes] pdftotext failed, using manual entry:', pdfErr.message);
      }

      // Upload para Supabase Storage
      let storagePath = null;
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const remotePath = `${req.user.id}/${req.file.filename}`;
        const { data: storageData, error: storageErr } = await sb.storage
          .from('fiscal-notes')
          .upload(remotePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: false,
          });
        if (!storageErr) storagePath = storageData.path;
      } catch (storageErr) {
        console.warn('[fiscal-notes] Storage upload failed:', storageErr.message);
      }

      // Inserir no banco
      const noteData = {
        user_id:        req.user.id,
        arquivo_path:   storagePath || req.file.filename,
        arquivo_nome:   req.file.originalname,
        arquivo_tamanho: req.file.size,
        fonte:          'upload_pdf',
        status:         Object.keys(extractedMeta).length > 2 ? 'processado' : 'pendente',
        ...extractedMeta,
      };

      // Mesclar com dados manuais enviados no body
      const manualFields = [
        'numero_nfe','tipo_nota','data_emissao','competencia',
        'emitente_cnpj','emitente_razao_social','emitente_municipio','emitente_uf',
        'tomador_cnpj','tomador_razao_social','descricao_servico',
        'valor_servico','valor_liquido','valor_issqn','observacoes',
      ];
      manualFields.forEach(f => {
        if (req.body[f] !== undefined && req.body[f] !== '') {
          if (['valor_servico','valor_liquido','valor_issqn'].includes(f)) {
            noteData[f] = parseBRL(req.body[f]);
          } else {
            noteData[f] = req.body[f];
          }
        }
      });

      const { data: note, error: dbErr } = await sb.from('re_fiscal_notes')
        .insert(noteData)
        .select()
        .single();

      if (dbErr) throw dbErr;

      // Limpar arquivo temporário
      try { fs.unlinkSync(filePath); } catch {}

      res.json({
        success: true,
        note:    serializeNote(note),
        extracted: Object.keys(extractedMeta).length,
        message: Object.keys(extractedMeta).length > 2
          ? `${Object.keys(extractedMeta).length} campos extraídos automaticamente do PDF.`
          : 'PDF salvo. Preencha os dados manualmente.',
      });
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch {}
      console.error('[fiscal-notes] upload-pdf error:', err);
      res.status(500).json({ error: 'Erro ao processar o PDF.' });
    }
  }
);

// ─── POST /api/fiscal-notes/import-spreadsheet — importar XLS/CSV ────────────
router.post('/api/fiscal-notes/import-spreadsheet',
  requireAuth,
  fiscalUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const filePath = req.file.path;
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet     = workbook.Sheets[sheetName];
      const rows      = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (rows.length < 2) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'Planilha vazia ou sem dados.' });
      }

      // Mapear cabeçalhos
      const headers = rows[0].map(h => mapColumnHeader(h));
      const dataRows = rows.slice(1).filter(row => row.some(cell => cell !== ''));

      if (dataRows.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'Nenhuma linha de dados encontrada.' });
      }

      // Converter linhas em objetos
      const notes = dataRows.map(row => {
        const obj = { user_id: req.user.id, fonte: 'importacao_planilha', status: 'processado' };
        headers.forEach((field, i) => {
          if (!field || row[i] === '' || row[i] === null || row[i] === undefined) return;
          const val = row[i];

          // Campos de valor monetário
          if (['valor_servico','valor_desconto','valor_deducoes','base_calculo','valor_liquido',
               'valor_issqn','valor_pis','valor_cofins','valor_inss','valor_ir','valor_csll'].includes(field)) {
            obj[field] = parseBRL(val);
          }
          // Campos booleanos
          else if (['iss_retido','simples_nacional'].includes(field)) {
            obj[field] = /^(sim|s|yes|y|1|true|x)$/i.test(String(val).trim());
          }
          // Data
          else if (field === 'data_emissao') {
            // Tentar parsear data em vários formatos
            let d = null;
            if (typeof val === 'number') {
              // Número serial do Excel
              d = XLSX.SSF.parse_date_code(val);
              if (d) obj[field] = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            } else {
              const s = String(val).trim();
              const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
              const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (m1) obj[field] = `${m1[3]}-${m1[2]}-${m1[1]}`;
              else if (m2) obj[field] = s.slice(0, 10);
              else obj[field] = s;
            }
          }
          // Alíquota
          else if (field === 'aliquota_issqn') {
            obj[field] = parseFloat(String(val).replace(',', '.').replace('%', '')) || 0;
          }
          else {
            obj[field] = String(val).trim().slice(0, 500);
          }
        });

        // Calcular base de cálculo se não informada
        if (!obj.base_calculo && obj.valor_servico) {
          obj.base_calculo = (obj.valor_servico || 0) - (obj.valor_desconto || 0) - (obj.valor_deducoes || 0);
        }

        // Calcular valor líquido se não informado
        if (!obj.valor_liquido && obj.valor_servico) {
          const tributos = (obj.valor_issqn || 0) + (obj.valor_pis || 0) +
                           (obj.valor_cofins || 0) + (obj.valor_inss || 0) +
                           (obj.valor_ir || 0) + (obj.valor_csll || 0);
          obj.valor_liquido = (obj.valor_servico || 0) - (obj.valor_desconto || 0) - tributos;
        }

        return obj;
      }).filter(n => n.valor_servico || n.numero_nfe || n.emitente_razao_social);

      if (notes.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'Nenhuma nota válida encontrada na planilha.' });
      }

      // Inserir em lote
      const { data: inserted, error: dbErr } = await sb.from('re_fiscal_notes')
        .insert(notes)
        .select('id, numero_nfe, valor_servico, valor_liquido, status');

      if (dbErr) throw dbErr;

      fs.unlinkSync(filePath);

      res.json({
        success:  true,
        imported: inserted?.length || 0,
        total:    dataRows.length,
        skipped:  dataRows.length - notes.length,
        notes:    (inserted || []).map(n => ({
          ...n,
          valor_servico_fmt: formatBRL(n.valor_servico),
          valor_liquido_fmt: formatBRL(n.valor_liquido),
        })),
        message:  `${inserted?.length || 0} notas importadas com sucesso.`,
      });
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch {}
      console.error('[fiscal-notes] import-spreadsheet error:', err);
      res.status(500).json({ error: 'Erro ao processar a planilha: ' + err.message });
    }
  }
);

// ─── POST /api/fiscal-notes — criar nota manual ───────────────────────────────
router.post('/api/fiscal-notes', requireAuth, async (req, res) => {
  try {
    const {
      numero_nfe, chave_acesso, serie, tipo_nota, data_emissao, competencia,
      emitente_cnpj, emitente_razao_social, emitente_municipio, emitente_uf, emitente_inscricao,
      tomador_cnpj, tomador_razao_social, tomador_municipio, tomador_uf,
      descricao_servico, codigo_servico, codigo_cnae, regime_tributacao, simples_nacional,
      valor_servico, valor_desconto, valor_deducoes, base_calculo, valor_liquido,
      aliquota_issqn, valor_issqn, iss_retido,
      valor_pis, valor_cofins, valor_inss, valor_ir, valor_csll,
      pct_tributos_federal, pct_tributos_estadual, pct_tributos_municipal,
      observacoes, status,
    } = req.body;

    const { data: note, error } = await sb.from('re_fiscal_notes').insert({
      user_id: req.user.id,
      numero_nfe, chave_acesso, serie,
      tipo_nota:             tipo_nota || 'NFS-e',
      data_emissao, competencia,
      emitente_cnpj, emitente_razao_social, emitente_municipio, emitente_uf, emitente_inscricao,
      tomador_cnpj, tomador_razao_social, tomador_municipio, tomador_uf,
      descricao_servico, codigo_servico, codigo_cnae, regime_tributacao,
      simples_nacional: simples_nacional === true || simples_nacional === 'true',
      valor_servico:  parseBRL(valor_servico),
      valor_desconto: parseBRL(valor_desconto),
      valor_deducoes: parseBRL(valor_deducoes),
      base_calculo:   parseBRL(base_calculo),
      valor_liquido:  parseBRL(valor_liquido),
      aliquota_issqn: parseFloat(aliquota_issqn) || 0,
      valor_issqn:    parseBRL(valor_issqn),
      iss_retido:     iss_retido === true || iss_retido === 'true',
      valor_pis:      parseBRL(valor_pis),
      valor_cofins:   parseBRL(valor_cofins),
      valor_inss:     parseBRL(valor_inss),
      valor_ir:       parseBRL(valor_ir),
      valor_csll:     parseBRL(valor_csll),
      pct_tributos_federal:   parseFloat(pct_tributos_federal) || 0,
      pct_tributos_estadual:  parseFloat(pct_tributos_estadual) || 0,
      pct_tributos_municipal: parseFloat(pct_tributos_municipal) || 0,
      observacoes,
      fonte:  'manual',
      status: status || 'processado',
    }).select().single();

    if (error) throw error;
    res.json({ success: true, note: serializeNote(note) });
  } catch (err) {
    console.error('[fiscal-notes] POST error:', err);
    res.status(500).json({ error: 'Erro ao criar nota fiscal.' });
  }
});

// ─── PUT /api/fiscal-notes/:id — editar nota ─────────────────────────────────
router.put('/api/fiscal-notes/:id', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await sb.from('re_fiscal_notes')
      .select('id').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!existing) return res.status(404).json({ error: 'Nota não encontrada.' });

    const updates = {};
    const textFields = [
      'numero_nfe','chave_acesso','serie','tipo_nota','data_emissao','competencia',
      'emitente_cnpj','emitente_razao_social','emitente_municipio','emitente_uf','emitente_inscricao',
      'tomador_cnpj','tomador_razao_social','tomador_municipio','tomador_uf',
      'descricao_servico','codigo_servico','codigo_cnae','regime_tributacao',
      'observacoes','status',
    ];
    const moneyFields = [
      'valor_servico','valor_desconto','valor_deducoes','base_calculo','valor_liquido',
      'valor_issqn','valor_pis','valor_cofins','valor_inss','valor_ir','valor_csll',
    ];

    textFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    moneyFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = parseBRL(req.body[f]); });

    if (req.body.aliquota_issqn !== undefined) updates.aliquota_issqn = parseFloat(req.body.aliquota_issqn) || 0;
    if (req.body.simples_nacional !== undefined) updates.simples_nacional = req.body.simples_nacional === true || req.body.simples_nacional === 'true';
    if (req.body.iss_retido !== undefined) updates.iss_retido = req.body.iss_retido === true || req.body.iss_retido === 'true';

    const { data: note, error } = await sb.from('re_fiscal_notes')
      .update(updates)
      .eq('id', req.params.id)
      .select().single();

    if (error) throw error;
    res.json({ success: true, note: serializeNote(note) });
  } catch (err) {
    console.error('[fiscal-notes] PUT error:', err);
    res.status(500).json({ error: 'Erro ao atualizar nota fiscal.' });
  }
});

// ─── DELETE /api/fiscal-notes/:id — excluir nota ─────────────────────────────
router.delete('/api/fiscal-notes/:id', requireAuth, async (req, res) => {
  try {
    const { data: note } = await sb.from('re_fiscal_notes')
      .select('arquivo_path').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!note) return res.status(404).json({ error: 'Nota não encontrada.' });

    // Remover arquivo do Storage se existir
    if (note.arquivo_path) {
      try {
        await sb.storage.from('fiscal-notes').remove([note.arquivo_path]);
      } catch {}
    }

    const { error } = await sb.from('re_fiscal_notes')
      .delete().eq('id', req.params.id);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[fiscal-notes] DELETE error:', err);
    res.status(500).json({ error: 'Erro ao excluir nota fiscal.' });
  }
});

// ─── GET /api/fiscal-notes/:id/file — download do PDF ────────────────────────
router.get('/api/fiscal-notes/:id/file', async (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  requireAuth(req, res, next);
}, async (req, res) => {
  try {
    const { data: note } = await sb.from('re_fiscal_notes')
      .select('arquivo_path, arquivo_nome')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!note || !note.arquivo_path) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    // Tentar Supabase Storage primeiro
    try {
      const { data: signedUrl } = await sb.storage
        .from('fiscal-notes')
        .createSignedUrl(note.arquivo_path, 300); // 5 min
      if (signedUrl?.signedUrl) {
        return res.redirect(signedUrl.signedUrl);
      }
    } catch {}

    // Fallback: arquivo local
    const localPath = path.join(UPLOADS_DIR, 'fiscal-notes', note.arquivo_path);
    if (fs.existsSync(localPath)) {
      res.setHeader('Content-Disposition', `inline; filename="${note.arquivo_nome || 'nota-fiscal.pdf'}"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.sendFile(localPath);
    }

    res.status(404).json({ error: 'Arquivo não encontrado no storage.' });
  } catch (err) {
    console.error('[fiscal-notes] file error:', err);
    res.status(500).json({ error: 'Erro ao acessar arquivo.' });
  }
});

// ─── Admin: listar notas de um cliente ────────────────────────────────────────
router.get('/api/admin/fiscal-notes/:clientId', requireAdmin, async (req, res) => {
  try {
    const { data, error, count } = await sb.from('re_fiscal_notes')
      .select('*', { count: 'exact' })
      .eq('user_id', req.params.clientId)
      .order('data_emissao', { ascending: false })
      .limit(200);

    if (error) throw error;
    res.json({ notes: (data || []).map(serializeNote), total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar notas do cliente.' });
  }
});

module.exports = router;
