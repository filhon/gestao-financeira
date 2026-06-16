# Auditoria — Página de Aprovação de Lote (`/approve-batch/[token]`)

**Data:** 2026-06-16
**Escopo:** `src/app/approve-batch/[token]/page.tsx` e suas dependências diretas
(`paymentBatchService`, `transactionService`, Firestore rules, `proxy.ts`, tipos).
**Dimensões avaliadas:** Funcionamento · Performance · Segurança · Responsividade/UX.

---

## 1. Sumário Executivo

A página é um **magic link público** (excluído do middleware `proxy.ts`, linha 93) que
permite a um aprovador revisar, ajustar, rejeitar e aprovar um lote de pagamentos a partir
de um link recebido por e-mail (`/approve-batch/{token}`).

O fluxo de UI está bem estruturado (estados de loading/erro/sucesso, agrupamento por centro
de custo e fornecedor, edição inline), **mas a auditoria revelou uma contradição arquitetural
crítica de segurança** e **dados financeiros falsos exibidos ao aprovador**, além de
inconsistências de consistência de dados e pontos de responsividade.

### Quadro de severidade

| ID      | Severidade | Área                | Resumo                                                                                                  |
| ------- | ---------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| SEC-01  | 🔴 Crítico | Segurança           | Magic link público é incompatível com as Firestore rules (exigem autenticação) — quebra para deslogados |
| SEC-02  | 🔴 Crítico | Segurança           | Sem enforcement server-side: validação de token é 100% client-side; o token não é uma credencial real   |
| FUN-01  | 🔴 Crítico | Funcionamento       | Os 3 contadores de saldo estão fixos em `0` — exibem informação financeira falsa ao aprovador           |
| SEC-03  | 🟠 Alto    | Segurança/Auditoria | `approvedBy: "magic-link"` + ausência total de `auditService.log` nas ações do lote                     |
| FUN-02  | 🟠 Alto    | Funcionamento       | Ajustes de valor não atualizam `batch.totalAmount` na aprovação — inconsistência propagada              |
| SEC-04  | 🟡 Médio   | Segurança           | Token trafega na URL (histórico, Referer, logs)                                                         |
| FUN-03  | 🟡 Médio   | Funcionamento       | `input type="number"` + `parseFloat` falha com vírgula decimal (pt-BR); viola convenção `currency.js`   |
| FUN-04  | 🟡 Médio   | UX/Segurança        | Aprovação do lote não tem diálogo de confirmação (ação de maior impacto)                                |
| RESP-01 | 🟡 Médio   | Acessibilidade      | Botões só-ícone (editar/rejeitar/confirmar) sem `aria-label`                                            |
| RESP-02 | 🟡 Médio   | Responsividade      | Sem `truncate` em descrições/fornecedores longos; linha de edição estoura em telas estreitas            |
| SEC-05  | 🔵 Baixo   | Segurança           | Mensagem de erro técnica do Firebase vaza para o usuário                                                |
| PERF-01 | 🔵 Baixo   | Performance         | Carregamento serial (lote → transações → centros de custo) poderia ser paralelo                         |
| Outros  | 🔵 Baixo   | Diversos            | Ver seções 3–6 (FUN-05..08, PERF-02..04, RESP-03..04, CONV-01..02)                                      |

---

## 2. Segurança

### 🔴 SEC-01 — Magic link público é incompatível com as Firestore rules

**Localização:** `firestore.rules:145-155` (payment_batches), `:104-142` (transactions),
`:169-175` (cost_centers); `src/proxy.ts:93`; `page.tsx:103-149`.

A página foi **projetada para ser pública**: o `proxy.ts` (middleware do Next 16) exclui
explicitamente `approve-batch` do matcher, e o e-mail envia o link
`${appDomain}/approve-batch/${token}` (`emailService.ts:117`) para ser clicado diretamente.

Entretanto, **toda** leitura e escrita usa o **SDK client** (`@/lib/firebase/client`), sujeito
às Firestore rules — e todas as coleções envolvidas exigem `isAuthenticated() && hasCompanyRole(...)`:

```
payment_batches → allow read/write: if isAuthenticated() && hasCompanyRole(...)
transactions    → allow read/update: if isAuthenticated() && hasCompanyRole(...)
cost_centers    → allow read:        if isAuthenticated() && hasCompanyRole(...)
```

**Consequências:**

- **Aprovador deslogado** (o caso de uso típico de um magic link): a primeira query
  (`getByApprovalToken`) falha com `permission-denied` → a página cai no `catch` e mostra
  "Erro ao carregar o lote". **O recurso simplesmente não funciona** sem uma sessão Firebase
  Auth ativa.
