"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChartAccount } from "@/lib/types";
import { chartOfAccountsService } from "@/lib/services/chartOfAccountsService";

/**
 * Plano de contas em cache compartilhado entre a tela do plano e os
 * formulários de lançamento. Após qualquer escrita, invalide
 * `["chart-of-accounts"]`.
 */
export const chartOfAccountsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["chart-of-accounts", companyId],
    queryFn: () => chartOfAccountsService.getAll(companyId),
  });

export function useChartOfAccounts(companyId: string | undefined) {
  const query = useQuery({
    ...chartOfAccountsQuery(companyId ?? ""),
    enabled: !!companyId,
  });
  const requiredFrom = useQuery({
    queryKey: ["chart-of-accounts", companyId, "required-from"],
    queryFn: () => chartOfAccountsService.getRequiredFrom(companyId!),
    enabled: !!companyId,
  });
  return {
    ...query,
    accounts: query.data ?? EMPTY,
    requiredFrom: requiredFrom.data ?? null,
    requiredFromLoading: requiredFrom.isLoading,
  };
}

export { accountRequiredFor, natureFitsSide } from "@/lib/chartOfAccounts";

// Referência estável: um `[]` novo a cada render dispararia efeitos dependentes.
const EMPTY: ChartAccount[] = [];
