# Auditoria Técnica: Módulo RecuperaChat (Substituição do Freshchat)

**Data:** 22 de Abril de 2026  
**Status:** Implementado (Fase Inicial)  
**Autor:** Manus AI

## 1. Visão Geral

Esta auditoria documenta a substituição do sistema de suporte de terceiros (Freshchat) e do sistema legado de mensagens (`re_messages`) por um novo módulo proprietário denominado **RecuperaChat**. O novo sistema foi projetado com foco em **Isolamento Multitenant**, **Sincronização em Tempo Real** e **Prontidão para Inteligência Artificial**.

A arquitetura do RecuperaChat unifica o suporte ao cliente e a comunicação do consultor em uma única interface, permitindo a conversão de diálogos informais em chamados estruturados (tickets).

---

## 2. Arquitetura do Banco de Dados

O esquema do banco de dados foi projetado no arquivo de migração `recuperachat_v1.sql` e abrange quatro entidades principais.

### 2.1 Isolamento Multitenant

O isolamento é garantido através do vínculo explícito entre conversas, clientes e consultores.

| Tabela | Propósito | Estrutura Multitenant |
|--------|-----------|-----------------------|
| `re_chat_conversations` | Salas de chat e threads de atendimento | Vincula `client_id` (obrigatório) a um `consultant_id` (opcional). Consultores visualizam apenas conversas atribuídas a eles, exceto super-admins. |
| `re_chat_messages` | Histórico de mensagens | Relaciona-se diretamente à conversa. O campo `sender_role` distingue entre `client`, `admin`, `system` e `ai`. |
| `re_support_tickets` | Chamados de suporte estruturados | Possui `client_id`, `creator_id` e `assigned_to`. Mantém o vínculo com a conversa de origem via `source_conversation_id`. |
| `re_support_ticket_comments` | Interações e notas em chamados | O campo `is_internal` garante que notas de equipe não sejam expostas aos clientes. |

### 2.2 Sincronização em Tempo Real

A comunicação instantânea é viabilizada pelo **Supabase Realtime**. O esquema ativa publicações do PostgreSQL para as tabelas do RecuperaChat:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE re_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE re_chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE re_support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE re_support_ticket_comments;
```

O cliente web (`recuperachat.js`) assina o canal `chat:{conversationId}` para receber atualizações via WebSocket, com fallback automático para *polling* caso a conexão falhe.

---

## 3. Prontidão para Inteligência Artificial (IA-Ready)

O módulo foi estruturado para integração nativa com modelos de linguagem (LLMs) como GPT, Gemini ou Ollama.

### 3.1 Estrutura de Dados

- **Campo `metadata` em `re_chat_messages`:** Armazena dados em formato JSONB, permitindo a injeção de *intents*, botões de ação gerados por IA ou anexos processados.
- **Campo `ai_summary` em `re_chat_conversations`:** Armazena resumos concisos do atendimento gerados automaticamente.
- **Role `ai`:** O campo `sender_role` suporta nativamente o valor `ai` para mensagens enviadas por agentes autônomos.

### 3.2 Endpoint de Integração

Foi implementado o endpoint `/api/admin/chat/conversations/:id/ai-summary` que processa o histórico da conversa, formata o contexto (separando mensagens de cliente e sistema) e aciona o provedor de IA configurado (padrão: OpenAI GPT-4.1-mini) para gerar um resumo executivo do atendimento.

---

## 4. Componentes Implementados

A implementação abrange toda a *stack* da aplicação:

1. **Tipos TypeScript (`lib/recuperachat/types.ts`):** Definições rigorosas de domínio, interfaces de DTOs e payload de eventos Realtime.
2. **Camada de Dados (`lib/recuperachat/db.js`):** Abstração das operações do Supabase, incluindo contagem de mensagens não lidas e atualização de status.
3. **Rotas Express (`routes/recuperachat.js`):** Endpoints REST para o servidor Node.js, com middlewares de autenticação (`requireAuth`, `requireAdmin`).
4. **Cloudflare Worker (`workers/portal-api/src/routes/recuperachat.mjs`):** Espelhamento das rotas para execução na borda (Edge), garantindo baixa latência.
5. **Frontend Cliente (`public/js/recuperachat.js`):** Widget flutuante de chat com suporte a WebSocket e fallback de polling.
6. **Frontend Admin (`public/js/admin-recuperachat.js` & `public/css/recuperachat.css`):** Interface de gerenciamento para consultores, permitindo visualização de múltiplas conversas, alteração de status e conversão em chamados.

---

## 5. Conversão de Diálogos em Chamados

Um dos diferenciais do RecuperaChat em relação ao Freshchat é a capacidade nativa de transformar um diálogo informal em um chamado estruturado. 

O fluxo implementado permite que o consultor clique em "Converter em Chamado", preencha um assunto, descrição e prioridade. O sistema então:
1. Cria um registro em `re_support_tickets` vinculado ao cliente.
2. Associa o ticket à conversa original (`source_conversation_id`).
3. Insere uma mensagem de sistema (`sender_role: 'system'`) na conversa, notificando o cliente sobre a abertura do chamado com o respectivo número de protocolo.

---

## 6. Conclusão

O módulo **RecuperaChat** substitui com sucesso as dependências externas de chat, reduzindo custos de licenciamento e aumentando o controle sobre os dados. A arquitetura multitenant garante segurança e isolamento, enquanto a infraestrutura *IA-Ready* prepara a plataforma para futuras automações de atendimento e triagem inteligente.
