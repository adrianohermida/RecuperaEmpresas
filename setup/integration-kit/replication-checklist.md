# Replication Checklist

Use este checklist para replicar o kit em um repo novo, um Supabase novo e contas novas do Freshsales Suite e Freshdesk.

## 1. Novo repositorio

- Copiar a pasta `setup/integration-kit/` para o novo repositorio
- Confirmar que os scripts `integration:*` estao presentes no `package.json`
- Confirmar que as rotas e telas do setup foram copiadas se o projeto usar o frontend interno
- Definir owner, repo e branch padrao no setup

## 2. Novo projeto Supabase

- Criar o projeto no Supabase
- Copiar `SUPABASE_URL`
- Copiar `SUPABASE_PROJECT_REF`
- Gerar `SUPABASE_SERVICE_ROLE_KEY`
- Gerar `SUPABASE_ANON_KEY`
- Revisar a redirect URI usada no OAuth
- Rodar `npm run integration:go` apenas apos validate/bootstrap

## 3. Nova conta GitHub / contexto MCP

- Preencher `GITHUB_REPO_OWNER`
- Preencher `GITHUB_REPO_NAME`
- Preencher `GITHUB_DEFAULT_BRANCH`
- Se houver GitHub App/MCP, preencher `GITHUB_APP_INSTALLATION_ID`
- Revisar `mcp.config.json`, `.mcp.json` e `local-ops-manifest.json`

## 4. Nova conta Freshsales Suite

- Confirmar `FRESHWORKS_ORG_BASE_URL`
- Confirmar `FRESHSALES_API_BASE`
- Criar um app OAuth
- Copiar `FRESHSALES_OAUTH_CLIENT_ID`
- Copiar `FRESHSALES_OAUTH_CLIENT_SECRET`
- Gerar a authorize URL
- Autorizar a conta
- Trocar o code por refresh token
- Salvar `FRESHSALES_REFRESH_TOKEN`
- Validar scopes exigidos

## 5. Nova conta Freshdesk

- Confirmar `FRESHDESK_DOMAIN`
- Gerar `FRESHDESK_API_KEY`
- Confirmar `FRESHDESK_PORTAL_TICKET_BASE_URL`
- Confirmar `FRESHDESK_NEW_TICKET_URL`

## 6. Frontend estatico vs backend local

- Em Cloudflare Pages puro, usar apenas preview, checklist e downloads locais
- Para salvar setup no repo e executar comandos pela UI, usar `setup/integration-kit/local-ops/`
- Nunca expor o backend local opcional em producao por padrao

## 7. Ordem recomendada

1. Preencher `setup.secrets.json`
2. Rodar `npm run integration:validate`
3. Rodar `npm run integration:bootstrap`
4. Revisar `credential-checklist.json`
5. Revisar `local-ops-manifest.json`
6. Revisar `authorize-url.json`
7. Rodar `npm run integration:go`
8. Rodar `npm run integration:seed-products`
9. Rodar `npm run integration:sync`

## 8. Gates finais antes de producao

- Confirmar que nenhum secret foi commitado
- Confirmar que `setup.secrets.json` esta fora do versionamento
- Confirmar que o runner web nao esta habilitado em producao
- Confirmar que `go` e `ops` continuam exigindo confirmacao explicita
- Confirmar que o bootstrap falha fechado sem setup file, exceto com `--allow-ambient-env`

