/**
 * Verificação das regras do plano de contas e da DRE.
 *   npm run check:chart-of-accounts
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  buildDre,
  nextChildCode,
  parseAccountType,
  parseDreGroup,
  resolvePlan,
} from "../src/lib/chartOfAccounts";
import { CHART_MODELS } from "../src/lib/chartOfAccountsModels";
import type { ChartAccount, Transaction } from "../src/lib/types";

// Os dois modelos prontos são planos válidos.
for (const [key, model] of Object.entries(CHART_MODELS)) {
  const { issues, accounts } = resolvePlan([...model.accounts]);
  assert.deepEqual(issues, [], `modelo ${key}`);
  assert.ok(accounts.every((a) => a.type === "synthetic" || a.dreGroup));
}

// Herança: tipo inferido, natureza e grupo vindos do pai.
const { accounts, issues } = resolvePlan([
  { code: "1", name: "Receitas", nature: "revenue", dreGroup: "gross_revenue" },
  { code: "1.01", name: "Ofertas" },
]);
assert.deepEqual(issues, []);
assert.equal(accounts[0].type, "synthetic");
assert.equal(accounts[1].type, "analytic");
assert.equal(accounts[1].nature, "revenue");
assert.equal(accounts[1].dreGroup, "gross_revenue");

// Erros entre contas.
const bad = resolvePlan([
  {
    code: "2",
    name: "Despesas",
    nature: "expense",
    type: "analytic",
    dreGroup: "operating_expenses",
  },
  { code: "2.1", name: "Filha de analítica" },
  {
    code: "3.1",
    name: "Órfã",
    nature: "expense",
    dreGroup: "operating_expenses",
  },
  {
    code: "4",
    name: "Receita errada",
    nature: "revenue",
    dreGroup: "operating_expenses",
  },
  { code: "5", name: "Sem grupo", nature: "expense" },
  { code: "1.a", name: "Código inválido" },
  { code: "2", name: "Duplicada" },
])
  .issues.map((i) => i.message)
  .join("\n");
for (const expected of [
  "é analítica",
  "3 não existe",
  "não combina",
  "grupo da DRE",
  "inválido",
  "repetido",
]) {
  assert.ok(bad.includes(expected), `esperava erro "${expected}"`);
}

// Leitura de planilha e numeração.
assert.equal(parseAccountType("Analítica"), "analytic");
assert.equal(parseAccountType(""), undefined);
assert.equal(parseAccountType("xpto"), null);
assert.equal(parseDreGroup("despesas operacionais"), "operating_expenses");
assert.equal(nextChildCode([{ code: "4" }, { code: "4.09" }], "4"), "4.10");
assert.equal(nextChildCode([{ code: "4" }], "4"), "4.1");
assert.equal(nextChildCode([{ code: "4.1" }], "4.1"), "4.1.01");
assert.equal(nextChildCode([{ code: "1" }, { code: "2" }], null), "3");

// DRE: subtotais acumulados, rejeitada fora, sem conta no fim, rateio por centro.
const plan: ChartAccount[] = resolvePlan([
  ...CHART_MODELS.company.accounts,
]).accounts.map((a, i) => ({
  ...a,
  id: a.code,
  companyId: "c",
  createdAt: new Date(),
  updatedAt: new Date(),
  archived: false,
  line: i,
}));
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    status: "approved",
    dueDate: new Date(2027, 0, 10),
    amount: 0,
    ...p,
  }) as Transaction;
const dre = buildDre(
  [
    tx({ type: "receivable", amount: 1000, accountId: "1.1.02" }),
    tx({ type: "payable", amount: 100, accountId: "2.1.02" }),
    tx({
      type: "payable",
      amount: 300,
      accountId: "4.2.02",
      dueDate: new Date(2027, 1, 5),
    }),
    tx({
      type: "payable",
      amount: 999,
      accountId: "4.2.02",
      status: "rejected",
    }),
    tx({ type: "payable", amount: 50 }),
  ],
  plan,
  { start: new Date(2027, 0, 1), end: new Date(2027, 1, 28) },
);
const row = (label: string) => dre.rows.find((r) => r.label === label)!;
assert.deepEqual(
  dre.columns.map((c) => c.key),
  ["2027-01", "2027-02"],
);
assert.equal(row("Receita Líquida").total, 900);
assert.equal(dre.base, 900);
assert.deepEqual(row("Resultado Operacional").values, [900, -300]);
assert.equal(row("Resultado Operacional").total, 600);
assert.equal(row("Energia elétrica").total, -300);
assert.equal(row("Administrativas").total, -300);
assert.equal(dre.unclassifiedCount, 1);
const byKey = (key: string) => dre.rows.find((r) => r.key === key)!;
assert.equal(byKey("Resultado com Lançamentos sem Conta").total, 550);
// Com lançamento sem conta, o resultado é só das contas classificadas, e o
// rótulo diz isso e o sinal.
assert.equal(
  byKey("Resultado Líquido do Período").label,
  "Resultado das Contas Classificadas (Superávit)",
);
assert.equal(dre.coverage, 1400 / 1450);

const byCc = buildDre(
  [
    tx({
      type: "payable",
      amount: 100,
      finalAmount: 110,
      accountId: "4.2.02",
      costCenterAllocation: [
        { costCenterId: "A", percentage: 60, amount: 60 },
        { costCenterId: "B", percentage: 40, amount: 40 },
      ],
    }),
  ],
  plan,
  {
    start: new Date(2027, 0, 1),
    end: new Date(2027, 0, 31),
    costCenterIds: ["A"],
  },
);
assert.equal(byCc.rows.find((r) => r.code === "4.2.02")!.total, -66);
assert.equal(byCc.rows.find((r) => r.code === "4.2.02")!.sources!.length, 1);

// Regime: competência manda o mês; caixa só conta a baixa, no dia dela.
const regimeTxs = [
  tx({
    type: "payable",
    amount: 100,
    accountId: "4.2.02",
    competence: "2027-01",
    dueDate: new Date(2027, 1, 10),
  }),
  tx({
    type: "payable",
    amount: 40,
    accountId: "4.2.02",
    status: "paid",
    dueDate: new Date(2026, 11, 20),
    paymentDate: new Date(2027, 0, 5),
  }),
];
const janOnly = { start: new Date(2027, 0, 1), end: new Date(2027, 0, 31) };
const energy = (r: ReturnType<typeof buildDre>) =>
  r.rows.find((x) => x.code === "4.2.02")!.total;
assert.equal(energy(buildDre(regimeTxs, plan, janOnly)), -140);
assert.equal(
  energy(buildDre(regimeTxs, plan, { ...janOnly, regime: "cash" })),
  -40,
);

console.log("plano de contas: ok");
