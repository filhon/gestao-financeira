import currency from "currency.js";
import { startOfDay, subMonths } from "date-fns";
import { Entity, Transaction } from "@/lib/types";
import { transactionService } from "@/lib/services/transactionService";
import { effectiveAmount } from "@/lib/services/paymentBatchService";
import { isOverdue } from "@/lib/transactionTabs";

export interface EntityPosition {
  /** Em aberto (a pagar + a receber), rascunho incluso. */
  open: number;
  overdue: number;
  lastPaid: Date | null;
}

const EMPTY: EntityPosition = { open: 0, overdue: 0, lastPaid: null };

/**
 * Posição de cada entidade: em aberto, vencido e último pagamento nos últimos
 * 12 meses. Lançamento sem cadastro casa pelo nome exato (sem caixa).
 */
export async function loadEntityPositions(
  companyId: string,
  entities: Entity[],
  createdBy?: string,
): Promise<Record<string, EntityPosition>> {
  const now = new Date();
  const [open, paid] = await Promise.all([
    transactionService.getOpen(companyId, createdBy),
    transactionService.getByPaymentDate({
      companyId,
      startDate: subMonths(now, 12),
      endDate: now,
      createdBy,
    }),
  ]);

  const byName = new Map(
    entities.map((e) => [e.name.trim().toLowerCase(), e.id]),
  );
  const keyOf = (t: Transaction) =>
    t.entityId ?? byName.get((t.supplierOrClient ?? "").trim().toLowerCase());

  const today = startOfDay(now);
  const acc: Record<
    string,
    { open: currency; overdue: currency; lastPaid: Date | null }
  > = {};
  const entry = (id: string) =>
    (acc[id] ??= { open: currency(0), overdue: currency(0), lastPaid: null });

  for (const t of open) {
    const id = keyOf(t);
    if (!id) continue;
    const e = entry(id);
    const amount = effectiveAmount(t);
    e.open = e.open.add(amount);
    if (isOverdue(t, today)) e.overdue = e.overdue.add(amount);
  }
  for (const t of paid) {
    const id = keyOf(t);
    if (!id || !t.paymentDate) continue;
    const e = entry(id);
    if (!e.lastPaid || t.paymentDate > e.lastPaid) e.lastPaid = t.paymentDate;
  }

  return Object.fromEntries(
    Object.entries(acc).map(([id, v]) => [
      id,
      { open: v.open.value, overdue: v.overdue.value, lastPaid: v.lastPaid },
    ]),
  );
}

export const positionOf = (
  positions: Record<string, EntityPosition> | undefined,
  id: string,
) => positions?.[id] ?? EMPTY;
