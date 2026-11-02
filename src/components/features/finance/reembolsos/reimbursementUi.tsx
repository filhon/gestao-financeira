import {
  format,
  isSameMonth,
  isFirstDayOfMonth,
  isLastDayOfMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReimbursementReport, Transaction } from "@/lib/types";
import { approvalStatus } from "@/lib/services/reimbursementReportService";
import { cn } from "@/lib/utils";

const BADGE: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Rascunho",
    className: "bg-muted text-muted-foreground",
  },
  pending_approval: {
    label: "Em aprovação",
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  approved: {
    label: "Aprovado",
    className:
      "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  },
  rejected: {
    label: "Rejeitado",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
};

export function ApprovalBadge({
  report,
}: {
  report: Pick<ReimbursementReport, "status">;
}) {
  const cfg = BADGE[approvalStatus(report)] ?? BADGE.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}

/** "set/2026", "jul a set/2026" ou "03/09 a 27/10/26". */
export function formatPeriod(start: Date, end: Date) {
  const fullMonths = isFirstDayOfMonth(start) && isLastDayOfMonth(end);
  if (fullMonths && isSameMonth(start, end))
    return format(start, "MMM/yyyy", { locale: ptBR });
  if (fullMonths && start.getFullYear() === end.getFullYear())
    return `${format(start, "MMM", { locale: ptBR })} a ${format(end, "MMM/yyyy", { locale: ptBR })}`;
  return `${format(start, "dd/MM")} a ${format(end, "dd/MM/yy")}`;
}

export type Payment = { paid: number; total: number; lastPaidAt?: Date };

export function paymentOf(items: Transaction[]): Payment {
  const paid = items.filter((t) => t.status === "paid");
  const last = paid
    .map((t) => t.paymentDate)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return { paid: paid.length, total: items.length, lastPaidAt: last };
}

export function PaymentLabel({ payment }: { payment: Payment }) {
  if (!payment.total) return <span className="text-muted-foreground">-</span>;
  if (payment.paid === payment.total)
    return (
      <span className="text-green-700 dark:text-green-400 font-medium">
        Pago
      </span>
    );
  if (payment.paid === 0)
    return <span className="text-muted-foreground">A pagar</span>;
  return (
    <span className="tabular-nums">
      {payment.paid} de {payment.total} pagos
    </span>
  );
}
