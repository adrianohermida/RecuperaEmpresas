# Handoff Summary

Este repositorio contem um kit reutilizavel para onboarding e operacao da integracao entre Supabase, Freshsales Suite e Freshdesk.

## O que ja esta pronto

- Wizard de setup para coleta de credenciais e geracao de arquivos
- Preview portatil que funciona ate em frontend estatico
- Bundle com config, mappings, checklist e manifesto operacional
- Backend local opcional para salvar setup no repo e executar comandos via UI
- Guardrails para evitar vazamento entre projetos e uso inseguro de secrets

## Onde comecar

- Ler `setup/integration-kit/README.md`
- Ler `setup/integration-kit/replication-checklist.md`
- Se precisar de backend local, ler `setup/integration-kit/local-ops/README.md`
- Usar `/interno/setup-integracao` para gerar o setup inicial

## Fluxo minimo

1. Preencher e baixar `setup.secrets.json`
2. Rodar `npm run integration:validate`
3. Rodar `npm run integration:bootstrap`
4. Revisar os arquivos gerados em `setup/integration-kit/generated/<workspace>`
5. Concluir OAuth do Freshsales com `authorize-url.json`
6. Rodar `npm run integration:go` e depois `npm run integration:sync`

## Regras criticas

- Nao commitar `setup.secrets.json`
- Nao habilitar runner web em producao por padrao
- Nao usar persistencia server-side de secrets fora de runtime local explicito
- O bootstrap deve falhar sem setup file, exceto com `--allow-ambient-env`

## Entregaveis do kit

- `integration.config.json`
- `field-mapping.json`
- `business-rules.json`
- `mcp.config.json`
- `.mcp.json`
- `credential-checklist.json`
- `local-ops-manifest.json`
- `replication-checklist.md`

## Objetivo final

Permitir replicacao rapida para novos nichos e novos clientes sem reescrever a integracao e sem depender de memoria tribal da equipe.

