/**
 * Verificação das regras de conciliação.
 *   npm run check:reconciliation-rules
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  applyRules,
  dailyBalances,
  findRule,
  groupByDay,
  isBalanceLine,
  isBeforeBase,
  newStatementLines,
  pickStatementBalance,
  rulePattern,
  summarizeAccount,
  taxLine,
  transferPair,
  yieldLine,
  yieldToRecognize,
} from "../src/lib/bankReconciliation";
import {
  curveGap,
  investmentPosition,
  iofRate,
  irRate,
  parseSgs,
  planRedemption,
  taxWithheld,
} from "../src/lib/investment";
import currency from "currency.js";
import type {
  BankAccount,
  BankTransaction,
  ReconciliationRule,
} from "../src/lib/types";

const line = (
  description: string,
  amount: number,
  status: BankTransaction["status"] = "unmatched",
): BankTransaction => ({
  id: description,
  date: new Date(2026, 9, 10),
  amount,
  description,
  type: amount < 0 ? "debit" : "credit",
  status,
});

const rule = (
  pattern: string,
  direction: ReconciliationRule["direction"],
  extra: Partial<ReconciliationRule> = {},
): ReconciliationRule => ({
  id: pattern,
  companyId: "c1",
  pattern,
  direction,
  action: "create",
  active: true,
  createdBy: "u1",
  createdAt: new Date(),
  ...extra,
});

// Padrão ignora caixa, acento, dígitos e pontuação.
assert.equal(
  rulePattern("TARIFA PACOTE SERVIÇOS 10/2026"),
  "tarifa pacote servicos",
);
assert.equal(rulePattern("  IOF  -  12,34 "), "iof");

const rules = [
  rule("tarifa", "debit"),
  rule("tarifa pacote servicos", "debit"),
  rule("rendimento", "credit"),
  rule("iof", "debit", { active: false }),
];

// O mais específico vence.
assert.equal(
  findRule(line("Tarifa Pacote Serviços 11/2026", -59.9), rules)?.id,
  "tarifa pacote servicos",
);
assert.equal(findRule(line("TARIFA DOC", -12), rules)?.id, "tarifa");
// Sentido conta: crédito não casa regra de débito.
assert.equal(findRule(line("ESTORNO TARIFA", 12), rules), undefined);
assert.equal(
  findRule(line("RENDIMENTO POUPANCA", 3.2), rules)?.id,
  "rendimento",
);
// Inativa não casa.
assert.equal(findRule(line("IOF", -1.5), rules), undefined);

// Só linha pendente vira sugestão; o resto mantém a referência.
const lines = [
  line("TARIFA DOC", -12),
  line("TARIFA TED", -12, "matched"),
  line("PIX JOAO", -100),
];
const out = applyRules(lines, rules);
assert.equal(out[0].status, "potential_match");
assert.equal(out[0].ruleId, "tarifa");
assert.equal(out[1], lines[1]);
assert.equal(out[2], lines[2]);

// ── Prova com linhas de saldo (extrato Itaú de 20 a 23/10/2026) ──────────────
const at = (
  d: number,
  description: string,
  amount: number,
  status: BankTransaction["status"] = "unmatched",
): BankTransaction => ({
  ...line(description, amount, status),
  id: `${d}-${description}-${amount}`,
  date: new Date(2026, 9, d),
  bankAccountId: "a1",
});

assert.ok(isBalanceLine(at(21, "SALDO TOTAL DISPONÍVEL DIA", 1)));
assert.ok(isBalanceLine(at(23, "SDO APLIC AUT MAIS AP", 1)));
assert.ok(!isBalanceLine(at(21, "RES APLIC AUT MAIS", 1)));

const account: BankAccount = {
  id: "a1",
  companyId: "c1",
  name: "Itaú",
  openingBalance: 50771.83,
  openingBalanceDate: new Date(2026, 9, 20),
  statementBalance: 46891.78,
  statementBalanceDate: new Date(2026, 9, 23),
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const statement = [
  at(20, "SALDO ANTERIOR", 50771.83),
  at(21, "PAGAMENTOS A FORNECEDORES HOME FEST", -2125.26, "matched"),
  at(21, "PAGAMENTOS A FORNECEDORES N&M", -430, "matched"),
  at(21, "RES APLIC AUT MAIS", 2555.19),
  at(21, "SALDO TOTAL DISPONÍVEL DIA", 48216.64),
  at(21, "SALDO APLIC. AUT.", 48215.64),
  at(22, "SALDO APLIC. AUT.", 48215.64),
  at(23, "PAGAMENTOS A FORNECEDORES CELPE", -324.92, "matched"),
];

// Saldo do banco não conta como linha nem como pendente.
const summary = summarizeAccount(account, statement);
assert.equal(summary.total, 4);
assert.equal(summary.pending, 1);
assert.equal(summary.pendingAmount, 2555.19);
assert.equal(summary.bookBalance, 47891.65);
// Projetada = extrato − (conciliado + pendentes como estão).
assert.equal(summary.projectedDifference, -3555.06);

// Conferência: o dia da base bate com o saldo inicial; os outros, com tudo o
// que o arquivo moveu até ali.
const days = dailyBalances(account, statement);
assert.deepEqual(
  days.map((d) => [d.day, d.computed, d.matches]),
  [
    ["2026-10-20", 50771.83, true],
    ["2026-10-21", 50771.76, false],
    ["2026-10-22", 50771.76, false],
  ],
);
// Saldo do extrato: na base conta corrente (R$ 1,00), o "SALDO MOVIMENTAÇÃO
// CONTA" do último dia bate e vence o saldo final do OFX (total com aplicação).
const fromFile = { balance: 46891.91, date: new Date(2026, 9, 24) };
const checking = { ...account, openingBalance: 1 };
const itau = [
  at(20, "SALDO ANTERIOR", 50771.83),
  at(21, "PAGAMENTOS A FORNECEDORES HOME FEST", -2125.26),
  at(21, "RES APLIC AUT MAIS", 2125.26),
  at(21, "SALDO TOTAL DISPONÍVEL DIA", 48646.57),
  at(21, "SALDO MOVIMENTAÇÃO CONTA", 1),
];
assert.deepEqual(pickStatementBalance(checking, itau, fromFile), {
  balance: 1,
  date: new Date(2026, 9, 21),
});
// Na base total nenhuma linha bate: fica o saldo do arquivo.
assert.equal(pickStatementBalance(account, itau, fromFile), fromFile);
// CSV sem saldo final também ganha o saldo pela linha que confere.
assert.equal(pickStatementBalance(checking, itau, null)?.balance, 1);

// Reimportação (caso real de 29/10/2026): o Itaú numera o FITID pela posição
// no arquivo. O 2º recorte trouxe a aplicação automática como 001 e o TED como
// 002, números que o 1º recorte já usara para o TED e o saldo. Pelo id, a
// aplicação de −681.000 sumia e o TED duplicava.
const fit = (n: string, description: string, amount: number) => ({
  ...at(29, description, amount),
  id: `a1_2026102900${n}`,
});
const first = [
  fit("1", "TED RECEBIDA HEBRON", 681000),
  fit("2", "SALDO TOTAL DISPONÍVEL DIA", 700958.56),
];
const second = [
  fit("1", "APL APLIC AUT MAIS AP", -681000),
  fit("2", "TED RECEBIDA HEBRON", 681000),
  fit("3", "SALDO TOTAL DISPONÍVEL DIA", 700958.56),
  fit("4", "SALDO MOVIMENTAÇÃO CONTA", 1),
];
const merged = newStatementLines(first, second);
assert.deepEqual(
  merged.map((t) => [t.id, t.amount]),
  [
    ["a1_20261029001~2", -681000],
    ["a1_20261029004", 1],
  ],
);
// Mesmo arquivo de novo: nada entra. Duas tarifas iguais no dia: as duas entram.
assert.equal(newStatementLines([...first, ...merged], second).length, 0);
const fee = fit("9", "TARIFA", -12);
assert.equal(newStatementLines([], [fee, { ...fee, id: "x" }]).length, 2);
assert.equal(newStatementLines([fee], [fee, { ...fee, id: "x" }]).length, 1);

assert.ok(isBeforeBase(statement[0], account));
assert.ok(!isBeforeBase(statement[1], account));

// Dias: pendente ou saldo que não bate deixa o dia aberto; dia só com saldo
// também aparece; fechamento trava os dias até ele.
const movement = statement.filter((t) => !isBalanceLine(t));
assert.deepEqual(
  groupByDay(account, movement, days).map((g) => [
    g.day,
    g.total,
    g.pending,
    g.done,
  ]),
  [
    ["2026-10-20", 0, 0, true],
    ["2026-10-21", 3, 1, false],
    ["2026-10-22", 0, 0, false],
    ["2026-10-23", 1, 0, true],
  ],
);
const closed = {
  ...account,
  closings: [
    {
      through: new Date(2026, 9, 21),
      balance: 1,
      closedBy: "u1",
      closedAt: new Date(),
    },
  ],
};
assert.deepEqual(
  groupByDay(closed, movement, []).map((g) => g.locked),
  [true, false],
);

// ── Aplicação: transferência e rendimento ─────────────────────────────────────
const cdb: BankAccount = {
  ...account,
  id: "cdb",
  name: "CDB Itaú",
  kind: "investment",
  openingBalance: 10000,
  statementBalance: undefined,
  statementBalanceDate: undefined,
};
const aplic = at(21, "APLIC CDB DI", -1000);

// Sem a outra ponta no extrato: nasce o espelho, sinal invertido, id estável.
const pair = transferPair(aplic, account, cdb, []);
assert.equal(pair.other.id, `${aplic.id}~t`);
assert.equal(pair.other.amount, 1000);
assert.equal(pair.other.bankAccountId, "cdb");
assert.equal(pair.other.description, "Aplicação de Itaú");
assert.equal(pair.other.origin, "transfer");
assert.equal(pair.origin.transferId, pair.other.id);
assert.equal(pair.origin.transferAccountId, "cdb");
assert.equal(pair.origin.status, "matched");
assert.equal(
  transferPair(at(22, "RESG CDB DI", 500), account, cdb, []).other.description,
  "Resgate para Itaú",
);

// Com a outra ponta pendente no extrato da outra conta (até 3 dias): casa.
const other = { ...at(22, "TED RECEBIDA", 1000), bankAccountId: "cdb" };
const paired = transferPair(aplic, account, cdb, [
  { ...other, amount: 999 },
  other,
]);
assert.equal(paired.other.id, other.id);
assert.equal(paired.other.origin, undefined);
assert.equal(
  transferPair(aplic, account, cdb, [{ ...other, date: new Date(2026, 9, 26) }])
    .other.id,
  `${aplic.id}~t`,
);

// Saldo bruto acima do sistema, tudo tratado: a diferença é o rendimento.
const mirror = { ...(pair.other as BankTransaction) };
const cdbAt = (balance: number) => ({
  ...cdb,
  statementBalance: balance,
  statementBalanceDate: new Date(2026, 9, 31),
});
const cdbSummary = summarizeAccount(cdbAt(11012.34), [mirror]);
assert.equal(cdbSummary.bookBalance, 11000);
assert.equal(yieldToRecognize(cdbAt(11012.34), cdbSummary), 12.34);
// Abaixo do sistema não é rendimento: falta registrar algo.
assert.equal(
  yieldToRecognize(cdbAt(10990), summarizeAccount(cdbAt(10990), [mirror])),
  0,
);
// Conta corrente nunca tem rendimento a reconhecer.
assert.equal(
  yieldToRecognize(
    { ...cdbAt(11012.34), kind: undefined },
    summarizeAccount(cdbAt(11012.34), [mirror]),
  ),
  0,
);
// Lançado o rendimento, a prova zera e fecha.
const y = {
  ...yieldLine(cdb, 12.34, new Date(2026, 9, 31)),
  status: "matched" as const,
};
assert.ok(!isBalanceLine(y));
const afterYield = summarizeAccount(cdbAt(11012.34), [mirror, y]);
assert.equal(afterYield.difference, 0);
assert.ok(afterYield.canClose);

// Resgate líquido: o IR retido completa o rendimento bruto, mesmo com o banco
// abaixo do sistema.
assert.equal(yieldToRecognize(cdbAt(11012.34), cdbSummary, 3), 15.34);
assert.equal(
  yieldToRecognize(cdbAt(10998), summarizeAccount(cdbAt(10998), [mirror]), 3),
  1,
);
assert.equal(taxLine(cdb, 3, new Date(2026, 9, 31)).amount, -3);

// ── Aplicação: curva CDI, lotes PEPS, IR/IOF ──────────────────────────────────
assert.equal(irRate(180), 0.225);
assert.equal(irRate(181), 0.2);
assert.equal(irRate(721), 0.15);
assert.equal(iofRate(1), 0.96);
assert.equal(iofRate(29), 0.03);
assert.equal(iofRate(30), 0);
assert.deepEqual(parseSgs([{ data: "21/10/2026", valor: "0.05" }]), {
  "2026-10-21": 0.05,
});

// 20/10 é terça; sábado e domingo não têm CDI.
const cdi = parseSgs(
  ["20", "21", "22", "23", "26"].map((d) => ({
    data: `${d}/10/2026`,
    valor: "0.05",
  })),
);
const cdbCdi: BankAccount = { ...cdb, cdiPercent: 100 };
const oct = (d: number) => new Date(2026, 9, d);

// O rendimento do dia entra no dia seguinte: no fim do dia 23, três dias.
const p0 = investmentPosition(cdbCdi, [], cdi, oct(23));
assert.equal(p0.curve, 10015.01);
assert.equal(p0.cdiThrough, "2026-10-22");
// Fim de semana não rende: 26 só soma a taxa do dia 23.
assert.equal(investmentPosition(cdbCdi, [], cdi, oct(26)).curve, 10020.02);
// 110% do CDI rende mais; sem taxa não há curva.
assert.ok(
  investmentPosition({ ...cdbCdi, cdiPercent: 110 }, [], cdi, oct(23)).curve! >
    10015.01,
);
assert.equal(investmentPosition(cdb, [], cdi, oct(23)).curve, null);
// Fundo não acompanha o CDI, mesmo com taxa.
assert.equal(
  investmentPosition({ ...cdbCdi, product: "fund" }, [], cdi, oct(23)).curve,
  null,
);

// Aplicação do dia 21 rende a partir da noite do 21; a taxa da linha vence a da conta.
const apl = { ...mirror, date: oct(21), status: "matched" as const };
assert.equal(
  investmentPosition(cdbCdi, [apl], cdi, oct(23)).curve,
  11016.01, // 10015,0075 + 1001,00025
);
assert.ok(
  investmentPosition(cdbCdi, [{ ...apl, cdiPercent: 120 }], cdi, oct(23))
    .curve! > 11016.01,
);
// Rendimento e IR lançados pelo sistema não mexem na curva.
assert.equal(
  investmentPosition(
    cdbCdi,
    [
      apl,
      { ...y, date: oct(22) },
      { ...taxLine(cdb, 5, oct(22)), status: "matched" },
    ],
    cdi,
    oct(23),
  ).curve,
  11016.01,
);

// IR e IOF no fim do dia 23: lote de abertura com 3 dias (IOF 90%, IR 22,5%).
assert.equal(p0.iof, 13.51); // 15,0075 × 90%
assert.equal(p0.ir, 0.34); // (15,0075 − 13,50675) × 22,5%
assert.equal(p0.net, 10001.16);
assert.equal(
  investmentPosition({ ...cdbCdi, taxExempt: true }, [], cdi, oct(23)).ir,
  0,
);
// Custo de abertura menor que o saldo: o rendimento antigo também paga IR.
assert.ok(
  investmentPosition({ ...cdbCdi, openingPrincipal: 9000 }, [], cdi, oct(23))
    .iof > 900, // 90% de 1.015,01
);

// Resgate consome o lote mais antigo primeiro; bruto = líquido + IR + IOF.
const resg = {
  ...mirror,
  id: "resg",
  date: oct(22),
  amount: -500,
  status: "matched" as const,
};
const p1 = investmentPosition(cdbCdi, [apl, resg], cdi, oct(23));
const [r] = p1.redemptions;
assert.equal(r.net, 500);
assert.ok(r.gross > 500 && r.ir + r.iof > 0);
assert.equal(currency(r.net).add(r.ir).add(r.iof).value, r.gross);
assert.equal(p1.lots.length, 2);
assert.ok(p1.lots[0].principal < 10000);
assert.equal(p1.lots[1].principal, 1000);
assert.equal(
  taxWithheld(p1, oct(20), oct(23)),
  currency(r.ir).add(r.iof).value,
);
assert.equal(taxWithheld(p1, oct(22), oct(23)), 0);

// Fechamento acerta a curva ao saldo do banco: o erro não se acumula.
const closedCdb: BankAccount = {
  ...cdbCdi,
  closings: [
    { through: oct(22), balance: 10100, closedBy: "u1", closedAt: oct(22) },
  ],
};
assert.equal(investmentPosition(closedCdb, [], cdi, oct(23)).curve, 10105.05);

// Saldo do banco informado: IR e líquido partem dele, a curva fica para comparar.
const p2 = investmentPosition(cdbCdi, [], cdi, oct(23), 10020);
assert.equal(p2.gross, 10020);
assert.equal(p2.curve, 10015.01);
assert.equal(curveGap(p0, 10015.5)?.off, false);
assert.deepEqual(curveGap(p0, 10030), { gap: 14.99, off: true });
assert.equal(curveGap(p0, null), null);

// ── Sugestão de resgate ───────────────────────────────────────────────────────
// Lote de 3 dias: o resgate paga IOF; bruto = líquido + imposto.
const [s1] = planRedemption([{ account: cdbCdi, position: p0 }], 500, oct(23));
assert.equal(s1.net, 500);
assert.ok(s1.iof > 0);
assert.equal(s1.gross, currency(500).add(s1.ir).add(s1.iof).value);
// Passados 30 dias o IOF zera.
assert.equal(
  planRedemption(
    [{ account: cdbCdi, position: p0 }],
    500,
    new Date(2026, 10, 25),
  )[0].iof,
  0,
);
// Pedindo mais do que há, resgata tudo: o líquido do dia.
assert.equal(
  planRedemption([{ account: cdbCdi, position: p0 }], 20000, oct(23))[0].net,
  p0.net,
);
// A aplicação sem imposto vai primeiro; a outra só completa.
const exemptCdb = { ...cdbCdi, id: "isento", taxExempt: true };
const pExempt = investmentPosition(exemptCdb, [], cdi, oct(23));
const both = planRedemption(
  [
    { account: cdbCdi, position: p0 },
    { account: exemptCdb, position: pExempt },
  ],
  10500,
  oct(23),
);
assert.deepEqual(
  both.map((r) => [r.account.id, r.net]),
  [
    ["isento", 10015.01],
    ["cdb", 484.99],
  ],
);
assert.equal(both[0].ir + both[0].iof, 0);

console.log("check:reconciliation-rules ok");
