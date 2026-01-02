"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PaymentBatch, Transaction } from "@/lib/types";
import { transactionService } from "@/lib/services/transactionService";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Loader2, X, Check, Edit2 } from "lucide-react";
import { toast } from "sonner";

interface BatchApprovalDialogProps {
  batch: PaymentBatch | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => void;
  userId: string;
}

interface TransactionEdit {
  id: string;
  originalAmount: number;
  adjustedAmount?: number;
  isRejected: boolean;
  rejectionReason?: string;
}

export function BatchApprovalDialog({
  batch,
  isOpen,
  onClose,
  onApprove,
  userId,
}: BatchApprovalDialogProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [edits, setEdits] = useState<Map<string, TransactionEdit>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comment, setComment] = useState("");
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [editAmountValue, setEditAmountValue] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    const loadTransactions = async () => {
      if (batch && isOpen) {
        setIsLoading(true);
        try {
          const data = await transactionService.getAll({ batchId: batch.id });
          setTransactions(data);
          // Initialize edits map
          const initialEdits = new Map<string, TransactionEdit>();
          data.forEach((t) => {
            initialEdits.set(t.id, {
              id: t.id,
              originalAmount: t.amount,
              isRejected: false,
            });
          });
          setEdits(initialEdits);
        } catch (error) {
          console.error("Error loading transactions:", error);
          toast.error("Erro ao carregar transações");
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadTransactions();
  }, [batch, isOpen]);

  const handleEditAmount = (transactionId: string) => {
    const transaction = transactions.find((t) => t.id === transactionId);
    if (transaction) {
      setEditingAmountId(transactionId);
      const edit = edits.get(transactionId);
      setEditAmountValue(String(edit?.adjustedAmount ?? transaction.amount));
    }
  };

  const handleSaveAmount = () => {
    if (!editingAmountId) return;
    const newAmount = parseFloat(editAmountValue);
    if (isNaN(newAmount) || newAmount < 0) {
      toast.error("Valor inválido");
      return;
    }
    const currentEdit = edits.get(editingAmountId);
    if (currentEdit) {
      setEdits(
        new Map(
          edits.set(editingAmountId, {
            ...currentEdit,
            adjustedAmount:
              newAmount !== currentEdit.originalAmount ? newAmount : undefined,
          })
        )
      );
    }
    setEditingAmountId(null);
    setEditAmountValue("");
  };

  const handleStartReject = (transactionId: string) => {
    setRejectingId(transactionId);
    setRejectReason("");
  };

  const handleConfirmReject = async () => {
    if (!rejectingId || !batch || !rejectReason.trim()) {
      toast.error("Por favor, informe o motivo da rejeição");
      return;
    }

    try {
      await paymentBatchService.rejectTransaction(
        batch.id,
        rejectingId,
        rejectReason
      );
      // Remove from local state
      setTransactions(transactions.filter((t) => t.id !== rejectingId));
      edits.delete(rejectingId);
      setEdits(new Map(edits));
      toast.success("Transação rejeitada");
    } catch (error) {
      console.error("Error rejecting transaction:", error);
      toast.error("Erro ao rejeitar transação");
    } finally {
      setRejectingId(null);
      setRejectReason("");
    }
  };

  const handleApprove = async () => {
    if (!batch) return;

    setIsSubmitting(true);
    try {
      // Collect adjustments
      const adjustments: Array<{ id: string; adjustedAmount?: number }> = [];
      edits.forEach((edit) => {
        if (edit.adjustedAmount !== undefined) {
          adjustments.push({
            id: edit.id,
            adjustedAmount: edit.adjustedAmount,
          });
        }
      });

      await paymentBatchService.approveWithDetails(
        batch.id,
        userId,
        comment || undefined,
        adjustments.length > 0 ? adjustments : undefined
      );

      toast.success("Lote aprovado com sucesso");
      onApprove();
      onClose();
    } catch (error) {
      console.error("Error approving batch:", error);
      toast.error("Erro ao aprovar lote");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setComment("");
      setEdits(new Map());
      setEditingAmountId(null);
      setRejectingId(null);
      onClose();
    }
  };

  const getDisplayAmount = (transaction: Transaction) => {
    const edit = edits.get(transaction.id);
    return edit?.adjustedAmount ?? transaction.amount;
  };

  const isAmountEdited = (transaction: Transaction) => {
    const edit = edits.get(transaction.id);
    return edit?.adjustedAmount !== undefined;
  };

  const totalAmount = transactions.reduce(
    (sum, t) => sum + getDisplayAmount(t),
    0
  );

  if (!batch) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aprovar Lote: {batch.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="flex justify-between text-sm font-medium bg-muted/50 p-3 rounded-lg">
            <span>Transações: {transactions.length}</span>
            <span>Total: {formatCurrency(totalAmount)}</span>
          </div>

          {/* Transactions Table */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="border rounded-md max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right w-[120px]">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-4 text-muted-foreground"
                      >
                        Nenhuma transação no lote.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell>{t.supplierOrClient}</TableCell>
                        <TableCell className="text-right">
                          {editingAmountId === t.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <Input
                                type="number"
                                value={editAmountValue}
                                onChange={(e) =>
                                  setEditAmountValue(e.target.value)
                                }
                                className="w-24 h-8 text-right"
                                autoFocus
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={handleSaveAmount}
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingAmountId(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 justify-end">
                              {isAmountEdited(t) && (
                                <Badge variant="secondary" className="text-xs">
                                  Editado
                                </Badge>
                              )}
                              {formatCurrency(getDisplayAmount(t))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingAmountId !== t.id && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => handleEditAmount(t.id)}
                                title="Editar valor"
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-red-500 hover:text-red-700"
                                onClick={() => handleStartReject(t.id)}
                                title="Rejeitar"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Rejection Dialog */}
          {rejectingId && (
            <div className="border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 rounded-lg space-y-3">
              <Label className="text-red-700 dark:text-red-400">
                Motivo da rejeição
              </Label>
              <Textarea
                placeholder="Descreva o motivo da rejeição..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="min-h-[80px]"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRejectingId(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmReject}
                >
                  Confirmar Rejeição
                </Button>
              </div>
            </div>
          )}

          {/* Comment */}
          <div className="space-y-2">
            <Label>Comentário (opcional)</Label>
            <Textarea
              placeholder="Adicione um comentário sobre a aprovação..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isSubmitting || transactions.length === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aprovar Lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
