# Checklist de Validacao Pos-Deploy

## Objetivo

Validar o corte do portal para `portal.recuperaempresas.com.br` sem regressao nos fluxos de autenticacao, redirects do dominio principal e chamadas para a API externa.

## Pre-condicoes

- O projeto do Cloudflare Pages esta publicado com dominio customizado `portal.recuperaempresas.com.br`
- O build do Pages usa `npm ci && npm run build`
- O output do Pages e `dist`
- `RE_API_BASE` aponta para o host real da API
- O backend publicado usa `BASE_URL=https://portal.recuperaempresas.com.br`
- O Supabase Auth usa `Site URL = https://portal.recuperaempresas.com.br`
- Os Redirect URLs do Supabase ja foram cadastrados

## Ordem de teste recomendada

1. DNS e disponibilidade do portal
2. Redirects do dominio principal
3. Assets e bootstrap do frontend
4. Healthcheck da API e CORS
5. Login
6. Cadastro e confirmacao
7. Forgot password e reset password
8. OAuth consent
9. Dashboard e area admin
10. Regressao de cache

## 1. DNS e disponibilidade do portal

Abrir no navegador:

- `https://portal.recuperaempresas.com.br/`
- `https://portal.recuperaempresas.com.br/login`
- `https://portal.recuperaempresas.com.br/register`
- `https://portal.recuperaempresas.com.br/forgot-password`
- `https://portal.recuperaempresas.com.br/reset-password`
- `https://portal.recuperaempresas.com.br/oauth/consent`

Resultado esperado:

- Todas as rotas respondem com HTML do Pages
- Nao ha erro 404 do Cloudflare
- Nao ha download indevido de arquivo estatico

## 2. Redirects do dominio principal

Abrir no navegador:

- `https://recuperaempresas.com.br/login`
- `https://recuperaempresas.com.br/register`
- `https://recuperaempresas.com.br/forgot-password`
- `https://recuperaempresas.com.br/reset-password`
- `https://recuperaempresas.com.br/oauth/consent`

Resultado esperado:

- Cada URL do apex redireciona para o caminho equivalente em `https://portal.recuperaempresas.com.br`
- Query string e hash sao preservados
- Um redirecionamento unico para a variante com barra final, como `/login -> /login/`, e aceitavel desde que a resposta final seja `200` com o HTML correto.

## 3. Assets e bootstrap do frontend

No DevTools do navegador, aba Network, abrir:

- `https://portal.recuperaempresas.com.br/login`

Validar:

- `js/config.js` carrega sem 404
- `js/api-base.js` carrega sem 404
- `config.js` gerado no build contem o `RE_API_BASE` esperado
- Nao ha chamadas indo para `https://recuperaempresas.onrender.com` por hardcode antigo

## 4. Healthcheck da API e CORS

Testar no navegador ou com terminal:

- `GET https://api.recuperaempresas.com.br/api/health`

Se quiser validar CORS explicitamente, usar uma requisicao com Origin do portal.

Resultado esperado:

- API responde `200`
- Chamadas originadas de `https://portal.recuperaempresas.com.br` nao falham por CORS
- O backend aceita o origin do portal

## 5. Login

Fluxo:

- Abrir `https://portal.recuperaempresas.com.br/login`
- Entrar com um usuario valido

Validar:

- A chamada para `/api/auth/login` usa o host da API configurado
- Nao ha bloqueio de CORS
- O token da aplicacao e salvo corretamente
- O usuario e redirecionado para `dashboard.html` ou `admin.html`, conforme perfil

## 6. Cadastro e confirmacao

Fluxo:

- Abrir `https://portal.recuperaempresas.com.br/register`
- Criar uma conta de teste
- Abrir o email de confirmacao do Supabase

Validar:

- O link do email volta para `https://portal.recuperaempresas.com.br/login?confirmed=1`
- O apex `recuperaempresas.com.br` nao aparece mais nos redirects do Supabase
- O estado visual de confirmacao aparece na tela de login do portal

