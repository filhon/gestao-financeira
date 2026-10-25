"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  ACTIVE_BATCH_LIMIT,
  paymentBatchService,
} from "@/lib/services/paymentBatchService";
import { PaymentBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  CalendarIcon,
  Package,
  AlertCircle,
  Loader2,
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
import { format } from "date-fns";
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
import { BatchStatusBadge } from "@/components/features/finance/batchStatus";
import {
  DueCell,
  StepCell,
  TONE,
  byDue,
  dueUrgency,
  errorMessage,
  isMyTurn,
  nextStep,
  periodLabel,
  sumOf,
} from "@/components/features/finance/batchWorkflow";
import { useBatchActions } from "@/hooks/useBatchActions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { Skeleton } from "@/components/ui/skeleton";

// ── Abas: de quem é a vez ──────────────────────────────────────────────────

type TabId = "mine" | "waiting" | "paid" | "all";

const TABS: { id: TabId; label: string }[] = [
  { id: "mine", label: "Comigo" },
  { id: "waiting", label: "Aguardando" },
  { id: "paid", label: "Pagos" },
  { id: "all", label: "Todos" },
];

const EMPTY: Record<TabId, string> = {
  mine: "Nenhum lote esperando ação sua.",
  waiting: "Nenhum lote aguardando aprovação ou autorização.",
  paid: "Nenhum lote pago ainda.",
  all: "Nenhum lote criado. Crie um lote para agrupar e aprovar pagamentos.",
};

/** Linha de apoio sob o nome do lote, só quando há algo a dizer. */
function lotNote(b: PaymentBatch): { text: string; warn?: boolean } | null {
  if (b.status === "open" && b.returnReason)
    return { text: `Devolvido: ${b.returnReason}`, warn: true };
  if (b.transactionIds.length === 0) return { text: "Sem transações" };
  return null;
}

// ── Página ─────────────────────────────────────────────────────────────────

export default function PaymentBatchesPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const router = useRouter();
  const { canViewBatches, canManageBatches, canApproveBatches, canPayBatches } =
    usePermissions();

  const [tab, setTab] = useState<TabId>(
    canManageBatches || canApproveBatches || canPayBatches ? "mine" : "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  const batchHref = (b: PaymentBatch) => `/financeiro/lotes/${b.id}`;
  const actions = useBatchActions({
    onApprove: (b) => router.push(batchHref(b)),
    onSent: (failedIds) => setSelectedIds(new Set(failedIds)),
  });
  const { ctx, refresh, renderAction, renderMenu } = actions;

  useEffect(() => {
    if (!canViewBatches) router.push("/dashboard");
  }, [canViewBatches, router]);

  const paged = tab === "paid" || tab === "all";

  // Lotes em andamento: conjunto inteiro, dividido e ordenado aqui
  const activeQuery = useQuery({
    queryKey: ["payment-batches-active", selectedCompany?.id],
    queryFn: () => paymentBatchService.getActive(selectedCompany!.id),
    enabled: !!selectedCompany && canViewBatches,
  });

  // Pagos e Todos crescem sem limite: paginados no servidor
  const list = usePaginatedQuery<PaymentBatch>({
    queryKey: ["payment-batches", selectedCompany?.id, tab],
    queryFn: async (pgSize, lastDoc) => {
      const { batches: items, lastDoc: newLastDoc } =
        await paymentBatchService.getAll(
          selectedCompany!.id,
          pgSize,
          lastDoc,
          tab === "paid" ? ["paid"] : [],
        );
      return { items, lastDoc: newLastDoc };
    },
    pageSize: 20,
    enabled: !!selectedCompany && canViewBatches && paged,
  });

  // Contagem e total de TODOS os lotes da empresa, não só da página carregada
  const summaryQuery = useQuery({
    queryKey: ["payment-batches-summary", selectedCompany?.id],
    queryFn: () => paymentBatchService.getStatusSummary(selectedCompany!.id),
    enabled: !!selectedCompany && canViewBatches,
  });

  const active = activeQuery.data ?? [];
  const mineBatches = active
    .filter((b) => isMyTurn(nextStep(b, ctx)))
    .sort(byDue);
  const waitingBatches = active
    .filter((b) => !isMyTurn(nextStep(b, ctx)))
    .sort(byDue);

  const tabTotals = (id: TabId): { count: number; total?: number } | null => {
    // Comigo e Aguardando somam o conjunto ativo inteiro, não uma página
    if (id === "mine") return activeQuery.data ? sumOf(mineBatches) : null;
    if (id === "waiting")
      return activeQuery.data ? sumOf(waitingBatches) : null;
    const summary = summaryQuery.data;
    if (!summary) return null;
    if (id === "paid") return summary.paid;
    return {
      count: Object.values(summary).reduce((n, s) => n + s.count, 0),
    };
  };

  const changeTab = (id: TabId) => {
    setTab(id);
    setSelectedIds(new Set());
  };

  if (!canViewBatches) return null;

  // ── Criar ────────────────────────────────────────────────────────────────

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
      changeTab("mine");
      refresh();
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error(errorMessage(error, "Erro ao criar lote"));
    }
  };

  const rows =
    tab === "mine"
      ? mineBatches
      : tab === "waiting"
        ? waitingBatches
        : list.items;
  const isTableLoading = paged
    ? list.isLoading && list.items.length === 0
    : activeQuery.isLoading;
  const isError = paged ? list.isError : activeQuery.isError;
  const activeTotals = tabTotals(tab);
  const remaining =
    paged && activeTotals ? activeTotals.count - list.items.length : null;

  // Seleção em massa: só lotes abertos que podem ir para aprovação
  const selectable = (b: PaymentBatch) =>
    tab === "mine" &&
    b.status === "open" &&
    nextStep(b, ctx)?.action?.kind === "send_approval";
  const selectableRows = rows.filter(selectable);
  const selectedRows = rows.filter((b) => selectedIds.has(b.id));
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((b) => selectedIds.has(b.id));
  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showSelect = selectableRows.length > 0;
  const showStatus = tab === "all";
  const stepHeader =
    tab === "waiting"
      ? "Com quem"
      : tab === "paid"
        ? "Pagamento"
        : tab === "all"
          ? "Próximo passo"
          : null;
  const colCount =
    5 + (showSelect ? 1 : 0) + (showStatus ? 1 : 0) + (stepHeader ? 1 : 0);
  const TH = "text-xs font-medium text-muted-foreground";

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const target = (
      {
        ArrowRight: i + 1,
        ArrowLeft: i - 1,
        Home: 0,
        End: TABS.length - 1,
      } as Record<string, number>
    )[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const next = TABS[(target + TABS.length) % TABS.length];
    changeTab(next.id);
    document.getElementById(`batch-tab-${next.id}`)?.focus();
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <Package className="mb-3 h-8 w-8 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">{EMPTY[tab]}</p>
      {canManageBatches && (tab === "mine" || tab === "all") && (
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

  const errorState = (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
      <p className="text-sm">Não foi possível carregar os lotes.</p>
      <Button size="sm" variant="outline" className="mt-4" onClick={refresh}>
        Tentar de novo
      </Button>
    </div>
  );

  const footer = paged
    ? list.hasMore && (
        <div className="flex justify-center border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={list.loadMore}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage && (
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
      )
    : active.length >= ACTIVE_BATCH_LIMIT && (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Mostrando {ACTIVE_BATCH_LIMIT} lotes em andamento. Conclua ou exclua
          lotes antigos para ver o restante.
        </p>
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
        {/* ── Abas: de quem é a vez, com contagem e total ──────────────── */}
        <div
          role="tablist"
          aria-label="Lotes por responsável"
          onKeyDown={onTabKey}
          className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((t) => {
            const selected = t.id === tab;
            const totals = tabTotals(t.id);
            const empty = totals?.count === 0;
            const failed =
              t.id === "mine" || t.id === "waiting"
                ? activeQuery.isError
                : summaryQuery.isError;
            return (
              <button
                key={t.id}
                id={`batch-tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="batch-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => changeTab(t.id)}
                className={cn(
                  "relative flex shrink-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md",
                  selected
                    ? "after:bg-primary"
                    : empty
                      ? "text-muted-foreground/70 hover:text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {t.label}
                  {totals === null ? (
                    failed ? null : (
                      <Skeleton className="h-4 w-5 rounded-full" />
                    )
                  ) : (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-xs tabular-nums",
                        !empty && "bg-muted text-foreground",
                      )}
                    >
                      {totals.count}
                    </span>
                  )}
                </span>
                <span className="text-xs font-financial tabular-nums text-muted-foreground">
                  {totals?.total ? (
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

        <div
          role="tabpanel"
          id="batch-panel"
          aria-labelledby={`batch-tab-${tab}`}
        >
          {/* ── Ação em massa ─────────────────────────────────────────── */}
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
              <span className="text-sm">
                <span className="font-medium">
                  {plural(
                    selectedRows.length,
                    "lote selecionado",
                    "lotes selecionados",
                  )}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-financial tabular-nums">
                  {formatCurrency(sumOf(selectedRows).total)}
                </span>
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
                  onClick={() =>
                    actions.openSend(selectedRows, "send_approval")
                  }
                >
                  Enviar para aprovação
                </Button>
              </div>
            </div>
          )}

          {/* ── Mobile: lista ───────────────────────────────────────────── */}
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
            ) : isError ? (
              errorState
            ) : rows.length === 0 ? (
              emptyState
            ) : (
              <ul className="divide-y">
                {rows.map((batch) => {
                  const step = nextStep(batch, ctx);
                  const period = periodLabel(batch);
                  const urgency = dueUrgency(batch);
                  return (
                    <li
                      key={batch.id}
                      className="flex items-start gap-2 px-4 py-3.5"
                    >
                      <Link
                        href={batchHref(batch)}
                        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          {showStatus && (
                            <BatchStatusBadge status={batch.status} />
                          )}
                          <span>
                            {plural(
                              batch.transactionIds.length,
                              "transação",
                              "transações",
                            )}
                          </span>
                          {period && <span>{period}</span>}
                          {urgency && (
                            <span className={TONE[urgency.tone]}>
                              {urgency.label}
                            </span>
                          )}
                        </div>
                        {tab !== "mine" && (
                          <div className="mt-1.5">
                            <StepCell step={step} batch={batch} />
                          </div>
                        )}
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
                        {renderAction(batch, step)}
                        {renderMenu(batch)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {footer}
          </div>

          {/* ── Desktop: tabela ─────────────────────────────────────────── */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {showSelect && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Selecionar todos os lotes que podem ir para aprovação"
                        checked={
                          allSelected
                            ? true
                            : selectedRows.length > 0
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={() =>
                          setSelectedIds(
                            allSelected
                              ? new Set()
                              : new Set(selectableRows.map((b) => b.id)),
                          )
                        }
                      />
                    </TableHead>
                  )}
                  <TableHead className={TH}>Lote</TableHead>
                  <TableHead className={TH}>Vencimento</TableHead>
                  {showStatus && <TableHead className={TH}>Status</TableHead>}
                  {stepHeader && (
                    <TableHead className={TH}>{stepHeader}</TableHead>
                  )}
                  <TableHead className={cn(TH, "text-right")}>
                    Transações
                  </TableHead>
                  <TableHead className={cn(TH, "text-right")}>
                    Valor total
                  </TableHead>
                  <TableHead className="w-px text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isTableLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={colCount}>
                        <Skeleton className="h-4 w-56" />
                        <Skeleton className="mt-1.5 h-3 w-28" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount}>{errorState}</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount}>{emptyState}</TableCell>
                  </TableRow>
                ) : (
                  rows.map((batch) => {
                    const step = nextStep(batch, ctx);
                    const note = lotNote(batch);
                    const checked = selectedIds.has(batch.id);
                    return (
                      <TableRow
                        key={batch.id}
                        data-state={checked ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => router.push(batchHref(batch))}
                      >
                        {showSelect && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {selectable(batch) && (
                              <Checkbox
                                aria-label={`Selecionar ${batch.name}`}
                                checked={checked}
                                onCheckedChange={() => toggleRow(batch.id)}
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="max-w-0 w-[36%]">
                          <Link
                            href={batchHref(batch)}
                            className="block max-w-full truncate rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={batch.name}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {batch.name}
                          </Link>
                          {note && (
                            <span
                              className={cn(
                                "block truncate text-xs",
                                note.warn
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-muted-foreground",
                              )}
                              title={note.text}
                            >
                              {note.text}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DueCell batch={batch} />
                        </TableCell>
                        {showStatus && (
                          <TableCell>
                            <BatchStatusBadge status={batch.status} />
                          </TableCell>
                        )}
                        {stepHeader && (
                          <TableCell className="max-w-0 w-[22%]">
                            <StepCell step={step} batch={batch} />
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums">
                          {batch.transactionIds.length}
                        </TableCell>
                        <TableCell className="text-right font-medium font-financial tabular-nums">
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
            {footer}
          </div>
        </div>
      </div>

      {actions.dialogs}
    </div>
  );
}
