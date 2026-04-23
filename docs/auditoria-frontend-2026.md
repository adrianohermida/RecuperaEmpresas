# Relatório de Auditoria e Correções de Frontend — RecuperaEmpresas

**Data:** 23 de Abril de 2026  
**Autor:** Manus AI (Assistente Técnico do Dr. Adriano Hermida Maia)  
**Escopo:** Auditoria profunda de UI/UX, Sidebars, Modais e Fluxo de Deploy do repositório `RecuperaEmpresas`

---

## 1. Resumo Executivo

A auditoria técnica identificou que o problema relatado (módulo de Notas Fiscais não aparecendo nos sidebars do Consultor e do Cliente) era decorrente de uma arquitetura híbrida de navegação: o sistema utilizava simultaneamente sidebars renderizados via JavaScript dinâmico (`shared-utils.js`) e sidebars estáticos codificados diretamente no HTML (`admin.html` e `cliente.html`).

Além disso, a integração do novo módulo exigia atualizações em controladores centrais de roteamento (`admin-shell-core.js` e `dashboard-core.js`), que não haviam sido contemplados na implementação inicial.

**Todas as correções foram implementadas, testadas e enviadas ao repositório via commit `fd6a4d6`.**

---

## 2. Correções Implementadas (Resolução do Bug)

### 2.1. Unificação e Atualização dos Sidebars

Para garantir que o módulo "Notas Fiscais" ficasse visível para todos os perfis de usuário, as seguintes intervenções foram realizadas:

1. **`js/shared-utils.js` (Sidebar Dinâmico)**
   - Adição do ícone SVG `notasFiscais` ao dicionário `SIDEBAR_ICONS`.
   - Inserção do objeto de navegação `{ href: '/dashboard?section=notas-fiscais', label: 'Notas Fiscais' }` na função `getSidebarSections()` para a visão do **Cliente**.
   - Inserção do objeto de navegação `{ href: '/admin?section=notasFiscais', label: 'Notas Fiscais' }` na função `getSidebarSections()` para a visão do **Consultor (Admin)**.

2. **`public/admin.html` e `public/cliente.html` (Sidebars Estáticos)**
   - Os arquivos HTML que continham menus hardcoded foram atualizados para incluir os botões e links de "Notas Fiscais" logo após o item "Jornadas", garantindo consistência visual.

### 2.2. Correção de Controladores de Roteamento (Core JS)

A simples adição do botão no sidebar não era suficiente, pois os scripts controladores bloqueavam o carregamento de seções não registradas:

1. **`js/admin-shell-core.js`**
   - A string `'notasFiscais'` foi adicionada ao array `validSections`.
   - O método `showSection()` foi estendido para carregar o módulo via `initAdminFiscalNotes()`.

2. **`js/dashboard-core.js`**
   - Corrigida uma quebra de sintaxe (`else` sem `if` prévio) no bloco que tentava inicializar o módulo do cliente.
   - Adicionada a flag de controle de estado `window._fnInitialized` para evitar reinicializações múltiplas e vazamento de memória.

3. **`js/client-detail-controller.js`**
   - Adicionado o handler para a aba `notas-fiscais-cliente`, permitindo que o consultor veja as notas de um cliente específico ao acessar o perfil dele no painel admin.

### 2.3. Criação do Módulo Frontend do Admin

Foi criado o arquivo **`js/admin-fiscal-notes.js`**, que faltava na implementação original. Este arquivo é responsável por:
- Renderizar a aba global de notas fiscais (`sec-notasFiscais`) no `admin.html`.
- Renderizar a aba individual de notas fiscais na visualização detalhada do cliente (`cliente.html`).
- Consumir a API `/api/fiscal-notes/stats` e gerar os gráficos com Chart.js.

---

## 3. Auditoria Profunda: Débitos Técnicos e Gargalos Mapeados

Durante a varredura dos 66 arquivos JavaScript e 16 arquivos HTML, os seguintes débitos técnicos (Tech Debts) foram identificados e documentados para resolução futura:

