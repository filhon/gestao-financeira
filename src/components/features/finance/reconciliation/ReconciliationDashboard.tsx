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
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { BankTransaction } from "@/lib/types";
import { subDays, addDays } from "date-fns";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";

export function ReconciliationDashboard() {
  const {
    transactions,
    setTransactions,
    updateTransactionStatus,
    clearSession,
    setIsLoading,
  } = useReconciliationStore();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();
  const [isMatching, setIsMatching] = useState(false);

  // Sync with Firestore
  useEffect(() => {
    if (!selectedCompany?.id) return;

    setIsLoading(true);
    const unsubscribe = reconciliationSessionService.subscribeToSession(
      selectedCompany.id,
      (txs) => {
        setTransactions(txs);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [selectedCompany?.id, setTransactions, setIsLoading]);

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

      // Calculate meaningful range from import
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
        // Use optimized getCount
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
    // Removed 'transactions' from dependency to avoid re-fetching on status change
    // We only re-fetch if the company changes.
    // Logic: If user imports new file -> transactions array is replaced -> we might want to refresh stats?
    // Actually, if 'transactions' reference changes (new import), we should update stats because dates might have changed.
    // BUT we don't want to update if just a status inside transaction changed.
    // Since 'transactions' in store is likely a new array ref on every update... this is tricky.
    // FIX: We can depend on 'transactions.length' or just run once per mount/company
    // For now, let's depend on selectedCompany only. If user uploads new file, they usually clear session first.
    // Better yet: We check if dates changed significantly? No, simpler:
    // We only run this useEffect if transactions.length > 0.
    // If we want to support 'refresh', we can add a manual refresh button for stats or link it to 'Processar Matches'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  // Calculate stats using memo to avoid recalc on every render
  const stats = useMemo(() => {
    return {
      total: transactions.length,
      matched: transactions.filter((t) => t.status === "matched").length,
      potential: transactions.filter((t) => t.status === "potential_match")
        .length,
    };
  }, [transactions]);

  const updateStatusAndSync = async (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => {
    updateTransactionStatus(id, status, updates);
    if (!selectedCompany?.id) return;

    // Compute the new transactions state manually to sync it to Firebase
    const updatedTxs = transactions.map((t) =>
      t.id === id ? { ...t, status, ...updates } : t,
    );
    await reconciliationSessionService.saveSession(
      selectedCompany.id,
      updatedTxs,
    );
  };

  const handleAction = async (
    id: string,
    action: "confirm" | "create" | "ignore",
    matchedId?: string,
  ) => {
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

        if (matchedIds.length > 0 && user?.uid) {
          await Promise.all(
            matchedIds.map((matchedId) =>
              transactionService.reconcile(matchedId, {
                externalId: tx.id,
                reconciledBy: user.uid,
              }),
            ),
          );
        }

        await updateStatusAndSync(id, "matched", {
          matchedTransactionId:
            selectedCandidate?.id || tx.matchedTransactionId,
          matchedDetails: selectedCandidate?.transaction || tx.matchedDetails,
          confidence: tx.confidence || 100,
        });
      }
      toast.success("Conciliação confirmada");
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
    if (!selectedCompany?.id || !user || !selectedBankTx) return;

    try {
      const ref = await transactionService.create(
        data,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      const matchedId = "id" in ref ? ref.id : undefined;
      if (matchedId) {
        await transactionService.reconcile(matchedId, {
          externalId: selectedBankTx.id,
          reconciledBy: user.uid,
        });
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
    setIsMatching(true);
    try {
      const dates = transactions.map((t) => new Date(t.date));
      if (dates.length === 0) return;

      const minDate = subDays(
        new Date(Math.min(...dates.map((d) => d.getTime()))),
        10,
      ); // Extended range
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
      if (selectedCompany?.id) {
        await reconciliationSessionService.saveSession(
          selectedCompany.id,
          processed,
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

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conciliação Bancária</CardTitle>
          <CardDescription>Importe seu extrato para começar</CardDescription>
        </CardHeader>
        <CardContent>
          <UploadStatement />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Importado
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
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
            <div className="text-2xl font-bold text-green-600">
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
            <div className="text-2xl font-bold text-yellow-600">
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
            <div className="text-2xl font-bold text-blue-600">
              {systemPaidCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              no período do extrato
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:max-w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar transações..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
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
          <Separator orientation="vertical" className="h-6 hidden md:block" />
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
        </div>

        <div className="flex gap-2 shrink-0">
          <Button onClick={triggerAutoMatch} disabled={isMatching}>
            {isMatching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Processar Matches
          </Button>
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={async () => {
              clearSession();
              if (selectedCompany?.id) {
                await reconciliationSessionService.clearSession(
                  selectedCompany.id,
                );
              }
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar Sessão
          </Button>
        </div>
      </div>

      <div className="relative">
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
        />
      </div>

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Transação de Conciliação</DialogTitle>
          </DialogHeader>
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
                supplierOrClient: selectedBankTx.description, // Fallback to description as payee name helper
              }}
              onSubmit={handleCreateSubmit}
              isLoading={false}
              onCancel={() => setCreateModalOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
