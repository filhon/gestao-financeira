# Busca — Implementação (rastreamento entre sessões)

> Baseado em `docs/BUSCA_MELHORIAS_PLANO.md`.
> Arquivos principais: `src/app/(dashboard)/busca/page.tsx` · `src/components/layout/GlobalSearch.tsx`

---

## Status geral

| Fase  | Descrição                                              | Status       |
| ----- | ------------------------------------------------------ | ------------ |
| **1** | Quick wins — React Query, síntese, matching, URL state | ✅ Concluída |
| **2** | Feature Origem (Tipo + Nome) como dimensão analítica   | ✅ Concluída |
| **3** | Sidebar de filtros facetados + charts condicionais     | ✅ Concluída |
| **4** | Command palette com preview e ações                    | ✅ Concluída |

---

## Fase 1 — Quick wins ✅

**Concluída em:** 2026-06-11
**Arquivo alterado:** `src/app/(dashboard)/busca/page.tsx`

### O que foi feito

#### 1. Migração para React Query

- Substituído `useState + useEffect + transactionService.getAll` por `useQuery`
- `queryKey: ['busca-transactions', companyId, createdBy]`
- `staleTime: 60_000` — 1 fetch alimenta todos os filtros em memória; segundo termo de busca não relê o Firestore
- `enabled: !!selectedCompany && !!user`

#### 2. Barra de síntese (inline, 1 linha)

- **Removidos** os 2 cards `grid-cols-2` (a pagar / a receber)
- **Adicionada** linha com separadores `·`:
  ```
  A pagar R$ X  ·  A receber R$ X  ·  Saldo ±X  ·  N atrasados  ·  Ticket médio R$ X
  ```
- Atrasados: `status !== 'paid' && status !== 'rejected' && dueDate < hoje`
- Ticket médio: média dos `amount` do conjunto filtrado
- Saldo negativo → vermelho; positivo → esmeralda
- "N atrasados" só aparece quando `lateCount > 0`

#### 3. Matching melhorado

**Acento-insensível:**

```ts
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
```

- "energia" casa "Energia", "ENERGIA", "Ênergy" etc.
- Aplicado a `description`, `supplierOrClient`, `requestOrigin.name`

**Valor estruturado** (substitui `t.amount.toString().includes(query)`):

```ts
// Suporta: >500  <1000  100-500  500 (igualdade exata ±0.01)
// "100" não casa mais com "1000" ou "100,50"
```

#### 4. Filtro de tipo + URL state

- Toggle Todos / A pagar / A receber no header do card
- Sincroniza com URL: `?q=energia&type=payable`
- Busca é compartilhável e recarregável
- Filtragem é instantânea (client-side sobre cache React Query)

### O que NÃO mudou na Fase 1

- Tabela, ordenação, highlighting, badges de status — mantidos
- `GlobalSearch.tsx` (Command Palette) — sem alteração (Fase 4)
- `transactionService.ts` — sem alteração

---

## Fase 2 — Feature Origem ✅

**Concluída em:** 2026-06-11
**Arquivos alterados:** `src/app/(dashboard)/busca/page.tsx` · `src/lib/constants/requestOrigin.ts` (novo)

### O que foi feito

1. **`src/lib/constants/requestOrigin.ts`** — `REQUEST_ORIGIN_TYPE_LABELS` + `REQUEST_ORIGIN_TYPE_SHORT` (abreviações "Dir.", "Dep.", "Set.")

2. **Facetas Tipo Origem no card header** — checkboxes multi-select (Diretoria / Departamento / Setor) com contagem derivada de `filteredBase` (pré-filtro de origem, para mostrar potencial total). Exibidos apenas quando o dataset tem `requestOrigin` preenchido.

3. **Combobox Nome Origem** — Popover + Command; lista de nomes únicos derivada de `filteredBase` filtrada pelo tipo selecionado. Ao trocar tipo, o nome é resetado. Pesquisa fuzzy via `CommandInput`.

4. **Coluna Origem separada na tabela** — antes, `requestOrigin.name` era fallback de Fornecedor/Cliente. Agora tem coluna própria com abreviação de tipo em microbadge + nome. Suporta ordenação via `"requestOrigin.name"` (dot-notation do `useSortableData`).

5. **Toggle "Agrupar por: Nenhum · Origem · Status"** — agrupa `sortedTransactions` (preserva ordem do sort ativo). Cada grupo exibe subtotais de Pagar/Receber em `font-financial`. Status ordenado pelo fluxo do workflow; Origem pela ordem `director → department → sector`.

