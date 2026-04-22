-- ═══════════════════════════════════════════════════════════════════════════════
-- RecuperaChat v1 — Migrations
-- Sistema de Chat e Suporte Multitenant (Substituição do Freshchat)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. re_chat_conversations (Salas de Chat / Threads) ────────────────────────
CREATE TABLE IF NOT EXISTS re_chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
    consultant_id UUID REFERENCES re_users(id) ON DELETE SET NULL, -- Opcional, para atribuição direta
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'snoozed')),
    subject TEXT, -- Assunto opcional
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    ai_summary TEXT -- Resumo gerado por IA (IA-Ready)
);

-- ─── 2. re_chat_messages (Mensagens do Chat) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS re_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES re_chat_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('client', 'admin', 'system', 'ai')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb, -- Para anexos, botões, intents (IA-Ready)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ -- Timestamp de leitura
);

-- ─── 3. re_support_tickets (Chamados de Suporte) ───────────────────────────────
CREATE TABLE IF NOT EXISTS re_support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number SERIAL, -- Número amigável
    client_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES re_users(id) ON DELETE SET NULL,
    source_conversation_id UUID REFERENCES re_chat_conversations(id) ON DELETE SET NULL, -- Vínculo com o chat
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ─── 4. re_support_ticket_comments (Interações nos Chamados) ───────────────────
CREATE TABLE IF NOT EXISTS re_support_ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES re_support_tickets(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES re_users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE, -- Notas internas visíveis apenas para admins
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. Índices para performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_re_chat_conv_client ON re_chat_conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_re_chat_conv_consultant ON re_chat_conversations(consultant_id);
CREATE INDEX IF NOT EXISTS idx_re_chat_conv_status ON re_chat_conversations(status);

CREATE INDEX IF NOT EXISTS idx_re_chat_msg_conv ON re_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_re_chat_msg_created ON re_chat_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_re_support_tickets_client ON re_support_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_re_support_tickets_assigned ON re_support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_re_support_tickets_status ON re_support_tickets(status);

CREATE INDEX IF NOT EXISTS idx_re_support_ticket_comments_ticket ON re_support_ticket_comments(ticket_id);

-- ─── 6. Triggers para updated_at ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_recuperachat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_re_chat_conversations_updated_at') THEN
        CREATE TRIGGER tr_re_chat_conversations_updated_at
            BEFORE UPDATE ON re_chat_conversations
            FOR EACH ROW
            EXECUTE FUNCTION update_recuperachat_updated_at();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_re_support_tickets_updated_at') THEN
        CREATE TRIGGER tr_re_support_tickets_updated_at
            BEFORE UPDATE ON re_support_tickets
            FOR EACH ROW
            EXECUTE FUNCTION update_recuperachat_updated_at();
    END IF;
END
$$;

-- ─── 7. Habilitar Supabase Realtime ────────────────────────────────────────────
-- Isso permite ouvir inserções via WebSocket
DO $$
BEGIN
    -- Supabase default publication
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 're_chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE re_chat_messages;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 're_chat_conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE re_chat_conversations;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 're_support_tickets'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE re_support_tickets;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 're_support_ticket_comments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE re_support_ticket_comments;
    END IF;
END
$$;
