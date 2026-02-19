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
} from "lucide-react";
import { BankTransaction } from "@/lib/types";
import { subDays, addDays } from "date-fns";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
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

export function ReconciliationDashboard() {
  const {
    transactions,
    setTransactions,
    updateTransactionStatus,
    clearSession,
  } = useReconciliationStore();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const [isMatching, setIsMatching] = useState(false);

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

        updateTransactionStatus(id, "matched", {
          matchedTransactionId:
            selectedCandidate?.id || tx.matchedTransactionId,
          matchedDetails: selectedCandidate?.transaction || tx.matchedDetails,
          confidence: tx.confidence || 100,
        });
      }
      toast.success("Conciliação confirmada");
    } else if (action === "ignore") {
      updateTransactionStatus(id, "ignored");
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

      updateTransactionStatus(selectedBankTx.id, "matched", {
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
        }),
        entityService.getAll(selectedCompany.id),
      ]);

      const processed = ReconciliationService.runAutoReconciliation(
        transactions,
        systemTransactions,
        entities,
      );
      setTransactions(processed);

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
            <Loader2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
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
            <p className="text-xs text-muted-foreground">No período</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
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
          <div className="flex items-center space-x-2 border-l pl-4 ml-2">
            <Checkbox
              id="hide-reconciled"
              checked={hideReconciled}
              onCheckedChange={(c) => setHideReconciled(!!c)}
            />
            <Label htmlFor="hide-reconciled">Ocultar Conciliados</Label>
          </div>
        </div>

        <div className="flex gap-2">
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
            onClick={() => clearSession()}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar Sessão
          </Button>
        </div>
      </div>

      <ReconciliationTable
        transactions={filteredTransactions}
        onAction={handleAction}
      />

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
