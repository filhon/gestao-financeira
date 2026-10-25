"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
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
import {
  BatchActor,
  effectiveAmount,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { formatCurrency } from "@/lib/utils";
import currency from "currency.js";
import { format } from "date-fns";
import { Loader2, X, Check, Edit2 } from "lucide-react";
import { toast } from "sonner";

interface BatchApprovalDialogProps {
  batch: PaymentBatch | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => void;
  actor: BatchActor;
}

/** "1.234,56" ou "1234.56" → 1234.56; inválido → NaN. */
const parseAmount = (value: string) => {
  const v = value.trim();
  const normalized = v.includes(",")
    ? v.replace(/\./g, "").replace(",", ".")
    : v;
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN;
};

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
  actor,
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
              originalAmount: effectiveAmount(t),
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
      setEditAmountValue(
        (edit?.adjustedAmount ?? effectiveAmount(transaction))
          .toFixed(2)
          .replace(".", ","),
      );
    }
  };

  const handleSaveAmount = () => {
    if (!editingAmountId) return;
    const newAmount = parseAmount(editAmountValue);
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
          }),
        ),
      );
    }
    setEditingAmountId(null);
    setEditAmountValue("");
  };

  const handleStartReject = (transactionId: string) => {
    setRejectingId(transactionId);
    setRejectReason("");
  };

  // Só marca: a rejeição é gravada junto com a aprovação, então Cancelar desfaz.
  const handleConfirmReject = () => {
    if (!rejectingId || !rejectReason.trim()) {
      toast.error("Informe o motivo da rejeição");
      return;
    }
    const current = edits.get(rejectingId);
    if (current) {
      setEdits(
        new Map(edits).set(rejectingId, {
          ...current,
          isRejected: true,
          rejectionReason: rejectReason.trim(),
        }),
      );
    }
    setRejectingId(null);
    setRejectReason("");
  };

  const undoReject = (transactionId: string) => {
    const current = edits.get(transactionId);
    if (!current) return;
    setEdits(
      new Map(edits).set(transactionId, {
        ...current,
        isRejected: false,
        rejectionReason: undefined,
      }),
    );
  };

  const handleApprove = async () => {
    if (!batch) return;

    setIsSubmitting(true);
    try {
      // Collect adjustments
      const adjustments: Array<{ id: string; adjustedAmount: number }> = [];
      const rejections: Array<{ id: string; reason: string }> = [];
      edits.forEach((edit) => {
        if (edit.isRejected) {
          rejections.push({ id: edit.id, reason: edit.rejectionReason ?? "" });
        } else if (edit.adjustedAmount !== undefined) {
          adjustments.push({
            id: edit.id,
            adjustedAmount: edit.adjustedAmount,
          });
        }
      });

      await paymentBatchService.approveWithDetails(
        batch.id,
        actor,
        comment || undefined,
        adjustments,
        rejections,
      );

      toast.success(
        `Lote aprovado: ${approvedCount} ${approvedCount === 1 ? "transação" : "transações"} · ${formatCurrency(totalAmount)}`,
      );
      onApprove();
      onClose();
    } catch (error) {
      console.error("Error approving batch:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao aprovar lote",
      );
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
    return edit?.adjustedAmount ?? effectiveAmount(transaction);
  };

  const isRejected = (transaction: Transaction) =>
    !!edits.get(transaction.id)?.isRejected;

  const isAmountEdited = (transaction: Transaction) => {
    const edit = edits.get(transaction.id);
    return edit?.adjustedAmount !== undefined;
  };

  const kept = transactions.filter((t) => !isRejected(t));
  const approvedCount = kept.length;
  const totalAmount = kept.reduce(
    (acc, t) => acc.add(getDisplayAmount(t)),
    currency(0),
  ).value;
  const rejectedCount = transactions.length - approvedCount;

  if (!batch) return null;

  return (
    <ResponsiveModal open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveModalContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            Aprovar Lote: {batch.name}
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="flex justify-between text-sm font-medium bg-muted/50 p-3 rounded-lg">
            <span>
              Transações: {approvedCount}
              {rejectedCount > 0 &&
                ` (${rejectedCount} ${rejectedCount === 1 ? "rejeitada" : "rejeitadas"})`}
            </span>
            <span className="font-financial">
              Total: {formatCurrency(totalAmount)}
            </span>
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
                      <TableRow
                        key={t.id}
                        className={
                          isRejected(t)
                            ? "text-muted-foreground line-through decoration-muted-foreground/50"
                            : undefined
                        }
                        title={edits.get(t.id)?.rejectionReason}
                      >
                        <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                        <TableCell>{t.description}</TableCell>
                        <TableCell>{t.supplierOrClient}</TableCell>
                        <TableCell className="text-right">
                          {editingAmountId === t.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <Input
                                inputMode="decimal"
                                aria-label="Novo valor"
                                value={editAmountValue}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveAmount();
                                  if (e.key === "Escape")
                                    setEditingAmountId(null);
                                }}
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
                            <div className="flex items-center gap-1 justify-end font-financial">
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
                          {isRejected(t) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs no-underline"
                              onClick={() => undoReject(t.id)}
                            >
                              Desfazer
                            </Button>
                          ) : (
                            editingAmountId !== t.id && (
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => handleEditAmount(t.id)}
                                  title="Editar valor"
                                  aria-label={`Editar valor de ${t.description}`}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-red-500 hover:text-red-700"
                                  onClick={() => handleStartReject(t.id)}
                                  title="Rejeitar"
                                  aria-label={`Rejeitar ${t.description}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            )
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
                className="min-h-20"
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
              className="min-h-20"
            />
          </div>
        </div>

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isSubmitting || approvedCount === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aprovar Lote
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
