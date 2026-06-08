# Relatório de Melhorias — Página de Comprovantes

**Escopo analisado:** `src/app/(dashboard)/financeiro/comprovantes/page.tsx` e todo o ecossistema relacionado.

**Arquivos cobertos:**

- `src/app/(dashboard)/financeiro/comprovantes/page.tsx` — página principal
- `src/components/features/finance/comprovantes/UploadComprovanteDialog.tsx`
- `src/components/features/finance/comprovantes/MatchReviewDialog.tsx`
- `src/components/features/finance/comprovantes/{ComprovanteStatusBadge,ConfidenceBadge}.tsx`
- `src/lib/services/comprovanteService.ts`
- `src/lib/services/transactionService.ts` (métodos `getByIds`, `getAll`)
- `src/lib/matchingAlgorithm.ts`
- `src/hooks/usePaginatedQuery.ts`
- `src/app/api/internal/storage-proxy/route.ts`
- `firestore.rules` (regras da coleção `comprovantes`)

**Data:** 2026-06-08

---

## Sumário executivo

A funcionalidade está bem construída: paginação com cursor, dedupe por hash SHA-256, matching consolidado, RBAC nas regras e um proxy de storage autenticado. Porém há **problemas reais de correção, segurança e performance** que valem correção, sendo os mais graves:

| #   | Severidade | Área        | Problema                                                                                                                                |
| --- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 🔴 Alta    | Segurança   | `findByHash` / `getByTransactionId` fazem query cross-tenant; dependem 100% das regras, mas `getByTransactionId` nem filtra `companyId` |
| C1  | 🔴 Alta    | Correção    | Filtro de data e busca são **client-side sobre a página atual** — resultados "somem" com paginação                                      |
| C2  | 🟠 Média   | Correção    | `getStats` ignora filtros — os cards mostram totais globais enquanto a tabela está filtrada                                             |
| P1  | 🟠 Média   | Performance | `getAll({type:'payable'})` carrega **todas** as transações no upload e no review, sem paginação                                         |
| C3  | 🟠 Média   | Correção    | Upload não é atômico nem resiliente: falha no meio deixa órfãos em Storage/Firestore                                                    |
| S2  | 🟠 Média   | Segurança   | Proxy faz fallback para Firestore só quando claims estão **totalmente ausentes**, abrindo brecha de claims desatualizadas               |

---

## 1. Segurança

### S1 — 🔴 Queries sem isolamento de tenant no `comprovanteService`

`getByTransactionId` (linha ~136) e `findByHash` (linha ~291) consultam a coleção inteira:

```ts
// getByTransactionId — NÃO filtra companyId
where("transactionId", "==", transactionId);
// findByHash — filtra companyId ✓, mas array-contains em getByTransactionId não
where("transactionIds", "array-contains", transactionId);
```

`getByTransactionId` não inclui `where("companyId", "==", ...)`. A proteção real vem das regras do Firestore (`allow read: hasCompanyRole(...)`), o que significa que um usuário só lê documentos da empresa dele — mas:

1. A query **lê do servidor documentos que serão negados**, gerando `permission-denied` silencioso e podendo retornar `null` mesmo havendo match legítimo (se o índice cruzar empresas).
2. É frágil: qualquer afrouxamento futuro das regras vira vazamento cross-tenant.

**Recomendação:** sempre passar `companyId` e adicioná-lo ao `where`. O `getByTransactionId` deve receber `companyId` como parâmetro obrigatório (CLAUDE.md: _"Filter every Firestore query by companyId"_).

### S2 — 🟠 Fallback de autorização do proxy tem brecha de claims stale

Em `storage-proxy/route.ts` (linhas 56-78):

```ts
let hasAccess = claimsRole === "admin" || (claimsCompanyRoles != null && companyId in claimsCompanyRoles);

// fallback SÓ se claims totalmente ausentes
if (!hasAccess && !claimsCompanyRoles && !claimsRole) { ... consulta Firestore ... }
```

O fallback ao Firestore só dispara quando **não há nenhuma claim**. Cenário problemático: usuário foi **adicionado a uma nova empresa** mas o ID token ainda tem `companyRoles` antigo (claims presentes, porém desatualizadas). Como `claimsCompanyRoles != null`, o fallback nunca roda e o acesso legítimo é **negado** — e o inverso (usuário removido de empresa mas com claim antiga) **concede** acesso indevido até o token renovar.

