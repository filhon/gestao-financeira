"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { transactionService } from "@/lib/services/transactionService";
import { costCenterService } from "@/lib/services/costCenterService";
import { Transaction, CostCenter } from "@/lib/types";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Edit2,
  X,
  Check,
  Receipt,
  Calendar,
  Building2,
  User,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

export default function ApprovalPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [costCenter, setCostCenter] = useState<CostCenter | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "success" | "rejected" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [comment, setComment] = useState("");

  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const txData = await transactionService.getByApprovalToken(token);
        if (!txData) {
          setStatus("error");
          setErrorMessage("Link inválido ou expirado.");
          return;
        }

        if (txData.status !== "pending_approval") {
          setStatus("error");
          setErrorMessage(
            `Esta transação não está aguardando aprovação (status: ${txData.status}).`
          );
          return;
        }

        if (
          txData.approvalTokenExpiresAt &&
          new Date(txData.approvalTokenExpiresAt) < new Date()
        ) {
          setStatus("error");
          setErrorMessage("Este link de aprovação expirou.");
          return;
        }

        setTransaction(txData);
        setEditValue(String(txData.amount));

        if (
          txData.costCenterAllocation &&
          txData.costCenterAllocation.length > 0
        ) {
          try {
            const ccId = txData.costCenterAllocation[0].costCenterId;
            const ccData = await costCenterService.getById(ccId);
            setCostCenter(ccData);
          } catch (error) {
            console.error("Error loading cost center:", error);
          }
        }

        setStatus("ready");
      } catch (error) {
        console.error("Error loading transaction:", error);
        setStatus("error");
        setErrorMessage("Erro ao carregar dados da transação.");
      }
    };
    loadData();
  }, [token]);

  const isNewTransaction = (): boolean => {
    if (!transaction) return false;
    return differenceInDays(new Date(), transaction.createdAt) <= 30;
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditValue(String(transaction?.amount || 0));
  };

  const handleSaveEdit = () => {
    if (!transaction) return;
    const newAmount = parseFloat(editValue);
    if (isNaN(newAmount) || newAmount < 0) {
      toast.error("Valor inválido");
      return;
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(String(transaction?.amount || 0));
  };

  const getAdjustedAmount = (): number => {
    if (!transaction) return 0;
    if (isEditing) return parseFloat(editValue) || 0;
    const adjusted = parseFloat(editValue);
    return isNaN(adjusted) ? transaction.amount : adjusted;
  };

  const hasAmountChange = (): boolean => {
    if (!transaction) return false;
    return getAdjustedAmount() !== transaction.amount;
  };

  const handleApprove = async () => {
    if (!transaction) return;

    setIsSubmitting(true);
    try {
      const adjustedAmount = getAdjustedAmount();
      const amountChanged = adjustedAmount !== transaction.amount;

      await transactionService.approveByToken(
        token,
        "magic-link",
        comment || undefined,
        amountChanged ? adjustedAmount : undefined
      );

      toast.success("Transação aprovada com sucesso!");
      setStatus("success");
    } catch (error: unknown) {
      console.error("Approval error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Erro ao aprovar transação";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!transaction || !rejectReason.trim()) {
      toast.error("Informe o motivo da rejeição");
      return;
    }

    setIsSubmitting(true);
    try {
      await transactionService.rejectByToken(token, "magic-link", rejectReason);
      toast.success("Transação rejeitada");
      setStatus("rejected");
    } catch (error: unknown) {
      console.error("Rejection error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Erro ao rejeitar transação";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
      setShowRejectDialog(false);
    }
  };

  if (status === "success") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-linear-to-br from-emerald-50 to-green-50 p-4">
        <Card className="w-full max-w-md text-center border-emerald-200 shadow-xl">
          <CardHeader>
            <div className="mx-auto bg-emerald-100 p-4 rounded-full w-fit mb-4">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl text-emerald-700">
              Aprovação Confirmada!
            </CardTitle>
            <CardDescription className="text-base">
              A transação foi aprovada com sucesso e está pronta para pagamento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {transaction && (
              <div className="bg-emerald-50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Transação</p>
                <p className="font-semibold text-emerald-900">
                  {transaction.description}
                </p>
                <p className="text-2xl font-bold text-emerald-700 mt-2">
                  {formatCurrency(getAdjustedAmount())}
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-center">
            <Button
              onClick={() => router.push("/login")}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Acessar o Sistema
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-linear-to-br from-red-50 to-orange-50 p-4">
        <Card className="w-full max-w-md text-center border-red-200 shadow-xl">
          <CardHeader>
            <div className="mx-auto bg-red-100 p-4 rounded-full w-fit mb-4">
              <XCircle className="h-12 w-12 text-red-600" />
            </div>
            <CardTitle className="text-2xl text-red-700">
              Transação Rejeitada
            </CardTitle>
            <CardDescription className="text-base">
              A transação foi rejeitada e retornará ao solicitante.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push("/login")} variant="outline">
              Acessar o Sistema
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-linear-to-br from-red-50 to-orange-50 p-4">
        <Card className="w-full max-w-md text-center border-red-200 shadow-xl">
          <CardHeader>
            <div className="mx-auto bg-red-100 p-4 rounded-full w-fit mb-4">
              <XCircle className="h-12 w-12 text-red-600" />
            </div>
            <CardTitle className="text-2xl text-red-700">Erro</CardTitle>
            <CardDescription className="text-base">
              {errorMessage}
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" onClick={() => router.push("/login")}>
              Voltar
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (status === "loading" || !transaction) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  const adjustedAmount = getAdjustedAmount();
  const isNew = isNewTransaction();

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50 p-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="shadow-lg border-t-4 border-t-blue-500">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl mb-2">
                  Solicitação de Aprovação
                </CardTitle>
                <CardDescription className="text-base">
                  Revise os detalhes da transação e aprove ou rejeite conforme
                  necessário.
                </CardDescription>
              </div>
              <Badge
                variant={isNew ? "default" : "secondary"}
                className="text-sm"
              >
                {isNew ? "Nova" : "Em Análise"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Detalhes da Transação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-muted-foreground text-sm flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4" />
                Descrição
              </Label>
              <p className="text-lg font-semibold">{transaction.description}</p>
            </div>

            <div>
              <Label className="text-muted-foreground text-sm mb-2 flex items-center justify-between">
                <span>Valor</span>
                {!isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStartEdit}
                    className="h-8 text-blue-600 hover:text-blue-700"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    Ajustar
                  </Button>
                )}
              </Label>
              {isEditing ? (
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.01"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="text-lg font-bold"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-blue-600">
                    {formatCurrency(adjustedAmount)}
                  </p>
                  {hasAmountChange() && (
                    <p className="text-sm text-muted-foreground">
                      Original:{" "}
                      <span className="line-through">
                        {formatCurrency(transaction.amount)}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <Label className="text-muted-foreground text-sm flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4" />
                Data de Vencimento
              </Label>
              <p className="font-medium">
                {format(transaction.dueDate, "dd 'de' MMMM 'de' yyyy", {
                  locale: ptBR,
                })}
              </p>
            </div>

            {costCenter && (
              <div>
                <Label className="text-muted-foreground text-sm flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4" />
                  Centro de Custo
                </Label>
                <p className="font-medium">{costCenter.name}</p>
                {costCenter.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {costCenter.description}
                  </p>
                )}
              </div>
            )}

            {transaction.requestOrigin && (
              <div>
                <Label className="text-muted-foreground text-sm flex items-center gap-2 mb-2">
                  <User className="h-4 w-4" />
                  Solicitante
                </Label>
                <p className="font-medium">{transaction.requestOrigin.name}</p>
              </div>
            )}

            <div>
              <Label htmlFor="comment" className="text-sm mb-2">
                Comentário (opcional)
              </Label>
              <Textarea
                id="comment"
                placeholder="Adicione um comentário sobre esta aprovação..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardFooter className="flex flex-col sm:flex-row gap-3 pt-6">
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(true)}
              disabled={isSubmitting}
              className="w-full sm:w-auto border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Rejeitar
            </Button>
            <Button
              onClick={handleApprove}
              disabled={isSubmitting || isEditing}
              className="w-full sm:flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Aprovar Transação
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar Transação</AlertDialogTitle>
            <AlertDialogDescription>
              Informe o motivo da rejeição. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Motivo da rejeição..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!rejectReason.trim() || isSubmitting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejeitando...
                </>
              ) : (
                "Confirmar Rejeição"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
