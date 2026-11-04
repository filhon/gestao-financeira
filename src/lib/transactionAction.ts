import type { PaymentConfirmation } from "@/components/features/finance/PaymentDialog";
import type { Transaction, TransactionStatus } from "@/lib/types";

/** Baixa ou mudança de status que corre em segundo plano, com a linha travada. */
export type TransactionActionInput = { transaction: Transaction } & (
  | { kind: "settle"; data: PaymentConfirmation }
  | { kind: "status"; status: TransactionStatus; reason?: string }
);

export type TransactionAction = TransactionActionInput & {
  companyId: string;
  actor: { uid: string; email: string };
  actorName: string;
};

export const TX_ACTION_OPTIONS = {
  mutationKey: ["transaction-action"],
  // Sem internet a chamada falha e avisa, em vez de ficar pausada com a linha
  // presa em "Confirmando…" e executar uma baixa quando a rede voltar.
  networkMode: "always",
} as const;

export const TX_ACTION_PENDING = {
  mutationKey: TX_ACTION_OPTIONS.mutationKey,
  status: "pending",
} as const;

const STATUS_LABEL: Partial<Record<TransactionStatus, string>> = {
  approved: "Aprovando…",
  rejected: "Rejeitando…",
  pending_approval: "Enviando…",
};

export function pendingLabel(action: TransactionActionInput) {
  if (action.kind === "settle") return "Confirmando…";
  return STATUS_LABEL[action.status] ?? "Atualizando…";
}
