-- ═══════════════════════════════════════════════════════════════════════════════
-- Business Plan v6: Realtime Presence e Typing Indicators (BP-FE-03)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Tabela de Typing Indicators (quem está digitando em qual capítulo)
CREATE TABLE IF NOT EXISTS re_plan_typing_indicators (
  user_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL,
  typing_user_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
  typing_user_name TEXT NOT NULL,
  typing_user_role TEXT NOT NULL, -- 'consultor' ou 'cliente'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  PRIMARY KEY (user_id, chapter_id, typing_user_id),
  FOREIGN KEY (user_id, chapter_id) REFERENCES re_plan_chapters(user_id, chapter_id) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_plan_typing_user_chapter 
  ON re_plan_typing_indicators(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_plan_typing_expires 
  ON re_plan_typing_indicators(expires_at);

-- Tabela de Presença (quem está vendo qual capítulo)
CREATE TABLE IF NOT EXISTS re_plan_presence (
  user_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL,
  presence_user_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
  presence_user_name TEXT NOT NULL,
  presence_user_role TEXT NOT NULL, -- 'consultor' ou 'cliente'
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  PRIMARY KEY (user_id, chapter_id, presence_user_id),
  FOREIGN KEY (user_id, chapter_id) REFERENCES re_plan_chapters(user_id, chapter_id) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_plan_presence_user_chapter 
  ON re_plan_presence(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_plan_presence_expires 
  ON re_plan_presence(expires_at);

-- Row Level Security (RLS) para Typing Indicators
ALTER TABLE re_plan_typing_indicators ENABLE ROW LEVEL SECURITY;

-- Policy: Cliente pode ver typing indicators do seu próprio capítulo
CREATE POLICY "typing_indicators_client_select" ON re_plan_typing_indicators
  FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM re_users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Policy: Sistema pode inserir/atualizar/deletar typing indicators
CREATE POLICY "typing_indicators_system_manage" ON re_plan_typing_indicators
  FOR ALL USING (true);

-- Row Level Security (RLS) para Presença
ALTER TABLE re_plan_presence ENABLE ROW LEVEL SECURITY;

-- Policy: Cliente pode ver presença no seu próprio capítulo
CREATE POLICY "presence_client_select" ON re_plan_presence
  FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM re_users WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Policy: Sistema pode inserir/atualizar/deletar presença
CREATE POLICY "presence_system_manage" ON re_plan_presence
  FOR ALL USING (true);

-- Função para limpar typing indicators expirados (pode ser chamada via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_typing_indicators()
RETURNS void AS $$
BEGIN
  DELETE FROM re_plan_typing_indicators
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Função para limpar presença expirada (pode ser chamada via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_presence()
RETURNS void AS $$
BEGIN
  DELETE FROM re_plan_presence
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