- **Aprovador logado com papel adequado na empresa**: funciona — mas então o token é
  **redundante** do ponto de vista de autorização (as rules já o autorizam), e ele poderia
  aprovar pela tela normal de lotes. O "magic link" não agrega segurança alguma.

> O mesmo padrão aparece em `reimbursement_reports` (`firestore.rules:338` tem o comentário
> _"allow update via magic-link token path (unauthenticated) — handled server-side only"_,
> mas a regra continua exigindo `isAuthenticated()`). É uma inconsistência de design recorrente.

**Recomendação:** mover as operações para o **servidor** (Route Handler usando o Admin SDK,
que faz bypass das rules), validando o hash do token e a expiração no backend. Ex.:
`POST /api/internal/batch-approval/[approve|reject|return]`. A página passa a chamar a API
em vez de tocar o Firestore diretamente. Isso torna o link verdadeiramente público **e** seguro.

---

### 🔴 SEC-02 — Ausência de enforcement server-side (token como mera credencial client-side)

**Localização:** `paymentBatchService.ts:633-734` (`getByApprovalToken`, `approveByToken`).

A validação do token (hash SHA-256), a checagem de expiração e a checagem de status
(`pending_approval`) acontecem **no client**, antes de um `writeBatch` também client-side.
Não há nenhuma etapa server-side autoritativa.

Pontos frágeis:

1. **Janela TOCTOU**: entre `getByApprovalToken` (lê doc e valida expiração) e `batch.commit()`
   existe um intervalo; nada garante atomicidade da validação + escrita.
2. **A autorização real vem 100% das Firestore rules** (papel na empresa), não do token. Um
   `financial_manager`/`approver`/`releaser` autenticado poderia chamar `approveWithDetails`
   diretamente, sem token. O token não restringe nada que as rules já não restrinjam.
3. **Consumo do token é client-controlado**: `approvalTokenHash: null` é setado pelo próprio
   cliente; um cliente malicioso pode optar por não consumir.

**Recomendação:** ver SEC-01. A validação/consumo do token deve ser atômica e server-side.

---

### 🟠 SEC-03 — Auditoria comprometida

**Localização:** `paymentBatchService.ts:686, 707, 727` (`approvedBy: "magic-link"`); ausência
de `auditService.log` em `approveByToken`, `rejectTransaction`, `returnToManager`.

- O aprovador real (mesmo autenticado) é registrado como a string literal **`"magic-link"`**,
  destruindo a rastreabilidade de **quem** aprovou um pagamento — informação essencial em um
  sistema financeiro multi-tenant com RBAC.
- Diferente de `transactionService.approveByToken` (que grava `auditService.log`), **nenhuma**
  das três ações de lote desta página gera registro em `audit_logs`. Aprovações, rejeições e
  devoluções de lote ficam **fora da trilha de auditoria**.

**Recomendação:** registrar a identidade real (uid) e gravar `auditService.log` com
`entity: "batch"` (já previsto no tipo `AuditLog`, `types/index.ts:348`) para cada ação.

---

### 🟡 SEC-04 — Token sensível trafega na URL

O token vai na rota (`/approve-batch/{token}`). URLs vazam por histórico do navegador, logs de
proxy/servidor e cabeçalho `Referer`. Mitigado por: hash no banco (`approvalTokenHash`) e
expiração de 48h (`paymentBatchService.ts:372-373`) — **bom** —, mas o token plaintext ainda
é exposto enquanto válido.

**Recomendação:** manter expiração curta, **consumir o token no primeiro uso** (server-side) e
considerar `Referrer-Policy: no-referrer` nesta rota específica (hoje é
`strict-origin-when-cross-origin`, `next.config.ts:62`).

### 🔵 SEC-05 — Vazamento de mensagem de erro técnica

`page.tsx:144` faz `setErrorMessage(error.message || ...)`. Erros do Firebase
("Missing or insufficient permissions") são exibidos diretamente. Trocar por mensagem genérica
e registrar o detalhe apenas no `console.error`.

---

## 3. Funcionamento / Correção

### 🔴 FUN-01 — Contadores de saldo exibem dados FALSOS

**Localização:** `page.tsx:425, 438, 451-452`.

Os três cards do topo são **placeholders fixos**:

