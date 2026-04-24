"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  FileCheck,
  Upload,
  Search,
  Download,
  Eye,
  Link2Off,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileX,
  Filter,
  MoreHorizontal,
  RefreshCw,
  Share2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  SlidersHorizontal,
  X,
  Loader2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { format, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { Comprovante, Transaction, ComprovanteMatchStatus } from "@/lib/types";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { formatCurrency } from "@/lib/utils";
import { ComprovanteStatusBadge } from "@/components/features/finance/comprovantes/ComprovanteStatusBadge";
import { ConfidenceBadge } from "@/components/features/finance/comprovantes/ConfidenceBadge";
import { UploadComprovanteDialog } from "@/components/features/finance/comprovantes/UploadComprovanteDialog";
import { MatchReviewDialog } from "@/components/features/finance/comprovantes/MatchReviewDialog";

// ── Animated number ──────────────────────────────────────────────────────────

function useAnimatedValue(target: number, duration = 600) {
  const [current, setCurrent] = useState(target);
  const startRef = useRef(target);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = current;
    startTimeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    let raf: number;
    const animate = (ts: number) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const progress = Math.min((ts - startTimeRef.current) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      setCurrent(startRef.current + (target - startRef.current) * ease);
      if (progress < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return current;
}

// ── KPI Card helper ──────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon: Icon,
  colorClass,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  const animated = useAnimatedValue(value);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-md ${colorClass}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">
            {Math.round(animated)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sort header button ───────────────────────────────────────────────────────

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 select-none hover:text-foreground transition-colors"
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  );
}

// ── Swipe helper ─────────────────────────────────────────────────────────────

function useSwipe(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void,
  threshold = 60,
) {
  const startX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (dx < -threshold) onSwipeLeft?.();
    else if (dx > threshold) onSwipeRight?.();
    startX.current = null;
  };

  return { onTouchStart, onTouchEnd };
}

// ── Mobile skeletons ──────────────────────────────────────────────────────────

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="h-9 w-9 rounded-md shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 max-w-[180px]" />
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
            <Skeleton className="h-3 w-32" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-8 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Mobile comprovante card ───────────────────────────────────────────────────

interface MobileComprovanteCardProps {
  comprovante: Comprovante;
  tx: Transaction | null;
  canUpload: boolean;
  sharingId: string | null;
  onOpenReview: () => void;
  onShare: () => void;
  onSetRemoveId: () => void;
  downloadUrl: string;
}

function MobileComprovanteCard({
  comprovante: c,
  tx,
  canUpload,
  sharingId,
  onOpenReview,
  onShare,
  onSetRemoveId,
  downloadUrl,
}: MobileComprovanteCardProps) {
  const canReview =
    (c.matchStatus === "pending_review" ||
      c.matchStatus === "unmatched" ||
      c.matchStatus === "rejected_match") &&
    canUpload;
  const canRemove =
    c.matchStatus === "matched" && !!c.transactionId && canUpload;

  const swipe = useSwipe(canReview ? onOpenReview : undefined, undefined, 60);

  const borderClass =
    c.matchStatus === "pending_review"
      ? "border-l-amber-500"
      : c.matchStatus === "unmatched" || c.matchStatus === "rejected_match"
        ? "border-l-red-500"
        : c.matchStatus === "matched"
          ? "border-l-emerald-500"
          : "border-l-transparent";

  return (
    <div
      {...swipe}
      className={`relative flex items-start gap-3 px-4 py-3.5 transition-colors select-none border-l-4 ${borderClass}`}
    >
      {/* File icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary mt-0.5">
        <FileCheck className="h-4 w-4" />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug truncate flex-1">
            {tx?.description ??
              c.matchedEntity ??
              `Pág. ${c.pageNumber}/${c.totalPages}`}
          </p>
          <span className="text-sm font-bold font-financial shrink-0">
            {c.matchedAmount
              ? formatCurrency(c.matchedAmount)
              : tx
                ? formatCurrency(tx.finalAmount ?? tx.amount)
                : "—"}
          </span>
        </div>
        {(tx?.supplierOrClient ?? c.matchedEntity) && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {tx?.supplierOrClient ?? c.matchedEntity}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {(c.matchedDate ?? tx?.paymentDate) && (
            <span className="text-xs text-muted-foreground">
              {c.matchedDate
                ? format(c.matchedDate, "dd MMM yyyy", { locale: ptBR })
                : tx?.paymentDate
                  ? format(tx.paymentDate, "dd MMM yyyy", { locale: ptBR })
                  : null}
            </span>
          )}
          <ComprovanteStatusBadge status={c.matchStatus} />
          {c.matchConfidenceLevel && (
            <ConfidenceBadge
              level={c.matchConfidenceLevel}
              score={c.matchConfidence}
            />
          )}
        </div>
        {canReview && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            ← deslize para revisar
          </p>
        )}
      </div>

      {/* Actions menu — min 44×44 touch area */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 w-11 p-0 shrink-0 -mr-2"
            aria-label="Ações do comprovante"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Ações</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              Baixar comprovante
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onShare}
            disabled={sharingId === c.id}
            className="gap-2"
          >
            {sharingId === c.id ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {sharingId === c.id ? "Preparando…" : "Enviar"}
          </DropdownMenuItem>
          {canReview && (
            <DropdownMenuItem onClick={onOpenReview} className="gap-2">
              <Eye className="h-4 w-4" />
              Revisar associação
            </DropdownMenuItem>
          )}
          {canRemove && <DropdownMenuSeparator />}
          {canRemove && (
            <DropdownMenuItem
              onClick={onSetRemoveId}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Link2Off className="h-4 w-4" />
              Remover associação
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ComprovantesPage() {
  useAuth();
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();

  const canUpload = isAdmin || isFinancialManager;

  // ── Sort ─────────────────────────────────────────────────────────────────────
  type SortField = "date" | "amount" | "status" | "confidence";
  type SortDir = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "desc" : "asc");
    }
  };

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<
    ComprovanteMatchStatus | "all"
  >("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (dateRange ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0 || !!searchTerm;

  const statusLabels: Record<string, string> = {
    all: "Todos",
    matched: "Associados",
    pending_review: "Pendentes",
    unmatched: "Sem Associação",
    rejected_match: "Rejeitados",
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setDateRange(undefined);
    setSearchTerm("");
  };

  // ── Stats ────────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({
    total: 0,
    matched: 0,
    pendingReview: 0,
    unmatched: 0,
    rejectedMatch: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    if (!selectedCompany) return;
    setStatsLoading(true);
    try {
      const s = await comprovanteService.getStats(selectedCompany.id);
      setStats(s);
    } catch {
      // stats are non-critical
    } finally {
      setStatsLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    loadStats();
    const onFocus = () => loadStats();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadStats]);

  // ── Pagination ────────────────────────────────────────────────────────────────
  const {
    items,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    refresh,
    isError,
  } = usePaginatedQuery<Comprovante>({
    queryKey: [
      "comprovantes",
      selectedCompany?.id,
      statusFilter,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
    ],
    queryFn: async (pageSize, lastDoc) => {
      if (!selectedCompany) return { items: [], lastDoc: null, hasMore: false };
      return comprovanteService.getPaginated(
        selectedCompany.id,
        pageSize,
        lastDoc,
        {
          matchStatus: statusFilter,
          startDate: dateRange?.from,
          endDate: dateRange?.to ? endOfDay(dateRange.to) : undefined,
        },
      );
    },
  });

  // ── Transaction index for inline display ─────────────────────────────────────
  const [txMap, setTxMap] = useState<Map<string, Transaction>>(new Map());
  const fetchedTxIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setTxMap(new Map());
    fetchedTxIds.current = new Set();
  }, [selectedCompany?.id]);

  useEffect(() => {
    const missingIds = [
      ...new Set(
        items
          .flatMap((c) => [c.transactionId, c.suggestedTransactionId])
          .filter((id): id is string => !!id && !fetchedTxIds.current.has(id)),
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
      .catch(console.error);
  }, [items]);

  // Client-side search filter + sort
  const statusOrder: Record<string, number> = {
    pending_review: 0,
    unmatched: 1,
    rejected_match: 2,
    matched: 3,
  };

  const filtered = (
    debouncedSearch
      ? items.filter((c) =>
          [
            c.extractedText ?? "",
            c.matchedEntity ?? "",
            txMap.get(c.transactionId ?? "")?.description ?? "",
            txMap.get(c.transactionId ?? "")?.supplierOrClient ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()),
        )
      : items
  )
    .slice()
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") {
        const aDate =
          a.matchedDate ??
          (a.transactionId
            ? txMap.get(a.transactionId)?.paymentDate
            : undefined);
        const bDate =
          b.matchedDate ??
          (b.transactionId
            ? txMap.get(b.transactionId)?.paymentDate
            : undefined);
        cmp = (aDate?.getTime() ?? 0) - (bDate?.getTime() ?? 0);
      } else if (sortField === "amount") {
        const aAmt =
          a.matchedAmount ??
          (a.transactionId
            ? (txMap.get(a.transactionId)?.finalAmount ??
              txMap.get(a.transactionId)?.amount ??
              0)
            : 0);
        const bAmt =
          b.matchedAmount ??
          (b.transactionId
            ? (txMap.get(b.transactionId)?.finalAmount ??
              txMap.get(b.transactionId)?.amount ??
              0)
            : 0);
        cmp = aAmt - bAmt;
      } else if (sortField === "status") {
        cmp =
          (statusOrder[a.matchStatus] ?? 99) -
          (statusOrder[b.matchStatus] ?? 99);
      } else if (sortField === "confidence") {
        cmp = (a.matchConfidence ?? 0) - (b.matchConfidence ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  // Infinite scroll sentinel
  const { targetRef: sentinelRef, isIntersecting } =
    useIntersectionObserver<HTMLDivElement>({
      threshold: 0.1,
      enabled: hasMore && !isFetchingNextPage,
    });

  useEffect(() => {
    if (isIntersecting && hasMore && !isFetchingNextPage) {
      loadMore();
    }
  }, [isIntersecting, hasMore, isFetchingNextPage, loadMore]);

  // ── Dialogs ───────────────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Comprovante | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const handleOpenReview = (c: Comprovante) => {
    setReviewing(c);
    setReviewOpen(true);
  };

  const handleRemoveMatch = async () => {
    if (!removeId) return;
    const c = items.find((i) => i.id === removeId);
    if (!c?.transactionId) return;
    try {
      await comprovanteService.removeMatch(c.id, c.transactionId);
      toast.success("Associação removida.");
      refresh();
      loadStats();
    } catch {
      toast.error("Erro ao remover associação.");
    } finally {
      setRemoveId(null);
    }
  };

  const handleShare = async (c: Comprovante) => {
    const tx = c.transactionId ? txMap.get(c.transactionId) : null;
    const label = tx?.description ?? c.matchedEntity ?? c.id;
    const title = `Comprovante — ${label}`;
    const text = [
      title,
      c.matchedAmount ? `Valor: ${formatCurrency(c.matchedAmount)}` : null,
      c.matchedDate
        ? `Data: ${format(c.matchedDate, "dd/MM/yyyy", { locale: ptBR })}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    if (!navigator.share) {
      try {
        await navigator.clipboard.writeText(c.storageUrl);
        toast.success("Link copiado para a área de transferência.");
      } catch {
        toast.error("Compartilhamento não suportado neste navegador.");
      }
      return;
    }

    setSharingId(c.id);
    try {
      const proxyUrl = `/api/internal/storage-proxy?path=${encodeURIComponent(c.storagePath)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("proxy_error");
      const blob = await response.blob();
      const fileName = `comprovante-${label.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text, files: [file] });
      } else {
        await navigator.share({ title, text, url: c.storageUrl });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error("Não foi possível compartilhar.");
      }
    } finally {
      setSharingId(null);
    }
  };

  const onUploadSuccess = () => {
    refresh();
    loadStats();
  };

  const onReviewUpdated = () => {
    refresh();
    loadStats();
  };

  const pendingCount = stats.pendingReview;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="h-6 w-6 text-primary" />
            Comprovantes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie os comprovantes de pagamento associados às transações
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              refresh();
              loadStats();
            }}
            title="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canUpload && (
            <Button
              onClick={() => setUploadOpen(true)}
              size="sm"
              className="h-9 gap-2"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar Comprovantes</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Validation queue alert ───────────────────────────────────────── */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Fila de Validação: {pendingCount} comprovante
              {pendingCount !== 1 ? "s" : ""} aguardando revisão
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-500/70">
              Revise as sugestões automáticas de associação abaixo.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={() => setStatusFilter("pending_review")}
          >
            Ver pendentes
          </Button>
        </div>
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          title="Total"
          value={stats.total}
          icon={FileCheck}
          colorClass="bg-primary/10 text-primary"
          loading={statsLoading}
        />
        <KpiCard
          title="Associados"
          value={stats.matched}
          icon={CheckCircle2}
          colorClass="bg-emerald-500/10 text-emerald-500"
          loading={statsLoading}
        />
        <KpiCard
          title="Pendentes"
          value={stats.pendingReview}
          icon={Clock}
          colorClass="bg-amber-500/10 text-amber-500"
          loading={statsLoading}
        />
        <KpiCard
          title="Sem associação"
          value={stats.unmatched}
          icon={FileX}
          colorClass="bg-red-500/10 text-red-500"
          loading={statsLoading}
        />
      </div>

      {/* ── Table Card ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          {/* ── Desktop: título + todos os filtros em uma linha ──── */}
          <div className="hidden md:flex items-start justify-between gap-4 flex-wrap">
            <CardTitle>Comprovantes</CardTitle>
            <div className="flex flex-wrap gap-3">
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as ComprovanteMatchStatus | "all")
                }
              >
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="matched">Associados</SelectItem>
                  <SelectItem value="pending_review">Pendentes</SelectItem>
                  <SelectItem value="unmatched">Sem Associação</SelectItem>
                  <SelectItem value="rejected_match">Rejeitados</SelectItem>
                </SelectContent>
              </Select>

              <DatePickerWithRange date={dateRange} setDate={setDateRange} />

              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por descrição, fornecedor…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-8"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Limpar busca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

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
            </div>
          </div>

          {/* ── Mobile: título ─────────────────────────────────────── */}
          <div className="flex md:hidden items-center justify-between gap-2">
            <CardTitle>Comprovantes</CardTitle>
            {!isLoading && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {filtered.length}
                {hasMore ? "+" : ""} resultado
                {filtered.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* ── Mobile: busca + botão de filtros numa linha ───────── */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por descrição, fornecedor…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 h-10"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Abrir filtros"
              className={[
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                activeFilterCount > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* ── Mobile: chips de filtros ativos (scroll horizontal) ── */}
          {activeFilterCount > 0 && (
            <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {statusFilter !== "all" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  {statusLabels[statusFilter] ?? statusFilter}
                  <button
                    onClick={() => setStatusFilter("all")}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de status"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              {dateRange?.from && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  <span>
                    {format(dateRange.from, "dd/MM")}
                    {dateRange.to && ` – ${format(dateRange.to, "dd/MM")}`}
                  </span>
                  <button
                    onClick={() => setDateRange(undefined)}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de período"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              <button
                onClick={clearFilters}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors ml-1"
              >
                Limpar tudo
              </button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0 md:p-6">
          {isLoading ? (
            <>
              {/* Desktop skeleton */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <TableHead key={i}>
                          <Skeleton className="h-4 w-full" />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile skeleton */}
              <div className="md:hidden">
                <MobileCardSkeleton />
              </div>
            </>
          ) : (
            <>
              {/* ── Desktop: Table ───────────────────────────────────── */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Página</TableHead>
                      <TableHead>Transação Associada</TableHead>
                      <TableHead>
                        <SortHeader
                          label="Valor"
                          active={sortField === "amount"}
                          dir={sortDir}
                          onClick={() => handleSort("amount")}
                        />
                      </TableHead>
                      <TableHead>
                        <SortHeader
                          label="Data"
                          active={sortField === "date"}
                          dir={sortDir}
                          onClick={() => handleSort("date")}
                        />
                      </TableHead>
                      <TableHead>Entidade</TableHead>
                      <TableHead>
                        <SortHeader
                          label="Status"
                          active={sortField === "status"}
                          dir={sortDir}
                          onClick={() => handleSort("status")}
                        />
                      </TableHead>
                      <TableHead>
                        <SortHeader
                          label="Confiança"
                          active={sortField === "confidence"}
                          dir={sortDir}
                          onClick={() => handleSort("confidence")}
                        />
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isError ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="h-32 text-center text-destructive"
                        >
                          Erro ao carregar comprovantes. Verifique o console
                          para mais detalhes.
                        </TableCell>
                      </TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-36 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <FileText className="h-8 w-8 opacity-40" />
                            <p className="text-sm font-medium">
                              {debouncedSearch || hasActiveFilters
                                ? "Nenhum comprovante encontrado para os filtros selecionados."
                                : "Nenhum comprovante cadastrado."}
                            </p>
                            {(debouncedSearch || hasActiveFilters) && (
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={clearFilters}
                              >
                                Limpar filtros
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((c) => {
                        const tx = c.transactionId
                          ? txMap.get(c.transactionId)
                          : null;
                        return (
                          <TableRow key={c.id} className="group">
                            {/* Page number */}
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                                  <FileCheck className="h-4 w-4" />
                                </div>
                                <span className="text-sm font-medium">
                                  {c.pageNumber}/{c.totalPages}
                                </span>
                              </div>
                            </TableCell>

                            {/* Linked transaction */}
                            <TableCell>
                              {tx ? (
                                <div>
                                  <p className="text-sm font-medium">
                                    {tx.description}
                                  </p>
                                  {tx.supplierOrClient && (
                                    <p className="text-xs text-muted-foreground">
                                      {tx.supplierOrClient}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground italic">
                                  —
                                </span>
                              )}
                            </TableCell>

                            {/* Amount */}
                            <TableCell className="font-financial text-sm">
                              {c.matchedAmount
                                ? formatCurrency(c.matchedAmount)
                                : tx
                                  ? formatCurrency(tx.finalAmount ?? tx.amount)
                                  : "—"}
                            </TableCell>

                            {/* Date */}
                            <TableCell className="text-sm text-muted-foreground">
                              {c.matchedDate
                                ? format(c.matchedDate, "dd/MM/yyyy", {
                                    locale: ptBR,
                                  })
                                : tx?.paymentDate
                                  ? format(tx.paymentDate, "dd/MM/yyyy", {
                                      locale: ptBR,
                                    })
                                  : "—"}
                            </TableCell>

                            {/* Entity */}
                            <TableCell className="text-sm text-muted-foreground">
                              {c.matchedEntity ?? tx?.supplierOrClient ?? "—"}
                            </TableCell>

                            {/* Status */}
                            <TableCell>
                              <ComprovanteStatusBadge status={c.matchStatus} />
                            </TableCell>

                            {/* Confidence */}
                            <TableCell>
                              {c.matchConfidenceLevel ? (
                                <ConfidenceBadge
                                  level={c.matchConfidenceLevel}
                                  score={c.matchConfidence}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>

                            {/* Actions */}
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={c.storageUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 cursor-pointer"
                                    >
                                      <Download className="h-4 w-4" />
                                      Baixar comprovante
                                    </a>
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={() => handleShare(c)}
                                    disabled={sharingId === c.id}
                                    className="gap-2"
                                  >
                                    {sharingId === c.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Share2 className="h-4 w-4" />
                                    )}
                                    {sharingId === c.id
                                      ? "Preparando…"
                                      : "Enviar"}
                                  </DropdownMenuItem>

                                  {(c.matchStatus === "pending_review" ||
                                    c.matchStatus === "unmatched" ||
                                    c.matchStatus === "rejected_match") &&
                                    canUpload && (
                                      <DropdownMenuItem
                                        onClick={() => handleOpenReview(c)}
                                        className="gap-2"
                                      >
                                        <Eye className="h-4 w-4" />
                                        Revisar associação
                                      </DropdownMenuItem>
                                    )}

                                  {c.matchStatus === "matched" &&
                                    c.transactionId &&
                                    canUpload && <DropdownMenuSeparator />}
                                  {c.matchStatus === "matched" &&
                                    c.transactionId &&
                                    canUpload && (
                                      <DropdownMenuItem
                                        onClick={() => setRemoveId(c.id)}
                                        className="gap-2 text-destructive focus:text-destructive"
                                      >
                                        <Link2Off className="h-4 w-4" />
                                        Remover associação
                                      </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile: Card list ────────────────────────────────── */}
              <div className="md:hidden">
                {isError ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4 text-destructive">
                    <p className="text-sm font-medium text-center">
                      Erro ao carregar comprovantes.
                    </p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4 text-muted-foreground">
                    <FileText className="h-8 w-8 opacity-40" />
                    <p className="text-sm font-medium text-center">
                      {debouncedSearch || hasActiveFilters
                        ? "Nenhum comprovante encontrado para os filtros selecionados."
                        : "Nenhum comprovante cadastrado."}
                    </p>
                    {(debouncedSearch || hasActiveFilters) && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={clearFilters}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y">
                    {filtered.map((c) => {
                      const tx = c.transactionId
                        ? (txMap.get(c.transactionId) ?? null)
                        : null;
                      return (
                        <MobileComprovanteCard
                          key={c.id}
                          comprovante={c}
                          tx={tx}
                          canUpload={canUpload}
                          sharingId={sharingId}
                          onOpenReview={() => handleOpenReview(c)}
                          onShare={() => handleShare(c)}
                          onSetRemoveId={() => setRemoveId(c.id)}
                          downloadUrl={c.storageUrl}
                        />
                      );
                    })}
                  </div>
                )}
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
        </CardContent>
      </Card>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <UploadComprovanteDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={onUploadSuccess}
      />

      <MatchReviewDialog
        comprovante={reviewing}
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false);
          setReviewing(null);
        }}
        onUpdated={onReviewUpdated}
        matchedTransaction={
          reviewing?.transactionId
            ? (txMap.get(reviewing.transactionId) ?? null)
            : null
        }
      />

      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(o) => !o && setRemoveId(null)}
        title="Remover associação"
        description="Tem certeza que deseja remover a associação entre este comprovante e a transação? O comprovante permanecerá no sistema."
        confirmText="Remover"
        variant="destructive"
        onConfirm={handleRemoveMatch}
      />

      {/* ── Mobile filter sheet ──────────────────────────────────── */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[92dvh] overflow-y-auto px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 shrink-0" />
          <SheetTitle className="mb-4 text-base font-semibold">
            Filtros
          </SheetTitle>
          <div className="space-y-5">
            {/* Período */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Período
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Input
                    type="date"
                    value={
                      dateRange?.from
                        ? format(dateRange.from, "yyyy-MM-dd")
                        : ""
                    }
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setDateRange((prev) => ({
                        from: adjusted,
                        to: prev?.to,
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Até</Label>
                  <Input
                    type="date"
                    value={
                      dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : ""
                    }
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setDateRange((prev) => ({
                        from: prev?.from,
                        to: adjusted,
                      }));
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as ComprovanteMatchStatus | "all")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="matched">Associados</SelectItem>
                  <SelectItem value="pending_review">Pendentes</SelectItem>
                  <SelectItem value="unmatched">Sem Associação</SelectItem>
                  <SelectItem value="rejected_match">Rejeitados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  clearFilters();
                  setMobileFiltersOpen(false);
                }}
              >
                Limpar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setMobileFiltersOpen(false);
                  toast.success("Filtros aplicados");
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
