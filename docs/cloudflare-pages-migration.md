# Migracao para Cloudflare Pages

## Objetivo

Migrar o frontend estatico para Cloudflare Pages sem quebrar o backend atual, e executar a refatoracao da API por fatias ate remover a dependencia do host Node tradicional.

## Estado atual

- O frontend estatico sai de `public/` e o build gera `dist/` via [scripts/build.js](../scripts/build.js).
- A raiz do repositorio deve deixar de ser espelho automatico do portal; ela fica livre para a landing page do dominio principal.
- O cliente ja suporta API em origem separada via `window.RE_API_BASE` em [public/js/api-base.js](../public/js/api-base.js).
- O backend atual depende de Express em [server.js](../server.js) e concentra rotas montadas de [routes](../routes).
- Ainda existem dependencias de runtime Node incompativeis com Workers em [lib/config.js](../lib/config.js), [routes/onboarding.js](../routes/onboarding.js), [routes/documents.js](../routes/documents.js), [routes/entity-documents.js](../routes/entity-documents.js), [routes/internal-invoices.js](../routes/internal-invoices.js), [routes/admin-clients.js](../routes/admin-clients.js), [routes/support-financial.js](../routes/support-financial.js) e [routes/stripe-webhook.js](../routes/stripe-webhook.js).

## Configuracao inicial do Cloudflare Pages

### Build do projeto

- Framework preset: `None`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Root directory: `/`

### Variaveis de build no Pages

- `RE_API_BASE=https://api.recuperaempresas.com.br`
- `VITE_SUPABASE_URL=https://riiajjmnzgagntiqqshs.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<publishable-key>`
- `RE_ENABLE_FRESHCHAT=false` por padrao no primeiro corte
- `RE_FRESHCHAT_TOKEN` e `RE_FRESHCHAT_SITE_ID` apenas quando o widget for validado no dominio novo

### Observacoes operacionais

- O Pages vai servir apenas frontend estatico no primeiro corte.
- O backend continua fora do Pages durante a fase 1.
- O build do portal nao deve mais sobrescrever arquivos da raiz; para isso [scripts/build.js](../scripts/build.js) so sincroniza espelhos com `SYNC_ROOT_MIRRORS=true`.
- O arquivo [public/_redirects](../public/_redirects) preserva rotas amigaveis como `/oauth/consent`.
- O arquivo [public/_headers](../public/_headers) preserva comportamento de `no-store` para HTML e `js/config.js`, evitando cache agressivo durante a transicao.

## Dominio principal e subdominio do portal

Arquitetura recomendada:

- `recuperaempresas.com.br`: landing page estatica publicada no GitHub Pages.
- `portal.recuperaempresas.com.br`: portal autenticado publicado no Cloudflare Pages.

Para o login vindo do dominio principal:

- Criar uma rota estatica em [login/index.html](../login/index.html) na raiz do repositorio.
- Essa pagina faz redirect imediato para `https://portal.recuperaempresas.com.br/login.html`, preservando `query string` e `hash`.
- Isso cobre o acesso manual a `https://recuperaempresas.com.br/login`.

Configuracao recomendada fora do repositorio:

- Ajustar `BASE_URL` do backend para `https://portal.recuperaempresas.com.br` quando o portal passar a ser servido pelo subdominio.
- Ajustar os redirects do Supabase para o subdominio do portal, evitando depender do apex para login, confirmacao e reset.

Redirects recomendados no Supabase Auth:

- `https://portal.recuperaempresas.com.br/login?confirmed=1`
- `https://portal.recuperaempresas.com.br/login?invited=1`
- `https://portal.recuperaempresas.com.br/login?magic=1`
- `https://portal.recuperaempresas.com.br/login?email_changed=1`
- `https://portal.recuperaempresas.com.br/login?reauthenticated=1`
- `https://portal.recuperaempresas.com.br/reset-password`
- `https://portal.recuperaempresas.com.br/oauth/consent`
- `https://portal.recuperaempresas.com.br/api/auth/oauth/callback`

## Ordem exata de refatoracao

### Fase 0 - Corte do frontend para Pages

Objetivo: publicar o frontend no Cloudflare Pages sem mexer na API.

Arquivos:

