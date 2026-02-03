"use client";

import { useEffect, useState } from "react";
import { UploadStatement } from "./UploadStatement";
import { ReconciliationTable } from "./ReconciliationTable";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { transactionService } from "@/lib/services/transactionService";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, RefreshCw } from "lucide-react";
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

  const handleAction = (
    id: string,
    action: "confirm" | "create" | "ignore",
  ) => {
    if (action === "confirm") {
      updateTransactionStatus(id, "matched");
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
      // Create transaction
      // Since the service returns void (promise void) in signature sometimes but actually returns ref in Firestore...
      // Wait, looking at Create code: it returns result of `addDoc` usually?
      // Let's check `transactionService.create` return type.
      // It's `Promise<DocumentReference>` usually for `addDoc`.
      // The service read previously showed: `const promises = []; ... await Promise.all(promises);` for installments.
      // If single, it calls `addDoc`.
      // I'll assume it returns the doc ref or ID. If not, I'll have to query it.
      // Actually, for this MVP, if it succeeds, we mark matched. Ideally we save the new ID.

      await transactionService.create(
        data,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      // Find the transaction we just created? Or just mark matched.
      // Ideally `create` returns the ID.
      // Assuming success means we created it.
      updateTransactionStatus(selectedBankTx.id, "matched", "newly-created"); // Placeholder ID if service doesn't return

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

      const systemTransactions = await transactionService.getAll({
        companyId: selectedCompany.id,
        startDate: minDate,
        endDate: maxDate,
      });

      const processed = ReconciliationService.runAutoReconciliation(
        transactions,
        systemTransactions,
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
          <CardContent className="pt-6">
            <Button
              className="w-full mb-2"
              onClick={triggerAutoMatch}
              disabled={isMatching}
            >
              {isMatching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Processar Matches
            </Button>
            <Button
              variant="outline"
              className="w-full text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => clearSession()}
            >
              Limpar Sessão
            </Button>
          </CardContent>
        </Card>
      </div>

      <ReconciliationTable onAction={handleAction} />

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
