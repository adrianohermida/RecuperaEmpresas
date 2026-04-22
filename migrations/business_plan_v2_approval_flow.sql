-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v2 — Approval Flow Migrations
-- Adiciona suporte a fluxo de aprovação com auditoria de timestamps.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Expandir re_plan_chapters com campos de auditoria ────────────────────
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS approved_by        UUID;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ;
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS revision_requested_by UUID;

-- ─── 2. Índices para performance em queries de auditoria ──────────────────────
CREATE INDEX IF NOT EXISTS idx_re_plan_chapters_approved_at 
  ON re_plan_chapters(approved_at) WHERE approved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_re_plan_chapters_revision_requested_at 
  ON re_plan_chapters(revision_requested_at) WHERE revision_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_re_plan_chapters_published_at 
  ON re_plan_chapters(published_at) WHERE published_at IS NOT NULL;

-- ─── Done ──────────────────────────────────────────────────────────────────────
