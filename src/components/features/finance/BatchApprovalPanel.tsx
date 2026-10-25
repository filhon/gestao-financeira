"use client";

import { Fragment, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import currency from "currency.js";
import { format } from "date-fns";
import { AlertTriangle, Edit2, Loader2, X } from "lucide-react";
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
import {
  costCenterBalancesQuery,
  useCostCenters,
} from "@/hooks/useCostCenters";
import {
  EnvelopeLine,
  envelopeSnapshot,
} from "@/components/features/finance/EnvelopeLine";

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
 * Envelope dos centros de custo do lote, no exercício de cada vencimento.
 * As despesas já reservaram saldo desde o rascunho: isto é a situação atual,
 * não o que a aprovação vai consumir.
 */
function BatchEnvelopes({
  companyId,
  transactions,
}: {
  companyId: string;
  transactions: Transaction[];
}) {
  const { costCenters } = useCostCenters(companyId);
  const years = [...new Set(transactions.map((t) => t.dueDate.getFullYear()))];
  const balances = useQueries({
    queries: years.map((year) => ({
      ...costCenterBalancesQuery(companyId, costCenters, year),
      enabled: costCenters.length > 0,
    })),
  });

  const ccIds = [
    ...new Set(
      transactions
        .map((t) => t.costCenterId)
        .filter((id): id is string => !!id),
    ),
  ];
  const names = new Map(costCenters.map((cc) => [cc.id, cc.name]));
  const rows = ccIds.flatMap((ccId) =>
    years.flatMap((year, i) => {
      const b = balances[i].data?.[ccId];
      return b ? [{ ccId, snapshot: envelopeSnapshot(b, year) }] : [];
    }),
  );
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Centros de custo deste lote
      </p>
      <ul className="space-y-1 text-sm">
        {rows.map(({ ccId, snapshot }) => (
          <li
            key={`${ccId}-${snapshot.year}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4"
          >
            <span className="font-medium">{names.get(ccId) ?? ccId}</span>
            <EnvelopeLine snapshot={snapshot} className="text-xs" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Aprovação na página do lote: reduzir valor e rejeitar por transação (sempre
 * com motivo), depois aprovar ou devolver o lote inteiro. Nada é gravado antes
 * de aprovar.
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
  const [adjusted, setAdjusted] = useState<
    Map<string, { to: number; reason: string }>
  >(new Map());
  const [rejected, setRejected] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [comment, setComment] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountOf = (t: Transaction) =>
    adjusted.get(t.id)?.to ?? effectiveAmount(t);
  const kept = transactions.filter((t) => !rejected.has(t.id));
  const total = kept.reduce((acc, t) => acc.add(amountOf(t)), currency(0));
  const reducedCount = [...adjusted.keys()].filter(
    (id) => !rejected.has(id),
  ).length;

  const startEdit = (t: Transaction) => {
    setRejectingId(null);
    setEditingId(t.id);
    setEditValue(amountOf(t).toFixed(2).replace(".", ","));
    setEditReason(adjusted.get(t.id)?.reason ?? "");
  };

  const saveEdit = (t: Transaction) => {
    const value = parseAmount(editValue);
    const original = effectiveAmount(t);
    const next = new Map(adjusted);
    if (value === original) {
      next.delete(t.id);
    } else if (isNaN(value) || value <= 0 || value > original) {
      toast.error(`Informe um valor menor que ${formatCurrency(original)}`);
      return;
    } else if (!editReason.trim()) {
      toast.error("Informe o motivo da redução");
      return;
    } else {
      next.set(t.id, { to: value, reason: editReason.trim() });
    }
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
          .map(([id, a]) => ({ id, adjustedAmount: a.to, reason: a.reason })),
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
      <BatchEnvelopes companyId={batch.companyId} transactions={transactions} />

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
                const adj = reason ? undefined : adjusted.get(t.id);
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
                        {t.budgetExceeded && !reason && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            <AlertTriangle
                              className="h-3 w-3 shrink-0"
                              aria-hidden
                            />
                            Criada sem saldo no centro de custo
                          </span>
                        )}
                        {reason && (
                          <span className="block truncate text-xs text-red-700 dark:text-red-400">
                            Rejeitada: {reason}
                          </span>
                        )}
                        {adj && (
                          <span className="block truncate text-xs text-muted-foreground">
                            Reduzida: {adj.reason}
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
                        {adj && (
                          <span className="mr-1.5 text-xs text-muted-foreground line-through">
                            {formatCurrency(effectiveAmount(t))}
                          </span>
                        )}
                        <span className={cn(reason && "line-through")}>
                          {formatCurrency(amountOf(t))}
                        </span>
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
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => startEdit(t)}
                              aria-label={`Reduzir valor de ${t.description}`}
                              title="Reduzir valor"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setEditingId(null);
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
                    {editingId === t.id && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={5}>
                          <form
                            className="flex flex-col gap-2 py-1 sm:flex-row sm:items-end"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveEdit(t);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          >
                            <div className="space-y-1 sm:w-36">
                              <Label htmlFor={`value-${t.id}`}>
                                Novo valor
                              </Label>
                              <Input
                                id={`value-${t.id}`}
                                inputMode="decimal"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="h-8 text-right tabular-nums"
                                autoFocus
                              />
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label htmlFor={`reduce-${t.id}`}>
                                Motivo da redução
                              </Label>
                              <Input
                                id={`reduce-${t.id}`}
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                placeholder="Ex.: pagar só a 1ª parcela"
                                className="h-8"
                              />
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                Cancelar
                              </Button>
                              <Button type="submit" size="sm">
                                Reduzir
                              </Button>
                            </div>
                          </form>
                        </TableCell>
                      </TableRow>
                    )}
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
            O lote volta para o gestor como Aberto, com este motivo. Reduções e
            rejeições desta tela não são gravadas.
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
          {(rejected.size > 0 || reducedCount > 0) && (
            <span className="text-muted-foreground">
              {rejected.size > 0 &&
                ` · ${plural(rejected.size, "rejeitada", "rejeitadas")}`}
              {reducedCount > 0 &&
                ` · ${plural(reducedCount, "reduzida", "reduzidas")}`}
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
                disabled={isSubmitting || kept.length === 0 || !!editingId}
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
