# Portal API Worker

Scaffold inicial para migrar o primeiro lote de rotas simples do portal para Cloudflare Workers, sem alterar o backend atual em producao.

Escopo inicial:

- `GET /api/health`
- `GET /api/plan`
- `PUT /api/plan/chapter/:id`
- `GET /api/tasks`
- `PUT /api/tasks/:id`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`

Variaveis esperadas no Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`

Este scaffold nao esta roteando trafego de producao ainda. Ele existe para permitir migracao incremental e validacao isolada.