### 3.1. Arquitetura de UI (Frontend)
- **Duplicidade de Sidebars:** O sistema mantém duas fontes da verdade para a navegação (o HTML estático e o `shared-utils.js`). Isso causa bugs recorrentes ao adicionar novos módulos. **Recomendação:** Remover os sidebars hardcoded do HTML e forçar a renderização 100% via `renderPortalSidebar()`.
- **CSS Monolítico:** O arquivo `css/portal.css` possui mais de 8.600 linhas com mais de 160 variáveis `:root`. Há redundância extrema de classes (ex: múltiplas definições de botões e modais).
- **Gerenciamento de Modais:** Existem dezenas de modais hardcoded no `admin.html` (ex: `jrn-modal-form`, `fb-logic-modal`). O DOM fica inflado desnecessariamente. **Recomendação:** Migrar para renderização dinâmica de modais via template literals no JS.

### 3.2. Lógica JavaScript
- **Poluição do Escopo Global (`window`):** O sistema depende pesadamente de variáveis anexadas ao objeto `window` (ex: `window.REAdminFiscalNotes`, `window.switchClientDetailTab`). Isso aumenta o risco de colisões de nomenclatura.
- **Tratamento de Erros Silenciosos:** Foram encontradas mais de 60 instâncias de blocos `try/catch` vazios ou com `console.error` não tratado em arquivos críticos como `admin-business-plan.js` e `dashboard-fiscal-notes.js`.
- **Race Conditions no Roteamento:** O `admin-shell-core.js` possui comentários explícitos sobre "race conditions" (condições de corrida) no carregamento da aba Agenda (`window._pendingAgendaTab`).

### 3.3. Integração com Supabase
- O projeto inicializa o Supabase Client múltiplas vezes em diferentes arquivos JS em vez de usar um Singleton (instância única).
- O log do servidor indicou que a variável `VITE_SUPABASE_ANON_KEY` não está presente no `.env` local, o que faz com que a API de autenticação falhe em ambiente de desenvolvimento (embora funcione em produção via Cloudflare).

---

## 4. Auditoria de Fluxo de Deploy (CI/CD)

O repositório utiliza **GitHub Actions** (`.github/workflows/deploy-cloudflare.yml`) para fazer o deploy contínuo no ecossistema da Cloudflare.

**Diagnóstico do Fluxo:**
1. **Push:** O commit via API do GitHub falhou (limitação do token de Fine-Grained), mas o push via protocolo Git HTTPS (`git push origin gh-pages`) foi **bem-sucedido**.
2. **Pipeline (Cloudflare):**
   - A pipeline de deploy compila o projeto via `scripts/build.js` e gera a pasta `dist/`.
   - As etapas de deploy do Worker (API) e do Pages (Frontend) executam corretamente.
   - **Gargalo Identificado:** O job `verify-public-hosts` costuma falhar intermitentemente. A análise do log (`verify-cloudflare-public-hosts.sh`) revelou que o script tenta fazer um `curl` logo após o deploy. Como a Cloudflare possui cache de borda (CDN), a página antiga é servida nas primeiras tentativas, fazendo o script de teste falhar com *timeout*, mesmo com o deploy tendo ocorrido perfeitamente.

**Conclusão sobre o Deploy:** O fluxo está operante. As falhas no painel do GitHub Actions são "falsos positivos" gerados pelo tempo de propagação do cache da Cloudflare.

---

## 5. Próximos Passos Recomendados

Para elevar a maturidade do portal RecuperaEmpresas, sugiro que as próximas manutenções foquem em:

1. **Refatoração do Sidebar:** Excluir os menus HTML estáticos de `admin.html`, `cliente.html` e `dashboard.html` e usar exclusivamente o `shared-utils.js`.
2. **Separação de CSS:** Dividir o `portal.css` em arquivos modulares (`buttons.css`, `modals.css`, `tables.css`).
3. **Módulo Datajud:** Aplicar as regras da base de conhecimento para extrair a inteligência de contagem de prazos processuais (15 dias úteis) e integrá-la ao módulo de Tarefas do painel.
