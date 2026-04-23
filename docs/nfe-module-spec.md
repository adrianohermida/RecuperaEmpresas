# Especificação do Módulo de Notas Fiscais — RecuperaEmpresas

## 1. Análise dos Modelos de Referência

### 1.1 NFS-e Municipal (São Paulo / Rio Preto)
Campos identificados no modelo paulista:
- **Cabeçalho**: Município emissor, Secretaria, Tipo (NFS-e), Número, Código de Verificação, Data/Hora de Emissão, QR Code
- **RPS**: Número RPS, Série RPS, Tipo RPS, NFS-e Substituída
- **Prestador de Serviço**: CPF/CNPJ, Nome/Razão Social, Endereço, CEP, Município, UF, País, E-mail, Telefone, Inscrição Municipal
- **Tomador de Serviço**: CPF/CNPJ, Inscrição Municipal, NIF, Nome/Razão Social, Endereço, CEP, Município, UF, País, E-mail, Telefone
- **Atividade Econômica**: Código CNAE
- **Discriminação do Serviço**: Descrição livre + valor aproximado dos tributos
- **Tributos Federais (R$)**: PIS, COFINS, INSS, IR, CSLL
- **Valor Aproximado dos Tributos (%)**: Federal, Estadual, Municipal, Fonte
- **Identificação da Prestação**: Código da Obra, Código A.R.T., Exigibilidade ISSQN, Regime Especial, Simples Nacional, Nomenclatura Brasileira de Serviços, Indicador de Operação, Situação Tributária, Classificação Tributária, Competência, Município Prestação, Município Incidência, ISSQN a Reter
- **Detalhamento de Valores (R$)**: Valor do Serviço, Desconto Incondicionado, Desconto Condicionado, Retenções Federais, Outras Retenções, Deduções Previstas em Lei, Base de Cálculo, Alíquota, ISSQN, IBS, CBS, Valor Líquido

### 1.2 DANFSe v1.0 — Padrão Nacional (ABRASF/SEFIN)
Campos identificados no modelo nacional (Manaus/AM):
- **Cabeçalho**: Logo NFS-e, DANFSe v1.0, Prefeitura/Secretaria, Contato
- **Chave de Acesso**: 32 dígitos
- **Identificação**: Número NFS-e, Competência, Data/Hora Emissão, Número DPS, Série DPS, Data/Hora DPS, QR Code
- **Emitente da NFS-e**: CNPJ/CPF/NIF, Inscrição Municipal, Telefone, Nome/Nome Empresarial, E-mail, Endereço, Município, CEP, Simples Nacional, Regime de Apuração
- **Tomador do Serviço**: CNPJ/CPF/NIF, Inscrição Municipal, Telefone, Nome/Nome Empresarial, E-mail, Endereço, Município, CEP
- **Serviço Prestado**: Código de Tributação Nacional, Código de Tributação Municipal, Local da Prestação, País da Prestação, Descrição do Serviço
- **Tributação Municipal**: Tributação ISSQN, País Resultado, Município Incidência, Regime Especial, Tipo de Imunidade, Suspensão Exigibilidade, Número Processo, Benefício Municipal, Valor do Serviço, Desconto Incondicionado, Total Deduções/Reduções, Cálculo BM, BC ISSQN, Alíquota Aplicada, Retenção ISSQN, ISSQN Apurado
- **Tributação Federal**: IRRF, Contribuição Previdenciária Retida, Contribuições Sociais Retidas, Descrição, PIS, COFINS
- **Valor Total NFS-e**: Valor do Serviço, Desconto Condicionado, Desconto Incondicionado, ISSQN Retido, Total Retenções Federais, PIS/COFINS Débito, Valor Líquido
- **Totais Aproximados dos Tributos**: Federais, Estaduais, Municipais
- **Informações Complementares**

## 2. Campos Unificados para o Módulo (Compatível Nacional)

O módulo deve suportar ambos os padrões. Os campos essenciais para extração/indexação são:

