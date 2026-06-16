"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import currency from "currency.js";
import { formatCurrency } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Undo2,
  Edit2,
  X,
  Check,
} from "lucide-react";
import { toast } from "sonner";

interface BatchInfo {
  id: string;
  name: string;
}

interface BatchTransaction {
  id: string;
  description: string;
  amount: number;
  dueDate: Date;
  createdAt: Date | null;
  costCenterId: string | null;
  supplierOrClient: string | null;
}

interface BatchCostCenter {
  id: string;
  name: string;
  parentId?: string | null;
}

interface TransactionEdit {
  id: string;
  adjustedAmount?: number;
}

interface SupplierGroup {
  supplier: string;
  transactions: BatchTransaction[];
  totalAmount: number;
}

interface CostCenterGroup {
  costCenterId: string;
  breadcrumb: string[];
  suppliers: SupplierGroup[];
  totalAmount: number;
}

export default function BatchApprovalPage() {
  const params = useParams();
  const router = useRouter();
  const rawToken = params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : (rawToken ?? "");

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [transactions, setTransactions] = useState<BatchTransaction[]>([]);
  const [costCenters, setCostCenters] = useState<BatchCostCenter[]>([]);
  const [status, setStatus] = useState<
    "loading" | "ready" | "success" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const [edits, setEdits] = useState<Map<string, TransactionEdit>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [comment, setComment] = useState("");

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  const [showApproveDialog, setShowApproveDialog] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRejectSubmitting, setIsRejectSubmitting] = useState(false);

  const rejectCardRef = useRef<HTMLDivElement>(null);
  const rejectTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        const res = await fetch(
          `/api/internal/batch-approval?token=${encodeURIComponent(token)}`,
        );
        const payload = await res.json();

        if (!res.ok) {
          setStatus("error");
          setErrorMessage(payload.error || "Erro ao carregar o lote.");
          return;
        }

        setBatch({ id: payload.batch.id, name: payload.batch.name });

        setTransactions(
          payload.transactions.map(
            (t: {
              id: string;
              description: string;
              amount: number;
              dueDate: string | null;
              createdAt: string | null;
              costCenterId: string | null;
              supplierOrClient: string | null;
            }) => ({
              id: t.id,
              description: t.description,
              amount: t.amount,
              dueDate: t.dueDate ? new Date(t.dueDate) : new Date(),
              createdAt: t.createdAt ? new Date(t.createdAt) : null,
              costCenterId: t.costCenterId,
              supplierOrClient: t.supplierOrClient,
            }),
          ),
        );

        setCostCenters(payload.costCenters);
        setStatus("ready");
      } catch (error) {
        console.error("Error loading batch:", error);
        setStatus("error");
        setErrorMessage("Erro ao carregar o lote.");
      }
    };

    loadData();
  }, [token]);

  // Scroll to and focus the rejection form whenever a transaction is selected for rejection
  useEffect(() => {
    if (!rejectingId) return;
    rejectCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const timer = setTimeout(() => rejectTextareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [rejectingId]);

  const costCenterMap = useMemo(
    () => new Map(costCenters.map((cc) => [cc.id, cc])),
    [costCenters],
  );

  const buildBreadcrumb = useCallback(
    (costCenterId: string): string[] => {
      const result: string[] = [];
      let currentId: string | undefined | null = costCenterId;

      while (currentId) {
        const cc = costCenterMap.get(currentId);
        if (cc) {
          result.unshift(cc.name);
          currentId = cc.parentId;
        } else {
          break;
        }
      }

      return result;
    },
    [costCenterMap],
  );

  const groupedTransactions = useMemo((): CostCenterGroup[] => {
    const ccMap = new Map<string, SupplierGroup[]>();

    transactions.forEach((t) => {
      const ccId = t.costCenterId || "uncategorized";
      if (!ccMap.has(ccId)) {
        ccMap.set(ccId, []);
      }

      const supplierGroups = ccMap.get(ccId)!;
      const supplier = t.supplierOrClient || "Sem Fornecedor";
      let group = supplierGroups.find((sg) => sg.supplier === supplier);

      if (!group) {
        group = { supplier, transactions: [], totalAmount: 0 };
        supplierGroups.push(group);
      }

      const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
      group.transactions.push(t);
      group.totalAmount = currency(group.totalAmount).add(amount).value;
    });

    const result: CostCenterGroup[] = [];
    ccMap.forEach((suppliers, ccId) => {
      const breadcrumb =
        ccId === "uncategorized"
          ? ["Sem Centro de Custo"]
          : buildBreadcrumb(ccId);
      suppliers.sort((a, b) => b.totalAmount - a.totalAmount);

      suppliers.forEach((sg) => {
        sg.transactions.sort((a, b) => {
          const amountA = edits.get(a.id)?.adjustedAmount ?? a.amount;
          const amountB = edits.get(b.id)?.adjustedAmount ?? b.amount;
          return amountB - amountA;
        });
      });

      result.push({
        costCenterId: ccId,
        breadcrumb,
        suppliers,
        totalAmount: suppliers.reduce(
          (sum, sg) => currency(sum).add(sg.totalAmount).value,
          0,
        ),
      });
    });

    result.sort((a, b) => b.totalAmount - a.totalAmount);

    return result;
  }, [transactions, edits, buildBreadcrumb]);

  const totalAmount = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
      return currency(sum).add(amount).value;
    }, 0);
  }, [transactions, edits]);

  const now = useMemo(() => new Date(), []);
  const isNewTransaction = useCallback(
    (t: BatchTransaction): boolean => {
      if (!t.createdAt) return false;
      return differenceInDays(now, t.createdAt) <= 30;
    },
    [now],
  );

  const handleStartEdit = (t: BatchTransaction) => {
    setEditingId(t.id);
    const current = edits.get(t.id)?.adjustedAmount ?? t.amount;
    setEditValue(
      current.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const newAmount = currency(editValue, {
      decimal: ",",
      separator: ".",
    }).value;
    if (isNaN(newAmount) || newAmount <= 0) {
      toast.error("Valor inválido");
      return;
    }

    const t = transactions.find((tx) => tx.id === editingId);
    if (t) {
      const newEdits = new Map(edits);
      if (newAmount !== t.amount) {
        newEdits.set(editingId, { id: editingId, adjustedAmount: newAmount });
      } else {
        newEdits.delete(editingId);
      }
      setEdits(newEdits);
    }

    setEditingId(null);
    setEditValue("");
  };

  const handleRejectTransaction = async () => {
    if (!rejectingId || !rejectReason.trim()) {
      toast.error("Informe o motivo da rejeição");
      return;
    }

    setIsRejectSubmitting(true);
    try {
      const res = await fetch("/api/internal/batch-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "reject-transaction",
          transactionId: rejectingId,
          reason: rejectReason,
        }),
      });

      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Erro ao rejeitar transação");
      }

      const newEdits = new Map(edits);
      newEdits.delete(rejectingId);
      setEdits(newEdits);
      setTransactions(transactions.filter((t) => t.id !== rejectingId));
      toast.success("Transação rejeitada");
    } catch (error) {
      console.error("Error rejecting:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao rejeitar transação",
      );
    } finally {
      setIsRejectSubmitting(false);
      setRejectingId(null);
      setRejectReason("");
    }
  };

  const handleReturnToManager = async () => {
    if (!returnReason.trim()) {
      toast.error("Informe o motivo da devolução");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/internal/batch-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "return",
          reason: returnReason,
        }),
      });

      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Erro ao devolver lote");
      }

      toast.success("Lote devolvido ao gestor");
      setStatus("success");
    } catch (error) {
      console.error("Error returning:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao devolver lote",
      );
    } finally {
      setIsSubmitting(false);
      setShowReturnDialog(false);
    }
  };

  const handleApprove = async () => {
    if (transactions.length === 0) {
      toast.error("Não há transações para aprovar");
      return;
    }

    setIsSubmitting(true);
    try {
      const adjustments = Array.from(edits.values()).filter(
        (e) => e.adjustedAmount !== undefined,
      );

      const res = await fetch("/api/internal/batch-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "approve",
          comment: comment || undefined,
          adjustments: adjustments.length > 0 ? adjustments : undefined,
        }),
      });

      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || "Erro ao aprovar lote");
      }

      setStatus("success");
    } catch (error) {
      console.error("Error approving:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao aprovar lote",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-muted/40 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Carregando lote...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center pb-2">
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <CardTitle>Link inválido</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" onClick={() => router.push("/login")}>
              Ir para Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center pb-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
            <CardTitle>Concluído</CardTitle>
            <CardDescription>
              O lote foi processado com sucesso.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push("/login")}>
              Ir para o Sistema
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Sticky header */}
      <div className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4">
          <h1 className="text-lg sm:text-xl font-bold truncate">
            {batch?.name}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Revise as transações e aprove ou devolva o lote.
          </p>
        </div>
      </div>

      {/* pb-28 sm:pb-20 clears the fixed footer (mobile: 2 stacked buttons ≈ 112px; sm: 1 row ≈ 80px) */}
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5 pb-28 sm:pb-20">
        {/* Summary bar */}
        <div className="bg-card rounded-lg border px-5 py-4 grid grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Transações</p>
            <p className="text-xl sm:text-2xl font-semibold tabular-nums leading-none">
              {transactions.length}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">Total</p>
            <p className="text-xl sm:text-2xl font-bold font-financial tabular-nums leading-none">
              {formatCurrency(totalAmount)}
            </p>
          </div>
        </div>

        {/* Transactions grouped by cost center */}
        <div className="space-y-4">
          {groupedTransactions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                Todas as transações foram rejeitadas.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                As transações rejeitadas aguardam revisão do gestor. Use
                &ldquo;Devolver ao Gestor&rdquo; para solicitar os ajustes
                necessários.
              </p>
            </div>
          )}
          {groupedTransactions.map((ccGroup) => (
            <Card key={ccGroup.costCenterId}>
              <CardHeader className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  {/* Breadcrumb — last segment serves as section heading for screen readers */}
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm min-w-0 flex-1">
                    {ccGroup.breadcrumb.map((name, idx) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 min-w-0"
                      >
                        {idx > 0 && (
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span
                          role={
                            idx === ccGroup.breadcrumb.length - 1
                              ? "heading"
                              : undefined
                          }
                          aria-level={
                            idx === ccGroup.breadcrumb.length - 1
                              ? 2
                              : undefined
                          }
                          className={
                            idx === ccGroup.breadcrumb.length - 1
                              ? "font-semibold text-primary"
                              : "text-muted-foreground"
                          }
                        >
                          {name}
                        </span>
                      </span>
                    ))}
                  </div>
                  <span className="text-sm font-financial text-muted-foreground shrink-0 tabular-nums">
                    {formatCurrency(ccGroup.totalAmount)}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="pt-0 pb-4">
                <Accordion type="multiple" className="space-y-2">
                  {ccGroup.suppliers.map((sg) => (
                    <AccordionItem
                      key={sg.supplier}
                      value={sg.supplier}
                      className="border rounded-lg"
                    >
                      <h3 className="m-0 leading-none">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:shrink-0">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full mr-2 gap-0.5 sm:gap-4 min-w-0 text-left">
                            <span className="font-medium truncate">
                              {sg.supplier}
                            </span>
                            <span className="text-xs sm:text-sm text-muted-foreground font-financial tabular-nums shrink-0">
                              {sg.transactions.length}{" "}
                              {sg.transactions.length === 1
                                ? "transação"
                                : "transações"}{" "}
                              · {formatCurrency(sg.totalAmount)}
                            </span>
                          </div>
                        </AccordionTrigger>
                      </h3>

                      <AccordionContent className="px-4 pb-4">
                        <ul className="space-y-2">
                          {sg.transactions.map((t) => {
                            const isNew = isNewTransaction(t);
                            const amount =
                              edits.get(t.id)?.adjustedAmount ?? t.amount;
                            const isEdited = edits.has(t.id);
                            const isEditing = editingId === t.id;

                            return (
                              <li
                                key={t.id}
                                className={[
                                  "flex gap-2 p-3 rounded-lg border",
                                  isEditing
                                    ? "flex-col"
                                    : "flex-row items-center justify-between",
                                  isNew
                                    ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
                                    : "bg-muted/40",
                                ].join(" ")}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium text-sm truncate">
                                      {t.description}
                                    </span>
                                    {isNew && (
                                      <Badge
                                        variant="secondary"
                                        className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs shrink-0"
                                      >
                                        Novo
                                      </Badge>
                                    )}
                                    {isEdited && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs shrink-0"
                                      >
                                        Editado
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Venc. {format(t.dueDate, "dd/MM/yyyy")}
                                  </p>
                                </div>

                                <div
                                  className={[
                                    "flex items-center gap-1 shrink-0",
                                    isEditing ? "w-full" : "",
                                  ].join(" ")}
                                >
                                  {isEditing ? (
                                    <div className="flex items-center gap-1 w-full">
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={editValue}
                                        onChange={(e) =>
                                          setEditValue(e.target.value)
                                        }
                                        className="flex-1 h-10 sm:h-8 sm:w-32 sm:flex-none"
                                        autoFocus
                                      />
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-11 w-11 sm:h-8 sm:w-8 shrink-0"
                                        onClick={handleSaveEdit}
                                        aria-label="Confirmar edição"
                                      >
                                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-11 w-11 sm:h-8 sm:w-8 shrink-0"
                                        onClick={() => setEditingId(null)}
                                        aria-label="Cancelar edição"
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <>
                                      <span className="font-semibold font-financial text-sm tabular-nums">
                                        {formatCurrency(amount)}
                                      </span>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-11 w-11 sm:h-8 sm:w-8"
                                        onClick={() => handleStartEdit(t)}
                                        aria-label="Editar valor"
                                      >
                                        <Edit2 className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-11 w-11 sm:h-8 sm:w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setRejectingId(t.id)}
                                        aria-label="Rejeitar transação"
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Inline rejection form */}
        {rejectingId && (
          <Card ref={rejectCardRef} className="border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-destructive text-base">
                Rejeitar Transação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reject-reason">Motivo da rejeição</Label>
                <Textarea
                  ref={rejectTextareaRef}
                  id="reject-reason"
                  placeholder="Descreva o motivo..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setRejectingId(null)}
                  disabled={isRejectSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRejectTransaction}
                  disabled={isRejectSubmitting}
                >
                  {isRejectSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Confirmar Rejeição
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comment */}
        <div className="space-y-1.5">
          <Label htmlFor="batch-comment" className="text-sm font-medium">
            Comentário (opcional)
          </Label>
          <Textarea
            id="batch-comment"
            placeholder="Adicione um comentário sobre a aprovação..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      {/* Fixed action footer */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-background border-t">
        <div className="max-w-5xl mx-auto px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setShowReturnDialog(true)}
            disabled={isSubmitting}
          >
            <Undo2 className="mr-2 h-4 w-4" />
            Devolver ao Gestor
          </Button>
          <Button
            onClick={() => setShowApproveDialog(true)}
            disabled={isSubmitting || transactions.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aprovar Lote
          </Button>
        </div>
      </div>

      {/* Approve confirmation dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Aprovação do Lote</AlertDialogTitle>
            <AlertDialogDescription>
              Você está aprovando{" "}
              <strong>{transactions.length} transações</strong> no valor total
              de{" "}
              <strong className="font-financial">
                {formatCurrency(totalAmount)}
              </strong>
              . Esta ação não pode ser desfeita pelo portal de aprovação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowApproveDialog(false);
                handleApprove();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white"
            >
              Confirmar Aprovação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return to manager dialog */}
      <AlertDialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Devolver Lote ao Gestor</AlertDialogTitle>
            <AlertDialogDescription>
              O lote será devolvido para que o gestor financeiro faça os ajustes
              necessários.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-1.5">
            <Label htmlFor="return-reason">Motivo da devolução</Label>
            <Textarea
              id="return-reason"
              aria-describedby="return-reason-hint"
              placeholder="Descreva os ajustes necessários..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={3}
            />
            {!returnReason.trim() && (
              <p
                id="return-reason-hint"
                className="text-xs text-muted-foreground"
              >
                Obrigatório para confirmar a devolução.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReturnToManager}
              disabled={!returnReason.trim()}
            >
              Confirmar Devolução
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
