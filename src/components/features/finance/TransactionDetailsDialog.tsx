"use client";

import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import {
  Transaction,
  TransactionStatus,
  CostCenter,
  Entity,
} from "@/lib/types";
import { format } from "date-fns";

import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { transactionService } from "@/lib/services/transactionService";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { emailService } from "@/lib/services/emailService";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Banknote,
  Send,
  Edit2,
  Copy,
  Barcode,
  MessageCircle,
  FileCheck,
  FileText,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Lock,
  Handshake,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  isOpen as isOpenTx,
  isOverdue,
  lateCharges,
  lateFeeRule,
} from "@/lib/transactionTabs";
import { PaymentDialog, type PaymentConfirmation } from "./PaymentDialog";
import { StatusBadge } from "./TransactionList";
import { DocumentPreview } from "./DocumentPreview";
import { cn, formatCurrency, comprovanteProxyUrl } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { db } from "@/lib/firebase/client";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { toast } from "sonner";
import { TransactionForm } from "./TransactionForm";
import { TransactionFormData } from "@/lib/validations/transaction";
import { RecurrenceUpdateDialog } from "./RecurrenceUpdateDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import {
  PAYMENT_METHOD_LABELS,
  PIX_KEY_TYPE_LABELS,
} from "@/components/features/entities/entityDisplay";

const REQUEST_ORIGIN_LABELS = {
  director: "Diretoria",
  department: "Departamento",
  sector: "Setor",
} as const;

/** Documento que a folha lateral sabe exibir. */
interface ViewableDoc {
  key: string;
  name: string;
  /** URL servida inline (iframe/img). */
  url: string;
  /** URL que força o download, quando difere da inline. */
  downloadUrl?: string;
  type?: string;
  isReceipt?: boolean;
}

const sectionTitle = "mb-2 text-sm font-medium";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success(`${label} copiado`);
      }}
      className="shrink-0 rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`Copiar ${label.toLowerCase()}`}
      aria-label={`Copiar ${label.toLowerCase()}`}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

interface TransactionDetailsDialogProps {
  transaction: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedTransaction?: Transaction) => void;
  costCenters?: CostCenter[];
  /** Anterior (-1) / próxima (1) conta da lista. */
  onNavigate?: (delta: number) => void;
  /** Já abre com o formulário de bloqueio ou de promessa expandido. */
  focusAction?: "hold" | "promise" | null;
  /** Atraso médio do cliente (contas a receber). */
  punctuality?: { avgDays: number; count: number };
}

/**
 * Detalhe da conta, sempre como painel lateral (bottom sheet no celular), para
 * a lista de onde veio continuar visível. Anexos abrem numa segunda folha à
 * esquerda do painel, sem sair da página.
 */
