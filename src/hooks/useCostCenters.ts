"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { costCenterLedgerService } from "@/lib/services/costCenterLedgerService";

/**
 * Centros de custo e saldos em cache compartilhado entre telas e formulários.
 * Abrir o formulário de despesa ou voltar a uma tela mostra o cache na hora e
 * revalida em segundo plano. Após criar/editar/excluir um centro, invalide
 * `["cost-centers"]`.
 */
export const costCentersQuery = (companyId: string, forUserId?: string) =>
  queryOptions({
    queryKey: ["cost-centers", companyId, forUserId ?? "all"],
    queryFn: () => costCenterService.getAll(companyId, forUserId),
  });

/**
 * Saldo muda a cada despesa lançada, por isso `staleTime: 0`: mostra o último
 * valor conhecido e sempre confere com o servidor ao montar. A Cloud Function
 * continua sendo a autoridade na hora de gravar.
 */
export const costCenterBalancesQuery = (
  companyId: string,
  costCenters: CostCenter[],
  year: number,
) =>
  queryOptions({
    queryKey: [
      "cost-center-balances",
      companyId,
      year,
      costCenters.map((c) => c.id).join(","),
    ],
    queryFn: () =>
      costCenterLedgerService.getBalances(companyId, costCenters, year),
    staleTime: 0,
  });

export function useCostCenters(
  companyId: string | undefined,
  forUserId?: string,
) {
  const query = useQuery({
    ...costCentersQuery(companyId ?? "", forUserId),
    enabled: !!companyId,
  });
  return { ...query, costCenters: query.data ?? EMPTY };
}

export function useCostCenterBalances(
  companyId: string | undefined,
  costCenters: CostCenter[],
  year: number,
  enabled = true,
) {
  return useQuery({
    ...costCenterBalancesQuery(companyId ?? "", costCenters, year),
    enabled: enabled && !!companyId && costCenters.length > 0,
  });
}

// Referência estável: um `[]` novo a cada render dispararia efeitos dependentes.
const EMPTY: CostCenter[] = [];