## 7. Forgot password e reset password

Fluxo:

- Abrir `https://portal.recuperaempresas.com.br/forgot-password`
- Solicitar recuperacao para um usuario valido
- Abrir o email e seguir o link

Validar:

- O link volta para `https://portal.recuperaempresas.com.br/reset-password`
- A pagina carrega corretamente no subdominio do portal
- A redefinicao de senha conclui sem depender do apex

## 8. OAuth consent

Fluxo:

- Abrir `https://portal.recuperaempresas.com.br/oauth/consent`
- Ou iniciar o fluxo que leva a essa tela

Validar:

- A pagina abre no portal, nao no apex
- O fluxo nao quebra por ausencia de sessao Supabase no browser
- O callback final volta para `/api/auth/oauth/callback` no host correto da API

## 9. Dashboard e area admin

Fluxo:

- Logar com usuario cliente
- Validar `dashboard.html`
- Logar com usuario admin
- Validar `admin.html`

Validar:

- Carregamento inicial sem erros de fetch
- Sem 401 inesperado causado por origin errado
- Sem 404 de assets do portal
- Sem chamadas para o dominio antigo do frontend

## 10. Regressao de cache

Fluxo:

- Fazer um hard refresh em `login`, `register` e `admin`
- Abrir em aba anonima

Validar:

- HTML e `js/config.js` nao ficam presos em cache antigo
- O portal nao mistura assets do apex com assets do subdominio

## 11. Rollout canario do Worker

No terminal, executar:

```bash
npm run test:worker-canary
```

Se quiser validar contra hosts especificos:

```bash
PORTAL_URL=https://portal.recuperaempresas.com.br \
LEGACY_API_BASE=https://api.recuperaempresas.com.br \
WORKER_API_BASE=https://api-edge.recuperaempresas.com.br \
CANARY_SAMPLE_ROUTES=/api/plan,/api/tasks,/api/admin/client/00000000-0000-0000-0000-000000000000/departments \
npm run test:worker-canary
```

Validar:

- `js/config.js` publicado no portal expõe `RE_API_BASE`, `RE_API_WORKER_BASE` e `RE_API_WORKER_ROUTES` esperados.
- `GET /api/health` responde na API principal.
- `GET /api/health` responde no Worker quando o canario estiver habilitado.
- O mapeamento impresso no terminal envia ao Worker apenas as rotas planejadas.

## Falhas mais provaveis

### Falha 1: CORS na API

Sintoma:

- Login falha no navegador com erro de CORS

Conferir:

- [server.js](../server.js)
- Variavel `ALLOWED_ORIGINS`
- Origin real usado pelo Pages

### Falha 2: Redirect do Supabase indo para o dominio errado

Sintoma:

- Confirmacao de conta ou reset volta para `recuperaempresas.com.br`

Conferir:

- `BASE_URL` do backend publicado
- Site URL do Supabase
- Redirect URLs cadastrados no Supabase

### Falha 3: Frontend chamando host antigo

Sintoma:

- Requests indo para Render antigo ou origem incorreta

Conferir:

- Variavel `RE_API_BASE` no Cloudflare Pages
- [public/js/api-base.js](../public/js/api-base.js)
- `dist/js/config.js` do deploy atual

### Falha 4: Redirect do apex nao funciona

Sintoma:

- `https://recuperaempresas.com.br/login` abre pagina errada ou 404

Conferir:

- [landing/login/index.html](../landing/login/index.html)
- [landing/index.html](../landing/index.html)
- Regras do provedor que serve a landing no apex

## Critério de aceite

Considerar o corte aprovado quando:

- O portal abre no subdominio sem erros 404
- O apex redireciona corretamente os caminhos de autenticacao
- Login, cadastro, confirmacao, forgot password e reset password funcionam
- OAuth consent funciona no subdominio do portal
- Dashboard e admin carregam sem erro de CORS
- Nenhuma chamada critica depende mais do frontend no apex