export function TransactionDetailsDialog({
  transaction: propTransaction,
  isOpen,
  onClose,
  onUpdate,
  costCenters = [],
  onNavigate,
  focusAction = null,
  punctuality,
}: TransactionDetailsDialogProps) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const {
    canEditPayables,
    canApprovePayables,
    canPayPayables,
    canEditReceivables,
    canViewReconciliation,
    canViewAuditLogs,
  } = usePermissions();

  const [holdReason, setHoldReason] = useState("");
  const [showHoldForm, setShowHoldForm] = useState(false);
  const [promiseDate, setPromiseDate] = useState("");
  const [promiseNote, setPromiseNote] = useState("");
  const [showPromiseForm, setShowPromiseForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [isSavingAction, setIsSavingAction] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Cache the transaction synchronously to avoid sudden unmounts of references during Radix animations,
  // which causes the "Maximum update depth exceeded" infinite loop in `usePresence`.
  // If we used useEffect for this, the state update would happen AFTER the mount, causing a violent
  // DOM swap *during* the enter animation. This approach guarantees instant stability.
  const cachedTransactionRef = useRef<Transaction | null>(null);
  if (isOpen && propTransaction) {
    cachedTransactionRef.current = propTransaction;
  }
  const transaction = isOpen ? propTransaction : cachedTransactionRef.current;

  const { accounts } = useChartOfAccounts(
    isOpen ? transaction?.companyId : undefined,
  );
  const account = transaction?.accountId
    ? accounts.find((a) => a.id === transaction.accountId)
    : undefined;
  const { accounts: bankAccounts } = useBankAccounts(
    isOpen && canViewReconciliation ? transaction?.companyId : undefined,
  );
  const bankAccount = transaction?.bankAccountId
    ? bankAccounts.find((a) => a.id === transaction.bankAccountId)
    : undefined;

  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isRecurrenceUpdateDialogOpen, setIsRecurrenceUpdateDialogOpen] =
    useState(false);
  const [pendingUpdateData, setPendingUpdateData] =
    useState<TransactionFormData | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [comprovante, setComprovante] = useState<{
    url: string;
    inlineUrl: string;
    name: string;
  } | null>(null);
  const [fetchedEntity, setEntity] = useState<Entity | null>(null);
  // Ignore a previous transaction's entity until the new one loads.
  const entity =
    fetchedEntity && fetchedEntity.id === transaction?.entityId
      ? fetchedEntity
      : null;

  // Bank/PIX details live on the entity, not on the transaction — read them fresh on open.
  useEffect(() => {
    const entityId = transaction?.entityId;
    const companyId = transaction?.companyId;
    if (!isOpen || !entityId) return;
    let cancelled = false;
    getDoc(doc(db, "entities", entityId))
      .then((snap) => {
        if (cancelled || !snap.exists() || snap.data().companyId !== companyId)
          return;
        setEntity({ id: snap.id, ...snap.data() } as Entity);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, transaction?.entityId, transaction?.companyId]);

  // Reset edit mode when dialog closes, but delayed to allow exit animations to complete cleanly
  // without mutating the DOM mid-animation. This prevents Radix safelyDetachRef crashes.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setIsEditing(false);
        setPendingUpdateData(null);
        setIsRecurrenceUpdateDialogOpen(false);
        setComprovante(null);
        setPreviewIndex(null);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Fetch comprovante from Firestore when dialog opens — the transaction prop may be stale
  // (e.g. confirmed on the /comprovantes page but list cache not yet refreshed)
  useEffect(() => {
    if (!isOpen || !transaction) return;
    setComprovante(null);
    // Prefer storagePath (proxy) over legacy public URL
    if (transaction.comprovanteStoragePath) {
      const path = transaction.comprovanteStoragePath;
      setComprovante({
        url: comprovanteProxyUrl(path),
        inlineUrl: comprovanteProxyUrl(path, "inline"),
        name: path,
      });
      return;
    }
    if (transaction.comprovanteUrl) {
      // Legacy: existing records that still have the public URL
      setComprovante({
        url: transaction.comprovanteUrl,
        inlineUrl: transaction.comprovanteUrl,
        name: "comprovante",
      });
      return;
    }
    if (
      transaction.type !== "payable" ||
      (transaction.status !== "paid" && transaction.status !== "authorized")
    )
      return;
    comprovanteService
      .getByTransactionId(transaction.companyId, transaction.id)
      .then((c) => {
        if (c?.matchStatus === "matched") {
          setComprovante({
            url: comprovanteProxyUrl(c.storagePath),
            inlineUrl: comprovanteProxyUrl(c.storagePath, "inline"),
            name: c.storagePath,
          });
        }
      })
      .catch(() => {});
  }, [isOpen, transaction]);

  // Resolve cost center names from prop — zero extra DB reads and perfectly synchronous
  const costCenterNames = useMemo(() => {
    const names: Record<string, string> = {};
    if (!transaction?.costCenterAllocation) return names;
    for (const alloc of transaction.costCenterAllocation) {
      const cc = costCenters.find((c) => c.id === alloc.costCenterId);
      if (cc) names[alloc.costCenterId] = cc.name;
    }
    return names;
  }, [transaction?.costCenterAllocation, costCenters]);

  // Fetch user names (creator/approver/releaser/rejecter) in a single batched query
  useEffect(() => {
    const fetchUserNames = async () => {
      if (!transaction) return;
      const userIds = [
        transaction.createdBy,
        transaction.approvedBy,
        transaction.releasedBy,
        transaction.rejectedBy,
      ].filter((id): id is string => Boolean(id) && id !== "magic-link");
      if (userIds.length === 0) return;
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("__name__", "in", userIds)),
        );
        const names: Record<string, string> = {};
        snap.forEach((d) => {
          names[d.id] = d.data().displayName || d.data().email || d.id;
        });
        setUserNames(names);
      } catch (e) {
        console.error("Failed to fetch user names", e);
      }
    };
    if (isOpen && transaction) fetchUserNames();
  }, [transaction, isOpen]);

  // Anexos e comprovante, na ordem em que a folha navega entre eles.
  const docs = useMemo<ViewableDoc[]>(
    () => [
      ...(transaction?.attachments ?? []).map((a) => ({
        key: a.id,
        name: a.name,
        url: a.url,
        type: a.type || undefined,
      })),
      ...(comprovante
        ? [
            {
              key: "comprovante",
              name: "Comprovante de pagamento",
              url: comprovante.inlineUrl,
              downloadUrl: comprovante.url,
              type: undefined,
              isReceipt: true,
            },
          ]
        : []),
    ],
    [transaction?.attachments, comprovante],
  );
  const previewDoc = previewIndex != null ? docs[previewIndex] : undefined;
  const movePreview = (delta: number) =>
    setPreviewIndex((i) =>
      i == null ? i : (i + delta + docs.length) % docs.length,
    );

  // ── Handlers — defined unconditionally (hooks rules) ────────────────────────
  const handleStatusUpdate = useCallback(
    async (newStatus: TransactionStatus, reason?: string) => {
      if (!user || !transaction || !selectedCompany) return;
      try {
        setIsProcessing(true);
        const updatedTransaction = await transactionService.updateStatus(
          transaction.id,
          newStatus,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
          reason,
        );

        try {
          if (newStatus === "pending_approval") {
            const q = query(
              collection(db, "users"),
              where("role", "in", ["admin", "approver", "financial_manager"]),
            );
            const querySnapshot = await getDocs(q);
            const approverEmails = querySnapshot.docs
              .map((d) => d.data().email)
              .filter((email) => email);
            if (approverEmails.length > 0) {
              await emailService.sendApprovalRequest(
                updatedTransaction,
                approverEmails[0],
              );
            }
            toast.success("Solicitação enviada para aprovação!");
          } else {
            const userDoc = await getDoc(
              doc(db, "users", transaction.createdBy),
            );
            const creatorEmail = userDoc.data()?.email;
            if (creatorEmail) {
              // O e-mail fala do status novo (e do motivo, se rejeitada).
              await emailService.sendStatusUpdate(
                updatedTransaction,
                creatorEmail,
                user.displayName,
              );
            }
            if (newStatus === "approved")
              toast.success("Transação aprovada com sucesso!");
            else if (newStatus === "rejected")
              toast.info("Transação rejeitada.");
            else if (newStatus === "paid")
              toast.success("Pagamento/Recebimento confirmado!");
          }
        } catch (emailError) {
          console.error("Failed to send email notification:", emailError);
          toast.warning("Status atualizado, mas houve erro ao enviar e-mail.");
        }

        onUpdate(updatedTransaction);
        onClose();
      } catch (error) {
        console.error("Error updating status:", error);
        toast.error(
          friendlyError(error, "Erro ao atualizar status. Tente novamente."),
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [user, transaction, selectedCompany, onUpdate, onClose],
  );

  const handleEditSubmit = useCallback(
    async (data: TransactionFormData) => {
      if (!user || !transaction || !selectedCompany) return;
      if (transaction.installments?.groupId) {
        setPendingUpdateData(data);
        setIsRecurrenceUpdateDialogOpen(true);
        return;
      }
      try {
        setIsProcessing(true);
        await transactionService.update(
          transaction.id,
          data,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Transação atualizada com sucesso!");
        const mergedTransaction: Transaction = {
          ...transaction,
          ...(data as unknown as Partial<Transaction>),
          updatedAt: new Date(),
        };
        onUpdate(mergedTransaction);
        setIsEditing(false);
      } catch (error) {
        console.error("Error updating transaction:", error);
        // A recusa por saldo vem do servidor já com os valores em jogo.
        toast.error(friendlyError(error, "Erro ao atualizar transação."));
      } finally {
        setIsProcessing(false);
      }
    },
    [user, transaction, selectedCompany, onUpdate],
  );

  const handleRecurrenceConfirm = useCallback(
    async (scope: "single" | "series") => {
      if (!user || !pendingUpdateData || !transaction || !selectedCompany)
        return;
      try {
        setIsProcessing(true);
        await transactionService.updateRecurrence(
          transaction,
          pendingUpdateData,
          scope,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Transações atualizadas com sucesso!");
        onUpdate();
        setIsEditing(false);
        setIsRecurrenceUpdateDialogOpen(false);
      } catch (error) {
        console.error("Error updating recurrence:", error);
        toast.error(
          friendlyError(error, "Erro ao atualizar transações recorrentes."),
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [user, pendingUpdateData, transaction, selectedCompany, onUpdate],
  );

  const handlePaymentConfirm = useCallback(
    async (data: PaymentConfirmation) => {
      if (!user || !selectedCompany || !transaction) return;
      try {
        setIsProcessing(true);
        await transactionService.settle(
          transaction.id,
          data,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Pagamento/Recebimento registrado com sucesso!");
        onUpdate();
        onClose();
      } catch (error) {
        console.error("Error settling transaction:", error);
        toast.error(friendlyError(error, "Erro ao registrar pagamento."));
      } finally {
        setIsProcessing(false);
      }
    },
    [user, selectedCompany, transaction, onUpdate, onClose],
  );

  // ── Derived values (safe to compute even when transaction is null) ───────────
  const isReceivable = transaction?.type === "receivable";
  const isPayable = transaction?.type === "payable";
  const canEdit = isPayable ? canEditPayables : canEditReceivables;
  const canApprove = isPayable ? canApprovePayables : canEditReceivables;
  const canPay = isPayable ? canPayPayables : canEditReceivables;
  const canHold = isPayable && (canApprovePayables || canPayPayables);
  const canPromise = isReceivable && canEditReceivables;
  const held = !!transaction?.paymentHold;
  const charges =
    transaction && isOverdue(transaction)
      ? lateCharges(
          transaction.amount,
          transaction.dueDate,
          new Date(),
          lateFeeRule(entity),
        )
      : null;

  // Cada conta aberta no painel começa com os formulários no estado pedido.
  const promise = transaction?.paymentPromise;
  useEffect(() => {
    if (!isOpen) return;
    setShowHoldForm(focusAction === "hold");
    setShowPromiseForm(focusAction === "promise");
    setHoldReason("");
    setPromiseDate(promise?.date ? format(promise.date, "yyyy-MM-dd") : "");
    setPromiseNote(promise?.note ?? "");
  }, [isOpen, transaction?.id, focusAction, promise]);

  // Trocar de conta (j/k) fecha o documento e a rejeição da conta anterior.
  useEffect(() => {
    setPreviewIndex(null);
    setShowRejectForm(false);
    setRejectReason("");
  }, [transaction?.id]);

  const handleHold = async (reason: string | null) => {
    if (!user || !transaction || !selectedCompany) return;
    setIsSavingAction(true);
    try {
      const paymentHold = await transactionService.setPaymentHold(
        transaction.id,
        reason,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      onUpdate({ ...transaction, paymentHold });
      setShowHoldForm(false);
      toast.success(reason ? "Pagamento bloqueado." : "Pagamento liberado.");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao atualizar o bloqueio."));
    } finally {
      setIsSavingAction(false);
    }
  };

  const handlePromise = async (remove = false) => {
    if (!user || !transaction || !selectedCompany) return;
    if (!remove && !promiseDate) {
      toast.error("Informe a data prometida.");
      return;
    }
    setIsSavingAction(true);
    try {
      const paymentPromise = await transactionService.setPaymentPromise(
        transaction.id,
        remove
          ? null
          : {
              date: new Date(`${promiseDate}T00:00:00`),
              note: promiseNote.trim(),
            },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      onUpdate({ ...transaction, paymentPromise });
      setShowPromiseForm(false);
      toast.success(remove ? "Promessa removida." : "Promessa registrada.");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao salvar a promessa."));
    } finally {
      setIsSavingAction(false);
    }
  };

  const nameOf = (uid?: string) =>
    uid === "magic-link" ? "link de aprovação" : (uid && userNames[uid]) || "…";
  const stamp = (date?: Date) =>
    date instanceof Date ? ` em ${format(date, "dd/MM/yyyy HH:mm")}` : "";

  // ── Ações do rodapé ─────────────────────────────────────────────────────────
  const showHoldAction =
    !!transaction && canHold && !held && isOpenTx(transaction) && !showHoldForm;
  const showChargeAction =
    !!transaction && isReceivable && isOpenTx(transaction);
  const showSubmitAction = transaction?.status === "draft" && !isReceivable;
  const showApproveActions =
    transaction?.status === "pending_approval" && canApprove && !isReceivable;
  const showPayAction =
    (transaction?.status === "approved" ||
      (transaction?.status === "draft" && isReceivable)) &&
    canPay;
  const hasActions =
    showHoldAction ||
    canEdit ||
    showChargeAction ||
    showSubmitAction ||
    showApproveActions ||
    showPayAction;

  const spinner = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;

  // ── Detail block (JSX constant, only used when transaction is non-null) ─────
  const detailsContent = transaction ? (
    <div className="space-y-7">
      {(transaction.paymentHold ||
        (canHold && !held && isOpenTx(transaction) && showHoldForm) ||
        transaction.status === "rejected" ||
        charges ||
        (isReceivable && (promise || punctuality || canPromise))) && (
        <div className="space-y-3">
          {transaction.status === "rejected" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/60 dark:bg-red-950/30">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">Rejeitada</p>
                <p className="whitespace-pre-wrap">
                  {transaction.rejectionReason || (
                    <span className="text-muted-foreground">
                      Sem motivo registrado.
                    </span>
                  )}
                </p>
                {transaction.rejectedBy && (
                  <p className="text-xs text-muted-foreground">
                    Por {nameOf(transaction.rejectedBy)}
                    {stamp(transaction.rejectedAt)}
                  </p>
                )}
              </div>
            </div>
          )}

          {transaction.paymentHold && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/30">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">Pagamento bloqueado</p>
                <p className="whitespace-pre-wrap">
                  {transaction.paymentHold.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  {transaction.paymentHold.byEmail ?? "—"}
                  {transaction.paymentHold.at &&
                    ` em ${format(transaction.paymentHold.at, "dd/MM/yyyy HH:mm")}`}
                </p>
              </div>
              {canHold && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSavingAction}
                  onClick={() => handleHold(null)}
                >
                  Liberar
                </Button>
              )}
            </div>
          )}

          {canHold && !held && isOpenTx(transaction) && showHoldForm && (
            <div className="space-y-2 rounded-lg border px-3 py-3">
              <label htmlFor="hold-reason" className="text-sm font-medium">
                Motivo do bloqueio
              </label>
              <Textarea
                id="hold-reason"
                autoFocus
                rows={2}
                placeholder="Ex.: nota fiscal divergente, serviço não entregue…"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enquanto bloqueada, a conta não pode ser paga nem entrar em
                lote.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowHoldForm(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!holdReason.trim() || isSavingAction}
                  onClick={() => handleHold(holdReason.trim())}
                >
                  Bloquear pagamento
                </Button>
              </div>
            </div>
          )}

          {charges && (
            <div className="rounded-lg border border-red-200 px-3 py-2.5 text-sm dark:border-red-900/60">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-red-700 dark:text-red-400">
                  Vencida há {charges.days}{" "}
                  {charges.days === 1 ? "dia" : "dias"}
                </span>
                <span className="font-financial font-semibold">
                  {formatCurrency(charges.total)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-financial">
                Valor corrigido hoje: multa {lateFeeRule(entity).feePercent}% (
                {formatCurrency(charges.fee)}) + juros{" "}
                {lateFeeRule(entity).monthlyInterestPercent}% a.m. (
                {formatCurrency(charges.interest)})
                {entity?.lateFeePercent == null &&
                  entity?.monthlyInterestPercent == null &&
                  " · padrão, ajustável no cadastro"}
              </p>
            </div>
          )}

          {isReceivable && (promise || punctuality || canPromise) && (
            <div className="space-y-2 rounded-lg border px-3 py-2.5 text-sm">
              {punctuality && (
                <p className="text-muted-foreground">
                  {punctuality.avgDays > 0
                    ? `Este cliente paga, em média, ${punctuality.avgDays} dias depois do vencimento`
                    : "Este cliente costuma pagar em dia"}{" "}
                  ({punctuality.count} recebimento
                  {punctuality.count !== 1 && "s"} nos últimos 12 meses).
                </p>
              )}
              {promise && !showPromiseForm && (
                <div className="flex items-start gap-2">
                  <Handshake className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
                  <p className="flex-1">
                    Prometeu pagar em{" "}
                    <span className="font-medium">
                      {format(promise.date, "dd/MM/yyyy")}
                    </span>
                    {promise.note && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {promise.note}
                      </span>
                    )}
                  </p>
                  {canPromise && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={isSavingAction}
                      onClick={() => handlePromise(true)}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              )}
              {canPromise && isOpenTx(transaction) && showPromiseForm && (
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <Input
                    type="date"
                    autoFocus
                    aria-label="Data prometida"
                    value={promiseDate}
                    onChange={(e) => setPromiseDate(e.target.value)}
                  />
                  <Input
                    placeholder="Observação (opcional)"
                    aria-label="Observação da promessa"
                    value={promiseNote}
                    onChange={(e) => setPromiseNote(e.target.value)}
                  />
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowPromiseForm(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      disabled={isSavingAction}
                      onClick={() => handlePromise()}
                    >
                      Salvar promessa
                    </Button>
                  </div>
                </div>
              )}
              {canPromise && isOpenTx(transaction) && !showPromiseForm && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => setShowPromiseForm(true)}
                >
                  <Handshake className="mr-1.5 h-3.5 w-3.5" />
                  {promise
                    ? "Alterar promessa"
                    : "Registrar promessa de pagamento"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Solicitado por">
          {transaction.requestOrigin?.name || "—"}
          {transaction.requestOrigin?.type && (
            <span className="text-muted-foreground">
              {" "}
              · {REQUEST_ORIGIN_LABELS[transaction.requestOrigin.type]}
            </span>
          )}
        </Field>
        <Field label="Forma de pagamento">
          {transaction.paymentMethod
            ? (PAYMENT_METHOD_LABELS[transaction.paymentMethod] ??
              transaction.paymentMethod)
            : "—"}
        </Field>
        {bankAccount && (
          <Field
            label={`Conta de ${transaction.type === "payable" ? "saída" : "entrada"}`}
          >
            {bankAccount.name}
          </Field>
        )}
        {transaction.competence && (
          <Field label="Competência">
            {transaction.competence.split("-").reverse().join("/")}
          </Field>
        )}
        {transaction.paymentDate && (
          <Field label={isPayable ? "Pago em" : "Recebido em"}>
            <span className="inline-flex items-center gap-1.5 font-financial">
              <CheckCircle2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              {format(transaction.paymentDate, "dd/MM/yyyy")}
            </span>
          </Field>
        )}
        {transaction.finalAmount !== undefined && (
          <Field label={isPayable ? "Valor pago" : "Valor recebido"}>
            <span className="font-financial">
              {formatCurrency(transaction.finalAmount)}
            </span>
          </Field>
        )}
        {transaction.recurrence?.isRecurring && (
          <Field label="Recorrência">
            {transaction.installments
              ? `Parcela ${transaction.installments.current} de ${transaction.installments.total}`
              : transaction.recurrence.frequency === "monthly"
                ? "Mensal"
                : "Outra"}
          </Field>
        )}
        {account && (
          <Field label="Plano de contas" className="col-span-2">
            <span className="font-mono text-xs text-muted-foreground mr-1.5">
              {account.code}
            </span>
            {account.name}
            {account.archived && (
              <span className="text-xs text-muted-foreground">
                {" "}
                (arquivada)
              </span>
            )}
          </Field>
        )}
      </dl>

      {(transaction.barcode ||
        (entity &&
          (entity.pixKey ||
            entity.bankName ||
            entity.agency ||
            entity.account))) && (
        <section>
          <h3 className={sectionTitle}>Dados para pagamento</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-3">
            {entity?.pixKey && (
              <Field
                className="col-span-2"
                label={`Chave PIX${entity.pixKeyType ? ` (${PIX_KEY_TYPE_LABELS[entity.pixKeyType]})` : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono break-all select-all">
                    {entity.pixKey}
                  </span>
                  <CopyButton value={entity.pixKey} label="Chave PIX" />
                </span>
              </Field>
            )}
            {entity?.bankName && (
              <Field label="Banco" className="col-span-2">
                {entity.bankName}
              </Field>
            )}
            {entity?.agency && (
              <Field label="Agência">
                <span className="font-mono select-all">{entity.agency}</span>
              </Field>
            )}
            {entity?.account && (
              <Field
                label={`Conta${entity.accountType ? (entity.accountType === "savings" ? " (poupança)" : " (corrente)") : ""}`}
              >
                <span className="font-mono select-all">{entity.account}</span>
              </Field>
            )}
            {transaction.barcode && (
              <Field label="Linha digitável" className="col-span-2">
                <span className="flex items-center gap-2">
                  <Barcode className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-mono break-all select-all">
                    {transaction.barcode}
                  </span>
                  <CopyButton
                    value={transaction.barcode}
                    label="Linha digitável"
                  />
                </span>
              </Field>
            )}
          </dl>
        </section>
      )}

      {!!transaction.costCenterAllocation?.length && (
        <section>
          <h3 className={sectionTitle}>Rateio por centro de custo</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {transaction.costCenterAllocation.map((alloc, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between gap-4 px-3 py-2"
              >
                <span className="min-w-0 truncate">
                  {costCenterNames[alloc.costCenterId] || alloc.costCenterId}
                </span>
                <span className="flex shrink-0 gap-4 font-financial tabular-nums">
                  <span className="text-muted-foreground">
                    {alloc.percentage}%
                  </span>
                  <span className="w-28 text-right font-medium">
                    {formatCurrency(alloc.amount)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(docs.length > 0 ||
        (transaction.type === "payable" &&
          (transaction.status === "paid" ||
            transaction.status === "authorized"))) && (
        <section>
          <h3 className={sectionTitle}>Documentos</h3>
          {docs.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm">
              {docs.map((d, i) => (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(i)}
                    aria-pressed={previewIndex === i}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      previewIndex === i && "bg-muted",
                    )}
                  >
                    {d.isReceipt ? (
                      <FileCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {previewIndex === i ? "Aberto" : "Ver"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!comprovante &&
            transaction.type === "payable" &&
            (transaction.status === "paid" ||
              transaction.status === "authorized") && (
              <p
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground",
                  docs.length > 0 && "mt-2",
                )}
              >
                <FileCheck className="h-4 w-4 shrink-0" />
                Nenhum comprovante de pagamento associado
              </p>
            )}
        </section>
      )}

      {transaction.details && (
        <section>
          <h3 className={sectionTitle}>Detalhes</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {transaction.details}
          </p>
        </section>
      )}

      {transaction.notes && (
        <section>
          <h3 className={sectionTitle}>Observações</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {transaction.notes}
          </p>
        </section>
      )}

      <section className="space-y-1 text-xs text-muted-foreground">
        {transaction.createdBy && (
          <p>
            Cadastrada por{" "}
            <span className="text-foreground/80">
              {nameOf(transaction.createdBy)}
            </span>
            {stamp(transaction.createdAt)}
          </p>
        )}
        {transaction.approvedBy && (
          <p>
            Aprovada por{" "}
            <span className="text-foreground/80">
              {nameOf(transaction.approvedBy)}
            </span>
            {stamp(transaction.approvedAt)}
          </p>
        )}
        {transaction.releasedBy && (
          <p>
            {isPayable ? "Paga" : "Recebida"} por{" "}
            <span className="text-foreground/80">
              {nameOf(transaction.releasedBy)}
            </span>
            {stamp(transaction.releasedAt)}
          </p>
        )}
      </section>

      {canViewAuditLogs && (
        <RecordHistory
          key={transaction.id}
          companyId={transaction.companyId}
          recordId={transaction.id}
        />
      )}
    </div>
  ) : null;

  // ── Always render the Dialog shell — never return null before it ─────────────
  // Returning null early while Radix Presence is still animating the exit causes
  // the "Maximum update depth exceeded" loop (setState called inside safelyDetachRef).
  return (
    <>
      <ResponsiveModal open={isOpen} onOpenChange={onClose} panel>
        <ResponsiveModalContent
          // A folha do documento fica fora da caixa do painel: a rolagem vai
          // para o corpo, senão o overflow a cortaria.
          sheetClassName="gap-0 overflow-visible p-0 max-md:pt-3"
          data-panel
          onEscapeKeyDown={(e) => {
            if (previewDoc) {
              e.preventDefault();
              setPreviewIndex(null);
            }
          }}
        >
          {transaction && selectedCompany ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                {/* ── Cabeçalho ─────────────────────────────────────────── */}
                <div className="shrink-0 border-b px-6 pt-4 pb-4">
                  <div className="flex min-h-8 items-center gap-2 pr-8 text-xs text-muted-foreground">
                    <StatusBadge
                      status={transaction.status}
                      type={transaction.type}
                    />
                    <span className="truncate">
                      {isPayable ? "Conta a pagar" : "Conta a receber"}
                      {transaction.documentNumber &&
                        ` · Doc. ${transaction.documentNumber}`}
                    </span>
                    <div className="ml-auto flex items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Copiar ID da conta"
                        aria-label="Copiar ID da conta"
                        onClick={() => {
                          navigator.clipboard.writeText(transaction.id);
                          toast.success("ID copiado");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {onNavigate && !isEditing && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Conta anterior (k)"
                            aria-label="Conta anterior"
                            onClick={() => onNavigate(-1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Próxima conta (j)"
                            aria-label="Próxima conta"
                            onClick={() => onNavigate(1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <ResponsiveModalTitle className="mt-2 text-lg font-semibold leading-snug text-balance">
                    {isEditing ? "Editar conta" : transaction.description}
                  </ResponsiveModalTitle>
                  <ResponsiveModalDescription className="mt-0.5 truncate text-sm">
                    {isEditing
                      ? transaction.description
                      : transaction.supplierOrClient || "—"}
                  </ResponsiveModalDescription>

                  {!isEditing && (
                    <div className="mt-3 flex items-end justify-between gap-4">
                      <p className="font-financial text-2xl font-semibold tabular-nums">
                        {formatCurrency(transaction.amount)}
                      </p>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          Vencimento
                        </p>
                        <p
                          className={cn(
                            "font-financial text-sm",
                            charges && "text-red-700 dark:text-red-400",
                          )}
                        >
                          {format(transaction.dueDate, "dd/MM/yyyy")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Corpo ─────────────────────────────────────────────── */}
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  {isEditing ? (
                    <TransactionForm
                      type={transaction.type}
                      defaultValues={{
                        ...(transaction as unknown as Partial<TransactionFormData>),
                        dueDate: transaction.dueDate
                          ? new Date(transaction.dueDate)
                          : new Date(),
                        paymentDate: transaction.paymentDate
                          ? new Date(transaction.paymentDate)
                          : undefined,
                      }}
                      onSubmit={handleEditSubmit}
                      onCancel={() => setIsEditing(false)}
                      isLoading={isProcessing}
                    />
                  ) : (
                    detailsContent
                  )}
                </div>

                {/* ── Rodapé fixo ───────────────────────────────────────── */}
                {!isEditing && hasActions && (
                  <div className="shrink-0 border-t bg-background px-6 py-3">
                    {showRejectForm ? (
                      <div className="space-y-2">
                        <label
                          htmlFor="reject-reason"
                          className="text-sm font-medium"
                        >
                          Motivo da rejeição
                        </label>
                        <Textarea
                          id="reject-reason"
                          autoFocus
                          rows={2}
                          placeholder="Ex.: valor diverge da nota, centro de custo errado…"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Quem cadastrou recebe o motivo por e-mail.
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => setShowRejectForm(false)}
                            disabled={isProcessing}
                          >
                            Cancelar
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!rejectReason.trim() || isProcessing}
                            onClick={() =>
                              handleStatusUpdate(
                                "rejected",
                                rejectReason.trim(),
                              )
                            }
                          >
                            {isProcessing ? (
                              spinner
                            ) : (
                              <XCircle className="mr-2 h-4 w-4" />
                            )}
                            Rejeitar conta
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {showHoldAction && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowHoldForm(true)}
                            disabled={isProcessing}
                          >
                            <Lock className="mr-1.5 h-3.5 w-3.5" />
                            Bloquear
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(true)}
                            disabled={isProcessing}
                          >
                            <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                            Editar
                          </Button>
                        )}
                        {showChargeAction && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const msg = encodeURIComponent(
                                `Olá ${transaction.supplierOrClient}, tudo bem?\n\nPassando para lembrar que a fatura referente a *${transaction.description}* no valor de *${formatCurrency(transaction.amount)}* vence em *${format(transaction.dueDate, "dd/MM/yyyy")}*.\n\nQualquer dúvida, estou à disposição.`,
                              );
                              window.open(
                                `https://wa.me/?text=${msg}`,
                                "_blank",
                              );
                            }}
                          >
                            <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                            Cobrar por WhatsApp
                          </Button>
                        )}

                        <div className="ml-auto flex gap-2">
                          {showSubmitAction && (
                            <Button
                              onClick={() =>
                                handleStatusUpdate("pending_approval")
                              }
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                spinner
                              ) : (
                                <Send className="mr-2 h-4 w-4" />
                              )}
                              Enviar para aprovação
                            </Button>
                          )}
                          {showApproveActions && (
                            <>
                              <Button
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setShowRejectForm(true)}
                                disabled={isProcessing}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Rejeitar
                              </Button>
                              <Button
                                onClick={() => handleStatusUpdate("approved")}
                                disabled={isProcessing}
                              >
                                {isProcessing ? (
                                  spinner
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Aprovar
                              </Button>
                            </>
                          )}
                          {showPayAction && (
                            <Button
                              onClick={() => setIsPaymentDialogOpen(true)}
                              disabled={isProcessing || held}
                              title={held ? "Pagamento bloqueado" : undefined}
                            >
                              {isProcessing ? (
                                spinner
                              ) : (
                                <Banknote className="mr-2 h-4 w-4" />
                              )}
                              {isPayable
                                ? "Confirmar pagamento"
                                : "Confirmar recebimento"}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Segunda folha: documento ao lado do painel ──────────── */}
              {previewDoc && (
                <aside
                  aria-label={`Documento: ${previewDoc.name}`}
                  className="absolute inset-0 z-10 flex flex-col bg-background shadow-xl duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] animate-in fade-in-0 slide-in-from-right-8 lg:left-auto lg:right-full lg:w-[min(56rem,calc(100vw-100%-1.5rem))] lg:border-l"
                >
                  <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 lg:hidden"
                      aria-label="Voltar aos detalhes"
                      onClick={() => setPreviewIndex(null)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <p
                      className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
                      title={previewDoc.name}
                    >
                      {previewDoc.name}
                    </p>
                    {docs.length > 1 && (
                      <>
                        <span className="px-1 text-xs text-muted-foreground tabular-nums">
                          {previewIndex! + 1} de {docs.length}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Documento anterior"
                          onClick={() => movePreview(-1)}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Próximo documento"
                          onClick={() => movePreview(1)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {previewDoc.downloadUrl && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Baixar"
                        aria-label="Baixar"
                        asChild
                      >
                        <a href={previewDoc.downloadUrl} download>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Abrir em nova aba"
                      aria-label="Abrir em nova aba"
                      asChild
                    >
                      <a
                        href={previewDoc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden h-8 w-8 lg:inline-flex"
                      title="Fechar documento (Esc)"
                      aria-label="Fechar documento"
                      onClick={() => setPreviewIndex(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col bg-muted/30 p-3">
                    <DocumentPreview
                      key={previewDoc.key}
                      url={previewDoc.url}
                      name={previewDoc.name}
                      type={previewDoc.type}
                      title={previewDoc.name}
                    />
                  </div>
                </aside>
              )}
            </>
          ) : (
            // Empty shell while dialog is opening/closing with no transaction yet
            <div className="px-6 pt-5">
              <ResponsiveModalTitle>Carregando...</ResponsiveModalTitle>
            </div>
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

      {transaction && (
        <>
          {isPaymentDialogOpen && (
            <PaymentDialog
              isOpen={isPaymentDialogOpen}
              onClose={() => setIsPaymentDialogOpen(false)}
              onConfirm={handlePaymentConfirm}
              transaction={transaction}
              type={transaction.type === "payable" ? "pay" : "receive"}
              lateFee={lateFeeRule(entity)}
            />
          )}

          {isRecurrenceUpdateDialogOpen && (
            <RecurrenceUpdateDialog
              isOpen={isRecurrenceUpdateDialogOpen}
              onClose={() => setIsRecurrenceUpdateDialogOpen(false)}
              onConfirm={handleRecurrenceConfirm}
              installmentInfo={
                transaction.installments
                  ? {
                      current: transaction.installments.current,
                      total: transaction.installments.total,
                    }
                  : undefined
              }
            />
          )}
        </>
      )}
    </>
  );
}