6. **URL state** — `?q=&origem=director,department&nome=Diretoria+Comercial`. Compartilhável e recarregável.

7. **Filtragem em dois estágios** — `filteredBase` (query + tipo) → `filtered` (+ origem + nome). A barra de síntese e o grouping usam `filtered`; as contagens de faceta usam `filteredBase`.

### O que NÃO mudou na Fase 2

- Matching utilities, `getStatusBadge`, React Query setup — inalterados
- `GlobalSearch.tsx` (Command Palette) — sem alteração (Fase 4)
- `transactionService.ts` — sem alteração

---

### Especificação original (para referência)

1. **Criar `src/lib/constants/requestOrigin.ts`**

   ```ts
   export const REQUEST_ORIGIN_TYPE_LABELS: Record<RequestOriginType, string> =
     {
       director: "Diretoria",
       department: "Departamento",
       sector: "Setor",
     };
   ```

2. **Facetas de Tipo + Nome Origem no header do card** (precursor do sidebar da Fase 3)
   - Checkboxes de `RequestOriginType` com contagem derivada do conjunto em memória
   - Combobox de Nome Origem dependente do tipo selecionado

3. **Coluna Origem na tabela** (já exibe `requestOrigin.name` mas como fallback de fornecedor/cliente — separar em coluna própria)

4. **Toggle "Agrupar por: Nenhum · Origem · Status"** acima da tabela
   - Quando agrupado, inserir cabeçalhos de grupo com subtotal `font-financial`

5. **URL state**: `?q=&origem=director,department`

---

## Fase 3 — Filtros facetados + charts ✅

**Concluída em:** 2026-06-11
**Arquivo alterado:** `src/app/(dashboard)/busca/page.tsx`

### O que foi feito

1. **Layout grid `grid-cols-[240px_1fr]`** — sidebar sticky à esquerda + área principal à direita. Só aparece quando há `query`; sem query exibe empty state full-width.

2. **Sidebar de filtros** (Card sticky, `max-h-[calc(100vh-6rem)] overflow-y-auto`):
   - **Tipo** — toggle Pagar/A receber/Todos (promovido do card header da Fase 2)
   - **Status** — checkboxes multi-select com cor funcional por status; "late" tratado como status computado (overdue); contagens derivadas de `filteredBase`; opções com count 0 são ocultadas
   - **Tipo de Origem** — checkboxes multi (da Fase 2, movidos para sidebar)
   - **Nome Origem** — combobox dependente do tipo (da Fase 2, movido para sidebar)
   - **Vencimento** — presets clicáveis (Vencidos / Próx. 7d / Próx. 30d / Este mês / Período...) + `DatePickerWithRange` condicional no preset "custom"
   - **Valor (R$)** — dois `Input` min/max; estado atualiza em tempo real, URL sincroniza no `onBlur`
   - **Contador de filtros ativos** no título + botão "Limpar" (ao lado) quando `activeFilterCount > 0`

3. **Aging bar** — barra horizontal empilhada por status (CSS flex, sem recharts); conditional: `filtered.length >= 8`; usa tokens `AGING_COLORS`; `aria-label` com sumário textual

4. **Top origens chart** — `BarChart` horizontal do recharts, top 5 por valor total; condicional: `filtered.length >= 15` ou `groupBy === "origin"`; exige ≥2 origens para renderizar

5. **URL state** — todos os filtros refletidos em params: `?q=&type=&status=&origem=&nome=&preset=&dateFrom=&dateTo=&minVal=&maxVal=`

6. **Helper `updateURL`** — centraliza a manipulação de `URLSearchParams` + `router.replace`

### O que NÃO mudou na Fase 3

- Matching utilities, summary bar, tabela, groupBy toggle, `getStatusBadge` — inalterados
- `GlobalSearch.tsx` (Command Palette) — sem alteração (Fase 4)
- `transactionService.ts` — sem alteração

---

**Pré-requisito:** Fase 2 (para faceta de Origem)

### Layout alvo

```
┌──────────────────────────────────────────────────────────┐
│ Resultados · "energia"               [38 resultados]      │
├──────────────────────────────────────────────────────────┤
│ Barra de síntese (já na Fase 1)                          │
├───────────────┬──────────────────────────────────────────┤
│ FILTROS       │  Tabela (já boa)                         │
│ (sidebar      │  + agrupamento (Fase 2)                  │
│  sticky)      │                                          │
│  Tipo         │                                          │
│  Status       │                                          │
│  Tipo Origem  │                                          │
│  Nome Origem  │                                          │
│  Vencimento   │                                          │
│  Valor        │                                          │
│  Centro custo │                                          │
└───────────────┴──────────────────────────────────────────┘
```

