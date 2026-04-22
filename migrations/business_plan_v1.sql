-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v1 — Migrations
-- Adiciona suporte a conteúdo rico, metadados de arquivos e auditoria.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Expandir re_plan_chapters ─────────────────────────────────────────────
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS content          TEXT;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS attachments      JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS last_editor_id   UUID;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS client_action    TEXT    DEFAULT 'pendente'; -- 'pendente', 'aprovado', 'revisao_solicitada'

-- ─── 2. Trigger para atualizar updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_re_plan_chapters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_re_plan_chapters_updated_at') THEN
        CREATE TRIGGER tr_re_plan_chapters_updated_at
            BEFORE UPDATE ON re_plan_chapters
            FOR EACH ROW
            EXECUTE FUNCTION update_re_plan_chapters_updated_at();
    END IF;
END
$$;

-- ─── 3. Índices para performance ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_re_plan_chapters_user_id ON re_plan_chapters(user_id);
CREATE INDEX IF NOT EXISTS idx_re_plan_chapters_status ON re_plan_chapters(status);

-- ─── Done ──────────────────────────────────────────────────────────────────────
