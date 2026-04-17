# Runbook do Cloudflare Pages e DNS

## Objetivo

Configurar o portal em `portal.recuperaempresas.com.br` no Cloudflare Pages, mantendo a landing em `recuperaempresas.com.br` fora do Pages.

## 1. Criar ou revisar o projeto no Cloudflare Pages

No painel do Cloudflare:

1. Entrar em `Workers & Pages`
2. Abrir o projeto conectado ao repositório `adrianohermida/RecuperaEmpresas`
3. Confirmar que o projeto selecionado e o do portal, nao o da landing

Campos que precisam ficar assim:

- Project name: `recuperaempresas`
- Production branch: `gh-pages`
- Framework preset: `None`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Root directory: vazio ou `/`

## 2. Configurar variaveis de ambiente no Pages

Abrir `Settings` -> `Environment variables`.

Adicionar ou revisar estas variaveis em `Production`:

- `RE_API_BASE`
  Valor: `https://api.recuperaempresas.com.br`

- `VITE_SUPABASE_URL`
  Valor: `https://riiajjmnzgagntiqqshs.supabase.co`

- `VITE_SUPABASE_ANON_KEY`
  Valor: usar a publishable key/anon key publica do projeto

- `RE_ENABLE_FRESHCHAT`
  Valor: `false`

- `RE_FRESHCHAT_TOKEN`
  Valor: vazio no primeiro corte

- `RE_FRESHCHAT_SITE_ID`
  Valor: vazio no primeiro corte

Observacao:

- Nao colocar `service_role` no Pages. Essa chave nao deve ir para o frontend.

## 3. Disparar um deploy limpo

No projeto do Pages:

1. Abrir `Deployments`
2. Selecionar o ultimo deployment
3. Fazer `Retry deployment` ou criar um novo deploy a partir do branch `gh-pages`

Depois do deploy, validar nos logs:

- O build executa `npm ci && npm run build`
- O comando termina com sucesso
- O output publicado e `dist`

## 4. Configurar dominio customizado do portal

No projeto do Pages:

1. Abrir `Custom domains`
2. Clicar em `Set up a custom domain`
3. Informar `portal.recuperaempresas.com.br`

Se a zona DNS ja estiver no Cloudflare:

- Aceitar a criacao automatica do registro solicitado pelo Pages

Se a zona DNS nao estiver no Cloudflare:

- Criar manualmente o registro DNS conforme a instrucao exibida no painel do Pages

Resultado esperado:

- O status do dominio customizado fica como `Active`

## 5. Revisar DNS do dominio principal e do subdominio

Objetivo final:

- `recuperaempresas.com.br` continua servindo a landing
- `portal.recuperaempresas.com.br` serve o portal

Conferencias no DNS:

- O apex `recuperaempresas.com.br` nao deve ser apontado para o projeto do portal
- O subdominio `portal` deve apontar somente para o projeto do Cloudflare Pages do portal

Se a landing estiver no GitHub Pages:

- Manter os registros DNS do apex como ja estao hoje para a landing
- Nao reaproveitar o mesmo custom domain do portal no projeto da landing

## 6. Validar headers e redirects publicados

No navegador, abrir:

- `https://portal.recuperaempresas.com.br/login`
- `https://portal.recuperaempresas.com.br/register`
- `https://portal.recuperaempresas.com.br/forgot-password`
- `https://portal.recuperaempresas.com.br/reset-password`
- `https://portal.recuperaempresas.com.br/oauth/consent`

Resultado esperado:

- Todas respondem com 200
- Nao ha 404 do Cloudflare
- O HTML vem do projeto do portal

## 7. Confirmar redirects no dominio principal

Abrir:

- `https://recuperaempresas.com.br/login`
- `https://recuperaempresas.com.br/register`
- `https://recuperaempresas.com.br/forgot-password`
- `https://recuperaempresas.com.br/reset-password`
- `https://recuperaempresas.com.br/oauth/consent`

Resultado esperado:

- Todas redirecionam para o subdominio `portal.recuperaempresas.com.br`

Arquivos que implementam isso no repositorio:

- [landing/login/index.html](../landing/login/index.html)
- [landing/register/index.html](../landing/register/index.html)
- [landing/forgot-password/index.html](../landing/forgot-password/index.html)
- [landing/reset-password/index.html](../landing/reset-password/index.html)
- [landing/oauth/consent/index.html](../landing/oauth/consent/index.html)

## 8. O que fazer se o deploy abrir mas o login quebrar

Conferir, nesta ordem:

1. `RE_API_BASE` no Pages
2. Host real da API
3. CORS da API para `portal.recuperaempresas.com.br`
4. `BASE_URL` do backend
5. Redirect URLs do Supabase

Arquivos relacionados:

- [wrangler.toml](../wrangler.toml)
- [server.js](../server.js)
- [docs/cloudflare-pages-setup-checklist.md](../docs/cloudflare-pages-setup-checklist.md)
- [docs/cloudflare-pages-post-deploy-checklist.md](../docs/cloudflare-pages-post-deploy-checklist.md)
