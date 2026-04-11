# Setup Integration Kit

- Preencha `setup.secrets.json` a partir de `setup.template.json`.
- Ou use a tela `/interno/setup-integracao` para gerar o arquivo localmente.
- Antes do bootstrap, rode `npm run integration:validate`.
- Depois rode `npm run integration:bootstrap`.

Arquivos importantes:

- `setup.template.json`: modelo versionado.
- `setup.secrets.json`: arquivo local com segredos reais. Nao commitar.
- `generated/`: saida do bootstrap guiado.
- `generated/<workspace>/mcp.config.json`: conexao MCP do Supabase.
- `generated/<workspace>/.mcp.json`: contexto complementar para GitHub/MCP.
- `generated/<workspace>/credential-checklist.json`: checklist operacional de credenciais.

Uso rapido:

1. Salvar `setup.secrets.json`
2. Rodar `npm run integration:validate`
3. Rodar `npm run integration:bootstrap`
4. Rodar `npm run integration:go`
5. Concluir OAuth via `authorize-url.json`
6. Rodar `npm run integration:sync`

Somente ambiente local:

- `INTEGRATION_KIT_COMMAND_RUNNER_ENABLED=true`
- `INTEGRATION_KIT_ALLOW_SERVER_FILE_WRITE=true`