```tsx
// Saldo Atual
{
  formatCurrency(0);
}
// Saldo Projetado (Fim do Ano)
{
  formatCurrency(0);
}
// Saldo Após Pagamento
{
  formatCurrency(0 - totalAmount);
} // sempre = -total do lote
```

Em um contexto de **decisão de aprovação financeira**, mostrar "Saldo Atual: R$ 0,00" e
"Saldo Após Pagamento: −R$ X" como se fossem reais é **enganoso e perigoso** — o aprovador pode
basear a decisão em um saldo que não existe. É o achado de funcionamento mais grave.

**Recomendação:** ou (a) calcular os saldos de verdade (via `company_stats`/agregações), ou
(b) **remover os três cards** até que haja dados reais. Não exibir números financeiros fictícios.

---

### 🟠 FUN-02 — Ajustes de valor não atualizam o total do lote

**Localização:** `page.tsx:333-340` → `paymentBatchService.ts:699-717`.

Ao aprovar com ajustes, `approveByToken` grava `batchAdjustedAmount` em cada transação e seta
status `approved`, **mas nunca recalcula `batch.totalAmount`**. Resultado: o lote segue para
autorização/pagamento com `totalAmount` somando os valores **originais**, divergente da soma
dos `batchAdjustedAmount`. A tela de lotes e telas seguintes exibirão um total incorreto.

> Note que `removeTransactions` (`paymentBatchService.ts:280-286`) já considera
> `batchAdjustedAmount`, o que evidencia a inconsistência: o caminho de aprovação não.

**Recomendação:** dentro do mesmo `writeBatch`, recomputar e gravar
`totalAmount = Σ(batchAdjustedAmount ?? amount)`.

---

### 🟡 FUN-03 — Edição de valor frágil em locale pt-BR e fora da convenção `currency.js`

**Localização:** `page.tsx:254` (`parseFloat(editValue)`), `:564-572` (`input type="number"`),
`:191-193` (soma com float).

- `parseFloat("1234,56")` retorna **`1234`** (trunca na vírgula). Usuários brasileiros tendem a
  digitar vírgula decimal; o `type="number"` tenta normalizar, mas o comportamento varia entre
  navegadores e o `parseFloat` não trata vírgula. Risco de **gravar valor errado**.
- O `CLAUDE.md` determina: _"Always use `currency.js` for monetary values — never raw floats"_.
  A edição e as somas (`group.totalAmount += amount`, `totalAmount` em `:233-238`) usam floats.

**Recomendação:** usar `currency.js` para parsing/soma e validar entrada com a máscara/locale BR.

### 🟡 FUN-04 — Aprovação sem confirmação

**Localização:** `page.tsx:680-687`.

"Devolver ao Gestor" abre `AlertDialog` e "Rejeitar" tem formulário; mas **Aprovar Lote** — a
ação de maior impacto e efetivamente irreversível pelo magic link — dispara direto no clique.

**Recomendação:** adicionar diálogo de confirmação resumindo nº de transações e total.

### 🔵 FUN-05 — `isNewTransaction` frágil

`page.tsx:241-243`: `differenceInDays(new Date(), t.createdAt)`. Se `createdAt` vier `undefined`
(campo ausente → `convertDates` retorna `undefined`), o resultado é `NaN` e o badge "Novo" some
silenciosamente. Guardar contra `t.createdAt` nulo.

### 🔵 FUN-06 — Mutação direta do estado `edits`

`page.tsx:289-290`: `edits.delete(rejectingId); setEdits(new Map(edits));` muta o `Map` do estado
antes de copiá-lo. Funciona, mas é anti-padrão React. Preferir criar a cópia, deletar nela e setar.

### 🔵 FUN-07 — `params.token as string`

`page.tsx:76`: `useParams()` pode retornar `string | string[]`. O cast otimista quebraria com
rota array. Validar tipo.

### 🔵 FUN-08 — Sem guarda de reentrância em rejeitar/editar

`handleRejectTransaction` não desabilita o botão durante a chamada — clique duplo pode disparar
duas rejeições. Usar um flag de submissão (como `isSubmitting` já faz em aprovar/devolver).

---

## 4. Performance

### 🔵 PERF-01 — Carregamento serial

`page.tsx:103-149`: lote → transações → centros de custo são `await` em sequência. As duas
últimas dependem só do `batch`, então podem ir em paralelo:

```ts
const [txns, ccSnapshot] = await Promise.all([
  transactionService.getAll({ batchId: batchData.id }),
  getDocs(
    query(
      collection(db, "cost_centers"),
      where("companyId", "==", batchData.companyId),
    ),
  ),
]);
```

