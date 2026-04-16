import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "@/lib/services/dashboardService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";

export function useDashboardMetrics(year?: number) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  return useQuery({
    queryKey: [
      "dashboard-metrics",
      selectedCompany?.id,
      user?.uid,
      onlyOwnPayables,
      year,
    ],
    queryFn: async () => {
      if (!selectedCompany || !user) return null;
      return dashboardService.getFinancialMetrics(
        selectedCompany.id,
        onlyOwnPayables ? user.uid : undefined,
        year,
      );
    },
    enabled: !!selectedCompany && !!user,
  });
}

export function useProjectedCashFlow(mode: "30days" | "year", year?: number) {
  const { selectedCompany } = useCompany();

  return useQuery({
    queryKey: ["projected-cash-flow", selectedCompany?.id, mode, year],
    queryFn: async () => {
      if (!selectedCompany) return null;
      return dashboardService.getProjectedCashFlow(
        selectedCompany.id,
        mode,
        year,
      );
    },
    enabled: !!selectedCompany,
  });
}

export function useBudgetProgress(year?: number) {
  const { selectedCompany } = useCompany();

  return useQuery({
    queryKey: ["budget-progress", selectedCompany?.id, year],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getBudgetProgressByCostCenter(
        selectedCompany.id,
        year,
      );
    },
    enabled: !!selectedCompany,
  });
}

export function useOverdueTransactions() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  return useQuery({
    queryKey: [
      "overdue-transactions",
      selectedCompany?.id,
      user?.uid,
      onlyOwnPayables,
    ],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getOverdueTransactions(
        selectedCompany.id,
        onlyOwnPayables ? user?.uid : undefined,
      );
    },
    enabled: !!selectedCompany,
  });
}

export function usePendingApprovals() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  return useQuery({
    queryKey: [
      "pending-approvals",
      selectedCompany?.id,
      user?.uid,
      onlyOwnPayables,
    ],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getPendingApprovals(
        selectedCompany.id,
        onlyOwnPayables ? user?.uid : undefined,
      );
    },
    enabled: !!selectedCompany,
  });
}
