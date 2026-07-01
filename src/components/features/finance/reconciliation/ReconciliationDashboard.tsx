"use client";

import { useEffect, useState, useMemo } from "react";
import { UploadStatement } from "@/components/features/finance/reconciliation/UploadStatement";
import { ReconciliationTable } from "@/components/features/finance/reconciliation/ReconciliationTable";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { transactionService } from "@/lib/services/transactionService";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { entityService } from "@/lib/services/entityService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  RefreshCw,
  DollarSign,
  Trash2,
  FileText,
  SlidersHorizontal,
  X,
  Check,
  Plus,
  Zap,
  MinusCircle,
  Circle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BankTransaction } from "@/lib/types";
import { subDays, addDays, format } from "date-fns";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionFormData } from "@/lib/validations/transaction";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn, formatCurrency } from "@/lib/utils";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";

function getStatusBadge(status: BankTransaction["status"]) {
  switch (status) {
    case "matched":
      return (
        <Badge className="bg-green-500 hover:bg-green-600 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Corresp.
        </Badge>
      );
    case "potential_match":
      return (
        <Badge
          variant="secondary"
          className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 gap-1"
        >
          <Zap className="h-3 w-3" />
          Sugestão
        </Badge>
      );
    case "ignored":
      return (
        <Badge variant="outline" className="gap-1">
          <MinusCircle className="h-3 w-3" />
          Ignorado
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Circle className="h-3 w-3" />
          Novo
        </Badge>
      );
  }
}

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

interface MobileBankTxCardProps {
  tx: BankTransaction;
  onAction: (
    id: string,
    action: "confirm" | "create" | "ignore",
    matchedId?: string,
  ) => void;
  readOnly?: boolean;
}