### 🔵 PERF-02 — `buildBreadcrumb` com `Array.find` por nível

`page.tsx:152-170`: cada salto de hierarquia faz `costCenters.find` (O(n)). Para muitos centros,
pré-construir um `Map<id, CostCenter>` torna a navegação O(profundidade).

### 🔵 PERF-03 / PERF-04 — Volume de leitura

- Carrega **todos** os `cost_centers` da empresa só para montar breadcrumbs (`page.tsx:128-137`).
- `transactionService.getAll({ batchId })` não impõe `limit`. Lotes são naturalmente pequenos,
  então é aceitável, mas convém ter um teto defensivo.

> Índices: a query `batchId == … orderBy dueDate desc` é coberta por
> `firestore.indexes.json:668-685`. A busca por `approvalTokenHash` é igualdade de campo único
> (índice automático). **Sem problemas de índice.**

---

## 5. Responsividade & Acessibilidade

### 🟡 RESP-01 — Botões só-ícone sem rótulo acessível

`page.tsx:573-610` (editar/confirmar/cancelar/rejeitar): nenhum tem `aria-label` nem texto
`sr-only`. Leitores de tela anunciam apenas "botão". Adicionar `aria-label` descritivo.

### 🟡 RESP-02 — Texto longo sem truncamento

- Fornecedor no `AccordionTrigger` (`page.tsx:511-518`) e descrição da transação
  (`page.tsx:535-537`) não têm `truncate`/`min-w-0`. Nomes longos espremem o valor à direita em
  telas estreitas. Aplicar `truncate` + `min-w-0` no container flex.

### 🟡 RESP-03 — Linha em modo de edição pode estourar em mobile

`page.tsx:562-589`: em edição, `Input` (`w-28` ≈ 112px) + dois botões 32px convivem com a
descrição `flex-1` na mesma linha. Em ~320px fica apertado. Considerar empilhar/encolher.

### 🔵 RESP-04 — Footer de ações não empilha

`page.tsx:671` (`flex justify-between ... -mx-4` sticky): os dois botões ficam lado a lado mesmo
em telas muito estreitas. Em geral cabem, mas um `flex-col sm:flex-row` é mais seguro. O `-mx-4`
combinado com `sticky bottom-0` também merece teste em telas com safe-area (iOS).

**Pontos bons de responsividade:** grid `grid-cols-1 md:grid-cols-3` nos cards, header e footer
sticky, uso de `font-financial` (tabular) para valores.

---

## 6. Convenções do Projeto

- **CONV-01:** valores monetários com float em vez de `currency.js` (ver FUN-03) — viola `CLAUDE.md`.
- **CONV-02:** `format(t.dueDate, "dd/MM/yyyy")` (`page.tsx:557`) não passa `locale: ptBR`. Para
  formato numérico o efeito é nulo, mas a convenção do projeto pede o locale em toda formatação de data.

---

## 7. Pontos Positivos

- Token **hasheado** (SHA-256) no banco e **expiração de 48h** — não armazena plaintext.
- Estados de UI bem definidos (`loading` / `error` / `success`).
- Agrupamento por centro de custo + fornecedor com `useMemo` e dependências corretas.
- Uso consistente de `writeBatch` para atomicidade nos serviços.
- Verificação de `status === "pending_approval"` antes de permitir ações (client e service).
- Índices Firestore adequados para as queries usadas.

---

## 8. Recomendações Priorizadas

1. **Corrigir o modelo de segurança (SEC-01/02)** — mover aprovar/rejeitar/devolver para Route
   Handlers com Admin SDK, validando e consumindo o token no servidor. Sem isso, o recurso ou
   está quebrado (deslogado) ou é inseguro/redundante (logado). _Maior prioridade._
2. **Remover ou popular os contadores de saldo (FUN-01)** — não exibir números financeiros fictícios.
3. **Restaurar a trilha de auditoria (SEC-03)** — gravar uid real + `auditService.log` (`entity: "batch"`).
4. **Recalcular `totalAmount` ao aplicar ajustes (FUN-02).**
5. **Tratar moeda com `currency.js` e locale BR na edição (FUN-03)** + confirmação de aprovação (FUN-04).
6. **Acessibilidade/responsividade (RESP-01/02)** — `aria-label` e `truncate`.
7. Demais itens 🔵 conforme capacidade.

---

_Relatório gerado por auditoria estática de código. Recomenda-se validar SEC-01 em ambiente real
acessando o link de aprovação em uma sessão anônima (sem login) para confirmar o `permission-denied`._