- [wrangler.toml](../wrangler.toml): registrar `pages_build_output_dir = "dist"`.
- [scripts/build.js](../scripts/build.js): manter geracao de `dist/js/config.js` com `RE_API_BASE` apontando para a API externa.
- [public/js/api-base.js](../public/js/api-base.js): manter interceptacao de `fetch` e `XMLHttpRequest` para split-origin.
- [public/_headers](../public/_headers): aplicar `Cache-Control: no-store` em HTML e `js/config.js`.
- [public/_redirects](../public/_redirects): preservar `/oauth/consent` e aliases sem `.html`.

Rotas impactadas:

- Nenhuma rota `/api/*` migra nesta fase.
- Somente o frontend passa a ser servido por Pages.

Critico para concluir a fase:

- Validar `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`, `dashboard.html`, `admin.html` e `oauth-consent.html` no dominio novo.
- Validar que o build produz `dist/js/config.js` com `RE_API_BASE` preenchido.

### Fase 1 - Extrair base reutilizavel para Workers

Objetivo: separar o que hoje esta preso ao Express para permitir migracao gradual das rotas simples.

Arquivos:

- [lib/config.js](../lib/config.js): quebrar em `config/shared`, `config/node` e `config/edge`.
- [lib/auth.js](../lib/auth.js): separar verificacao JWT e guards de autorizacao do acoplamento Express.
- [lib/db.js](../lib/db.js): expor helpers puros consumiveis por Worker.
- [lib/logging.js](../lib/logging.js): remover dependencias implicitas do processo Node.
- [server.js](../server.js): reduzir para composicao do runtime Node legado.

Entrega esperada:

- Um conjunto de helpers que funcione tanto no servidor Node quanto em Workers.
- Sem essa extracao, cada rota migrada vai duplicar auth, CORS e acesso ao Supabase.

### Fase 2 - Migrar primeiro lote de rotas para Workers

Objetivo: mover CRUDs simples, sem upload, sem PDF, sem Stripe e sem filesystem.

Arquivos na ordem:

1. [routes/tasks.js](../routes/tasks.js)
2. [routes/plan.js](../routes/plan.js)
3. [routes/notifications.js](../routes/notifications.js)
4. [routes/appointments.js](../routes/appointments.js)
5. [routes/creditors.js](../routes/creditors.js)
6. [routes/departments.js](../routes/departments.js)
7. [routes/employees.js](../routes/employees.js)
8. [routes/suppliers.js](../routes/suppliers.js)
9. [routes/data-change-requests.js](../routes/data-change-requests.js)
10. [routes/document-requests.js](../routes/document-requests.js)
11. [routes/admin-system.js](../routes/admin-system.js)
12. [routes/audit-log.js](../routes/audit-log.js)

Motivo da ordem:

- Comeca com CRUD simples e leitura de dados.
- Depois avanca para rotas com relacionamento entre tabelas e fluxos administrativos.
- Mantem fora do primeiro lote tudo o que depende de upload, email pesado, Stripe, PDF ou armazenamento local.

### Fase 3 - Migrar lote intermediario para Workers

Objetivo: mover modulos grandes, mas que ainda sao viaveis em edge apos extrair auth e config.

Arquivos na ordem:

1. [routes/messages.js](../routes/messages.js)
2. [routes/company-members.js](../routes/company-members.js)
3. [routes/forms.js](../routes/forms.js)
4. [routes/journeys.js](../routes/journeys.js)
5. [routes/services.js](../routes/services.js)
6. [routes/admin-agenda.js](../routes/admin-agenda.js)

Pre-condicoes:

- JWT e guards reutilizaveis em Workers.
- CORS e resposta padronizada fora do Express.
- Revisao dos pontos com `jsonwebtoken` e rotas administrativas compostas.

### Fase 4 - Redesenhar armazenamento de arquivos

Objetivo: eliminar dependencia de disco local antes de sair de Node.

Arquivos na ordem:

1. [lib/config.js](../lib/config.js)
2. [routes/documents.js](../routes/documents.js)
3. [routes/entity-documents.js](../routes/entity-documents.js)
4. [routes/onboarding.js](../routes/onboarding.js)

Acao:

- Trocar `multer.diskStorage`, `fs.createReadStream`, `fs.unlink` e anexos de arquivo local por Supabase Storage ou Cloudflare R2.
- Persistir apenas metadados no banco e URL/chave do objeto no storage.

### Fase 5 - Redesenhar auth e OAuth

Objetivo: remover os ultimos acoplamentos sensiveis ao servidor stateful.

Arquivos na ordem:

