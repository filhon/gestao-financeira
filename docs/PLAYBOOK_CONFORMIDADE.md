# Conformidade — o que falta para padrão de mercado

Levantamento feito em 31/10/2026, junto com o Manual de operação (`/manual`).
Régua usada: controles internos (COSO — segregação de funções, autorização,
trilha de auditoria, conciliação), ITG 2002 (R1) para entidades sem fins
lucrativos, prazos de guarda do CTN (arts. 173, 174 e 195) e o que ERPs e
sistemas de contas a pagar estabelecidos fazem (Omie, Conta Azul, NetSuite,
QuickBooks, Bill.com, Ramp).

Enquanto um item não for implementado, o Manual traz a **regra manual** que o
substitui (capítulo "Limites conhecidos"). Ao implementar, atualizar o Manual
(`src/lib/playbook.ts`) junto.

Legenda: **P0** compromete a integridade do dinheiro ou do controle ·
**P1** exigido por auditoria/mercado · **P2** maturidade.

---

## P0 — integridade e controle

### 1. Lançamento pago ou conciliado pode ser excluído

- **Onde:** `firestore.rules` — `transactions` → `allow delete: if canWrite()`.
  `canWrite()` inclui aprovador, pagador e o `user` dono. `transactionService.delete`
  não confere status.
- **Risco:** um pagamento que saiu do banco some do sistema; o saldo
  (`company_stats`) e o razão do centro de custo voltam como se nada tivesse
  saído; a conciliação perde o par. Só o log de auditoria guarda o que era.
- **Mercado:** título baixado não se exclui — estorna-se (desfaz a baixa com
  motivo) e depois cancela-se.
- **Ajuste:** rules e serviço só permitem excluir `draft`, `pending_approval` e
  `rejected`, sem `batchId`, sem `reconciled` e sem `comprovanteId`. Fora disso,
  o caminho é desfazer a baixa (já existe) e rejeitar com motivo.

### 2. Não há máquina de estados no lançamento

- **Onde:** `functions/src/transactionLedger.ts` → `setTransactionStatus` e
  `STATUS_ROLES`; rules `statusChangeAllowed()`.
- **Risco:** o callable aceita qualquer destino que o papel permita, vindo de
  qualquer origem. O pagador consegue levar um **rascunho direto a pago**
  (com `settlement`), pulando a aprovação. O gestor também.
- **Ajuste:** tabela de transições permitidas (`draft → pending_approval →
approved → paid`; `pending_approval → rejected | draft`; `rejected → draft`;
  `paid → approved` só como estorno), checada no callable e espelhada nas rules.
  Exceção explícita: lançamento direto do extrato (tarifa/IOF), que já nasce
  pago só para admin/gestor (`assertInitialStatus`).

### 3. Sem segregação de funções no lançamento avulso

- **Onde:** `setTransactionStatus` não compara `createdBy` com quem aprova, nem
  `approvedBy` com quem paga. Nos lotes isso já é imposto
  (`canActOnBatch`, `sendForApproval`).
- **Risco:** o gestor lança, aprova e paga a própria despesa — a fraude
  clássica de contas a pagar.
- **Ajuste:** recusar `approved` quando `auth.uid == createdBy` e `paid` quando
  `auth.uid == approvedBy`. Para equipes de uma pessoa, uma configuração da
  empresa "equipe reduzida" que libera, mas grava o motivo no log e marca o
  lançamento (o auditor filtra).

### 4. "Baixar pelo extrato" nunca acha despesa

- **Onde:** `src/components/features/finance/reconciliation/SettleFromStatementSheet.tsx`
  — `PAYABLE_STATUSES = ["authorized"]`.
- **Fato:** nenhum fluxo grava `authorized` na transação. O fluxo avulso vai de
  `approved` a `paid`; a autorização do lote muda só o documento do lote
  (`confirmAuthorization`, `/api/internal/batch-authorization`).
- **Ajuste (escolher um):** aceitar `["approved", "authorized"]`, ou gravar
  `authorized` nas transações quando o lote é autorizado. O segundo deixa o
  status da transação dizer a verdade sobre o lote.

### 5. Fechamento não trava o período

- **Onde:** `bank_accounts.closings` registra o fechamento da conciliação, mas
  nada impede editar valor, data de pagamento, desfazer baixa ou excluir um
  lançamento com data dentro do período fechado.
- **Mercado:** "lock date" (Xero, QuickBooks, NetSuite) — depois de fechado, só
  reabrindo, e a reabertura fica no log.
- **Ajuste:** `companies.lockedThrough` (data) gravado ao fechar o mês;
  `commitValidatedPatch`, `setTransactionStatus`, `updateBatch` e rules recusam
  mudança em lançamento com `paymentDate`/`dueDate` ≤ trava. Reabrir só
  admin/gestor, com motivo.

---

## P1 — exigências de auditoria e mercado

### 6. Log de auditoria gravado pelo navegador

- `auditService.log` roda no cliente depois da operação. Se a aba fecha ou a
  chamada falha, a operação fica sem log. Pendência antiga: trigger no servidor
  bloqueado porque transações não têm `updatedBy`.
- **Ajuste:** todo callable passa a gravar `updatedBy`; um trigger
  `onWrite` gera o log a partir do antes/depois. O log do cliente vira só
  complemento (motivo, contexto de tela).

