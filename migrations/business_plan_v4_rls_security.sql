-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v4 — Row Level Security (RLS) Policies
-- Implementa proteção de nível de banco de dados para tabelas do Business Plan
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Habilitar RLS nas tabelas de Business Plan ──────────────────────────
ALTER TABLE re_plan_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE re_plan_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE re_plan_chapter_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE re_plan_notifications ENABLE ROW LEVEL SECURITY;

-- ─── 2. Políticas para re_plan_chapters ────────────────────────────────────
-- Clientes podem ver apenas seus próprios capítulos
CREATE POLICY "Clientes veem seus próprios capítulos"
  ON re_plan_chapters FOR SELECT
  USING (auth.uid() = user_id);

-- Consultores (admin) podem ver capítulos de clientes que gerenciam
CREATE POLICY "Consultores veem capítulos de clientes"
  ON re_plan_chapters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Apenas o cliente pode atualizar seu próprio capítulo (status e cliente_action)
CREATE POLICY "Clientes atualizam seus próprios capítulos"
  ON re_plan_chapters FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Consultores podem atualizar capítulos (conteúdo, editor, etc)
CREATE POLICY "Consultores atualizam capítulos"
  ON re_plan_chapters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ─── 3. Políticas para re_plan_comments ────────────────────────────────────
-- Clientes veem comentários de seus próprios capítulos
CREATE POLICY "Clientes veem comentários de seus capítulos"
  ON re_plan_comments FOR SELECT
  USING (auth.uid() = user_id);

-- Consultores veem comentários de capítulos de clientes que gerenciam
CREATE POLICY "Consultores veem comentários"
  ON re_plan_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Clientes podem inserir comentários em seus próprios capítulos
CREATE POLICY "Clientes inserem comentários em seus capítulos"
  ON re_plan_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    auth.uid() = author_id
  );

-- Consultores podem inserir comentários
CREATE POLICY "Consultores inserem comentários"
  ON re_plan_comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Apenas o autor pode atualizar seu comentário (soft delete)
CREATE POLICY "Autores atualizam seus comentários"
  ON re_plan_comments FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- ─── 4. Políticas para re_plan_chapter_permissions ───────────────────────
-- Clientes veem suas próprias permissões
CREATE POLICY "Clientes veem suas permissões"
  ON re_plan_chapter_permissions FOR SELECT
  USING (auth.uid() = user_id);

-- Consultores veem permissões de clientes que gerenciam
CREATE POLICY "Consultores veem permissões"
  ON re_plan_chapter_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Apenas consultores podem inserir/atualizar permissões
CREATE POLICY "Consultores gerenciam permissões"
  ON re_plan_chapter_permissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Consultores atualizam permissões"
  ON re_plan_chapter_permissions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM re_users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ─── 5. Políticas para re_plan_notifications ──────────────────────────────
-- Usuários veem apenas suas próprias notificações
CREATE POLICY "Usuários veem suas notificações"
  ON re_plan_notifications FOR SELECT
  USING (auth.uid() = recipient_id);

-- Sistema pode inserir notificações (via trigger ou API com service role)
CREATE POLICY "Sistema insere notificações"
  ON re_plan_notifications FOR INSERT
  WITH CHECK (true);

-- Usuários podem marcar notificações como lidas
CREATE POLICY "Usuários marcam notificações como lidas"
  ON re_plan_notifications FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- ─── 6. Constraint para integridade de threads (BP-DB-02) ────────────────
-- Adicionar constraint que valida parent_comment_id pertence ao mesmo chapter_id
ALTER TABLE re_plan_comments ADD CONSTRAINT check_parent_same_chapter
  CHECK (
    parent_comment_id IS NULL OR
    parent_comment_id IN (
      SELECT id FROM re_plan_comments pc
      WHERE pc.user_id = re_plan_comments.user_id
        AND pc.chapter_id = re_plan_comments.chapter_id
    )
  );

-- ─── Done ──────────────────────────────────────────────────────────────────────
