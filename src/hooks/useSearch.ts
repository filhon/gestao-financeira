"use client";

import { useCallback } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCompany } from "@/components/providers/CompanyProvider";
import type { Transaction } from "@/lib/types";
import type {
  SearchResponse,
  SearchRowInfo,
} from "@/app/api/internal/search/route";

/** Transação vinda de uma rota (datas em ISO) de volta com `Date`. */
export const reviveTransaction = (t: Record<string, unknown>) => {
  const d = (v: unknown) => (v ? new Date(v as string) : undefined);
  const hold = t.paymentHold as Record<string, unknown> | null;
  const promise = t.paymentPromise as Record<string, unknown> | null;
  return {
    ...t,
    dueDate: d(t.dueDate) ?? new Date(),
    paymentDate: d(t.paymentDate),
    approvedAt: d(t.approvedAt),
    releasedAt: d(t.releasedAt),
    createdAt: d(t.createdAt),
    updatedAt: d(t.updatedAt),
    approvalTokenExpiresAt: d(t.approvalTokenExpiresAt),
    reconciledAt: d(t.reconciledAt),
    paymentHold: hold ? { ...hold, at: d(hold.at) } : null,
    paymentPromise: promise
      ? { ...promise, date: d(promise.date), at: d(promise.at) }
      : null,
  } as Transaction;
};

export interface SearchRow {
  tx: Transaction;
  info: SearchRowInfo;
}

export type SearchResult = Omit<SearchResponse, "rows"> & {
  rows: SearchRow[];
};

// A próxima busca ignora o cache do servidor (60 s), para refletir uma edição.
let forceFresh = false;

/** Chame depois de alterar transações: recarrega as buscas abertas sem cache. */
export function invalidateSearch(queryClient: QueryClient) {
  forceFresh = true;
  return queryClient.invalidateQueries({ queryKey: ["search"] });
}

/**
 * Busca global no servidor. `limit` pequeno serve à paleta; sem limite, à
 * página.
 */
export function useSearch(
  query: string,
  { limit, enabled = true }: { limit?: number; enabled?: boolean } = {},
) {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();

  const result = useQuery({
    queryKey: ["search", companyId, query, limit ?? null],
    queryFn: async ({ signal }): Promise<SearchResult> => {
      const params = new URLSearchParams({ q: query, companyId: companyId! });
      if (limit) params.set("limit", String(limit));
      if (forceFresh) params.set("fresh", "1");
      forceFresh = false;
      const res = await fetch(`/api/internal/search?${params}`, {
        credentials: "include",
        signal,
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error ?? `Busca falhou (${res.status})`);
      const data = json as SearchResponse;
      return {
        ...data,
        rows: data.rows.map((r) => ({
          tx: reviveTransaction(r.tx),
          info: r.info,
        })),
      };
    },
    enabled: enabled && !!companyId && query.trim().length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const refresh = useCallback(
    () => invalidateSearch(queryClient),
    [queryClient],
  );

  return { ...result, refresh };
}

// ── Buscas recentes e salvas (por empresa, neste navegador) ──────────────────
// ponytail: localStorage; coleção no Firestore quando precisar valer entre
// aparelhos ou ser compartilhada com a equipe.

export interface SavedSearch {
  name: string;
  /** Query string completa da página /busca (termo + filtros laterais). */
  params: string;
}

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage indisponível (modo privado, cota): segue sem lembrar.
  }
}

export const recentSearches = {
  get: (companyId: string) => read<string>(`recent-searches-${companyId}`),
  add(companyId: string, query: string) {
    const prev = recentSearches.get(companyId).filter((q) => q !== query);
    write(`recent-searches-${companyId}`, [query, ...prev].slice(0, 5));
  },
};

export const savedSearches = {
  get: (companyId: string) => read<SavedSearch>(`saved-searches-${companyId}`),
  save(companyId: string, search: SavedSearch) {
    const prev = savedSearches
      .get(companyId)
      .filter((s) => s.name !== search.name);
    write(`saved-searches-${companyId}`, [search, ...prev].slice(0, 20));
  },
  remove(companyId: string, name: string) {
    write(
      `saved-searches-${companyId}`,
      savedSearches.get(companyId).filter((s) => s.name !== name),
    );
  },
};