**Recomendação:** quando `hasAccess` for `false`, sempre fazer o fallback ao Firestore (não condicionar à ausência de claims). O custo de uma leitura é baixo e só ocorre no caminho de negação.

### S3 — 🟡 `Content-Disposition` com nome de arquivo não sanitizado

Linha 105 do proxy:

```ts
"Content-Disposition": `attachment; filename="${storagePath.split("/").pop()}"`
```

O nome vem de `storagePath`, que embora validado por prefixo (`comprovantes/`), pode conter caracteres que quebram o header (aspas, CR/LF). Embora os nomes sejam gerados via `uuidv4()`, é boa prática sanitizar/escapar ou usar `filename*=UTF-8''...`.

### S4 — 🟡 `extractedText` (OCR bruto) trafega e é armazenado integralmente

`UploadComprovanteDialog` salva `extractedText: text` no documento (linha 187). Comprovantes de pagamento contêm CPF/CNPJ, conta bancária, valores. Esse texto:

- Vai para o Firestore sem redação;
- É usado em `filtered` na busca client-side (ok), mas trafega inteiro a cada `getPaginated`.

**Recomendação:** avaliar truncar/normalizar o texto salvo, ou armazenar só os tokens necessários para busca. Reduz exposição de PII e payload de rede (ver P3).

---

## 2. Correção (bugs)

### C1 — 🔴 Busca e filtro de data operam só sobre os itens já carregados

Na página, `statusFilter` é server-side (passado ao `getPaginated`), mas **busca textual e intervalo de datas são client-side** sobre `items` (linhas 559-624):

```ts
const filtered = useMemo(() => (debouncedSearch ? items.filter(...) : items).filter(dateRange...).sort(...), [...])
```

Consequências:

- O usuário busca "Fornecedor X"; se ele estiver na página 3 (ainda não carregada), **não aparece** — parece que não existe.
- O `defaultDateRange` é **últimos 7 dias**, mas a query do servidor **não** filtra por data (`getPaginated` aceita `startDate`/`endDate` por `createdAt`, mas a página **não os passa**). Então a primeira página vem ordenada por `createdAt desc` e é recortada client-side — itens fora dos 7 dias ocupam slots da página e somem, dando contagem instável (`{filtered.length}+`).
- O sentinel de scroll infinito é **desabilitado quando há busca** (linha 627), então a busca nunca carrega além do que já está em memória — coerente com a limitação, mas confirma que a busca é incompleta por design.

**Recomendação:**

1. Passar `startDate`/`endDate` ao `getPaginated` (já suportado pelo service) para que o filtro de data seja server-side e a paginação respeite o período.
2. Para busca textual, ou (a) adotar um índice de busca (campo `searchTokens` array no documento + `array-contains`), ou (b) deixar explícito na UI que a busca cobre apenas os resultados carregados.

### C2 — 🟠 Cards de estatística não refletem os filtros ativos

`getStats` (service, linha 165) conta a coleção inteira por `companyId`, sem aplicar `matchStatus`/data. A tabela abaixo está filtrada, mas o card "Total: 1.240" mostra tudo. Para o usuário, os números não batem com a lista visível.

**Recomendação:** ou rotular os cards como "totais gerais" (deixar claro que são independentes do filtro), ou recomputar stats com os mesmos filtros. `getCountFromServer` por filtro já é usado — basta encadear os `where`.

### C3 — 🟠 Upload sem atomicidade nem rollback

`processFile` (UploadComprovanteDialog) faz, por página, em sequência: hash → upload Storage → `getDownloadURL` → `comprovanteService.create`. Se o `create` falhar **após** o `uploadBytes`, fica um **PDF órfão no Storage**. Se o loop quebrar no meio, ficam N comprovantes salvos e M não — sem feedback de quais.

Além disso, `findByHash` é chamado **uma vez por página dentro do loop** (N round-trips sequenciais ao Firestore) — lento para PDFs grandes (ver P2).

**Recomendação:**

- Envolver erros por página em try/catch individual, acumulando falhas e reportando ("3 de 10 páginas falharam") em vez de abortar tudo.
- Em caso de falha no `create`, deletar o objeto recém-enviado ao Storage (`deleteObject`).
- Considerar mover o pipeline pesado (split/OCR/match/upload) para uma Cloud Function, deixando o cliente só enviar o PDF original.

