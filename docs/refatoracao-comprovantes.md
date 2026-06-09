# Refatoração da Feature de Comprovantes — Análise Completa

**Data:** 2026-06-09
**Escopo:** toda a feature de comprovantes (upload, matching, revisão, listagem, proxy, regras, tipos).
**Método:** leitura estática de todo o ecossistema + crítica de design via skill `impeccable` (register `product`, conforme `PRODUCT.md`).

> Esta análise substitui e atualiza `docs/analise-comprovantes.md` (2026-06-08). Muitos itens daquele relatório **já foram corrigidos** — ver a seção [O que já foi consertado](#0-o-que-já-foi-consertado). O foco aqui é o que ainda está errado e a decisão arquitetural de fundo.

**Arquivos cobertos:**

- `src/app/(dashboard)/financeiro/comprovantes/page.tsx`
- `src/components/features/finance/comprovantes/UploadComprovanteDialog.tsx`
- `src/components/features/finance/comprovantes/MatchReviewDialog.tsx`
- `src/components/features/finance/comprovantes/{ComprovanteStatusBadge,ConfidenceBadge}.tsx`
- `src/lib/services/comprovanteService.ts`
- `src/lib/matchingAlgorithm.ts`
- `src/lib/pdfUtils.ts` (split + extração de texto)
- `src/app/api/internal/storage-proxy/route.ts`
- `src/components/features/finance/TransactionDetailsDialog.tsx` (consumidor)
- `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `src/lib/types/index.ts`

---

## Sumário executivo

A feature está **bem construída na mecânica**: paginação por cursor, dedup por hash SHA-256 em lote, matching consolidado (soma de transações do mesmo fornecedor no mesmo dia), RBAC nas regras, proxy de Storage autenticado e índices compostos cobrindo as queries. A análise anterior produziu correções reais e a maioria pegou.

Porém, três problemas **estruturais** continuam de pé e justificam a sensação de que "não fizemos isso certo":

| #      | Severidade               | Eixo                 | Problema central                                                                                                                                                                                                                                       |
| ------ | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A1** | 🔴 Arquitetura/Segurança | Confiança do dado    | Todo o pipeline (extração de texto, matching, score, `matchedAmount`) roda **no cliente**. Em um sistema financeiro, o vínculo "comprovante ↔ pagamento" é asserção do browser, sem verificação server-side e **sem trilha de auditoria**.            |
| **A2** | 🔴 Produto               | Premissa do matching | A "extração" é leitura da **camada de texto do PDF**, não OCR. Comprovantes que são **scan/foto** (caso comum no Brasil) extraem texto vazio e **nunca dão match**. Imagens (JPG/PNG) sequer são aceitas.                                              |
| **A3** | 🔴 Segurança             | Vazamento de PII     | O `storageUrl` (download token público e perene do Firebase) é renderizado direto em `<a>`/`<iframe>` e **gravado na transação**. O proxy RBAC existe mas só é usado no "Enviar". As regras de leitura do Storage ficam **inertes** para esse caminho. |

Abaixo, o detalhamento por eixo, com o que está certo, o que está errado e a prioridade.

---

## 0. O que já foi consertado

Para não retrabalhar, registro o que o relatório anterior apontou e que **hoje está resolvido** no código:

- **Isolamento de tenant em `getByTransactionId`** — agora filtra `where("companyId", "==", companyId)` nas duas queries (`comprovanteService.ts:183-213`). ✅
- **Filtro de data e busca server-side** — `getPaginated` recebe `startDate`/`endDate`/`searchText` e a página os passa de fato (`page.tsx:510-523`). Existe índice `searchTokens` (`array-contains`). ✅ (com ressalva, ver C3)
- **Candidatos filtrados por status no servidor** — upload e review usam `getAll({ statuses: ["paid","authorized"] })` em vez de baixar tudo (`UploadComprovanteDialog.tsx:116`, `MatchReviewDialog.tsx:92`). ✅
- **Dedup em lote** — `findExistingHashes` com `where("fileHash","in",chunk)` em lotes de 30, hashes computados antes do loop (`comprovanteService.ts:379`, `UploadComprovanteDialog.tsx:124-148`). ✅
- **Rollback de Storage no upload** — falha no `create` do Firestore dispara `deleteObject` do objeto órfão; falhas por página são acumuladas e reportadas, sem abortar tudo (`UploadComprovanteDialog.tsx:183-233`). ✅
- **Fallback de claims do proxy** — agora cai para o Firestore sempre que o acesso por claim falha, cobrindo claims ausentes **e** desatualizadas (`storage-proxy/route.ts:60-78`). ✅
- **`confirmMatch` limpa `suggested*`** e **race do `txMap`** (IDs marcados só no sucesso) — ambos resolvidos (`comprovanteService.ts:275-279`, `page.tsx:550-560`). ✅

Bom trabalho. O que sobra é mais profundo.

---

## 1. Arquitetura (a decisão de fundo)

### A1 — 🔴 Pipeline e matching client-side, sem verificação nem auditoria

Hoje, em `UploadComprovanteDialog.processFile`, o browser faz: split do PDF → extração de texto → `matchTransactions` → score/`matchedAmount`/`confidenceLevel` → upload → `comprovanteService.create` gravando **todos esses campos derivados**. A regra do Firestore (`firestore.rules:299-303`) só valida `isManager(companyId)`; não valida integridade de campo.

Consequências:

1. **Confiança do dado.** `matchConfidence`, `matchedAmount`, `extractedText`, `matchStatus` são 100% asseridos pelo cliente. Um manager (ou um cliente comprometido) pode gravar um comprovante "Associado · 100%" a uma transação paga que nada tem a ver. Num sistema que depois usa isso como prova de pagamento, essa é a fragilidade central.
2. **Sem trilha de auditoria.** `confirmMatch`/`rejectMatch`/`removeMatch` escrevem em `transactions` (incluindo um pagamento já liquidado) **sem registrar em `audit_logs`**, ao contrário do resto do app. Associar um comprovante a um pagamento autorizado é um evento auditável.
3. **Robustez.** Um PDF de 50 páginas processa tudo no loop do browser com a modal aberta. Fechar a aba no meio deixa o lote parcial. O rollback cobre Storage↔Firestore por página, mas não o lote como unidade.

**Recomendação (a refatoração de verdade):**

- Mover o pipeline pesado para uma **Cloud Function disparada por upload no Storage** (ou um endpoint server-side). O cliente envia só o PDF original; o servidor faz split, extração, match, dedup e `create`. Assim os campos derivados nascem **confiáveis** (server-authored), e a regra do Firestore pode bloquear escrita client-side desses campos (como já faz com `payment_batches`: `allow write: if false` no client).
- Registrar confirmar/rejeitar/remover em `auditService` com `{ comprovanteId, transactionIds, actor, before/after }`.
- Tornar a confirmação automática de matches `HIGH` (`decision: best?.confidenceLevel === "HIGH" ? "confirm"` em `UploadComprovanteDialog.tsx:224`) uma decisão **server-side verificável**, não um pré-check do browser.

Isto é trabalho real, mas é o que separa "funciona na demo" de "confiável para auditoria fiscal".

---

## 2. Produto / Matching

### A2 — 🔴 "Extração de texto" não é OCR; scans e fotos não dão match

`extractTextFromPdf` (via `pdfUtils`) lê a **camada de texto** do PDF. Comprovantes de internet banking gerados como PDF digital têm essa camada; mas uma fração grande dos comprovantes reais no Brasil é **foto/scan** (print de app, recibo fotografado). Nesses, a extração retorna vazio ou ruído → `matchTransactions` não acha valor/data → `matchStatus: "unmatched"` sempre. Pior: a UI não distingue "não casou" de "não consegui ler o arquivo", então o operador não entende por que aquele comprovante legítimo "não tem sugestão".

Além disso, o upload aceita **apenas PDF** (`UploadComprovanteDialog.tsx:98`, `accept="application/pdf"`). Quem fotografa o comprovante no celular não consegue enviar.

**Recomendação:**

- Integrar OCR de verdade no pipeline server-side (A1) — há `Google GenAI` já no stack (CLAUDE.md cita "document extraction"). Usar visão/OCR para imagens e PDFs sem camada de texto.
- Aceitar `image/*` além de PDF; normalizar tudo para o mesmo fluxo de extração.
- Quando a extração vier vazia, marcar um estado distinto (ex.: `needs_manual` / "não foi possível ler") em vez de `unmatched`, e direcionar o operador ao vínculo manual.

### C-match — 🟠 Inconsistências do algoritmo (`matchingAlgorithm.ts`)

- **Docstring mente sobre a tolerância.** O cabeçalho diz "Amount match (±2 %)" mas `amountsMatch` usa `Math.abs(a-b) < 0.01` (centavo exato, sem tolerância) — `matchingAlgorithm.ts:69-72` vs comentário em `:91`. Decidir qual é a regra e alinhar; valores de comprovante às vezes diferem por arredondamento/tarifa.
- **Primeiro valor/data que casa vence.** `textAmounts.find(...)` / `textDates.find(...)` pegam o primeiro match no texto, que pode ser um valor de tarifa ou data de emissão, não o do pagamento. Para comprovantes com vários valores, isso gera falso-positivo de score.
- **Busca textual quebra com múltiplas palavras** (ver C3, é meio matching meio service).

---

## 3. Segurança

### A3 — 🔴 `storageUrl` público vaza e ignora o RBAC do Storage

O `getDownloadURL()` do Firebase retorna uma URL com **token de download que é bearer público e perene** — ela **ignora `storage.rules`**. Hoje essa URL é:

- renderizada em `<a href={c.storageUrl} download>` no desktop e no `MatchReviewDialog` (`page.tsx:1245`, `MatchReviewDialog.tsx:260,273,287`);
- usada como `src` de `<iframe>` no preview;
- **gravada na transação** (`comprovanteService.confirmMatch` → `comprovanteUrl: storageUrl`, `:286`) e depois exibida em `TransactionDetailsDialog`.

Ou seja: as regras `storage.rules:154-165` (que exigem papel na empresa para ler) ficam **inertes** nesse caminho — qualquer um com o link lê o PDF, para sempre, sem login. E o link foi propagado para outra coleção. Comprovantes contêm CPF/CNPJ, conta bancária e valores.

Vocês **já construíram a solução** (o proxy autenticado em `storage-proxy/route.ts`), mas só a usaram no compartilhar (`handleShare`). A feature está metade-feita.

**Recomendação:**

- Rotear **toda** leitura/preview/download pelo proxy (`/api/internal/storage-proxy?path=<storagePath>`), nunca por `storageUrl`.
- Parar de gravar `storageUrl` na transação; gravar só `storagePath` e resolver via proxy on-demand.
- Considerar não armazenar `storageUrl` de jeito nenhum (só `storagePath`); a URL pública é o vetor de vazamento.

### S2 — 🟠 `extractedText` (OCR cru, com PII) salvo inteiro e trafegado em cada página

`comprovanteService.create` grava `extractedText: text` completo (`UploadComprovanteDialog.tsx:204`). O `searchText` é truncado em 1000 chars (`comprovanteService.ts:55`), mas o campo `extractedText` **não** — vai inteiro para o Firestore. E `getPaginated` retorna o documento completo, então cada listagem baixa o OCR inteiro × `pageSize`. É PII em repouso sem redação + payload inflado por item.

**Recomendação:** mover `extractedText` para um doc/subcoleção separado consultado sob demanda (o SDK client não faz projeção de campos), ou persistir só o necessário para busca. Reduz exposição e rede.

### S3 — 🟡 `Content-Disposition` com filename não sanitizado

`storage-proxy/route.ts:105` interpola `storagePath.split("/").pop()` direto no header. Hoje os nomes são `uuidv4().pdf` (seguro), mas é boa prática usar `filename*=UTF-8''...` ou sanitizar CR/LF/aspas, para o caso de o esquema de nomes mudar.

---

## 4. Correção (bugs remanescentes)

### C1 — 🟠 `getStats` ignora os filtros ativos

`getStats` conta a coleção inteira por `companyId` (`comprovanteService.ts:217-245`). A faixa de stats no topo (`page.tsx:822-854`) mostra "Total / Associados / Pendentes / Sem associação" **globais**, enquanto a tabela abaixo está filtrada por status/data/busca. Para o operador, os números não batem com a lista. (Item C2 do relatório anterior, **ainda aberto**.)

**Recomendação:** ou rotular explicitamente como "totais gerais" (independem do filtro), ou recomputar com os mesmos `where` (já se usa `getCountFromServer`, é só encadear). Decidir uma — hoje é ambíguo.

### C2 — 🟠 Sem auditoria nas ações de match

Ver A1.3. `confirmMatch`/`rejectMatch`/`removeMatch` não passam por `auditService`. (C4 anterior, **ainda aberto**.)

### C3 — 🟠 Busca textual falha com mais de uma palavra e ignora o período

Dois problemas no caminho de busca de `getPaginated` (`comprovanteService.ts:135-151`):

1. **Multi-palavra não casa.** Tokeniza-se por palavra+prefixos na escrita (`tokenize`), mas na leitura faz-se `where("searchTokens","array-contains", normalizeSearch(filters.searchText))` — a frase inteira vira **um** token com espaço (ex.: `"padaria silva"`), que nunca existe no array (que tem `"padaria"`, `"silva"`, prefixos...). Resultado: qualquer busca com espaço retorna **zero**. Usar só o primeiro/último termo, ou intersecção client-side de múltiplos `array-contains` (limite do Firestore), ou um termo único.
2. **Período é silenciosamente descartado ao buscar.** Quando há `searchText`, o código pula `startDate`/`endDate` (comentário em `:136`), mas a UI continua mostrando o chip de período ativo. O usuário acha que está buscando "no período X" e não está.

**Recomendação:** alinhar o corpus de busca (ver também: `searchText` na criação vem de `matchedEntity`+`extractedText`; no `confirmMatch` é **reescrito** só com descrição/fornecedor da transação — `comprovanteService.ts:263-266` — então depois de associar você perde a busca pelo texto do comprovante). Definir um corpus estável que una transação + entidade + OCR ao longo do ciclo de vida, e corrigir a query multi-termo.

### C4 — 🟡 `removeMatch` sempre volta para `unmatched`

`removeMatch` (`comprovanteService.ts:307-334`) seta `matchStatus: "unmatched"` independentemente do histórico. Um comprovante que era `rejected_match`, foi re-vinculado manualmente e depois teve a associação removida, perde o registro de que já fora rejeitado. Pequeno, mas a máquina de estados (`matched ↔ unmatched ↔ rejected_match ↔ pending_review`) merece um diagrama explícito e transições coerentes.

### C5 — 🟡 Ordenação client-side sobre páginas parciais

`filtered` ordena `items` no cliente (`page.tsx:564-606`), mas com scroll infinito `items` é só o que já carregou. Ordenar por "Valor" ordena os N itens em memória, não o conjunto — o "maior valor" pode estar numa página ainda não buscada. Hoje a ordenação do servidor é fixa em `createdAt desc`. Ou se assume isso na UI (indicar "ordenando resultados carregados"), ou a ordenação vira server-side (exige índices por campo + repensar o cursor).

---

## 5. Performance

- **P1 — 🟡 `extractedText` infla cada página da listagem.** Mesmo ponto de S2, sob a ótica de rede: OCR inteiro × itens/página em toda rolagem. Resolver junto com S2.
- **P2 — 🟡 Candidatos re-buscados a cada abertura da modal.** `MatchReviewDialog` refaz `getAll({statuses})` em todo `open` (`:88-98`) e o `UploadComprovanteDialog` faz o seu. São os mesmos pagáveis pagos/autorizados. Cachear via React Query (chave por empresa) reaproveita entre as duas telas e entre aberturas.
- **P3 — 🟢 RAF por `StatCell`.** Quatro animações independentes a cada refetch de stats (`useAnimatedValue`). Custo baixo; respeitar `prefers-reduced-motion` (hoje anima sempre, inclusive em refetch silencioso de 60s).

---

## 6. UI / UX / Design (lente `impeccable`, register `product`)

`PRODUCT.md` é claro: "dado em primeiro lugar", densidade intencional, confiança pelo detalhe, **nada de decoração sem informação**, e a anti-referência número 1 é "parecer feito por IA". Com essa régua:

### D1 — 🔴 Side-stripe border no card mobile (lei absoluta do impeccable)

`MobileComprovanteCard` usa `border-l-4 border-l-amber-500 / -red-500 / -emerald-500` para sinalizar status (`page.tsx:279-291`). A borda lateral colorida como acento é um **ban absoluto** do impeccable: é decoração redundante (o status **já** está no `ComprovanteStatusBadge` ao lado) e é uma das assinaturas visuais de "template de IA" — exatamente a anti-referência do produto.

**Recomendação:** remover a faixa lateral. O status já é comunicado pelo badge textual (bom para a11y, não depende de cor). Se quiser reforço visual, use o ícone do arquivo tingido pela cor funcional do status, ou nada. Borda completa de 1px no card, não faixa de 4px.

### D2 — 🟠 Vermelho de "Baixa confiança" colide com vermelho de erro

`ConfidenceBadge` pinta `LOW` de vermelho (`ConfidenceBadge.tsx:18-21`), o mesmo vermelho de `unmatched`/destrutivo. Baixa confiança **não é erro** — é uma sugestão fraca que ainda pode ser legítima. Reusar o vermelho destrutivo sobrecarrega a semântica de cor (contra o princípio "confiança pelo detalhe" e a acessibilidade de cores funcionais do `PRODUCT.md`).

**Recomendação:** escala HIGH=verde, MEDIUM=âmbar, LOW=neutro/cinza ou laranja apagado. Reservar vermelho para falha/ação destrutiva.

### D3 — 🟠 Botão "Aplicar" do sheet mobile é decorativo

No sheet de filtros (`page.tsx:1505-1510`), os filtros já se aplicam ao vivo via `onChange`; "Aplicar" apenas fecha o sheet. Sugere uma ação que não existe (não há estado "rascunho" pendente). (U1 anterior, ainda presente, agora sem o toast enganoso.)

**Recomendação:** ou renomear para "Ver resultados" / "Fechar", ou tornar o sheet realmente _draft_ (estado local commitado só no Aplicar) — o segundo é mais previsível em mobile.

### D4 — 🟠 Preview de PDF via `<iframe src={storageUrl}>`

`MatchReviewDialog.tsx:259-263`: além do problema de segurança (A3), `<iframe>` de PDF baixa em vez de renderizar em vários navegadores mobile, e depende do token. Trocar por `<object>`/PDF.js servido pelo proxy. Altura fixa de 360px é pequena para um comprovante de página inteira.

### D5 — 🟡 Não há como remover/excluir um comprovante enviado por engano

A UI só oferece "Remover associação"; excluir o documento é `allow delete: if isGlobalAdmin()` (`firestore.rules:306`) e não existe ação na interface. Um PDF errado (página em branco, arquivo trocado) fica preso para sempre na lista. Operadores financeiros precisam corrigir os próprios erros.

**Recomendação:** permitir que o manager exclua comprovantes `unmatched`/`rejected_match` (com `ConfirmDialog` + auditoria + `deleteObject` no Storage).

### D6 — 🟡 Estado vazio não convida ao primeiro uso

`page.tsx:1112-1132` distingue corretamente "nenhum resultado para o filtro" de "nenhum comprovante cadastrado" (bom). Mas o segundo caso é um ícone genérico + texto, sem CTA. É a oportunidade de onboarding: mostrar o botão "Enviar Comprovantes" como ação primária e uma linha explicando que cada página do PDF vira um comprovante.

### D7 — 🟡 Acessibilidade

- `<th>` ordenáveis sem `aria-sort` (`page.tsx:1065-1097`) — o botão existe, falta o estado no header.
- Números animados nos stats sem `aria-live`/`aria-hidden`: o leitor de tela pode anunciar valores intermediários. Expor só o valor final.
- A dica "← deslize para revisar" (`page.tsx:344-348`) só existe em mobile e não tem equivalente por teclado (mitigado pelo menu de ações; ok).

### D8 — 🟡 Copy com em dash e contagem "N+"

- `impeccable` bane em dash em copy. O título do compartilhamento usa `—` (`page.tsx:670-671`). Trocar por `·`/`:`/parênteses.
- "{filtered.length}{hasMore ? "+" : ""} resultados" (`page.tsx:864-868`) mostra "12+ resultados" — ok como heurística, mas combinado com stats globais (C1) confunde quantos itens existem de fato.

### Pontos positivos a preservar

- Faixa de stats como **um** container dividido em células, em vez de 4 cards idênticos (evita o "identical card grid" banido). 👍
- Skeletons distintos desktop/mobile; área de toque 44×44; chips de filtro removíveis individualmente.
- Dedup com feedback claro (`toast.info`/`warning`), `ConfirmDialog` para remoção destrutiva.
- `tabular-nums` e `font-financial` nos valores — alinhamento monetário correto (princípio "confiança pelo detalhe").
- Matching consolidado (soma mesmo-fornecedor/mesmo-dia) modela uma prática real brasileira — boa ideia de produto.

---

## 7. Plano de refatoração priorizado

**Fase 1 — Tapar o vazamento e a base de confiança (segurança/arquitetura):**

1. **A3** — Rotear todo download/preview pelo proxy autenticado; parar de gravar/expor `storageUrl`. (Maior risco, e a solução já existe pela metade.)
2. **A1** — Mover pipeline (split/OCR/match/dedup/create) para Cloud Function disparada no Storage; bloquear escrita client-side dos campos derivados nas regras; adicionar auditoria (cobre C2).
3. **A2** — OCR real (Google GenAI) + aceitar imagens; estado distinto para "não foi possível ler".

**Fase 2 — Correção observável:**

4. **C3** — Consertar busca multi-palavra e a relação busca×período; estabilizar o corpus de busca no ciclo de vida.
5. **C1** — Alinhar stats aos filtros ou rotulá-los como totais.
6. **C-match** — Corrigir docstring vs tolerância de valor; melhorar escolha de valor/data no texto.

**Fase 3 — Design e polimento (impeccable):**

7. **D1** — Remover side-stripe border do card mobile (lei absoluta).
8. **D2** — Recolorir confiança LOW (sair do vermelho de erro).
9. **D3, D4, D5, D6** — Sheet "draft", preview via proxy, exclusão de comprovante, estado vazio com CTA.
10. **D7, D8, S2/S3, P1-P3, C4/C5** — a11y, copy, redução de PII no payload, cache de candidatos, máquina de estados.

---

_Análise estática. Recomenda-se validar A3 (vazamento de URL), C1 (stats) e C3 (busca) em ambiente de teste antes de qualquer refactor — são os de comportamento observável e impacto de dados/segurança mais imediatos. A1/A2 são a refatoração estrutural de verdade: sem elas, a feature "funciona" mas não é confiável para fins de auditoria, que é o propósito declarado em `PRODUCT.md`._
