-- ═══════════════════════════════════════════════════════════════════════════════
-- Agenda v3 — Enhancements & Business Plan Integration
-- Aprimoramentos na Agenda com integração ao módulo de Business Plan
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Adicionar campos de integração com Business Plan ────────────────────
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS plan_chapter_id INTEGER;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS plan_chapter_status TEXT;  -- 'pending', 'in_review', 'approved'
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS related_plan_id UUID;  -- Referência ao plano do cliente

-- ─── 2. Adicionar campos de feedback e avaliação ──────────────────────────
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS feedback_rating INTEGER;  -- 1-5 stars
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS feedback_comment TEXT;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMPTZ;

-- ─── 3. Adicionar campos de rastreamento de status ────────────────────────
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;  -- Histórico de mudanças de status
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMPTZ;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS attendees JSONB DEFAULT '[]'::jsonb;  -- Array de participantes

-- ─── 4. Criar tabela de conflitos de agenda ────────────────────────────────
CREATE TABLE IF NOT EXISTS re_agenda_conflicts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID NOT NULL,
  conflict_type         TEXT NOT NULL,  -- 'double_booking', 'overlap', 'insufficient_credits', 'no_show'
  description           TEXT,
  detected_at           TIMESTAMPTZ DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT,
  
  CONSTRAINT fk_conflicts_booking FOREIGN KEY (booking_id) REFERENCES re_bookings(id) ON DELETE CASCADE
);

-- ─── 5. Criar tabela de métricas de Agenda ────────────────────────────────
CREATE TABLE IF NOT EXISTS re_agenda_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id         UUID,
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  total_slots_created   INTEGER DEFAULT 0,
  total_bookings        INTEGER DEFAULT 0,
  confirmed_bookings    INTEGER DEFAULT 0,
  cancelled_bookings    INTEGER DEFAULT 0,
  no_show_count         INTEGER DEFAULT 0,
  average_rating        DECIMAL(3,2),
  total_credits_earned  INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_metrics_consultant FOREIGN KEY (consultant_id) REFERENCES re_users(id) ON DELETE CASCADE,
  UNIQUE(consultant_id, period_start, period_end)
);

-- ─── 6. Criar tabela de templates de agendamento ───────────────────────────
CREATE TABLE IF NOT EXISTS re_agenda_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id         UUID NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  duration_min          INTEGER DEFAULT 60,
  credits_cost          INTEGER DEFAULT 1,
  max_bookings          INTEGER DEFAULT 1,
  location              TEXT DEFAULT 'online',
  color_tag             TEXT,  -- Para visualização no calendário
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_templates_consultant FOREIGN KEY (consultant_id) REFERENCES re_users(id) ON DELETE CASCADE
);

-- ─── 7. Adicionar índices para performance ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_plan_chapter 
  ON re_bookings(plan_chapter_id) WHERE plan_chapter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_status_history 
  ON re_bookings USING GIN(status_history);

CREATE INDEX IF NOT EXISTS idx_conflicts_booking 
  ON re_agenda_conflicts(booking_id);

CREATE INDEX IF NOT EXISTS idx_conflicts_resolved 
  ON re_agenda_conflicts(resolved_at) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_metrics_consultant_period 
  ON re_agenda_metrics(consultant_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_templates_consultant 
  ON re_agenda_templates(consultant_id, is_active);

-- ─── 8. Criar view para agendamentos com integração ao Business Plan ───────
CREATE OR REPLACE VIEW v_bookings_with_plan AS
SELECT 
  b.id,
  b.slot_id,
  b.user_id,
  b.status,
  b.created_at,
  b.confirmed_at,
  b.credits_spent,
  b.plan_chapter_id,
  b.plan_chapter_status,
  b.feedback_rating,
  b.feedback_submitted_at,
  s.starts_at,
  s.ends_at,
  s.title,
  s.location,
  s.meet_link,
  u.name as client_name,
  u.email as client_email,
  u.company as client_company,
  pc.title as chapter_title,
  pc.status as chapter_status
FROM re_bookings b
LEFT JOIN re_agenda_slots s ON b.slot_id = s.id
LEFT JOIN re_users u ON b.user_id = u.id
LEFT JOIN re_plan_chapters pc ON b.plan_chapter_id = pc.chapter_id AND b.user_id = pc.user_id;

-- ─── Done ──────────────────────────────────────────────────────────────────────