function MobileBankTxCard({ tx, onAction, readOnly }: MobileBankTxCardProps) {
  return (
    <div
      className={cn(
        "px-4 py-3.5 border-l-4 transition-all",
        tx.status === "matched"
          ? "border-l-green-500 bg-green-50/50 dark:bg-green-900/10 opacity-70"
          : tx.status === "potential_match"
            ? "border-l-yellow-400"
            : tx.status === "ignored"
              ? "border-l-transparent opacity-50 grayscale"
              : "border-l-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-muted-foreground">
          {format(new Date(tx.date), "dd/MM/yyyy")}
        </span>
        {getStatusBadge(tx.status)}
      </div>

      <p className="text-sm font-medium truncate" title={tx.description}>
        {tx.description}
      </p>

      <div
        className={cn(
          "text-sm font-semibold font-financial mt-1",
          tx.amount < 0 ? "text-red-600" : "text-green-600",
        )}
      >
        <span className="text-xs opacity-70 mr-1">
          {tx.amount < 0 ? "▼" : "▲"}
        </span>
        {formatCurrency(Math.abs(tx.amount))}
      </div>

      {/* Match suggestion preview */}
      {tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0 ? (
        <div className="mt-2 text-xs bg-muted/50 rounded p-2">
          <span className="font-medium text-green-700">
            Combo ({tx.matchedTransactionIds.length} itens)
          </span>
          <span className="ml-2 text-muted-foreground font-financial">
            {formatCurrency(Math.abs(tx.amount))} total
          </span>
        </div>
      ) : tx.matchedDetails ? (
        <div className="mt-2 text-xs bg-muted/50 rounded p-2">
          <p className="font-medium truncate">
            {tx.matchedDetails.description || "Sem descrição"}
          </p>
          <div className="flex justify-between text-muted-foreground mt-0.5">
            <span>
              {format(new Date(tx.matchedDetails.dueDate), "dd/MM/yyyy")}
            </span>
            <span className="font-financial">
              {formatCurrency(tx.matchedDetails.amount)}
            </span>
          </div>
          {tx.confidence && tx.confidence < 100 && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="h-1 rounded-full bg-muted flex-1 overflow-hidden">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    tx.confidence >= 80
                      ? "bg-green-500"
                      : tx.confidence >= 60
                        ? "bg-yellow-500"
                        : "bg-red-400",
                  )}
                  style={{ width: `${tx.confidence}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {tx.confidence}%
              </span>
            </div>
          )}
        </div>
      ) : tx.matchCandidates && tx.matchCandidates.length > 0 ? (
        <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
          {tx.matchCandidates.length} sugestão(ões) disponível(eis)
        </div>
      ) : null}

      {/* Actions */}
      {!readOnly && (
        <div className="flex gap-2 mt-2.5 justify-end items-center">
          {tx.status === "potential_match" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={() => onAction(tx.id, "confirm")}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Confirmar
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => onAction(tx.id, "ignore")}
                title="Ignorar"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          {tx.status === "unmatched" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onAction(tx.id, "create")}
              >
                <Plus className="h-3 w-3 mr-1" />
                Criar
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => onAction(tx.id, "ignore")}
                title="Ignorar"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          {tx.status === "matched" && (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          )}
        </div>
      )}
    </div>
  );
}

export function ReconciliationDashboard() {
  const {
    transactions,
    isLoading: isStoreLoading,
    setTransactions,
    updateTransactionStatus,
    clearSession,
    setIsLoading,
  } = useReconciliationStore();
  const { selectedCompany, isLoading: isCompanyLoading } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables, canViewReconciliation, canManageReconciliation } =
    usePermissions();
  const [isMatching, setIsMatching] = useState(false);

  // Sync with Firestore (only for roles allowed to view the bank statement)
  useEffect(() => {
    if (!selectedCompany?.id || !canViewReconciliation) return;

    setIsLoading(true);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      // Best-effort one-time migration from the legacy single-document
      // session into the per-item subcollection. Only managers can write,
      // so a read-only viewer simply skips it (nothing is lost either way).
      if (canManageReconciliation) {
        try {
          await reconciliationSessionService.migrateLegacySessionIfNeeded(
            selectedCompany.id,
          );
        } catch (e) {
          console.error("Falha ao migrar sessão legada de conciliação", e);
        }
      }

      if (cancelled) return;
      unsubscribe = reconciliationSessionService.subscribeToSession(
        selectedCompany.id,
        (txs) => {
          setTransactions(txs);
          setIsLoading(false);
        },
      );
    };

    start();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    selectedCompany?.id,
    canViewReconciliation,
    canManageReconciliation,
    setTransactions,
    setIsLoading,
  ]);

  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedBankTx, setSelectedBankTx] = useState<BankTransaction | null>(
    null,
  );
  const [systemPaidCount, setSystemPaidCount] = useState(0);

  // Search and Filter
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hideReconciled, setHideReconciled] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const statusLabels: Record<string, string> = {
    all: "Todos",
    matched: "Conciliados",
    potential_match: "Sugestões",
    unmatched: "Não Conciliados",
    ignored: "Ignorados",
  };

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (hideReconciled ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter("all");
    setHideReconciled(false);
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const matchesSearch =
        tx.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.amount.toString().includes(searchTerm);
      const matchesStatus =
        statusFilter === "all" || tx.status === statusFilter;
      const matchesHidden = hideReconciled ? tx.status !== "matched" : true;
      return matchesSearch && matchesStatus && matchesHidden;
    });
  }, [transactions, searchTerm, statusFilter, hideReconciled]);

  // Load stats ONLY when company changes or initially
  useEffect(() => {
    const loadStats = async () => {
      if (!selectedCompany?.id) return;
      if (transactions.length === 0) return;

      const dates = transactions.map((t) => new Date(t.date));
      let start = subDays(new Date(), 60);
      let end = addDays(new Date(), 15);

      if (dates.length > 0) {
        start = subDays(
          new Date(Math.min(...dates.map((d) => d.getTime()))),
          15,
        );
        end = addDays(new Date(Math.max(...dates.map((d) => d.getTime()))), 15);
      }

      try {
        const count = await transactionService.getCount({
          companyId: selectedCompany.id,
          status: "paid",
          startDate: start,
          endDate: end,
          ...(onlyOwnPayables && user?.uid ? { createdBy: user.uid } : {}),
        });
        setSystemPaidCount(count);
      } catch (e) {
        console.error(e);
      }
    };
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  const stats = useMemo(
    () => ({
      total: transactions.length,
      matched: transactions.filter((t) => t.status === "matched").length,
      potential: transactions.filter((t) => t.status === "potential_match")
        .length,
    }),
    [transactions],
  );

  const updateStatusAndSync = async (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => {
    updateTransactionStatus(id, status, updates);
    if (!selectedCompany?.id) return;

    await reconciliationSessionService.updateItem(selectedCompany.id, id, {
      status,
      ...updates,
    });
  };

  const handleAction = async (
    id: string,
    action: "confirm" | "create" | "ignore",
    matchedId?: string,
  ) => {
    if (!canManageReconciliation) return;
    if (action === "confirm") {
      const tx = transactions.find((t) => t.id === id);
      if (tx) {
        const selectedCandidate = matchedId
          ? tx.matchCandidates?.find((c) => c.id === matchedId)
          : undefined;
        const matchedIds = selectedCandidate?.id
          ? [selectedCandidate.id]
          : tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0
            ? tx.matchedTransactionIds
            : tx.matchedTransactionId
              ? [tx.matchedTransactionId]
              : [];

        try {
          if (matchedIds.length > 0 && user?.uid) {
            const actor = selectedCompany?.id
              ? { companyId: selectedCompany.id, userEmail: user.email }
              : undefined;
            await Promise.all(
              matchedIds.map((matchedId) =>
                transactionService.reconcile(
                  matchedId,
                  { externalId: tx.id, reconciledBy: user.uid },
                  actor,
                ),
              ),
            );
          }

          await updateStatusAndSync(id, "matched", {
            matchedTransactionId:
              selectedCandidate?.id || tx.matchedTransactionId,
            matchedDetails: selectedCandidate?.transaction || tx.matchedDetails,
            confidence: tx.confidence || 100,
          });
          toast.success("Conciliação confirmada");
        } catch (error) {
          console.error(error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Erro ao confirmar conciliação",
          );
        }
      }
    } else if (action === "ignore") {
      await updateStatusAndSync(id, "ignored");
    } else if (action === "create") {
      const tx = transactions.find((t) => t.id === id);
      if (tx) {
        setSelectedBankTx(tx);
        setCreateModalOpen(true);
      }
    }
  };

  const handleCreateSubmit = async (data: TransactionFormData) => {
    if (
      !canManageReconciliation ||
      !selectedCompany?.id ||
      !user ||
      !selectedBankTx
    )
      return;

    try {
      const ref = await transactionService.create(
        data,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      const matchedId = "id" in ref ? ref.id : undefined;
      if (matchedId) {
        await transactionService.reconcile(
          matchedId,
          { externalId: selectedBankTx.id, reconciledBy: user.uid },
          { companyId: selectedCompany.id, userEmail: user.email },
        );
      }

      await updateStatusAndSync(selectedBankTx.id, "matched", {
        matchedTransactionId: matchedId,
        confidence: 100,
      });

      toast.success("Transação criada e conciliada com sucesso!");
      setCreateModalOpen(false);
      setSelectedBankTx(null);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao criar transação");
    }
  };

  const triggerAutoMatch = async () => {
    if (!canManageReconciliation) return;
    setIsMatching(true);
    try {
      const dates = transactions.map((t) => new Date(t.date));
      if (dates.length === 0) return;

      const minDate = subDays(
        new Date(Math.min(...dates.map((d) => d.getTime()))),
        10,
      );
      const maxDate = addDays(
        new Date(Math.max(...dates.map((d) => d.getTime()))),
        10,
      );

      if (!selectedCompany?.id) {
        toast.error("Selecione uma empresa primeiro");
        return;
      }

      const [systemTransactions, entities] = await Promise.all([
        transactionService.getAll({
          companyId: selectedCompany.id,
          // Only transactions where money actually moved are valid reconciliation
          // candidates — matching against draft/pending/rejected transactions would
          // let a bank line "confirm" a payment that hasn't happened.
          status: "paid",
          startDate: minDate,
          endDate: maxDate,
          ...(onlyOwnPayables && user?.uid ? { createdBy: user.uid } : {}),
        }),
        entityService.getAll(selectedCompany.id),
      ]);

      const processed = ReconciliationService.runAutoReconciliation(
        transactions,
        systemTransactions,
        entities,
      );
      setTransactions(processed);

      // Only the entries the matcher actually touched need to be persisted —
      // runAutoReconciliation keeps the same object reference for anything
      // it skipped (already matched/ignored), so a reference check is a cheap diff.
      const changed = processed.filter((tx, i) => tx !== transactions[i]);
      if (changed.length > 0) {
        await reconciliationSessionService.bulkUpdateItems(
          selectedCompany.id,
          changed.map((tx) => ({ id: tx.id, data: tx })),
        );
      }

      const matchCount = processed.filter(
        (t) =>
          t.matchedTransactionId || (t.matchedTransactionIds?.length ?? 0) > 0,
      ).length;
      toast.success(
        `Processamento concluído. ${matchCount} correspondências encontradas.`,
      );
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar dados do sistema.");
    } finally {
      setIsMatching(false);
    }
  };

  const handleClearSession = async () => {
    if (!canManageReconciliation) return;
    clearSession();
    if (selectedCompany?.id) {
      await reconciliationSessionService.clearSession(selectedCompany.id);
    }
  };

  // Access guard — wait for the company/role to resolve before deciding
  if (!isCompanyLoading && selectedCompany && !canViewReconciliation) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">
          Conciliação Bancária
        </h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">
              Você não tem permissão para acessar a conciliação bancária.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading skeleton (initial load, before any transactions)
  if (isStoreLoading && transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">
          Conciliação Bancária
        </h1>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-28 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos do Extrato</CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-6">
            <MobileCardSkeleton />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state — no statement imported yet
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">
          Conciliação Bancária
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>Importar Extrato</CardTitle>
            <CardDescription>
              Importe seu extrato bancário para começar a conciliação
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canManageReconciliation ? (
              <UploadStatement />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum extrato importado. Você não tem permissão para importar
                extratos bancários.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight">
          Conciliação Bancária
        </h1>
        {canManageReconciliation && (
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              className="h-9"
              onClick={triggerAutoMatch}
              disabled={isMatching}
            >
              {isMatching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="hidden sm:inline ml-2">Processar Matches</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-destructive border-destructive hover:bg-destructive/10"
              onClick={handleClearSession}
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Limpar Sessão</span>
            </Button>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Importado
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              lançamentos no extrato
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conciliados</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold text-green-600">
              {stats.matched}
            </div>
            <div className="mt-2 space-y-1">
              <Progress
                value={
                  stats.total > 0 ? (stats.matched / stats.total) * 100 : 0
                }
                className="h-1.5"
              />
              <p className="text-xs text-muted-foreground">
                {stats.total > 0
                  ? `${Math.round((stats.matched / stats.total) * 100)}% conciliados`
                  : "0% conciliados"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sugestões</CardTitle>
            <div className="h-4 w-4 rounded-full bg-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold text-yellow-600">
              {stats.potential}
            </div>
            <div className="mt-2 space-y-1">
              <Progress
                value={
                  stats.total > 0 ? (stats.potential / stats.total) * 100 : 0
                }
                className="h-1.5 [&>div]:bg-yellow-500"
              />
              <p className="text-xs text-muted-foreground">
                {stats.total > 0
                  ? `${Math.round((stats.potential / stats.total) * 100)}% com sugestão`
                  : "aguardando processamento"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pagos (Sistema)
            </CardTitle>
            <DollarSign className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl md:text-2xl font-bold text-blue-600">
              {systemPaidCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              no período do extrato
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main card */}
      <Card>
        <CardHeader className="space-y-3">
          {/* Title row */}
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Lançamentos do Extrato</CardTitle>
            <span className="md:hidden text-xs text-muted-foreground tabular-nums shrink-0">
              {filteredTransactions.length} resultado
              {filteredTransactions.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Mobile: search + filter button */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lançamentos..."
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

          {/* Mobile: active filter chips */}
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
              {hideReconciled && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  Ocultar conciliados
                  <button
                    onClick={() => setHideReconciled(false)}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro"
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

          {/* Desktop: search + filters inline */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 md:max-w-[300px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lançamentos..."
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="matched">Conciliados</SelectItem>
                <SelectItem value="potential_match">Sugestões</SelectItem>
                <SelectItem value="unmatched">Não Conciliados</SelectItem>
                <SelectItem value="ignored">Ignorados</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="hide-reconciled"
                checked={hideReconciled}
                onCheckedChange={(c) => setHideReconciled(!!c)}
              />
              <Label htmlFor="hide-reconciled" className="cursor-pointer">
                Ocultar Conciliados
              </Label>
            </div>
            {activeFilterCount > 0 && (
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
        </CardHeader>

        <CardContent className="p-0 md:p-6">
          {/* Desktop table */}
          <div className="hidden md:block relative">
            {isMatching && (
              <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm rounded-md flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm font-medium bg-background border rounded-lg px-4 py-2 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Identificando correspondências...
                </div>
              </div>
            )}
            <ReconciliationTable
              transactions={filteredTransactions}
              onAction={handleAction}
              readOnly={!canManageReconciliation}
            />
          </div>

          {/* Mobile card list */}
          <div className="md:hidden">
            {filteredTransactions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 px-4 text-muted-foreground">
                <FileText className="h-8 w-8 opacity-40" />
                <p className="text-sm font-medium text-center">
                  {searchTerm
                    ? `Nenhum resultado para "${searchTerm}"`
                    : activeFilterCount > 0
                      ? "Nenhum lançamento com os filtros selecionados"
                      : "Nenhum lançamento encontrado"}
                </p>
                {(searchTerm || activeFilterCount > 0) && (
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
              </div>
            ) : (
              <div className="divide-y">
                {filteredTransactions.map((tx) => (
                  <MobileBankTxCard
                    key={tx.id}
                    tx={tx}
                    onAction={handleAction}
                    readOnly={!canManageReconciliation}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mobile filter sheet */}
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
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="matched">Conciliados</SelectItem>
                  <SelectItem value="potential_match">Sugestões</SelectItem>
                  <SelectItem value="unmatched">Não Conciliados</SelectItem>
                  <SelectItem value="ignored">Ignorados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="hide-reconciled-mobile"
                checked={hideReconciled}
                onCheckedChange={(c) => setHideReconciled(!!c)}
              />
              <Label
                htmlFor="hide-reconciled-mobile"
                className="cursor-pointer"
              >
                Ocultar Conciliados
              </Label>
            </div>

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

      <ResponsiveModal open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <ResponsiveModalContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              Criar Transação de Conciliação
            </ResponsiveModalTitle>
          </ResponsiveModalHeader>
          {selectedBankTx && (
            <TransactionForm
              type={selectedBankTx.type === "debit" ? "payable" : "receivable"}
              defaultValues={{
                amount: Math.abs(selectedBankTx.amount),
                description: selectedBankTx.description,
                dueDate: new Date(selectedBankTx.date),
                paymentDate: new Date(selectedBankTx.date),
                status: "paid",
                paymentMethod: "transfer",
                supplierOrClient: selectedBankTx.description,
              }}
              onSubmit={handleCreateSubmit}
              isLoading={false}
              onCancel={() => setCreateModalOpen(false)}
            />
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
