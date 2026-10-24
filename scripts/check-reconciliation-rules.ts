/**
 * Verificação das regras de conciliação.
 *   npm run check:reconciliation-rules
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  applyRules,
  findRule,
  rulePattern,
} from "../src/lib/bankReconciliation";
import type { BankTransaction, ReconciliationRule } from "../src/lib/types";

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

console.log("check:reconciliation-rules ok");
