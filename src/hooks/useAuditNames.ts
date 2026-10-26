"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCostCenters } from "@/hooks/useCostCenters";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { userService } from "@/lib/services/userService";
import type { NameResolver } from "@/lib/auditFormatter";
import type { UserProfile } from "@/lib/types";

export const companyUsersQuery = (companyId: string) => ({
  queryKey: ["company-users", companyId],
  queryFn: () => userService.getAll(companyId),
  staleTime: 5 * 60 * 1000,
});

/**
 * ID → nome de tudo que um log de auditoria referencia (contas, centros,
 * plano de contas, usuários). Sem permissão de leitura em alguma coleção, os
 * IDs dela ficam sem nome e o formatador mostra o ID abreviado.
 */
export function useAuditNames(companyId: string | undefined): {
  names: NameResolver;
  users: UserProfile[];
} {
  const { accounts: bankAccounts } = useBankAccounts(companyId);
  const { costCenters } = useCostCenters(companyId);
  const { accounts: chart } = useChartOfAccounts(companyId);
  const { data: users = EMPTY_USERS } = useQuery({
    ...companyUsersQuery(companyId ?? ""),
    enabled: !!companyId,
  });

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of bankAccounts) map.set(a.id, a.name);
    for (const c of costCenters) map.set(c.id, `${c.code} ${c.name}`);
    for (const a of chart) map.set(a.id, `${a.code} ${a.name}`);
    for (const u of users) map.set(u.uid, u.displayName || u.email);
    return map;
  }, [bankAccounts, costCenters, chart, users]);

  return { names, users };
}

const EMPTY_USERS: UserProfile[] = [];
