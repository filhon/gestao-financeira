# Busca — Plano de Melhoria (Command Palette + Página)

> Proposta de evolução para o `Ctrl+K` (`src/components/layout/GlobalSearch.tsx`) e para a
> página de resultados (`src/app/(dashboard)/busca/page.tsx`).
> Alinhada ao registro **product** do `PRODUCT.md`: dado em primeiro lugar, densidade
> intencional, desktop como operação, contexto brasileiro, zero decoração sem informação.

---

## 1. Diagnóstico do estado atual

### 1.1 Página `/busca`

| Ponto          | Situação hoje                                                                                 | Limite                                                 |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Escopo         | Só transações (`description`, `supplierOrClient`, `requestOrigin.name`, `amount` como string) | Não busca entidades, centros de custo, lotes           |
| Filtros        | Nenhum. O termo é fixo, vindo da URL (`?q=`)                                                  | Operador não consegue refinar sem voltar ao `Ctrl+K`   |
| Síntese        | 2 cards (total a pagar / a receber)                                                           | Sem saldo, sem status, sem aging, sem corte por origem |
| Interação      | Tabela ordenável + highlight do termo                                                         | Boa base, mas é o único recurso da página              |
| Match de valor | `t.amount.toString().includes(query)`                                                         | `"100"` casa com `1000`, `100,50`, etc. Frágil         |

### 1.2 Command palette (`Ctrl+K`)

- Faz **navegação local** (páginas) + delega a busca de termo para `/busca` via `router.push`.
- **Não mostra resultado nenhum dentro do palette**: todo termo exige uma viagem à página.
- A lógica de Enter consulta o DOM (`document.querySelector('[cmdk-item][data-selected="true"]')`)
  para decidir entre navegar e buscar. É frágil e acopla comportamento ao markup do `cmdk`.
- Não há ações (só links), nem buscas recentes, nem preview.

### 1.3 Performance / arquitetura

- `fetchAndFilter` chama `transactionService.getAll(filter)` que lê **todas** as transações da
  empresa e filtra no cliente. Cada nova busca relê a coleção inteira.
- A página usa `useState` + `useEffect` cru. O resto do app usa **React Query** (ver `CLAUDE.md`),
  então não há cache compartilhado entre buscas nem com o dashboard.
- Resultado: em tenant com volume alto, cada busca custa uma leitura full-collection no Firestore.

---

## 2. Visão da proposta

Transformar `/busca` de "lista de resultados de um termo" em **superfície de exploração**:
um termo abre o conjunto, e o operador refina por facetas, lê a síntese e age, sem sair da página.
O `Ctrl+K` vira o **ponto de entrada rápido** com preview, não só um redirecionador.

Três frentes, em ordem de impacto/esforço:

1. **Página com filtros facetados + síntese enxuta** (maior valor).
2. **Origem (Tipo/Nome) como nova dimensão analítica** (a feature que você levantou — recomendo **fazer**).
3. **Command palette com preview e ações** (refino de entrada).

---

## 3. Parte A — Página de busca

