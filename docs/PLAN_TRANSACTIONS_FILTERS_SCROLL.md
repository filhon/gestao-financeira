    nm# Plano de Implementação: Filtros Dinâmicos e Scroll Infinito nas Transações

Este documento mapeia a implementação das melhorias nas páginas de **Contas a Pagar** (`src/app/(dashboard)/financeiro/contas-pagar/page.tsx`) e **Contas a Receber** (`src/app/(dashboard)/financeiro/contas-receber/page.tsx`).

Como as mudanças envolvem hooks complexos (`usePaginatedQuery`), estado cruzado entre cliente/servidor e UI interativa, a implementação foi dividida em etapas seguras para serem executadas iterativamente (em várias janelas de contexto).

---

## 🚀 Escopo da Feature

1. **Filtros Dinâmicos**: A busca de texto, status, centro de custo (apenas Pagar) e o novo filtro de Período devem ser mutuamente dependentes.
2. **Filtro de Período (Data Range)**: Adicionar filtro de `startDate` e `endDate` (padrão `DIA` a `DIA + 7`).
3. **Scroll Infinito (Cursor-based)**: Carregar mais transações automaticamente ao rolar a página para o final (substituindo o botão "Carregar Mais").

---

## 📋 Fase 1: Refatoração do Estado dos Filtros (Lógica)

**Objetivo:** Unificar as variáveis de filtro espalhadas em um único estado coeso e estender as tipagens.

- [x] **Passo 1.1**: Atualizar a interface de filtros ou tipo passado ao `queryFn` e ao `transactionService` para suportar `startDate` juntamente com `endDate` (atualmente utiliza apenas `endDate`).
- [x] **Passo 1.2**: No arquivo `page.tsx` (Pagar e Receber), substituir os estados avulsos (`statusFilter`, `searchTerm`, `selectedCostCenterId`) por um objeto de estado unificado (ex: `filterOptions`).
- [x] **Passo 1.3**: Ajustar o mock/comportamento de busca para que, mesmo com texto digitado, os dados também passem pelos filtros de `status`, `data` e `centro de custo`.
- [x] **Passo 1.4**: Configurar a data padrão do filtro como `[hoje, hoje + 7 dias]`.

---

## 🧩 Fase 2: Implementação da Interface do Calendário e Filtros

**Objetivo:** Modificar a UI para receber o novo Date Range Picker e alinhar o comportamento visual.

- [x] **Passo 2.1**: Criar/importar o componente `DatePickerWithRange` usando o `Calendar` (`react-day-picker`) já disponível no Shadcn UI (`src/components/ui/calendar.tsx` e um popover).
- [x] **Passo 2.2**: Inserir o Date Range Picker ao lado dos filtros existentes no header da tabela.
- [x] **Passo 2.3**: Ligar os seletores de status, centro de custo e busca de texto aos disparadores do novo objeto de estado unificado (Fase 1).
- [x] **Passo 2.4**: Validar se a mudança de qualquer filtro repassa corretamente ao hook `usePaginatedQuery` (a query key deve reagir às mudanças).

---

## 📜 Fase 3: Scroll Infinito (Cursor-based) na Tabela

**Objetivo:** Eliminar o botão de carregamento manual e automatizar a paginação.

- [x] **Passo 3.1**: Criar um hook de utilidade geral `useIntersectionObserver.ts` (ou usar a API nativa no componente).
- [x] **Passo 3.2**: Inserir uma `<tr>` ou `<div>` invisível no final da `<TableBody>` que atue como o "gatilho" (target).
- [x] **Passo 3.3**: Ligar o IntersectionObserver ao target. Quando `isIntersecting === true` e `hasMore === true`, acionar a função `loadMore()` provida pelo hook `usePaginatedQuery`.
- [x] **Passo 3.4**: Remover o botão atual `"Carregar Mais"`. Adicionar um pequeno loading spinner na base da tabela que é exibido apenas quando `isFetchingNextPage` for verdadeiro.

---

## 🧪 Fase 4: Avaliação, QA e Refinamentos Finais

**Objetivo:** Garantir robustez, prevenir race conditions e polir a experiência.

- [x] **Passo 4.1**: Validar consistência da tabela na junção de filtros conflitantes (ex: Filtro de status "Pago" em um período onde não há itens pagos). Avaliar se o Loading State reage adequadamente.
- [x] **Passo 4.2**: Checar comportamento de debouncing da busca de texto associado a paginação (ex: digitar rápido e acionar o observer simultaneamente).
- [x] **Passo 4.3**: Assegurar que os filtros da tela de Contas a Receber funcionam da mesma forma (incluindo as tipagens que lá podem ser diferentes da página Contas a Pagar).

---

_Para iniciar o trabalho, copie este arquivo usando como guia para a Fase 1._
