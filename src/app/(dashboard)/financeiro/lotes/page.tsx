"use client";

import { useEffect, useState, useMemo } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { notificationService } from "@/lib/services/notificationService";
import { emailService } from "@/lib/services/emailService";
import { PaymentBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Plus,
  MoreHorizontal,
  Loader2,
  Edit,
  CalendarIcon,
  Trash2,
  Package,
  Layers,
  Clock,
  CheckCircle2,
  DollarSign,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatCurrencyAbbr, cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BatchDetailsDialog } from "@/components/features/finance/BatchDetailsDialog";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import { BatchApprovalDialog } from "@/components/features/finance/BatchApprovalDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// ── Constants (top-level so MobileBatchCard can use them) ──────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; dot: string; bg: string }
> = {
  open: {
    label: "Aberto",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    bg: "",
  },
  pending_approval: {
    label: "Ag. Aprovação",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400 animate-pulse",
    bg: "bg-amber-50/60 dark:bg-amber-950/20",
  },
  approved: {
    label: "Aprovado",
    color: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-500",
    bg: "bg-green-50/40 dark:bg-green-950/15",
  },
  pending_authorization: {
    label: "Ag. Autorização",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400 animate-pulse",
    bg: "bg-amber-50/60 dark:bg-amber-950/20",
  },
  authorized: {
    label: "Autorizado",
    color: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
    bg: "bg-teal-50/40 dark:bg-teal-950/15",
  },
  paid: {
    label: "Pago",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    bg: "bg-blue-50/40 dark:bg-blue-950/15",
  },
  rejected: {
    label: "Rejeitado",
    color: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
    bg: "bg-red-50/40 dark:bg-red-950/15",
  },
};

const STATUS_LABELS: Record<string, string> = {
  all: "Todos",
  open: "Aberto",
  pending_approval: "Ag. Aprovação",
  approved: "Aprovado",
  pending_authorization: "Ag. Autorização",
  authorized: "Autorizado",
  paid: "Pago",
  rejected: "Rejeitado",
};

function getStatusBadge(status: string) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return <Badge>{status}</Badge>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border",
        cfg.color,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Mobile skeleton ────────────────────────────────────────────────────────

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 max-w-[180px]" />
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
            <Skeleton className="h-3 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-11 w-11 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Mobile batch card ──────────────────────────────────────────────────────

interface MobileBatchCardProps {
  batch: PaymentBatch;
  canManageBatches: boolean;
  canApproveBatches: boolean;
  canPayBatches: boolean;
  onViewDetails: () => void;
  onApprove: () => void;
  onSendForApproval: () => void;
  onSendForAuthorization: () => void;
  onConfirmAuthorization: () => void;
  onConfirmPayments: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRevert: () => void;
}

