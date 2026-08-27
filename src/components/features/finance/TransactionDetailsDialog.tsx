"use client";

import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Transaction, TransactionStatus, CostCenter } from "@/lib/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  CalendarIcon,
  Edit2,
  Copy,
  Barcode,
  MessageCircle,
  FileCheck,
  Download,
} from "lucide-react";
import { PaymentDialog } from "./PaymentDialog";
import { formatCurrency, comprovanteProxyUrl } from "@/lib/utils";
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

interface TransactionDetailsDialogProps {
  transaction: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedTransaction?: Transaction) => void;
  costCenters?: CostCenter[];
}

export function TransactionDetailsDialog({
  transaction: propTransaction,
  isOpen,
  onClose,
  onUpdate,
  costCenters = [],
}: TransactionDetailsDialogProps) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const {
    canEditPayables,
    canApprovePayables,
    canPayPayables,
    canEditReceivables,
  } = usePermissions();

  // Cache the transaction synchronously to avoid sudden unmounts of references during Radix animations,
  // which causes the "Maximum update depth exceeded" infinite loop in `usePresence`.
  // If we used useEffect for this, the state update would happen AFTER the mount, causing a violent
  // DOM swap *during* the enter animation. This approach guarantees instant stability.
  const cachedTransactionRef = useRef<Transaction | null>(null);
  if (isOpen && propTransaction) {
    cachedTransactionRef.current = propTransaction;
  }
  const transaction = isOpen ? propTransaction : cachedTransactionRef.current;

  const [activeTab, setActiveTab] = useState<"details" | "billing">("details");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isRecurrenceUpdateDialogOpen, setIsRecurrenceUpdateDialogOpen] =
    useState(false);
  const [pendingUpdateData, setPendingUpdateData] =
    useState<TransactionFormData | null>(null);
  // costCenterNames is now derived via useMemo
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);
  const [comprovanteId, setComprovanteId] = useState<string | null>(null);

  // Reset edit mode when dialog closes, but delayed to allow exit animations to complete cleanly
  // without mutating the DOM mid-animation. This prevents Radix safelyDetachRef crashes.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setIsEditing(false);
        setPendingUpdateData(null);
        setIsRecurrenceUpdateDialogOpen(false);
        setActiveTab("details");
        setComprovanteUrl(null);
        setComprovanteId(null);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Fetch comprovante from Firestore when dialog opens — the transaction prop may be stale
  // (e.g. confirmed on the /comprovantes page but list cache not yet refreshed)
  useEffect(() => {
    if (!isOpen || !transaction) return;
    // Prefer storagePath (proxy) over legacy public URL
    if (transaction.comprovanteStoragePath) {
      setComprovanteUrl(
        comprovanteProxyUrl(transaction.comprovanteStoragePath),
      );
      setComprovanteId(transaction.comprovanteId ?? null);
      return;
    }
    if (transaction.comprovanteUrl) {
      // Legacy: existing records that still have the public URL
      setComprovanteUrl(transaction.comprovanteUrl);
      setComprovanteId(transaction.comprovanteId ?? null);
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
          setComprovanteUrl(comprovanteProxyUrl(c.storagePath));
          setComprovanteId(c.id);
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

  // Fetch user names (creator/approver/releaser) in a single batched query
  useEffect(() => {
    const fetchUserNames = async () => {
      if (!transaction) return;
      const userIds = [
        transaction.createdBy,
        transaction.approvedBy,
        transaction.releasedBy,
      ].filter((id): id is string => Boolean(id));
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

  // ── Handlers — defined unconditionally (hooks rules) ────────────────────────
  const handleStatusUpdate = useCallback(
    async (newStatus: TransactionStatus) => {
      if (!user || !transaction || !selectedCompany) return;
      try {
        setIsProcessing(true);
        const updatedTransaction = await transactionService.updateStatus(
          transaction.id,
          newStatus,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
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
              await emailService.sendStatusUpdate(
                transaction,
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
        toast.error("Erro ao atualizar status. Tente novamente.");
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
        toast.error("Erro ao atualizar transação.");
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
        toast.error("Erro ao atualizar transações recorrentes.");
      } finally {
        setIsProcessing(false);
      }
    },
    [user, pendingUpdateData, transaction, selectedCompany, onUpdate],
  );

  const handlePaymentConfirm = useCallback(
    async (data: {
      paymentDate: Date;
      finalAmount: number;
      discount: number;
      interest: number;
    }) => {
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
        toast.error("Erro ao registrar pagamento.");
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-emerald-500">
            {isReceivable ? "Aguardando Recebimento" : "Aprovado"}
          </Badge>
        );
      case "pending_approval":
        return <Badge className="bg-amber-500">Pendente</Badge>;
      case "paid":
        return (
          <Badge className="bg-blue-500">
            {isReceivable ? "Recebido" : "Pago"}
          </Badge>
        );
      case "rejected":
        return <Badge className="bg-red-500">Rejeitado</Badge>;
      default:
        return <Badge variant="secondary">Rascunho</Badge>;
    }
  };

  // ── Detail block (JSX constant, only used when transaction is non-null) ─────
  const detailsContent = transaction ? (
    <div className="grid gap-6 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">
            Descrição
          </h4>
          <p className="text-lg font-semibold">{transaction.description}</p>
        </div>
        <div className="text-right">
          <h4 className="text-sm font-medium text-muted-foreground">Valor</h4>
          <p
            className={`text-lg font-semibold ${
              isPayable ? "text-red-600" : "text-green-600"
            }`}
          >
            {isPayable ? "-" : "+"}
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(transaction.amount)}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">
            {isPayable ? "Fornecedor" : "Cliente"}
          </h4>
          <p className="text-base">{transaction.supplierOrClient}</p>
        </div>
        <div className="text-right">
          <h4 className="text-sm font-medium text-muted-foreground">
            Vencimento
          </h4>
          <p className="text-base flex items-center gap-2 justify-end">
            <CalendarIcon className="h-4 w-4" />
            {format(transaction.dueDate, "dd 'de' MMMM 'de' yyyy", {
              locale: ptBR,
            })}
          </p>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">
            Solicitado por
          </h4>
          <p className="text-sm">
            {transaction.requestOrigin?.name || "-"} (
            {transaction.requestOrigin?.type === "director"
              ? "Diretoria"
              : transaction.requestOrigin?.type === "department"
                ? "Departamento"
                : transaction.requestOrigin?.type === "sector"
                  ? "Setor"
                  : "-"}
            )
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">
            Método de Pagamento
          </h4>
          <p className="text-sm capitalize">
            {transaction.paymentMethod || "-"}
          </p>
        </div>

        {transaction.paymentDate && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground">
              Data de Pagamento
            </h4>
            <p className="text-sm flex items-center gap-2 text-blue-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {format(transaction.paymentDate, "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
        )}

        {transaction.finalAmount !== undefined && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground">
              Valor Final
            </h4>
            <p className="text-sm font-medium font-financial">
              {formatCurrency(transaction.finalAmount)}
            </p>
          </div>
        )}

        {transaction.recurrence?.isRecurring && (
          <div className="col-span-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Recorrência
            </h4>
            <p className="text-sm">
              {transaction.installments
                ? `Parcela ${transaction.installments.current} de ${transaction.installments.total}`
                : transaction.recurrence.frequency === "monthly"
                  ? "Mensal"
                  : "Outro"}
            </p>
          </div>
        )}
      </div>

      {transaction.details && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              Detalhes
            </h4>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {transaction.details}
            </p>
          </div>
        </>
      )}

      <Separator />

      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">
          Rateio por Centro de Custo
        </h4>
        <div className="space-y-2">
          {transaction.costCenterAllocation?.map((alloc, index) => (
            <div
              key={index}
              className="flex justify-between text-sm border p-2 rounded"
            >
              <span>
                {costCenterNames[alloc.costCenterId] || alloc.costCenterId}
              </span>
              <div className="flex gap-4">
                <span>{alloc.percentage}%</span>
                <span className="font-medium">
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(alloc.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {transaction.attachments && transaction.attachments.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              Anexos
            </h4>
            <div className="flex flex-wrap gap-2">
              {transaction.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline bg-blue-50 px-2 py-1 rounded"
                >
                  {att.name}
                </a>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Comprovante de pagamento ─────────────────────────────────────── */}
      {comprovanteUrl ? (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              Comprovante de Pagamento
            </h4>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 shrink-0">
                <FileCheck className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Comprovante disponível</p>
                <p className="text-xs text-muted-foreground truncate">
                  {comprovanteId}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                asChild
              >
                <a
                  href={comprovanteUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </a>
              </Button>
            </div>
          </div>
        </>
      ) : transaction.type === "payable" &&
        (transaction.status === "paid" ||
          transaction.status === "authorized") ? (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              Comprovante de Pagamento
            </h4>
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-muted-foreground">
              <FileCheck className="h-4 w-4 shrink-0" />
              <p className="text-sm">Nenhum comprovante associado</p>
            </div>
          </div>
        </>
      ) : null}

      {transaction.barcode && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              Linha Digitável
            </h4>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 bg-muted/50 border rounded-md px-3 py-2">
                <Barcode className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-mono select-all">
                  {transaction.barcode}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(transaction.barcode!);
                  toast.success("Linha digitável copiada!");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {transaction.notes && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-muted-foreground">
              Observações
            </h4>
            <p className="text-sm whitespace-pre-wrap">{transaction.notes}</p>
          </div>
        </>
      )}

      {(transaction.approvedBy || transaction.releasedBy) && (
        <>
          <Separator />
          <div className="text-xs text-muted-foreground space-y-1">
            {transaction.approvedBy && (
              <p>
                Aprovado por:{" "}
                {userNames[transaction.approvedBy] || transaction.approvedBy} em{" "}
                {transaction.approvedAt
                  ? format(transaction.approvedAt, "dd/MM/yyyy HH:mm")
                  : "-"}
              </p>
            )}
            {transaction.releasedBy && (
              <p>
                Pago/Liberado por:{" "}
                {userNames[transaction.releasedBy] || transaction.releasedBy} em{" "}
                {transaction.releasedAt
                  ? format(transaction.releasedAt, "dd/MM/yyyy HH:mm")
                  : "-"}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  ) : null;

  // ── Always render the Dialog shell — never return null before it ─────────────
  // Returning null early while Radix Presence is still animating the exit causes
  // the "Maximum update depth exceeded" loop (setState called inside safelyDetachRef).
  return (
    <>
      <ResponsiveModal open={isOpen} onOpenChange={onClose}>
        <ResponsiveModalContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
          {transaction && selectedCompany ? (
            <>
              <ResponsiveModalHeader>
                <div className="flex items-center justify-between pr-8">
                  <ResponsiveModalTitle>
                    {isEditing ? "Editar Transação" : "Detalhes da Transação"}
                  </ResponsiveModalTitle>
                  {!isEditing && getStatusBadge(transaction.status)}
                </div>
                <ResponsiveModalDescription asChild>
                  <div className="flex flex-col gap-1 mt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-muted-foreground/70 bg-muted px-2 py-0.5 rounded select-all">
                        {transaction.id}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(transaction.id);
                          toast.success("ID copiado!");
                        }}
                        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title="Copiar ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                    {transaction.createdBy && (
                      <span className="text-xs text-muted-foreground">
                        Cadastrado por{" "}
                        <span className="font-medium text-foreground/70">
                          {userNames[transaction.createdBy] || "…"}
                        </span>
                      </span>
                    )}
                  </div>
                </ResponsiveModalDescription>
              </ResponsiveModalHeader>

              {isEditing ? (
                <div className="py-4">
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
                </div>
              ) : isReceivable ? (
                /* ── Receivable: Custom Tabs para evitar conflitos de Presence do Radix ── */
                <div className="w-full mt-2">
                  <div className="flex gap-2 mb-4 bg-muted text-muted-foreground p-1 rounded-lg w-fit">
                    <button
                      type="button"
                      onClick={() => setActiveTab("details")}
                      className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                        activeTab === "details"
                          ? "bg-background text-foreground shadow-sm"
                          : "hover:bg-background/50"
                      }`}
                    >
                      Detalhes
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("billing")}
                      className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                        activeTab === "billing"
                          ? "bg-background text-foreground shadow-sm"
                          : "hover:bg-background/50"
                      }`}
                    >
                      Fatura e Cobrança
                    </button>
                  </div>

                  {activeTab === "details" && detailsContent}

                  {activeTab === "billing" && (
                    <div className="space-y-4 pt-2">
                      {/* QR Code PIX placeholder */}
                      <div className="flex flex-col items-center gap-4 p-6 border border-dashed rounded-xl bg-muted/30">
                        <p className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
                          QR Code PIX
                        </p>
                        <Skeleton className="h-44 w-44 rounded-xl" />
                        <p className="text-xs text-muted-foreground text-center max-w-xs leading-relaxed">
                          A geração automática do QR Code será ativada após
                          integração com o provedor de pagamentos. Em breve!
                        </p>
                      </div>

                      {/* Link da fatura placeholder */}
                      <div className="flex items-center gap-3 p-3 border border-dashed rounded-xl bg-muted/30">
                        <Skeleton className="h-9 flex-1 rounded-lg" />
                        <Button
                          variant="outline"
                          size="icon"
                          disabled
                          title="Copiar link da fatura (em breve)"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-center text-muted-foreground -mt-2">
                        Link de fatura — disponível na próxima fase
                      </p>

                      {/* Botão WhatsApp */}
                      <Button
                        className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold shadow-sm"
                        onClick={() => {
                          const msg = encodeURIComponent(
                            `Olá ${transaction.supplierOrClient}, tudo bem?\n\nPassando para lembrar que a fatura referente a *${transaction.description}* no valor de *${formatCurrency(transaction.amount)}* vence em *${format(transaction.dueDate, "dd/MM/yyyy")}*.\n\nQualquer dúvida, estou à disposição. 😊`,
                          );
                          window.open(`https://wa.me/?text=${msg}`, "_blank");
                        }}
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Enviar Cobrança por WhatsApp
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Payable: apenas detalhes, sem tabs ── */
                detailsContent
              )}

              {!isEditing && (
                <ResponsiveModalFooter className="gap-2 sm:gap-2">
                  {canEdit && (
                    <Button
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      disabled={isProcessing}
                    >
                      <Edit2 className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                  )}

                  {transaction.status === "draft" && !isReceivable && (
                    <Button
                      className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                      onClick={() => handleStatusUpdate("pending_approval")}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Enviar para Aprovação
                    </Button>
                  )}

                  {transaction.status === "pending_approval" &&
                    canApprove &&
                    !isReceivable && (
                      <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                          variant="destructive"
                          onClick={() => handleStatusUpdate("rejected")}
                          disabled={isProcessing}
                        >
                          {isProcessing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="mr-2 h-4 w-4" />
                          )}
                          Rejeitar
                        </Button>
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => handleStatusUpdate("approved")}
                          disabled={isProcessing}
                        >
                          {isProcessing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          )}
                          Aprovar
                        </Button>
                      </div>
                    )}

                  {(transaction.status === "approved" ||
                    (transaction.status === "draft" && isReceivable)) &&
                    canPay && (
                      <Button
                        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                        onClick={() => setIsPaymentDialogOpen(true)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Banknote className="mr-2 h-4 w-4" />
                        )}
                        {isPayable
                          ? "Confirmar Pagamento"
                          : "Confirmar Recebimento"}
                      </Button>
                    )}

                  <Button
                    variant="outline"
                    onClick={onClose}
                    disabled={isProcessing}
                  >
                    Fechar
                  </Button>
                </ResponsiveModalFooter>
              )}
            </>
          ) : (
            // Empty shell while dialog is opening/closing with no transaction yet
            <ResponsiveModalHeader>
              <ResponsiveModalTitle>Carregando...</ResponsiveModalTitle>
            </ResponsiveModalHeader>
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