### Itens

1. **Grid `grid-cols-[240px_1fr]`** com sidebar sticky à esquerda
2. **Filtros por faceta** (todos client-side, instantâneos):
   - Tipo: toggle Pagar / Receber (promover o toggle da Fase 1 para a sidebar)
   - Status: checkboxes multi com badge de cor
   - Tipo/Nome Origem (da Fase 2)
   - Vencimento: presets (vencidos, 7d, 30d, mês) + range de datas
   - Valor: min/max numérico
   - Centro de custo: combobox
3. **Contagem por faceta** (`Atrasado · 4`) — some quando 0
4. **Botão "Limpar filtros"** quando há ≥ 1 ativo
5. **Aging bar** — barra horizontal empilhada por status, condicional: `results.length >= 8`
6. **Top origens** — BarChart horizontal recharts, top 5 por valor, condicional: agrupado por Origem ou `results.length >= 15`

### Dependências

- `recharts` já instalado (usado em `CostCenterChart`)
- Nenhuma dependência nova

---

## Fase 4 — Command Palette com preview ✅

**Concluída em:** 2026-06-11
**Arquivo alterado:** `src/components/layout/GlobalSearch.tsx`

### O que foi feito

1. **Preview assíncrono de transações no palette**
   - `useQuery` com `queryKey: ['busca-transactions', companyId, ...]` — mesmo key da Fase 1; cache compartilhado com a página de busca (zero reads extras se já carregado)
   - `enabled: open && !!selectedCompany && !!user` — só busca quando palette está aberto
   - Debounce de 250ms via `useEffect + setTimeout`
   - Matching acento-insensível (mesma `normalizeText` da Fase 1), apenas por texto (description / supplierOrClient / requestOrigin.name)
   - Top 5 resultados com chip Pagar/Receber, descrição, valor e vencimento (dd/MM)
   - Item "Ver todos os N resultado(s)" → `/busca?q=` com `handleSearch()`
   - Quando sem resultados de texto: item "Buscar por '[query]'" como fallback
   - Enter no item de transação → `/financeiro/contas-pagar` ou `/financeiro/contas-receber`

2. **Grupo AÇÕES** (filtrado por `usePermissions`)
   - "Nova conta a pagar" — `canCreatePayables`
   - "Novo recebível" — `canCreateReceivables`
   - "Importar OFX" — `canViewPayables` (→ `/financeiro/conciliacao`)
   - Oculto quando query começa com `/` (modo navegação pura)

3. **Lógica de Enter simplificada**
   - Eliminado o `document.querySelector('[cmdk-item][data-selected="true"]')` e o `handleInputKeyDown`
   - Cada item tem `onSelect`; o cmdk gerencia Enter sobre o item selecionado/destacado
   - Sem manipulação DOM

4. **Buscas recentes**
   - `localStorage` com chave `recent-searches-${companyId}`: últimas 5 queries (deduplicadas, FIFO)
   - `saveRecentSearch()` chamado em `handleSearch()` antes de navegar
   - Grupo `RECENTES` exibido quando query está vazia e há histórico
   - Carregado quando o diálogo abre (`useEffect [open, companyId]`)

5. **Rodapé de atalhos**: `↑↓ navegar · ↵ abrir · esc fechar`

6. **Estado limpo no fechamento**: `useEffect [open]` → limpa `searchQuery` e `debouncedQuery` quando `open` torna `false`

### O que NÃO mudou na Fase 4

- `navigationPages`, permissões, Ctrl+K shortcut — mantidos
- `busca/page.tsx` e `transactionService.ts` — sem alteração
- `command.tsx` — sem alteração

---

## Notas de arquitetura

- **Filtragem é sempre client-side** sobre o cache React Query — sem reads extras no Firestore ao mudar filtros
- **Para tenants grandes**: se o fetch p95 passar de ~1s, avaliar limitar a janela (ex.: últimos 12 meses por padrão com toggle "tudo"). Sem Algolia/Typesense por enquanto.
- **`ToggleGroup` do shadcn não está instalado** — usar botões estilizados com `cn` (implementado assim na Fase 1)
- **Highlight de texto**: accent-insensitive no matching, mas o highlight visual usa `indexOf` case-insensitive (funciona para a grande maioria dos casos sem offset de caracteres compostos)
