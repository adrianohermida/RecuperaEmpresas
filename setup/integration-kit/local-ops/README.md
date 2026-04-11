# Local Ops Backend

Este pacote e opcional. Use apenas quando quiser habilitar o backend local do integration kit em uma maquina operacional controlada.

O frontend portatil continua funcionando sem esta pasta.

## O que este pacote habilita

- Salvar `setup.secrets.json` no repo local via UI
- Executar `validate`, `bootstrap`, `go`, `sync` e `ops` pela UI
- Manter o frontend estatico separado do backend local

## Variaveis obrigatorias

- `INTEGRATION_KIT_ALLOW_SERVER_FILE_WRITE=true`
- `INTEGRATION_KIT_COMMAND_RUNNER_ENABLED=true`

## Variavel opcional e sensivel

- `INTEGRATION_KIT_COMMAND_RUNNER_ALLOW_PRODUCTION=true`
  Use apenas se houver um motivo operacional muito claro e temporario.

## Sequencia sugerida

1. Copiar `.env.local-ops.example` para o ambiente local da maquina operacional
2. Rodar `run-validate.cmd` ou `run-validate.ps1`
3. Rodar `run-bootstrap.cmd` ou `run-bootstrap.ps1`
4. So depois disso considerar `run-go.*`, `run-sync.*` ou `run-ops.*`

## Regras

- Nunca expor esse backend em deploy estatico
- Nunca persistir `setup.secrets.json` fora de runtime local explicito
- Nunca habilitar o runner web em producao por padrao