1. [routes/auth.js](../routes/auth.js)
2. [public/oauth-consent.html](../public/oauth-consent.html)
3. [public/login.html](../public/login.html)
4. [public/register.html](../public/register.html)
5. [public/forgot-password.html](../public/forgot-password.html)
6. [public/reset-password.html](../public/reset-password.html)

Pontos que exigem redesenho:

- Store PKCE em memoria em [routes/auth.js](../routes/auth.js).
- Callback `/api/auth/oauth/callback` dependente de host da API.
- Separacao entre sessao Supabase no browser e JWT proprio da aplicacao.

### Fase 6 - Migrar financeiro e webhooks

Objetivo: isolar as rotas de maior risco operacional.

Arquivos na ordem:

1. [routes/agenda.js](../routes/agenda.js)
2. [routes/support-financial.js](../routes/support-financial.js)
3. [routes/stripe-webhook.js](../routes/stripe-webhook.js)
4. [routes/internal-invoices.js](../routes/internal-invoices.js)
5. [routes/crons.js](../routes/crons.js)

Pontos criticos:

- Checkout Stripe e webhook exigem validacao fina em runtime Edge.
- Invoices internas dependem de PDF e, hoje, de filesystem.
- Crons devem sair do endpoint HTTP e ir para Cloudflare Cron Triggers ou automacao externa.

### Fase 7 - Desativar Node legado

Objetivo: remover o servidor monolitico quando as ultimas rotas restantes forem absorvidas por Workers ou servicos gerenciados.

Arquivos:

- [server.js](../server.js)
- [package.json](../package.json)

Entrega esperada:

- `server.js` deixa de ser a composicao central da aplicacao.
- A plataforma fica dividida entre Pages, Workers e servicos externos necessarios.

## Classificacao das rotas

### Pode ir para Workers primeiro

- [routes/tasks.js](../routes/tasks.js)
  Rotas: `/api/tasks`, `/api/tasks/:id`
  Motivo: CRUD simples em Supabase, sem filesystem, sem Stripe, sem PDF.

- [routes/plan.js](../routes/plan.js)
  Rotas: `/api/plan`, `/api/plan/chapter/:id`
  Motivo: leitura e update simples.

- [routes/notifications.js](../routes/notifications.js)
  Rotas: `/api/notifications`, `/api/notifications/:id/read`, `/api/notifications/read-all`, `/api/admin/notifications/send`
  Motivo: fluxo simples de banco e notificacao interna.

- [routes/appointments.js](../routes/appointments.js)
  Rotas: `/api/appointments`, `/api/appointments/:id`, `/api/admin/appointments`, `/api/admin/appointments/:id`
  Motivo: sem dependencia local.

- [routes/creditors.js](../routes/creditors.js)
  Rotas: CRUD cliente e admin de credores.
  Motivo: banco puro.

- [routes/departments.js](../routes/departments.js)
  Rotas: CRUD cliente e admin de departamentos e alocacao de membros.
  Motivo: banco puro; depende apenas de auth reutilizavel.

- [routes/employees.js](../routes/employees.js)
  Rotas: CRUD cliente e admin de funcionarios.
  Motivo: banco puro.

- [routes/suppliers.js](../routes/suppliers.js)
  Rotas: CRUD de fornecedores e contratos, cliente e admin.
  Motivo: banco puro, sem upload de contrato.

- [routes/data-change-requests.js](../routes/data-change-requests.js)
  Rotas: emissao e consumo de pedidos de alteracao.
  Motivo: banco e token; sem assets locais.

- [routes/document-requests.js](../routes/document-requests.js)
  Rotas: solicitacao e fulfill logico de documentos.
  Motivo: a parte de request pode ir primeiro; o upload real continua separado.

- [routes/admin-system.js](../routes/admin-system.js)
  Rotas: `/api/admin/logs`, `/api/admin/stats`
  Motivo: leitura agregada; bom candidato para validar observabilidade em Worker.

- [routes/audit-log.js](../routes/audit-log.js)
  Rotas: `/api/admin/audit-log`, `/api/admin/audit-log/export`
  Motivo: export leve, sem dependencia de filesystem.

### Pode ir para Workers depois da extracao de base comum

- [routes/messages.js](../routes/messages.js)
  Motivo: simples, mas pede padronizacao do polling e auth.

