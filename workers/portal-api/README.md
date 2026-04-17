# Portal API Worker

Scaffold inicial para migrar o primeiro lote de rotas simples do portal para Cloudflare Workers, sem alterar o backend atual em producao.

Escopo inicial:

- `GET /api/health`
- `GET /api/appointments`
- `POST /api/appointments`
- `DELETE /api/appointments/:id`
- `GET /api/creditors`
- `POST /api/creditors`
- `PUT /api/creditors/:id`
- `DELETE /api/creditors/:id`
- `GET /api/departments`
- `POST /api/departments`
- `PUT /api/departments/:id`
- `DELETE /api/departments/:id`
- `GET /api/employees`
- `POST /api/employees`
- `PUT /api/employees/:id`
- `DELETE /api/employees/:id`
- `GET /api/messages`
- `POST /api/messages`
- `GET /api/messages/poll`
- `GET /api/change-requests`
- `GET /api/change-requests/:token`
- `PUT /api/change-requests/:token`
- `GET /api/document-requests`
- `PUT /api/document-requests/:reqId/fulfill`
- `GET /api/plan`
- `PUT /api/plan/chapter/:id`
- `GET /api/tasks`
- `PUT /api/tasks/:id`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/admin/appointments`
- `PUT /api/admin/appointments/:id`
- `GET /api/admin/client/:id/creditors`
- `POST /api/admin/client/:id/creditors`
- `PUT /api/admin/client/:id/creditors/:creditorId`
- `DELETE /api/admin/client/:id/creditors/:creditorId`
- `GET /api/admin/client/:id/departments`
- `POST /api/admin/client/:id/departments`
- `PUT /api/admin/client/:id/departments/:deptId`
- `DELETE /api/admin/client/:id/departments/:deptId`
- `PUT /api/admin/client/:id/members/:memberId/department`
- `GET /api/admin/client/:id/employees`
- `POST /api/admin/client/:id/employees`
- `PUT /api/admin/client/:id/employees/:empId`
- `DELETE /api/admin/client/:id/employees/:empId`
- `GET /api/admin/messages/unread`
- `POST /api/admin/messages/seen/:clientId`
- `GET /api/admin/client/:id/messages/poll`
- `POST /api/admin/client/:id/change-request`
- `GET /api/admin/client/:id/change-requests`
- `GET /api/admin/client/:id/document-requests/suggestions`
- `POST /api/admin/client/:id/document-requests`
- `GET /api/admin/client/:id/document-requests`
- `PUT /api/admin/client/:id/document-requests/:reqId`
- `DELETE /api/admin/client/:id/document-requests/:reqId`
- `GET /api/admin/logs`
- `GET /api/admin/stats`

Variaveis esperadas no Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- `BASE_URL`
- `EMAIL_FROM`
- `EMAIL_TO`
- `RESEND_API_KEY` ou `RESEND_KEY`

Binding opcional:

- `ADMIN_MESSAGE_STATE` em Cloudflare KV para persistir o estado de leitura das mensagens do admin entre invocacoes.

Este scaffold nao esta roteando trafego de producao ainda. Ele existe para permitir migracao incremental e validacao isolada.

Observacao:

- O convite de membro em departments ainda nao foi migrado para o Worker porque depende de geracao de senha e envio de email.
- O fluxo admin de mensagens persiste o estado de leitura em KV quando o binding `ADMIN_MESSAGE_STATE` existir; sem isso, faz fallback para memoria do processo.
- `appointments`, `messages`, `data-change-requests` e `document-requests` ja replicam email, notificacoes internas e audit log necessarios dentro do Worker, usando Resend + Supabase.