### C4 — 🟠 Auto-confirmação de matches HIGH sem trilha de auditoria

`decision: best?.confidenceLevel === "HIGH" ? "confirm" : null` (linha 203) pré-marca matches de alta confiança, e `confirmMatch` grava em `transactions` (`comprovanteId`, `comprovanteUrl`) sem registrar em `audit_logs`. As demais ações financeiras do app passam por `auditService`. Associar comprovante a uma transação **paga** é um evento auditável.

**Recomendação:** registrar confirmar/rejeitar/remover associação no `auditService`.

### C5 — 🟡 `removeMatch` não recalcula `matchStatus` para `rejected_match` vs `unmatched`

`removeMatch` sempre seta `unmatched`. Se o comprovante tinha vindo de `rejected_match` e foi re-associado manualmente, remover volta para `unmatched` — perdendo o histórico de que já fora rejeitado. Menor, mas vale alinhar a máquina de estados.

### C6 — 🟡 `confirmMatch` não limpa `suggestedTransactionId(s)`

Após confirmar, os campos `suggestedTransactionId`/`suggestedTransactionIds` permanecem no documento. Não quebra nada hoje, mas polui o doc e pode confundir lógicas futuras que olham `suggested*`.

### C7 — 🟡 Race no índice de transações (`txMap`)

Na página, o `useEffect` que busca transações (linhas 531-556) adiciona IDs a `fetchedTxIds` **antes** do fetch resolver. Se o fetch falhar (`.catch(console.error)`), os IDs ficam marcados como "buscados" e **nunca** são re-tentados — a transação fica `—` para sempre até refresh manual. Marque como buscado só no sucesso, ou remova do set no catch.

---

## 3. Performance

### P1 — 🟠 `getAll({type:'payable'})` carrega todas as transações

Tanto `UploadComprovanteDialog` (linha 111) quanto `MatchReviewDialog` (linha 91) chamam `transactionService.getAll({companyId, type:'payable'})` e filtram client-side por `status in (paid, authorized)`. Em empresas com milhares de transações, isso:

- Baixa todos os documentos de pagáveis (não só os candidatos);
- Refaz a busca **toda vez que o dialog abre** (MatchReviewDialog, no `useEffect` por `open`).

**Recomendação:**

- Filtrar por status no servidor: `getAll({companyId, type:'payable', status:'paid'})` + `'authorized'` (duas queries ou `in`), em vez de baixar tudo.
- Cachear os candidatos via React Query (chave por empresa) para reaproveitar entre upload e review.

### P2 — 🟠 `findByHash` em loop sequencial no upload

No pior caso, um PDF de 50 páginas faz 50 leituras sequenciais ao Firestore só para dedupe, intercaladas com upload e OCR. Latência acumulada alta.

**Recomendação:** computar todos os hashes primeiro e fazer uma única consulta `where("fileHash", "in", [...])` (lotes de 30, limite do `in`) para detectar duplicados de uma vez.

### P3 — 🟡 `extractedText` infla o payload de cada página

`getPaginated` retorna o documento completo, incluindo `extractedText` (texto OCR potencialmente grande × 25 itens/página). Esse campo só é usado na busca client-side. Considerar não trazê-lo na listagem (projeção não existe no Firestore client SDK, mas pode-se mover o texto para uma subcoleção/doc separado consultado sob demanda).

### P4 — 🟡 `useAnimatedValue` roda RAF por StatCell

Quatro `StatCell` rodam `requestAnimationFrame` independentes a cada mudança de `stats`. Custo pequeno, mas a animação dispara também em refetches silenciosos (a cada 60s de `staleTime` + refresh manual). Aceitável; só sinalizo como micro-otimização (respeitar `prefers-reduced-motion`).

### P5 — 🟡 `filtered` reordena/refiltra todo o array a cada keystroke indireto

O `useMemo` de `filtered` depende de `txMap`, que muda a cada lote de transações resolvidas — recomputando sort+filter do array inteiro. Para listas grandes carregadas via scroll infinito, isso cresce. Mitigável estabilizando dependências, mas só relevante acima de algumas centenas de itens em memória.

---

## 4. UI / UX

### U1 — 🟠 Botão "Aplicar" do sheet mobile é decorativo

