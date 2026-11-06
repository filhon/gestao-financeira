import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { PaymentConfirmation } from "@/components/features/finance/PaymentDialog";
import type {
  CostCenter,
  Transaction,
  TransactionStatus,
  UserProfile,
  UserRole,
} from "@/lib/types";

/** Baixa ou mudança de status que corre em segundo plano, com a linha travada. */
export type TransactionActionInput = { transaction: Transaction } & (
  | { kind: "settle"; data: PaymentConfirmation }
  | { kind: "status"; status: TransactionStatus; reason?: string }
);

export type TransactionAction = TransactionActionInput & {
  companyId: string;
  actor: { uid: string; email: string };
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

/** A linha como o servidor acabou de gravar a baixa: só depois da resposta. */
export function settledRow(
  transaction: Transaction,
  data: PaymentConfirmation,
  actorUid: string,
): Transaction {
  return {
    ...transaction,
    ...data,
    bankAccountId: data.bankAccountId ?? transaction.bankAccountId,
    status: "paid",
    releasedBy: actorUid,
    releasedAt: new Date(),
  };
}

/** Troca a linha nas listas e buscas em cache, sem esperar a releitura. */
export function replaceCachedRow(qc: QueryClient, row: Transaction) {
  const swap = (items: Transaction[]) =>
    items.map((t) => (t.id === row.id ? row : t));
  qc.setQueriesData<InfiniteData<{ items: Transaction[] }>>(
    { queryKey: ["tx-list"] },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: swap(page.items),
        })),
      },
  );
  qc.setQueriesData<Transaction[]>({ queryKey: ["tx-search"] }, (old) =>
    old ? swap(old) : old,
  );
}

const COMPANY_APPROVER_ROLES: UserRole[] = [
  "approver",
  "financial_manager",
  "admin",
];

/**
 * Quem recebe o link de aprovação, que aprova sem login: vale como credencial e
 * nunca pode sair da empresa da despesa. Primeiro o aprovador de cada centro de
 * custo, como na criação; sem ele, os aprovadores da empresa. Quem pediu fica
 * de fora, para não aprovar o próprio pedido pelo link.
 */
export async function approvalRecipients(
  transaction: Pick<Transaction, "companyId" | "costCenterAllocation">,
  requesterEmail: string,
  load: {
    costCenter: (
      id: string,
    ) => Promise<Pick<CostCenter, "companyId" | "approverEmail"> | null>;
    users: () => Promise<
      Pick<UserProfile, "email" | "companyRoles" | "status" | "active">[]
    >;
  },
): Promise<string[]> {
  const { companyId, costCenterAllocation = [] } = transaction;
  const unique = (emails: (string | undefined)[]) => {
    const byKey = new Map<string, string>();
    for (const raw of emails) {
      const email = raw?.trim();
      if (email) byKey.set(email.toLowerCase(), email);
    }
    byKey.delete(requesterEmail.trim().toLowerCase());
    return [...byKey.values()];
  };

  const centers = await Promise.all(
    costCenterAllocation.map((a) => load.costCenter(a.costCenterId)),
  );
  const fromCenters = unique(
    centers
      .filter((c) => c?.companyId === companyId)
      .map((c) => c?.approverEmail),
  );
  if (fromCenters.length > 0) return fromCenters;

  const users = await load.users();
  return unique(
    users
      .filter((u) => {
        const role = u.companyRoles?.[companyId];
        return (
          !!role &&
          COMPANY_APPROVER_ROLES.includes(role) &&
          (u.status === "active" || u.active)
        );
      })
      .map((u) => u.email),
  );
}
