"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { BulkImportDialog } from "@/components/features/finance/BulkImportDialog";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import {
  TransactionList,
  refreshTransactionList,
} from "@/components/features/finance/TransactionList";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenterBalances, useCostCenters } from "@/hooks/useCostCenters";
import { transactionService } from "@/lib/services/transactionService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { TransactionFormData } from "@/lib/validations/transaction";
import { friendlyError } from "@/lib/errors";

const COPY = {
  payable: {
    title: "Contas a Pagar",
    newButton: "Nova Conta",
    modalTitle: "Nova Conta a Pagar",
    created: "Conta a pagar criada com sucesso!",
    error: "Erro ao salvar conta a pagar.",
  },
  receivable: {
    title: "Contas a Receber",
    newButton: "Nova Receita",
    modalTitle: "Nova Conta a Receber",
    created: "Conta a receber criada com sucesso!",
    error: "Erro ao salvar conta a receber.",
  },
} as const;

/** Página de contas a pagar ou a receber: cabeçalho, criação, importação e lista. */
export function TransactionsPage({ type }: { type: "payable" | "receivable" }) {
  const copy = COPY[type];
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { canCreatePayables, canCreateReceivables } = usePermissions();
  const canCreate =
    type === "payable" ? canCreatePayables : canCreateReceivables;
  const qc = useQueryClient();

  // Mesmo cache do formulário: abrir "Nova conta" não espera rede, e os saldos
  // do ano ficam quentes para o aviso de envelope da despesa.
  const { costCenters } = useCostCenters(selectedCompany?.id);
  useCostCenterBalances(
    type === "payable" ? selectedCompany?.id : undefined,
    costCenters,
    new Date().getFullYear(),
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: TransactionFormData) => {
    if (!user || !selectedCompany) return;
    try {
      setIsSubmitting(true);
      if (data.recurrence?.isRecurring) {
        await recurrenceService.createTemplate({
          companyId: selectedCompany.id,
          description: data.description,
          amount: data.amount,
          type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          frequency: data.recurrence.frequency as any,
          interval: data.recurrence.interval || 1,
          nextDueDate: data.dueDate,
          active: true,
          baseTransactionData: {
            costCenterAllocation: data.costCenterAllocation,
            accountId: data.accountId,
            supplierOrClient: data.supplierOrClient,
            entityId: data.entityId,
            paymentMethod: data.paymentMethod,
            requestOrigin: data.requestOrigin,
            details: data.details || "",
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
        toast.success(copy.created);
      }
      refreshTransactionList(qc, type);
      setIsFormOpen(false);
    } catch (error) {
      console.error("Error saving transaction:", error);
      // A recusa por saldo vem do servidor já redigida com os valores em jogo;
      // trocá-la por um texto genérico esconderia justamente o que resolve.
      toast.error(friendlyError(error, copy.error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          {copy.title}
        </h1>
        {canCreate && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              aria-label="Importar transações"
              onClick={() => setIsImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Importar</span>
            </Button>
            <Button
              size="sm"
              className="h-9"
              aria-label={copy.modalTitle}
              onClick={() => setIsFormOpen(true)}
            >
              <Plus className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">{copy.newButton}</span>
            </Button>
          </div>
        )}
      </div>

      <TransactionList
        type={type}
        onCreate={canCreate ? () => setIsFormOpen(true) : undefined}
      />

      <ResponsiveModal open={isFormOpen} onOpenChange={setIsFormOpen}>
        <ResponsiveModalContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{copy.modalTitle}</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <TransactionForm
            type={type}
            onSubmit={handleSubmit}
            isLoading={isSubmitting}
            onCancel={() => setIsFormOpen(false)}
          />
        </ResponsiveModalContent>
      </ResponsiveModal>

      <BulkImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => refreshTransactionList(qc, type)}
        type={type}
      />
    </div>
  );
}
