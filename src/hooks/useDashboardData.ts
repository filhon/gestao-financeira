import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardService } from "@/lib/services/dashboardService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";

export function useDashboardMetrics() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  return useQuery({
    queryKey: [
      "dashboard-metrics",
      selectedCompany?.id,
      user?.uid,
      onlyOwnPayables,
    ],
    queryFn: async () => {
      if (!selectedCompany || !user) return null;
      return dashboardService.getFinancialMetrics(
        selectedCompany.id,
        onlyOwnPayables ? user.uid : undefined
      );
    },
    enabled: !!selectedCompany && !!user,
  });
}

export function useUpcomingTransactions() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  return useQuery({
    queryKey: [
      "upcoming-transactions",
      selectedCompany?.id,
      user?.uid,
      onlyOwnPayables,
    ],
    queryFn: async () => {
      if (!selectedCompany || !user) return [];
      return dashboardService.getUpcomingTransactions(
        selectedCompany.id,
        onlyOwnPayables ? user.uid : undefined
      );
    },
    enabled: !!selectedCompany && !!user,
  });
}

export function useProjectedCashFlow(mode: "30days" | "year") {
  const { selectedCompany } = useCompany();

  return useQuery({
    queryKey: ["projected-cash-flow", selectedCompany?.id, mode],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getProjectedCashFlow(selectedCompany.id, mode);
    },
    enabled: !!selectedCompany,
  });
}

export function useBudgetProgress() {
  const { selectedCompany } = useCompany();

  return useQuery({
    queryKey: ["budget-progress", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getBudgetProgressByCostCenter(selectedCompany.id);
    },
    enabled: !!selectedCompany,
  });
}

export function useOverdueTransactions() {
  const { selectedCompany } = useCompany();

  return useQuery({
    queryKey: ["overdue-transactions", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getOverdueTransactions(selectedCompany.id);
    },
    enabled: !!selectedCompany,
  });
}

export function usePendingApprovals() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pending-approvals", selectedCompany?.id, user?.uid],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getPendingApprovals(
        selectedCompany.id,
        user?.uid
      );
    },
    enabled: !!selectedCompany,
  });
}

export function useRecalculateStats() {
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();

  return useMutation({
    mutationFn: async () => {
      if (!selectedCompany) throw new Error("No company selected");
      await dashboardService.recalculateCompanyStats(selectedCompany.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projected-cash-flow", selectedCompany?.id],
      });
    },
  });
}
