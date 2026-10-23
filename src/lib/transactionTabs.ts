import currency from "currency.js";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  startOfDay,
  startOfMonth,
} from "date-fns";
import type { Entity, Transaction, UserRole } from "@/lib/types";

/**
 * Regras das listas de contas a pagar e a receber.
 *
 * A lista é organizada por situação (abas), não por período: a aba "Vencidas"
 * mostra todo atraso aberto, qualquer que seja o filtro de datas. O período só
 * vale para as abas "Pagas" e "Todas".
 *
 * Rejeitadas não contam como abertas: não vão ser pagas, então não entram em
 * atraso nem nos totais a pagar. Aparecem só em "Todas".
 */

export type TabId =
  | "overdue"
  | "today"
  | "week"
  | "future"
  | "paid"
  | "all"
  | "queue";

/** Status que não estão mais esperando pagamento. */
export const CLOSED_STATUSES = ["paid", "rejected"];

export const isOpen = (t: Pick<Transaction, "status">) =>
  !CLOSED_STATUSES.includes(t.status);

export const isOverdue = (
  t: Pick<Transaction, "status" | "dueDate">,
  today = startOfDay(new Date()),
) => isOpen(t) && differenceInCalendarDays(t.dueDate, today) < 0;

/** O que cada papel tem para despachar na aba "Minha fila". */
export function queueStatuses(role: UserRole | null): string[] {
  switch (role) {
    case "approver":
      return ["pending_approval"];
    case "releaser":
      return ["pending_authorization"];
    case "admin":
    case "financial_manager":
      return ["pending_approval", "pending_authorization"];
    default:
      return [];
  }
}

export interface TabFilter {
  type: "payable" | "receivable";
  status?: string;
  statuses?: string[];
  excludeStatus?: string[];
  startDate?: Date;
  endDate?: Date;
  createdBy?: string;
  costCenterIds?: string[];
}

export interface TabContext {
  type: "payable" | "receivable";
  today: Date;
  period?: { from?: Date; to?: Date };
  /** Status específico escolhido no filtro secundário ("all" = nenhum). */
  status: string;
  queue: string[];
  createdBy?: string;
  costCenterIds?: string[];
}

export const defaultPeriod = (today = new Date()) => ({
  from: startOfMonth(today),
  to: endOfMonth(today),
});

/** Filtro de consulta de cada aba. `null` = combinação que não tem resultado. */
export function tabFilter(tab: TabId, ctx: TabContext): TabFilter | null {
  const base: TabFilter = {
    type: ctx.type,
    createdBy: ctx.createdBy,
    costCenterIds: ctx.costCenterIds,
  };
  const status = ctx.status === "all" ? undefined : ctx.status;
  const today = startOfDay(ctx.today);

  // Abas de abertas: um status fechado escolhido no filtro esvazia a aba.
  const open = (startDate?: Date, endDate?: Date): TabFilter | null => {
    if (status && CLOSED_STATUSES.includes(status)) return null;
    return status
      ? { ...base, status, startDate, endDate }
      : { ...base, excludeStatus: CLOSED_STATUSES, startDate, endDate };
  };

  switch (tab) {
    case "overdue":
      return open(undefined, addDays(today, -1));
    case "today":
      return open(today, today);
    case "week":
      return open(addDays(today, 1), addDays(today, 7));
    case "future":
      return open(addDays(today, 8), undefined);
    case "paid":
      if (status && status !== "paid") return null;
      return {
        ...base,
        status: "paid",
        startDate: ctx.period?.from,
        endDate: ctx.period?.to,
      };
    case "all":
      return {
        ...base,
        status,
        startDate: ctx.period?.from,
        endDate: ctx.period?.to,
      };
    case "queue": {
      const statuses = status
        ? ctx.queue.filter((s) => s === status)
        : ctx.queue;
      if (statuses.length === 0) return null;
      return statuses.length === 1
        ? { ...base, status: statuses[0] }
        : { ...base, statuses };
    }
  }
}

// ── Prazo ──────────────────────────────────────────────────────────────────

export type DueTone = "overdue" | "today" | "soon" | "none";

export function relativeDue(
  dueDate: Date,
  today = startOfDay(new Date()),
): { label: string; tone: DueTone } {
  const diff = differenceInCalendarDays(dueDate, today);
  if (diff < 0) {
    const days = -diff;
    return {
      label: `há ${days} ${days === 1 ? "dia" : "dias"}`,
      tone: "overdue",
    };
  }
  if (diff === 0) return { label: "hoje", tone: "today" };
  if (diff === 1) return { label: "amanhã", tone: "soon" };
  if (diff <= 7) return { label: `em ${diff} dias`, tone: "soon" };
  return { label: "", tone: "none" };
}

export const AGING_BUCKETS = [
  { label: "1 a 30 dias", max: 30 },
  { label: "31 a 60 dias", max: 60 },
  { label: "61 a 90 dias", max: 90 },
  { label: "Mais de 90 dias", max: Infinity },
] as const;

export function agingBucket(daysLate: number) {
  return AGING_BUCKETS.find((b) => daysLate <= b.max)!.label;
}

// ── Encargos por atraso ────────────────────────────────────────────────────

export interface LateFeeRule {
  /** Multa única sobre o valor, em %. */
  feePercent: number;
  /** Juros de mora simples, em % ao mês, pro rata die (mês de 30 dias). */
  monthlyInterestPercent: number;
}

/** Usual em boleto: multa de 2% (teto do CDC) + juros de mora de 1% ao mês. */
export const DEFAULT_LATE_FEE: LateFeeRule = {
  feePercent: 2,
  monthlyInterestPercent: 1,
};

export function lateFeeRule(
  entity?: Pick<Entity, "lateFeePercent" | "monthlyInterestPercent"> | null,
): LateFeeRule {
  return {
    feePercent: entity?.lateFeePercent ?? DEFAULT_LATE_FEE.feePercent,
    monthlyInterestPercent:
      entity?.monthlyInterestPercent ?? DEFAULT_LATE_FEE.monthlyInterestPercent,
  };
}

export function lateCharges(
  amount: number,
  dueDate: Date,
  paymentDate: Date,
  rule: LateFeeRule = DEFAULT_LATE_FEE,
) {
  const days = Math.max(0, differenceInCalendarDays(paymentDate, dueDate));
  if (days === 0) {
    return { days, fee: 0, interest: 0, total: currency(amount).value };
  }
  const fee = currency(amount).multiply(rule.feePercent / 100);
  const interest = currency(amount).multiply(
    (rule.monthlyInterestPercent * days) / 3000,
  );
  return {
    days,
    fee: fee.value,
    interest: interest.value,
    total: currency(amount).add(fee).add(interest).value,
  };
}

// ── Alertas de qualidade ───────────────────────────────────────────────────

/** Mesmo fornecedor/cliente, mesmo valor e mesmo vencimento. */
export function duplicateKey(t: Transaction) {
  const who = t.entityId || (t.supplierOrClient ?? "").trim().toLowerCase();
  if (!who) return null;
  return `${who}|${currency(t.amount).intValue}|${startOfDay(t.dueDate).getTime()}`;
}

export function hasComprovante(t: Transaction) {
  return !!(t.comprovanteId || t.comprovanteStoragePath || t.comprovanteUrl);
}

export function hasCostCenter(t: Transaction) {
  return !!(t.costCenterId || t.costCenterAllocation?.length);
}

/** Chave de agrupamento do histórico de pontualidade. */
export const counterpartKey = (
  t: Pick<Transaction, "entityId" | "supplierOrClient">,
) => t.entityId || (t.supplierOrClient ?? "").trim().toLowerCase() || null;
