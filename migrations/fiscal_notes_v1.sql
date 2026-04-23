-- ═══════════════════════════════════════════════════════════════════════════════
-- Módulo de Notas Fiscais — v1
-- Compatível com NFS-e Municipal (padrão ABRASF) e NF-e Nacional (DANFE)
-- Execute no Supabase SQL Editor. Todos os statements são idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Tabela principal de notas fiscais ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS re_fiscal_notes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,

  -- Identificação
  numero_nfe            TEXT,
  chave_acesso          TEXT,
  serie                 TEXT,
  tipo_nota             TEXT        DEFAULT 'NFS-e'
                                    CHECK (tipo_nota IN ('NFS-e','NF-e','NF-Produto','CT-e','NFC-e','Outros')),
  data_emissao          TIMESTAMPTZ,
  competencia           TEXT,       -- formato: "MM/YYYY"

  -- Emitente
  emitente_cnpj         TEXT,
  emitente_razao_social TEXT,
  emitente_municipio    TEXT,
  emitente_uf           TEXT,
  emitente_inscricao    TEXT,

  -- Tomador
  tomador_cnpj          TEXT,
  tomador_razao_social  TEXT,
  tomador_municipio     TEXT,
  tomador_uf            TEXT,

  -- Serviço / Produto
  descricao_servico     TEXT,
  codigo_servico        TEXT,
  codigo_cnae           TEXT,
  regime_tributacao     TEXT,
  simples_nacional      BOOLEAN     DEFAULT FALSE,

  -- Valores (em centavos para evitar ponto flutuante)
  valor_servico         BIGINT      DEFAULT 0,   -- em centavos
  valor_desconto        BIGINT      DEFAULT 0,
  valor_deducoes        BIGINT      DEFAULT 0,
  base_calculo          BIGINT      DEFAULT 0,
  valor_liquido         BIGINT      DEFAULT 0,

  -- Tributos municipais
  aliquota_issqn        NUMERIC(6,4) DEFAULT 0,
  valor_issqn           BIGINT      DEFAULT 0,
  iss_retido            BOOLEAN     DEFAULT FALSE,

  -- Tributos federais (em centavos)
  valor_pis             BIGINT      DEFAULT 0,
  valor_cofins          BIGINT      DEFAULT 0,
  valor_inss            BIGINT      DEFAULT 0,
  valor_ir              BIGINT      DEFAULT 0,
  valor_csll            BIGINT      DEFAULT 0,

  -- Percentuais aproximados de tributos
  pct_tributos_federal  NUMERIC(6,4) DEFAULT 0,
  pct_tributos_estadual NUMERIC(6,4) DEFAULT 0,
  pct_tributos_municipal NUMERIC(6,4) DEFAULT 0,

  -- Arquivo
  arquivo_path          TEXT,       -- path no Supabase Storage bucket 'fiscal-notes'
  arquivo_nome          TEXT,
  arquivo_tamanho       BIGINT,

  -- Metadados
  fonte                 TEXT        DEFAULT 'upload_pdf'
                                    CHECK (fonte IN ('upload_pdf','importacao_planilha','manual')),
  status                TEXT        DEFAULT 'pendente'
                                    CHECK (status IN ('pendente','processado','erro','cancelado')),
  observacoes           TEXT,
  dados_extras          JSONB       DEFAULT '{}',

  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. Índices de performance ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_user_id
  ON re_fiscal_notes(user_id);

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_data_emissao
  ON re_fiscal_notes(data_emissao DESC);

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_competencia
  ON re_fiscal_notes(competencia);

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_tipo_nota
  ON re_fiscal_notes(tipo_nota);

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_status
  ON re_fiscal_notes(status);

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_emitente_cnpj
  ON re_fiscal_notes(emitente_cnpj) WHERE emitente_cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_re_fiscal_notes_chave_acesso
  ON re_fiscal_notes(chave_acesso) WHERE chave_acesso IS NOT NULL;

-- ─── 3. Trigger para updated_at automático ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_re_fiscal_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_re_fiscal_notes_updated_at ON re_fiscal_notes;
CREATE TRIGGER trg_re_fiscal_notes_updated_at
  BEFORE UPDATE ON re_fiscal_notes
  FOR EACH ROW EXECUTE FUNCTION update_re_fiscal_notes_updated_at();

-- ─── 4. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE re_fiscal_notes ENABLE ROW LEVEL SECURITY;

-- Usuário só vê suas próprias notas
DROP POLICY IF EXISTS "owner_select_fiscal_notes" ON re_fiscal_notes;
CREATE POLICY "owner_select_fiscal_notes"
  ON re_fiscal_notes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "owner_insert_fiscal_notes" ON re_fiscal_notes;
CREATE POLICY "owner_insert_fiscal_notes"
  ON re_fiscal_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "owner_update_fiscal_notes" ON re_fiscal_notes;
CREATE POLICY "owner_update_fiscal_notes"
  ON re_fiscal_notes FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "owner_delete_fiscal_notes" ON re_fiscal_notes;
CREATE POLICY "owner_delete_fiscal_notes"
  ON re_fiscal_notes FOR DELETE
  USING (user_id = auth.uid());

-- ─── 5. View de estatísticas por período ──────────────────────────────────────
CREATE OR REPLACE VIEW re_fiscal_notes_stats AS
SELECT
  user_id,
  DATE_TRUNC('month', data_emissao)                      AS mes,
  tipo_nota,
  COUNT(*)                                                AS quantidade,
  SUM(valor_servico)                                      AS total_valor_servico,
  SUM(valor_liquido)                                      AS total_valor_liquido,
  SUM(valor_issqn)                                        AS total_issqn,
  SUM(valor_pis + valor_cofins + valor_inss + valor_ir + valor_csll) AS total_tributos_federais,
  SUM(valor_desconto)                                     AS total_descontos
FROM re_fiscal_notes
WHERE status != 'cancelado'
GROUP BY user_id, DATE_TRUNC('month', data_emissao), tipo_nota;

-- ─── 6. View de top emitentes ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW re_fiscal_notes_top_emitentes AS
SELECT
  user_id,
  emitente_cnpj,
  emitente_razao_social,
  COUNT(*)           AS quantidade_notas,
  SUM(valor_liquido) AS total_valor_liquido
FROM re_fiscal_notes
WHERE status != 'cancelado'
  AND emitente_cnpj IS NOT NULL
GROUP BY user_id, emitente_cnpj, emitente_razao_social
ORDER BY total_valor_liquido DESC;

-- ─── Done ──────────────────────────────────────────────────────────────────────
-- Para criar o bucket no Supabase Storage, execute via dashboard:
-- Storage > New Bucket > Name: "fiscal-notes" > Public: false
