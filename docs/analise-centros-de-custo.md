# Análise Técnica — Feature: Centros de Custo

> Gerado em: 2026-03-31

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Serviço (`costCenterService.ts`)](#2-serviço)
3. [Páginas](#3-páginas)
4. [Componente de Formulário](#4-componente-de-formulário)
5. [Tipos e Validações](#5-tipos-e-validações)
6. [Estado Global (Zustand)](#6-estado-global-zustand)
7. [Integração com Transações](#7-integração-com-transações)
8. [Integração com Relatórios](#8-integração-com-relatórios)
9. [Integração com Orçamentos](#9-integração-com-orçamentos)
10. [Hooks](#10-hooks)
11. [Regras do Firestore](#11-regras-do-firestore)
12. [Cloud Functions](#12-cloud-functions)
13. [Resumo de Problemas por Severidade](#13-resumo-de-problemas-por-severidade)
14. [Recomendações Prioritárias](#14-recomendações-prioritárias)

---

## 1. Visão Geral

A feature de Centros de Custo (CC) permeia todo o sistema. Ela é referenciada em:

- **Cadastro e hierarquia**: `src/app/(dashboard)/centros-custo/`
- **Serviço de negócio**: `src/lib/services/costCenterService.ts`
- **Orçamentos**: `src/lib/services/budgetService.ts` + coleção `budgets`
- **Uso/consumo**: `src/lib/services/usageService.ts` + coleção `cost_center_usage`
- **Transações**: `transactionService.ts`, `TransactionForm.tsx` (alocação multi-CC)
- **Dashboard**: `dashboardService.ts` (progresso de orçamento por CC)
- **Relatórios**: `reportService.ts` + página de relatórios
- **Cloud Functions**: trigger `updateCostCenterUsage` + `processRecurringTemplates`
- **Regras de segurança**: `firestore.rules`

O modelo de dados central é:

```
cost_centers/{id}        → documento do CC (inclui budget/budgetYear legados)
budgets/{id}             → orçamento por (costCenterId, year)
cost_center_usage/{id}   → consumo mensal por (companyId, costCenterId, monthKey)
transactions/{id}        → costCenterAllocation[], costCenterIds[], costCenterId
```

---

## 2. Serviço

**Arquivo**: [src/lib/services/costCenterService.ts](src/lib/services/costCenterService.ts)

### 2.1 Responsabilidades

| Método | Descrição |
|--------|-----------|
| `getAll(companyId?, forUserId?)` | Lista todos os CCs; filtra por `allowedUserIds` para o role `user` |
| `getById(id)` | Busca documento único por ID |
| `create / update / delete` | CRUD padrão |
| `getEffectiveBalance(costCenterId, companyId, year?, userId?)` | Calcula saldo real com base nas transações |
| `getAllBalances(companyId, costCenters, year?, userId?)` | Versão otimizada: 1 scan de transações + N leituras de orçamento |
| `allocateToChild(parentId, childId, amount)` | Transfere saldo de pai para filho |
| `updateBalance(id, availableBalance)` | Sobrescreve manualmente o campo `availableBalance` |
| `getChildren(parentId)` | Lista filhos diretos |
| `getHierarchicalCostCenters(items)` | Constrói árvore em memória |

### 2.2 Problemas Identificados

#### [CC-S01] `getById` sem filtro de `companyId` — **Alta**

`getById` usa `getDoc` diretamente sem validar que o documento pertence ao tenant do usuário. A segurança fica 100% dependente das regras do Firestore. Em calls internas do serviço, o dado retornado não é validado contra o `companyId` esperado.

**Correção sugerida:**
```ts
async getById(id: string, companyId: string): Promise<CostCenter | null> {
  const doc = await getDoc(/* ... */);
  if (!doc.exists() || doc.data().companyId !== companyId) return null;
  return { id: doc.id, ...doc.data() } as CostCenter;
}
```

#### [CC-S02] `allocateToChild` não é atômico — **Alta**

Dois `updateDoc` independentes: se o segundo falhar, o saldo do pai é debitado mas o filho nunca é creditado.

**Correção sugerida:** usar `writeBatch()` para as duas escritas.

#### [CC-S03] `getChildren` sem filtro de `companyId` — **Média**

Consulta apenas por `parentId`, sem restrição de tenant. Um `parentId` de outro tenant retornaria erro de permissão do Firestore (não dados vazios), mas o comportamento é imprevisível.

**Correção sugerida:** adicionar `where("companyId", "==", companyId)` na query.

#### [CC-S04] `getEffectiveBalance` faz 2 scans completos da coleção `transactions` — **Média**

Para cada chamada: 1 query de payables + 1 query de receivables + 1 leitura de budget = 3 operações Firestore. Em empresas com 10 mil+ transações, isso é custoso. `getAllBalances` melhora o scan de transações, mas ainda faz N leituras individuais de budget.

**Correção sugerida:**
- Usar a abordagem de `in` query (até 30 items) do `dashboardService.getBudgetProgressByCostCenter` para buscar todos os budgets em lote.
- Criar índice Firestore composto em `(companyId, costCenterIds, type, status)`.

#### [CC-S05] Dupla representação de saldo — **Média**

`availableBalance` (campo no documento do CC, escrito por `updateBalance`) coexiste com o saldo calculado dinamicamente por `getEffectiveBalance`. As duas podem divergir silenciosamente. A fonte de verdade não está clara no código.

#### [CC-S06] `"none"` como sentinel escapando para o banco — **Baixa**

`getHierarchicalCostCenters` verifica `!i.parentId || i.parentId === "none"` (linha 354), indicando que a string `"none"` já foi gravada em produção. O formulário trata isso na linha 243, mas a defesa deveria existir também no serviço antes de escrever.

#### [CC-S07] Campos `budget`/`budgetYear` legados no documento do CC — **Baixa**

Mantidos para compatibilidade com dados antigos, mas criam ambiguidade com a coleção `budgets`. Considerar migração e remoção desses campos.

---

## 3. Páginas

### 3.1 Lista de Centros de Custo

**Arquivo**: [src/app/(dashboard)/centros-custo/page.tsx](src/app/(dashboard)/centros-custo/page.tsx)

#### [CC-P01] `BudgetBar` sempre renderiza `used=0` — **Alta**

```tsx
// Linha 215 — hardcoded, nunca reflete gastos reais
<BudgetBar used={0} total={node.budget} />
```

A barra de progresso existe mas é completamente inútil. Precisa consumir o saldo real de `getEffectiveBalance` ou da coleção `cost_center_usage`.

#### [CC-P02] Campo `budget` vem do documento do CC, não da coleção `budgets` — **Média**

Registros antigos sem o campo mostram orçamento zerado, mesmo que exista um documento na coleção `budgets`.

#### [CC-P03] Ordenação destrói a estrutura de árvore — **Média**

`useSortableData(costCenters)` ordena o array plano, depois `buildTree(sortedCostCenters)` reconstrói. Se um filho ordena antes de seu pai, a hierarquia fica incorreta na renderização.

**Correção sugerida:** aplicar ordenação apenas nos nós raiz, ou desabilitar sort enquanto a visualização em árvore estiver ativa.

#### [CC-P04] `defaultValues` do formulário recalculado em todo render — **Baixa**

O objeto de `defaultValues` dentro do `Dialog` é calculado via IIFE em cada render. Deve ser envolvido em `useMemo` com dependência em `editingId`.

#### [CC-P05] Sem paginação/virtualização — **Baixa**

Com hierarquias de 100+ CCs a lista completa é renderizada de uma vez.

### 3.2 Dashboard de Centro de Custo

**Arquivo**: [src/app/(dashboard)/centros-custo/[id]/page.tsx](src/app/(dashboard)/centros-custo/[id]/page.tsx)

#### [CC-D01] Dois `useEffect` independentes com as mesmas dependências — **Alta**

Ambos os effects disparam simultaneamente no mount e em cada mudança de `selectedYear`, totalizando até 8 chamadas Firestore por interação. Devem ser consolidados em um único effect ou migrados para React Query.

#### [CC-D02] `getPaginated` com `pageSize=100` filtrando em memória — **Média**

Se a empresa tiver >100 payables, apenas a primeira página é processada. Transações além da 100ª são ignoradas silenciosamente.

**Correção sugerida:** adicionar `costCenterId` como filtro nativo na query de `getPaginated`, ou usar `getByCostCenter` com paginação adequada.

#### [CC-D03] Inconsistência na contabilização de status — **Média**

| Fonte | Statuses contados |
|-------|------------------|
| `usageService.getUsageByCostCenter` | Apenas `paid` |
| `costCenterService.getEffectiveBalance` | `draft`, `pending_approval`, `approved`, `paid` |

O dashboard exibe os dois valores lado a lado, mas eles medem coisas diferentes sem indicação clara para o usuário.

#### [CC-D04] Orçamento dos filhos não respeita o ano selecionado — **Média**

A tabela de centros de custo filhos usa `child.budget` (campo do documento), que é fixo. Ao trocar o ano no seletor, os orçamentos dos filhos não mudam.

#### [CC-D05] Índice composto potencialmente ausente para `cost_center_usage` — **Baixa**

`getUsageByCostCenter` usa `where("monthKey", ">=", ...)` e `where("monthKey", "<=", ...)` junto com `companyId` e `costCenterId`. Se o índice composto `(companyId, costCenterId, monthKey)` não existir no Firestore, a query faz full scan.

#### [CC-D06] Intervalo de anos inconsistente — **Baixa**

- Seletor na página de detalhe: `currentYear - 2` a `currentYear + 2` (5 anos)
- Stepper no `CostCenterForm`: `currentYear - 2` a `currentYear + 3` (6 anos)

---

## 4. Componente de Formulário

**Arquivo**: [src/components/features/finance/CostCenterForm.tsx](src/components/features/finance/CostCenterForm.tsx)

#### [CC-F01] Leituras Firestore sem debounce em cada mudança de campo — **Alta**

Toda vez que o usuário clica no stepper de ano ou troca o CC pai, um `useEffect` dispara imediatamente chamando `budgetService.getByCostCenterAndYear` e `costCenterService.getEffectiveBalance`. O hook `useDebounce` existe no projeto mas não é utilizado aqui.

**Correção sugerida:**
```ts
const debouncedYear = useDebounce(watchedYear, 400);
// usar debouncedYear nas dependências do useEffect
```

#### [CC-F02] Sem estado de loading nos painéis de saldo — **Média**

Enquanto a chamada Firestore está em voo, valores antigos (ou zerados) continuam exibidos. O usuário pode ler dados obsoletos.

#### [CC-F03] Busca irrestrita de todos os usuários da empresa — **Média**

`userService.getAll(selectedCompany.id)` carrega todos os usuários no mount do formulário, sem paginação ou busca. Para empresas com centenas de usuários, isso é um read custoso e a UX de um scroll de 200px fica inutilizável.

#### [CC-F04] Campo `budgetLimit` sem efeito em nenhuma parte do sistema — **Baixa**

Presente no formulário, salvo no Firestore, mas não há lógica de alerta, bloqueio ou exibição desse limite em nenhum outro lugar.

---

## 5. Tipos e Validações

**Arquivos**: [src/lib/types/index.ts](src/lib/types/index.ts) | [src/lib/validations/costCenter.ts](src/lib/validations/costCenter.ts)

#### [CC-T01] Interface `Budget` sem campo `companyId` — **Média**

A regra do Firestore valida `resource.data.companyId`, o serviço grava condicionalmente, mas o TypeScript type não inclui o campo. Qualquer código que manipule `Budget` não tem garantia de type-safety para multi-tenancy.

#### [CC-T02] Campos legados `budget`/`budgetYear` no tipo `CostCenter` — **Baixa**

Mantidos para retrocompatibilidade mas criam ambiguidade. Ver também CC-S07.

#### [CC-T03] `ReconciliationRule.actionCategoryId` incompleto — **Baixa**

Comentário `// Link to cost center?` indica funcionalidade planejada mas nunca implementada: alocação automática de CC via regras de reconciliação.

#### [CC-V01] Unicidade do campo `code` não é validada — **Média**

O schema Zod valida comprimento mínimo (2 chars) mas não unicidade por empresa. Dois CCs podem ter o mesmo código na mesma empresa.

#### [CC-V02] Sentinel `"none"` no `parentId` — **Baixa**

O formulário converte `"none"` → `undefined` (linha 243), mas o serviço também verifica `i.parentId === "none"` ao montar a árvore, indicando que o sentinel já escapou para o banco em dados históricos.

---

## 6. Estado Global (Zustand)

Não existe store Zustand dedicado para centros de custo. Todo estado é `useState` local nos componentes de página.

#### [CC-Z01] Ausência de cache compartilhado — **Média**

A lista de CCs é refetchada do Firestore toda vez que:
- A página de centros de custo é aberta
- O `TransactionForm` é aberto
- O `CostCenterForm` é aberto

**Correção sugerida:** criar um store Zustand `useCostCenterStore` com TTL simples, ou migrar para React Query com `staleTime` configurado (ex: 5 minutos).

---

## 7. Integração com Transações

**Arquivos**: [src/lib/services/transactionService.ts](src/lib/services/transactionService.ts) | [src/components/features/finance/TransactionForm.tsx](src/components/features/finance/TransactionForm.tsx)

### Modelo de dados

Cada transação pode ter alocação múltipla por CC:
```ts
costCenterAllocation: CostCenterAllocation[]  // multi-CC com percentual
costCenterIds: string[]                        // desnormalizado para queries
costCenterId: string                           // primeiro elemento (legado)
```

#### [CC-TX01] `getByCostCenter` faz scan completo da coleção — **Alta**

O método busca **todas** as transações da empresa e filtra por CC em memória. Com 50 mil transações, cada chamada processa tudo. Deve ser substituído por uma query nativa no Firestore usando `costCenterIds` com `array-contains`.

#### [CC-TX02] Filtro por >10 CCs trunca silenciosamente — **Alta**

```ts
// transactionService.ts linha ~210
if (costCenterIds.length > 10) {
  console.warn("Truncating cost center filter to 10");
  costCenterIds = costCenterIds.slice(0, 10);
}
```

O usuário recebe resultados errados sem nenhum aviso na interface.

**Correção sugerida:** fazer múltiplas queries de 10 em 10 e unir os resultados (Firestore `in` tem limite de 30 valores a partir de 2024; pode usar até 30 direto).

#### [CC-TX03] Dupla escrita de `costCenterId` e `costCenterIds` — **Média**

Mantidos em sync manualmente em `create`, `update` e `processRecurringTemplates`. Uma função auxiliar centralizada preveniria divergência.

#### [CC-TX04] Aprovadores múltiplos recebem links inválidos — **Média**

Em transações alocadas a múltiplos CCs com aprovadores distintos, todos recebem email de aprovação, mas o link aponta para a mesma transação. Apenas o primeiro aprovador que agir tem efeito; os demais recebem erro ou ação duplicada.

#### [CC-TX05] Recalculo de saldo a cada mudança de data de vencimento — **Média**

`balanceYear` é derivado de `dueDate`. Cada mudança de data que cruza virada de ano dispara `getAllBalances` — que inclui um scan completo de transações.

---

## 8. Integração com Relatórios

**Arquivos**: [src/app/(dashboard)/relatorios/page.tsx](src/app/(dashboard)/relatorios/page.tsx) | [src/lib/services/reportService.ts](src/lib/services/reportService.ts)

#### [CC-R01] Nenhum filtro por centro de custo nos relatórios — **Alta**

A página de relatórios tem filtros de período, tipo e status, mas **não há filtro por CC**. Não é possível gerar um relatório de fluxo de caixa ou DRE para um único centro de custo.

#### [CC-R02] Exportação CSV usa ID bruto e não expande alocações múltiplas — **Média**

```ts
// reportService.ts linha ~573
t.costCenterId ?? ""
```

- Exporta o ID do CC, não o nome
- Para transações com múltiplos CCs, apenas o primeiro é exportado
- PDFs não incluem informação de CC alguma

#### [CC-R03] DRE sem breakdown por centro de custo — **Baixa**

`generateDREPDF` agrega receitas vs despesas sem qualquer dimensão de CC. Um DRE por centro de custo é um relatório padrão na gestão financeira brasileira e está ausente.

---

## 9. Integração com Orçamentos

**Arquivo**: [src/lib/services/budgetService.ts](src/lib/services/budgetService.ts)

#### [CC-B01] `budgetService` não filtra por `companyId` nas queries — **Alta**

`getByCostCenterAndYear` não inclui `where("companyId", "==", companyId)`. A isolação de tenant depende exclusivamente do fato de que `costCenterId` pertence a uma empresa. Se um `costCenterId` for obtido por outro tenant, o budget pode ser lido.

**Correção sugerida:**
```ts
async getByCostCenterAndYear(costCenterId: string, year: number, companyId: string) {
  const q = query(
    collection(db, "budgets"),
    where("companyId", "==", companyId),
    where("costCenterId", "==", costCenterId),
    where("year", "==", year),
    limit(1)
  );
  // ...
}
```

#### [CC-B02] N leituras individuais em `getAllBalances` — **Média**

Para 50 CCs: 50 chamadas `getByCostCenterAndYear` em `Promise.all`. O `dashboardService` já usa `in` query para buscar budgets em lote — a mesma abordagem deve ser aplicada aqui.

#### [CC-B03] Falha silenciosa ao salvar orçamento — **Média**

Em `page.tsx`, `budgetService.setBudget` é chamado dentro do `handleSubmit`. Se falhar, apenas um `console.error` é emitido — sem toast de erro para o usuário.

#### [CC-B04] `setBudget` usa leitura-antes-de-escrita sem transação — **Baixa**

Dois usuários salvando o orçamento do mesmo CC simultaneamente podem resultar em sobrescrita silenciosa sem detecção de conflito.

---

## 10. Hooks

**Diretório**: [src/hooks/](src/hooks/)

Não existe hook dedicado para centros de custo. Hooks relacionados em uso:

| Hook | Uso nos CCs |
|------|-------------|
| `usePermissions` | `canManageCostCenters`, `onlyOwnPayables` |
| `useSortableData` | Ordenação na lista (com o bug CC-P03) |
| `useDebounce` | **Existe no projeto, mas não é usado** nos efeitos do `CostCenterForm` (ver CC-F01) |

**Oportunidade**: um hook `useCostCenters(companyId)` encapsulando fetch + cache + tree building eliminaria duplicação entre a página de lista, `TransactionForm` e `CostCenterForm`.

---

## 11. Regras do Firestore

**Arquivo**: [firestore.rules](firestore.rules)

#### [CC-RU01] Queries de coleção não têm restrição de `companyId` na regra — **Alta**

Para leituras de documento individual, `resource.data.companyId` é verificado. Para **listagens**, o Firestore avalia a regra por documento após a query executar. Um cliente malicioso que envie uma query sem filtro `companyId` via REST API receberia erro de permissão, mas a regra não bloqueia a query antes de executar — apenas rejeita cada documento que não pertence ao tenant.

O modelo atual é padrão e aceitável desde que o SDK do cliente sempre inclua o filtro `companyId`. Isso é uma dependência implícita que deve ser documentada.

#### [CC-RU02] Roles `approver` e `releaser` podem escrever em `cost_center_usage` — **Média**

```
// firestore.rules — cost_center_usage write
allow write: if hasCompanyRole(companyId, ['financial_manager', 'approver', 'releaser', 'user']);
```

Somente o serviço de transações (via trigger Cloud Function) deveria escrever nessa coleção. Conceder escrita direta a `approver` e `releaser` permite manipulação do histórico de uso de orçamento.

**Correção sugerida:** mover a escrita de `cost_center_usage` para Cloud Functions exclusivamente e restringir a regra para apenas `financial_manager` ou remover write do cliente por completo.

---

## 12. Cloud Functions

**Arquivo**: [functions/src/index.ts](functions/src/index.ts)

### `updateCostCenterUsage` (trigger em `transactions`)

#### [CC-CF01] Transações legadas (sem `costCenterAllocation`) são ignoradas — **Alta**

```ts
// functions/src/index.ts linha ~338
if (allocations.length === 0) return [];
```

Transações antigas que usam apenas o campo singular `costCenterId` nunca contribuem para `cost_center_usage`. O código fallback foi intencionalmente comentado. Dados históricos ficam sub-contabilizados nos dashboards.

#### [CC-CF02] Potencial dupla contagem em retentativas — **Média**

O trigger usa `increment` baseado no delta antes/depois. Em cenário de retentativa (Firestore "at-least-once"), se o before/after estiver populado em ambas as tentativas, o increment pode ser aplicado duas vezes.

#### [CC-CF03] Inconsistência de status entre Cloud Function e serviço — **Média**

| Componente | Statuses considerados |
|------------|----------------------|
| `updateCostCenterUsage` (Cloud Function) | Apenas `paid` |
| `usageService.updateUsage` (cliente) | Apenas `paid` |
| `costCenterService.getEffectiveBalance` | `draft`, `pending_approval`, `approved`, `paid` |

O dashboard de CC exibe "Despesas Realizadas" (via usage, só `paid`) e "Saldo Disponível" (via `getEffectiveBalance`, inclui comprometidos). São métricas conceitualmente distintas, mas não sinalizadas claramente para o usuário.

### `processRecurringTemplates`

#### [CC-CF04] Não chama `usageService.updateUsage` — **Baixa** (intencional)

O trigger `updateCostCenterUsage` cuida da atualização de usage quando a transação é gravada. Não há bug aqui, mas o padrão diverge do `transactionService.create` que chama `usageService.updateUsage` diretamente — o que pode confundir manutenções futuras.

---

## 13. Resumo de Problemas por Severidade

### Alta Prioridade (11 itens)

| ID | Arquivo | Problema |
|----|---------|----------|
| CC-S01 | `costCenterService.ts` | `getById` sem validação de `companyId` |
| CC-S02 | `costCenterService.ts` | `allocateToChild` não usa `writeBatch` (não atômico) |
| CC-P01 | `centros-custo/page.tsx` | `BudgetBar` hardcoded com `used=0` |
| CC-P03 | `centros-custo/page.tsx` | Ordenação destrói hierarquia de árvore |
| CC-D01 | `centros-custo/[id]/page.tsx` | Dois `useEffect` duplicados com mesmas dependências |
| CC-F01 | `CostCenterForm.tsx` | Reads Firestore sem debounce no stepper de ano |
| CC-TX01 | `transactionService.ts` | `getByCostCenter` faz scan completo da coleção |
| CC-TX02 | `transactionService.ts` | Filtro >10 CCs trunca silenciosamente |
| CC-B01 | `budgetService.ts` | Queries de budget sem filtro de `companyId` |
| CC-R01 | `relatorios/page.tsx` | Ausência de filtro por CC nos relatórios |
| CC-CF01 | `functions/src/index.ts` | Transações legadas ignoradas em `updateCostCenterUsage` |

### Média Prioridade (14 itens)

| ID | Arquivo | Problema |
|----|---------|----------|
| CC-S03 | `costCenterService.ts` | `getChildren` sem filtro de `companyId` |
| CC-S04 | `costCenterService.ts` | `getEffectiveBalance` com 2 scans completos |
| CC-S05 | `costCenterService.ts` | Dupla representação de saldo (`availableBalance` vs calculado) |
| CC-P02 | `centros-custo/page.tsx` | `budget` exibido vem do documento, não da coleção `budgets` |
| CC-D02 | `centros-custo/[id]/page.tsx` | `getPaginated` filtrando em memória (perde além da página 1) |
| CC-D03 | `centros-custo/[id]/page.tsx` | Inconsistência de status entre "Despesas" e "Saldo" |
| CC-D04 | `centros-custo/[id]/page.tsx` | Orçamento dos filhos ignora o ano selecionado |
| CC-F02 | `CostCenterForm.tsx` | Sem loading state nos painéis de saldo |
| CC-F03 | `CostCenterForm.tsx` | Carrega todos os usuários sem paginação |
| CC-T01 | `types/index.ts` | Interface `Budget` sem `companyId` |
| CC-Z01 | (ausente) | Sem cache compartilhado — refetch em todo mount |
| CC-TX03 | `transactionService.ts` | Dupla escrita `costCenterId`/`costCenterIds` sem helper central |
| CC-TX04 | `transactionService.ts` | Multi-aprovadores recebem links inválidos |
| CC-TX05 | `TransactionForm.tsx` | Recalculo de saldo a cada mudança de data |
| CC-B02 | `budgetService.ts` | N leituras individuais de budget em `getAllBalances` |
| CC-B03 | `centros-custo/page.tsx` | Falha silenciosa ao salvar orçamento |
| CC-CF02 | `functions/src/index.ts` | Potencial dupla contagem em retentativas do trigger |
| CC-CF03 | `functions/src/index.ts` | Inconsistência de status entre CF e `getEffectiveBalance` |

### Baixa Prioridade (13 itens)

| ID | Arquivo | Problema |
|----|---------|----------|
| CC-S06 | `costCenterService.ts` | Sentinel `"none"` no `parentId` histórico |
| CC-S07 | `costCenterService.ts` | Campos legados `budget`/`budgetYear` no documento |
| CC-P04 | `centros-custo/page.tsx` | `defaultValues` recalculados em todo render |
| CC-P05 | `centros-custo/page.tsx` | Sem paginação/virtualização na lista |
| CC-D05 | `centros-custo/[id]/page.tsx` | Índice composto potencialmente ausente para `cost_center_usage` |
| CC-D06 | `centros-custo/[id]/page.tsx` | Intervalo de anos inconsistente entre páginas |
| CC-F04 | `CostCenterForm.tsx` | Campo `budgetLimit` sem efeito no sistema |
| CC-T02 | `types/index.ts` | Campos legados no tipo `CostCenter` |
| CC-T03 | `types/index.ts` | `actionCategoryId` com feature incompleta de reconciliação |
| CC-V01 | `costCenter.ts` (validação) | Unicidade do `code` não é validada |
| CC-V02 | `costCenter.ts` (validação) | `"none"` pode escapar para o banco via `parentId` |
| CC-R02 | `reportService.ts` | CSV exporta ID bruto do CC, não nome |
| CC-R03 | `reportService.ts` | Sem DRE por centro de custo |
| CC-RU02 | `firestore.rules` | `approver`/`releaser` podem escrever em `cost_center_usage` |
| CC-B04 | `budgetService.ts` | `setBudget` sem transação atômica |
| CC-CF04 | `functions/src/index.ts` | Padrão divergente de `usageService` entre transações normais e recorrentes |

---

## 14. Recomendações Prioritárias

### Imediatas (segurança e dados)

1. **[CC-B01]** Adicionar `companyId` em todas as queries do `budgetService` — risco de vazamento entre tenants.
2. **[CC-S02]** Converter `allocateToChild` para `writeBatch` — risco de inconsistência de dados em produção.
3. **[CC-RU02]** Remover escrita de `cost_center_usage` do cliente para roles `approver`/`releaser` — apenas Cloud Functions e `financial_manager` devem escrever.

### Alta Impacto na Experiência

4. **[CC-P01]** Corrigir `BudgetBar` para consumir saldo real — a barra de progresso existe mas não funciona.
5. **[CC-R01]** Adicionar filtro por centro de custo nos relatórios — ausência completa é uma lacuna crítica de produto.
6. **[CC-P03]** Corrigir ordenação para preservar hierarquia — ordenar apenas nós raiz.

### Performance

7. **[CC-TX01]** Refatorar `getByCostCenter` para usar `array-contains` no Firestore em vez de scan + filtro em memória.
8. **[CC-B02 / CC-S04]** Consolidar leituras de budget usando `in` query (lote de até 30) em vez de N chamadas individuais.
9. **[CC-F01]** Adicionar `useDebounce` nos effects do `CostCenterForm` para reduzir reads Firestore desnecessários.
10. **[CC-Z01]** Criar `useCostCenterStore` com TTL ou usar React Query com `staleTime` para eliminar refetches duplicados.

### Consistência de Dados

11. **[CC-CF01]** Decidir como tratar transações legadas sem `costCenterAllocation` no trigger da Cloud Function — implementar fallback ou executar migração de dados.
12. **[CC-CF03 / CC-D03]** Padronizar quais statuses são considerados "despesa" em todos os componentes (decidir entre "comprometido" vs "pago").
13. **[CC-S05]** Escolher uma única fonte de verdade para saldo: remover `updateBalance` manual ou remover o cálculo dinâmico.
