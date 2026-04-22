-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v5 — Audit Log Table
-- Centraliza registros de auditoria para todas as ações em capítulos
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Criar tabela de auditoria ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS re_plan_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  chapter_id            INTEGER NOT NULL,
  action                TEXT NOT NULL,  -- 'publish', 'approve', 'request_revision', 'edit', etc
  performed_by          UUID NOT NULL,
  performed_by_role     TEXT NOT NULL,  -- 'consultor', 'cliente', 'system'
  metadata              JSONB DEFAULT '{}'::jsonb,  -- Additional context (status_before, status_after, reason, etc)
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES re_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_performed_by FOREIGN KEY (performed_by) REFERENCES re_users(id) ON DELETE SET NULL
);

-- ─── 2. Índices para performance ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_plan_audit_user_chapter 
  ON re_plan_audit_log(user_id, chapter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_audit_action 
  ON re_plan_audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_audit_performed_by 
  ON re_plan_audit_log(performed_by);

-- ─── 3. Habilitar RLS na tabela de auditoria ──────────────────────────────
ALTER TABLE re_plan_audit_log ENABLE ROW LEVEL SECURITY;

-- Clientes veem auditoria de seus próprios capítulos
CREATE POLICY "Clientes veem auditoria de seus capítulos"
  ON re_plan_audit_log FOR SELECT
  USING (auth.uid() = user_id);

-- Consultores veem auditoria de capítulos de clientes que gerenciam
CREATE POLICY "Consultores veem auditoria"
  ON re_plan_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Sistema pode inserir registros de auditoria
CREATE POLICY "Sistema insere registros de auditoria"
  ON re_plan_audit_log FOR INSERT
  WITH CHECK (true);

-- ─── Done ──────────────────────────────────────────────────────────────────────
