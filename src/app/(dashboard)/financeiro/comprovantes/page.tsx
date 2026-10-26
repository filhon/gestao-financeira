"use client";

import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import {
  Upload,
  Search,
  Download,
  Eye,
  Link2Off,
  MoreHorizontal,
  RefreshCw,
  Share2,
  SlidersHorizontal,
  X,
  Loader2,
  FileText,
  Trash2,
  Sparkles,
  CheckCircle2,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { companyService } from "@/lib/services/companyService";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { format, endOfDay, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { Comprovante, Transaction, ComprovanteMatchStatus } from "@/lib/types";
import {
  comprovanteService,
  type ComprovanteFilter,
} from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { cn, formatCurrency, comprovanteProxyUrl } from "@/lib/utils";
import { ComprovanteStatusBadge } from "@/components/features/finance/comprovantes/ComprovanteStatusBadge";
import { UploadComprovanteDialog } from "@/components/features/finance/comprovantes/UploadComprovanteDialog";
import {
  MatchReviewPanel,
  txCandidatesKey,
  type ReviewResult,
} from "@/components/features/finance/comprovantes/MatchReviewPanel";
import { InsightLine } from "@/components/features/finance/comprovantes/InsightLine";
import {
  amountDifference,
  isSafeToBulkConfirm,
  lacksReceipt,
  linkedTransactionIds,
  readNameDiffers,
  receiptInsight,
  receiptsStartKey,
  suggestedReceiptsStart,
  titlesTotal,
} from "@/components/features/finance/comprovantes/receiptInsight";

// ── Constants ────────────────────────────────────────────────────────────────

type TabKey =
  | "pending"
  | "unmatched"
  | "manual"
  | "missing"
  | "matched"
  | "all";

const TAB_STATUSES: Record<
  Exclude<TabKey, "missing">,
  ComprovanteMatchStatus[]
> = {
  pending: ["pending_review"],
  unmatched: ["unmatched", "rejected_match"],
  manual: ["needs_manual"],
  matched: ["matched"],
  all: [],
};

/** Status que ainda pedem uma decisão humana. */
const ACTIONABLE = new Set<ComprovanteMatchStatus>([
  "pending_review",
  "unmatched",
  "rejected_match",
  "needs_manual",
]);

const STATS_QUERY_KEY = (companyId: string | undefined) => [
  "comprovante-stats",
  companyId,
];

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ── Swipe helper ─────────────────────────────────────────────────────────────

function useSwipe(onSwipeLeft?: () => void, threshold = 60) {
  const startX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (dx < -threshold) onSwipeLeft?.();
    startX.current = null;
  };

  return { onTouchStart, onTouchEnd };
}

// ── Row actions (desktop + mobile) ───────────────────────────────────────────

interface RowActionsProps {
  comprovante: Comprovante;
  canUpload: boolean;
  sharing: boolean;
  onOpenReview: (c: Comprovante) => void;
  onShare: (c: Comprovante) => void;
  onSetRemoveId: (id: string) => void;
  onSetDeleteId: (id: string) => void;
  triggerClassName?: string;
}

function RowActions({
  comprovante: c,
  canUpload,
  sharing,
  onOpenReview,
  onShare,
  onSetRemoveId,
  onSetDeleteId,
  triggerClassName,
}: RowActionsProps) {
  const canRemove =
    c.matchStatus === "matched" && !!c.transactionId && canUpload;
  const canDelete =
    (c.matchStatus === "unmatched" ||
      c.matchStatus === "rejected_match" ||
      c.matchStatus === "needs_manual") &&
    canUpload;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", triggerClassName)}
          aria-label="Ações do comprovante"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onOpenReview(c)} className="gap-2">
          <Eye className="h-4 w-4" />
          {ACTIONABLE.has(c.matchStatus) && canUpload
            ? "Revisar associação"
            : "Ver comprovante"}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={comprovanteProxyUrl(c.storagePath)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex cursor-pointer items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Baixar comprovante
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onShare(c)}
          disabled={sharing}
          className="gap-2"
        >
          {sharing ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="h-4 w-4" />
          )}
          {sharing ? "Preparando…" : "Enviar"}
        </DropdownMenuItem>
        {(canRemove || canDelete) && <DropdownMenuSeparator />}
        {canRemove && (
          <DropdownMenuItem
            onClick={() => onSetRemoveId(c.id)}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Link2Off className="h-4 w-4" />
            Remover associação
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            onClick={() => onSetDeleteId(c.id)}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Excluir comprovante
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Mobile comprovante card ───────────────────────────────────────────────────

const MobileComprovanteCard = memo(function MobileComprovanteCard({
  txs,
  ...actions
}: RowActionsProps & { txs: Transaction[] }) {
  const c = actions.comprovante;
  const canReview = ACTIONABLE.has(c.matchStatus) && actions.canUpload;
  const swipe = useSwipe(canReview ? () => actions.onOpenReview(c) : undefined);
  const date = c.matchedDate ?? txs[0]?.paymentDate;

  return (
    <div
      {...swipe}
      className="flex select-none items-start gap-3 px-4 py-3.5"
      onClick={() => actions.onOpenReview(c)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium leading-snug">
            {txs[0]?.description ?? c.matchedEntity ?? "Sem título vinculado"}
            {txs.length > 1 && (
              <span className="text-muted-foreground">
                {" "}
                e mais {txs.length - 1}
              </span>
            )}
          </p>
          <span className="shrink-0 font-financial text-sm font-semibold">
            {c.matchedAmount != null
              ? formatCurrency(c.matchedAmount)
              : txs.length
                ? formatCurrency(titlesTotal(txs))
                : "sem valor"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[
            txs[0]?.supplierOrClient ?? c.matchedEntity,
            date && format(date, "dd MMM yyyy", { locale: ptBR }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <ComprovanteStatusBadge status={c.matchStatus} />
          <InsightLine insight={receiptInsight(c, txs)} />
        </div>
      </div>
      <RowActions {...actions} triggerClassName="-mr-2 h-11 w-11" />
    </div>
  );
});

// ── Main page ────────────────────────────────────────────────────────────────

export default function ComprovantesPage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();
  const queryClient = useQueryClient();

  const canUpload = isAdmin || isFinancialManager;
  const companyId = selectedCompany?.id;
  const actor =
    selectedCompany && user
      ? { companyId: selectedCompany.id, userEmail: user.email ?? "" }
      : undefined;

  // ── Filters ──────────────────────────────────────────────────────────────────
  // A fila abre primeiro: é o trabalho do dia. O resto é arquivo.
  const [tab, setTab] = useState<TabKey>("pending");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const hasActiveFilters = !!dateRange?.from || !!searchTerm;
  const clearFilters = () => {
    setDateRange(undefined);
    setSearchTerm("");
  };

  const filters: ComprovanteFilter = useMemo(
    () => ({
      statuses: tab === "missing" ? [] : TAB_STATUSES[tab],
      startDate: dateRange?.from ? startOfDay(dateRange.from) : undefined,
      endDate: dateRange?.from
        ? endOfDay(dateRange.to ?? dateRange.from)
        : undefined,
      searchText: debouncedSearch || undefined,
    }),
    [tab, dateRange, debouncedSearch],
  );

  // ── Stats ────────────────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: STATS_QUERY_KEY(companyId),
    queryFn: () => comprovanteService.getStats(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { data: filteredCount } = useQuery({
    queryKey: ["comprovante-count", companyId, filters],
    queryFn: () => comprovanteService.count(companyId!, filters),
    enabled: !!companyId && tab !== "missing",
    staleTime: 60_000,
  });

  // Pagáveis pagos/autorizados: alimentam "Pagos sem comprovante" e a busca
  // manual do painel (mesma chave, uma leitura só).
  const { data: txCandidates = [], isLoading: candidatesLoading } = useQuery({
    queryKey: txCandidatesKey(companyId),
    queryFn: () =>
      transactionService.getAll({
        companyId: companyId!,
        type: "payable",
        statuses: ["paid", "authorized"],
      }),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  // Data de corte: pagamentos de antes do controle de comprovantes não são
  // pendência. Sem data definida, vale a sugestão (mês do 1º comprovante).
  const { data: receiptsStart, isLoading: receiptsStartLoading } = useQuery({
    queryKey: receiptsStartKey(companyId),
    queryFn: () => companyService.getReceiptsStartDate(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const suggestedStart = useMemo(
    () => suggestedReceiptsStart(txCandidates),
    [txCandidates],
  );
  const cutoff = receiptsStart ?? suggestedStart;

  const missingAll = useMemo(
    () =>
      receiptsStartLoading
        ? []
        : txCandidates.filter(
            (t) =>
              lacksReceipt(t) &&
              (!cutoff || (!!t.paymentDate && t.paymentDate >= cutoff)),
          ),
    [txCandidates, cutoff, receiptsStartLoading],
  );
  const missing = useMemo(() => {
    const terms = normalize(searchTerm).split(/\s+/).filter(Boolean);
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.from
      ? endOfDay(dateRange.to ?? dateRange.from)
      : null;
    return missingAll
      .filter((t) => {
        if (
          from &&
          (!t.paymentDate || t.paymentDate < from || t.paymentDate > to!)
        ) {
          return false;
        }
        if (!terms.length) return true;
        const hay = normalize(`${t.description} ${t.supplierOrClient ?? ""}`);
        return terms.every((term) => hay.includes(term));
      })
      .sort(
        (a, b) =>
          (b.paymentDate?.getTime() ?? 0) - (a.paymentDate?.getTime() ?? 0),
      );
  }, [missingAll, searchTerm, dateRange]);

  const invalidateCounts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY(companyId) });
    queryClient.invalidateQueries({
      queryKey: ["comprovante-count", companyId],
    });
    queryClient.invalidateQueries({ queryKey: txCandidatesKey(companyId) });
  }, [queryClient, companyId]);

  // ── Pagination ────────────────────────────────────────────────────────────────
  const {
    items,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    refresh,
    isError,
    updateItem,
  } = usePaginatedQuery<Comprovante>({
    queryKey: ["comprovantes", companyId, filters],
    queryFn: async (pageSize, lastDoc) => {
      if (!companyId) return { items: [], lastDoc: null, hasMore: false };
      return comprovanteService.getPaginated(
        companyId,
        pageSize,
        lastDoc,
        filters,
      );
    },
    enabled: !!companyId && tab !== "missing",
  });

  // ── Transaction index for inline display ─────────────────────────────────────
  const [txMap, setTxMap] = useState<Map<string, Transaction>>(new Map());
  const fetchedTxIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setTxMap(new Map());
    fetchedTxIds.current = new Set();
  }, [companyId]);

  useEffect(() => {
    const missingIds = [
      ...new Set(
        items
          .flatMap(linkedTransactionIds)
          .filter((id) => !fetchedTxIds.current.has(id)),
      ),
    ];
    if (!missingIds.length) return;
    missingIds.forEach((id) => fetchedTxIds.current.add(id));
    transactionService
      .getByIds(missingIds)
      .then((txs) => {
        setTxMap((prev) => {
          const next = new Map(prev);
          txs.forEach((t) => next.set(t.id, t));
          return next;
        });
      })
      .catch((err) => {
        missingIds.forEach((id) => fetchedTxIds.current.delete(id));
        console.error(err);
      });
  }, [items]);

  // Os pagáveis já carregados cobrem quase todos os títulos ligados: a linha
  // aparece completa na hora, sem esperar o getByIds.
  const candidateById = useMemo(
    () => new Map(txCandidates.map((t) => [t.id, t])),
    [txCandidates],
  );
  const txsFor = useCallback(
    (c: Comprovante) =>
      linkedTransactionIds(c)
        .map((id) => txMap.get(id) ?? candidateById.get(id))
        .filter((t): t is Transaction => !!t),
    [txMap, candidateById],
  );

  // ── Infinite scroll ───────────────────────────────────────────────────────────
  const { targetRef: sentinelRef, isIntersecting } =
    useIntersectionObserver<HTMLDivElement>({
      threshold: 0.1,
      enabled: hasMore && !isFetchingNextPage,
    });

  useEffect(() => {
    if (isIntersecting && hasMore && !isFetchingNextPage) loadMore();
  }, [isIntersecting, hasMore, isFetchingNextPage, loadMore]);

  // ── Selection (bulk confirm) ──────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectable = tab === "pending" && canUpload;

  useEffect(() => setSelected(new Set()), [filters]);

  const safeIds = useMemo(
    () =>
      selectable
        ? items
            .filter((c) => isSafeToBulkConfirm(c, txsFor(c)))
            .map((c) => c.id)
        : [],
    [selectable, items, txsFor],
  );
  const pendingLoaded = items.filter((c) => c.matchStatus === "pending_review");
  const allSelected =
    pendingLoaded.length > 0 && pendingLoaded.every((c) => selected.has(c.id));

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleBulkConfirm = async () => {
    if (!user || selected.size === 0) return;
    setBulkBusy(true);
    const used = new Set<string>();
    const done: { id: string; ids: string[] }[] = [];
    let skipped = 0;

    for (const id of selected) {
      const c = items.find((i) => i.id === id);
      if (!c || c.matchStatus !== "pending_review") continue;
      const ids = linkedTransactionIds(c);
      const txs = txsFor(c);
      // Dois comprovantes apontando para o mesmo título não passam em lote.
      if (
        !ids.length ||
        txs.length !== ids.length ||
        ids.some((x) => used.has(x))
      ) {
        skipped++;
        continue;
      }
      try {
        await comprovanteService.confirmMatch(
          c.id,
          ids,
          txs,
          user.uid,
          c.storagePath,
          actor,
        );
        ids.forEach((x) => used.add(x));
        done.push({ id: c.id, ids });
        updateItem(c.id, (prev) => ({
          ...prev,
          matchStatus: "matched",
          transactionId: ids[0],
          transactionIds: ids,
          isConsolidated: ids.length > 1,
          reviewedAt: new Date(),
        }));
      } catch {
        skipped++;
      }
    }

    setBulkBusy(false);
    setSelected(new Set());
    invalidateCounts();
    toast.success(
      `${done.length} associaç${done.length !== 1 ? "ões confirmadas" : "ão confirmada"}` +
        (skipped ? `. ${skipped} ficaram para revisão individual.` : "."),
      done.length
        ? {
            action: {
              label: "Desfazer",
              onClick: async () => {
                for (const d of done) {
                  await comprovanteService.removeMatch(
                    d.id,
                    d.ids,
                    user.uid,
                    actor,
                    "pending_review",
                  );
                }
                refresh();
                invalidateCounts();
              },
            },
          }
        : undefined,
    );
  };

  // ── Review panel ──────────────────────────────────────────────────────────────
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewIndex = reviewId ? items.findIndex((i) => i.id === reviewId) : -1;
  const reviewing = reviewIndex >= 0 ? items[reviewIndex] : null;
  // Ao acabar a página carregada, avança assim que a próxima chegar.
  const advanceFrom = useRef<number | null>(null);

  const openReview = useCallback((c: Comprovante) => setReviewId(c.id), []);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      const next = reviewIndex + dir;
      if (dir > 0 && next >= items.length - 3 && hasMore) loadMore();
      if (next >= 0 && next < items.length) setReviewId(items[next].id);
      else if (dir > 0 && !hasMore) toast.info("Fim da lista.");
    },
    [reviewIndex, items, hasMore, loadMore],
  );

  const advanceAfter = useCallback(
    (index: number, doneId: string) => {
      const next = items
        .slice(index + 1)
        .find((i) => i.id !== doneId && ACTIONABLE.has(i.matchStatus));
      if (next) {
        setReviewId(next.id);
        if (items.indexOf(next) >= items.length - 3 && hasMore) loadMore();
      } else if (hasMore) {
        advanceFrom.current = items.length - 1;
        loadMore();
      } else {
        setReviewId(null);
        toast.success("Lista revisada até o fim.");
      }
    },
    [items, hasMore, loadMore],
  );

  useEffect(() => {
    if (advanceFrom.current === null || isFetchingNextPage) return;
    const from = advanceFrom.current;
    if (items.length - 1 <= from) return;
    advanceFrom.current = null;
    const next = items
      .slice(from + 1)
      .find((i) => ACTIONABLE.has(i.matchStatus));
    setReviewId(next?.id ?? null);
  }, [items, isFetchingNextPage]);

  const handleReviewDone = useCallback(
    (result: ReviewResult) => {
      const index = items.findIndex((i) => i.id === result.id);
      const original = items[index];
      updateItem(result.id, (prev) => ({ ...prev, ...result.patch }));
      invalidateCounts();

      if (result.kind === "confirmed") {
        toast.success("Associação confirmada.", {
          action: {
            label: "Desfazer",
            onClick: async () => {
              try {
                await result.undo();
                if (original) updateItem(result.id, () => original);
                invalidateCounts();
              } catch {
                toast.error("Não foi possível desfazer.");
              }
            },
          },
        });
      } else {
        toast.info(
          "Sugestão rejeitada. O comprovante foi para Sem associação.",
        );
      }
      advanceAfter(index, result.id);
    },
    [items, updateItem, invalidateCounts, advanceAfter],
  );

  // ── Auto-confirm backlog ──────────────────────────────────────────────────────
  const [autoConfirmOpen, setAutoConfirmOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  const runAutoConfirm = async () => {
    if (!companyId) return;
    setAutoBusy(true);
    try {
      const res = await fetch("/api/internal/comprovantes/auto-confirm", {
        method: "POST",
        headers: { "x-company-id": companyId },
      });
      const data = (await res.json()) as {
        checked?: number;
        confirmed?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error);
      toast.success(
        data.confirmed
          ? `${data.confirmed} de ${data.checked} pendentes associados pela regra estrita. Cada um está na auditoria.`
          : `Nenhum dos ${data.checked} pendentes passou na regra estrita. Eles precisam de revisão.`,
      );
      refresh();
      invalidateCounts();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Erro ao aplicar a confirmação automática.",
      );
    } finally {
      setAutoBusy(false);
      setAutoConfirmOpen(false);
    }
  };

  // ── Remove / delete / share ───────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const handleRemoveMatch = async () => {
    if (!removeId) return;
    const c = items.find((i) => i.id === removeId);
    if (!c?.transactionId) return;
    try {
      await comprovanteService.removeMatch(
        c.id,
        c.transactionIds ?? [c.transactionId],
        user?.uid,
        actor,
      );
      toast.success(
        "Associação removida. O comprovante foi para Sem associação.",
      );
      refresh();
      invalidateCounts();
    } catch {
      toast.error("Erro ao remover associação.");
    } finally {
      setRemoveId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const c = items.find((i) => i.id === deleteId);
    if (!c) return;
    try {
      await comprovanteService.delete(
        c.id,
        c.storagePath,
        selectedCompany && user
          ? {
              companyId: selectedCompany.id,
              userId: user.uid,
              userEmail: user.email ?? "",
            }
          : undefined,
      );
      toast.success("Comprovante excluído.");
      if (reviewId === c.id) setReviewId(null);
      refresh();
      invalidateCounts();
    } catch {
      toast.error("Erro ao excluir comprovante.");
    } finally {
      setDeleteId(null);
    }
  };

  const handleShare = useCallback(
    async (c: Comprovante) => {
      const allTxs = linkedTransactionIds(c)
        .map((id) => txMap.get(id))
        .filter((t): t is Transaction => !!t);

      const entity = allTxs[0]?.supplierOrClient ?? c.matchedEntity ?? null;
      const title =
        allTxs.length > 1
          ? `Comprovante${entity ? ` · ${entity}` : ""}`
          : `Comprovante · ${allTxs[0]?.description ?? c.matchedEntity ?? c.id}`;

      const date = c.matchedDate ?? allTxs[0]?.paymentDate;
      const lines: string[] = [title];
      if (entity) lines.push(`Beneficiário: ${entity}`);
      if (date) lines.push(`Data: ${format(date, "dd/MM/yyyy")}`);

      if (allTxs.length > 1) {
        // Consolidated: list each transaction with its individual amount
        lines.push(`\nTransações incluídas (${allTxs.length}):`);
        allTxs.forEach((t, i) => {
          lines.push(
            `  ${i + 1}. ${t.description}: ${formatCurrency(t.finalAmount ?? t.amount)}`,
          );
        });
        if (c.matchedAmount) {
          lines.push(`\nTotal: ${formatCurrency(c.matchedAmount)}`);
        }
      } else if (c.matchedAmount) {
        lines.push(`Valor: ${formatCurrency(c.matchedAmount)}`);
      } else if (allTxs[0]) {
        lines.push(
          `Valor: ${formatCurrency(allTxs[0].finalAmount ?? allTxs[0].amount)}`,
        );
      }

      const text = lines.join("\n");
      const proxyLink = `${window.location.origin}${comprovanteProxyUrl(c.storagePath)}`;

      if (!navigator.share) {
        try {
          await navigator.clipboard.writeText(proxyLink);
          toast.success("Link copiado para a área de transferência.");
        } catch {
          toast.error("Compartilhamento não suportado neste navegador.");
        }
        return;
      }

      setSharingId(c.id);
      try {
        const response = await fetch(comprovanteProxyUrl(c.storagePath));
        if (!response.ok) throw new Error("proxy_error");
        const blob = await response.blob();
        const fileLabel = entity ?? allTxs[0]?.description ?? c.id;
        const fileName = `comprovante-${fileLabel.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
        const file = new File([blob], fileName, { type: "application/pdf" });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title, text, files: [file] });
        } else {
          await navigator.share({ title, text, url: proxyLink });
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          toast.error("Não foi possível compartilhar.");
        }
      } finally {
        setSharingId(null);
      }
    },
    [txMap],
  );

  // ── Derived copy ──────────────────────────────────────────────────────────────
  const tabCounts: Record<TabKey, number | undefined> = {
    pending: stats?.pendingReview,
    unmatched:
      stats != null ? stats.unmatched + stats.rejectedMatch : undefined,
    manual: stats?.needsManual,
    missing: candidatesLoading ? undefined : missingAll.length,
    matched: stats?.matched,
    all: stats?.total,
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "pending", label: "Pendentes" },
    { key: "unmatched", label: "Sem associação" },
    { key: "manual", label: "Ilegíveis" },
    { key: "missing", label: "Pagos sem comprovante" },
    { key: "matched", label: "Associados" },
    { key: "all", label: "Todos" },
  ];

  const resultCount = tab === "missing" ? missing.length : filteredCount;
  const listLoading = tab === "missing" ? candidatesLoading : isLoading;

  const actionProps = (c: Comprovante) => ({
    comprovante: c,
    canUpload,
    sharing: sharingId === c.id,
    onOpenReview: openReview,
    onShare: handleShare,
    onSetRemoveId: setRemoveId,
    onSetDeleteId: setDeleteId,
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const emptyState = (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center text-muted-foreground">
      {hasActiveFilters ? (
        <>
          <p className="text-sm font-medium">
            Nada encontrado com esses filtros.
          </p>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={clearFilters}
          >
            Limpar filtros
          </Button>
        </>
      ) : tab === "pending" ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="text-sm font-medium text-foreground">
            Fila zerada. Nenhum comprovante aguardando revisão.
          </p>
          {missingAll.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTab("missing")}
            >
              Ver {missingAll.length} pagamento
              {missingAll.length !== 1 ? "s" : ""} sem comprovante
            </Button>
          )}
        </>
      ) : tab === "missing" ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="text-sm font-medium text-foreground">
            Todos os pagamentos têm comprovante.
          </p>
        </>
      ) : tab === "all" ? (
        <>
          <FileText className="h-8 w-8 opacity-40" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Nenhum comprovante enviado ainda.
            </p>
            <p className="text-xs">
              Cada página de PDF vira um comprovante e é associada ao título
              correspondente.
            </p>
          </div>
          {canUpload && (
            <Button
              size="sm"
              className="mt-1 gap-2"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Enviar comprovantes
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm">Nenhum comprovante nesta situação.</p>
      )}
    </div>
  );

  const errorState = (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-sm font-medium text-destructive">
        Não foi possível carregar os comprovantes.
      </p>
      <Button variant="outline" size="sm" onClick={() => refresh()}>
        Tentar novamente
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Comprovantes
          </h1>
          <div className="mt-1 text-sm text-muted-foreground tabular-nums">
            {statsLoading || !stats ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <>
                {stats.pendingReview > 0
                  ? `${stats.pendingReview} aguardando revisão`
                  : "Fila zerada"}
                {missingAll.length > 0 &&
                  ` · ${missingAll.length} pago${missingAll.length !== 1 ? "s" : ""} sem comprovante`}
                {` · ${stats.total} no total`}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              refresh();
              invalidateCounts();
            }}
            aria-label="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <Link href="/financeiro/comprovantes/regras">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Regras</span>
            </Link>
          </Button>
          {canUpload && (stats?.pendingReview ?? 0) > 0 && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setAutoConfirmOpen(true)}
              disabled={autoBusy}
            >
              {autoBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Confirmar automáticas</span>
            </Button>
          )}
          {canUpload && (
            <Button onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar comprovantes</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Work surface ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none rounded-t-xl border-b bg-transparent px-2 py-0 [scrollbar-width:none]">
            {tabs.map(({ key, label }) => {
              const n = tabCounts[key];
              const urgent = key === "pending" && (n ?? 0) > 0;
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
                >
                  {label}
                  {n !== undefined && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-xs tabular-nums",
                        urgent
                          ? "bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300"
                          : "text-muted-foreground",
                      )}
                    >
                      {n}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="relative min-w-0 flex-1 md:min-w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                tab === "missing"
                  ? "Buscar por descrição ou fornecedor…"
                  : "Buscar por descrição, fornecedor ou texto do comprovante…"
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-8"
              aria-label="Buscar comprovantes"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <span className="text-sm text-muted-foreground">
              {tab === "missing" ? "Pago em" : "Enviado em"}
            </span>
            <DatePickerWithRange date={dateRange} setDate={setDateRange} />
          </div>

          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Filtrar por período"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors md:hidden",
              dateRange?.from
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={clearFilters}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          )}

          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {resultCount !== undefined &&
              `${resultCount} ${tab === "missing" ? "pagamento" : "comprovante"}${resultCount !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Bulk bar */}
        {selectable && (selected.size > 0 || safeIds.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2 text-sm">
            {selected.size > 0 ? (
              <>
                <span className="font-medium tabular-nums">
                  {selected.size} selecionado{selected.size !== 1 ? "s" : ""}
                </span>
                <Button
                  size="sm"
                  onClick={handleBulkConfirm}
                  disabled={bulkBusy}
                  className="gap-1.5"
                >
                  {bulkBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Confirmar {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Limpar seleção
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {safeIds.length} com evidência forte, sem divergência nem
                  empate.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(new Set(safeIds))}
                >
                  Selecionar esses
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── List ─────────────────────────────────────────────────────── */}
        {listLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tab === "missing" ? (
          <>
            {cutoff && (
              <p className="border-b px-4 py-2 text-sm text-muted-foreground">
                Contando pagamentos desde{" "}
                <span className="font-medium text-foreground">
                  {format(cutoff, "dd/MM/yyyy")}
                </span>
                {!receiptsStart &&
                  " (sugestão: mês do primeiro pagamento com comprovante)"}
                .{" "}
                <Link
                  href="/financeiro/comprovantes/regras#inicio"
                  className="text-foreground underline underline-offset-2 hover:no-underline"
                >
                  {receiptsStart ? "Alterar" : "Definir data de início"}
                </Link>
              </p>
            )}
            {missing.length === 0 ? (
              emptyState
            ) : (
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Título pago</TableHead>
                    <TableHead className="w-36 text-right">Valor</TableHead>
                    <TableHead className="hidden w-28 md:table-cell">
                      Pago em
                    </TableHead>
                    {canUpload && <TableHead className="w-48" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missing.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-0 pl-4">
                        <p className="truncate text-sm font-medium">
                          {t.description}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.supplierOrClient}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-financial text-sm">
                        {formatCurrency(t.finalAmount ?? t.amount)}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {t.paymentDate
                          ? format(t.paymentDate, "dd/MM/yyyy")
                          : "sem data"}
                      </TableCell>
                      {canUpload && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5"
                            onClick={() => setUploadOpen(true)}
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Enviar comprovante
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : isError ? (
          errorState
        ) : items.length === 0 ? (
          emptyState
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block">
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    {selectable && (
                      <TableHead className="w-10 pl-4">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(v) =>
                            setSelected(
                              v
                                ? new Set(pendingLoaded.map((c) => c.id))
                                : new Set(),
                            )
                          }
                          aria-label="Selecionar todos os pendentes carregados"
                        />
                      </TableHead>
                    )}
                    <TableHead className={cn(!selectable && "pl-4")}>
                      Título
                    </TableHead>
                    <TableHead className="w-40 text-right">Valor</TableHead>
                    <TableHead className="w-28">Pago em</TableHead>
                    <TableHead className="w-72">
                      {tab === "all" ? "Situação" : "Motivo"}
                    </TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => {
                    const txs = txsFor(c);
                    const first = txs[0];
                    const diff = amountDifference(c, txs);
                    const date = c.matchedDate ?? first?.paymentDate;
                    const settled =
                      tab === "pending" && !ACTIONABLE.has(c.matchStatus);
                    return (
                      <TableRow
                        key={c.id}
                        tabIndex={0}
                        data-state={
                          reviewId === c.id || selected.has(c.id)
                            ? "selected"
                            : undefined
                        }
                        onClick={() => openReview(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.target === e.currentTarget)
                            openReview(c);
                        }}
                        className={cn(
                          "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none",
                          settled && "opacity-55",
                        )}
                      >
                        {selectable && (
                          <TableCell
                            className="pl-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.matchStatus === "pending_review" && (
                              <Checkbox
                                checked={selected.has(c.id)}
                                onCheckedChange={() => toggleSelected(c.id)}
                                aria-label="Selecionar comprovante"
                              />
                            )}
                          </TableCell>
                        )}

                        <TableCell
                          className={cn("max-w-0", !selectable && "pl-4")}
                        >
                          <div className="truncate text-sm font-medium">
                            {first?.description ??
                              (linkedTransactionIds(c).length ? (
                                <Skeleton className="h-4 w-48" />
                              ) : (
                                <span className="text-muted-foreground">
                                  Sem título vinculado
                                </span>
                              ))}
                            {txs.length > 1 && (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                e mais {txs.length - 1}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {[
                              first?.supplierOrClient ?? c.matchedEntity,
                              `pág. ${c.pageNumber}/${c.totalPages}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {readNameDiffers(
                              c.matchedEntity,
                              first?.supplierOrClient,
                            ) && (
                              <span className="text-amber-800 dark:text-amber-300">
                                {" · lido como "}
                                {c.matchedEntity}
                              </span>
                            )}
                          </p>
                        </TableCell>

                        <TableCell className="text-right">
                          <p className="font-financial text-sm">
                            {c.matchedAmount != null
                              ? formatCurrency(c.matchedAmount)
                              : txs.length
                                ? formatCurrency(titlesTotal(txs))
                                : "sem valor"}
                          </p>
                          {diff !== null && (
                            <p className="font-financial text-xs text-amber-800 dark:text-amber-300">
                              título {formatCurrency(titlesTotal(txs))}
                            </p>
                          )}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {date ? format(date, "dd/MM/yyyy") : "sem data"}
                        </TableCell>

                        <TableCell className="max-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            {tab === "all" && (
                              <ComprovanteStatusBadge status={c.matchStatus} />
                            )}
                            <InsightLine insight={receiptInsight(c, txs)} />
                          </div>
                        </TableCell>

                        <TableCell className="pr-3 text-right">
                          <RowActions {...actionProps(c)} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile */}
            <div className="divide-y md:hidden">
              {items.map((c) => (
                <MobileComprovanteCard
                  key={c.id}
                  txs={txsFor(c)}
                  {...actionProps(c)}
                />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div
              ref={sentinelRef}
              className={
                isFetchingNextPage ? "flex justify-center py-3" : "h-px"
              }
            >
              {isFetchingNextPage && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Panels & dialogs ─────────────────────────────────────────────── */}
      <UploadComprovanteDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          refresh();
          invalidateCounts();
        }}
      />

      <MatchReviewPanel
        comprovante={reviewing}
        position={
          reviewing
            ? { index: reviewIndex, total: filteredCount ?? items.length }
            : null
        }
        canEdit={canUpload}
        onClose={() => setReviewId(null)}
        onNavigate={navigate}
        onDone={handleReviewDone}
        onPatch={(id, patch) => {
          updateItem(id, (prev) => ({ ...prev, ...patch }));
          invalidateCounts();
        }}
      />

      <ConfirmDialog
        open={autoConfirmOpen}
        onOpenChange={(o) => !autoBusy && setAutoConfirmOpen(o)}
        title="Confirmar automaticamente os pendentes"
        description="Associa sem revisão só os comprovantes com confiança Alta, sem empate, valor exato e beneficiário identificado por código de barras, CNPJ/CPF ou chave Pix (ou fornecedor marcado como de confiança). Cada associação fica na auditoria e pode ser removida depois. O resto continua na fila."
        confirmText={autoBusy ? "Aplicando…" : "Aplicar regra"}
        onConfirm={runAutoConfirm}
      />

      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(o) => !o && setRemoveId(null)}
        title="Remover associação"
        description="O comprovante continua no sistema, em Sem associação, e o título volta a constar como pago sem comprovante."
        confirmText="Remover"
        variant="destructive"
        onConfirm={handleRemoveMatch}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Excluir comprovante"
        description="O arquivo será removido do sistema. Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* ── Mobile period sheet ──────────────────────────────────────── */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" />
          <SheetTitle className="mb-4 text-base font-semibold">
            {tab === "missing" ? "Pago em" : "Enviado em"}
          </SheetTitle>
          <div className="grid grid-cols-2 gap-2">
            {(["from", "to"] as const).map((edge) => (
              <div key={edge} className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {edge === "from" ? "De" : "Até"}
                </Label>
                <Input
                  type="date"
                  value={
                    dateRange?.[edge]
                      ? format(dateRange[edge]!, "yyyy-MM-dd")
                      : ""
                  }
                  onChange={(e) => {
                    const d = e.target.valueAsDate;
                    if (!d) return;
                    const local = new Date(
                      d.getTime() + d.getTimezoneOffset() * 60000,
                    );
                    setDateRange((prev) => ({
                      from: edge === "from" ? local : prev?.from,
                      to: edge === "to" ? local : prev?.to,
                    }));
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-5">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setDateRange(undefined);
                setMobileFiltersOpen(false);
              }}
            >
              Limpar
            </Button>
            <Button
              className="flex-1"
              onClick={() => setMobileFiltersOpen(false)}
            >
              Ver resultados
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
