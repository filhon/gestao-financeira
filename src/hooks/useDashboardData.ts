import { useQuery } from "@tanstack/react-query";
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
