"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { UploadStatement } from "@/components/features/finance/reconciliation/UploadStatement";
import {
  ReconciliationTable,
  StatusBadge,
  ReconciliationAction,
} from "@/components/features/finance/reconciliation/ReconciliationTable";
import { BalanceStrip } from "@/components/features/finance/reconciliation/BalanceStrip";
import {
  SettleFromStatementSheet,
  Settlement,
} from "@/components/features/finance/reconciliation/SettleFromStatementSheet";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { transactionService } from "@/lib/services/transactionService";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { entityService } from "@/lib/services/entityService";
import { bankAccountService } from "@/lib/services/bankAccountService";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  FileText,
  SlidersHorizontal,
  X,
  Check,
  Plus,
  Undo2,
  Search,
  Landmark,
  HandCoins,
  Lock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BankTransaction, Transaction } from "@/lib/types";
import { subDays, addDays, format } from "date-fns";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useBankAccounts } from "@/hooks/useBankAccounts";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";
import { isLocked, summarizeAccount } from "@/lib/bankReconciliation";

const ACCOUNT_KEY = (companyId: string) =>
  `reconciliation-account-${companyId}`;

function MobileBankTxCard({
  tx,
  onAction,
  readOnly,
  locked,
  canSettle,
}: {
  tx: BankTransaction;
  onAction: (id: string, action: ReconciliationAction) => void;
  readOnly?: boolean;
  locked?: boolean;
  canSettle?: boolean;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-muted-foreground">
          {format(new Date(tx.date), "dd/MM/yyyy")}
        </span>
        <StatusBadge status={tx.status} />
      </div>

      <p className="text-sm font-medium truncate" title={tx.description}>
        {tx.description}
      </p>

      <div
        className={cn(
          "text-sm font-semibold font-financial tabular-nums mt-1",
          tx.amount < 0
            ? "text-red-700 dark:text-red-400"
            : "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {tx.amount < 0 ? "−" : "+"}
        {formatCurrency(Math.abs(tx.amount))}
      </div>

      {tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0 ? (
        <div className="mt-2 text-xs bg-muted/50 rounded p-2">
          <span className="font-medium">
            {tx.matchedTransactionIds.length} lançamentos somados
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
        </div>
      ) : tx.matchCandidates && tx.matchCandidates.length > 0 ? (
        <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
          {tx.matchCandidates.length} sugestão(ões) disponível(eis)
        </div>
      ) : null}

      {locked ? (
        <p className="mt-2.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" /> Período fechado
        </p>
      ) : (
        !readOnly && (
          <div className="flex flex-wrap gap-2 mt-2.5 justify-end items-center">
            {tx.status === "potential_match" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onAction(tx.id, "confirm")}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Confirmar
              </Button>
            )}
            {tx.status === "unmatched" && (
              <>
                {canSettle && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => onAction(tx.id, "settle")}
                  >
                    <HandCoins className="h-3.5 w-3.5 mr-1" />
                    Baixar título
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => onAction(tx.id, "create")}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Lançar
                </Button>
              </>
            )}
            {(tx.status === "potential_match" || tx.status === "unmatched") && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => onAction(tx.id, "ignore")}
                aria-label="Ignorar"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {(tx.status === "matched" || tx.status === "ignored") && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => onAction(tx.id, "unreconcile")}
              >
                <Undo2 className="h-3.5 w-3.5 mr-1" />
                Desfazer
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function ReconciliationDashboard() {
  const {
    transactions: allItems,
    isLoading: isStoreLoading,
    setTransactions,
    updateTransactionStatus,
    setIsLoading,
  } = useReconciliationStore();
  const { selectedCompany, isLoading: isCompanyLoading } = useCompany();
  const { user } = useAuth();
  const {
    onlyOwnPayables,
    canViewReconciliation,
    canManageReconciliation,
    canPayPayables,
    canEditReceivables,
    canManageBankAccounts,
  } = usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;
  const { accounts, isLoading: isAccountsLoading } = useBankAccounts(
    canViewReconciliation ? companyId : undefined,
  );
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active),
    [accounts],
  );
  const [isMatching, setIsMatching] = useState(false);

  // Sync with Firestore (only for roles allowed to view the bank statement)
  useEffect(() => {
    if (!companyId || !canViewReconciliation) return;

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
            companyId,
          );
        } catch (e) {
          console.error("Falha ao migrar sessão legada de conciliação", e);
        }
      }

      if (cancelled) return;
      unsubscribe = reconciliationSessionService.subscribeToSession(
        companyId,
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
    companyId,
    canViewReconciliation,
    canManageReconciliation,
    setTransactions,
    setIsLoading,
  ]);

  // ── Conta selecionada ──────────────────────────────────────────────────────
  const [pickedAccountId, setPickedAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    try {
      setPickedAccountId(localStorage.getItem(ACCOUNT_KEY(companyId)));
    } catch {
      // Sem storage: cai na primeira conta ativa.
    }
  }, [companyId]);
  const account =
    activeAccounts.find((a) => a.id === pickedAccountId) ?? activeAccounts[0];
  const selectAccount = (id: string) => {
    setPickedAccountId(id);
    try {
      if (companyId) localStorage.setItem(ACCOUNT_KEY(companyId), id);
    } catch {
      // Preferência só desta sessão.
    }
  };

  // Linhas importadas antes de existir conta bancária.
  const legacyItems = useMemo(
    () => allItems.filter((t) => !t.bankAccountId),
    [allItems],
  );
  const transactions = useMemo(
    () =>
      account ? allItems.filter((t) => t.bankAccountId === account.id) : [],
    [allItems, account],
  );
  const summary = useMemo(
    () => (account ? summarizeAccount(account, allItems) : null),
    [account, allItems],
  );
  const lockedFor = (tx: BankTransaction) => isLocked(tx, account);
  const canSettleFor = (tx: BankTransaction) =>
    canManageReconciliation &&
    (tx.amount < 0 ? canPayPayables : canEditReceivables);

  // ── Modais e filtros ───────────────────────────────────────────────────────
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedBankTx, setSelectedBankTx] = useState<BankTransaction | null>(
    null,
  );
  const [settlingTx, setSettlingTx] = useState<BankTransaction | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hideReconciled, setHideReconciled] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);

  const statusLabels: Record<string, string> = {
    all: "Todos",
    matched: "Conciliados",
    potential_match: "Sugestões",
    unmatched: "Pendentes",
    ignored: "Ignorados",
  };

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (hideReconciled ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter("all");
    setHideReconciled(false);
  };

  const filteredTransactions = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return transactions
      .filter((tx) => {
        const matchesSearch =
          tx.description.toLowerCase().includes(term) ||
          tx.amount.toString().includes(searchTerm);
        const matchesStatus =
          statusFilter === "all" || tx.status === statusFilter;
        const matchesHidden = hideReconciled ? tx.status !== "matched" : true;
        return matchesSearch && matchesStatus && matchesHidden;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [transactions, searchTerm, statusFilter, hideReconciled]);

  const actor = user ? { uid: user.uid, email: user.email } : null;

  const updateStatusAndSync = async (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => {
    updateTransactionStatus(id, status, updates);
    if (!companyId) return;

    await reconciliationSessionService.updateItem(companyId, id, {
      status,
      ...updates,
    });
  };

  const reconcileAll = (ids: string[], bankTx: BankTransaction) =>
    Promise.all(
      ids.map((matchedId) =>
        transactionService.reconcile(
          matchedId,
          {
            externalId: bankTx.id,
            reconciledBy: user!.uid,
            bankAccountId: bankTx.bankAccountId,
          },
          { companyId: companyId!, userEmail: user!.email },
        ),
      ),
    );

  const handleAction = async (
    id: string,
    action: ReconciliationAction,
    matchedId?: string,
  ) => {
    if (!canManageReconciliation || !user || !companyId) return;
    const tx = transactions.find((t) => t.id === id);
    if (!tx || lockedFor(tx)) return;

    if (action === "confirm") {
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
        await reconcileAll(matchedIds, tx);
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
    } else if (action === "ignore") {
      try {
        await updateStatusAndSync(id, "ignored");
      } catch (error) {
        console.error(error);
        toast.error(friendlyError(error, "Erro ao ignorar lançamento"));
      }
    } else if (action === "create") {
      setSelectedBankTx(tx);
      setCreateModalOpen(true);
    } else if (action === "settle") {
      setSettlingTx(tx);
    } else if (action === "unreconcile") {
      const matchedIds =
        tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0
          ? tx.matchedTransactionIds
          : tx.matchedTransactionId
            ? [tx.matchedTransactionId]
            : [];

      try {
        const unreconcileActor = {
          companyId,
          userId: user.uid,
          userEmail: user.email,
        };
        await Promise.all(
          matchedIds.map((matchedId) =>
            transactionService.unreconcile(matchedId, unreconcileActor),
          ),
        );

        await updateStatusAndSync(id, "unmatched", {
          matchedTransactionId: undefined,
          matchedTransactionIds: undefined,
          matchedDetails: undefined,
          matchedBundleDetails: undefined,
          confidence: undefined,
        });
        toast.success(
          tx.status === "ignored"
            ? "Linha voltou para pendente"
            : "Conciliação desfeita",
        );
      } catch (error) {
        console.error(error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Erro ao desfazer conciliação",
        );
      }
    }
  };

  const handleCreateSubmit = async (data: TransactionFormData) => {
    if (!canManageReconciliation || !companyId || !user || !selectedBankTx)
      return;

    try {
      const ref = await transactionService.create(
        data,
        { uid: user.uid, email: user.email },
        companyId,
      );

      const matchedId = "id" in ref ? ref.id : undefined;
      if (matchedId) await reconcileAll([matchedId], selectedBankTx);

      await updateStatusAndSync(selectedBankTx.id, "matched", {
        matchedTransactionId: matchedId,
        confidence: 100,
      });

      toast.success("Lançamento criado e conciliado");
      setCreateModalOpen(false);
      setSelectedBankTx(null);
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao criar transação"));
    }
  };

  // Baixa um título em aberto com a data e o valor do extrato e já concilia.
  const handleSettle = async (title: Transaction, settlement: Settlement) => {
    if (!settlingTx || !actor || !companyId) return;
    try {
      const result = await transactionService.settle(
        title.id,
        settlement,
        actor,
        companyId,
      );
      await reconcileAll([title.id], settlingTx);
      await updateStatusAndSync(settlingTx.id, "matched", {
        matchedTransactionId: title.id,
        matchedDetails: {
          ...title,
          status: "paid",
          paymentDate: settlement.paymentDate,
          finalAmount: settlement.finalAmount,
        },
        confidence: 100,
      });
      toast.success("Título baixado e conciliado", {
        description: result.budgetExceeded
          ? "A baixa caiu num exercício sem orçamento suficiente; o gestor foi avisado."
          : undefined,
      });
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao baixar o título"));
      throw error;
    }
  };

  const triggerAutoMatch = async () => {
    if (!canManageReconciliation || !companyId || !user) return;
    const open = transactions.filter((t) => !lockedFor(t));
    if (open.length === 0) return;
    setIsMatching(true);
    try {
      const dates = open.map((t) => new Date(t.date).getTime());
      const [systemTransactions, entities] = await Promise.all([
        transactionService.getAll({
          companyId,
          // Only transactions where money actually moved are valid reconciliation
          // candidates — matching against draft/pending/rejected transactions would
          // let a bank line "confirm" a payment that hasn't happened.
          statuses: ["paid", "received"],
          startDate: subDays(new Date(Math.min(...dates)), 10),
          endDate: addDays(new Date(Math.max(...dates)), 10),
          ...(onlyOwnPayables ? { createdBy: user.uid } : {}),
        }),
        entityService.getAll(companyId),
      ]);

      const processed = ReconciliationService.runAutoReconciliation(
        open,
        systemTransactions,
        entities,
      );

      // High-confidence lines come back as "matched": flag the system
      // transaction as reconciled too, otherwise it stays free to be matched
      // again by a later import. If the claim fails (e.g. another statement
      // line already took it), fall back to a suggestion for manual review.
      await Promise.all(
        processed.map(async (tx, i) => {
          if (
            tx === open[i] ||
            tx.status !== "matched" ||
            !tx.matchedTransactionId
          )
            return;
          try {
            await reconcileAll([tx.matchedTransactionId], tx);
          } catch {
            processed[i] = { ...tx, status: "potential_match" };
          }
        }),
      );

      // Only the entries the matcher actually touched need to be persisted —
      // runAutoReconciliation keeps the same object reference for anything
      // it skipped (already matched/ignored), so a reference check is a cheap diff.
      const changed = processed.filter((tx, i) => tx !== open[i]);
      const changedById = new Map(changed.map((tx) => [tx.id, tx]));
      setTransactions(allItems.map((t) => changedById.get(t.id) ?? t));
      if (changed.length > 0) {
        await reconciliationSessionService.bulkUpdateItems(
          companyId,
          changed.map((tx) => ({ id: tx.id, data: tx })),
        );
      }

      const auto = changed.filter((t) => t.status === "matched").length;
      const suggested = changed.length - auto;
      toast.success(
        changed.length === 0
          ? "Nenhuma correspondência nova encontrada."
          : `${auto} conciliada(s) automaticamente, ${suggested} sugestão(ões) para revisar.`,
      );
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar dados do sistema.");
    } finally {
      setIsMatching(false);
    }
  };

  const handleClearSession = async () => {
    if (!canManageReconciliation || !companyId || !account) return;
    try {
      await reconciliationSessionService.clearSession(companyId, account.id);
      toast.success("Linhas do extrato removidas");
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao limpar a sessão"));
    }
  };

  const assignLegacy = async () => {
    if (!companyId || !account) return;
    try {
      await reconciliationSessionService.bulkUpdateItems(
        companyId,
        legacyItems.map((t) => ({
          id: t.id,
          data: { bankAccountId: account.id },
        })),
      );
      toast.success(
        `${legacyItems.length} linha(s) atribuída(s) a ${account.name}`,
      );
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao atribuir as linhas"));
    }
  };

  const refreshAccounts = () =>
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });

  const handleStatementBalance = async (balance: number, date: Date) => {
    if (!account) return;
    try {
      await bankAccountService.setStatementBalance(account.id, balance, date);
      await refreshAccounts();
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao salvar o saldo"));
      throw error;
    }
  };

  const handleClosePeriod = async () => {
    if (!account || !summary?.canClose || !summary.statementDate || !actor)
      return;
    try {
      await bankAccountService.close(
        account,
        summary.statementDate,
        summary.bookBalance,
        actor,
      );
      await refreshAccounts();
      toast.success(
        `${account.name} conciliada até ${format(summary.statementDate, "dd/MM/yyyy")}`,
      );
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao fechar o período"));
    }
  };

  const handleReopen = async () => {
    if (!account || !actor) return;
    try {
      await bankAccountService.reopenLast(account, actor);
      await refreshAccounts();
      toast.success("Período reaberto");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao reabrir o período"));
    }
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl md:text-3xl font-bold tracking-tight">
        Conciliação Bancária
      </h1>
      {account && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={account.id} onValueChange={selectAccount}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Conta">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManageReconciliation && transactions.length > 0 && (
            <>
              <UploadStatement
                account={account}
                accounts={accounts}
                onAccountDetected={selectAccount}
                variant="button"
              />
              <Button
                size="sm"
                className="h-9"
                onClick={triggerAutoMatch}
                disabled={isMatching}
              >
                {isMatching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="hidden sm:inline ml-2">
                  Buscar correspondências
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => setClearConfirmOpen(true)}
                aria-label="Limpar linhas do extrato"
                title="Limpar linhas do extrato"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );

  // Access guard — wait for the company/role to resolve before deciding
  if (!isCompanyLoading && selectedCompany && !canViewReconciliation) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para acessar a conciliação bancária.
        </p>
      </div>
    );
  }

  if ((isStoreLoading && allItems.length === 0) || isAccountsLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton className="h-[76px] w-full" />
        <div className="rounded-lg border divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1 max-w-sm" />
              <Skeleton className="h-4 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Sem conta cadastrada não há o que conciliar.
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="rounded-lg border px-6 py-12 text-center">
          <Landmark className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 font-medium">Cadastre a conta que vai conciliar</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A conciliação é feita por conta: o saldo de abertura dela é o ponto
            de partida para conferir o extrato.
          </p>
          {canManageBankAccounts ? (
            <Button asChild className="mt-5">
              <Link href="/cadastros/contas-bancarias">
                <Plus className="h-4 w-4" />
                Cadastrar conta bancária
              </Link>
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Peça ao gestor financeiro para cadastrar as contas.
            </p>
          )}
        </div>
      </div>
    );
  }

  const legacyBanner = canManageReconciliation && legacyItems.length > 0 && (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p className="flex-1 min-w-[16rem] text-amber-900 dark:text-amber-200">
        {legacyItems.length} linha(s) foram importadas antes das contas
        bancárias e não pertencem a nenhuma conta.
      </p>
      <Button size="sm" variant="outline" onClick={assignLegacy}>
        Atribuir a {account.name}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {header}
      {legacyBanner}

      {summary && (
        <BalanceStrip
          account={account}
          summary={summary}
          canManage={canManageReconciliation}
          canReopen={canManageBankAccounts}
          onSetStatementBalance={handleStatementBalance}
          onClose={() => setCloseConfirmOpen(true)}
          onReopen={() => setReopenConfirmOpen(true)}
          onShowPending={() => {
            setStatusFilter("unmatched");
            setHideReconciled(false);
          }}
        />
      )}

      {transactions.length === 0 ? (
        canManageReconciliation ? (
          <UploadStatement
            account={account}
            accounts={accounts}
            onAccountDetected={selectAccount}
          />
        ) : (
          <p className="rounded-lg border px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhum extrato importado para {account.name}.
          </p>
        )
      ) : (
        <section className="rounded-lg border bg-card">
          <div className="flex flex-col gap-3 p-4 border-b">
            {/* Mobile: search + filter button */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="relative flex-1 min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar no extrato"
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
                className={cn(
                  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                  activeFilterCount > 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
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
              <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                  placeholder="Buscar no extrato"
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
                <SelectTrigger className="w-[180px]" aria-label="Situação">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hide-reconciled"
                  checked={hideReconciled}
                  onCheckedChange={(c) => setHideReconciled(!!c)}
                />
                <Label htmlFor="hide-reconciled" className="cursor-pointer">
                  Ocultar conciliados
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
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {filteredTransactions.length} de {transactions.length} linhas
              </span>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block relative">
            {isMatching && (
              <div className="absolute inset-0 z-10 bg-background/70 flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm font-medium bg-background border rounded-lg px-4 py-2 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Buscando correspondências...
                </div>
              </div>
            )}
            <ReconciliationTable
              transactions={filteredTransactions}
              onAction={handleAction}
              readOnly={!canManageReconciliation}
              isLocked={lockedFor}
              canSettle={canSettleFor}
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
                    : "Nenhuma linha com os filtros selecionados"}
                </p>
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
              </div>
            ) : (
              <div className="divide-y">
                {filteredTransactions.map((tx) => (
                  <MobileBankTxCard
                    key={tx.id}
                    tx={tx}
                    onAction={handleAction}
                    readOnly={!canManageReconciliation}
                    locked={lockedFor(tx)}
                    canSettle={canSettleFor(tx)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

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
                Situação
              </p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
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
                Ocultar conciliados
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
                onClick={() => setMobileFiltersOpen(false)}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={`Limpar o extrato de ${account.name}?`}
        description={`As ${transactions.length} linhas importadas desta conta saem da tela, incluindo ${summary?.pending ?? 0} ainda pendentes. Lançamentos já conciliados continuam conciliados no sistema, e os períodos fechados não mudam.`}
        confirmText="Limpar extrato"
        variant="destructive"
        onConfirm={handleClearSession}
      />

      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title={`Fechar ${account.name} até ${summary?.statementDate ? format(summary.statementDate, "dd/MM/yyyy") : ""}?`}
        description={`O saldo conciliado de ${formatCurrency(summary?.bookBalance ?? 0)} vira o saldo inicial do próximo período. As linhas até essa data ficam somente leitura; só o gestor financeiro pode reabrir.`}
        confirmText="Fechar período"
        onConfirm={handleClosePeriod}
      />

      <ConfirmDialog
        open={reopenConfirmOpen}
        onOpenChange={setReopenConfirmOpen}
        title="Reabrir o último período fechado?"
        description="As linhas desse período voltam a ser editáveis e o saldo inicial volta para o fechamento anterior. A reabertura fica registrada na auditoria."
        confirmText="Reabrir"
        variant="destructive"
        onConfirm={handleReopen}
      />

      {companyId && (
        <SettleFromStatementSheet
          companyId={companyId}
          bankTx={settlingTx}
          onOpenChange={(o) => !o && setSettlingTx(null)}
          onSettle={handleSettle}
        />
      )}

      <ResponsiveModal open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <ResponsiveModalContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Lançar e conciliar</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          {selectedBankTx && (
            <TransactionForm
              variant="reconcile"
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
