"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import currency from "currency.js";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  BatchActor,
  canActOnBatch,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { notificationService } from "@/lib/services/notificationService";
import { emailService } from "@/lib/services/emailService";
import { PaymentBatch, PaymentBatchStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Plus,
  MoreHorizontal,
  Loader2,
  CalendarIcon,
  Trash2,
  Package,
  Pencil,
  Undo2,
  Eye,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatCurrencyAbbr, cn, plural } from "@/lib/utils";
import { differenceInDays, format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BatchDetailsDialog } from "@/components/features/finance/BatchDetailsDialog";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import { BatchApprovalDialog } from "@/components/features/finance/BatchApprovalDialog";
import { BatchStatusBadge } from "@/components/features/finance/batchStatus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { Skeleton } from "@/components/ui/skeleton";

// ── Abas: agrupam os status por quem precisa agir ──────────────────────────

type TabId = "to_send" | "in_review" | "to_pay" | "paid" | "rejected" | "all";

const TABS: { id: TabId; label: string; statuses: PaymentBatchStatus[] }[] = [
  { id: "to_send", label: "A enviar", statuses: ["open"] },
  {
    id: "in_review",
    label: "Em aprovação",
    statuses: ["pending_approval", "pending_authorization"],
  },
  { id: "to_pay", label: "A pagar", statuses: ["approved", "authorized"] },
  { id: "paid", label: "Pagos", statuses: ["paid"] },
  { id: "rejected", label: "Rejeitados", statuses: ["rejected"] },
  { id: "all", label: "Todos", statuses: [] },
];

const EMPTY: Record<TabId, string> = {
  to_send: "Nenhum lote aberto. Crie um lote para agrupar as contas da semana.",
  in_review: "Nenhum lote aguardando aprovação ou autorização.",
  to_pay: "Nenhum lote aprovado aguardando pagamento.",
  paid: "Nenhum lote pago ainda.",
  rejected: "Nenhum lote rejeitado.",
  all: "Nenhum lote criado. Crie um lote para agrupar e aprovar pagamentos.",
};

/** Lote parado há mais que isso sem andar de etapa ganha destaque. */
const STALE_DAYS = 7;

// ── Próximo passo de cada lote ─────────────────────────────────────────────

type ActionKind =
  | "send_approval"
  | "approve"
  | "send_authorization"
  | "authorize"
  | "confirm_payment";

interface NextStep {
  /** Quem precisa agir agora. */
  who: string;
  /** O que precisa ser feito, em minúsculas para compor a frase. */
  what: string;
  mine: boolean;
  since?: Date;
  expired?: boolean;
  action?: { kind: ActionKind; label: string };
}

interface StepContext {
  actor: BatchActor | null;
  canManage: boolean;
  canApprove: boolean;
  canPay: boolean;
}

function nextStep(b: PaymentBatch, ctx: StepContext): NextStep | null {
  const manager = "Gestor financeiro";
  const expired =
    !!b.approvalTokenExpiresAt && b.approvalTokenExpiresAt < new Date();
  const designated = !!ctx.actor && canActOnBatch(b, ctx.actor);

  switch (b.status) {
    case "open":
      return {
        who: manager,
        what: "enviar para aprovação",
        mine: ctx.canManage,
        since: b.revertedAt ?? b.createdAt,
        action:
          ctx.canManage && b.transactionIds.length > 0
            ? { kind: "send_approval", label: "Enviar para aprovação" }
            : undefined,
      };
    case "pending_approval": {
      const mine = ctx.canApprove && designated;
      return {
        who: b.approverName || b.approverEmail || "Aprovador",
        what: "aprovar",
        mine,
        since: b.sentForApprovalAt,
        expired,
        action: mine
          ? { kind: "approve", label: "Aprovar" }
          : expired && ctx.canManage
            ? { kind: "send_approval", label: "Reenviar link" }
            : undefined,
      };
    }
    case "approved":
      return {
        who: manager,
        what: "enviar para autorização",
        mine: ctx.canManage,
        since: b.approvedAt,
        action: ctx.canManage
          ? { kind: "send_authorization", label: "Enviar para autorização" }
          : undefined,
      };
    case "pending_authorization": {
      const mine = ctx.canPay && designated;
      return {
        who: b.authorizerName || b.authorizerEmail || "Autorizador",
        what: "autorizar no banco",
        mine,
        since: b.sentForAuthorizationAt,
        expired,
        action: mine
          ? { kind: "authorize", label: "Autorizar" }
          : expired && ctx.canManage
            ? { kind: "send_authorization", label: "Reenviar link" }
            : undefined,
      };
    }
    case "authorized":
      return {
        who: manager,
        what: "confirmar pagamento",
        mine: ctx.canManage,
        since: b.authorizedAt,
        action: ctx.canManage
          ? { kind: "confirm_payment", label: "Confirmar pagamento" }
          : undefined,
      };
    default:
      return null;
  }
}

