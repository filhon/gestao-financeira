"use client";

import { useEffect, useMemo } from "react";
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { invalidateBatchQueries } from "@/hooks/useBatchActions";
import { invalidateSearch } from "@/hooks/useSearch";
import { friendlyError } from "@/lib/errors";
import { db } from "@/lib/firebase/client";
import { emailService } from "@/lib/services/emailService";
import { transactionService } from "@/lib/services/transactionService";
import {
  pendingLabel,
  TX_ACTION_OPTIONS,
  TX_ACTION_PENDING,
  type TransactionAction,
  type TransactionActionInput,
} from "@/lib/transactionAction";
import type { Transaction, TransactionStatus } from "@/lib/types";

const LIST_KEYS = [
  "tx-list",
  "tx-tabs",
  "tx-search",
  "payable-transactions",
  "receivable-transactions",
  "overdue-transactions",
  "pending-approvals",
];

function refreshAfterAction(qc: QueryClient, transaction: Transaction) {
  return Promise.all([
    ...LIST_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })),
    invalidateSearch(qc),
    ...(transaction.batchId ? [invalidateBatchQueries(qc)] : []),
  ]);
}

async function notifyStatusChange(
  updated: Transaction,
  status: TransactionStatus,
  actorName: string,
) {
  try {
    if (status === "pending_approval") {
      const q = query(
        collection(db, "users"),
        where("role", "in", ["admin", "approver", "financial_manager"]),
      );
      const snap = await getDocs(q);
      const emails = snap.docs.map((d) => d.data().email).filter(Boolean);
      if (emails.length > 0) {
        await emailService.sendApprovalRequest(updated, emails[0]);
      }
      return;
    }
    const creator = await getDoc(doc(db, "users", updated.createdBy));
    const creatorEmail = creator.data()?.email;
    // O e-mail fala do status novo (e do motivo, se rejeitada).
    if (creatorEmail) {
      await emailService.sendStatusUpdate(updated, creatorEmail, actorName);
    }
  } catch (error) {
    console.error("Failed to send email notification:", error);
    toast.warning("Status atualizado, mas houve erro ao enviar e-mail.");
  }
}

function successToast(action: TransactionAction) {
  if (action.kind === "settle") {
    toast.success(
      action.transaction.type === "payable"
        ? "Pagamento confirmado!"
        : "Recebimento confirmado!",
    );
  } else if (action.status === "pending_approval") {
    toast.success("Solicitação enviada para aprovação!");
  } else if (action.status === "approved") {
    toast.success("Transação aprovada com sucesso!");
  } else if (action.status === "rejected") {
    toast.info("Transação rejeitada.");
  } else if (action.status === "paid") {
    toast.success("Pagamento/Recebimento confirmado!");
  }
}

/**
 * Dispara a ação e libera a tela na hora: a linha fica travada até o servidor
 * responder e a lista ser relida. O sucesso só aparece depois da resposta.
 */
export function useTransactionAction() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const mutation = useMutation<
    Transaction | undefined,
    unknown,
    TransactionAction
  >({
    ...TX_ACTION_OPTIONS,
    mutationFn: async (a) => {
      if (a.kind === "status") {
        return transactionService.updateStatus(
          a.transaction.id,
          a.status,
          a.actor,
          a.companyId,
          a.reason,
        );
      }
      await transactionService.settle(
        a.transaction.id,
        a.data,
        a.actor,
        a.companyId,
      );
      return undefined;
    },
    // Devolver a promessa mantém a linha travada até a lista vir atualizada,
    // sem piscar o status antigo. Roda mesmo se o usuário já mudou de tela.
    onSuccess: async (updated, a) => {
      successToast(a);
      await Promise.all([
        refreshAfterAction(qc, a.transaction),
        a.kind === "status" && updated
          ? notifyStatusChange(updated, a.status, a.actorName)
          : null,
      ]);
    },
    onError: (error, a) => {
      console.error("Error running transaction action:", error);
      toast.error(
        friendlyError(
          error,
          a.kind === "settle"
            ? "Erro ao registrar pagamento."
            : "Erro ao atualizar status. Tente novamente.",
        ),
        {
          duration: 10_000,
          // O diálogo já fechou: refazer não obriga a digitar tudo de novo.
          action: {
            label: "Tentar de novo",
            onClick: () => start(a),
          },
        },
      );
    },
  });

  const start = (
    action: TransactionAction,
    onDone?: (updated?: Transaction) => void,
  ) => {
    const locked = qc
      .getMutationCache()
      .findAll(TX_ACTION_PENDING)
      .some(
        (m) =>
          (m.state.variables as TransactionAction | undefined)?.transaction
            .id === action.transaction.id,
      );
    if (locked) return;
    mutation.mutateAsync(action).then(onDone, () => {});
  };

  return (
    input: TransactionActionInput,
    onDone?: (updated?: Transaction) => void,
  ) => {
    if (!user || !selectedCompany) return;
    start(
      {
        ...input,
        companyId: selectedCompany.id,
        actor: { uid: user.uid, email: user.email },
        actorName: user.displayName,
      },
      onDone,
    );
  };
}

/** Rótulo de cada conta com ação em andamento, por id. */
export function usePendingTransactions() {
  const pending = useMutationState({
    filters: TX_ACTION_PENDING,
    select: (m) => m.state.variables as TransactionAction,
  });
  return useMemo(
    () => new Map(pending.map((a) => [a.transaction.id, pendingLabel(a)])),
    [pending],
  );
}

/**
 * Fechar a aba no meio da ação perderia a auditoria e o e-mail, que saem do
 * navegador depois da resposta. Avisa antes.
 */
export function useTransactionActionGuard() {
  const running = useIsMutating(TX_ACTION_PENDING) > 0;
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
}
