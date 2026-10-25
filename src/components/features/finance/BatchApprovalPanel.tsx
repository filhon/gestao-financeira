"use client";

import { Fragment, useState } from "react";
import currency from "currency.js";
import { format } from "date-fns";
import { Check, Edit2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
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
import { PaymentBatch, Transaction } from "@/lib/types";
import {
  BatchActor,
  effectiveAmount,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { cn, formatCurrency, plural } from "@/lib/utils";

/** "1.234,56" ou "1234.56" → 1234.56; inválido → NaN. */
const parseAmount = (value: string) => {
  const v = value.trim();
  const normalized = v.includes(",")
    ? v.replace(/\./g, "").replace(",", ".")
    : v;
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN;
};

const TH = "text-xs font-medium text-muted-foreground";

/**
 * Aprovação na página do lote: ajustar valor e rejeitar por transação, depois
 * aprovar ou devolver o lote inteiro. Nada é gravado antes de aprovar.
 */
export function BatchApprovalPanel({
  batch,
  transactions,
  actor,
  onApproved,
  onReturned,
  onOpen,
}: {
  batch: PaymentBatch;
  transactions: Transaction[];
  actor: BatchActor;
  onApproved: () => void;
  onReturned: () => void;
  /** Abre o detalhe da transação (boleto, anexos) antes de decidir. */
  onOpen: (t: Transaction) => void;
}) {
  const [adjusted, setAdjusted] = useState<Map<string, number>>(new Map());
  const [rejected, setRejected] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [comment, setComment] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountOf = (t: Transaction) => adjusted.get(t.id) ?? effectiveAmount(t);
  const kept = transactions.filter((t) => !rejected.has(t.id));
  const total = kept.reduce((acc, t) => acc.add(amountOf(t)), currency(0));

  const startEdit = (t: Transaction) => {
    setEditingId(t.id);
    setEditValue(amountOf(t).toFixed(2).replace(".", ","));
  };

  const saveEdit = (t: Transaction) => {
    const value = parseAmount(editValue);
    if (isNaN(value)) {
      toast.error("Valor inválido");
      return;
    }
    const next = new Map(adjusted);
    if (value === effectiveAmount(t)) next.delete(t.id);
    else next.set(t.id, value);
    setAdjusted(next);
    setEditingId(null);
  };

  const confirmReject = () => {
    if (!rejectingId || !rejectReason.trim()) return;
    setRejected(new Map(rejected).set(rejectingId, rejectReason.trim()));
    setRejectingId(null);
    setRejectReason("");
  };

  const undoReject = (id: string) => {
    const next = new Map(rejected);
    next.delete(id);
    setRejected(next);
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      await paymentBatchService.approveWithDetails(
        batch.id,
        actor,
        comment.trim() || undefined,
        [...adjusted]
          .filter(([id]) => !rejected.has(id))
          .map(([id, adjustedAmount]) => ({ id, adjustedAmount })),
        [...rejected].map(([id, reason]) => ({ id, reason })),
      );
      toast.success(
        `Lote aprovado: ${plural(kept.length, "transação", "transações")} · ${formatCurrency(total.value)}`,
      );
      onApproved();
    } catch (error) {
      console.error("Error approving batch:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao aprovar lote",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturn = async () => {
    if (!returnReason.trim()) return;
    setIsSubmitting(true);
    try {
      await paymentBatchService.returnToManager(batch.id, actor, returnReason);
      toast.success(`Lote "${batch.name}" devolvido ao gestor`);
      onReturned();
    } catch (error) {
      console.error("Error returning batch:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao devolver lote",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-label="Aprovação do lote" className="space-y-4">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={cn(TH, "w-[110px]")}>Vencimento</TableHead>
              <TableHead className={TH}>Descrição</TableHead>
              <TableHead className={TH}>Fornecedor</TableHead>
              <TableHead className={cn(TH, "text-right")}>Valor</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhuma transação no lote.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((t) => {
                const reason = rejected.get(t.id);
                const isAdjusted = adjusted.has(t.id) && !reason;
                return (
                  <Fragment key={t.id}>
                    <TableRow className={cn(reason && "text-muted-foreground")}>
                      <TableCell className="tabular-nums">
                        {format(t.dueDate, "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell className="max-w-0">
                        <button
                          type="button"
                          className={cn(
                            "block max-w-full truncate rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            reason && "line-through",
                          )}
                          title={t.description}
                          onClick={() => onOpen(t)}
                        >
                          {t.description}
                        </button>
                        {reason && (
                          <span className="block truncate text-xs text-red-700 dark:text-red-400">
                            Rejeitada: {reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-0">
                        <span
                          className="block truncate"
                          title={t.supplierOrClient}
                        >
                          {t.supplierOrClient}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-financial tabular-nums">
                        {editingId === t.id ? (
                          <Input
                            inputMode="decimal"
                            aria-label={`Novo valor de ${t.description}`}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(t);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="ml-auto h-8 w-28 text-right"
                            autoFocus
                          />
                        ) : (
                          <>
                            {isAdjusted && (
                              <span className="mr-1.5 text-xs text-muted-foreground line-through">
                                {formatCurrency(effectiveAmount(t))}
                              </span>
                            )}
                            <span className={cn(reason && "line-through")}>
                              {formatCurrency(amountOf(t))}
                            </span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {reason ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => undoReject(t.id)}
                          >
                            Desfazer
                          </Button>
                        ) : editingId === t.id ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => saveEdit(t)}
                              aria-label="Salvar valor"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancelar edição"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => startEdit(t)}
                              aria-label={`Ajustar valor de ${t.description}`}
                              title="Ajustar valor"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setRejectingId(t.id);
                                setRejectReason("");
                              }}
                              aria-label={`Rejeitar ${t.description}`}
                              title="Rejeitar"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {rejectingId === t.id && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={5}>
                          <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center">
                            <Label
                              htmlFor={`reject-${t.id}`}
                              className="shrink-0"
                            >
                              Motivo da rejeição
                            </Label>
                            <Input
                              id={`reject-${t.id}`}
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmReject();
                                if (e.key === "Escape") setRejectingId(null);
                              }}
                              placeholder="Ex.: boleto em duplicidade"
                              className="h-8"
                              autoFocus
                            />
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setRejectingId(null)}
                              >
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={confirmReject}
                                disabled={!rejectReason.trim()}
                              >
                                Rejeitar transação
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {returning ? (
        <div className="space-y-2">
          <Label htmlFor="return-reason">Motivo da devolução</Label>
          <Textarea
            id="return-reason"
            placeholder="Ex.: faltam as notas fiscais de dois fornecedores"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            className="min-h-20"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            O lote volta para o gestor como Aberto, com este motivo. Ajustes e
            rejeições desta tela não são gravados.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="approval-comment">
            Comentário{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </Label>
          <Textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-16"
          />
        </div>
      )}

      {/* Barra de decisão: fica à vista enquanto a lista rola */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-1 py-3">
        <p className="text-sm">
          <span className="font-medium">
            {plural(kept.length, "transação", "transações")}
          </span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium font-financial tabular-nums">
            {formatCurrency(total.value)}
          </span>
          {(rejected.size > 0 || adjusted.size > 0) && (
            <span className="text-muted-foreground">
              {rejected.size > 0 &&
                ` · ${plural(rejected.size, "rejeitada", "rejeitadas")}`}
              {adjusted.size > 0 &&
                ` · ${plural(adjusted.size, "ajustada", "ajustadas")}`}
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {returning ? (
            <>
              <Button
                variant="outline"
                onClick={() => setReturning(false)}
                disabled={isSubmitting}
              >
                Voltar
              </Button>
              <Button
                variant="destructive"
                onClick={handleReturn}
                disabled={isSubmitting || !returnReason.trim()}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Devolver lote
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setReturning(true)}
                disabled={isSubmitting}
              >
                Devolver ao gestor
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isSubmitting || kept.length === 0}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Aprovar {plural(kept.length, "transação", "transações")}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
