"use client";

import { useQueryClient } from "@tanstack/react-query";
import { TransactionDetailsDialog } from "./TransactionDetailsDialog";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenters } from "@/hooks/useCostCenters";

const TX_QUERY_KEYS = [
  "payable-transactions",
  "receivable-transactions",
  "busca-transactions",
  "overdue-transactions",
  "pending-approvals",
];

export function GlobalTransactionDetailModal() {
  const { transaction, isOpen, close } = useTransactionDetailStore();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();
  const queryClient = useQueryClient();
  // Busca só ao abrir; fechado, segue usando o que já está em cache.
  const { costCenters } = useCostCenters(
    isOpen ? selectedCompany?.id : undefined,
    onlyOwnPayables ? user?.uid : undefined,
  );

  const handleUpdate = () => {
    queryClient.invalidateQueries({
      predicate: (query) => TX_QUERY_KEYS.includes(query.queryKey[0] as string),
    });
  };

  return (
    <TransactionDetailsDialog
      transaction={transaction}
      isOpen={isOpen}
      onClose={close}
      onUpdate={handleUpdate}
      costCenters={costCenters}
    />
  );
}