### 3.1 Arquitetura de informação (layout desktop)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Resultados da busca · "energia"            [ 38 resultados ]          │  ← header + total
├──────────────────────────────────────────────────────────────────────┤
│  Barra de síntese (inline, 1 linha):                                   │
│   A pagar  R$ 12.430  ·  A receber  R$ 3.200  ·  Saldo −9.230          │
│   · 4 atrasados · ticket médio R$ 410                                  │
├───────────────┬──────────────────────────────────────────────────────┤
│  FILTROS      │   Tabela de transações (mantida, já está boa)          │
│  (sidebar     │   + agrupamento opcional por Origem / Centro de custo  │
│   sticky)     │                                                        │
│   Tipo        │                                                        │
│   Status      │                                                        │
│   Tipo Origem │                                                        │
│   Nome Origem │                                                        │
│   Vencimento  │                                                        │
│   Valor       │                                                        │
│   Centro custo│                                                        │
└───────────────┴──────────────────────────────────────────────────────┘
```

Decisões de design (ancoradas no PRODUCT.md):

- **Sem grade de KPI-cards idênticos.** Em vez de 4 cards iguais (anti-padrão de SaaS), uma
  **barra de síntese de uma linha** com números `font-financial` e separadores `·`. Densa,
  legível, escaneável. Os 2 cards a pagar/receber atuais podem virar essa barra.
- **Filtros em sidebar sticky à esquerda** (padrão de operação desktop), não em popovers
  empilhados. Operador vê o estado dos filtros o tempo todo.
- **Charts são condicionais ao volume.** Só aparecem quando agregam: ver 3.3.

### 3.2 Filtros facetados

Barra lateral com contadores por faceta (estilo "facet count"), tudo derivado do conjunto já
carregado em memória, então é instantâneo:

| Faceta          | Controle                                         | Origem do dado                   |
| --------------- | ------------------------------------------------ | -------------------------------- |
| Tipo            | Toggle Pagar / Receber / Todos                   | `transaction.type`               |
| Status          | Checkboxes multi (com badge de cor já existente) | `transaction.status`             |
| **Tipo Origem** | Checkboxes: Diretoria / Depto. / Setor           | `requestOrigin.type`             |
| **Nome Origem** | Combobox dependente do Tipo Origem               | `requestOrigin.name`             |
| Vencimento      | Presets (vencidos, 7d, 30d, mês) + range         | `dueDate`                        |
| Valor           | Range slider ou min/max                          | `amount`                         |
| Centro de custo | Combobox                                         | `costCenterId` / `costCenterIds` |

- Cada faceta mostra a contagem ao lado (`Atrasado · 4`). Some quando a contagem é 0.
- Filtros refletem na URL como query params (`?q=energia&origem=director&status=late`), para que a
  busca seja **compartilhável e recarregável** (importante para auditoria/aprovação).
- Botão "Limpar filtros" quando há ≥1 ativo.

### 3.3 Síntese e visualizações (com parcimônia)

Mantendo a regra "decoração só se carregar informação", proponho **no máximo 2** visualizações,
ambas condicionais:

1. **Distribuição por status (aging)** — barra horizontal empilhada de largura total, segmentada
   por status com as cores funcionais que já existem (`emerald`/`amber`/`blue`/`destructive`).
   Mostra "saúde" do conjunto num relance. Aparece quando há ≥ ~8 resultados.

2. **Top origens / centros de custo** — `BarChart` horizontal (recharts, como `CostCenterChart`)
   com os 5 maiores por valor. **Só renderiza** quando o agrupamento por Origem está ativo ou
   quando há ≥ ~15 resultados. Reaproveita tokens `--chart-1..5`.

> Evitar: hero-metric gigante, gauges, donut decorativo. Nada disso ajuda o operador a decidir.

### 3.4 Agrupamento (a ponte para a feature de Origem)

Um toggle no topo da tabela: **"Agrupar por: Nenhum · Origem · Centro de custo · Status"**.
Quando agrupado, a tabela ganha cabeçalhos de grupo com subtotal (`font-financial`) por grupo.
É aqui que Tipo/Nome Origem deixam de ser metadado morto e viram leitura.

### 3.5 Correções de qualidade

- **Match de valor estruturado**: aceitar `>500`, `<1000`, `100-500` além de igualdade aproximada,
  comparando número, não string.
- **Match com acento-insensível** (`energia` casa `energía`/`ENERGIA`): normalizar com
  `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` nos dois lados.
- **Debounce** no campo de refino dentro da página (250ms).

---

## 4. Parte B — Feature Origem (Tipo + Nome) — recomendação

### 4.1 Vale a pena? **Sim, e é o item de maior retorno conceitual.**

O `requestOrigin: { type: "director" | "department" | "sector", name: string }` é **capturado em
toda transação** (`TransactionForm.tsx`) e hoje **só é lido como texto de busca**. É um eixo de
"**quem originou o gasto/receita**" que já existe no dado, sem custo de coleta novo. Ativá-lo
responde perguntas que hoje não têm tela:

- Quanto a **Diretoria X** solicitou no mês?
- Ranking de **setores** por volume de despesa.
- Um **Nome Origem** específico (ex.: "Diretoria Comercial") concentra atrasos?

É uma dimensão analítica de baixo custo e alto valor, complementar ao centro de custo (centro de
custo = _onde_ o dinheiro foi alocado; origem = _quem pediu_). Não competem; cruzam.

### 4.2 Como incrementar (escopo na busca, sem virar projeto gigante)

1. **Faceta de filtro** (Tipo Origem checkboxes + Nome Origem combobox dependente) — seção 3.2.
2. **Agrupar por Origem** com subtotais — seção 3.4.
3. **Mini-painel "Análise por Origem"**: quando agrupado por origem, mostrar o `BarChart` dos 5
   maiores Nomes Origem por valor, separados por Tipo. Reaproveita a infra de recharts.

### 4.3 Rótulos (centralizar)

Hoje os labels estão hardcoded no `TransactionForm` (`Diretoria`/`Depto.`/`Setor`). Extrair para um
mapa único reutilizável pela busca, filtros e (futuro) relatórios:

```ts
// src/lib/types/index.ts  (ou um labels.ts)
export const REQUEST_ORIGIN_TYPE_LABELS: Record<RequestOriginType, string> = {
  director: "Diretoria",
  department: "Departamento",
  sector: "Setor",
};
```

### 4.4 Evolução futura (fora do escopo imediato, registrar)

- Página própria **Relatórios → Por Origem** reaproveitando os agregadores da busca.
- Considerar **índice/normalização do Nome Origem** (hoje é texto livre; "Diretoria Comercial" vs
  "Dir. Comercial" fragmentam a análise). Sugestão: autocomplete com valores já usados no
  `TransactionForm` para convergir a digitação.

---

## 5. Parte C — Command palette (`Ctrl+K`)

### 5.1 Preview de resultados dentro do palette

Maior ganho de UX: ao digitar um termo (sem `/`), buscar de forma **assíncrona e debounced** e
mostrar os **5 principais** resultados de transação direto no palette, com tipo, valor e
vencimento. Enter no item abre a transação; "Ver todos os N resultados" leva a `/busca?q=`.

```
┌─ Ctrl+K ───────────────────────────────────────┐
│ 🔍 energia                                       │
├─────────────────────────────────────────────────┤
│ TRANSAÇÕES                                       │
│  ▾ Pagar  Conta de energia ABRIL   −R$ 1.240  ⚠ │
│  ▾ Pagar  Energia matriz           −R$ 2.110     │
│  …                                               │
│  → Ver todos os 38 resultados                    │
│ NAVEGAÇÃO RÁPIDA                                 │
│  ▫ Contas a Pagar                                │
│ AÇÕES                                            │
│  + Nova conta a pagar                            │
└─────────────────────────────────────────────────┘
```

### 5.2 Demais incrementos

- **Ações, não só links**: "Nova conta a pagar", "Novo recebível", "Importar OFX" (respeitando
  permissões, como já faz com `usePermissions`).
- **Buscas/itens recentes**: últimas 5 buscas e/ou transações abertas (localStorage por empresa).
- **Prefixos de escopo**: `>` para ações, `/` (já existe) para navegação, `$` para valor,
  `@` para origem/entidade. Reduz ruído.
- **Simplificar a lógica de Enter**: com grupos explícitos (Transações / Navegação / Ações) e
  `onSelect` por item, elimina-se o `querySelector('[data-selected]')`. O `cmdk` já gerencia a
  seleção; deixar ele resolver o Enter.
- **Rodapé de atalhos**: `↑↓ navegar · ↵ abrir · esc fechar`.

---

## 6. Performance e arquitetura

| Item          | Hoje                                  | Proposto                                                                                             |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Fetch         | `getAll` full-collection a cada busca | **React Query** com `staleTime` (ex.: 60s); 1 fetch alimenta todas as facetas/charts em memória      |
| Filtragem     | Client-side por termo                 | Mantém client-side (facetas são instantâneas sobre o set cacheado)                                   |
| Escala        | Linear no nº de docs por busca        | Para tenants grandes, avaliar limitar a janela (ex.: últimos 12 meses por padrão, com toggle "tudo") |
| Busca textual | `includes` simples                    | Normalização acento-insensível + match de valor estruturado                                          |
| Estado da URL | Só `?q=`                              | `?q=&status=&origem=&...` — buscas compartilháveis                                                   |

> Não recomendo Algolia/Typesense agora: o volume por tenant e o padrão "busca-e-refina sobre um
> conjunto cacheado" não justificam a infra. Reavaliar se o tempo de fetch passar de ~1s p95.

---

## 7. Especificação de design system

Aderente ao que já existe (Tailwind 4 + shadcn New York, tokens OKLCH em `globals.css`):

- **Tipografia de números**: `font-financial` + `tabular-nums` em todo valor (já é padrão).
- **Cor**: estratégia **restrained** (neutro tintado + cores funcionais por status). Sem novas
  cores de marca. Charts usam `--chart-1..5` existentes.
- **Status**: reusar o `getStatusBadge` atual (já cobre os 6 estados do workflow + `late`/`rejected`).
- **Sinal de tipo**: manter o chip `Pagar`/`Receber` (vermelho/esmeralda) já implementado.
- **Motion**: manter `animate-in fade-in slide-in-from-bottom` com stagger leve; ease-out, sem bounce.
- **Componentes shadcn a reusar**: `Command`, `Combobox` (Popover+Command), `Checkbox`, `Slider`,
  `ToggleGroup`, `Badge`, `Table`. Nenhuma dependência nova além do que já está instalado.
- **Acessibilidade (WCAG AA)**: foco visível nas facetas, contagem de facetas não depende só de cor,
  charts com `aria-label` resumindo o dado.

---

## 8. Faseamento sugerido

| Fase                               | Entrega                                                                                                                               | Esforço | Risco |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| **1 — Quick wins**                 | Migrar página p/ React Query; barra de síntese (saldo, atrasados, ticket); match acento-insensível + valor estruturado; estado na URL | Baixo   | Baixo |
| **2 — Origem**                     | Facetas Tipo/Nome Origem; agrupar por Origem com subtotais; labels centralizados                                                      | Médio   | Baixo |
| **3 — Facetas completas + charts** | Sidebar de filtros (status, valor, data, centro de custo); aging bar; top origens                                                     | Médio   | Médio |
| **4 — Command palette**            | Preview assíncrono de resultados; ações; recentes; simplificar Enter                                                                  | Médio   | Médio |

---

## 9. Resumo da recomendação

- **Sim**, ativar **Tipo Origem + Nome Origem**: dado já coletado, hoje desperdiçado, vira eixo
  analítico de baixo custo (quem originou o gasto), complementar ao centro de custo.
- A página deve virar **exploração com facetas + síntese enxuta**, não ganhar uma grade de
  KPI-cards decorativos.
- O `Ctrl+K` deve **mostrar resultado** (preview), não só redirecionar.
- A maior alavanca técnica é **React Query + 1 fetch cacheado** alimentando facetas em memória.

```

```
