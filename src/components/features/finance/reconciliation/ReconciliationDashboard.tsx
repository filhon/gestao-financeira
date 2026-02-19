"use client";

import { useEffect, useState } from "react";
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

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch =
      tx.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.amount.toString().includes(searchTerm);
    const matchesStatus = statusFilter === "all" || tx.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    const loadStats = async () => {
      if (!selectedCompany?.id) return;

      let start = subDays(new Date(), 60);
      let end = addDays(new Date(), 15);

      // Retrieve context from current statement if available
      if (transactions.length > 0) {
        const dates = transactions.map((t) => new Date(t.date));
        if (dates.length > 0) {
          start = subDays(
            new Date(Math.min(...dates.map((d) => d.getTime()))),
            30,
          );
          end = addDays(
            new Date(Math.max(...dates.map((d) => d.getTime()))),
            30,
          );
        }
      }

      try {
        const txs = await transactionService.getAll({
          companyId: selectedCompany.id,
          status: "paid",
          startDate: start,
          endDate: end,
        });
        setSystemPaidCount(txs.length);
      } catch (e) {
        console.error(e);
      }
    };
    loadStats();
  }, [selectedCompany, transactions]);

  // Calculate stats
  const total = transactions.length;
  const matched = transactions.filter((t) => t.status === "matched").length;
  const potential = transactions.filter(
    (t) => t.status === "potential_match",
  ).length;

  // Auto-run matching when new transactions are loaded
  useEffect(() => {
    // Only run if we have unmatched items and haven't run recently logic could go here
    // For now, we rely on the manual button or initial load trigger in real app
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
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conciliados</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{matched}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sugestões</CardTitle>
            <div className="h-4 w-4 rounded-full bg-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {potential}
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
            <p className="text-xs text-muted-foreground">Últimos 60 dias</p>
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
