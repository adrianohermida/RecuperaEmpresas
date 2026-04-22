# Auditoria Técnica: Módulo de Gestão do Business Plan (Painel do Consultor)

**Data:** 22 de Abril de 2026
**Status:** Fase 1 - Análise e Estruturação

## 1. Visão Geral
Esta auditoria documenta a análise inicial para a implementação do Workspace do Consultor, focado na redação, revisão e aprovação dos capítulos do Business Plan.

## 2. Análise da Estrutura Atual
O projeto utiliza uma arquitetura baseada em Node.js (Express) no backend e HTML/JS puro no frontend, com Supabase como banco de dados.

### Banco de Dados (Tabela `re_plan_chapters`)
Atualmente, a tabela possui uma estrutura básica:
- `user_id`: Identificador do cliente.
- `chapter_id`: ID do capítulo (1 a 8).
- `title`: Título do capítulo.
- `status`: Status atual (pendente, etc).
- `comments`: JSONB para histórico de comentários.

**Necessidade de Expansão:**
Para suportar a Fase 1, a tabela precisa de:
- `content`: Campo `TEXT` ou `JSONB` para armazenar o conteúdo rico do editor.
- `updated_at`: Timestamp da última edição.
- `last_editor_id`: ID do consultor que realizou a última alteração.
- `attachments`: JSONB para metadados de arquivos vinculados.

### Backend (`routes/plan.js`)
As rotas atuais são limitadas à leitura do plano e atualização de status/comentários pelo cliente.
- **Novas Rotas Necessárias:**
  - `GET /api/admin/plan/:userId`: Listar capítulos de um cliente específico para o consultor.
  - `PUT /api/admin/plan/:userId/chapter/:chapterId`: Salvar conteúdo e metadados do capítulo.
  - `POST /api/admin/plan/:userId/chapter/:chapterId/upload`: Endpoint para upload de documentos.

### Frontend (`admin.html`)
O painel do consultor já possui uma estrutura de abas. Será necessário:
- Criar uma nova seção `business-plan` no `admin.html`.
- Implementar o controlador JS para gerenciar a listagem de clientes e seus respectivos planos.
- Integrar o editor (Quill.js recomendado pela leveza e compatibilidade).

## 3. Plano de Ação Imediato
1. **Migração SQL**: Adicionar campos de conteúdo e metadados à tabela `re_plan_chapters`.
2. **Backend**: Expandir `lib/db.js` and `routes/plan.js` para suportar as operações do consultor.
3. **Frontend**: Criar a interface de Workspace no `admin.html` e o script `admin-business-plan.js`.

---
*Documento gerado automaticamente pelo agente Manus durante a execução da tarefa.*
