# Runbook do Supabase Auth

## Objetivo

Configurar o Supabase Auth para que todos os fluxos do portal voltem para `portal.recuperaempresas.com.br`, e nao mais para o dominio principal.

## 1. Abrir configuracoes do Auth

No painel do Supabase do projeto `riiajjmnzgagntiqqshs`:

1. Abrir `Authentication`
2. Abrir `URL Configuration`

## 2. Configurar Site URL

Campo:

- `Site URL`

Valor esperado:

- `https://portal.recuperaempresas.com.br`

Observacao:

- Nao deixar `https://recuperaempresas.com.br` como Site URL principal do portal.

## 3. Configurar Redirect URLs

Na lista de `Redirect URLs`, adicionar exatamente estes valores:

- `https://portal.recuperaempresas.com.br/login?confirmed=1`
- `https://portal.recuperaempresas.com.br/login?invited=1`
- `https://portal.recuperaempresas.com.br/login?magic=1`
- `https://portal.recuperaempresas.com.br/login?email_changed=1`
- `https://portal.recuperaempresas.com.br/login?reauthenticated=1`
- `https://portal.recuperaempresas.com.br/reset-password`
- `https://portal.recuperaempresas.com.br/oauth/consent`
- `https://api-edge.recuperaempresas.com.br/api/auth/oauth/callback`

Se ainda existirem redirects antigos para o apex, revisar com cuidado antes de remover. O ideal e manter somente os do subdominio do portal para os fluxos autenticados do portal.

## 4. Revisar provedores e templates

Se o projeto usa email confirmation, invite, magic link e reset password:

1. Abrir `Authentication` -> `Email Templates`
2. Verificar se o texto dos emails nao menciona o dominio antigo manualmente
3. Confirmar que os links gerados usam o `Site URL` e os `Redirect URLs` corretos

Nao substituir os templates nativos do Supabase por fluxo paralelo enquanto o corte do portal estiver em andamento.

## 5. Revisar fluxo OAuth

Se houver OAuth consent no portal:

1. Confirmar que a aplicacao externa ou o fluxo iniciado pelo portal usa o callback correto
2. O callback esperado para a API e:
   `https://api-edge.recuperaempresas.com.br/api/auth/oauth/callback`

Observacao importante:

- Se a API ainda estiver em outro host, o frontend pode estar em `portal.recuperaempresas.com.br`, mas a rota `/api/auth/oauth/callback` precisa resolver corretamente via proxy, gateway ou host da API publicado. Se nao houver essa exposicao, o fluxo OAuth precisa ser ajustado antes de entrar em producao.

## 6. Validacoes manuais no Supabase

### Cadastro com confirmacao

Fluxo:

1. Criar conta no portal
2. Abrir email de confirmacao

Esperado:

- O link cai em `https://portal.recuperaempresas.com.br/login?confirmed=1`

### Invite user

Fluxo:

1. Disparar convite de usuario
2. Abrir email recebido

Esperado:

- O link cai em `https://portal.recuperaempresas.com.br/login?invited=1`

### Magic link

Fluxo:

1. Solicitar magic link
2. Abrir email recebido

Esperado:

- O link cai em `https://portal.recuperaempresas.com.br/login?magic=1`

### Reset password

Fluxo:

1. Solicitar redefinicao de senha
2. Abrir email recebido

Esperado:

- O link cai em `https://portal.recuperaempresas.com.br/reset-password`

## 7. Conferencias no repositorio ligadas ao Auth

Arquivos relevantes:

- [routes/auth.js](../routes/auth.js)
- [server.js](../server.js)
- [docs/cloudflare-pages-migration.md](../docs/cloudflare-pages-migration.md)
- [docs/cloudflare-pages-setup-checklist.md](../docs/cloudflare-pages-setup-checklist.md)
- [docs/cloudflare-pages-post-deploy-checklist.md](../docs/cloudflare-pages-post-deploy-checklist.md)

## 8. Erros mais provaveis

### Erro 1: email volta para o dominio errado

Conferir:

- `Site URL`
- `Redirect URLs`
- `BASE_URL` do backend publicado

### Erro 2: reset-password abre mas nao conclui

Conferir:

- Se a hash com `access_token` chegou ao frontend do portal
- Se a chamada da pagina `reset-password` esta indo para o host correto da API

### Erro 3: OAuth consent quebra no callback

Conferir:

- Se `/api/auth/oauth/callback` esta acessivel no host usado pelo portal
- Se o callback cadastrado no provider OAuth bate com o callback esperado da API
