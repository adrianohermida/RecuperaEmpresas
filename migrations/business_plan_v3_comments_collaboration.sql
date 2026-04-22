-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v3 — Comments & Collaboration
-- Implementa um sistema de comentários estruturado com threads e permissões.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Criar tabela de comentários estruturados ────────────────────────────
CREATE TABLE IF NOT EXISTS re_plan_comments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  chapter_id            INTEGER NOT NULL,
  parent_comment_id     UUID,  -- Para respostas em thread
  author_id             UUID NOT NULL,
  author_name           TEXT,
  author_role           TEXT,  -- 'consultor', 'cliente', 'membro'
  content               TEXT NOT NULL,
  mentions              TEXT[],  -- Array de UUIDs de usuários mencionados
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,  -- Soft delete
  
  CONSTRAINT fk_plan_comments_user FOREIGN KEY (user_id) REFERENCES re_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_comments_author FOREIGN KEY (author_id) REFERENCES re_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_plan_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES re_plan_comments(id) ON DELETE CASCADE
);

-- ─── 2. Criar tabela de permissões de capítulos ────────────────────────────
CREATE TABLE IF NOT EXISTS re_plan_chapter_permissions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  chapter_id            INTEGER NOT NULL,
  member_id             UUID,  -- ID do membro da empresa (re_company_users)
  permission_type       TEXT NOT NULL,  -- 'view', 'comment', 'edit', 'approve'
  granted_by            UUID,  -- ID do consultor que concedeu
  granted_at            TIMESTAMPTZ DEFAULT NOW(),
  expires_at            TIMESTAMPTZ,  -- Permissão temporária
  
  CONSTRAINT fk_permissions_user FOREIGN KEY (user_id) REFERENCES re_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_permissions_granted_by FOREIGN KEY (granted_by) REFERENCES re_users(id) ON DELETE SET NULL,
  UNIQUE(user_id, chapter_id, member_id, permission_type)
);

-- ─── 3. Criar tabela de notificações de atividade ────────────────────────────
CREATE TABLE IF NOT EXISTS re_plan_notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id          UUID NOT NULL,
  actor_id              UUID,  -- Quem causou a ação
  chapter_id            INTEGER NOT NULL,
  notification_type     TEXT NOT NULL,  -- 'comment', 'approval', 'revision_request', 'mention'
  content               TEXT,
  related_comment_id    UUID,
  read_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES re_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES re_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_comment FOREIGN KEY (related_comment_id) REFERENCES re_plan_comments(id) ON DELETE CASCADE
);

-- ─── 4. Índices para performance ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_plan_comments_chapter 
  ON re_plan_comments(user_id, chapter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_comments_parent 
  ON re_plan_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_comments_author 
  ON re_plan_comments(author_id);

CREATE INDEX IF NOT EXISTS idx_plan_permissions_user_chapter 
  ON re_plan_chapter_permissions(user_id, chapter_id);

CREATE INDEX IF NOT EXISTS idx_plan_permissions_member 
  ON re_plan_chapter_permissions(member_id) WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_notifications_recipient 
  ON re_plan_notifications(recipient_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_notifications_chapter 
  ON re_plan_notifications(chapter_id, created_at DESC);

-- ─── 5. Atualizar re_plan_chapters para suportar visibilidade ──────────────
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';  -- 'private', 'team', 'public'
ALTER TABLE re_plan_chapters ADD COLUMN IF NOT EXISTS allowed_members UUID[] DEFAULT ARRAY[]::UUID[];  -- Array de IDs de membros com acesso

-- ─── Done ──────────────────────────────────────────────────────────────────────