No sheet de filtros mobile (linha 1538), "Aplicar" só fecha o sheet e mostra `toast.success("Filtros aplicados")` — mas os filtros já estão aplicados em tempo real via `onChange` dos selects/inputs. O toast sugere uma ação que não ocorreu (filtro já estava ativo). Confunde.

**Recomendação:** ou remover o toast (fechar é suficiente), ou tornar o sheet realmente "draft" (estado local aplicado só no Aplicar).

### U2 — 🟠 Inconsistência: desktop baixa via `storageUrl`, mobile/share via proxy

- Desktop "Baixar" e MatchReviewDialog usam `c.storageUrl` direto (URL pública assinada do Firebase).
- `handleShare` usa o **proxy autenticado** (`/api/internal/storage-proxy`).

Ou seja, o download direto **não passa pelo RBAC do proxy** — qualquer pessoa com a `storageUrl` (que é um download token de longa duração) acessa o arquivo sem autenticação. Isso é tanto UX quanto **segurança**: links de comprovante podem vazar. Padronizar tudo no proxy fecha a brecha.

### U3 — 🟡 Filtro de data padrão (7 dias) é silencioso

A página abre filtrando os **últimos 7 dias** por padrão (client-side), mas não há indicação visível no desktop de que um filtro de data está ativo (o chip só aparece no mobile, e `isDateRangeDefault` esconde o padrão). Usuário pode achar que "só existem N comprovantes" quando há mais fora da janela. Mostrar o período ativo no header desktop ou tornar o default "todos".

### U4 — 🟡 `iframe src={storageUrl}` para preview de PDF

No MatchReviewDialog o preview usa `<iframe src={pdfUrl}>`. Em alguns navegadores/mobile o PDF baixa em vez de renderizar, e depende do download token. Considerar `<object>`/PDF.js, e usar o proxy para consistência de auth.

### U5 — 🟡 Mensagem de erro pede "verifique o console"

Linha 1141: _"Verifique o console para mais detalhes"_ é texto técnico exposto ao usuário final. Trocar por mensagem amigável + botão "Tentar novamente" (chamando `refresh()`).

### U6 — 🟡 Acessibilidade

- Headers de ordenação são `<button>` ✓, mas falta `aria-sort` no `<th>`.
- A dica "← deslize para revisar" só existe em mobile e some sem alternativa por teclado.
- O `iframe` do PDF tem `title` ✓.
- Cards de stat: o número animado muda rápido; sem `aria-live` o leitor de tela pode anunciar valores intermediários. Marcar como `aria-hidden` durante a animação e expor o valor final.

### U7 — 🟢 Pontos positivos a preservar

- Skeletons distintos para desktop/mobile.
- Swipe-to-review e área de toque 44×44 no mobile.
- Chips de filtro com remoção individual.
- Dedupe por hash com feedback claro (`toast.info`/`warning`).
- Confirmação destrutiva via `ConfirmDialog` para remover associação.

---

## 5. Plano de ação priorizado

**Fazer primeiro (correção + segurança):**

1. **C1** — Mover filtro de data para o servidor (`startDate`/`endDate` em `getPaginated`) e decidir estratégia de busca textual (índice ou aviso de escopo).
2. **S1** — Adicionar `companyId` em `getByTransactionId`; garantir filtro de tenant em todas as queries do service.
3. **U2 / S** — Padronizar download/preview pelo proxy autenticado; parar de expor `storageUrl` público.
4. **S2** — Corrigir o fallback de autorização do proxy para sempre consultar o Firestore quando o acesso por claim falhar.

**Em seguida (robustez + performance):**

5. **C3** — Tornar o upload resiliente (try/catch por página, rollback de Storage em falha).
6. **P1 / P2** — Filtrar candidatos por status no servidor + cache React Query; dedupe em lote (`in`).
7. **C2** — Alinhar stats aos filtros (ou rotular como totais).
8. **C4** — Auditar confirmar/rejeitar/remover via `auditService`.

**Polimento:**

9. C5, C6, C7 — Ajustes de máquina de estados e race do `txMap`.
10. U1, U3, U5, U6 — Limpeza de UX e acessibilidade.
11. P3, P4, P5, S3, S4 — Otimizações finas e redução de PII no payload.

---

_Relatório gerado a partir de análise estática do código. Recomenda-se validar C1, C2 e U2/S em ambiente de teste antes de qualquer refactor, por impactarem comportamento observável e isolamento de dados._
