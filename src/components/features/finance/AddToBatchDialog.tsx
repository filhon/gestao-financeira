"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { friendlyError, userError } from "@/lib/errors";
import { startBatchRun } from "@/lib/store/useBatchRunStore";
import { formatCurrency } from "@/lib/utils";
import type { PaymentBatch, Transaction } from "@/lib/types";

/** Adiciona contas em rascunho a um lote aberto ou a um lote novo. */
export function AddToBatchDialog({
  open,
  onOpenChange,
  transactions,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: Transaction[];
  /** Ao fim de cada rodada, com as contas que ficaram de fora. */
  onDone: (failedIds: string[]) => void;
}) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!open || !companyId) return;
    paymentBatchService
      .getAll(companyId, 50, null, ["open"])
      .then(({ batches }) => setOpenBatches(batches))
      .catch(() => toast.error("Erro ao carregar lotes."));
  }, [open, companyId]);

  const addToBatch = async (batchId?: string) => {
    if (!companyId || !user) return;
    setIsProcessing(true);
    try {
      let id = batchId;
      let name = openBatches.find((b) => b.id === batchId)?.name;
      if (!id) {
        ({ id, name } = await paymentBatchService.create(companyId, user.uid));
      }
      const targetId = id;
      onOpenChange(false);
      // Fatia recusada é refeita conta a conta: a que não pode entrar aparece
      // com o motivo, e as outras entram.
      void startBatchRun<Transaction>({
        key: `add-to-batch-${targetId}`,
        title: `Adicionando ao lote ${name}`,
        items: transactions,
        id: (t) => t.id,
        label: (t) => `${t.description} · ${formatCurrency(t.amount)}`,
        chunkSize: 100,
        fallback: "Erro ao adicionar ao lote.",
        work: async (chunk) => {
          if (chunk.some((t) => t.status !== "draft")) {
            throw userError("Só conta em rascunho pode entrar em lote.");
          }
          await paymentBatchService.addTransactions(targetId, chunk);
        },
        onRound: ({ failed, complete }) => {
          onDone(failed.map((t) => t.id));
          if (complete)
            toast.success(`Transações adicionadas ao lote ${name}.`);
        },
      });
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao adicionar ao lote."));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            Adicionar ao lote de pagamento
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {transactions.length} conta{transactions.length !== 1 && "s"}{" "}
            selecionada{transactions.length !== 1 && "s"}.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Lotes abertos</Label>
            {openBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum lote aberto.
              </p>
            ) : (
              <div className="grid gap-2">
                {openBatches.map((b) => (
                  <Button
                    key={b.id}
                    variant="outline"
                    className="justify-between"
                    disabled={isProcessing}
                    onClick={() => addToBatch(b.id)}
                  >
                    {b.name}
                    <span className="font-financial text-muted-foreground">
                      {formatCurrency(b.totalAmount)}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            className="w-full"
            disabled={isProcessing}
            onClick={() => addToBatch()}
          >
            {isProcessing && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Criar lote novo e adicionar
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
