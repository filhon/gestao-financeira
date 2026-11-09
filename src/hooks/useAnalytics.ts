import { useRef } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { format } from "date-fns";
import currency from "currency.js";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  analyticsService,
  type AnalyticsParams,
} from "@/lib/services/analyticsService";
import { bankAccountService } from "@/lib/services/bankAccountService";
import { dashboardService } from "@/lib/services/dashboardService";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";
import {
  informedBalance,
  investmentBalance,
  isDuplicate,
  isInvestment,
  isSweep,
} from "@/lib/bankReconciliation";

const STALE_MS = 60_000;

/** Chaves que o botão Atualizar da Análise recarrega. */
export const ANALYTICS_QUERY_KEYS = [
  "analytics",
  "analytics-accounts",
  "analytics-cash",
  "bank-balance",
  "cash-reserve",
  "budget-progress",
];

export function useAnalyticsReport(p: AnalyticsParams) {
  const { selectedCompany } = useCompany();
  const { canViewAnalytics } = usePermissions();
  const companyId = selectedCompany?.id;
  // O botão Atualizar pede ao servidor que releia a empresa em vez de usar o
  // cache de 60 s dele; só a próxima busca vai com `fresh`.
  const fresh = useRef(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [
      "analytics",
      companyId,
      p.range.from,
      p.range.to,
      p.compare,
      p.regime,
    ],
    queryFn: ({ signal }) => {
      const opts = { fresh: fresh.current, signal };
      fresh.current = false;
      return analyticsService.getReport(companyId!, p, opts);
    },
    enabled: !!companyId && canViewAnalytics,
    staleTime: STALE_MS,
    // Trocar o período mantém o relatório anterior na tela até o novo chegar.
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    fresh.current = true;
    ANALYTICS_QUERY_KEYS.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    );
  };

  return { ...query, refresh };
}

/** Caixa disponível hoje: contas correntes e aplicação automática. */
export function useCashAvailable() {
  const { selectedCompany } = useCompany();
  const { canViewAnalytics } = usePermissions();
  const companyId = selectedCompany?.id;
  return useQuery({
    queryKey: ["analytics-cash", companyId],
    queryFn: () => dashboardService.getCashAvailable(companyId!),
    enabled: !!companyId && canViewAnalytics,
    staleTime: STALE_MS,
  });
}

export interface AccountPosition {
  id: string;
  name: string;
  bankName?: string;
  investment: boolean;
  /** Aplicação automática: conta no caixa disponível. */
  sweep: boolean;
  balance: number;
  /** Data do saldo: último extrato, fechamento ou abertura. */
  date: Date;
}

/**
 * Saldo de cada conta ativa e o rendimento reconhecido por mês nas aplicações
 * (linhas "Rendimento até…" gravadas ao fechar a conciliação).
 */
export function useAccountPositions() {
  const { selectedCompany } = useCompany();
  const { canViewAnalytics } = usePermissions();
  const companyId = selectedCompany?.id;

  return useQuery({
    queryKey: ["analytics-accounts", companyId],
    queryFn: async () => {
      const accounts = (await bankAccountService.getAll(companyId!)).filter(
        (a) => a.active,
      );
      const yields = new Map<string, number>();
      const positions = await Promise.all(
        accounts.map(async (a): Promise<AccountPosition> => {
          const base = {
            id: a.id,
            name: a.name,
            bankName: a.bankName,
            investment: isInvestment(a),
            sweep: isSweep(a),
          };
          if (!isInvestment(a)) return { ...base, ...informedBalance(a) };
          const items = await reconciliationSessionService.getAccountItems(
            companyId!,
            a.id,
          );
          for (const item of items) {
            if (item.origin !== "yield" || isDuplicate(item)) continue;
            const key = format(new Date(item.date), "yyyy-MM");
            yields.set(
              key,
              currency(yields.get(key) ?? 0).add(item.amount).value,
            );
          }
          return { ...base, ...investmentBalance(a, items) };
        }),
      );
      return {
        positions: positions.sort((a, b) => b.balance - a.balance),
        /** Rendimento reconhecido por mês ("yyyy-MM"), todas as aplicações. */
        yields: Object.fromEntries(yields),
      };
    },
    enabled: !!companyId && canViewAnalytics,
    staleTime: STALE_MS,
  });
}
