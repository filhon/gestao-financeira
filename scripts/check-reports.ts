/**
 * Verificação das regras do fluxo de caixa, períodos e CSV dos relatórios.
 *   npm run check:reports
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import currency from "currency.js";
import {
  belongsTo,
  bucketsOf,
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
import {
  buildSynthesis,
  proveBalance,
  synthesisTitle,
} from "../src/lib/cashSynthesis";
import {
  buildMatrix,
  isUnfavorable,
  mergeLines,
  planLines,
  type MatrixRows,
} from "../src/lib/cashMatrix";
import type {
  BankAccount,
  BankTransaction,
  ChartAccount,
  CostCenter,
  Entity,
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
const jan = {
  start: new Date(2027, 0, 1),
  end: new Date(2027, 0, 31),
  today: new Date(2027, 0, 1),
};

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

// Vencido sem baixa: fora do saldo de período encerrado, e o final de um
// período é o inicial do seguinte.
const allStages = ["realized", ...DEFAULT_FORECAST] as const;
const lateTxs = [
  tx({ status: "paid", amount: 100, paymentDate: new Date(2027, 0, 4) }),
  tx({ status: "authorized", amount: 40, dueDate: new Date(2027, 0, 30) }),
  tx({ type: "receivable", amount: 70, dueDate: new Date(2027, 0, 29) }),
  tx({ amount: 15, dueDate: new Date(2027, 1, 20) }),
  tx({ amount: 5, dueDate: new Date(2027, 1, 10) }),
];
const feb10 = new Date(2027, 1, 10, 15);
const period = (month: number) =>
  buildCashFlow(lateTxs, {
    start: new Date(2027, month, 1),
    end: new Date(2027, month + 1, 0),
    today: feb10,
    // Saldo de hoje 900: janeiro começou com 1000.
    opening: openingFromToday(
      900,
      new Date(2027, month, 1),
      feb10,
      lateTxs,
      allStages,
    ),
    stages: allStages,
    granularity: "day",
  });
const [closedJan, openFeb, nextMar] = [period(0), period(1), period(2)];
assert.equal(closedJan.opening, 1000);
assert.equal(closedJan.closing, 900, "período encerrado é só o realizado");
assert.equal(closedJan.pending.outflow, 40);
assert.equal(closedJan.pending.inflow, 70);
assert.equal(openFeb.opening, closedJan.closing);
assert.equal(openFeb.closing, 840, "a pagar vencido sai hoje; a receber, não");
assert.equal(openFeb.pending.inflow, 70);
assert.equal(openFeb.pending.outflow, 0);
assert.equal(openFeb.lines.find((l) => l.late)!.date.getDate(), 10);
assert.equal(nextMar.opening, openFeb.closing);
assert.equal(nextMar.pending.lines.length, 0);

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

// ─── Síntese: conferência com o banco ────────────────────────────────────────
const bank = (p: Partial<BankAccount>) =>
  ({
    id: "cc",
    name: "Conta",
    active: true,
    openingBalance: 10,
    openingBalanceDate: new Date(2026, 9, 20),
    ...p,
  }) as BankAccount;
const stmt = (p: Partial<BankTransaction>) =>
  ({
    bankAccountId: "cc",
    description: "PIX",
    status: "matched",
    ...p,
  }) as BankTransaction;
const oct31 = new Date(2026, 9, 31); // sábado: o último dia útil é 30/10
const closedOn = (d: number, balance: number) => ({
  through: new Date(2026, 9, d),
  balance,
  closedBy: "",
  closedAt: new Date(),
});
const closedOct = bank({ closings: [closedOn(30, 100)] });
assert.equal(proveBalance(100, [closedOct], [], oct31).status, "match");
const wrong = proveBalance(90, [closedOct], [], oct31);
assert.equal(wrong.status, "mismatch");
assert.equal(wrong.difference, -10);
assert.equal(
  proveBalance(100, [bank({ closings: [closedOn(29, 100)] })], [], oct31)
    .status,
  "uncovered",
  "saldo de 29/10 não prova 30/10",
);
assert.equal(
  proveBalance(100, [closedOct], [], new Date(2026, 8, 30)).status,
  "uncovered",
  "mês antes da abertura da conta",
);
assert.equal(
  proveBalance(
    97,
    [
      bank({
        closings: [closedOn(28, 100)],
        statementBalance: 500,
        statementBalanceDate: new Date(2026, 10, 10),
      }),
    ],
    [
      stmt({ date: new Date(2026, 9, 29), amount: -3 }),
      stmt({ date: new Date(2026, 9, 28), amount: -50 }),
      stmt({ date: new Date(2026, 10, 3), amount: -50 }),
      stmt({
        date: new Date(2026, 9, 30),
        amount: 9,
        description: "SALDO DIA",
      }),
      stmt({
        date: new Date(2026, 9, 30),
        amount: 9,
        status: "ignored",
        ignoreReason: "duplicate",
      }),
    ],
    oct31,
  ).status,
  "match",
  "fechamento mais as linhas até o fim do período",
);
assert.equal(
  proveBalance(
    100,
    [closedOct, bank({ id: "x", active: false, openingBalance: 999 })],
    [],
    oct31,
  ).status,
  "match",
  "conta inativa fica fora",
);
assert.equal(proveBalance(0, [], [], oct31).status, "uncovered");

// ─── Síntese: para onde foi e o que falta ────────────────────────────────────
const ccs = [
  { id: "root", name: "Global" },
  { id: "ofertas", name: "OFERTAS", parentId: "root" },
  { id: "saude", name: "Saúde", parentId: "ofertas" },
  { id: "obras", name: "Obras", parentId: "ofertas" },
  { id: "sede", name: "Sede", parentId: "root" },
] as CostCenter[];
const alloc = (parts: [string, number][]) =>
  parts.map(([costCenterId, percentage]) => ({
    costCenterId,
    percentage,
    amount: 0,
  }));
const day5 = new Date(2027, 0, 5);
const paidTx = (p: Partial<Transaction>) =>
  tx({ status: "paid", paymentDate: day5, ...p });
const synthFlow = buildCashFlow(
  [
    paidTx({
      type: "receivable",
      amount: 500,
      supplierOrClient: "Mantenedora",
      accountId: "a1",
    }),
    paidTx({
      amount: 100,
      entityId: "pf",
      costCenterAllocation: alloc([
        ["saude", 33.33],
        ["obras", 33.33],
        ["sede", 33.34],
      ]),
    }),
    paidTx({
      amount: 50,
      entityId: "pj",
      comprovanteStoragePath: "comprovantes/c/x.pdf",
      costCenterAllocation: alloc([["sede", 100]]),
    }),
  ],
  {
    start: new Date(2027, 0, 1),
    end: new Date(2027, 0, 31),
    today: new Date(2027, 1, 10),
    opening: 10,
    stages: allStages,
    granularity: "day",
  },
);
const synth = buildSynthesis(synthFlow, {
  costCenters: ccs,
  accounts: [{ id: "a1", code: "3.1", name: "Doações" }] as ChartAccount[],
  entities: [
    { id: "pf", name: "Ana", document: "123.456.789-09" },
    { id: "pj", name: "Loja", document: "12.345.678/0001-95" },
  ] as Entity[],
  hasReceipt: (t) => !!t.comprovanteStoragePath,
});
assert.equal(
  synth.areas.reduce((s, a) => s + a.value, 0).toFixed(2),
  "150.00",
  "áreas somam as saídas, sem perder centavo do rateio",
);
assert.deepEqual(
  synth.areas.map((a) => [a.label, a.children?.length ?? 0]),
  [
    ["Sede", 0],
    ["Ofertas", 2],
  ],
);
assert.equal(synth.coverage.toFixed(4), (500 / 650).toFixed(4));
assert.equal(synth.accounts.at(-1)!.missing, true);
assert.deepEqual(
  synth.people.map((p) => [p.name, p.value]),
  [["Ana", 100]],
);
assert.equal(synth.undocumented.length, 1);
assert.equal(synth.daily.at(-1)!.balance, synthFlow.closing);
assert.match(
  synthesisTitle(
    synthFlow,
    proveBalance(synthFlow.closing, [], [], oct31),
    new Date(2027, 0, 1),
    new Date(2027, 0, 31),
    true,
  ),
  /^Janeiro de 2027 fechou com R\$\s360,00, ainda sem conferência/,
);

// ─── Baldes: semana de segunda a domingo, cortada nas pontas ─────────────────
const weeks = bucketsOf(
  new Date(2026, 9, 1),
  new Date(2026, 9, 31),
  "week",
  [],
).buckets;
assert.deepEqual(
  weeks.map((w) => w.label),
  [
    "01/10 a 04/10",
    "05/10 a 11/10",
    "12/10 a 18/10",
    "19/10 a 25/10",
    "26/10 a 31/10",
  ],
);
assert.deepEqual(
  bucketsOf(
    new Date(2026, 0, 1),
    new Date(2026, 11, 31),
    "quarter",
    [],
  ).buckets.map((b) => b.label),
  ["1º tri/2026", "2º tri/2026", "3º tri/2026", "4º tri/2026"],
);

// ─── Matriz: cada dimensão fecha com o fluxo, em toda granularidade ──────────
const matrixBase = {
  start: new Date(2027, 0, 1),
  end: new Date(2027, 0, 31),
  today: new Date(2027, 1, 10),
  granularity: "week" as const,
  opening: 10,
  lines: synthFlow.lines,
  costCenters: ccs,
  accounts: [
    { id: "s", code: "3", name: "Receitas" },
    { id: "a1", code: "3.1", name: "Doações" },
  ] as ChartAccount[],
  entities: [{ id: "pf", name: "Ana" }] as Entity[],
  banks: [],
};
const matrixOf = (rows: MatrixRows, extra = {}) =>
  buildMatrix({ ...matrixBase, rows, ...extra });
for (const rows of ["costCenter", "account", "entity", "bank"] as const) {
  for (const granularity of ["day", "week", "month", "quarter"] as const) {
    const m = matrixOf(rows, { granularity });
    for (const s of [m.inflow, m.outflow]) {
      const tops = s.nodes.filter((x) => x.depth === 0);
      const sum = (pick: (x: (typeof tops)[number]) => number) =>
        currency(0).add(tops.reduce((t, x) => t + pick(x), 0)).value;
      assert.equal(
        sum((x) => x.total),
        s.total,
        `${rows} ${granularity}`,
      );
      s.values.forEach((v, i) =>
        assert.equal(
          sum((x) => x.values[i]),
          v,
        ),
      );
    }
    assert.equal(m.inflow.total, synthFlow.inflow);
    assert.equal(m.outflow.total, synthFlow.outflow);
    assert.equal(m.closing!.at(-1), synthFlow.closing);
  }
}
const byCenter = matrixOf("costCenter").outflow.nodes;
assert.deepEqual(
  byCenter.map((x) => [x.label, x.depth, x.hasChildren]),
  [
    ["Sede", 0, false],
    ["Ofertas", 0, true],
    ["Obras", 1, false],
    ["Saúde", 1, false],
  ],
);
// O pagamento rateado entre dois centros aparece uma vez na lista da área.
const ofertas = byCenter[1].lines.flat();
assert.equal(ofertas.length, 2);
assert.deepEqual(
  mergeLines(ofertas).map((l) => l.amount),
  [66.66],
);
assert.deepEqual(
  matrixOf("account").inflow.nodes.map((x) => [x.label, x.depth]),
  [
    ["3 Receitas", 0],
    ["3.1 Doações", 1],
  ],
);
assert.equal(matrixOf("account").outflow.nodes[0].label, "Sem conta contábil");

// Previsto × realizado: o valor de origem no vencimento; parte desdobrada não
// é previsão nova; o total só conta o que já venceu.
const born = (day: number) => new Date(2026, 11, day);
const planned = planLines(
  [
    tx({ amount: 130, plannedAmount: 100, createdAt: born(1) }),
    tx({ amount: 40, unplanned: true, createdAt: born(1) }),
    tx({ description: "Obra (1/2)", amount: 60, createdAt: born(1) }),
    tx({ description: "Obra (2/2)", amount: 60, createdAt: born(5) }),
    tx({ amount: 7, dueDate: new Date(2027, 0, 31, 15), createdAt: born(1) }),
    tx({ amount: 9, dueDate: new Date(2027, 1, 1), createdAt: born(1) }),
  ],
  matrixBase.start,
  matrixBase.end,
);
assert.deepEqual(
  planned.map((l) => l.amount),
  [100, 60, 7],
);
const versus = matrixOf("costCenter", {
  plan: planned,
  opening: null,
  today: new Date(2027, 0, 20),
});
assert.equal(
  versus.outflow.plan.reduce((a, b) => a + b, 0),
  167,
);
assert.equal(versus.outflow.planTotal, 160, "31/01 ainda não venceu em 20/01");
assert.equal(versus.closing, null);
assert.equal(isUnfavorable("payable", 5), true);
assert.equal(isUnfavorable("receivable", 5), false);

console.log("relatórios: ok");
