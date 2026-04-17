# Checklist de Configuracao do Portal

## Cloudflare Pages

Projeto:

- Nome: `recuperaempresas`
- Repositorio conectado: `adrianohermida/RecuperaEmpresas`
- Branch de producao: `gh-pages`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Root directory: `/`

Variaveis de ambiente do Pages:

- `RE_API_BASE=https://api.recuperaempresas.com.br`
- `VITE_SUPABASE_URL=https://riiajjmnzgagntiqqshs.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<publishable-key>`
- `RE_ENABLE_FRESHCHAT=false`
- `RE_FRESHCHAT_TOKEN=` apenas se o widget for habilitado
- `RE_FRESHCHAT_SITE_ID=` apenas se o widget for habilitado

Dominio customizado do Pages:

- Adicionar `portal.recuperaempresas.com.br`
- Confirmar que o projeto responde em `https://portal.recuperaempresas.com.br/login`
- Confirmar que o fallback amigavel funciona para `https://portal.recuperaempresas.com.br/oauth/consent`

Verificacoes no Pages:

- O deploy usa [wrangler.toml](../wrangler.toml)
- O build gera `_headers` e `_redirects` dentro de `dist/`
- `https://portal.recuperaempresas.com.br/login` abre a tela do portal
- `https://portal.recuperaempresas.com.br/register` abre a tela do portal

## DNS e dominio principal

Objetivo:

- `recuperaempresas.com.br`: landing page no GitHub Pages
- `portal.recuperaempresas.com.br`: portal no Cloudflare Pages

DNS recomendado:

- Manter o apex `recuperaempresas.com.br` apontando para o provedor da landing atual
- Criar o subdominio `portal` apontando para o Cloudflare Pages conforme instruido no painel do Cloudflare

Verificacoes no apex:

- `https://recuperaempresas.com.br/login` redireciona para `https://portal.recuperaempresas.com.br/login`
- `https://recuperaempresas.com.br/register` redireciona para `https://portal.recuperaempresas.com.br/register`
- `https://recuperaempresas.com.br/forgot-password` redireciona para `https://portal.recuperaempresas.com.br/forgot-password`
- `https://recuperaempresas.com.br/reset-password` redireciona para `https://portal.recuperaempresas.com.br/reset-password`
- `https://recuperaempresas.com.br/oauth/consent` redireciona para `https://portal.recuperaempresas.com.br/oauth/consent`

Arquivos envolvidos no repositório:

- [login/index.html](../login/index.html)
- [register/index.html](../register/index.html)
- [forgot-password/index.html](../forgot-password/index.html)
- [reset-password/index.html](../reset-password/index.html)
- [oauth/consent/index.html](../oauth/consent/index.html)
- [login.html](../login.html)
- [register.html](../register.html)
- [forgot-password.html](../forgot-password.html)
- [reset-password.html](../reset-password.html)
- [oauth-consent.html](../oauth-consent.html)

## Backend da API

Se a API continuar fora do Cloudflare neste primeiro corte:

- Definir `BASE_URL=https://portal.recuperaempresas.com.br`
- Definir `ALLOWED_ORIGINS=https://portal.recuperaempresas.com.br`
- Publicar a API em um host dedicado, preferencialmente `https://api.recuperaempresas.com.br`

Verificacoes da API:

- `GET /api/health` responde normalmente
- `GET /js/config.js` nao e mais requisito do frontend no Pages
- O CORS aceita `https://portal.recuperaempresas.com.br`
- Login pelo portal nao falha por bloqueio de origin

Arquivo envolvido no repositório:

- [server.js](../server.js)

## Supabase Auth

Adicionar estes Redirect URLs no painel do Supabase Auth:

- `https://portal.recuperaempresas.com.br/login?confirmed=1`
- `https://portal.recuperaempresas.com.br/login?invited=1`
- `https://portal.recuperaempresas.com.br/login?magic=1`
- `https://portal.recuperaempresas.com.br/login?email_changed=1`
- `https://portal.recuperaempresas.com.br/login?reauthenticated=1`
- `https://portal.recuperaempresas.com.br/reset-password`
- `https://portal.recuperaempresas.com.br/oauth/consent`
- `https://portal.recuperaempresas.com.br/api/auth/oauth/callback`

Configurar Site URL do projeto:

- `https://portal.recuperaempresas.com.br`

Verificacoes do Supabase:

- Confirmacao de cadastro volta para o subdominio do portal
- Convite volta para o subdominio do portal
- Magic link volta para o subdominio do portal
- Reset de senha volta para o subdominio do portal
- OAuth consent volta para o subdominio do portal

## Teste final

Sequencia recomendada:

1. Publicar o Pages em `portal.recuperaempresas.com.br`
2. Ajustar a API para `BASE_URL=https://portal.recuperaempresas.com.br`
3. Ajustar Redirect URLs e Site URL no Supabase
4. Testar `https://recuperaempresas.com.br/login`
5. Testar cadastro, login, forgot password e reset password
6. Testar `https://portal.recuperaempresas.com.br/oauth/consent`
7. Testar `GET /api/health` no host da API
