/**
 * Verificação das regras do fluxo de caixa, períodos e CSV dos relatórios.
 *   npm run check:reports
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  belongsTo,
  buildCashFlow,
  buildPayments,
  comparisonRange,
  DEFAULT_FORECAST,
  openingFromToday,
  projectRecurrences,
  stageOf,
  toCsv,
  variation,
} from "../src/lib/reports";
import type {
  RecurringTransactionTemplate,
  Transaction,
} from "../src/lib/types";

let n = 0;
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    id: `t${n++}`,
    type: "payable",
    status: "approved",
    dueDate: new Date(2027, 0, 10),
    amount: 0,
    ...p,
  }) as Transaction;

// Estágios: rejeitada some, lote conta como confirmado, baixa sem data é realizado.
assert.equal(stageOf(tx({ status: "rejected" })), null);
assert.equal(stageOf(tx({ status: "approved", batchId: "b1" })), "confirmed");
assert.equal(stageOf(tx({ status: "paid" })), "realized");
assert.equal(stageOf(tx({ status: "pending_approval" })), "in_approval");

const txs = [
  tx({
    type: "receivable",
    status: "paid",
    amount: 1000,
    dueDate: new Date(2026, 11, 28),
    paymentDate: new Date(2027, 0, 2),
  }),
  tx({ amount: 300, dueDate: new Date(2027, 0, 5) }),
  tx({ amount: 900, status: "rejected", dueDate: new Date(2027, 0, 5) }),
  tx({ amount: 50, status: "draft", dueDate: new Date(2027, 0, 6) }),
  tx({
    amount: 200,
    status: "authorized",
    batchAdjustedAmount: 150,
    dueDate: new Date(2027, 0, 7),
  }),
];
const jan = { start: new Date(2027, 0, 1), end: new Date(2027, 0, 31) };

const both = buildCashFlow(txs, {
  ...jan,
  opening: 100,
  stages: ["realized", ...DEFAULT_FORECAST],
  granularity: "day",
});
assert.equal(both.inflow, 1000);
assert.equal(both.outflow, 450, "rascunho fora, rejeitada fora, valor do lote");
assert.equal(both.closing, 650);
assert.deepEqual(
  both.buckets.map((b) => b.balance),
  [1100, 800, 650],
);
assert.equal(both.lowest.balance, 100);
assert.equal(both.byStage.find((s) => s.stage === "confirmed")!.outflow, 150);

const realized = buildCashFlow(txs, {
  ...jan,
  stages: ["realized"],
  granularity: "month",
});
assert.equal(realized.outflow, 0);
assert.equal(realized.buckets.length, 1);

// Menor saldo é de fim de dia: saída e entrada no mesmo dia se compensam.
const sameDay = buildCashFlow(
  [
    tx({ amount: 500, dueDate: new Date(2027, 0, 3) }),
    tx({ type: "receivable", amount: 500, dueDate: new Date(2027, 0, 3) }),
  ],
  { ...jan, opening: 0, stages: ["approved"], granularity: "day" },
);
assert.equal(sameDay.lowest.balance, 0);

// Centro de custo: só a parcela do rateio dos centros escolhidos.
const split = buildCashFlow(
  [
    tx({
      amount: 100,
      costCenterAllocation: [
        { costCenterId: "A", percentage: 70, amount: 70 },
        { costCenterId: "B", percentage: 30, amount: 30 },
      ],
    }),
  ],
  { ...jan, stages: ["approved"], granularity: "day", costCenterIds: ["A"] },
);
assert.equal(split.outflow, 70);

// Saldo inicial a partir de hoje.
const today = new Date(2027, 0, 20);
assert.equal(
  openingFromToday(5000, new Date(2027, 0, 1), today, txs),
  4000,
  "desfaz o recebimento de 02/01",
);
assert.equal(
  openingFromToday(5000, new Date(2027, 1, 1), today, [
    tx({ amount: 300, dueDate: new Date(2027, 0, 25) }),
    tx({ amount: 999, dueDate: new Date(2027, 1, 1) }),
  ]),
  4700,
);

// Recorrências: só as ocorrências dentro do período.
const projected = projectRecurrences(
  [
    {
      id: "r1",
      companyId: "c",
      description: "Aluguel",
      amount: 1000,
      type: "payable",
      frequency: "monthly",
      interval: 1,
      nextDueDate: new Date(2026, 11, 10),
      active: true,
      baseTransactionData: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as RecurringTransactionTemplate,
  ],
  new Date(2027, 0, 1),
  new Date(2027, 2, 31),
);
assert.equal(projected.length, 3);
assert.equal(stageOf(projected[0]), "recurring");

// Comparação.
const prev = comparisonRange(
  new Date(2027, 1, 1),
  new Date(2027, 1, 28),
  "previous",
)!;
assert.deepEqual(
  [prev.start, prev.end].map((d) => d.toDateString()),
  [new Date(2027, 0, 1).toDateString(), new Date(2027, 0, 31).toDateString()],
);
const yoy = comparisonRange(
  new Date(2028, 1, 1),
  new Date(2028, 1, 29),
  "year",
)!;
assert.equal(yoy.end.getDate(), 28);
const days = comparisonRange(
  new Date(2027, 0, 11),
  new Date(2027, 0, 20),
  "previous",
)!;
assert.equal(days.start.getDate(), 1);
assert.equal(variation(110, 100)!.toFixed(2), "0.10");
assert.equal(variation(5, 0), null);

// Pagamentos: só baixados, pela data da baixa, da entidade e da conta pedidas.
const acme = { id: "e1", name: "Acme" };
const pays = [
  tx({
    status: "paid",
    amount: 100,
    entityId: "e1",
    paymentDate: new Date(2027, 0, 5),
  }),
  tx({
    status: "paid",
    amount: 50,
    finalAmount: 55,
    entityId: "e1",
    entityBankAccountId: "x1",
    paymentDate: new Date(2027, 0, 3),
  }),
  tx({ status: "approved", amount: 70, entityId: "e1" }),
  tx({
    status: "paid",
    amount: 30,
    supplierOrClient: "Acme",
    paymentDate: new Date(2027, 1, 1),
  }),
  tx({
    status: "paid",
    amount: 10,
    entityId: "e2",
    paymentDate: new Date(2027, 0, 4),
  }),
].filter((t) => belongsTo(t, acme));
const payJan = buildPayments(pays, {
  start: new Date(2027, 0, 1),
  end: new Date(2027, 0, 31),
  type: "payable",
});
assert.deepEqual(
  payJan.lines.map((l) => l.amount),
  [55, 100],
);
assert.equal(payJan.total, 155);
assert.equal(pays.filter((t) => belongsTo(t, acme, "x1")).length, 1);
assert.equal(pays.filter((t) => belongsTo(t, acme, "main")).length, 3);

// CSV que o Excel pt-BR abre em colunas.
assert.equal(
  toCsv([["a;b", 1234.5, new Date(2027, 0, 2)]]),
  '﻿"a;b";1234,50;02/01/2027',
);

console.log("relatórios: ok");