function periodLabel(b: PaymentBatch) {
  if (!b.startDate || !b.endDate) return null;
  const sameYear = b.startDate.getFullYear() === b.endDate.getFullYear();
  return `${format(b.startDate, sameYear ? "dd/MM" : "dd/MM/yyyy")} a ${format(b.endDate, "dd/MM/yyyy")}`;
}

/** Erro do serviço já vem em português; o do Firestore, não. */
function errorMessage(error: unknown, fallback: string) {
  if ((error as { code?: string })?.code === "permission-denied")
    return "Você não tem permissão para esta ação.";
  return error instanceof Error && error.message ? error.message : fallback;
}

function StepCell({
  step,
  batch,
}: {
  step: NextStep | null;
  batch: PaymentBatch;
}) {
  if (!step) {
    return (
      <span className="text-sm text-muted-foreground">
        {batch.status === "paid" && batch.paidAt
          ? `Pago em ${format(batch.paidAt, "dd/MM/yyyy")}`
          : "Sem pendência"}
      </span>
    );
  }
  const stale =
    !!step.since && differenceInDays(new Date(), step.since) > STALE_DAYS;
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn(
          "truncate text-sm",
          step.mine ? "font-medium text-foreground" : "text-muted-foreground",
        )}
        title={step.who}
      >
        {step.mine ? "Você" : step.who}
        <span className="font-normal text-muted-foreground">: {step.what}</span>
      </span>
      {step.expired ? (
        <span className="text-xs text-red-600 dark:text-red-400">
          Link expirado
        </span>
      ) : (
        step.since && (
          <span
            className={cn(
              "text-xs tabular-nums",
              stale
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
            title={format(step.since, "dd/MM/yyyy HH:mm")}
          >
            {stale ? "parado " : ""}
            {formatDistanceToNowStrict(step.since, {
              locale: ptBR,
              addSuffix: true,
            })}
          </span>
        )
      )}
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────

export default function PaymentBatchesPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const router = useRouter();
  const { canViewBatches, canManageBatches, canApproveBatches, canPayBatches } =
    usePermissions();

  const [tab, setTab] = useState<TabId>(
    canManageBatches ? "to_send" : "in_review",
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  const [editingBatch, setEditingBatch] = useState<PaymentBatch | null>(null);
  const [editingBatchName, setEditingBatchName] = useState("");

  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [deleteBatch, setDeleteBatch] = useState<PaymentBatch | null>(null);
  const [revertBatch, setRevertBatch] = useState<PaymentBatch | null>(null);
  const [revertReason, setRevertReason] = useState("");
  const [confirmStep, setConfirmStep] = useState<{
    kind: "authorize" | "confirm_payment";
    batch: PaymentBatch;
  } | null>(null);

  const [sendKind, setSendKind] = useState<
    "send_approval" | "send_authorization" | null
  >(null);
  const [approvalBatch, setApprovalBatch] = useState<PaymentBatch | null>(null);
  const [actionBatch, setActionBatch] = useState<PaymentBatch | null>(null);

  const actor: BatchActor | null = user
    ? { uid: user.uid, email: user.email ?? "" }
    : null;
  const ctx: StepContext = {
    actor,
    canManage: canManageBatches,
    canApprove: canApproveBatches,
    canPay: canPayBatches,
  };

  useEffect(() => {
    if (!canViewBatches) router.push("/dashboard");
  }, [canViewBatches, router]);

  const statuses = TABS.find((t) => t.id === tab)!.statuses;

  const {
    items: batches,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    refresh: refreshList,
  } = usePaginatedQuery<PaymentBatch>({
    queryKey: ["payment-batches", selectedCompany?.id, tab],
    queryFn: async (pgSize, lastDoc) => {
      const { batches: items, lastDoc: newLastDoc } =
        await paymentBatchService.getAll(
          selectedCompany!.id,
          pgSize,
          lastDoc,
          statuses,
        );
      return { items, lastDoc: newLastDoc };
    },
    pageSize: 20,
    enabled: !!selectedCompany && canViewBatches,
  });

  // Contagem e total de TODOS os lotes da empresa, não só da página carregada
  const summaryQuery = useQuery({
    queryKey: ["payment-batches-summary", selectedCompany?.id],
    queryFn: () => paymentBatchService.getStatusSummary(selectedCompany!.id),
    enabled: !!selectedCompany && canViewBatches,
  });
  const tabTotals = (id: TabId) => {
    const summary = summaryQuery.data;
    if (!summary) return null;
    const t = TABS.find((x) => x.id === id)!;
    const list = t.statuses.length
      ? t.statuses
      : (Object.keys(summary) as PaymentBatchStatus[]);
    return {
      count: list.reduce((n, s) => n + summary[s].count, 0),
      total: list.reduce((acc, s) => acc.add(summary[s].total), currency(0))
        .value,
    };
  };
  const visibleTabs = TABS.filter(
    (t) => t.id !== "rejected" || (tabTotals("rejected")?.count ?? 0) > 0,
  );

  const refresh = () => {
    refreshList();
    summaryQuery.refetch();
  };

  if (!canViewBatches) return null;

  // ── Criar / renomear / excluir ───────────────────────────────────────────

  const suggestedName =
    startDate && endDate
      ? `Pagamentos ${format(startDate, "dd/MM")} a ${format(endDate, "dd/MM/yyyy")}`
      : "";
  const invalidRange = !!startDate && !!endDate && startDate > endDate;

  const handleCreateBatch = async () => {
    const name = newBatchName.trim() || suggestedName;
    if (!selectedCompany || !user || !name || invalidRange) return;
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
        name,
        selectedCompany.id,
        user.uid,
        start,
        end,
      );
      toast.success(`Lote "${name}" criado`);
      setIsCreateOpen(false);
      setNewBatchName("");
      setStartDate(undefined);
      setEndDate(undefined);
      setTab("to_send");
      refresh();
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error(errorMessage(error, "Erro ao criar lote"));
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
      setDeleteBatch(null);
      refresh();
    } catch (error) {
      console.error("Error deleting batch:", error);
      toast.error(errorMessage(error, "Erro ao excluir lote"));
      throw error;
    }
  };

  // ── Fluxo ────────────────────────────────────────────────────────────────

  const runAction = (batch: PaymentBatch, kind: ActionKind) => {
    if (kind === "approve") setApprovalBatch(batch);
    else if (kind === "send_approval" || kind === "send_authorization") {
      setActionBatch(batch);
      setSendKind(kind);
    } else setConfirmStep({ kind, batch });
  };

  const handleSend = async (_userId: string, email: string, name: string) => {
    if (!actionBatch || !actor || !user || !sendKind) return;
    const forApproval = sendKind === "send_approval";
    try {
      const recipient = { email, name: name !== email ? name : undefined };
      const token = forApproval
        ? await paymentBatchService.sendForApproval(
            actionBatch.id,
            recipient,
            actor,
          )
        : await paymentBatchService.sendForAuthorization(
            actionBatch.id,
            recipient,
            actor,
          );
      const send = forApproval
        ? emailService.sendBatchApprovalRequest
        : emailService.sendBatchAuthorizationRequest;
      await send(
        actionBatch.name,
        actionBatch.id,
        token,
        actionBatch.transactionIds.length,
        actionBatch.totalAmount,
        user.displayName,
        email,
      );
      toast.success(`Link enviado para ${name || email}. Vale por 48 horas.`);
      refresh();
    } catch (error) {
      console.error("Error sending batch:", error);
      toast.error(
        errorMessage(
          error,
          forApproval
            ? "Erro ao enviar para aprovação"
            : "Erro ao enviar para autorização",
        ),
      );
      throw error;
    }
  };

  const handleApprovalComplete = async () => {
    if (!approvalBatch || !selectedCompany || !user) return;
    refresh();
    try {
      await notificationService.notifyBatchApproved(
        approvalBatch.createdBy,
        approvalBatch.name,
        approvalBatch.id,
        user.displayName,
        selectedCompany.id,
      );
    } catch (error) {
      console.error("Error notifying after approval:", error);
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

  // ── Peças da tabela ──────────────────────────────────────────────────────

  const renderMenu = (batch: PaymentBatch) => (
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
        <DropdownMenuItem onClick={() => setSelectedBatch(batch)}>
          <Eye className="mr-2 h-4 w-4" /> Ver transações
        </DropdownMenuItem>
        {canManageBatches && (
          <DropdownMenuItem
            onClick={() => {
              setEditingBatch(batch);
              setEditingBatchName(batch.name);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" /> Renomear
          </DropdownMenuItem>
        )}
        {batch.status === "paid" && canManageBatches && (
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
        {batch.status === "open" && canManageBatches && (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderAction = (batch: PaymentBatch, step: NextStep | null) =>
    step?.action && (
      <Button
        size="sm"
        variant={
          step.action.kind === "confirm_payment" ||
          step.action.kind === "authorize"
            ? "default"
            : "outline"
        }
        className="h-8 whitespace-nowrap text-xs"
        onClick={() => runAction(batch, step.action!.kind)}
      >
        {step.action.label}
      </Button>
    );

  const activeTotals = tabTotals(tab);
  const remaining = activeTotals ? activeTotals.count - batches.length : null;
  const isTableLoading = isLoading && batches.length === 0;

  const emptyState = (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <Package className="mb-3 h-8 w-8 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">{EMPTY[tab]}</p>
      {canManageBatches && (tab === "to_send" || tab === "all") && (
        <Button
          size="sm"
          className="mt-4"
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" /> Novo lote
        </Button>
      )}
    </div>
  );

  const loadMoreButton = hasMore && (
    <div className="flex justify-center border-t p-3">
      <Button
        variant="outline"
        size="sm"
        onClick={loadMore}
        disabled={isFetchingNextPage}
      >
        {isFetchingNextPage && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        Carregar mais
        {remaining !== null && remaining > 0 && (
          <span className="ml-1 text-muted-foreground">
            ({remaining} restantes)
          </span>
        )}
      </Button>
    </div>
  );

  const COLUMNS = (
    <TableRow>
      <TableHead>Lote</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Próximo passo</TableHead>
      <TableHead className="text-right">Transações</TableHead>
      <TableHead className="text-right">Valor total</TableHead>
      <TableHead className="w-px text-right">
        <span className="sr-only">Ações</span>
      </TableHead>
    </TableRow>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight md:text-3xl">
          Lotes de Pagamento
        </h1>

        {canManageBatches && (
          <ResponsiveModal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <ResponsiveModalTrigger asChild>
              <Button size="sm" className="h-9">
                <Plus className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Novo lote</span>
                <span className="sr-only sm:hidden">Novo lote</span>
              </Button>
            </ResponsiveModalTrigger>
            <ResponsiveModalContent>
              <ResponsiveModalHeader>
                <ResponsiveModalTitle>Novo lote</ResponsiveModalTitle>
              </ResponsiveModalHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["startDate", "Vencimento de", startDate, setStartDate],
                      ["endDate", "Vencimento até", endDate, setEndDate],
                    ] as const
                  ).map(([id, label, value, setValue]) => (
                    <div key={id} className="flex flex-col space-y-2">
                      <Label htmlFor={id}>{label}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            id={id}
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !value && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {value ? format(value, "dd/MM/yyyy") : "Selecione"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={value}
                            onSelect={setValue}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}
                </div>
                {invalidRange ? (
                  <p className="text-sm text-destructive">
                    A data inicial precisa ser anterior à final.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    As contas em rascunho com vencimento no período entram no
                    lote automaticamente.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="batch-name">Nome</Label>
                  <Input
                    id="batch-name"
                    placeholder={suggestedName || "Ex.: Pagamentos semana 44"}
                    value={newBatchName}
                    onChange={(e) => setNewBatchName(e.target.value)}
                  />
                </div>
              </div>
              <ResponsiveModalFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreateBatch}
                  disabled={
                    invalidRange || !(newBatchName.trim() || suggestedName)
                  }
                >
                  Criar lote
                </Button>
              </ResponsiveModalFooter>
            </ResponsiveModalContent>
          </ResponsiveModal>
        )}
      </div>

      <div className="rounded-xl border bg-card">
        {/* ── Abas por etapa, com contagem e total do servidor ─────────── */}
        <div
          role="tablist"
          aria-label="Etapa dos lotes"
          className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleTabs.map((t) => {
            const selected = t.id === tab;
            const totals = tabTotals(t.id);
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex shrink-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md",
                  selected
                    ? "after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {t.label}
                  {totals === null ? (
                    summaryQuery.isError ? null : (
                      <Skeleton className="h-4 w-5 rounded-full" />
                    )
                  ) : (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {totals.count}
                    </span>
                  )}
                </span>
                <span className="text-xs font-financial tabular-nums text-muted-foreground">
                  {totals ? (
                    <>
                      <span className="sm:hidden">
                        {formatCurrencyAbbr(totals.total)}
                      </span>
                      <span className="hidden sm:inline">
                        {formatCurrency(totals.total)}
                      </span>
                    </>
                  ) : (
                    " "
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Mobile: lista ─────────────────────────────────────────────── */}
        <div className="md:hidden">
          {isTableLoading ? (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 px-4 py-3.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : batches.length === 0 ? (
            emptyState
          ) : (
            <ul className="divide-y">
              {batches.map((batch) => {
                const step = nextStep(batch, ctx);
                const period = periodLabel(batch);
                return (
                  <li
                    key={batch.id}
                    className="flex items-start gap-2 px-4 py-3.5"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedBatch(batch)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium">
                          {batch.name}
                        </p>
                        <span
                          className="shrink-0 text-sm font-semibold font-financial tabular-nums"
                          title={formatCurrency(batch.totalAmount)}
                        >
                          {formatCurrencyAbbr(batch.totalAmount)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <BatchStatusBadge status={batch.status} />
                        <span>
                          {plural(
                            batch.transactionIds.length,
                            "transação",
                            "transações",
                          )}
                        </span>
                        {period && <span>{period}</span>}
                      </div>
                      <div className="mt-1.5">
                        <StepCell step={step} batch={batch} />
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {renderAction(batch, step)}
                      {renderMenu(batch)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {loadMoreButton}
        </div>

        {/* ── Desktop: tabela ───────────────────────────────────────────── */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>{COLUMNS}</TableHeader>
            <TableBody>
              {isTableLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-56" />
                      <Skeleton className="mt-1.5 h-3 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-8" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-8 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : batches.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6}>{emptyState}</TableCell>
                </TableRow>
              ) : (
                batches.map((batch) => {
                  const step = nextStep(batch, ctx);
                  const period = periodLabel(batch);
                  return (
                    <TableRow
                      key={batch.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedBatch(batch)}
                    >
                      <TableCell className="max-w-0 w-[34%]">
                        <button
                          type="button"
                          className="block max-w-full truncate rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={batch.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBatch(batch);
                          }}
                        >
                          {batch.name}
                        </button>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {period
                            ? `Vencimentos de ${period}`
                            : `Criado em ${format(batch.createdAt, "dd/MM/yyyy")}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <BatchStatusBadge status={batch.status} />
                      </TableCell>
                      <TableCell className="max-w-0 w-[24%]">
                        <StepCell step={step} batch={batch} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {batch.transactionIds.length}
                      </TableCell>
                      <TableCell className="text-right font-financial tabular-nums">
                        {formatCurrency(batch.totalAmount)}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {renderAction(batch, step)}
                          {renderMenu(batch)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {loadMoreButton}
        </div>
      </div>

      {/* ── Diálogos ─────────────────────────────────────────────────────── */}
      <BatchDetailsDialog
        batch={selectedBatch}
        isOpen={!!selectedBatch}
        onClose={() => setSelectedBatch(null)}
        onUpdate={refresh}
      />

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
            setActionBatch(null);
          }}
          onSend={handleSend}
          companyId={selectedCompany.id}
          title={
            sendKind === "send_authorization"
              ? "Enviar para autorização"
              : "Enviar para aprovação"
          }
          description={
            sendKind === "send_authorization"
              ? `${actionBatch?.name ?? ""}: o autorizador recebe um link que vale por 48 horas e não precisa ter conta no sistema. Você não pode autorizar um lote que enviou.`
              : `${actionBatch?.name ?? ""}: o aprovador recebe um link que vale por 48 horas e não precisa ter conta no sistema. Você não pode aprovar um lote que enviou.`
          }
          buttonText="Enviar link"
        />
      )}

      {actor && (
        <BatchApprovalDialog
          batch={approvalBatch}
          isOpen={!!approvalBatch}
          onClose={() => setApprovalBatch(null)}
          onApprove={handleApprovalComplete}
          actor={actor}
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
              ? `${plural(confirmStep.batch.transactionIds.length, "transação", "transações")}, total de ${formatCurrency(confirmStep.batch.totalAmount)}. Autorize só depois de liberar o lote no internet banking.`
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
    </div>
  );
}