### 7. Relatório de Despesas (RD) é paralelo às despesas

- Aprovar ou marcar o RD como pago (`reimbursementReportService.approve/markAsPaid`)
  não mexe nas despesas que ele agrupa, não grava log de auditoria e não exige
  que quem aprova seja diferente de quem montou. As rules deixam aprovador e
  pagador alterarem qualquer campo do RD.
- **Ajuste:** status do RD derivado das despesas (pago = todas pagas);
  `auditService.log` nas transições; aprovador ≠ criador; rules restringindo
  campos por transição.

### 8. Reverter lote pago deixa data de pagamento

- `paymentBatchService.revertToOpen` volta as transações para rascunho direto
  pelo SDK e não limpa `paymentDate`/`bankAccountId`. Deve passar pelo
  `updateBatch` (callable), como a confirmação.

### 9. Sem autenticação em dois fatores

- Login por Google ou e-mail/senha, sem MFA. Para quem aprova, paga ou
  administra, o mercado trata 2FA como obrigatório.
- **Ajuste:** Firebase Auth TOTP (Identity Platform), obrigatório para
  admin/gestor/aprovador/pagador.

### 10. Retenções na fonte não são calculadas

- IRRF, PIS/COFINS/CSLL (4,65%), ISS e INSS de serviços tomados. O cadastro da
  entidade já guarda os percentuais, mas o lançamento não desconta nem gera a
  guia. Pendência registrada desde o redesenho do formulário.

### 11. Obrigatoriedade do plano de contas só no navegador

- `chartOfAccountsRequiredFrom` é conferido no formulário, na recorrência e na
  importação, não no servidor. Os callables aceitam despesa sem `accountId`.

### 12. Recursos vinculados (ITG 2002) sem marcação própria

- A ITG 2002 (R1) pede que doações, subvenções e convênios com aplicação
  específica fiquem em contas próprias, segregadas, e que gratuidades sejam
  evidenciadas. Hoje a segregação depende de o usuário criar centro de custo ou
  conta para cada projeto.
- **Ajuste:** campo "origem do recurso" (livre / vinculado a projeto ou
  convênio) na receita, saldo por projeto e relatório de prestação de contas.

### 13. Sem livro diário nem exportação para a contabilidade

- O sistema é gerencial (regime de caixa + DRE por competência), sem partidas
  dobradas, balanço ou livro diário (ITG 2000). A escrituração oficial fica
  com o contador — o que é normal — mas não há exportação de lançamentos no
  layout de importação dos sistemas contábeis.
- **Ajuste:** exportação mensal com conta débito/crédito (de-para plano
  gerencial → plano do contador), histórico e documento.

### 14. Política de guarda e de backup não declarada

- Guarda mínima de documentos fiscais: 5 anos contados do 1º dia do exercício
  seguinte (CTN 173); livros e base dos lançamentos, recomendável guarda
  permanente. Não há no repositório evidência de PITR nem de export agendado
  do Firestore, e excluir um lançamento não preserva o anexo.
- **Ajuste:** ativar PITR e export diário para bucket com retenção; exclusão
  lógica (soft delete) de lançamentos e anexos.

### 15. Evidência do fechamento da conciliação

- Falta o relatório de conciliação exportável (saldo do extrato × sistema,
  itens em aberto, quem fechou e quando). `closedBy` grava uid, sem nome.

### 16. Alçada de 85% não vale na aprovação de lote

- `assertWithinAlcada` roda no `setTransactionStatus` e no magic link
  avulso, mas o lote grava `approved` direto pelo SDK.

### 17. Conta bancária na baixa em lote

- Baixa em lote e `confirmPayments` não gravam `bankAccountId`, então a
  conciliação não sabe por qual conta saiu.

---

## P2 — maturidade

- Remessa bancária (CNAB 240 / Pix em lote) e retorno; DDA.
- Open Finance (Pluggy) para extrato e aplicações automáticos.
- Comprovante por e-mail (Resend Inbound).
- Juros/multa/desconto já na criação; parcelamento começando em k/N.
- Rendimento de aplicação lançado bruto + despesa de IR/IOF (2026 foi
  registrado líquido por falta de conta de despesa de IR).
- Solicitação de acesso: o próprio usuário escolhe o papel ao pedir acesso; o
  administrador precisa conferir antes de aprovar. Mostrar alerta quando o
  papel pedido for de aprovação/pagamento.
- Usuário em duas empresas vota duas vezes no roadmap.

## Fontes

- CFC — Entidades sem Finalidade de Lucros (ITG 2002): https://cfc.org.br/tecnica/perguntas-frequentes/entidades-sem-finalidade-de-lucros/
- ITG 2002 (R1): https://www.normaslegais.com.br/legislacao/norma-brasileira-contabilidade-nbc-itg-2002-r1.htm
- Prazo de guarda de documentos: https://blog.econeteditora.com.br/padronizado-prazo-de-guarda/
- Segregação de funções e trilha de auditoria: https://cursa.app/pt/pagina/controles-financeiros-e-segregacao-de-funcoes-contra-fraude-interna-e-externa
- Controles internos para pequenas organizações: https://beancount.io/pt/blog/2026/03/18/internal-controls-small-business-prevent-fraud-errors
