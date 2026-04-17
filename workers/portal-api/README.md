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
- `GET /api/admin/logs`
- `GET /api/admin/stats`

Variaveis esperadas no Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`

Este scaffold nao esta roteando trafego de producao ainda. Ele existe para permitir migracao incremental e validacao isolada.

Observacao:

- O `POST /api/appointments` no Worker ainda nao replica o envio de email do backend Express. Antes de colocar essa rota em producao, essa integracao precisa ser portada ou substituida.
- O convite de membro em departments ainda nao foi migrado para o Worker porque depende de geracao de senha e envio de email.
