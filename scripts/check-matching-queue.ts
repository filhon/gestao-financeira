/**
 * Verificação da fila de sugestões e da prova cruzada extrato × comprovante.
 *   npm run check:matching-queue
 * Falha com exceção no primeiro cenário quebrado.
 */
import assert from "node:assert/strict";
import {
  accuracyByBand,
  distributeSuggestions,
  receiptFeedback,
} from "../src/lib/matching/queue";
import { matchComprovante } from "../src/lib/matching";
import { matchStatement } from "../src/lib/matching/statement";
import type { BankTransaction, Entity, Transaction } from "../src/lib/types";

const paidOn = new Date("2026-05-29T12:00:00-03:00");
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    id,
    companyId: "c1",
    description: "Oferta projeto",
    amount: 1000,
    type: "payable",
    status: "paid",
    entityId: "x",
    supplierOrClient: "Missão Xingu",
    paymentDate: paidOn,
    dueDate: paidOn,
    createdBy: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  }) as Transaction;
const xingu = {
  id: "x",
  companyId: "c1",
  name: "Missão Xingu",
  document: "11.222.333/0001-81",
  type: "company",
  category: "supplier",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Entity;

// 1. Três comprovantes iguais disputando a mesma conta: a mais forte fica,
// as outras são casadas de novo com o que sobrou; sem opção, a disputa fica.
{
  const queue = [
    { id: "c1", ids: ["t1"], score: 80 },
    { id: "c2", ids: ["t1"], score: 90 },
    { id: "c3", ids: ["t1"], score: 70 },
  ];
  const spare = ["t2"];
  const changed = distributeSuggestions(queue, new Set(), (_, used) => {
    const free = spare.find((id) => !used.has(id));
    return free ? { ids: [free] } : null;
  });
  assert.equal(changed.has("c2"), false, "a mais forte não muda");
  assert.deepEqual(changed.get("c1"), { ids: ["t2"] });
  assert.equal(changed.get("c3"), null);

  // Conta com comprovante confirmado já está tomada.
  const taken = distributeSuggestions(
    [{ id: "c4", ids: ["t9"], score: 95 }],
    new Set(["t9"]),
    () => null,
  );
  assert.equal(taken.get("c4"), null);
}

// 2. Acerto por faixa.
{
  const rows = accuracyByBand(
    [
      { score: 95, outcome: "accepted" },
      { score: 92, outcome: "undone" },
      { score: 75, outcome: "changed" },
      { score: 40, outcome: "rejected" },
    ],
    [90, 70, 0],
  );
  assert.deepEqual(
    rows.map((r) => [r.min, r.max, r.total, r.accepted]),
    [
      [90, 100, 2, 1],
      [70, 89, 1, 0],
      [0, 69, 1, 0],
    ],
  );
  assert.equal(rows[0].rate, 0.5);
}

// 3. Desfecho de um comprovante: automático não conta; recusa conta.
{
  const base = { matchConfidence: 88, suggestedTransactionIds: ["a", "b"] };
  assert.equal(
    receiptFeedback({
      ...base,
      matchStatus: "matched",
      transactionIds: ["b", "a"],
    })?.outcome,
    "accepted",
  );
  assert.equal(
    receiptFeedback({ ...base, matchStatus: "matched", transactionIds: ["c"] })
      ?.outcome,
    "changed",
  );
  assert.equal(
    receiptFeedback({ ...base, matchStatus: "matched", reviewedBy: "auto" }),
    null,
  );
  assert.equal(
    receiptFeedback({
      matchStatus: "rejected_match",
      matchConfidence: 60,
      suggestedTransactionIds: null,
    })?.outcome,
    "rejected",
  );
}

// 4. Extrato → comprovante: entre duas contas iguais, a que o extrato já
// provou paga naquele dia vence.
{
  const receipt = `Comprovante de transferência PIX
Data do pagamento: 29/05/2026
Valor: R$ 1.000,00
Recebedor: MISSAO XINGU`;
  const out = matchComprovante(
    receipt,
    [tx("t1"), tx("t2", { reconciled: true })],
    { entities: [xingu] },
  );
  assert.equal(out.best?.transactionId, "t2");
  assert.ok(
    out.best?.reasons.includes("Pagamento conferido no extrato bancário"),
  );
}

// 5. Comprovante → extrato: a conta com comprovante confirmado sobe.
{
  const line: BankTransaction = {
    id: "l1",
    date: paidOn,
    amount: -1000,
    description: "PAGAMENTOS A FORNECEDORES MISSAO XINGU",
    type: "debit",
    status: "unmatched",
  };
  const [plain] = matchStatement([line], [tx("t1")], [xingu]);
  const [proven] = matchStatement(
    [line],
    [tx("t1", { comprovanteId: "c1" })],
    [xingu],
  );
  assert.equal(proven.confidence, Math.min(100, plain.confidence! + 5));
  assert.ok(
    proven.matchCandidates?.[0].reasons.includes("Comprovante confirmado"),
  );
}

console.log("check:matching-queue ok");
