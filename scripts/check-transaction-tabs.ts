/**
 * Verificação das regras das abas de contas a pagar/receber e dos encargos.
 *   npm run check:transaction-tabs
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import { differenceInCalendarDays } from "date-fns";
import {
  agingBucket,
  agingRange,
  duplicateKey,
  lateCharges,
  periodLabel,
  relativeDue,
  splitDescription,
  tabFilter,
  type TabContext,
} from "../src/lib/transactionTabs";
import type { Transaction } from "../src/lib/types";

const today = new Date(2026, 9, 23); // 23/10/2026
const ctx: TabContext = {
  type: "payable",
  today,
  period: { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) },
  status: "all",
  queue: ["pending_approval"],
};

// Vencidas não dependem do período: só têm teto (ontem), nunca início.
const overdue = tabFilter("overdue", ctx)!;
assert.equal(overdue.startDate, undefined);
assert.equal(overdue.endDate!.getDate(), 22);
assert.deepEqual(overdue.excludeStatus, ["paid", "rejected"]);

// As janelas abertas não se sobrepõem.
assert.equal(tabFilter("today", ctx)!.startDate!.getDate(), 23);
assert.equal(tabFilter("week", ctx)!.startDate!.getDate(), 24);
assert.equal(tabFilter("week", ctx)!.endDate!.getDate(), 30);
assert.equal(tabFilter("future", ctx)!.startDate!.getDate(), 31);

// O período vale para Pagas e Todas.
assert.equal(tabFilter("paid", ctx)!.status, "paid");
assert.equal(tabFilter("all", ctx)!.startDate!.getDate(), 1);

// Status fechado em aba de abertas não tem resultado.
assert.equal(tabFilter("overdue", { ...ctx, status: "paid" }), null);
assert.equal(
  tabFilter("overdue", { ...ctx, status: "draft" })!.status,
  "draft",
);
assert.equal(tabFilter("queue", { ...ctx, queue: [] }), null);

// Encargos: 2% de multa + 1% a.m. pro rata die, arredondado a centavos.
const c = lateCharges(1000, new Date(2026, 9, 1), new Date(2026, 9, 31));
assert.equal(c.days, 30);
assert.equal(c.fee, 20);
assert.equal(c.interest, 10);
assert.equal(c.total, 1030);
assert.equal(lateCharges(1000, today, today).total, 1000);
assert.equal(
  lateCharges(333.33, new Date(2026, 9, 20), today, {
    feePercent: 0,
    monthlyInterestPercent: 0,
  }).total,
  333.33,
);
assert.equal(lateCharges(100, new Date(2026, 9, 22), today).interest, 0.03);

assert.equal(relativeDue(new Date(2026, 9, 11), today).label, "há 12 dias");
assert.equal(relativeDue(new Date(2026, 9, 22), today).label, "há 1 dia");
assert.equal(relativeDue(today, today).tone, "today");
assert.equal(relativeDue(new Date(2026, 10, 30), today).tone, "none");

assert.equal(agingBucket(1), "1 a 30 dias");
assert.equal(agingBucket(31), "31 a 60 dias");
assert.equal(agingBucket(91), "Mais de 90 dias");

// Faixa de atraso → vencimentos; ida e volta com agingBucket.
const r31 = agingRange("31 a 60 dias", today)!;
assert.equal(
  agingBucket(differenceInCalendarDays(today, r31.startDate!)),
  "31 a 60 dias",
);
assert.equal(
  agingBucket(differenceInCalendarDays(today, r31.endDate)),
  "31 a 60 dias",
);
assert.equal(differenceInCalendarDays(today, r31.endDate), 31);
assert.equal(agingRange("1 a 30 dias", today)!.endDate.getDate(), 22);
assert.equal(agingRange("Mais de 90 dias", today)!.startDate, undefined);
assert.equal(agingRange("x", today), null);

// Sufixo de parcela/recorrência sai da descrição.
assert.deepEqual(splitDescription("Projeto Hayat (10/12)"), {
  text: "Projeto Hayat",
  installment: "10/12",
  recurring: false,
});
assert.equal(splitDescription("Salário (Recorrência)").recurring, true);
assert.equal(
  splitDescription("Reforma - NF n.º (pendente) (2/2)").text,
  "Reforma - NF n.º (pendente)",
);
assert.equal(splitDescription("(3/12)").text, "(3/12)");
assert.equal(splitDescription("Pedágio - 09.10").installment, null);

// Duplicata: mesmo fornecedor e valor, mas projeto diferente, não é alarme.
const tx = (description: string) =>
  ({
    description,
    entityId: "e1",
    amount: 2000,
    dueDate: new Date(2026, 9, 30),
  }) as Transaction;
assert.notEqual(
  duplicateKey(tx("Projeto Atitude (10/12)")),
  duplicateKey(tx("Projeto Hayat (10/12)")),
);
assert.equal(
  duplicateKey(tx("Projeto Hayat (10/12)")),
  duplicateKey(tx("projeto hayat")),
);

// Período visível nas abas "Pagas" e "Todas".
assert.equal(periodLabel(ctx.period), "out/26");
assert.equal(
  periodLabel({ from: new Date(2026, 0, 1), to: new Date(2026, 11, 31) }),
  "2026",
);
assert.equal(
  periodLabel({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 15) }),
  "01/10/26 a 15/10/26",
);
assert.equal(periodLabel(undefined), "todas as datas");

console.log("transaction tabs: ok");
