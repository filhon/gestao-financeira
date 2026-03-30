"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { BulkImportDialog } from "@/components/features/finance/BulkImportDialog";
import { Button } from "@/components/ui/button";
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
import { formatCurrency } from "@/lib/utils";
import { DunningStatus } from "@/components/features/finance/DunningStatus";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

// ...

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

  const [filterOptions, setFilterOptions] = useState<{
    status: string;
    dateRange: DateRange | undefined;
  }>({
    status: "exclude-paid",
    dateRange: {
      from: startOfDay(new Date()),
      to: addDays(startOfDay(new Date()), 7),
    },
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

  // KPI calculations
  const kpis = useMemo(() => {
    const today = startOfDay(new Date());

    const overdue = transactions.filter(
      (t) =>
        UNRECEIVED_STATUSES.includes(t.status) && isBefore(t.dueDate, today),
    );

    const dueSoon = transactions.filter(
      (t) =>
        UNRECEIVED_STATUSES.includes(t.status) &&
        (isToday(t.dueDate) || isTomorrow(t.dueDate)),
    );

    const totalPending = transactions.filter((t) =>
      UNRECEIVED_STATUSES.includes(t.status),
    );

    const totalReceived = transactions.filter((t) => t.status === "paid");

    return {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((acc, t) => acc + t.amount, 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((acc, t) => acc + t.amount, 0),
      pendingAmount: totalPending.reduce((acc, t) => acc + t.amount, 0),
      receivedAmount: totalReceived.reduce((acc, t) => acc + t.amount, 0),
    };
  }, [transactions]);

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

  const hasActiveFilters = filterOptions.status !== "exclude-paid";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
        <div className="flex gap-2">
          {canCreateReceivables && (
            <>
              <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Receita
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Nova Conta a Receber</DialogTitle>
                  </DialogHeader>
                  <TransactionForm
                    type="receivable"
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
        type="receivable"
      />

      {/* KPI cards — always visible */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total a Receber
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                formatCurrency(kpis.pendingAmount)
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
              className={`text-2xl font-bold ${kpis.overdueCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}
            >
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                kpis.overdueCount
              )}
            </div>
            <div className="text-xs text-muted-foreground">
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
                kpis.dueSoonCount
              )}
            </div>
            <div className="text-xs text-muted-foreground">
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
            <CardTitle className="text-sm font-medium">Recebido</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {isLoading ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                formatCurrency(kpis.receivedAmount)
              )}
            </div>
            <p className="text-xs text-muted-foreground">No período filtrado</p>
          </CardContent>
        </Card>
      </div>

      {/* Main table card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>Gerencie suas contas a receber.</CardDescription>
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
                  onClick={() =>
                    setFilterOptions({
                      status: "exclude-paid",
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
                {transactions.length === 0 ? (
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
                              setFilterOptions({
                                status: "exclude-paid",
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
                  transactions.map((t) => {
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
                        <TableCell className="text-right font-semibold">
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
                    <TableCell colSpan={7} className="h-14 text-center">
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
