/**
 * Verificação das regras das abas de contas a pagar/receber e dos encargos.
 *   npm run check:transaction-tabs
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  agingBucket,
  lateCharges,
  relativeDue,
  tabFilter,
  type TabContext,
} from "../src/lib/transactionTabs";

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

console.log("transaction tabs: ok");
