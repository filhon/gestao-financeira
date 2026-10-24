import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "@/lib/services/dashboardService";
import { entityService } from "@/lib/services/entityService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";

// Sem isto cada foco de janela relê centenas de baixas. Um minuto basta para
// um painel; o botão "Atualizar" força a releitura quando preciso.
const DASHBOARD_STALE_MS = 60_000;

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
    staleTime: DASHBOARD_STALE_MS,
  });
}

/** `year` só vale no modo "year"; os 30 dias partem sempre de hoje. */
export function useProjectedCashFlow(mode: "30days" | "year", year?: number) {
  const { selectedCompany } = useCompany();
  const scopedYear = mode === "year" ? year : undefined;

  return useQuery({
    queryKey: ["projected-cash-flow", selectedCompany?.id, mode, scopedYear],
    queryFn: async () => {
      if (!selectedCompany) return null;
      return dashboardService.getProjectedCashFlow(
        selectedCompany.id,
        mode,
        scopedYear,
      );
    },
    enabled: !!selectedCompany,
    staleTime: DASHBOARD_STALE_MS,
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
    staleTime: DASHBOARD_STALE_MS,
  });
}

/** Fila do dia: vencidas, vencendo hoje e o que espera a ação do papel. */
export function useActionQueue() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { currentRole, onlyOwnPayables } = usePermissions();
  const createdBy = onlyOwnPayables ? user?.uid : undefined;

  return useQuery({
    queryKey: ["action-queue", selectedCompany?.id, currentRole, createdBy],
    queryFn: async () => {
      if (!selectedCompany) return [];
      return dashboardService.getActionQueue(
        selectedCompany.id,
        currentRole,
        createdBy,
      );
    },
    enabled: !!selectedCompany && !!user,
    staleTime: DASHBOARD_STALE_MS,
  });
}

/**
 * Entidades marcadas como parte relacionada. Mesma chave de cache das listas
 * de contas ("entities-all"), então não custa leitura extra quando já veio.
 */
export function useRelatedPartyIds() {
  const { selectedCompany } = useCompany();
  const { data } = useQuery({
    queryKey: ["entities-all", selectedCompany?.id],
    queryFn: () => entityService.getAll(selectedCompany!.id),
    enabled: !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(
    () => new Set((data ?? []).filter((e) => e.relatedParty).map((e) => e.id)),
    [data],
  );
}

/** Chaves que o botão "Atualizar" do dashboard recarrega. */
export const DASHBOARD_QUERY_KEYS = [
  "dashboard-metrics",
  "projected-cash-flow",
  "budget-progress",
  "action-queue",
];
