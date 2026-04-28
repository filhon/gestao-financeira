"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  Eye,
  Upload,
  Search,
  X,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Clock,
  TrendingUp,
  DollarSign,
  FileText,
  SlidersHorizontal,
  MoreHorizontal,
} from "lucide-react";
import { BulkImportDialog } from "@/components/features/finance/BulkImportDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Transaction } from "@/lib/types";
import { transactionService } from "@/lib/services/transactionService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import { TransactionFormData } from "@/lib/validations/transaction";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  format,
  addDays,
  startOfDay,
  isBefore,
  isToday,
  isTomorrow,
} from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { DunningStatus } from "@/components/features/finance/DunningStatus";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";

// ── Animated KPI number ──────────────────────────────────────────────────────

function useAnimatedValue(targetValue: number, duration: number = 800) {
  const [currentValue, setCurrentValue] = useState(targetValue);
  const startValueRef = useRef(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startValueRef.current = currentValue;
    startTimeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetValue]);

  useEffect(() => {
    let animationFrameId: number;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const progress = Math.min(
        (timestamp - startTimeRef.current) / duration,
        1,
      );
      const ease = 1 - Math.pow(1 - progress, 4);
      const nextValue =
        startValueRef.current + (targetValue - startValueRef.current) * ease;
      setCurrentValue(nextValue);
      if (progress < 1) animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [targetValue, duration]);

  return currentValue;
}

const AnimatedNumber = ({
  value,
  formatter,
}: {
  value: number;
  formatter?: (n: number) => string;
}) => {
  const animated = useAnimatedValue(value);
  return <>{formatter ? formatter(animated) : Math.round(animated)}</>;
};

// ── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({
  field,
  sortField,
  sortDirection,
}: {
  field: string;
  sortField: string;
  sortDirection: "asc" | "desc";
}) {
  if (sortField !== field) {
    return (
      <ChevronsUpDown className="inline ml-1 h-3.5 w-3.5 text-muted-foreground/50" />
    );
  }
  return sortDirection === "asc" ? (
    <ChevronUp className="inline ml-1 h-3.5 w-3.5 text-primary" />
  ) : (
    <ChevronDown className="inline ml-1 h-3.5 w-3.5 text-primary" />
  );
}

// ── Skeletons ────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-1 py-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-8 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 max-w-[180px]" />
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
            <Skeleton className="h-3 w-32" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-8 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Swipe hook ───────────────────────────────────────────────────────────────

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

// ── Status badge ─────────────────────────────────────────────────────────────

