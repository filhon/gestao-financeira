"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TransactionDetailsDialog } from "./TransactionDetailsDialog";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { useCostCenterStore } from "@/lib/store/useCostCenterStore";
import { useCompany } from "@/components/providers/CompanyProvider";

const TX_QUERY_KEYS = [
  "payable-transactions",
  "receivable-transactions",
  "busca-transactions",
  "overdue-transactions",
  "pending-approvals",
];

export function GlobalTransactionDetailModal() {
  const { transaction, isOpen, close } = useTransactionDetailStore();
  const { costCenters, fetchCostCenters } = useCostCenterStore();
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen && selectedCompany?.id) {
      fetchCostCenters(selectedCompany.id);
    }
  }, [isOpen, selectedCompany?.id, fetchCostCenters]);

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
