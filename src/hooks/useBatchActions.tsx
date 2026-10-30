"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  BatchActor,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { notificationService } from "@/lib/services/notificationService";
import { emailService } from "@/lib/services/emailService";
import { PaymentBatch } from "@/lib/types";
import { formatCurrency, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import {
  ActionKind,
  NextStep,
  StepContext,
  dueUrgency,
  errorMessage,
  sumOf,
} from "@/components/features/finance/batchWorkflow";

/** Tudo que mostra lotes: lista, detalhe, contagens das abas. */
export const invalidateBatchQueries = (qc: QueryClient) =>
  Promise.all(
    [
      "payment-batches-active",
      "payment-batches",
      "payment-batches-summary",
      "payment-batch",
    ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
  );

type SendKind = "send_approval" | "send_authorization";

/**
 * Ações de fluxo do lote (enviar, autorizar, confirmar, recolher, renomear,
 * excluir, reverter) com seus diálogos. Lista e detalhe usam as mesmas.
 */
export function useBatchActions({
  onApprove,
  onDeleted,
  onSent,
}: {
  /** Aprovar acontece na página do lote, com ajustes por transação. */
  onApprove: (batch: PaymentBatch) => void;
  onDeleted?: (batch: PaymentBatch) => void;
  /** Recebe os lotes que falharam, para manter selecionados. */
  onSent?: (failedIds: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageBatches, canApproveBatches, canPayBatches } =
    usePermissions();

  const actor: BatchActor | null = user
    ? { uid: user.uid, email: user.email ?? "" }
    : null;
  const ctx: StepContext = {
    actor,
    canManage: canManageBatches,
    canApprove: canApproveBatches,
    canPay: canPayBatches,
  };

  const [sendKind, setSendKind] = useState<SendKind | null>(null);
  const [actionBatches, setActionBatches] = useState<PaymentBatch[]>([]);
  const [confirmStep, setConfirmStep] = useState<{
    kind: "authorize" | "confirm_payment";
    batch: PaymentBatch;
  } | null>(null);
  const [editingBatch, setEditingBatch] = useState<PaymentBatch | null>(null);
  const [editingBatchName, setEditingBatchName] = useState("");
  const [deleteBatch, setDeleteBatch] = useState<PaymentBatch | null>(null);
  const [recallBatch, setRecallBatch] = useState<PaymentBatch | null>(null);
  const [revertBatch, setRevertBatch] = useState<PaymentBatch | null>(null);
  const [revertReason, setRevertReason] = useState("");

  const refresh = () => invalidateBatchQueries(queryClient);

  const openSend = (batches: PaymentBatch[], kind: SendKind) => {
    setActionBatches(batches);
    setSendKind(kind);
  };

  const runAction = (batch: PaymentBatch, kind: ActionKind) => {
    if (kind === "approve") onApprove(batch);
    else if (kind === "send_approval" || kind === "send_authorization")
      openSend([batch], kind);
    else setConfirmStep({ kind, batch });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSend = async (_userId: string, email: string, name: string) => {
    if (!actionBatches.length || !actor || !user || !sendKind) return;
    const forApproval = sendKind === "send_approval";
    const recipient = { email, name: name !== email ? name : undefined };
    const send = forApproval
      ? emailService.sendBatchApprovalRequest
      : emailService.sendBatchAuthorizationRequest;

    // Um link por lote: cada um é aprovado (ou devolvido) separadamente
    const results = await Promise.allSettled(
      actionBatches.map(async (batch) => {
        const token = forApproval
          ? await paymentBatchService.sendForApproval(
              batch.id,
              recipient,
              actor,
            )
          : await paymentBatchService.sendForAuthorization(
              batch.id,
              recipient,
              actor,
            );
        // Contexto é enfeite do e-mail: se falhar, o link ainda vai
        const context = forApproval
          ? await paymentBatchService
              .approvalEmailContext(batch.id)
              .catch(() => ({}))
          : {};
        await send(
          batch.name,
          batch.id,
          token,
          batch.transactionIds.length,
          batch.totalAmount,
          user.displayName,
          email,
          { companyName: selectedCompany?.name, ...context },
        );
      }),
    );
    const failed = actionBatches.filter(
      (_, i) => results[i].status === "rejected",
    );
    onSent?.(failed.map((b) => b.id));
    refresh();

    if (failed.length === actionBatches.length) {
      const reason = (
        results.find((r) => r.status === "rejected") as PromiseRejectedResult
      ).reason;
      console.error("Error sending batch:", reason);
      toast.error(
        errorMessage(
          reason,
          forApproval
            ? "Erro ao enviar para aprovação"
            : "Erro ao enviar para autorização",
        ),
      );
      throw reason;
    }
    const sent = actionBatches.length - failed.length;
    if (failed.length > 0) {
      toast.warning(
        `${plural(sent, "lote enviado", "lotes enviados")}. Não foi possível enviar: ${failed.map((b) => b.name).join(", ")}.`,
      );
    } else if (sent === 1) {
      toast.success(`Link enviado para ${name || email}. Vale por 48 horas.`);
    } else {
      toast.success(
        `${plural(sent, "lote enviado", "lotes enviados")} para ${name || email}. Cada link vale por 48 horas.`,
      );
    }
  };

  const handleConfirmStep = async () => {
    if (!confirmStep || !actor || !user || !selectedCompany) return;
    const { kind, batch } = confirmStep;
    try {
      if (kind === "authorize") {
        await paymentBatchService.confirmAuthorization(batch.id, actor);
        toast.success(
          `Lote autorizado: ${plural(batch.transactionIds.length, "transação", "transações")} · ${formatCurrency(batch.totalAmount)}`,
        );
        // Quem criou o lote e o autorizou não precisa de aviso do próprio ato.
        if (batch.createdBy !== user.uid)
          notificationService
            .notifyBatchAuthorized(
              batch.createdBy,
              batch.name,
              batch.id,
              user.displayName,
              selectedCompany.id,
            )
            .catch((e) => console.error("Error notifying authorization:", e));
      } else {
        const result = await paymentBatchService.confirmPayments(
          batch.id,
          actor,
        );
        toast.success(
          `${plural(result.count, "transação marcada", "transações marcadas")} como paga${result.count === 1 ? "" : "s"} · ${formatCurrency(result.total)}`,
        );
      }
      setConfirmStep(null);
      refresh();
    } catch (error) {
      console.error("Error confirming step:", error);
      toast.error(
        errorMessage(
          error,
          kind === "authorize"
            ? "Erro ao autorizar lote"
            : "Erro ao confirmar pagamentos",
        ),
      );
      throw error;
    }
  };

  const handleUpdateBatch = async () => {
    if (!editingBatch || !editingBatchName.trim()) return;
    try {
      await paymentBatchService.update(editingBatch.id, {
        name: editingBatchName.trim(),
      });
      toast.success("Lote renomeado");
      setEditingBatch(null);
      refresh();
    } catch (error) {
      console.error("Error updating batch:", error);
      toast.error(errorMessage(error, "Erro ao renomear lote"));
    }
  };

  const handleDeleteBatch = async () => {
    if (!deleteBatch || !actor) return;
    try {
      await paymentBatchService.delete(deleteBatch.id, actor);
      toast.success(`Lote "${deleteBatch.name}" excluído`);
      onDeleted?.(deleteBatch);
      setDeleteBatch(null);
      refresh();
    } catch (error) {
      console.error("Error deleting batch:", error);
      toast.error(errorMessage(error, "Erro ao excluir lote"));
      throw error;
    }
  };

  const handleRecall = async () => {
    if (!recallBatch || !actor) return;
    try {
      await paymentBatchService.recall(recallBatch.id, actor);
      toast.success(`Envio de "${recallBatch.name}" recolhido`);
      setRecallBatch(null);
      refresh();
    } catch (error) {
      console.error("Error recalling batch:", error);
      toast.error(errorMessage(error, "Erro ao recolher envio"));
      throw error;
    }
  };

  const handleRevertToOpen = async () => {
    if (!revertBatch || !actor) return;
    try {
      await paymentBatchService.revertToOpen(
        revertBatch.id,
        actor,
        revertReason,
      );
      toast.success(`Lote "${revertBatch.name}" voltou para Aberto`);
      setRevertBatch(null);
      setRevertReason("");
      refresh();
    } catch (error) {
      console.error("Error reverting batch:", error);
      toast.error(errorMessage(error, "Erro ao reverter lote"));
      throw error;
    }
  };

  // ── Peças ────────────────────────────────────────────────────────────────

  const renderAction = (
    batch: PaymentBatch,
    step: NextStep | null,
    size: "sm" | "default" = "sm",
  ) =>
    step?.action && (
      <Button
        size={size}
        variant={
          step.action.kind === "confirm_payment" ||
          step.action.kind === "authorize"
            ? "default"
            : "outline"
        }
        className={size === "sm" ? "h-8 whitespace-nowrap text-xs" : undefined}
        onClick={() => runAction(batch, step.action!.kind)}
      >
        {step.action.label}
      </Button>
    );

  const renderMenu = (batch: PaymentBatch, extra?: ReactNode) =>
    (canManageBatches || extra) && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label={`Ações do lote ${batch.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {extra}
          {canManageBatches && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  setEditingBatch(batch);
                  setEditingBatchName(batch.name);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" /> Renomear
              </DropdownMenuItem>
              {(batch.status === "pending_approval" ||
                batch.status === "pending_authorization") && (
                <DropdownMenuItem onClick={() => setRecallBatch(batch)}>
                  <Undo2 className="mr-2 h-4 w-4" /> Recolher envio
                </DropdownMenuItem>
              )}
              {batch.status === "paid" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setRevertBatch(batch)}
                  >
                    <Undo2 className="mr-2 h-4 w-4" /> Reverter para Aberto
                  </DropdownMenuItem>
                </>
              )}
              {batch.status === "open" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteBatch(batch)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir lote
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const sendTotal = sumOf(actionBatches);
  const overdueToSend = actionBatches.filter(
    (b) => dueUrgency(b)?.tone === "late",
  ).length;
  const forAuthorization = sendKind === "send_authorization";
  const sendDescription = [
    actionBatches.length === 1
      ? `${actionBatches[0].name}:`
      : `${plural(actionBatches.length, "lote", "lotes")}, ${formatCurrency(sendTotal.total)}.`,
    `O ${forAuthorization ? "autorizador" : "aprovador"} recebe ${actionBatches.length === 1 ? "um link" : "um link por lote"} que vale por 48 horas e não precisa ter conta no sistema.`,
    `Você não pode ${forAuthorization ? "autorizar" : "aprovar"} um lote que enviou.`,
    overdueToSend > 0 &&
      (actionBatches.length === 1
        ? "Este lote já tem contas vencidas."
        : `${plural(overdueToSend, "lote já tem", "lotes já têm")} contas vencidas.`),
  ]
    .filter(Boolean)
    .join(" ");

  const approvedBy = (b: PaymentBatch) =>
    b.approvedAt &&
    `Aprovado${b.approverName || b.approverEmail ? ` por ${b.approverName || b.approverEmail}` : ""} em ${format(b.approvedAt, "dd/MM/yyyy 'às' HH:mm")}.`;

  const dialogs = (
    <>
      <ResponsiveModal
        open={!!editingBatch}
        onOpenChange={(open) => !open && setEditingBatch(null)}
      >
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Renomear lote</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={editingBatchName}
              onChange={(e) => setEditingBatchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdateBatch()}
            />
          </div>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setEditingBatch(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleUpdateBatch}
              disabled={!editingBatchName.trim()}
            >
              Salvar
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {selectedCompany && (
        <BatchSendDialog
          isOpen={!!sendKind}
          onClose={() => {
            setSendKind(null);
            setActionBatches([]);
          }}
          onSend={handleSend}
          companyId={selectedCompany.id}
          title={
            forAuthorization
              ? "Enviar para autorização"
              : "Enviar para aprovação"
          }
          description={sendDescription}
          buttonText={
            actionBatches.length > 1
              ? `Enviar ${actionBatches.length} links`
              : "Enviar link"
          }
        />
      )}

      <ConfirmDialog
        open={!!confirmStep}
        onOpenChange={(open) => !open && setConfirmStep(null)}
        title={
          confirmStep?.kind === "authorize"
            ? `Autorizar "${confirmStep.batch.name}"?`
            : `Confirmar pagamento de "${confirmStep?.batch.name ?? ""}"?`
        }
        description={
          confirmStep
            ? confirmStep.kind === "authorize"
              ? [
                  `${plural(confirmStep.batch.transactionIds.length, "transação", "transações")}, total de ${formatCurrency(confirmStep.batch.totalAmount)}.`,
                  approvedBy(confirmStep.batch),
                  "Autorize só depois de liberar o lote no internet banking.",
                ]
                  .filter(Boolean)
                  .join(" ")
              : `${plural(confirmStep.batch.transactionIds.length, "transação será marcada", "transações serão marcadas")} como paga${confirmStep.batch.transactionIds.length === 1 ? "" : "s"}, total de ${formatCurrency(confirmStep.batch.totalAmount)}. Confirme só depois de conferir o débito no extrato.`
            : ""
        }
        confirmText={
          confirmStep?.kind === "authorize"
            ? "Autorizar"
            : "Confirmar pagamento"
        }
        onConfirm={handleConfirmStep}
      />

      <ConfirmDialog
        open={!!recallBatch}
        onOpenChange={(open) => !open && setRecallBatch(null)}
        title={`Recolher envio de "${recallBatch?.name ?? ""}"?`}
        description={`O link enviado deixa de valer e o lote volta para ${recallBatch?.status === "pending_authorization" ? "Aprovado" : "Aberto"}. Você pode enviar de novo depois.`}
        confirmText="Recolher envio"
        onConfirm={handleRecall}
      />

      <ConfirmDialog
        open={!!deleteBatch}
        onOpenChange={(open) => !open && setDeleteBatch(null)}
        title={`Excluir "${deleteBatch?.name ?? ""}"?`}
        description="As transações do lote voltam a ficar sem lote. Nenhuma conta é excluída."
        confirmText="Excluir lote"
        variant="destructive"
        onConfirm={handleDeleteBatch}
      />

      <ConfirmDialog
        open={!!revertBatch}
        onOpenChange={(open) => {
          if (!open) {
            setRevertBatch(null);
            setRevertReason("");
          }
        }}
        title={`Reverter "${revertBatch?.name ?? ""}" para Aberto?`}
        description="O lote volta para Aberto e as transações voltam para Rascunho. Use só se o pagamento foi confirmado por engano. O motivo fica registrado na auditoria."
        confirmText="Reverter lote"
        variant="destructive"
        confirmDisabled={!revertReason.trim()}
        onConfirm={handleRevertToOpen}
      >
        <div className="space-y-2">
          <Label htmlFor="revert-reason">Motivo</Label>
          <Textarea
            id="revert-reason"
            value={revertReason}
            onChange={(e) => setRevertReason(e.target.value)}
            placeholder="Ex.: pagamento confirmado no lote errado"
            className="min-h-[72px]"
          />
        </div>
      </ConfirmDialog>
    </>
  );

  return { ctx, actor, refresh, openSend, renderAction, renderMenu, dialogs };
}
