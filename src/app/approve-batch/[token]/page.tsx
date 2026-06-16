"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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

// Types for grouped transactions
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
  highlightedName: string;
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

  // Editing state
  const [edits, setEdits] = useState<Map<string, TransactionEdit>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [comment, setComment] = useState("");

  // Reject transaction state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Return to manager state
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  // Approve confirmation dialog state
  const [showApproveDialog, setShowApproveDialog] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRejectSubmitting, setIsRejectSubmitting] = useState(false);

  // Load batch and transactions from server-side API
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

  // Pre-build a lookup map to make breadcrumb traversal O(depth) instead of O(n*depth)
  const costCenterMap = useMemo(
    () => new Map(costCenters.map((cc) => [cc.id, cc])),
    [costCenters],
  );

  // Build cost center breadcrumb
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

  // Group transactions by cost center and supplier
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

    // Build result with breadcrumbs
    const result: CostCenterGroup[] = [];
    ccMap.forEach((suppliers, ccId) => {
      const breadcrumb =
        ccId === "uncategorized"
          ? ["Sem Centro de Custo"]
          : buildBreadcrumb(ccId);
      const cc = costCenterMap.get(ccId);

      // Sort suppliers by total (highest first)
      suppliers.sort((a, b) => b.totalAmount - a.totalAmount);

      // Sort transactions within each supplier by amount (highest first)
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
        highlightedName: cc?.name || "Sem Centro de Custo",
        suppliers,
        totalAmount: suppliers.reduce(
          (sum, sg) => currency(sum).add(sg.totalAmount).value,
          0,
        ),
      });
    });

    // Sort cost center groups by total (highest first)
    result.sort((a, b) => b.totalAmount - a.totalAmount);

    return result;
  }, [transactions, costCenterMap, edits, buildBreadcrumb]);

  // Calculate totals
  const totalAmount = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
      return currency(sum).add(amount).value;
    }, 0);
  }, [transactions, edits]);

  // Check if transaction is new (created within last 30 days)
  const isNewTransaction = (t: BatchTransaction): boolean => {
    if (!t.createdAt) return false;
    return differenceInDays(new Date(), t.createdAt) <= 30;
  };

  // Edit amount handlers
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

  // Reject transaction
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

  // Return to manager
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

  // Approve batch
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

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center border-red-200">
          <CardHeader>
            <div className="mx-auto bg-red-100 p-3 rounded-full w-fit mb-4">
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle className="text-red-700">Erro</CardTitle>
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

  // Success state
  if (status === "success") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto bg-emerald-100 p-3 rounded-full w-fit mb-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <CardTitle className="text-emerald-700">Ação Concluída!</CardTitle>
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold">Aprovar Lote: {batch?.name}</h1>
          <p className="text-sm text-muted-foreground">
            Revise as transações abaixo e aprove ou devolva o lote.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Bar */}
        <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
          <div>
            <span className="text-sm text-muted-foreground">Transações: </span>
            <span className="font-semibold">{transactions.length}</span>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Total: </span>
            <span className="font-bold font-financial text-lg">
              {formatCurrency(totalAmount)}
            </span>
          </div>
        </div>

        {/* Transactions grouped by Cost Center */}
        <div className="space-y-4">
          {groupedTransactions.map((ccGroup) => (
            <Card key={ccGroup.costCenterId}>
              <CardHeader className="pb-2">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 text-sm">
                  {ccGroup.breadcrumb.map((name, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      {idx > 0 && (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span
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
                <div className="text-sm text-muted-foreground font-financial">
                  Total: {formatCurrency(ccGroup.totalAmount)}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Accordion type="multiple" className="space-y-2">
                  {ccGroup.suppliers.map((sg) => (
                    <AccordionItem
                      key={sg.supplier}
                      value={sg.supplier}
                      className="border rounded-lg"
                    >
                      <AccordionTrigger className="px-4 hover:no-underline">
                        <div className="flex justify-between w-full mr-4 gap-2 min-w-0">
                          <span className="font-medium truncate min-w-0">
                            {sg.supplier}
                          </span>
                          <span className="text-muted-foreground font-financial shrink-0">
                            {sg.transactions.length} transações •{" "}
                            {formatCurrency(sg.totalAmount)}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-2">
                          {sg.transactions.map((t) => {
                            const isNew = isNewTransaction(t);
                            const amount =
                              edits.get(t.id)?.adjustedAmount ?? t.amount;
                            const isEdited = edits.has(t.id);

                            return (
                              <div
                                key={t.id}
                                className={`flex justify-between gap-2 p-3 rounded-lg border ${editingId === t.id ? "flex-col sm:flex-row sm:items-center items-start" : "items-center"} ${isNew ? "bg-emerald-50 border-emerald-200" : "bg-gray-50"}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium truncate">
                                      {t.description}
                                    </span>
                                    {isNew && (
                                      <Badge
                                        variant="secondary"
                                        className="bg-emerald-100 text-emerald-700 text-xs"
                                      >
                                        Novo
                                      </Badge>
                                    )}
                                    {isEdited && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        Editado
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Vencimento:{" "}
                                    {format(t.dueDate, "dd/MM/yyyy")}
                                  </p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {editingId === t.id ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={editValue}
                                        onChange={(e) =>
                                          setEditValue(e.target.value)
                                        }
                                        className="w-28 h-8"
                                        autoFocus
                                      />
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={handleSaveEdit}
                                        aria-label="Confirmar edição"
                                      >
                                        <Check className="h-4 w-4 text-green-600" />
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
                                    <>
                                      <span className="font-semibold font-financial">
                                        {formatCurrency(amount)}
                                      </span>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        onClick={() => handleStartEdit(t)}
                                        aria-label="Editar valor"
                                      >
                                        <Edit2 className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-red-500 hover:text-red-700"
                                        onClick={() => setRejectingId(t.id)}
                                        aria-label="Rejeitar transação"
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Rejection inline form */}
        {rejectingId && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-red-700 text-lg">
                Rejeitar Transação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Motivo da rejeição</Label>
                <Textarea
                  placeholder="Descreva o motivo..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
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

        {/* Comment section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Comentário (opcional)</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Adicione um comentário sobre a aprovação..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-between sticky bottom-0 bg-white border-t pt-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] -mx-4 gap-2">
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
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aprovar Lote
          </Button>
        </div>
      </div>

      {/* Approve Confirmation Dialog */}
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
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Confirmar Aprovação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return to Manager Dialog */}
      <AlertDialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Devolver Lote ao Gestor</AlertDialogTitle>
            <AlertDialogDescription>
              O lote será devolvido para que o gestor financeiro faça os ajustes
              necessários.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label>Motivo da devolução</Label>
            <Textarea
              placeholder="Descreva os ajustes necessários..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="mt-2"
            />
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
