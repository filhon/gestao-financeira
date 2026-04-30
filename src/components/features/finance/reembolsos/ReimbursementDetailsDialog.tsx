"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { reimbursementReportService } from "@/lib/services/reimbursementReportService";
import { emailService } from "@/lib/services/emailService";
import { transactionService } from "@/lib/services/transactionService";
import { ReimbursementReport, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  DollarSign,
  Loader2,
  Undo2,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ReimbursementDetailsDialogProps {
  report: ReimbursementReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className: string;
  }
> = {
  draft: {
    label: "Rascunho",
    variant: "secondary",
    className: "bg-slate-100 text-slate-700",
  },
  pending_approval: {
    label: "Aguardando Aprovação",
    variant: "outline",
    className: "border-amber-400 text-amber-700 bg-amber-50",
  },
  approved: {
    label: "Aprovado",
    variant: "default",
    className: "bg-green-100 text-green-800 border-green-300",
  },
  paid: {
    label: "Pago",
    variant: "default",
    className: "bg-blue-100 text-blue-800 border-blue-300",
  },
  rejected: {
    label: "Rejeitado",
    variant: "destructive",
    className: "bg-red-100 text-red-800 border-red-300",
  },
};

const TX_STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  approved: "Aprovado",
  pending_approval: "Pend. Aprov.",
  pending_authorization: "Pend. Autor.",
  authorized: "Autorizado",
  draft: "Rascunho",
  rejected: "Rejeitado",
};

