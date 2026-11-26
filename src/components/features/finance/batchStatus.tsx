import { cn } from "@/lib/utils";

/**
 * Status de lote e de transação dentro do lote. Mesma paleta da lista de
 * contas (TransactionList), para a cor de "Pago" ser a mesma em todo lugar.
 */
const STATUS: Record<string, { label: string; className: string }> = {
  open: {
    label: "Aberto",
    className: "bg-muted text-foreground/80",
  },
  draft: {
    label: "Rascunho",
    className: "bg-muted text-foreground/80",
  },
  pending_approval: {
    label: "Aguardando aprovação",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  approved: {
    label: "Aprovado",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  pending_authorization: {
    label: "Aguardando autorização",
    className:
      "bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300",
  },
  authorized: {
    label: "Autorizado",
    className:
      "bg-brand-700 text-white dark:bg-brand-600 dark:text-white",
  },
  paid: {
    label: "Pago",
    className: "bg-info-100 text-info-800 dark:bg-info-950/60 dark:text-info-300",
  },
  received: {
    label: "Recebido",
    className: "bg-info-100 text-info-800 dark:bg-info-950/60 dark:text-info-300",
  },
  rejected: {
    label: "Rejeitado",
    className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
};

export const batchStatusLabel = (status: string) =>
  STATUS[status]?.label ?? status;

export function BatchStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS[status]?.className ?? "bg-muted text-foreground/80",
      )}
    >
      {batchStatusLabel(status)}
    </span>
  );
}
