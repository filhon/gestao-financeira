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
  isBalanceLine,
  isBeforeBase,
  pickStatementBalance,
  rulePattern,
  summarizeAccount,
} from "../src/lib/bankReconciliation";
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

assert.ok(isBeforeBase(statement[0], account));
assert.ok(!isBeforeBase(statement[1], account));

console.log("check:reconciliation-rules ok");