function MobileBatchCard({
  batch,
  canManageBatches,
  canApproveBatches,
  canPayBatches,
  onViewDetails,
  onApprove,
  onSendForApproval,
  onSendForAuthorization,
  onConfirmAuthorization,
  onConfirmPayments,
  onEdit,
  onDelete,
  onRevert,
}: MobileBatchCardProps) {
  const cfg = STATUS_CONFIG[batch.status];
  const bgClass = cfg?.bg ?? "";

  const quickAction = (() => {
    if (batch.status === "pending_approval" && canApproveBatches)
      return {
        label: "Aprovar",
        onClick: onApprove,
        className: "border-green-200 text-green-700 hover:bg-green-50",
      };
    if (batch.status === "pending_authorization" && canPayBatches)
      return {
        label: "Autorizar",
        onClick: onConfirmAuthorization,
        className: "border-teal-200 text-teal-700 hover:bg-teal-50",
      };
    if (batch.status === "authorized" && canManageBatches)
      return {
        label: "Confirmar Pgto",
        onClick: onConfirmPayments,
        className: "border-blue-200 text-blue-700 hover:bg-blue-50",
      };
    return null;
  })();

  const responsibleText = (() => {
    if (batch.status === "pending_approval" && batch.approverEmail)
      return `Aprovador: ${batch.approverEmail}`;
    if (batch.status === "pending_authorization" && batch.authorizerEmail)
      return `Autorizador: ${batch.authorizerEmail}`;
    return null;
  })();

  return (
    <div
      className={cn(
        "relative flex items-start gap-2 px-4 py-3.5 transition-colors",
        bgClass,
      )}
    >
      {/* Main content */}
      <button
        type="button"
        className="flex-1 text-left min-w-0 py-0.5"
        onClick={onViewDetails}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug flex-1 truncate">
            {batch.name}
          </p>
          <span
            className="text-sm font-bold font-financial shrink-0"
            title={formatCurrency(batch.totalAmount)}
          >
            {formatCurrencyAbbr(batch.totalAmount)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {format(batch.createdAt, "dd MMM yyyy", { locale: ptBR })}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {batch.transactionIds.length}{" "}
            {batch.transactionIds.length !== 1 ? "transações" : "transação"}
          </span>
          {getStatusBadge(batch.status)}
        </div>
        {responsibleText && (
          <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
            {responsibleText}
          </p>
        )}
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {quickAction && (
          <Button
            size="sm"
            variant="outline"
            className={cn("h-10 text-xs px-3", quickAction.className)}
            onClick={quickAction.onClick}
          >
            {quickAction.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-11 w-11 p-0"
              aria-label="Ações do lote"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Ações</DropdownMenuLabel>
            <DropdownMenuItem onClick={onViewDetails}>
              Ver Detalhes
            </DropdownMenuItem>
            {canManageBatches && (
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" /> Editar
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {batch.status === "open" && canManageBatches && (
              <DropdownMenuItem onClick={onSendForApproval}>
                Enviar para Aprovador
              </DropdownMenuItem>
            )}
            {batch.status === "pending_approval" && canApproveBatches && (
              <DropdownMenuItem onClick={onApprove}>
                Aprovar Lote
              </DropdownMenuItem>
            )}
            {batch.status === "approved" && canManageBatches && (
              <DropdownMenuItem onClick={onSendForAuthorization}>
                Enviar para Autorização
              </DropdownMenuItem>
            )}
            {batch.status === "pending_authorization" && canPayBatches && (
              <DropdownMenuItem onClick={onConfirmAuthorization}>
                Confirmar Autorização
              </DropdownMenuItem>
            )}
            {batch.status === "authorized" && canManageBatches && (
              <DropdownMenuItem onClick={onConfirmPayments}>
                Confirmar Pagamentos
              </DropdownMenuItem>
            )}
            {batch.status === "paid" && canManageBatches && (
              <DropdownMenuItem
                className="text-amber-600 focus:text-amber-700"
                onClick={onRevert}
              >
                Reverter para Aberto
              </DropdownMenuItem>
            )}
            {batch.status === "open" && canManageBatches && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir Lote
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PaymentBatchesPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const router = useRouter();
  const { canViewBatches, canManageBatches, canApproveBatches, canPayBatches } =
    usePermissions();

  const [isLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  // Pagination & Filtering
  const [filterStatus, setFilterStatus] = useState("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const pageSize = 20;

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingBatchName, setEditingBatchName] = useState("");
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);

  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [deleteBatchId, setDeleteBatchId] = useState<string | null>(null);
  const [revertBatchId, setRevertBatchId] = useState<string | null>(null);

  // New workflow dialogs
  const [isSendForApprovalOpen, setIsSendForApprovalOpen] = useState(false);
  const [isSendForAuthorizationOpen, setIsSendForAuthorizationOpen] =
    useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [actionBatch, setActionBatch] = useState<PaymentBatch | null>(null);

  const activeFilterCount = filterStatus !== "all" ? 1 : 0;

  // Guard: redirect if no permission
  useEffect(() => {
    if (!canViewBatches) {
      router.push("/dashboard");
    }
  }, [canViewBatches, router]);

  const {
    items: batches,
    hasMore,
    loadMore,
    isLoading: isPaginatedLoading,
    isFetchingNextPage,
    refresh: fetchBatches,
  } = usePaginatedQuery<PaymentBatch>({
    queryKey: ["payment-batches", selectedCompany?.id, filterStatus],
    queryFn: async (pgSize, lastDoc) => {
      const { batches: items, lastDoc: newLastDoc } =
        await paymentBatchService.getAll(
          selectedCompany!.id,
          pgSize,
          lastDoc,
          filterStatus,
        );
      return { items, lastDoc: newLastDoc };
    },
    pageSize,
    enabled: !!selectedCompany && canViewBatches,
  });

  const kpiData = useMemo(() => {
    const open = batches.filter((b) => b.status === "open");
    const pending = batches.filter(
      (b) =>
        b.status === "pending_approval" || b.status === "pending_authorization",
    );
    const authorized = batches.filter((b) => b.status === "authorized");
    const paid = batches.filter((b) => b.status === "paid");
    return {
      openCount: open.length,
      openTotal: open.reduce((s, b) => s + b.totalAmount, 0),
      pendingCount: pending.length,
      authorizedCount: authorized.length,
      authorizedTotal: authorized.reduce((s, b) => s + b.totalAmount, 0),
      paidTotal: paid.reduce((s, b) => s + b.totalAmount, 0),
    };
  }, [batches]);

  if (!canViewBatches) return null;

  const handleCreateBatch = async () => {
    if (!selectedCompany || !user || !newBatchName.trim()) return;
    try {
      let start: Date | undefined;
      let end: Date | undefined;

      if (startDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      }

      await paymentBatchService.create(
        newBatchName,
        selectedCompany.id,
        user.uid,
        start,
        end,
      );
      toast.success("Lote criado com sucesso");
      setIsCreateOpen(false);
      setNewBatchName("");
      setStartDate(undefined);
      setEndDate(undefined);
      fetchBatches();
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error("Erro ao criar lote");
    }
  };

  const handleEditBatch = (batch: PaymentBatch) => {
    setEditingBatchId(batch.id);
    setEditingBatchName(batch.name);
    setIsEditOpen(true);
  };

  const handleUpdateBatch = async () => {
    if (!editingBatchId || !editingBatchName.trim()) return;
    try {
      await paymentBatchService.update(editingBatchId, {
        name: editingBatchName,
      });
      toast.success("Lote atualizado com sucesso");
      setIsEditOpen(false);
      setEditingBatchId(null);
      setEditingBatchName("");
      fetchBatches();
    } catch (error) {
      console.error("Error updating batch:", error);
      toast.error("Erro ao atualizar lote");
    }
  };

  const handleViewDetails = (batch: PaymentBatch) => {
    setSelectedBatch(batch);
    setIsDetailsOpen(true);
  };

  const handleOpenSendForApproval = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsSendForApprovalOpen(true);
  };

  const handleSendForApproval = async (
    _userId: string,
    approverEmail: string,
    approverName: string,
  ) => {
    if (!actionBatch || !user || !selectedCompany) return;
    try {
      const token = await paymentBatchService.sendForApproval(
        actionBatch.id,
        approverEmail,
        approverEmail,
      );
      await emailService.sendBatchApprovalRequest(
        actionBatch.name,
        actionBatch.id,
        token,
        actionBatch.transactionIds.length,
        actionBatch.totalAmount,
        user.displayName,
        approverEmail,
      );
      toast.success(
        `Lote enviado para ${approverName || approverEmail} (e-mail enviado)`,
      );
      fetchBatches();
    } catch (error) {
      console.error("Error sending for approval:", error);
      toast.error("Erro ao enviar para aprovação");
      throw error;
    }
  };

  const handleOpenApproval = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsApprovalOpen(true);
  };

  const handleApprovalComplete = async () => {
    if (!actionBatch || !selectedCompany || !user) return;
    try {
      await notificationService.notifyBatchApproved(
        actionBatch.createdBy,
        actionBatch.name,
        actionBatch.id,
        user.displayName,
        selectedCompany.id,
      );
      fetchBatches();
    } catch (error) {
      console.error("Error notifying after approval:", error);
    }
  };

  const handleOpenSendForAuthorization = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsSendForAuthorizationOpen(true);
  };

  const handleSendForAuthorization = async (
    _userId: string,
    authorizerEmail: string,
    authorizerName: string,
  ) => {
    if (!actionBatch || !user || !selectedCompany) return;
    try {
      const token = await paymentBatchService.sendForAuthorization(
        actionBatch.id,
        authorizerEmail,
        authorizerEmail,
      );
      await emailService.sendBatchAuthorizationRequest(
        actionBatch.name,
        actionBatch.id,
        token,
        actionBatch.transactionIds.length,
        actionBatch.totalAmount,
        user.displayName,
        authorizerEmail,
      );
      toast.success(
        `Lote enviado para ${authorizerName || authorizerEmail} (e-mail enviado)`,
      );
      fetchBatches();
    } catch (error) {
      console.error("Error sending for authorization:", error);
      toast.error("Erro ao enviar para autorização");
      throw error;
    }
  };

  const handleConfirmAuthorization = async (batch: PaymentBatch) => {
    if (!user || !selectedCompany) return;
    try {
      await paymentBatchService.confirmAuthorization(batch.id, user.uid);
      await notificationService.notifyBatchAuthorized(
        batch.createdBy,
        batch.name,
        batch.id,
        user.displayName,
        selectedCompany.id,
      );
      toast.success("Autorização confirmada");
      fetchBatches();
    } catch (error) {
      console.error("Error confirming authorization:", error);
      toast.error("Erro ao confirmar autorização");
    }
  };

  const handleConfirmPayments = async (batch: PaymentBatch) => {
    if (!user) return;
    try {
      await paymentBatchService.confirmPayments(batch.id, user.uid);
      toast.success("Pagamentos confirmados");
      fetchBatches();
    } catch (error) {
      console.error("Error confirming payments:", error);
      toast.error("Erro ao confirmar pagamentos");
    }
  };

  const handleRevertToOpen = async () => {
    if (!revertBatchId || !user) return;
    try {
      await paymentBatchService.revertToOpen(revertBatchId, user.uid);
      toast.success("Lote revertido para Aberto com sucesso");
      setRevertBatchId(null);
      fetchBatches();
    } catch (error) {
      console.error("Error reverting batch:", error);
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.message || "Erro ao reverter lote",
      );
    }
  };

  const handleDeleteBatch = async () => {
    if (!deleteBatchId) return;
    try {
      await paymentBatchService.delete(deleteBatchId);
      toast.success("Lote excluído com sucesso");
      setDeleteBatchId(null);
      fetchBatches();
    } catch (error) {
      console.error("Error deleting batch:", error);
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any)?.message || "Erro ao excluir lote",
      );
    }
  };

  const getResponsiblePerson = (batch: PaymentBatch) => {
    switch (batch.status) {
      case "pending_approval":
        return batch.approverEmail ? `Aprovador: ${batch.approverEmail}` : "-";
      case "pending_authorization":
        return batch.authorizerEmail
          ? `Autorizador: ${batch.authorizerEmail}`
          : "-";
      default:
        return "-";
    }
  };

  const isTableLoading =
    isLoading || (isPaginatedLoading && batches.length === 0);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap justify-between items-start md:items-center gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Lotes de Pagamento
          </h1>
          {/* Result count — mobile only */}
          {!isPaginatedLoading && (
            <span className="md:hidden text-xs text-muted-foreground tabular-nums shrink-0">
              {batches.length}
              {hasMore ? "+" : ""} lote{batches.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile: filter button */}
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Abrir filtros"
            className={cn(
              "relative md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors",
              activeFilterCount > 0
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>

          {canManageBatches && (
            <ResponsiveModal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <ResponsiveModalTrigger asChild>
                <Button size="sm" className="h-9">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline ml-2">Novo Lote</span>
                </Button>
              </ResponsiveModalTrigger>
              <ResponsiveModalContent>
                <ResponsiveModalHeader>
                  <ResponsiveModalTitle>Criar Novo Lote</ResponsiveModalTitle>
                </ResponsiveModalHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome do Lote</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Pagamentos Semana 42"
                      value={newBatchName}
                      onChange={(e) => setNewBatchName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2 flex flex-col">
                      <Label htmlFor="startDate">Data Inicial</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !startDate && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {startDate ? (
                              format(startDate, "dd/MM/yyyy", { locale: ptBR })
                            ) : (
                              <span>Selecione uma data</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={startDate}
                            onSelect={setStartDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2 flex flex-col">
                      <Label htmlFor="endDate">Data Final</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !endDate && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {endDate ? (
                              format(endDate, "dd/MM/yyyy", { locale: ptBR })
                            ) : (
                              <span>Selecione uma data</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={endDate}
                            onSelect={setEndDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Ao definir as datas, as contas em rascunho (draft) dentro
                    deste período serão adicionadas automaticamente.
                  </p>
                </div>
                <ResponsiveModalFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={handleCreateBatch}>Criar</Button>
                </ResponsiveModalFooter>
              </ResponsiveModalContent>
            </ResponsiveModal>
          )}
        </div>
      </div>

      {/* ── Mobile: active filter chip ───────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {filterStatus !== "all" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
              {STATUS_LABELS[filterStatus] ?? filterStatus}
              <button
                onClick={() => setFilterStatus("all")}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                aria-label="Remover filtro de status"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          <button
            onClick={() => setFilterStatus("all")}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors ml-1"
          >
            Limpar tudo
          </button>
        </div>
      )}

      {/* ── KPI stat strip ─────────────────────────────────────────────── */}
      {!isPaginatedLoading && batches.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4">
            <div className="px-5 py-4 border-r border-b md:border-b-0">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Em Aberto
              </p>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">
                  {kpiData.openCount}
                </span>
                <span
                  className="text-xs text-muted-foreground font-financial truncate"
                  title={formatCurrency(kpiData.openTotal)}
                >
                  {formatCurrencyAbbr(kpiData.openTotal)}
                </span>
              </div>
            </div>
            <div className="px-5 py-4 border-b md:border-b-0 md:border-r">
              <p
                className={cn(
                  "text-xs flex items-center gap-1.5",
                  kpiData.pendingCount > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                Aguardando
              </p>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    kpiData.pendingCount > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "",
                  )}
                >
                  {kpiData.pendingCount}
                </span>
                <span className="text-xs text-muted-foreground">lotes</span>
              </div>
            </div>
            <div className="px-5 py-4 border-r">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Autorizados
              </p>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
                  {kpiData.authorizedCount}
                </span>
                <span
                  className="text-xs text-muted-foreground font-financial truncate"
                  title={formatCurrency(kpiData.authorizedTotal)}
                >
                  {formatCurrencyAbbr(kpiData.authorizedTotal)}
                </span>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                Total Pago
              </p>
              <div className="mt-1.5">
                <span
                  className="text-2xl font-bold font-financial text-blue-600 dark:text-blue-400"
                  title={formatCurrency(kpiData.paidTotal)}
                >
                  <span className="md:hidden">
                    {formatCurrencyAbbr(kpiData.paidTotal)}
                  </span>
                  <span className="hidden md:inline">
                    {formatCurrency(kpiData.paidTotal)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop: status filter bar ───────────────────────────────── */}
      <div className="hidden md:flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Status</Label>
        <Select
          value={filterStatus}
          onValueChange={(value) => setFilterStatus(value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="open">Aberto</SelectItem>
            <SelectItem value="pending_approval">
              Aguardando Aprovação
            </SelectItem>
            <SelectItem value="approved">Aprovado</SelectItem>
            <SelectItem value="pending_authorization">
              Aguardando Autorização
            </SelectItem>
            <SelectItem value="authorized">Autorizado</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Mobile: card list ────────────────────────────────────────── */}
      <div className="md:hidden border rounded-lg overflow-hidden">
        {isTableLoading ? (
          <MobileCardSkeleton />
        ) : batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4 text-center text-muted-foreground">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium">Nenhum lote encontrado</p>
            <p className="text-sm mt-1 max-w-xs">
              {filterStatus === "all"
                ? "Crie um novo lote para agrupar e gerenciar pagamentos."
                : `Não há lotes com status "${STATUS_LABELS[filterStatus] ?? filterStatus}".`}
            </p>
            {filterStatus !== "all" ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setFilterStatus("all")}
              >
                Ver todos os lotes
              </Button>
            ) : canManageBatches ? (
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Criar Primeiro Lote
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="divide-y">
              {batches.map((batch) => (
                <MobileBatchCard
                  key={batch.id}
                  batch={batch}
                  canManageBatches={canManageBatches}
                  canApproveBatches={canApproveBatches}
                  canPayBatches={canPayBatches}
                  onViewDetails={() => handleViewDetails(batch)}
                  onApprove={() => handleOpenApproval(batch)}
                  onSendForApproval={() => handleOpenSendForApproval(batch)}
                  onSendForAuthorization={() =>
                    handleOpenSendForAuthorization(batch)
                  }
                  onConfirmAuthorization={() =>
                    handleConfirmAuthorization(batch)
                  }
                  onConfirmPayments={() => handleConfirmPayments(batch)}
                  onEdit={() => handleEditBatch(batch)}
                  onDelete={() => setDeleteBatchId(batch.id)}
                  onRevert={() => setRevertBatchId(batch.id)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center p-4 border-t">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Carregar Mais
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Desktop: table ───────────────────────────────────────────── */}
      <div className="hidden md:block border rounded-lg">
        {isTableLoading ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Transações</TableHead>
                <TableHead>Valor Total</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-36" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-8 w-8 ml-auto" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Transações</TableHead>
                  <TableHead>Valor Total</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="rounded-full bg-muted p-4 mb-4">
                          <Package className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <p className="font-medium text-lg">
                          Nenhum lote encontrado
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                          {filterStatus === "all"
                            ? "Crie um novo lote para agrupar e gerenciar pagamentos."
                            : `Não há lotes com status "${STATUS_LABELS[filterStatus] ?? filterStatus}".`}
                        </p>
                        {filterStatus !== "all" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={() => setFilterStatus("all")}
                          >
                            Ver todos os lotes
                          </Button>
                        )}
                        {canManageBatches && filterStatus === "all" && (
                          <Button
                            size="sm"
                            className="mt-4"
                            onClick={() => setIsCreateOpen(true)}
                          >
                            <Plus className="mr-2 h-4 w-4" /> Criar Primeiro
                            Lote
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium">
                        {batch.name}
                      </TableCell>
                      <TableCell>{getStatusBadge(batch.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getResponsiblePerson(batch)}
                      </TableCell>
                      <TableCell>{batch.transactionIds.length}</TableCell>
                      <TableCell className="font-financial">
                        {formatCurrency(batch.totalAmount)}
                      </TableCell>
                      <TableCell>
                        {format(batch.createdAt, "dd/MM/yyyy", {
                          locale: ptBR,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {batch.status === "pending_approval" &&
                            canApproveBatches && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                                onClick={() => handleOpenApproval(batch)}
                              >
                                Aprovar
                              </Button>
                            )}
                          {batch.status === "pending_authorization" &&
                            canPayBatches && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-teal-200 text-teal-700 hover:bg-teal-50"
                                onClick={() =>
                                  handleConfirmAuthorization(batch)
                                }
                              >
                                Autorizar
                              </Button>
                            )}
                          {batch.status === "authorized" &&
                            canManageBatches && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                                onClick={() => handleConfirmPayments(batch)}
                              >
                                Confirmar Pgto
                              </Button>
                            )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Ações</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => handleViewDetails(batch)}
                              >
                                Ver Detalhes
                              </DropdownMenuItem>
                              {canManageBatches && (
                                <DropdownMenuItem
                                  onClick={() => handleEditBatch(batch)}
                                >
                                  <Edit className="mr-2 h-4 w-4" /> Editar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {batch.status === "open" && canManageBatches && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleOpenSendForApproval(batch)
                                  }
                                >
                                  Enviar para Aprovador
                                </DropdownMenuItem>
                              )}
                              {batch.status === "pending_approval" &&
                                canApproveBatches && (
                                  <DropdownMenuItem
                                    onClick={() => handleOpenApproval(batch)}
                                  >
                                    Aprovar Lote
                                  </DropdownMenuItem>
                                )}
                              {batch.status === "approved" &&
                                canManageBatches && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleOpenSendForAuthorization(batch)
                                    }
                                  >
                                    Enviar para Autorização
                                  </DropdownMenuItem>
                                )}
                              {batch.status === "pending_authorization" &&
                                canPayBatches && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleConfirmAuthorization(batch)
                                    }
                                  >
                                    Confirmar Autorização
                                  </DropdownMenuItem>
                                )}
                              {batch.status === "authorized" &&
                                canManageBatches && (
                                  <DropdownMenuItem
                                    onClick={() => handleConfirmPayments(batch)}
                                  >
                                    Confirmar Pagamentos
                                  </DropdownMenuItem>
                                )}
                              {batch.status === "paid" && canManageBatches && (
                                <DropdownMenuItem
                                  className="text-amber-600 focus:text-amber-700"
                                  onClick={() => setRevertBatchId(batch.id)}
                                >
                                  Reverter para Aberto
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {batch.status === "open" && canManageBatches && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteBatchId(batch.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                  Lote
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {hasMore && (
              <div className="flex justify-center p-4 border-t">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Carregar Mais
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mobile filter sheet ──────────────────────────────────────── */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[92dvh] overflow-y-auto px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 shrink-0" />
          <SheetTitle className="mb-4 text-base font-semibold">
            Filtros
          </SheetTitle>
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <Select
                value={filterStatus}
                onValueChange={(val) => setFilterStatus(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="pending_approval">
                    Aguardando Aprovação
                  </SelectItem>
                  <SelectItem value="approved">Aprovado</SelectItem>
                  <SelectItem value="pending_authorization">
                    Aguardando Autorização
                  </SelectItem>
                  <SelectItem value="authorized">Autorizado</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setFilterStatus("all");
                  setMobileFiltersOpen(false);
                }}
              >
                Limpar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setMobileFiltersOpen(false);
                  toast.success("Filtros aplicados");
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Details Dialog ───────────────────────────────────────────── */}
      <BatchDetailsDialog
        batch={selectedBatch}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onUpdate={fetchBatches}
      />

      {/* ── Edit Dialog ──────────────────────────────────────────────── */}
      <ResponsiveModal open={isEditOpen} onOpenChange={setIsEditOpen}>
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Editar Lote</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome do Lote</Label>
              <Input
                id="edit-name"
                placeholder="Ex: Pagamentos Semana 42"
                value={editingBatchName}
                onChange={(e) => setEditingBatchName(e.target.value)}
              />
            </div>
          </div>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateBatch}>Salvar</Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* ── Send for Approval Dialog ─────────────────────────────────── */}
      {selectedCompany && (
        <BatchSendDialog
          isOpen={isSendForApprovalOpen}
          onClose={() => {
            setIsSendForApprovalOpen(false);
            setActionBatch(null);
          }}
          onSend={handleSendForApproval}
          companyId={selectedCompany.id}
          title="Enviar para Aprovador"
          description="Digite o e-mail do aprovador. Um link de aprovação será enviado — o destinatário não precisa ser usuário do sistema."
          buttonText="Enviar para Aprovação"
        />
      )}

      {/* ── Approval Dialog ──────────────────────────────────────────── */}
      {user && (
        <BatchApprovalDialog
          batch={actionBatch}
          isOpen={isApprovalOpen}
          onClose={() => {
            setIsApprovalOpen(false);
            setActionBatch(null);
          }}
          onApprove={handleApprovalComplete}
          userId={user.uid}
        />
      )}

      {/* ── Send for Authorization Dialog ────────────────────────────── */}
      {selectedCompany && (
        <BatchSendDialog
          isOpen={isSendForAuthorizationOpen}
          onClose={() => {
            setIsSendForAuthorizationOpen(false);
            setActionBatch(null);
          }}
          onSend={handleSendForAuthorization}
          companyId={selectedCompany.id}
          title="Enviar para Autorização"
          description="Digite o e-mail do autorizador. Um link de autorização será enviado — o destinatário não precisa ser usuário do sistema."
          buttonText="Enviar para Autorização"
        />
      )}

      <ConfirmDialog
        open={!!deleteBatchId}
        onOpenChange={(open) => !open && setDeleteBatchId(null)}
        title="Excluir Lote"
        description="Tem certeza que deseja excluir este lote? As transações vinculadas voltarão para o status 'sem lote', mas não serão excluídas."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDeleteBatch}
      />

      <ConfirmDialog
        open={!!revertBatchId}
        onOpenChange={(open) => !open && setRevertBatchId(null)}
        title="Reverter Lote para Aberto"
        description="Esta ação irá reverter o status do lote de 'Pago' para 'Aberto' e todas as transações voltarão para o status 'Rascunho'. Use esta opção apenas se o pagamento foi confirmado incorretamente. Deseja continuar?"
        confirmText="Reverter Lote"
        variant="destructive"
        onConfirm={handleRevertToOpen}
      />
    </div>
  );
}