export function ReimbursementDetailsDialog({
  report,
  open,
  onOpenChange,
  onUpdated,
}: ReimbursementDetailsDialogProps) {
  const { user } = useAuth();
  const { canApprovePayables, isAdmin, isFinancialManager } = usePermissions();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [showTx, setShowTx] = useState(false);

  // Action states
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [approverEmail, setApproverEmail] = useState(
    report?.approverEmail ?? "",
  );
  const [showApproverInput, setShowApproverInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPaidConfirm, setShowPaidConfirm] = useState(false);

  const canManage = isAdmin || isFinancialManager;

  useEffect(() => {
    if (report) {
      setApproverEmail(report.approverEmail ?? "");
      setShowApproverInput(false);
      setShowRejectInput(false);
      setRejectReason("");
      setShowTx(false);
    }
  }, [report]);

  useEffect(() => {
    if (!open || !report || !showTx) return;
    setLoadingTx(true);
    transactionService
      .getByIds(report.transactionIds)
      .then(setTransactions)
      .finally(() => setLoadingTx(false));
  }, [open, report, showTx]);

  if (!report) return null;

  const statusConfig = STATUS_CONFIG[report.status] ?? STATUS_CONFIG.draft;

  const handleSendForApproval = async () => {
    if (!approverEmail || !approverEmail.includes("@")) {
      toast.error("Informe um e-mail válido para o aprovador.");
      return;
    }
    setIsActionLoading(true);
    try {
      await reimbursementReportService.sendForApproval(
        report.id,
        approverEmail,
      );
      // Refresh report to get the token
      const updated = await reimbursementReportService.getById(report.id);
      if (updated && user) {
        await emailService.sendReimbursementApprovalRequest(
          updated,
          approverEmail,
          user.displayName || user.email || "Sistema",
        );
      }
      toast.success("Relatório enviado para aprovação!");
      setShowApproverInput(false);
      onUpdated();
    } catch {
      toast.error("Erro ao enviar para aprovação.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!user) return;
    setIsActionLoading(true);
    try {
      await reimbursementReportService.approve(report.id, user.uid);
      // Send confirmation email if employee has email
      if (report.employeeEmail) {
        await emailService.sendReimbursementApproved(
          { ...report, status: "approved" },
          report.employeeEmail,
          user.displayName || user.email || "Aprovador",
        );
      }
      toast.success("Relatório aprovado com sucesso!");
      onUpdated();
    } catch {
      toast.error("Erro ao aprovar o relatório.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!user || rejectReason.trim().length < 3) return;
    setIsActionLoading(true);
    try {
      await reimbursementReportService.reject(
        report.id,
        user.uid,
        rejectReason.trim(),
      );
      toast.success("Relatório rejeitado.");
      setShowRejectInput(false);
      onUpdated();
    } catch {
      toast.error("Erro ao rejeitar o relatório.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!user) return;
    setIsActionLoading(true);
    try {
      await reimbursementReportService.markAsPaid(report.id, user.uid);
      toast.success("Reembolso marcado como pago!");
      setShowPaidConfirm(false);
      onUpdated();
    } catch {
      toast.error("Erro ao marcar como pago.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRevert = async () => {
    setIsActionLoading(true);
    try {
      await reimbursementReportService.revertToDraft(report.id);
      toast.success("Relatório revertido para rascunho.");
      onUpdated();
    } catch {
      toast.error("Erro ao reverter o relatório.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsActionLoading(true);
    try {
      await reimbursementReportService.delete(report.id);
      toast.success("Relatório excluído.");
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onUpdated();
    } catch {
      toast.error("Erro ao excluir o relatório.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!transactions.length) {
      // Load transactions first if not loaded
      const txs = await transactionService.getByIds(report.transactionIds);
      setTransactions(txs);
      // We need employee entity and company here — simplified version uses what we have
      toast.info("Preparando PDF...");
    }
    // This is triggered from the page which has full context
    // Emit an event for the page to handle
    window.dispatchEvent(
      new CustomEvent("rd:download-pdf", { detail: { reportId: report.id } }),
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">
                  Relatório de Despesas
                </p>
                <DialogTitle className="text-2xl font-bold">
                  {report.rdNumber}
                </DialogTitle>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs px-2.5 py-1 mt-1",
                  statusConfig.className,
                )}
              >
                {statusConfig.label}
              </Badge>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Funcionário
                </p>
                <p className="font-semibold text-sm">{report.employeeName}</p>
                {report.employeeDocument && (
                  <p className="text-xs text-slate-400">
                    CPF: {report.employeeDocument}
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Período
                </p>
                <p className="font-semibold text-sm">
                  {format(report.periodStart, "dd/MM/yyyy", { locale: ptBR })} —{" "}
                  {format(report.periodEnd, "dd/MM/yyyy", { locale: ptBR })}
                </p>
                <p className="text-xs text-slate-400">
                  {report.transactionIds.length} lançamento(s)
                </p>
              </div>
            </div>

            {/* Total highlight */}
            <div className="flex items-center justify-between rounded-lg bg-slate-900 px-5 py-4">
              <span className="text-slate-400 text-sm font-medium uppercase tracking-wide">
                Total do Reembolso
              </span>
              <span className="text-green-400 font-bold text-xl">
                {formatCurrency(report.totalAmount)}
              </span>
            </div>

            {/* Rejection reason */}
            {report.status === "rejected" && report.rejectionReason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs text-red-600 font-medium uppercase tracking-wide mb-1">
                  Motivo da Rejeição
                </p>
                <p className="text-sm text-red-800">{report.rejectionReason}</p>
                {report.rejectedAt && (
                  <p className="text-xs text-red-400 mt-1">
                    em{" "}
                    {format(report.rejectedAt, "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Approval info */}
            {report.status === "approved" && report.approvedAt && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-1">
                  Aprovado
                </p>
                <p className="text-xs text-green-700">
                  em{" "}
                  {format(report.approvedAt, "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            )}

            {/* Paid info */}
            {report.status === "paid" && report.paidAt && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">
                  Pago
                </p>
                <p className="text-xs text-blue-700">
                  em{" "}
                  {format(report.paidAt, "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            )}

            {/* Notes */}
            {report.notes && (
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Observações
                </p>
                <p className="text-sm text-slate-700">{report.notes}</p>
              </div>
            )}

            {/* Transactions accordion */}
            <button
              type="button"
              onClick={() => setShowTx((v) => !v)}
              className="flex items-center justify-between w-full text-left rounded-lg border px-4 py-2.5 hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium">
                Ver lançamentos ({report.transactionIds.length})
              </span>
              {showTx ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>

            {showTx && (
              <div className="rounded-lg border overflow-hidden">
                {loadingTx ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Carregando...</span>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">
                          Data
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">
                          Descrição
                        </th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600">
                          Status
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t, i) => {
                        const amt =
                          t.status === "paid" && t.finalAmount
                            ? t.finalAmount
                            : t.amount;
                        return (
                          <tr
                            key={t.id}
                            className={cn(
                              "border-b last:border-b-0",
                              i % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                            )}
                          >
                            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                              {format(t.dueDate, "dd/MM/yy")}
                            </td>
                            <td className="px-3 py-2 text-xs max-w-[200px] truncate">
                              {t.description}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-xs text-slate-500">
                                {TX_STATUS_LABEL[t.status] || t.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-xs whitespace-nowrap">
                              {formatCurrency(amt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Action area ─────────────────────────────────────────────── */}
            <div className="border-t pt-4 space-y-3">
              {/* Send for approval */}
              {report.status === "draft" && canManage && (
                <>
                  {!showApproverInput ? (
                    <Button
                      className="w-full"
                      onClick={() => setShowApproverInput(true)}
                      disabled={isActionLoading}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Enviar para Aprovação
                    </Button>
                  ) : (
                    <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
                      <Label className="text-sm">E-mail do Aprovador</Label>
                      <Input
                        type="email"
                        placeholder="aprovador@empresa.com"
                        value={approverEmail}
                        onChange={(e) => setApproverEmail(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleSendForApproval}
                          loading={isActionLoading}
                          disabled={!approverEmail.includes("@")}
                        >
                          Confirmar Envio
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowApproverInput(false)}
                          disabled={isActionLoading}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Approve / Reject (for pending_approval, admins/approvers) */}
              {report.status === "pending_approval" &&
                (canApprovePayables || isAdmin || isFinancialManager) && (
                  <>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={handleApprove}
                        loading={isActionLoading}
                        disabled={showRejectInput}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Aprovar
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => setShowRejectInput(true)}
                        disabled={isActionLoading}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Rejeitar
                      </Button>
                    </div>
                    {showRejectInput && (
                      <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                        <Label className="text-sm text-red-700">
                          Motivo da Rejeição
                        </Label>
                        <Textarea
                          placeholder="Descreva o motivo..."
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          rows={2}
                          className="border-red-200"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleReject}
                            loading={isActionLoading}
                            disabled={rejectReason.trim().length < 3}
                          >
                            Confirmar Rejeição
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowRejectInput(false)}
                            disabled={isActionLoading}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}

              {/* Mark as paid */}
              {report.status === "approved" && canManage && (
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={() => setShowPaidConfirm(true)}
                  disabled={isActionLoading}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Marcar como Pago
                </Button>
              )}

              {/* Revert to draft */}
              {report.status === "pending_approval" && canManage && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleRevert}
                  loading={isActionLoading}
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Reverter para Rascunho
                </Button>
              )}

              {/* Download PDF — handled by parent via event */}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDownloadPDF}
                disabled={isActionLoading}
              >
                <FileText className="h-4 w-4 mr-2" />
                Baixar PDF
              </Button>

              {/* Delete (draft only) */}
              {report.status === "draft" && canManage && (
                <Button
                  variant="ghost"
                  className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isActionLoading}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir Relatório
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark as paid confirm */}
      <AlertDialog open={showPaidConfirm} onOpenChange={setShowPaidConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Pagamento</AlertDialogTitle>
            <AlertDialogDescription>
              Confirma que o reembolso <strong>{report.rdNumber}</strong> de{" "}
              <strong>{formatCurrency(report.totalAmount)}</strong> para{" "}
              <strong>{report.employeeName}</strong> foi pago?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkPaid}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isActionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Confirmar Pagamento"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Relatório</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o relatório{" "}
              <strong>{report.rdNumber}</strong>? Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {isActionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Excluir"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
