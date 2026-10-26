"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { friendlyError } from "@/lib/errors";
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
  onDone: () => void;
}) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
  const [newBatchName, setNewBatchName] = useState("");
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
      if (transactions.some((t) => t.status !== "draft")) {
        throw new Error(
          "Apenas transações em rascunho podem ser adicionadas ao lote.",
        );
      }
      let id = batchId;
      if (!id) {
        if (!newBatchName.trim()) throw new Error("Dê um nome ao novo lote.");
        id = (
          await paymentBatchService.create(
            newBatchName.trim(),
            companyId,
            user.uid,
          )
        ).id;
      }
      await paymentBatchService.addTransactions(id, transactions);
      setNewBatchName("");
      toast.success("Transações adicionadas ao lote!");
      onDone();
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
          <div className="space-y-2">
            <Label htmlFor="new-batch">Ou crie um novo</Label>
            <div className="flex gap-2">
              <Input
                id="new-batch"
                placeholder="Nome do novo lote"
                value={newBatchName}
                onChange={(e) => setNewBatchName(e.target.value)}
              />
              <Button disabled={isProcessing} onClick={() => addToBatch()}>
                {isProcessing && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                Criar e adicionar
              </Button>
            </div>
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