- [routes/company-members.js](../routes/company-members.js)
  Motivo: usa `jsonwebtoken` e fluxo de membro; precisa alinhar auth primeiro.

- [routes/forms.js](../routes/forms.js)
  Motivo: grande volume de endpoints, mas sem dependencia direta de disco local.

- [routes/journeys.js](../routes/journeys.js)
  Motivo: regras de negocio compostas, mas banco puro.

- [routes/services.js](../routes/services.js)
  Motivo: banco puro, mas mistura fluxo comercial e admin.

- [routes/admin-agenda.js](../routes/admin-agenda.js)
  Motivo: depende do dominio de agenda e creditos, melhor migrar depois do modulo base.

### Deve continuar em Node por enquanto

- [routes/auth.js](../routes/auth.js)
  Motivo: PKCE em memoria, callback OAuth, mistura de sessao Supabase com JWT proprio e integracoes externas.

- [routes/onboarding.js](../routes/onboarding.js)
  Motivo: upload multipart, anexos locais e limpeza via `fs.unlink`.

- [routes/documents.js](../routes/documents.js)
  Motivo: `multer`, `fs`, download streaming de arquivo local.

- [routes/entity-documents.js](../routes/entity-documents.js)
  Motivo: `multer`, `fs`, storage local.

- [routes/form-config.js](../routes/form-config.js)
  Motivo: leitura e escrita em arquivo local.

- [routes/internal-invoices.js](../routes/internal-invoices.js)
  Motivo: `pdfkit`, `fs`, anexos e emissao de PDF.

- [routes/admin-clients.js](../routes/admin-clients.js)
  Motivo: exportacao XLSX/PDF e consultas compostas; migrar so depois de remover `xlsx` e `pdfkit` do caminho HTTP.

- [routes/support-financial.js](../routes/support-financial.js)
  Motivo: Stripe, Freshdesk, JWT Freshchat e fluxos operacionais sensiveis.

- [routes/agenda.js](../routes/agenda.js)
  Motivo: checkout Stripe e acoplamento ao fluxo de creditos.

- [routes/stripe-webhook.js](../routes/stripe-webhook.js)
  Motivo: webhook critico; so migrar quando a camada Stripe estiver estabilizada em Edge.

- [routes/crons.js](../routes/crons.js)
  Motivo: deve virar trigger agendada, nao apenas trocar de host.

## Sequencia de deploy recomendada

1. Subir frontend em Pages com API externa.
2. Congelar mudancas estruturais no auth durante o corte inicial.
3. Migrar primeiro lote de rotas para Workers atras de um subdominio de API ou gateway.
4. Mover uploads para Storage.
5. Redesenhar auth/OAuth.
6. Migrar financeiro, webhook e crons.
7. Desligar Node legado.

## Scaffold inicial de Workers

O repositorio ja possui um scaffold isolado para o primeiro lote em [workers/portal-api/README.md](../workers/portal-api/README.md).

Entradas iniciais preparadas:

- `GET /api/health`
- `GET /api/appointments`
- `POST /api/appointments`
- `DELETE /api/appointments/:id`
- `GET /api/plan`
- `PUT /api/plan/chapter/:id`
- `GET /api/tasks`
- `PUT /api/tasks/:id`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/admin/appointments`
- `PUT /api/admin/appointments/:id`
- `GET /api/admin/logs`
- `GET /api/admin/stats`

Arquivos principais:

- [workers/portal-api/wrangler.toml](../workers/portal-api/wrangler.toml)
- [workers/portal-api/src/index.mjs](../workers/portal-api/src/index.mjs)
- [workers/portal-api/src/lib/auth.mjs](../workers/portal-api/src/lib/auth.mjs)
- [workers/portal-api/src/routes/plan.mjs](../workers/portal-api/src/routes/plan.mjs)
- [workers/portal-api/src/routes/tasks.mjs](../workers/portal-api/src/routes/tasks.mjs)
- [workers/portal-api/src/routes/notifications.mjs](../workers/portal-api/src/routes/notifications.mjs)

## Checklist de aceite do corte inicial

- `npm run build` gera `dist/` com `js/config.js` correto.
- `login.html` e `register.html` autenticam consumindo a API externa.
- `forgot-password.html` e `reset-password.html` continuam usando os redirects corretos do Supabase.
- `/oauth/consent` abre via rewrite do Pages.
- `dashboard.html` e `admin.html` carregam sem depender de same-origin para `fetch`.
