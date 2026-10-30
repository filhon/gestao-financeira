"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import currency from "currency.js";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Download,
  Loader2,
  PackageOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { useBatchActions } from "@/hooks/useBatchActions";
import { useCostCenters } from "@/hooks/useCostCenters";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import {
  effectiveAmount,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { transactionService } from "@/lib/services/transactionService";
import { entityService } from "@/lib/services/entityService";
import { reportService } from "@/lib/services/reportService";
import { notificationService } from "@/lib/services/notificationService";
import { emailService } from "@/lib/services/emailService";
import { Transaction } from "@/lib/types";
import { cn, formatCurrency, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BatchStatusBadge } from "@/components/features/finance/batchStatus";
import { BatchApprovalPanel } from "@/components/features/finance/BatchApprovalPanel";
import { exportBatchXlsx } from "@/components/features/finance/exportBatch";
import {
  StepCell,
  TONE,
  dueUrgency,
  errorMessage,
  nextStep,
  periodLabel,
} from "@/components/features/finance/batchWorkflow";

const MISSING_LIMIT = 50;
const TH = "text-xs font-medium text-muted-foreground";

type SortKey =
  | "dueDate"
  | "description"
  | "supplierOrClient"
  | "amount"
  | "status";

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
  alignRight,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: unknown; direction: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  className?: string;
  alignRight?: boolean;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active
    ? ArrowUpDown
    : sort?.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <TableHead
      className={cn(TH, alignRight && "text-right", className)}
      aria-sort={
        active
          ? sort?.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          alignRight && "flex-row-reverse",
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}

export default function PaymentBatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canViewBatches, canManageBatches } = usePermissions();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [openTxId, setOpenTxId] = useState<string | null>(null);

  // Aprovar já está na própria página: o botão do cabeçalho some nesse caso
  const actions = useBatchActions({
    onApprove: () => {},
    onDeleted: () => router.push("/financeiro/lotes"),
  });
  const refresh = actions.refresh;

  useEffect(() => {
    if (!canViewBatches) router.push("/dashboard");
  }, [canViewBatches, router]);

  const batchQuery = useQuery({
    queryKey: ["payment-batch", id],
    queryFn: () => paymentBatchService.getById(id),
    enabled: canViewBatches && !!id,
  });
  const batch = batchQuery.data;
  // Lote de outra empresa (troca de empresa com a página aberta) não aparece
  const visible = !!batch && batch.companyId === selectedCompany?.id;

  const txQuery = useQuery({
    queryKey: ["payment-batch", id, "transactions"],
    queryFn: () => transactionService.getAll({ batchId: id }),
    enabled: visible,
  });
  const transactions = txQuery.data ?? [];

  const canEdit = visible && batch?.status === "open" && canManageBatches;
  const missingQuery = useQuery({
    queryKey: ["payment-batch", id, "missing"],
    queryFn: () =>
      transactionService.getAll({
        companyId: batch!.companyId,
        startDate: batch!.startDate,
        endDate: batch!.endDate,
        status: "draft",
        type: "payable",
        batchId: null,
        limit: MISSING_LIMIT,
      }),
    enabled: canEdit && !!batch?.startDate && !!batch?.endDate,
  });
  const missing = canEdit ? (missingQuery.data ?? []) : [];

  const {
    items: sorted,
    requestSort,
    sortConfig,
  } = useSortableData(transactions);

  // Detalhe da transação no painel lateral, navegando pela ordem da tabela
  const openTx = sorted.find((t) => t.id === openTxId) ?? null;
  const { costCenters } = useCostCenters(
    openTxId ? selectedCompany?.id : undefined,
  );
  const moveTx = (delta: number) => {
    const i = sorted.findIndex((t) => t.id === openTxId);
    const next = sorted[i + delta];
    if (next) setOpenTxId(next.id);
  };

  if (!canViewBatches) return null;

  if (batchQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (batchQuery.isError || !batch || !visible) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm">
          {batchQuery.isError
            ? "Não foi possível carregar o lote."
            : "Lote não encontrado nesta empresa."}
        </p>
        <div className="mt-4 flex gap-2">
          {batchQuery.isError && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchQuery.refetch()}
            >
              Tentar de novo
            </Button>
          )}
          <Button size="sm" asChild>
            <Link href="/financeiro/lotes">Voltar para os lotes</Link>
          </Button>
        </div>
      </div>
    );
  }

  const step = nextStep(batch, actions.ctx);
  const approving = step?.action?.kind === "approve" && !!actions.actor;
  const period = periodLabel(batch);
  const urgency = dueUrgency(batch);
  const liveTotal = transactions.reduce(
    (acc, t) => acc.add(effectiveAmount(t)),
    currency(0),
  ).value;

  // ── Ações nas transações ────────────────────────────────────────────────

  const handleRemove = async () => {
    const toRemove = transactions.filter((t) => removeIds.includes(t.id));
    try {
      await paymentBatchService.removeTransactions(batch.id, toRemove);
      toast.success(
        `${plural(toRemove.length, "transação removida", "transações removidas")} do lote`,
      );
      setRemoveIds([]);
      setSelectedIds(new Set());
      refresh();
    } catch (error) {
      console.error("Error removing transactions", error);
      toast.error(errorMessage(error, "Erro ao remover transações"));
      throw error;
    }
  };

  const handleAdd = async (tx: Transaction) => {
    setAddingId(tx.id);
    try {
      const result = await paymentBatchService.addTransactionsWithApprovalCheck(
        batch.id,
        [tx],
      );
      if (result.token && result.approverEmail && result.batchName) {
        try {
          await emailService.sendBatchNewTransactionsNotification(
            result.batchName,
            batch.id,
            result.token,
            result.newTransactionCount,
            result.additionalAmount,
            user?.displayName ?? "Gestor Financeiro",
            result.approverEmail,
          );
        } catch (emailErr) {
          console.error("Error sending re-approval notification:", emailErr);
        }
        toast.success(
          "Transação adicionada. O aprovador foi avisado por e-mail para revisar o lote.",
        );
      } else {
        toast.success("Transação adicionada ao lote");
      }
      refresh();
    } catch (error) {
      console.error("Error adding transaction", error);
      toast.error(errorMessage(error, "Erro ao adicionar transação"));
    } finally {
      setAddingId(null);
    }
  };

  const handleExport = async () => {
    if (!user) return;
    setIsExporting(true);
    try {
      await exportBatchXlsx({ batch, transactions, user, queryClient });
    } catch (error) {
      console.error("Error exporting batch", error);
      toast.error("Não foi possível exportar o lote. Tente novamente.");
    } finally {
      setIsExporting(false);
    }
  };

  // Guia para quem executa no banco: só o que ainda falta pagar no lote.
  const handleTransferGuide = async () => {
    const toPay = transactions.filter(
      (t) =>
        t.type === "payable" && t.status !== "paid" && t.status !== "rejected",
    );
    if (
      !toPay.some(
        (t) => t.paymentMethod === "pix" || t.paymentMethod === "boleto",
      )
    ) {
      toast.warning("Nenhuma conta a pagar por PIX ou boleto neste lote.");
      return;
    }
    setIsExporting(true);
    try {
      const dues = toPay.map((t) => t.dueDate.getTime());
      await reportService.exportTransferGuide(
        toPay,
        batch.startDate ?? new Date(Math.min(...dues)),
        batch.endDate ?? new Date(Math.max(...dues)),
        selectedCompany?.name ?? "",
        await entityService.getAll(batch.companyId),
      );
    } catch (error) {
      console.error("Error exporting transfer guide", error);
      toast.error("Não foi possível gerar a guia. Tente novamente.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleApproved = () => {
    refresh();
    // Quem criou o lote e o aprovou não precisa de aviso do próprio ato.
    if (!user || !selectedCompany || batch.createdBy === user.uid) return;
    notificationService
      .notifyBatchApproved(
        batch.createdBy,
        batch.name,
        batch.id,
        user.displayName,
        selectedCompany.id,
      )
      .catch((e) => console.error("Error notifying after approval:", e));
  };

  // Linha do tempo do lote; o log de auditoria guarda o detalhe completo.
  const history = [
    { label: "Criado", at: batch.createdAt },
    {
      label: `Enviado para aprovação${batch.approverEmail ? ` a ${batch.approverName || batch.approverEmail}` : ""}`,
      at: batch.sentForApprovalAt,
    },
    {
      label: "Devolvido ao gestor",
      at: batch.returnedAt,
      note: batch.returnReason,
    },
    { label: "Aprovado", at: batch.approvedAt, note: batch.approverComment },
    {
      label: `Enviado para autorização${batch.authorizerEmail ? ` a ${batch.authorizerName || batch.authorizerEmail}` : ""}`,
      at: batch.sentForAuthorizationAt,
    },
    { label: "Autorizado", at: batch.authorizedAt },
    { label: "Pagamento confirmado", at: batch.paidAt },
    {
      label: "Revertido para Aberto",
      at: batch.revertedAt,
      note: batch.revertReason,
    },
  ]
    .filter((e) => e.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime());

  const allSelected =
    sorted.length > 0 && sorted.every((t) => selectedIds.has(t.id));
  const toggle = (txId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  const colCount = canEdit ? 7 : 5;

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <BatchStatusBadge status={batch.status} />
            {period && (
              <span className="tabular-nums text-muted-foreground">
                Vencimentos de {period}
              </span>
            )}
            {urgency && (
              <span className={TONE[urgency.tone]}>{urgency.label}</span>
            )}
          </div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            {batch.name}
          </h1>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="text-xl font-semibold font-financial tabular-nums text-foreground">
              {txQuery.isLoading
                ? formatCurrency(batch.totalAmount)
                : formatCurrency(liveTotal)}
            </span>
            <span className="tabular-nums">
              {plural(
                txQuery.data?.length ?? batch.transactionIds.length,
                "transação",
                "transações",
              )}
            </span>
            {missing.length > 0 && (
              <span className="tabular-nums text-amber-700 dark:text-amber-400">
                {plural(
                  missing.length,
                  "conta do período fora do lote",
                  "contas do período fora do lote",
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!approving && actions.renderAction(batch, step, "default")}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={isExporting || transactions.length === 0}
              >
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Exportar
                <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={handleExport}>
                <div>
                  <p>Planilha do lote</p>
                  <p className="text-xs text-muted-foreground">
                    Transações, saldo após os pagamentos e resumos
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleTransferGuide}>
                <div>
                  <p>Guia de transferências</p>
                  <p className="text-xs text-muted-foreground">
                    PIX agrupado por favorecido e dia, boletos com linha
                    digitável
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {actions.renderMenu(batch)}
        </div>
      </header>

      {batch.status === "open" && batch.returnReason && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-medium">Devolvido pelo aprovador:</span>{" "}
          {batch.returnReason}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        {/* ── Transações ──────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          {txQuery.isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : txQuery.isError ? (
            <div className="flex flex-col items-center rounded-lg border py-14 text-center">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="text-sm">
                Não foi possível carregar as transações do lote.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => txQuery.refetch()}
              >
                Tentar de novo
              </Button>
            </div>
          ) : approving ? (
            <BatchApprovalPanel
              batch={batch}
              transactions={sorted}
              onOpen={(t) => setOpenTxId(t.id)}
              actor={actions.actor!}
              onApproved={handleApproved}
              onReturned={refresh}
            />
          ) : (
            <>
              {missing.length > 0 && (
                <Collapsible
                  defaultOpen
                  className="rounded-lg border border-amber-200 dark:border-amber-900"
                >
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/40">
                    <span>
                      <span className="block text-sm font-medium text-amber-900 dark:text-amber-200">
                        {plural(
                          missing.length,
                          "conta em rascunho no período ficou fora do lote",
                          "contas em rascunho no período ficaram fora do lote",
                        )}
                      </span>
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        Vencem entre {period} e ainda não têm lote.
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-amber-800 transition-transform group-data-[state=open]:rotate-180 dark:text-amber-300" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className={cn(TH, "w-[110px]")}>
                            Vencimento
                          </TableHead>
                          <TableHead className={TH}>Descrição</TableHead>
                          <TableHead className={TH}>Fornecedor</TableHead>
                          <TableHead className={cn(TH, "text-right")}>
                            Valor
                          </TableHead>
                          <TableHead className="w-[110px]">
                            <span className="sr-only">Ações</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {missing.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="tabular-nums">
                              {format(t.dueDate, "dd/MM/yyyy")}
                            </TableCell>
                            <TableCell className="max-w-0">
                              <span
                                className="block truncate"
                                title={t.description}
                              >
                                {t.description}
                              </span>
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
                              {formatCurrency(t.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => handleAdd(t)}
                                disabled={addingId === t.id}
                              >
                                {addingId === t.id ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Incluir
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {missing.length === MISSING_LIMIT && (
                      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                        Mostrando as primeiras {MISSING_LIMIT}. Inclua estas
                        para ver o restante.
                      </p>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}

              <div className="rounded-lg border">
                {selectedIds.size > 0 && (
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
                    <span className="text-sm font-medium">
                      {plural(
                        selectedIds.size,
                        "transação selecionada",
                        "transações selecionadas",
                      )}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        Limpar seleção
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRemoveIds([...selectedIds])}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remover do lote
                      </Button>
                    </div>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canEdit && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={
                              allSelected
                                ? true
                                : selectedIds.size > 0
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={() =>
                              setSelectedIds(
                                allSelected
                                  ? new Set()
                                  : new Set(sorted.map((t) => t.id)),
                              )
                            }
                            aria-label="Selecionar todas as transações"
                          />
                        </TableHead>
                      )}
                      <SortHead
                        label="Vencimento"
                        sortKey="dueDate"
                        sort={sortConfig}
                        onSort={requestSort}
                        className="w-[120px]"
                      />
                      <SortHead
                        label="Descrição"
                        sortKey="description"
                        sort={sortConfig}
                        onSort={requestSort}
                      />
                      <SortHead
                        label="Fornecedor"
                        sortKey="supplierOrClient"
                        sort={sortConfig}
                        onSort={requestSort}
                      />
                      <SortHead
                        label="Valor"
                        sortKey="amount"
                        sort={sortConfig}
                        onSort={requestSort}
                        alignRight
                      />
                      <SortHead
                        label="Status"
                        sortKey="status"
                        sort={sortConfig}
                        onSort={requestSort}
                        className="w-[170px]"
                      />
                      {canEdit && (
                        <TableHead className="w-12">
                          <span className="sr-only">Ações</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={colCount} className="py-14">
                          <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
                            <PackageOpen className="h-8 w-8 opacity-40" />
                            <p className="text-sm">
                              Nenhuma transação neste lote.
                              {missing.length > 0 &&
                                " Inclua as contas do período acima."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sorted.map((t) => (
                        <TableRow
                          key={t.id}
                          data-state={
                            selectedIds.has(t.id) || openTxId === t.id
                              ? "selected"
                              : undefined
                          }
                          className="cursor-pointer"
                          onClick={() => setOpenTxId(t.id)}
                        >
                          {canEdit && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(t.id)}
                                onCheckedChange={() => toggle(t.id)}
                                aria-label={`Selecionar ${t.description}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="tabular-nums">
                            {format(t.dueDate, "dd/MM/yyyy")}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <button
                              type="button"
                              className="block max-w-full truncate rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={t.description}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenTxId(t.id);
                              }}
                            >
                              {t.description}
                            </button>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <span
                              className="block truncate"
                              title={t.supplierOrClient}
                            >
                              {t.supplierOrClient}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-financial tabular-nums">
                            {t.batchAdjustedAmount !== undefined &&
                              t.batchAdjustedAmount !== t.amount && (
                                <span className="mr-1.5 text-xs text-muted-foreground line-through">
                                  {formatCurrency(t.amount)}
                                </span>
                              )}
                            {formatCurrency(effectiveAmount(t))}
                          </TableCell>
                          <TableCell>
                            <BatchStatusBadge status={t.status} />
                          </TableCell>
                          {canEdit && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setRemoveIds([t.id])}
                                aria-label={`Remover ${t.description} do lote`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        {/* ── Lateral: próximo passo e histórico ──────────────────────── */}
        <aside className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <section>
            <h2 className="mb-1.5 text-xs font-medium text-muted-foreground">
              Próximo passo
            </h2>
            <StepCell step={step} batch={batch} />
          </section>
          {history.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                Histórico
              </h2>
              <ol className="space-y-3 border-l pl-4">
                {history.map((e) => (
                  <li key={e.label} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border ring-2 ring-background"
                    />
                    <p className="text-sm">{e.label}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {format(e.at!, "dd/MM/yyyy 'às' HH:mm")}
                    </p>
                    {e.note && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        “{e.note}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>

      {actions.dialogs}

      <TransactionDetailsDialog
        transaction={openTx}
        isOpen={!!openTx}
        onClose={() => setOpenTxId(null)}
        onUpdate={refresh}
        costCenters={costCenters}
        onNavigate={moveTx}
      />

      <ConfirmDialog
        open={removeIds.length > 0}
        onOpenChange={(open) => !open && setRemoveIds([])}
        title={
          removeIds.length === 1
            ? "Remover transação do lote?"
            : `Remover ${removeIds.length} transações do lote?`
        }
        description={`${removeIds.length === 1 ? "Ela volta" : "Elas voltam"} para as contas a pagar disponíveis. Nenhuma conta é excluída.`}
        confirmText="Remover do lote"
        variant="destructive"
        onConfirm={handleRemove}
      />
    </div>
  );
}
