// ═══════════════════════════════════════════════════════════════════════════════
// RecuperaChat — Tipos TypeScript
// Definições de domínio para o módulo de Chat e Suporte Multitenant
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Enums ────────────────────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'resolved' | 'snoozed';
export type SenderRole = 'client' | 'admin' | 'system' | 'ai';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

// ─── Entidades do Banco de Dados ──────────────────────────────────────────────

/**
 * re_chat_conversations
 * Representa uma thread de conversa entre um cliente e o time de suporte.
 * O campo consultant_id permite isolamento multitenant: cada consultor
 * enxerga apenas as conversas atribuídas a ele.
 */
export interface ChatConversation {
  id: string;
  client_id: string;
  consultant_id: string | null;
  status: ConversationStatus;
  subject: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  ai_summary: string | null; // Preenchido por IA (GPT, Gemini, Ollama)
}

/**
 * re_chat_messages
 * Mensagem individual dentro de uma conversa.
 * O campo metadata é JSONB livre para extensões futuras:
 * - Anexos: { attachments: [{ url, name, size }] }
 * - Intents de IA: { intent: 'escalate', confidence: 0.9 }
 * - Botões de ação: { actions: [{ label, payload }] }
 */
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_role: SenderRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

/**
 * re_support_tickets
 * Chamado de suporte estruturado, criado manualmente ou convertido de uma conversa.
 * source_conversation_id mantém o vínculo com o chat de origem para rastreabilidade.
 */
export interface SupportTicket {
  id: string;
  ticket_number: number;
  client_id: string;
  creator_id: string;
  assigned_to: string | null;
  source_conversation_id: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/**
 * re_support_ticket_comments
 * Comentários e notas internas em chamados.
 * is_internal = true: visível apenas para consultores (notas de equipe).
 */
export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  content: string;
  is_internal: boolean;
  created_at: string;
}

// ─── DTOs de Requisição ───────────────────────────────────────────────────────

export interface CreateConversationDTO {
  client_id: string;
  consultant_id?: string;
  subject?: string;
}

export interface SendMessageDTO {
  conversation_id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ConvertToTicketDTO {
  conversation_id: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
  assigned_to?: string;
}

export interface CreateTicketDTO {
  client_id: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
  assigned_to?: string;
  source_conversation_id?: string;
}

export interface AddTicketCommentDTO {
  ticket_id: string;
  content: string;
  is_internal?: boolean;
}

// ─── Payloads de Resposta ─────────────────────────────────────────────────────

export interface ConversationWithLastMessage extends ChatConversation {
  last_message?: ChatMessage;
  unread_count?: number;
  client_name?: string;
  client_company?: string;
}

export interface TicketWithDetails extends SupportTicket {
  comments?: TicketComment[];
  client_name?: string;
  assigned_to_name?: string;
}

// ─── Contexto de IA (IA-Ready) ────────────────────────────────────────────────

/**
 * Payload enviado para qualquer LLM (GPT, Gemini, Ollama, Cloudflare Workers AI).
 * A arquitetura é agnóstica ao provedor: basta implementar AIProvider.
 */
export interface AIChatContext {
  conversation_id: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  client_context?: {
    name: string;
    company: string;
    open_tickets: number;
  };
}

export interface AIProvider {
  name: string;
  generateResponse(context: AIChatContext): Promise<string>;
  summarizeConversation(messages: ChatMessage[]): Promise<string>;
}

// ─── Realtime Supabase ────────────────────────────────────────────────────────

/**
 * Payload recebido via Supabase Realtime ao ouvir re_chat_messages.
 */
export interface RealtimeMessagePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: ChatMessage;
  old: Partial<ChatMessage>;
  schema: string;
  table: string;
  commit_timestamp: string;
}
