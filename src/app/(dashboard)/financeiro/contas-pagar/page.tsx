"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  Eye,
  Upload,
  Search,
  RotateCcw,
  CheckCheck,
  CheckCircle2,
  DollarSign,
  MoreHorizontal,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  X,
  AlertTriangle,
  Clock,
  TrendingDown,
  FileText,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Transaction } from "@/lib/types";
import { transactionService } from "@/lib/services/transactionService";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import { SmartBatchesCarousel } from "@/components/features/finance/SmartBatchesCarousel";
import { TransactionFormData } from "@/lib/validations/transaction";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  format,
  addDays,
  isBefore,
  startOfDay,
  isToday,
  isTomorrow,
} from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { PaymentBatch } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useSortableData } from "@/hooks/useSortableData";
import { usePermissions } from "@/hooks/usePermissions";
import { useDebounce } from "@/hooks/useDebounce";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { CurrencyInput } from "@/components/ui/currency-input";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";

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

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
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

function SortIcon({
  field,
  sortConfig,
}: {
  field: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== field) {
    return (
      <ChevronsUpDown className="inline ml-1 h-3.5 w-3.5 text-muted-foreground/50" />
    );
  }
  return sortConfig.direction === "asc" ? (
    <ChevronUp className="inline ml-1 h-3.5 w-3.5 text-primary" />
  ) : (
    <ChevronDown className="inline ml-1 h-3.5 w-3.5 text-primary" />
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-1 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

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
          Aprovado
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
          Pago
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

const UNPAID_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "rejected",
];

// ...

export default function AccountsPayablePage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);

  const [filterOptions, setFilterOptions] = useState<{
    status: string;
    costCenterId: string;
    dateRange: DateRange | undefined;
  }>({
    status: "exclude-paid",
    costCenterId: "all",
    dateRange: {
      from: startOfDay(new Date()),
      to: addDays(startOfDay(new Date()), 7),
    },
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isBatchPaymentOpen, setIsBatchPaymentOpen] = useState(false);
  const [isBatchRevertOpen, setIsBatchRevertOpen] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchPaymentDate, setBatchPaymentDate] = useState<Date>(new Date());
  const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
  const [newBatchName, setNewBatchName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Payment Confirmation State
  const [transactionToConfirm, setTransactionToConfirm] =
    useState<Transaction | null>(null);
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  const [itemsPerPage] = useState(25);

  const {
    canDeletePayables,
    canCreatePayables,
    onlyOwnPayables,
    canEditPayables,
    isAdmin,
    isFinancialManager,
  } = usePermissions();

  const [searchResults, setSearchResults] = useState<Transaction[] | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);

  const getDescendantIds = useCallback(
    (rootId: string, all: CostCenter[]): string[] => {
      const children = all.filter((c) => c.parentId === rootId);
      let ids = [rootId];
      for (const child of children) {
        ids = [...ids, ...getDescendantIds(child.id, all)];
      }
      return ids;
    },
    [],
  );

  const {
    items: paginatedTransactions,
    hasMore,
    loadMore,
    isLoading: isPaginatedLoading,
    isFetchingNextPage,
    refresh: refreshTransactions,
    updateItem,
  } = usePaginatedQuery<Transaction>({
    queryKey: [
      "payable-transactions",
      selectedCompany?.id,
      filterOptions.status,
      filterOptions.dateRange?.from?.toISOString(),
      filterOptions.dateRange?.to?.toISOString(),
      filterOptions.costCenterId,
      onlyOwnPayables ? user?.uid : "all",
    ],
    queryFn: async (pageSize, lastDoc) => {
      const targetCostCenterIds =
        filterOptions.costCenterId !== "all" && costCenters.length > 0
          ? getDescendantIds(filterOptions.costCenterId, costCenters)
          : undefined;

      const filter: {
        type: string;
        excludeStatus?: string[];
        status?: string;
        startDate?: Date;
        endDate?: Date;
        createdBy?: string;
        costCenterIds?: string[];
      } = {
        type: "payable",
        excludeStatus: filterOptions.status === "exclude-paid" ? ["paid"] : [],
        status:
          filterOptions.status !== "all" &&
          filterOptions.status !== "exclude-paid"
            ? filterOptions.status
            : undefined,
        startDate: filterOptions.dateRange?.from,
        endDate: filterOptions.dateRange?.to,
        costCenterIds: targetCostCenterIds,
      };

      if (onlyOwnPayables) {
        filter.createdBy = user!.uid;
      }

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

  const transactions = searchResults ?? paginatedTransactions;
  const isLoading = debouncedSearchTerm ? isSearching : isPaginatedLoading;

  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(transactions, {
    key: "dueDate",
    direction: "asc",
  });

  // KPI calculations
  const kpis = useMemo(() => {
    const today = startOfDay(new Date());

    const overdue = transactions.filter(
      (t) => UNPAID_STATUSES.includes(t.status) && isBefore(t.dueDate, today),
    );

    const dueSoon = transactions.filter(
      (t) =>
        UNPAID_STATUSES.includes(t.status) &&
        (isToday(t.dueDate) || isTomorrow(t.dueDate)),
    );

    const totalPending = transactions.filter((t) =>
      UNPAID_STATUSES.includes(t.status),
    );

    const totalPaid = transactions.filter((t) => t.status === "paid");

    return {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((acc, t) => acc + t.amount, 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((acc, t) => acc + t.amount, 0),
      pendingAmount: totalPending.reduce((acc, t) => acc + t.amount, 0),
      paidAmount: totalPaid.reduce((acc, t) => acc + t.amount, 0),
    };
  }, [transactions]);

  const handleOpenPaymentConfirmation = async (t: Transaction) => {
    if (!user || !selectedCompany) return;
    try {
      if (t.batchId) {
        setIsConfirmingPayment(true);
        const batch = await paymentBatchService.getById(t.batchId);
        setIsConfirmingPayment(false);
        if (batch) {
          const allowedStatuses = [
            "approved",
            "authorized",
            "pending_authorization",
            "paid",
          ];
          if (!allowedStatuses.includes(batch.status)) {
            toast.error(
              "O lote desta transação precisa estar aprovado para confirmar o pagamento.",
            );
            return;
          }
        }
      }

      setTransactionToConfirm(t);
      setPaymentDate(new Date());
      setPaymentAmount(t.amount);
    } catch (error) {
      console.error("Error validating batch:", error);
      toast.error("Erro ao validar lote.");
      setIsConfirmingPayment(false);
    }
  };

  const handleExecutePayment = async () => {
    if (!transactionToConfirm || !user || !selectedCompany) return;

    try {
      setIsConfirmingPayment(true);
      await transactionService.update(
        transactionToConfirm.id,
        {
          status: "paid",
          paymentDate: paymentDate,
          finalAmount: paymentAmount,
        },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      toast.success("Pagamento confirmado com sucesso!");
      refreshTransactions();
      setTransactionToConfirm(null);
    } catch (error) {
      console.error("Error confirming payment:", error);
      toast.error("Erro ao confirmar pagamento.");
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const fetchTransactions = refreshTransactions;

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

  useEffect(() => {
    if (selectedCompany) {
      costCenterService
        .getAll(selectedCompany.id)
        .then((ccs) => {
          setCostCenters(ccs);
        })
        .catch((err) => console.error("Error loading cost centers", err));
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (debouncedSearchTerm && selectedCompany && user) {
      const performSearch = async () => {
        setIsSearching(true);
        try {
          const params = new URLSearchParams({
            q: debouncedSearchTerm,
            companyId: selectedCompany.id,
            type: "payable",
            allDates: "true",
            limit: "50",
          });

          if (onlyOwnPayables) {
            params.set("createdBy", user.uid);
          }

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

          if (filterOptions.costCenterId !== "all" && costCenters.length > 0) {
            const descendantIds = getDescendantIds(
              filterOptions.costCenterId,
              costCenters,
            );
            filteredResults = filteredResults.filter(
              (t) =>
                t.costCenterAllocation?.some((alloc) =>
                  descendantIds.includes(alloc.costCenterId),
                ) ||
                descendantIds.includes(
                  ((t as unknown as Record<string, unknown>)
                    .costCenterId as string) ?? "",
                ),
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

    setSelectedIds(new Set());
  }, [
    debouncedSearchTerm,
    selectedCompany,
    user,
    onlyOwnPayables,
    filterOptions,
    costCenters,
    getDescendantIds,
  ]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(sortedTransactions.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const fetchOpenBatches = async () => {
    if (!selectedCompany) return;
    try {
      const { batches: allBatches } = await paymentBatchService.getAll(
        selectedCompany.id,
      );
      setOpenBatches(allBatches.filter((b) => b.status === "open"));
    } catch {
      toast.error("Erro ao carregar lotes");
    }
  };

  const handleAddToBatch = async (batchId: string) => {
    try {
      const selectedTx = transactions.filter((t) => selectedIds.has(t.id));

      const nonDraftTransactions = selectedTx.filter(
        (t) => t.status !== "draft",
      );
      if (nonDraftTransactions.length > 0) {
        toast.error(
          "Apenas transações em rascunho podem ser adicionadas ao lote",
        );
        return;
      }

      await paymentBatchService.addTransactions(batchId, selectedTx);
      toast.success("Transações adicionadas ao lote");
      setIsBatchDialogOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao adicionar ao lote");
    }
  };

  const handleCreateAndAddToBatch = async () => {
    if (!selectedCompany || !user || !newBatchName.trim()) return;
    try {
      const batchRef = await paymentBatchService.create(
        newBatchName,
        selectedCompany.id,
        user.uid,
      );
      await handleAddToBatch(batchRef.id);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao criar e adicionar ao lote");
    }
  };

  const handleBatchPayment = async () => {
    if (!user || !selectedCompany) return;

    const transactionsToPay = transactions.filter(
      (t) => selectedIds.has(t.id) && t.status !== "paid",
    );

    if (transactionsToPay.length === 0) {
      toast.error("Nenhuma transação elegível para pagamento selecionada.");
      return;
    }

    try {
      setIsProcessingBatch(true);

      await transactionService.updateBatch(
        transactionsToPay.map((t) => t.id),
        { status: "paid", paymentDate: batchPaymentDate },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      toast.success(
        `${transactionsToPay.length} transações pagas com sucesso!`,
      );
      setIsBatchPaymentOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao realizar pagamento em lote.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleBatchRevert = async () => {
    if (!user || !selectedCompany) return;

    const transactionsToRevert = transactions.filter(
      (t) => selectedIds.has(t.id) && t.status === "paid",
    );

    if (transactionsToRevert.length === 0) {
      toast.error("Nenhuma transação paga selecionada para reversão.");
      return;
    }

    try {
      setIsProcessingBatch(true);

      await transactionService.updateBatch(
        transactionsToRevert.map((t) => t.id),
        { status: "draft" },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      toast.success(
        `${transactionsToRevert.length} pagamentos revertidos com sucesso!`,
      );
      setIsBatchRevertOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao reverter pagamentos em lote.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleSubmit = async (data: TransactionFormData) => {
    if (!user || !selectedCompany) return;
    try {
      setIsSubmitting(true);

      if (data.recurrence?.isRecurring) {
        await recurrenceService.createTemplate({
          companyId: selectedCompany.id,
          description: data.description,
          amount: data.amount,
          type: "payable",
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
        toast.success("Conta a pagar criada com sucesso!");
      }

      await fetchTransactions();
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Error saving transaction:", error);
      toast.error("Erro ao salvar conta a pagar.");
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
        refreshTransactions();
      }
    },
    [refreshTransactions, updateItem],
  );

  const handleRevertToDraft = async (transaction: Transaction) => {
    if (!user || !selectedCompany) return;
    try {
      await transactionService.update(
        transaction.id,
        { status: "draft" },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Transação revertida para rascunho!");
      fetchTransactions();
    } catch (error) {
      console.error("Error reverting transaction:", error);
      toast.error("Erro ao reverter transação.");
    }
  };

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

  const selectedTotal = transactions
    .filter((t) => selectedIds.has(t.id))
    .reduce((acc, t) => acc + t.amount, 0);

  const hasActiveFilters =
    filterOptions.status !== "exclude-paid" ||
    filterOptions.costCenterId !== "all";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>

        <div className="flex gap-2">
          {canCreatePayables && (
            <>
              <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Conta
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Nova Conta a Pagar</DialogTitle>
                  </DialogHeader>
                  <TransactionForm
                    type="payable"
                    onSubmit={handleSubmit}
                    isLoading={isSubmitting}
                    onCancel={() => setIsDialogOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <BulkImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchTransactions}
        type="payable"
      />

      {/* KPI cards — always visible */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total a Pagar</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-financial">
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <AnimatedNumber
                  value={kpis.pendingAmount}
                  formatter={formatCurrency}
                />
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
            <CardTitle className="text-sm font-medium">Vencidas</CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${kpis.overdueCount > 0 ? "text-red-500" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}
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
                formatCurrency(kpis.overdueAmount)
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
              className={`text-2xl font-bold ${kpis.dueSoonCount > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}
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
                formatCurrency(kpis.dueSoonAmount)
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagas</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-financial text-blue-600 dark:text-blue-400">
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <AnimatedNumber
                  value={kpis.paidAmount}
                  formatter={formatCurrency}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">No período filtrado</p>
          </CardContent>
        </Card>
      </div>

      {/* Sugestões automáticas de lotes */}
      <SmartBatchesCarousel onBatchAccepted={refreshTransactions} />

      {/* Main table card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>
                Gerencie suas contas a pagar e fluxo de aprovação.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DatePickerWithRange
                date={filterOptions.dateRange}
                setDate={(dateRange) =>
                  setFilterOptions((prev) => ({ ...prev, dateRange }))
                }
              />
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
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
              <Select
                value={filterOptions.costCenterId}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, costCenterId: val }))
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Centro de Custo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os centros</SelectItem>
                  {costCenters.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.name}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="exclude-paid">Excluir Pagas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="pending_approval">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovado</SelectItem>
                  <SelectItem value="pending_authorization">
                    Ag. Autorização
                  </SelectItem>
                  <SelectItem value="authorized">Autorizado</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="rejected">Rejeitado</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setFilterOptions({
                      status: "exclude-paid",
                      costCenterId: "all",
                      dateRange: {
                        from: startOfDay(new Date()),
                        to: addDays(startOfDay(new Date()), 7),
                      },
                    })
                  }
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Limpar filtros
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={
                        sortedTransactions.length > 0 &&
                        sortedTransactions.every((t) => selectedIds.has(t.id))
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary w-[120px]"
                    onClick={() => requestSort("dueDate")}
                  >
                    Vencimento
                    <SortIcon field="dueDate" sortConfig={sortConfig} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("description")}
                  >
                    Descrição
                    <SortIcon field="description" sortConfig={sortConfig} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("supplierOrClient")}
                  >
                    Fornecedor
                    <SortIcon
                      field="supplierOrClient"
                      sortConfig={sortConfig}
                    />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary text-right"
                    onClick={() => requestSort("amount")}
                  >
                    Valor
                    <SortIcon field="amount" sortConfig={sortConfig} />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("status")}
                  >
                    Status
                    <SortIcon field="status" sortConfig={sortConfig} />
                  </TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-36 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="h-8 w-8 opacity-40" />
                        <p className="text-sm font-medium">
                          {debouncedSearchTerm
                            ? `Nenhum resultado para "${debouncedSearchTerm}"`
                            : hasActiveFilters
                              ? "Nenhuma conta encontrada com os filtros selecionados"
                              : "Nenhuma conta a pagar cadastrada"}
                        </p>
                        {(debouncedSearchTerm || hasActiveFilters) && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => {
                              setSearchTerm("");
                              setFilterOptions({
                                status: "exclude-paid",
                                costCenterId: "all",
                                dateRange: {
                                  from: startOfDay(new Date()),
                                  to: addDays(startOfDay(new Date()), 7),
                                },
                              });
                            }}
                          >
                            Limpar filtros
                          </Button>
                        )}
                        {!debouncedSearchTerm &&
                          !hasActiveFilters &&
                          canCreatePayables && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setIsDialogOpen(true)}
                            >
                              Criar primeira conta
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedTransactions.map((t) => {
                    const isOverdue =
                      UNPAID_STATUSES.includes(t.status) &&
                      isBefore(t.dueDate, startOfDay(new Date()));

                    return (
                      <TableRow
                        key={t.id}
                        className={
                          isOverdue ? "bg-red-50 dark:bg-red-900/10" : ""
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleSelect(t.id)}
                          />
                        </TableCell>
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
                                Vencida
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex items-center gap-2">
                            <span className="truncate" title={t.description}>
                              {t.description}
                            </span>
                            {t.batchId && (
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px]"
                              >
                                Em Lote
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {t.supplierOrClient}
                        </TableCell>
                        <TableCell className="text-right font-semibold font-financial">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          }).format(t.amount)}
                        </TableCell>
                        <TableCell>{getStatusBadge(t.status)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Abrir menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Ações</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => handleViewDetails(t)}
                              >
                                <Eye className="mr-2 h-4 w-4" /> Ver detalhes
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {(isAdmin || isFinancialManager) &&
                                t.status !== "paid" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleOpenPaymentConfirmation(t)
                                    }
                                    className="text-green-600 focus:text-green-700"
                                  >
                                    <CheckCheck className="mr-2 h-4 w-4" />{" "}
                                    Confirmar Pagamento
                                  </DropdownMenuItem>
                                )}
                              {canEditPayables &&
                                t.status === "pending_approval" && (
                                  <DropdownMenuItem
                                    onClick={() => handleRevertToDraft(t)}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" />{" "}
                                    Reverter para Rascunho
                                  </DropdownMenuItem>
                                )}
                              {canDeletePayables && (
                                <DropdownMenuItem
                                  onClick={() => setDeleteId(t.id)}
                                  className="text-red-600 focus:text-red-700"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
                {hasMore && !debouncedSearchTerm && (
                  <TableRow ref={targetRef}>
                    <TableCell colSpan={8} className="h-14 text-center">
                      <div className="flex justify-center items-center h-full text-muted-foreground gap-2">
                        {isFetchingNextPage ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Carregando mais...
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bulk action bar — floats at bottom when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 rounded-xl border bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2 pr-3 border-r">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">
                {selectedIds.size} selecionada
                {selectedIds.size !== 1 ? "s" : ""}
              </span>
              <span className="text-sm text-muted-foreground">
                —{" "}
                <AnimatedNumber
                  value={selectedTotal}
                  formatter={formatCurrency}
                />
              </span>
            </div>

            <Dialog
              open={isBatchDialogOpen}
              onOpenChange={setIsBatchDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={fetchOpenBatches}
                >
                  Adicionar ao Lote
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar ao Lote de Pagamento</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Selecione um Lote Aberto</Label>
                    {openBatches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum lote aberto encontrado.
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {openBatches.map((batch) => (
                          <Button
                            key={batch.id}
                            variant="outline"
                            className="justify-start"
                            onClick={() => handleAddToBatch(batch.id)}
                          >
                            {batch.name} ({formatCurrency(batch.totalAmount)})
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Ou crie um novo
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nome do novo lote"
                      value={newBatchName}
                      onChange={(e) => setNewBatchName(e.target.value)}
                    />
                    <Button onClick={handleCreateAndAddToBatch}>
                      Criar e Adicionar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog
              open={isBatchPaymentOpen}
              onOpenChange={setIsBatchPaymentOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                >
                  Pagar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Pagamento em Lote</DialogTitle>
                  <CardDescription>
                    Serão pagos{" "}
                    {
                      transactions.filter(
                        (t) => selectedIds.has(t.id) && t.status !== "paid",
                      ).length
                    }{" "}
                    itens selecionados. Itens já pagos serão ignorados.
                  </CardDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Data do Pagamento</Label>
                    <Input
                      type="date"
                      value={format(batchPaymentDate, "yyyy-MM-dd")}
                      onChange={(e) => {
                        const date = e.target.valueAsDate;
                        if (date) {
                          const userTimezoneOffset =
                            date.getTimezoneOffset() * 60000;
                          setBatchPaymentDate(
                            new Date(date.getTime() + userTimezoneOffset),
                          );
                        }
                      }}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setIsBatchPaymentOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleBatchPayment}
                      disabled={isProcessingBatch}
                    >
                      {isProcessingBatch && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Confirmar Pagamento
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog
              open={isBatchRevertOpen}
              onOpenChange={setIsBatchRevertOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  Reverter
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reverter Pagamento em Lote</DialogTitle>
                  <CardDescription>
                    Deseja reverter o pagamento de{" "}
                    {
                      transactions.filter(
                        (t) => selectedIds.has(t.id) && t.status === "paid",
                      ).length
                    }{" "}
                    itens selecionados para Rascunho? Itens não pagos serão
                    ignorados.
                  </CardDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setIsBatchRevertOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleBatchRevert}
                    disabled={isProcessingBatch}
                  >
                    {isProcessingBatch && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Confirmar Reversão
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <TransactionDetailsDialog
        transaction={selectedTransaction}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onUpdate={handleTransactionUpdate}
        costCenters={costCenters}
      />

      {/* Payment confirmation dialog — with transaction context */}
      <Dialog
        open={!!transactionToConfirm}
        onOpenChange={(open) => {
          if (!open) setTransactionToConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento</DialogTitle>
          </DialogHeader>
          {transactionToConfirm && (
            <div className="space-y-4 py-4">
              {/* Transaction summary */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fornecedor</span>
                  <span className="font-medium">
                    {transactionToConfirm.supplierOrClient}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descrição</span>
                  <span
                    className="font-medium truncate max-w-[200px]"
                    title={transactionToConfirm.description}
                  >
                    {transactionToConfirm.description}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor original</span>
                  <span className="font-semibold font-financial">
                    {formatCurrency(transactionToConfirm.amount)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Data do Pagamento</Label>
                <Input
                  type="date"
                  value={format(paymentDate, "yyyy-MM-dd")}
                  onChange={(e) => {
                    const date = e.target.valueAsDate;
                    if (date) {
                      const userTimezoneOffset =
                        date.getTimezoneOffset() * 60000;
                      setPaymentDate(
                        new Date(date.getTime() + userTimezoneOffset),
                      );
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Valor Pago</Label>
                <CurrencyInput
                  value={paymentAmount}
                  onChange={(val) => setPaymentAmount(val)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setTransactionToConfirm(null)}
                  disabled={isConfirmingPayment}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleExecutePayment}
                  disabled={isConfirmingPayment}
                >
                  {isConfirmingPayment && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Confirmar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
