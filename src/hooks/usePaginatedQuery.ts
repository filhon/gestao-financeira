"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Formato padrão retornado pelos services `getPaginated` / `getAll`. */
export interface PaginatedServiceResult<T> {
  /** Os itens desta página (chave flexível: transactions, templates, etc.) */
  items: T[];
  /** Cursor do Firestore para a próxima página (null = sem mais páginas). */
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

export interface UsePaginatedQueryOptions<T, TFilters = unknown> {
  /** Chave base do React Query (ex: ["transactions", companyId]). */
  queryKey: QueryKey;

  /**
   * Função que chama o service e retorna `{ items, lastDoc }`.
   * Recebe `pageSize` e o `lastDoc` do cursor anterior (null na 1ª página).
   */
  queryFn: (
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
  ) => Promise<PaginatedServiceResult<T>>;

  /** Quantidade de itens por página (padrão: 25). */
  pageSize?: number;

  /** Se `false`, a query não será executada (ex: aguardando companyId). */
  enabled?: boolean;

  /** Filtros que, ao mudar, resetam a paginação automaticamente. */
  filters?: TFilters;

  /**
   * Tempo em ms em que os dados são considerados "frescos"
   * (padrão: herda do QueryClient — 60s).
   */
  staleTime?: number;
}

export interface UsePaginatedQueryReturn<T> {
  /** Todos os itens acumulados de todas as páginas carregadas. */
  items: T[];

  /** Indica se há mais páginas para carregar. */
  hasMore: boolean;

  /** Carrega a próxima página (equivale ao antigo `fetchData(true)`). */
  loadMore: () => void;

  /** Indica se a query inicial está carregando. */
  isLoading: boolean;

  /** Indica se está buscando a próxima página (útil para spinner no botão). */
  isFetchingNextPage: boolean;

  /** Indica se a query está em estado de erro. */
  isError: boolean;

  /** O erro, se houver. */
  error: Error | null;

  /**
   * Invalida o cache e refaz a busca do zero.
   * Use após criar/editar/deletar um item.
   */
  refresh: () => Promise<void>;

  /**
   * Atualiza otimisticamente um item na lista local (sem refetch).
   * Útil para updates onde o backend já retornou o item atualizado.
   */
  updateItem: (id: string, updater: (item: T) => T) => void;

  /**
   * Remove otimisticamente um item da lista local (sem refetch).
   */
  removeItem: (id: string) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePaginatedQuery<T extends { id: string }, TFilters = unknown>(
  options: UsePaginatedQueryOptions<T, TFilters>,
): UsePaginatedQueryReturn<T> {
  const {
    queryKey,
    queryFn,
    pageSize = 25,
    enabled = true,
    staleTime,
  } = options;

  const queryClient = useQueryClient();

  // Ref estável para não causar loops de dependência
  const queryFnRef = useRef(queryFn);
  useEffect(() => {
    queryFnRef.current = queryFn;
  });

  const stableQueryFn = useCallback(
    (ps: number, ld: QueryDocumentSnapshot<DocumentData> | null) =>
      queryFnRef.current(ps, ld),
    [],
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const result = await stableQueryFn(pageSize, pageParam ?? null);
      return result;
    },
    initialPageParam: null as QueryDocumentSnapshot<DocumentData> | null,
    getNextPageParam: (lastPage) => {
      // Se retornou menos itens que o tamanho da página, não há mais páginas
      if (lastPage.items.length < pageSize) return undefined;
      return lastPage.lastDoc ?? undefined;
    },
    enabled,
    staleTime,
  });

  // Achatar todas as páginas em um único array
  const items = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  const hasMore = hasNextPage ?? false;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const updateItem = useCallback(
    (id: string, updater: (item: T) => T) => {
      queryClient.setQueryData(queryKey, (oldData: typeof data) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? updater(item) : item,
            ),
          })),
        };
      });
    },
    [queryClient, queryKey],
  );

  const removeItem = useCallback(
    (id: string) => {
      queryClient.setQueryData(queryKey, (oldData: typeof data) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== id),
          })),
        };
      });
    },
    [queryClient, queryKey],
  );

  return {
    items,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    isError,
    error: error as Error | null,
    refresh,
    updateItem,
    removeItem,
  };
}