function getStatusBadge(status: string) {
  switch (status) {
    case "draft":
      return (
        <Badge variant="secondary" className="font-medium">
          Rascunho
        </Badge>
      );
    case "pending_approval":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-500/90 font-medium">
          Pendente
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-emerald-500 hover:bg-emerald-500/90 font-medium">
          Ag. Recebimento
        </Badge>
      );
    case "pending_authorization":
      return (
        <Badge className="bg-violet-500 hover:bg-violet-500/90 font-medium">
          Ag. Autorização
        </Badge>
      );
    case "authorized":
      return (
        <Badge className="bg-indigo-500 hover:bg-indigo-500/90 font-medium">
          Autorizado
        </Badge>
      );
    case "paid":
      return (
        <Badge className="bg-blue-500 hover:bg-blue-500/90 font-medium">
          Recebido
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="bg-red-500 hover:bg-red-500/90 font-medium">
          Rejeitado
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const UNRECEIVED_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "rejected",
];

// ── Mobile transaction card ──────────────────────────────────────────────────

interface MobileTransactionCardProps {
  transaction: Transaction;
  isOverdue: boolean;
  canDelete: boolean;
  onViewDetails: () => void;
  onDelete: () => void;
}

function MobileTransactionCard({
  transaction: t,
  isOverdue,
  canDelete,
  onViewDetails,
  onDelete,
}: MobileTransactionCardProps) {
  const swipe = useSwipe(onViewDetails, undefined, 60);

  return (
    <div
      {...swipe}
      className={[
        "relative flex items-start gap-3 px-4 py-3.5 transition-colors select-none",
        "border-l-4",
        isOverdue
          ? "border-l-red-500 bg-red-50 dark:bg-red-900/10"
          : "border-l-transparent",
      ].join(" ")}
    >
      {/* Main content */}
      <button
        type="button"
        className="flex-1 text-left min-w-0 py-0.5"
        onClick={onViewDetails}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug truncate flex-1">
            {t.description}
          </p>
          <span
            className={`text-sm font-bold font-financial shrink-0 ${
              isOverdue ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {formatCurrency(t.amount)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {t.supplierOrClient}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className={`text-xs ${
              isOverdue
                ? "text-red-500 dark:text-red-400 font-medium"
                : "text-muted-foreground"
            }`}
          >
            {format(t.dueDate, "dd MMM yyyy")}
            {isOverdue && " · Em atraso"}
          </span>
          {getStatusBadge(t.status)}
          {t.dunningStatus && <DunningStatus status={t.dunningStatus} />}
        </div>
      </button>

      {/* Actions menu — min 44×44 touch area */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 w-11 p-0 shrink-0 -mr-2"
            aria-label="Ações da transação"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Ações</DropdownMenuLabel>
          <DropdownMenuItem onClick={onViewDetails}>
            <Eye className="mr-2 h-4 w-4" /> Ver detalhes
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-600 focus:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AccountsReceivablePage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [itemsPerPage] = useState(25);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const defaultDateRange = {
    from: startOfDay(new Date()),
    to: addDays(startOfDay(new Date()), 7),
  };

  const [filterOptions, setFilterOptions] = useState<{
    status: string;
    dateRange: DateRange | undefined;
    batchFilter: string;
  }>({
    status: "exclude-paid",
    dateRange: defaultDateRange,
    batchFilter: "all",
  });

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [searchResults, setSearchResults] = useState<Transaction[] | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);

  // ── Sort state — drives Firestore ordering directly ──────────────────────
  const [sortField, setSortField] = useState<string>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback(
    (field: string) => {
      if (field === sortField) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField],
  );

  const { canDeleteReceivables, canCreateReceivables } = usePermissions();

  const {
    items: paginatedTransactions,
    hasMore,
    loadMore,
    isLoading: isPaginatedLoading,
    isFetchingNextPage,
    refresh: fetchTransactions,
    updateItem,
  } = usePaginatedQuery<Transaction>({
    queryKey: [
      "receivable-transactions",
      selectedCompany?.id,
      filterOptions.status,
      filterOptions.dateRange?.from?.toISOString(),
      filterOptions.dateRange?.to?.toISOString(),
      sortField,
      sortDirection,
    ],
    queryFn: async (pageSize, lastDoc) => {
      const filter = {
        type: "receivable" as const,
        excludeStatus: filterOptions.status === "exclude-paid" ? ["paid"] : [],
        status:
          filterOptions.status !== "all" &&
          filterOptions.status !== "exclude-paid"
            ? filterOptions.status
            : undefined,
        startDate: filterOptions.dateRange?.from,
        endDate: filterOptions.dateRange?.to,
        sortField,
        sortDirection,
      };

      const { transactions: items, lastDoc: newLastDoc } =
        await transactionService.getPaginated(
          selectedCompany!.id,
          pageSize,
          lastDoc,
          filter,
        );

      return { items, lastDoc: newLastDoc };
    },
    pageSize: itemsPerPage,
    enabled: !!selectedCompany && !!user && !debouncedSearchTerm && !searchTerm,
  });

  const { targetRef, isIntersecting } =
    useIntersectionObserver<HTMLTableRowElement>({
      threshold: 0.1,
      enabled:
        hasMore && !isFetchingNextPage && !debouncedSearchTerm && !searchTerm,
    });

  useEffect(() => {
    if (
      isIntersecting &&
      hasMore &&
      !debouncedSearchTerm &&
      !searchTerm &&
      !isFetchingNextPage
    ) {
      loadMore();
    }
  }, [
    isIntersecting,
    hasMore,
    debouncedSearchTerm,
    searchTerm,
    isFetchingNextPage,
    loadMore,
  ]);

  // ── Server-side search ───────────────────────────────────────────────────
  useEffect(() => {
    if (debouncedSearchTerm && selectedCompany && user) {
      const performSearch = async () => {
        setIsSearching(true);
        try {
          const params = new URLSearchParams({
            q: debouncedSearchTerm,
            companyId: selectedCompany.id,
            type: "receivable",
            allDates: "true",
            limit: "50",
          });

          const response = await fetch(
            `/api/internal/transactions/search?${params.toString()}`,
            { credentials: "include" },
          );

          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
          }

          const json = await response.json();

          const mapped = (json.data ?? []).map(
            (t: Record<string, unknown>) => ({
              ...t,
              dueDate: t.dueDate ? new Date(t.dueDate as string) : new Date(),
              paymentDate: t.paymentDate
                ? new Date(t.paymentDate as string)
                : undefined,
              approvedAt: t.approvedAt
                ? new Date(t.approvedAt as string)
                : undefined,
              releasedAt: t.releasedAt
                ? new Date(t.releasedAt as string)
                : undefined,
              createdAt: t.createdAt
                ? new Date(t.createdAt as string)
                : undefined,
              updatedAt: t.updatedAt
                ? new Date(t.updatedAt as string)
                : undefined,
              approvalTokenExpiresAt: t.approvalTokenExpiresAt
                ? new Date(t.approvalTokenExpiresAt as string)
                : undefined,
            }),
          ) as Transaction[];

          let filteredResults = mapped;

          if (filterOptions.status === "exclude-paid") {
            filteredResults = filteredResults.filter(
              (t) => t.status !== "paid",
            );
          } else if (filterOptions.status !== "all") {
            filteredResults = filteredResults.filter(
              (t) => t.status === filterOptions.status,
            );
          }

          if (filterOptions.dateRange?.from) {
            filteredResults = filteredResults.filter(
              (t) => t.dueDate >= filterOptions.dateRange!.from!,
            );
          }
          if (filterOptions.dateRange?.to) {
            filteredResults = filteredResults.filter(
              (t) => t.dueDate <= filterOptions.dateRange!.to!,
            );
          }

          setSearchResults(filteredResults);
        } catch (e) {
          console.error(e);
          toast.error("Erro na busca");
        } finally {
          setIsSearching(false);
        }
      };
      performSearch();
    } else {
      setSearchResults(null);
    }
  }, [debouncedSearchTerm, selectedCompany, user, filterOptions]);

  const transactions = searchResults ?? paginatedTransactions;
  const isLoading = debouncedSearchTerm ? isSearching : isPaginatedLoading;

  const batchFilteredTransactions = useMemo(() => {
    if (filterOptions.batchFilter === "in_batch") {
      return transactions.filter((t) => !!t.batchId);
    }
    if (filterOptions.batchFilter === "not_in_batch") {
      return transactions.filter((t) => !t.batchId);
    }
    return transactions;
  }, [transactions, filterOptions.batchFilter]);

  // When batch filter is active and no visible results yet but more pages exist,
  // keep auto-loading silently instead of showing a misleading empty state.
  const isSeekingBatchResults =
    filterOptions.batchFilter !== "all" &&
    batchFilteredTransactions.length === 0 &&
    !isLoading &&
    (hasMore || isFetchingNextPage);

  // ── Filter state helpers ─────────────────────────────────────────────────
  const isDateRangeDefault =
    filterOptions.dateRange?.from?.toDateString() ===
      defaultDateRange.from.toDateString() &&
    filterOptions.dateRange?.to?.toDateString() ===
      defaultDateRange.to.toDateString();

  const hasActiveFilters =
    filterOptions.status !== "exclude-paid" ||
    filterOptions.batchFilter !== "all" ||
    !isDateRangeDefault;

  const activeFilterCount =
    (filterOptions.status !== "exclude-paid" ? 1 : 0) +
    (filterOptions.batchFilter !== "all" ? 1 : 0) +
    (!isDateRangeDefault ? 1 : 0);

  const statusLabels: Record<string, string> = {
    all: "Todas",
    draft: "Rascunho",
    pending_approval: "Pendente",
    approved: "Ag. Recebimento",
    pending_authorization: "Ag. Autorização",
    authorized: "Autorizado",
    paid: "Recebido",
    rejected: "Rejeitado",
  };

  const clearFilters = () =>
    setFilterOptions({
      status: "exclude-paid",
      dateRange: defaultDateRange,
      batchFilter: "all",
    });

  // ── KPI calculations ─────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const today = startOfDay(new Date());

    const overdue = batchFilteredTransactions.filter(
      (t) =>
        UNRECEIVED_STATUSES.includes(t.status) && isBefore(t.dueDate, today),
    );

    const dueSoon = batchFilteredTransactions.filter(
      (t) =>
        UNRECEIVED_STATUSES.includes(t.status) &&
        (isToday(t.dueDate) || isTomorrow(t.dueDate)),
    );

    const totalPending = batchFilteredTransactions.filter((t) =>
      UNRECEIVED_STATUSES.includes(t.status),
    );

    const totalReceived = batchFilteredTransactions.filter(
      (t) => t.status === "paid",
    );

    return {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((acc, t) => acc + t.amount, 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((acc, t) => acc + t.amount, 0),
      pendingAmount: totalPending.reduce((acc, t) => acc + t.amount, 0),
      receivedAmount: totalReceived.reduce((acc, t) => acc + t.amount, 0),
    };
  }, [batchFilteredTransactions]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = async (data: TransactionFormData) => {
    if (!user || !selectedCompany) return;
    try {
      setIsSubmitting(true);

      if (data.recurrence?.isRecurring) {
        await recurrenceService.createTemplate({
          companyId: selectedCompany.id,
          description: data.description,
          amount: data.amount,
          type: "receivable",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          frequency: data.recurrence.frequency as any,
          interval: data.recurrence.interval || 1,
          nextDueDate: data.dueDate,
          active: true,
          baseTransactionData: {
            costCenterAllocation: data.costCenterAllocation,
            supplierOrClient: data.supplierOrClient,
            entityId: data.entityId,
            paymentMethod: data.paymentMethod,
            requestOrigin: data.requestOrigin,
            notes: data.notes || "",
          },
        });
        toast.success("Recorrência criada com sucesso!");
      } else {
        await transactionService.create(
          data,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Conta a receber criada com sucesso!");
      }

      await fetchTransactions();
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Error saving transaction:", error);
      toast.error("Erro ao salvar conta a receber.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewDetails = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDetailsOpen(true);
  };

  const handleTransactionUpdate = useCallback(
    (updatedTransaction?: Transaction) => {
      if (updatedTransaction) {
        updateItem(updatedTransaction.id, () => updatedTransaction);
        setSelectedTransaction(updatedTransaction);
      } else {
        fetchTransactions();
      }
    },
    [fetchTransactions, updateItem],
  );

  const handleDelete = async () => {
    if (!deleteId || !user || !selectedCompany) return;
    try {
      await transactionService.delete(
        deleteId,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Transação excluída com sucesso!");
      fetchTransactions();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error("Erro ao excluir transação.");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">
          Contas a Receber
        </h1>
        <div className="flex gap-2 shrink-0">
          {canCreateReceivables && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                aria-label="Importar transações"
                onClick={() => setIsImportOpen(true)}
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline ml-2">Importar</span>
              </Button>
              <ResponsiveModal
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
              >
                <ResponsiveModalTrigger asChild>
                  <Button
                    size="sm"
                    className="h-9"
                    aria-label="Nova conta a receber"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline ml-2">Nova Receita</span>
                  </Button>
                </ResponsiveModalTrigger>
                <ResponsiveModalContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                  <ResponsiveModalHeader>
                    <ResponsiveModalTitle>
                      Nova Conta a Receber
                    </ResponsiveModalTitle>
                  </ResponsiveModalHeader>
                  <TransactionForm
                    type="receivable"
                    onSubmit={handleSubmit}
                    isLoading={isSubmitting}
                    onCancel={() => setIsDialogOpen(false)}
                  />
                </ResponsiveModalContent>
              </ResponsiveModal>
            </>
          )}
        </div>
      </div>

      <BulkImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchTransactions}
        type="receivable"
      />

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total a Receber
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-xl md:text-2xl font-bold font-financial"
              title={formatCurrency(kpis.pendingAmount)}
            >
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <>
                  <span className="md:hidden">
                    <AnimatedNumber
                      value={kpis.pendingAmount}
                      formatter={formatCurrencyAbbr}
                    />
                  </span>
                  <span className="hidden md:inline">
                    <AnimatedNumber
                      value={kpis.pendingAmount}
                      formatter={formatCurrency}
                    />
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">No período filtrado</p>
          </CardContent>
        </Card>

        <Card
          className={
            kpis.overdueCount > 0 ? "border-red-200 dark:border-red-900" : ""
          }
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Atraso</CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${kpis.overdueCount > 0 ? "text-red-500" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl md:text-2xl font-bold ${kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}
            >
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <AnimatedNumber value={kpis.overdueCount} />
              )}
            </div>
            <div className="text-xs text-muted-foreground font-financial">
              {isLoading ? (
                <Skeleton className="h-3 w-24 mt-1" />
              ) : (
                <>
                  <span className="md:hidden">
                    {formatCurrencyAbbr(kpis.overdueAmount)}
                  </span>
                  <span className="hidden md:inline">
                    {formatCurrency(kpis.overdueAmount)}
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card
          className={
            kpis.dueSoonCount > 0
              ? "border-amber-200 dark:border-amber-900"
              : ""
          }
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Vencem Hoje/Amanhã
            </CardTitle>
            <Clock
              className={`h-4 w-4 ${kpis.dueSoonCount > 0 ? "text-amber-500" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl md:text-2xl font-bold ${kpis.dueSoonCount > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <AnimatedNumber value={kpis.dueSoonCount} />
              )}
            </div>
            <div className="text-xs text-muted-foreground font-financial">
              {isLoading ? (
                <Skeleton className="h-3 w-24 mt-1" />
              ) : (
                <>
                  <span className="md:hidden">
                    {formatCurrencyAbbr(kpis.dueSoonAmount)}
                  </span>
                  <span className="hidden md:inline">
                    {formatCurrency(kpis.dueSoonAmount)}
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recebido</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-xl md:text-2xl font-bold font-financial text-blue-600 dark:text-blue-400"
              title={formatCurrency(kpis.receivedAmount)}
            >
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <>
                  <span className="md:hidden">
                    <AnimatedNumber
                      value={kpis.receivedAmount}
                      formatter={formatCurrencyAbbr}
                    />
                  </span>
                  <span className="hidden md:inline">
                    <AnimatedNumber
                      value={kpis.receivedAmount}
                      formatter={formatCurrency}
                    />
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">No período filtrado</p>
          </CardContent>
        </Card>
      </div>

      {/* Main table card */}
      <Card>
        <CardHeader>
          {/* ── Desktop: título + todos os filtros em uma linha ──── */}
          <div className="hidden md:flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>Gerencie suas contas a receber.</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="receivable-search"
                  placeholder="Buscar transações..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[200px] pl-8 pr-8"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Limpar busca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <DatePickerWithRange
                date={filterOptions.dateRange}
                setDate={(dateRange) =>
                  setFilterOptions((prev) => ({ ...prev, dateRange }))
                }
              />
              <Select
                value={filterOptions.batchFilter}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, batchFilter: val }))
                }
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="in_batch">Em lote</SelectItem>
                  <SelectItem value="not_in_batch">Sem lote</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filterOptions.status}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, status: val }))
                }
              >
                <SelectTrigger id="status-filter" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude-paid">
                    Excluir Recebidas
                  </SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="pending_approval">Pendente</SelectItem>
                  <SelectItem value="approved">Ag. Recebimento</SelectItem>
                  <SelectItem value="pending_authorization">
                    Ag. Autorização
                  </SelectItem>
                  <SelectItem value="authorized">Autorizado</SelectItem>
                  <SelectItem value="paid">Recebido</SelectItem>
                  <SelectItem value="rejected">Rejeitado</SelectItem>
                </SelectContent>
              </Select>
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
            <CardTitle>Transações</CardTitle>
            {!isLoading && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {batchFilteredTransactions.length}
                {hasMore ? "+" : ""} resultado
                {batchFilteredTransactions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* ── Mobile: busca + botão de filtros ───────────────────── */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar transações..."
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

          {/* ── Mobile: chips de filtros ativos ────────────────────── */}
          {activeFilterCount > 0 && (
            <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {!isDateRangeDefault && filterOptions.dateRange?.from && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  <span>
                    {format(filterOptions.dateRange.from, "dd/MM")}
                    {filterOptions.dateRange.to &&
                      ` – ${format(filterOptions.dateRange.to, "dd/MM")}`}
                  </span>
                  <button
                    onClick={() =>
                      setFilterOptions((prev) => ({
                        ...prev,
                        dateRange: defaultDateRange,
                      }))
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de período"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              {filterOptions.batchFilter !== "all" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  {filterOptions.batchFilter === "in_batch"
                    ? "Em lote"
                    : "Sem lote"}
                  <button
                    onClick={() =>
                      setFilterOptions((prev) => ({
                        ...prev,
                        batchFilter: "all",
                      }))
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de lote"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              {filterOptions.status !== "exclude-paid" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  {statusLabels[filterOptions.status] ?? filterOptions.status}
                  <button
                    onClick={() =>
                      setFilterOptions((prev) => ({
                        ...prev,
                        status: "exclude-paid",
                      }))
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de status"
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
              <div className="hidden md:block">
                <TableSkeleton />
              </div>
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
                      <TableHead
                        className="cursor-pointer hover:text-primary w-[120px]"
                        onClick={() => handleSort("dueDate")}
                      >
                        Vencimento
                        <SortIcon
                          field="dueDate"
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary"
                        onClick={() => handleSort("description")}
                      >
                        Descrição
                        <SortIcon
                          field="description"
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary"
                        onClick={() => handleSort("supplierOrClient")}
                      >
                        Cliente
                        <SortIcon
                          field="supplierOrClient"
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary text-right"
                        onClick={() => handleSort("amount")}
                      >
                        Valor
                        <SortIcon
                          field="amount"
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary"
                        onClick={() => handleSort("status")}
                      >
                        Status
                        <SortIcon
                          field="status"
                          sortField={sortField}
                          sortDirection={sortDirection}
                        />
                      </TableHead>
                      <TableHead>Cobrança</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchFilteredTransactions.length === 0 &&
                    isSeekingBatchResults ? (
                      <TableRow>
                        <TableCell colSpan={7} className="p-0">
                          <TableSkeleton />
                        </TableCell>
                      </TableRow>
                    ) : batchFilteredTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-36 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <FileText className="h-8 w-8 opacity-40" />
                            <p className="text-sm font-medium">
                              {debouncedSearchTerm
                                ? `Nenhum resultado para "${debouncedSearchTerm}"`
                                : hasActiveFilters
                                  ? "Nenhuma conta encontrada com os filtros selecionados"
                                  : "Nenhuma conta a receber cadastrada"}
                            </p>
                            {(debouncedSearchTerm || hasActiveFilters) && (
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() => {
                                  setSearchTerm("");
                                  clearFilters();
                                }}
                              >
                                Limpar filtros
                              </Button>
                            )}
                            {!debouncedSearchTerm &&
                              !hasActiveFilters &&
                              canCreateReceivables && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs"
                                  onClick={() => setIsDialogOpen(true)}
                                >
                                  Criar primeira receita
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      batchFilteredTransactions.map((t) => {
                        const isOverdue =
                          UNRECEIVED_STATUSES.includes(t.status) &&
                          isBefore(t.dueDate, startOfDay(new Date()));

                        return (
                          <TableRow
                            key={t.id}
                            className={
                              isOverdue ? "bg-red-50 dark:bg-red-900/10" : ""
                            }
                          >
                            <TableCell>
                              <div
                                className={
                                  isOverdue
                                    ? "font-medium text-red-600 dark:text-red-400"
                                    : ""
                                }
                              >
                                {format(t.dueDate, "dd MMM yyyy")}
                                {isOverdue && (
                                  <div className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
                                    Em atraso
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{t.description}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {t.supplierOrClient}
                            </TableCell>
                            <TableCell className="text-right font-semibold font-financial">
                              {formatCurrency(t.amount)}
                            </TableCell>
                            <TableCell>{getStatusBadge(t.status)}</TableCell>
                            <TableCell>
                              <DunningStatus status={t.dunningStatus} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleViewDetails(t)}
                                  title="Ver detalhes"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canDeleteReceivables && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-red-500 hover:text-red-700"
                                    onClick={() => setDeleteId(t.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                    {hasMore && !debouncedSearchTerm && (
                      <TableRow ref={targetRef}>
                        <TableCell
                          colSpan={7}
                          className={
                            isFetchingNextPage && !isSeekingBatchResults
                              ? "py-3 text-center"
                              : "h-px p-0"
                          }
                        >
                          {isFetchingNextPage && !isSeekingBatchResults && (
                            <div className="flex justify-center items-center text-muted-foreground gap-2">
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Carregando mais...
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile: Card list ────────────────────────────────── */}
              <div className="md:hidden">
                {batchFilteredTransactions.length === 0 &&
                isSeekingBatchResults ? (
                  <MobileCardSkeleton />
                ) : batchFilteredTransactions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 px-4 text-muted-foreground">
                    <FileText className="h-8 w-8 opacity-40" />
                    <p className="text-sm font-medium text-center">
                      {debouncedSearchTerm
                        ? `Nenhum resultado para "${debouncedSearchTerm}"`
                        : hasActiveFilters
                          ? "Nenhuma conta encontrada com os filtros selecionados"
                          : "Nenhuma conta a receber cadastrada"}
                    </p>
                    {(debouncedSearchTerm || hasActiveFilters) && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => {
                          setSearchTerm("");
                          clearFilters();
                        }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                    {!debouncedSearchTerm &&
                      !hasActiveFilters &&
                      canCreateReceivables && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => setIsDialogOpen(true)}
                        >
                          Criar primeira receita
                        </Button>
                      )}
                  </div>
                ) : (
                  <>
                    <div className="divide-y">
                      {batchFilteredTransactions.map((t) => {
                        const isOverdue =
                          UNRECEIVED_STATUSES.includes(t.status) &&
                          isBefore(t.dueDate, startOfDay(new Date()));

                        return (
                          <MobileTransactionCard
                            key={t.id}
                            transaction={t}
                            isOverdue={isOverdue}
                            canDelete={canDeleteReceivables}
                            onViewDetails={() => handleViewDetails(t)}
                            onDelete={() => setDeleteId(t.id)}
                          />
                        );
                      })}
                    </div>

                    {hasMore && !debouncedSearchTerm && (
                      <div
                        ref={targetRef}
                        className={
                          isFetchingNextPage && !isSeekingBatchResults
                            ? "py-4 text-center"
                            : "h-px"
                        }
                      >
                        {isFetchingNextPage && !isSeekingBatchResults && (
                          <div className="flex justify-center items-center text-muted-foreground gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Carregando mais...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
                      filterOptions.dateRange?.from
                        ? format(filterOptions.dateRange.from, "yyyy-MM-dd")
                        : ""
                    }
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setFilterOptions((prev) => ({
                        ...prev,
                        dateRange: { from: adjusted, to: prev.dateRange?.to },
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Até</Label>
                  <Input
                    type="date"
                    value={
                      filterOptions.dateRange?.to
                        ? format(filterOptions.dateRange.to, "yyyy-MM-dd")
                        : ""
                    }
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setFilterOptions((prev) => ({
                        ...prev,
                        dateRange: { from: prev.dateRange?.from, to: adjusted },
                      }));
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Lote */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lote
              </p>
              <Select
                value={filterOptions.batchFilter}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, batchFilter: val }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="in_batch">Em lote</SelectItem>
                  <SelectItem value="not_in_batch">Sem lote</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <Select
                value={filterOptions.status}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, status: val }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude-paid">
                    Excluir Recebidas
                  </SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="pending_approval">Pendente</SelectItem>
                  <SelectItem value="approved">Ag. Recebimento</SelectItem>
                  <SelectItem value="pending_authorization">
                    Ag. Autorização
                  </SelectItem>
                  <SelectItem value="authorized">Autorizado</SelectItem>
                  <SelectItem value="paid">Recebido</SelectItem>
                  <SelectItem value="rejected">Rejeitado</SelectItem>
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

      <TransactionDetailsDialog
        transaction={selectedTransaction}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onUpdate={handleTransactionUpdate}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir Transação"
        description="Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
