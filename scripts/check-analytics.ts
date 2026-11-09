/**
 * Verificação das regras da Análise.
 *   npm run check:analytics
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  bridgeCloses,
  buildAccountComposition,
  buildAging,
  buildConcentration,
  buildCostCenterComposition,
  buildPlan,
  buildTiming,
  buildTrend,
  compareRange,
  hasMovement,
  monthlyAverage,
  planRoles,
} from "../src/lib/analytics";
import type { ChartAccount, CostCenter, Transaction } from "../src/lib/types";

let n = 0;
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    id: `t${n++}`,
    companyId: "c",
    description: "Lançamento",
    type: "receivable",
    status: "approved",
    amount: 100,
    dueDate: d(2026, 4, 10),
    createdAt: d(2025, 12, 29),
    updatedAt: d(2025, 12, 29),
    createdBy: "u",
    plannedSource: "create",
    ...p,
  }) as Transaction;
const name = (t: Transaction) => t.supplierOrClient ?? "Sem favorecido";
const today = d(2026, 11, 9);
const april = { from: "2026-04", to: "2026-04" };

// ── Mantenedora: previsão revisada e dividida em três partes ────────────────
// Caso real: abril nasceu com 1.840.942,72, foi revisado para 2.069.000 e
// dividido; as partes 2/3 e 3/3 nasceram em 28/04, a 3/3 vence em maio.
const base = "Doação da Mantenedora - abril de 2026";
const p1 = tx({
  description: `${base} (1/3)`,
  entityId: "mant",
  plannedAmount: 1840942.72,
  amount: 515250,
  finalAmount: 515250,
  status: "paid",
  dueDate: d(2026, 4, 28),
  paymentDate: d(2026, 4, 28),
});
const p2 = tx({
  description: `${base} (2/3)`,
  entityId: "mant",
  plannedAmount: 519250,
  amount: 519250,
  finalAmount: 519250,
  status: "paid",
  dueDate: d(2026, 4, 30),
  paymentDate: d(2026, 4, 30),
  createdAt: d(2026, 4, 28),
});
const p3 = tx({
  description: `${base} (3/3)`,
  entityId: "mant",
  plannedAmount: 1034500,
  amount: 1034500,
  finalAmount: 1034500,
  status: "paid",
  dueDate: d(2026, 5, 4),
  paymentDate: d(2026, 5, 4),
  createdAt: d(2026, 4, 28),
});
const roles = planRoles([p1, p2, p3]);
assert.equal(roles.get(p1.id)!.split, false);
assert.equal(roles.get(p2.id)!.split, true);
assert.equal(roles.get(p3.id)!.split, true);
assert.equal(
  roles.get(p3.id)!.month,
  "2026-04",
  "parte de maio conta em abril",
);

const mant = buildPlan([p1, p2, p3], april, today, name).receivable;
assert.equal(mant.bridge.planned, 1840942.72, "previsto não dobra");
assert.equal(mant.bridge.realized, 2069000);
assert.equal(mant.bridge.revisions, 228057.28);
assert.ok(bridgeCloses(mant.bridge));
assert.equal(mant.deviations.length, 1, "partes viram um desvio só");
assert.equal(mant.deviations[0].id, p1.id, "abre a parte prevista");
assert.equal(mant.deviations[0].parts, 3);
assert.equal(mant.deviations[0].deviation, 228057.28);
assert.equal(mant.deviations[0].description, base);

// ── Parcelamento lançado de uma vez: cada parcela é previsão ────────────────
const inst = [1, 2, 3].map((i) =>
  tx({
    description: `Construção do templo (${i}/3)`,
    type: "payable",
    amount: 1000,
    plannedAmount: 1000,
    dueDate: d(2026, 3 + i, 10),
    createdAt: d(2026, 1, 5),
  }),
);
assert.ok(inst.every((t) => !planRoles(inst).get(t.id)!.split));
const instPlan = buildPlan(
  inst,
  { from: "2026-04", to: "2026-06" },
  today,
  name,
).payable;
assert.equal(instPlan.bridge.planned, 3000);
assert.deepEqual(
  instPlan.months.map((m) => m.planned),
  [1000, 1000, 1000],
  "cada parcela no seu mês",
);

// ── Não previsto, cancelado, diferença na baixa, em aberto ──────────────────
const mixed = [
  tx({
    amount: 300,
    plannedAmount: 300,
    unplanned: true,
    status: "paid",
    paymentDate: d(2026, 4, 12),
  }),
  tx({ amount: 200, plannedAmount: 200, status: "rejected" }),
  tx({
    amount: 500,
    plannedAmount: 500,
    finalAmount: 480,
    status: "paid",
    paymentDate: d(2026, 4, 10),
  }),
  tx({ amount: 700, plannedAmount: 600, status: "approved" }),
  tx({
    amount: 50,
    plannedAmount: 50,
    status: "draft",
    dueDate: d(2026, 4, 30),
  }),
];
const mix = buildPlan(mixed, april, d(2026, 4, 20), name).receivable;
assert.equal(mix.bridge.planned, 1350, "200 cancelado + 500 + 600 + 50");
assert.equal(mix.bridge.unplanned, 300);
assert.equal(mix.bridge.cancelled, 200);
assert.equal(mix.bridge.revisions, 100);
assert.equal(mix.bridge.settlement, -20);
assert.equal(mix.bridge.openOverdue, 700);
assert.equal(mix.bridge.openFuture, 50);
assert.equal(mix.bridge.realized, 780);
assert.ok(bridgeCloses(mix.bridge));

// Ajuste do aprovador no lote é revisão.
const adj = buildPlan(
  [
    tx({
      type: "payable",
      amount: 1000,
      plannedAmount: 1000,
      batchAdjustedAmount: 800,
      status: "paid",
      finalAmount: 800,
      paymentDate: d(2026, 4, 10),
    }),
  ],
  april,
  today,
  name,
).payable.bridge;
assert.equal(adj.revisions, -200);
assert.equal(adj.settlement, 0);

// Sem histórico: previsão desconhecida entra no total, não no conhecido.
const hist = buildPlan(
  [
    tx({}),
    tx({ plannedSource: "current" }),
    tx({ plannedSource: undefined, plannedAmount: undefined }),
  ],
  april,
  today,
  name,
).receivable.history;
assert.deepEqual(hist, { known: 1, total: 3, knownShare: 1 / 3 });

// ── Períodos de comparação ──────────────────────────────────────────────────
assert.deepEqual(compareRange({ from: "2026-01", to: "2026-03" }, "previous"), {
  from: "2025-10",
  to: "2025-12",
});
assert.deepEqual(compareRange({ from: "2026-01", to: "2026-03" }, "year"), {
  from: "2025-01",
  to: "2025-03",
});
assert.deepEqual(compareRange({ from: "2026-11", to: "2026-11" }, "previous"), {
  from: "2026-10",
  to: "2026-10",
});

// ── Tendência por regime ────────────────────────────────────────────────────
const late = tx({
  type: "payable",
  amount: 90,
  status: "paid",
  dueDate: d(2026, 4, 28),
  paymentDate: d(2026, 5, 2),
});
const openTx = tx({
  type: "payable",
  amount: 40,
  status: "approved",
  dueDate: d(2026, 5, 10),
});
const range45 = { from: "2026-04", to: "2026-05" };
assert.deepEqual(
  buildTrend([late, openTx], range45, "cash").map((m) => m.outflow),
  [0, 90],
  "caixa: pela baixa, só pago",
);
assert.deepEqual(
  buildTrend([late, openTx], range45, "competence").map((m) => m.outflow),
  [0, 130],
  "competência: data efetiva, inclui o em aberto",
);
assert.deepEqual(
  buildTrend([{ ...late, competence: "2026-04" }], range45, "competence").map(
    (m) => m.outflow,
  ),
  [90, 0],
  "competência declarada manda",
);

const avg = monthlyAverage([late], d(2026, 6, 15), 2);
assert.deepEqual(avg.range, { from: "2026-04", to: "2026-05" });
assert.equal(avg.outflow, 45);

// ── Composição ──────────────────────────────────────────────────────────────
const acc = (id: string, code: string, type: "synthetic" | "analytic") =>
  ({ id, code, name: id, type, nature: "expense" }) as ChartAccount;
const accounts = [
  acc("4", "4", "synthetic"),
  acc("4.1", "4.1", "synthetic"),
  acc("4.1.01", "4.1.01", "analytic"),
  acc("4.2.01", "4.2.01", "analytic"),
];
const comp = buildAccountComposition(
  [
    tx({
      type: "payable",
      amount: 100,
      status: "paid",
      accountId: "4.1.01",
      paymentDate: d(2026, 4, 5),
    }),
    tx({
      type: "payable",
      amount: 50,
      status: "paid",
      accountId: "4.2.01",
      paymentDate: d(2026, 4, 5),
    }),
    tx({
      type: "payable",
      amount: 25,
      status: "paid",
      paymentDate: d(2026, 4, 5),
    }),
    tx({
      type: "payable",
      amount: 10,
      status: "paid",
      accountId: "4.1.01",
      paymentDate: d(2026, 3, 5),
      dueDate: d(2026, 3, 5),
    }),
  ],
  accounts,
  april,
  { from: "2026-03", to: "2026-03" },
  "cash",
);
const node = (id: string) => comp.nodes.find((x) => x.id === id)!;
assert.equal(node("4").value.payable, 150, "raiz soma a subárvore");
assert.equal(node("4.1").value.payable, 100);
assert.equal(node("4.2.01").parentId, "4", "sem 4.2 no plano, sobe para 4");
assert.equal(node("4.1").compare.payable, 10);
assert.equal(comp.unassigned.payable, 25);
assert.equal(comp.coverage, 150 / 175);

const cc = (id: string, parentId?: string) =>
  ({ id, name: id, code: id, parentId }) as CostCenter;
const ccComp = buildCostCenterComposition(
  [
    tx({
      type: "payable",
      amount: 100,
      finalAmount: 90,
      status: "paid",
      paymentDate: d(2026, 4, 5),
      costCenterAllocation: [
        { costCenterId: "a", percentage: 60, amount: 60 },
        { costCenterId: "b", percentage: 40, amount: 40 },
      ],
    }),
  ],
  [cc("root"), cc("a", "root"), cc("b", "root")],
  april,
  null,
  "cash",
);
const ccNode = (id: string) => ccComp.nodes.find((x) => x.id === id)!;
assert.equal(ccNode("a").value.payable, 54, "rateio proporcional ao pago");
assert.equal(ccNode("b").value.payable, 36);
assert.equal(ccNode("root").value.payable, 90);
assert.equal(ccComp.coverage, 1);

// ── Concentração, atraso, prazo ─────────────────────────────────────────────
const conc = buildConcentration(
  [
    tx({
      entityId: "mant",
      amount: 900,
      status: "paid",
      paymentDate: d(2026, 4, 3),
    }),
    tx({
      supplierOrClient: "Fulano",
      amount: 100,
      status: "paid",
      paymentDate: d(2026, 4, 3),
    }),
  ],
  "receivable",
  april,
  "cash",
  (t) => (t.entityId === "mant" ? "Mantenedora" : name(t)),
  "mant",
  1,
);
assert.equal(conc.total, 1000);
assert.equal(conc.anchor!.share, 0.9);
assert.equal(conc.top.length, 1);
assert.deepEqual([conc.rest, conc.restCount], [100, 1]);

const aging = buildAging(
  [
    tx({ amount: 10, dueDate: d(2026, 11, 1) }),
    tx({ amount: 20, dueDate: d(2026, 7, 1) }),
    tx({ amount: 30, dueDate: d(2026, 11, 20) }),
    tx({ amount: 40, dueDate: d(2027, 3, 1) }),
    tx({
      amount: 50,
      dueDate: d(2026, 10, 1),
      status: "paid",
      paymentDate: d(2026, 10, 1),
    }),
    tx({ amount: 60, dueDate: d(2026, 10, 1), status: "rejected" }),
  ],
  "receivable",
  today,
);
const bucket = (k: string) => aging.find((b) => b.key === k)!.value;
assert.equal(bucket("d30"), 10);
assert.equal(bucket("d90p"), 20);
assert.equal(bucket("due"), 30, "fora dos 30 dias não entra");

const timing = buildTiming(
  [
    tx({
      type: "payable",
      amount: 100,
      status: "paid",
      dueDate: d(2026, 4, 1),
      paymentDate: d(2026, 4, 3),
    }),
    tx({
      type: "payable",
      amount: 300,
      status: "paid",
      dueDate: d(2026, 4, 10),
      paymentDate: d(2026, 4, 10),
    }),
  ],
  "payable",
  april,
);
assert.equal(timing.avgDays, 0.5, "ponderado pelo valor");
assert.equal(timing.lateShare, 0.5);

assert.equal(
  hasMovement({ inflow: 0, outflow: 0 }),
  false,
  "comparar com período vazio não vale",
);
assert.equal(hasMovement({ inflow: 0, outflow: 1 }), true);
assert.equal(hasMovement(null), false);

console.log("check:analytics ok");