| Campo | Descrição | Obrigatório |
|-------|-----------|-------------|
| `numero_nfe` | Número da NFS-e / NF-e | Sim |
| `chave_acesso` | Chave de acesso (44 dígitos NF-e / 32 NFS-e) | Não |
| `data_emissao` | Data e hora de emissão | Sim |
| `competencia` | Mês/Ano de competência | Sim |
| `tipo_nota` | NFS-e, NF-e, NF-Produto, CT-e | Sim |
| `emitente_cnpj` | CNPJ do emitente | Sim |
| `emitente_razao_social` | Razão social do emitente | Sim |
| `emitente_municipio` | Município do emitente | Sim |
| `emitente_uf` | UF do emitente | Sim |
| `tomador_cnpj` | CNPJ/CPF do tomador | Não |
| `tomador_razao_social` | Nome/Razão social do tomador | Não |
| `descricao_servico` | Discriminação/descrição do serviço | Não |
| `valor_servico` | Valor bruto do serviço/produto | Sim |
| `valor_desconto` | Total de descontos | Não |
| `valor_liquido` | Valor líquido final | Sim |
| `issqn` | Valor do ISSQN | Não |
| `iss_retido` | ISSQN retido na fonte | Não |
| `pis` | Valor PIS | Não |
| `cofins` | Valor COFINS | Não |
| `inss` | Valor INSS | Não |
| `ir` | Valor IR | Não |
| `csll` | Valor CSLL | Não |
| `aliquota` | Alíquota aplicada (%) | Não |
| `status` | pendente / processado / erro | Sim |
| `arquivo_path` | Caminho do PDF no storage | Sim |
| `fonte` | upload_pdf / importacao_planilha / manual | Sim |

## 3. Colunas para Importação via Planilha XLS/CSV

O sistema deve aceitar planilhas com mapeamento flexível. Colunas reconhecidas automaticamente:
- `numero`, `numero_nfe`, `nfe`, `nota`
- `data`, `data_emissao`, `emissao`, `competencia`
- `emitente`, `prestador`, `fornecedor`, `razao_social`
- `cnpj_emitente`, `cnpj_prestador`, `cnpj`
- `tomador`, `cliente`, `tomador_servico`
- `descricao`, `servico`, `discriminacao`
- `valor`, `valor_servico`, `valor_bruto`, `total`
- `valor_liquido`, `liquido`, `valor_final`
- `issqn`, `iss`, `imposto_municipal`
- `pis`, `cofins`, `inss`, `ir`, `csll`
- `status`, `situacao`

## 4. Gráficos Demonstrativos Planejados

1. **Faturamento Mensal** — Gráfico de barras: valor total de NFs por mês
2. **Distribuição por Tipo** — Gráfico de pizza: NFS-e vs NF-e vs outros
3. **Carga Tributária** — Gráfico de barras empilhadas: ISSQN + PIS + COFINS + IR + CSLL por período
4. **Top Emitentes** — Gráfico de barras horizontais: maiores fornecedores/prestadores por valor
5. **Evolução do Valor Líquido** — Gráfico de linha: valor líquido ao longo do tempo
6. **Status das Notas** — Gráfico de rosca: pendente / processado / erro

## 5. Arquitetura do Módulo

### Backend (routes/fiscal-notes.js)
- `GET /api/fiscal-notes` — listar notas do usuário
- `POST /api/fiscal-notes/upload-pdf` — upload de PDF (extração automática de metadados via OCR/regex)
- `POST /api/fiscal-notes/import-spreadsheet` — importar XLS/CSV
- `POST /api/fiscal-notes` — criar nota manual
- `PUT /api/fiscal-notes/:id` — editar nota
- `DELETE /api/fiscal-notes/:id` — excluir nota
- `GET /api/fiscal-notes/stats` — estatísticas para gráficos
- `GET /api/fiscal-notes/:id/file` — download do PDF original

### Frontend (dashboard.html + js/dashboard-fiscal-notes.js + css/fiscal-notes.css)
- Seção `sec-notas-fiscais` no sidebar do dashboard do cliente
- Upload drag-and-drop de PDFs
- Importação de planilha com preview e mapeamento de colunas
- Tabela de notas com filtros (período, tipo, status)
- Painel de gráficos com Chart.js
- Modal de detalhes da nota

### Banco de Dados (migrations/fiscal_notes_v1.sql)
- Tabela `re_fiscal_notes` com todos os campos mapeados acima
- RLS: usuário só vê suas próprias notas
- Bucket Supabase Storage: `fiscal-notes`
