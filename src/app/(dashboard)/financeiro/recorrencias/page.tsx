"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import currency from "currency.js";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  findDuplicateIds,
  monthlyAmount,
  recurrenceService,
} from "@/lib/services/recurrenceService";
import { RecurringTransactionTemplate } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  PauseCircle,
  PlayCircle,
  Pencil,
  Search,
  RefreshCw,
  AlertTriangle,
  MoreHorizontal,
  SlidersHorizontal,
  Download,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { format, differenceInDays, isBefore, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import { toast } from "sonner";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";
import { EditRecurrenceDialog } from "@/components/features/finance/EditRecurrenceDialog";
import {
  RecurrenceDetailSheet,
  frequencyLabel,
} from "@/components/features/finance/RecurrenceDetailSheet";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCostCenters } from "@/hooks/useCostCenters";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter, useSearchParams } from "next/navigation";

const STATUS_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "ended", label: "Encerradas" },
  { value: "overdue", label: "Atrasadas" },
  { value: "error", label: "Com erro" },
  { value: "duplicates", label: "Duplicadas" },
  { value: "no_account", label: "Sem conta" },
];

const FILTER_FROM_URL: Record<string, string> = {
  "sem-conta": "no_account",
  duplicadas: "duplicates",
};

type SortKey = "due" | "amount" | "description";
type GroupBy = "none" | "cc" | "supplier";

/** Borda mais forte que a padrão: sobre linhas claras o checkbox sumia. */
const CHECKBOX_CLASS = "border-muted-foreground/60";

const NO_CC = "Sem centro de custo";
const NO_SUPPLIER = "Sem fornecedor";

function getDueDateUrgency(nextDueDate: Date, active: boolean) {
  if (!active) return null;
  const today = startOfDay(new Date());
  if (isBefore(nextDueDate, today)) return "overdue";
  const diff = differenceInDays(nextDueDate, today);
  if (diff <= 3) return "critical";
  if (diff <= 7) return "warning";
  return null;
}

function statusOf(t: RecurringTransactionTemplate) {
  return t.endedAt ? "ended" : t.active ? "active" : "paused";
}

const STATUS_LABEL = { active: "Ativa", paused: "Pausada", ended: "Encerrada" };

function StatusBadge({ t }: { t: RecurringTransactionTemplate }) {
  const s = statusOf(t);
  return (
    <Badge
      variant={s === "active" ? "default" : "secondary"}
      className={cn(
        s === "active" &&
          "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",
      )}
    >
      {STATUS_LABEL[s]}
    </Badge>
  );
}

const FLAG_STYLE =
  "h-5 px-1.5 text-[10px] font-medium border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400";

function Flags({
  t,
  missingAccount,
  duplicate,
}: {
  t: RecurringTransactionTemplate;
  missingAccount: boolean;
  duplicate: boolean;
}) {
  const adjustedThisYear = t.lastAdjustment?.year === new Date().getFullYear();
  return (
    <>
      {/* Ativa é o normal: só quem foge do normal ganha selo. */}
      {!t.active && <StatusBadge t={t} />}
      {t.lastError && (
        <Badge
          variant="outline"
          className="h-5 px-1.5 text-[10px] font-medium border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400"
          title={t.lastError.message}
        >
          falhou
        </Badge>
      )}
      {duplicate && (
        <Badge
          variant="outline"
          className={FLAG_STYLE}
          title="Outra recorrência ativa tem mesmo fornecedor, valor e periodicidade"
        >
          possível duplicata
        </Badge>
      )}
      {missingAccount && (
        <Badge
          variant="outline"
          className={FLAG_STYLE}
          title="Os lançamentos gerados chegam sem conta do plano de contas"
        >
          sem conta
        </Badge>
      )}
      {t.amountIsEstimate && (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
          valor varia
        </Badge>
      )}
      {t.adjustmentRule && (
        <Badge
          variant="outline"
          className="h-5 px-1.5 text-[10px] font-medium"
          title={
            adjustedThisYear
              ? `Reajustada em ${t.lastAdjustment!.year}: de ${formatCurrency(t.lastAdjustment!.from)} para ${formatCurrency(t.lastAdjustment!.to)}`
              : "Tem reajuste anual configurado"
          }
        >
          {adjustedThisYear
            ? `reajustada ${t.lastAdjustment!.percentage}%`
            : "reajuste"}
        </Badge>
      )}
    </>
  );
}

/** Valor com o equivalente mensal embaixo quando a periodicidade não é mensal. */
function AmountCell({ t }: { t: RecurringTransactionTemplate }) {
  const notMonthly = t.frequency !== "monthly" || (t.interval || 1) > 1;
  return (
    <div className="text-right">
      <Amount t={t} />
      {notMonthly && (
        <p className="text-xs font-normal text-muted-foreground tabular-nums">
          ≈ {formatCurrency(monthlyAmount(t))}/mês
        </p>
      )}
    </div>
  );
}

function Amount({ t }: { t: RecurringTransactionTemplate }) {
  return (
    <span
      className={cn(
        "font-financial font-medium tabular-nums",
        t.type === "receivable" &&
          t.active &&
          "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {t.type === "receivable" && "+ "}
      {formatCurrency(t.amount)}
    </span>
  );
}

function DueDate({ t }: { t: RecurringTransactionTemplate }) {
  const urgency = getDueDateUrgency(t.nextDueDate, t.active);
  return (
    <div className="flex items-center gap-1.5">
      {urgency === "overdue" && (
        <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-hidden />
      )}
      <span
        className={cn(
          "text-sm tabular-nums",
          urgency === "overdue" &&
            "font-semibold text-red-700 dark:text-red-400",
          urgency === "critical" &&
            "font-semibold text-orange-700 dark:text-orange-400",
          urgency === "warning" &&
            "font-medium text-yellow-700 dark:text-yellow-500",
        )}
      >
        {format(t.nextDueDate, "dd/MM/yyyy")}
      </span>
      {urgency === "overdue" && (
        <Badge variant="destructive" className="h-4 px-1 text-[10px]">
          Atrasada
        </Badge>
      )}
      {urgency === "critical" && (
        <Badge className="h-4 bg-orange-100 px-1 text-[10px] text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
          {Math.max(0, differenceInDays(t.nextDueDate, startOfDay(new Date())))}{" "}
          d
        </Badge>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-3 border-b">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 max-w-[180px]" />
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
            <Skeleton className="h-3 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-11 w-11 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface MobileRecurrenceCardProps {
  template: RecurringTransactionTemplate;
  canManage: boolean;
  missingAccount: boolean;
  duplicate: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
}

function MobileRecurrenceCard({
  template: t,
  canManage,
  missingAccount,
  duplicate,
  onOpen,
  onEdit,
  onToggleActive,
}: MobileRecurrenceCardProps) {
  const overdue = getDueDateUrgency(t.nextDueDate, t.active) === "overdue";
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3.5 transition-colors select-none",
        overdue && "bg-red-50 dark:bg-red-900/10",
        !t.active && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="flex-1 truncate text-sm font-medium leading-snug">
            {t.description}
          </p>
          <Amount t={t} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {frequencyLabel(t.frequency, t.interval)} ·{" "}
          {t.type === "payable" ? "Despesa" : "Receita"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <DueDate t={t} />
          <Flags t={t} missingAccount={missingAccount} duplicate={duplicate} />
        </div>
      </button>

      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-11 w-11 p-0 shrink-0 -mr-2"
              aria-label="Ações da recorrência"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Ações</DropdownMenuLabel>
            <DropdownMenuItem onClick={onOpen}>Detalhes</DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Editar
            </DropdownMenuItem>
            {!t.endedAt && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onToggleActive}>
                  {t.active ? (
                    <PauseCircle className="mr-2 h-4 w-4" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  {t.active ? "Pausar" : "Retomar"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="w-11 h-11 shrink-0" />
      )}
    </div>
  );
}

function Kpi({
  label,
  loading,
  children,
  hint,
}: {
  label: string;
  loading: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="bg-card px-4 py-3.5 md:px-5 md:py-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <div className="mt-1 text-xl font-bold tabular-nums md:text-2xl">
          {children}
        </div>
      )}
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  /** Coluna numérica: título à direita, como o valor. */
  right?: boolean;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={right ? "text-right" : undefined}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

export default function RecorrenciasPage() {
  return (
    <Suspense>
      <Recorrencias />
    </Suspense>
  );
}

function Recorrencias() {
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canViewRecurrences, canManageRecurrences } = usePermissions();
  const { accounts } = useChartOfAccounts(selectedCompany?.id);
  const { costCenters } = useCostCenters(selectedCompany?.id);
  const missingAccount = (t: RecurringTransactionTemplate) =>
    accounts.length > 0 && t.active && !t.baseTransactionData?.accountId;

  const [searchTerm, setSearchTermState] = useState("");
  // `?filtro=sem-conta` vem do aviso do plano de contas; `duplicadas`, do
  // aviso ao criar uma recorrência igual a outra.
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilterState] = useState<string>(
    FILTER_FROM_URL[searchParams.get("filtro") ?? ""] ?? "all",
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "due",
    dir: "asc",
  });
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [confirmBulkPause, setConfirmBulkPause] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] =
    useState<RecurringTransactionTemplate | null>(null);

  useEffect(() => {
    if (!canViewRecurrences) {
      router.push("/dashboard");
    }
  }, [canViewRecurrences, router]);

  // ponytail: carrega tudo e filtra/pagina no cliente. Os KPIs já exigiam a
  // lista inteira, e uma empresa tem dezenas de recorrências, não milhares.
  // Se um tenant passar de alguns milhares, voltar ao cursor no Firestore.
  const {
    data: allTemplates = [],
    isLoading,
    isError,
    refetch: fetchTemplates,
  } = useQuery({
    queryKey: ["recurrences", selectedCompany?.id],
    queryFn: () => recurrenceService.getTemplates(selectedCompany!.id),
    enabled: !!selectedCompany && canViewRecurrences,
  });

  const duplicateIds = useMemo(
    () => findDuplicateIds(allTemplates),
    [allTemplates],
  );

  const ccNames = useMemo(
    () => new Map(costCenters.map((c) => [c.id, c.name])),
    [costCenters],
  );
  const ccLabel = (t: RecurringTransactionTemplate) => {
    const alloc = t.baseTransactionData?.costCenterAllocation ?? [];
    if (alloc.length === 0) return "";
    if (alloc.length > 1) return `Rateado (${alloc.length})`;
    return ccNames.get(alloc[0].costCenterId) ?? "";
  };

  const supplierOf = (t: RecurringTransactionTemplate) =>
    t.baseTransactionData?.supplierOrClient ?? "";
  /** Nome do grupo da linha ("" quando não há agrupamento). */
  const groupName = (t: RecurringTransactionTemplate) =>
    groupBy === "cc"
      ? ccLabel(t) || NO_CC
      : groupBy === "supplier"
        ? supplierOf(t) || NO_SUPPLIER
        : "";

  const matchesFilter = (t: RecurringTransactionTemplate, filter: string) => {
    switch (filter) {
      case "active":
      case "paused":
      case "ended":
        return statusOf(t) === filter;
      case "overdue":
        return getDueDateUrgency(t.nextDueDate, t.active) === "overdue";
      case "error":
        return !!t.lastError;
      case "duplicates":
        return duplicateIds.has(t.id);
      case "no_account":
        return missingAccount(t);
      default:
        return true;
    }
  };

  const filteredTemplates = useMemo(() => {
    const term = normalizeText(searchTerm.trim());
    const dir = sort.dir === "asc" ? 1 : -1;
    const byKey = (
      a: RecurringTransactionTemplate,
      b: RecurringTransactionTemplate,
    ) => {
      if (sort.key === "amount") return (a.amount - b.amount) * dir;
      if (sort.key === "description")
        return a.description.localeCompare(b.description, "pt-BR") * dir;
      return (a.nextDueDate.getTime() - b.nextDueDate.getTime()) * dir;
    };
    return allTemplates
      .filter(
        (t) =>
          matchesFilter(t, statusFilter) &&
          (!term ||
            normalizeText(
              `${t.description ?? ""} ${t.baseTransactionData?.supplierOrClient ?? ""}`,
            ).includes(term)),
      )
      .sort((a, b) => {
        // O grupo vem primeiro: com a situação antes, o mesmo centro de custo
        // aparecia duas vezes (ativas e pausadas), cada uma com seu cabeçalho.
        if (groupBy !== "none") {
          const g = groupName(a).localeCompare(groupName(b), "pt-BR");
          if (g !== 0) return g;
        }
        // Pausada e encerrada descem: a data delas parou no passado e
        // empurrava as ativas para baixo.
        if (a.active !== b.active) return a.active ? -1 : 1;
        return byKey(a, b);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allTemplates,
    statusFilter,
    searchTerm,
    accounts,
    sort,
    groupBy,
    ccNames,
    duplicateIds,
  ]);

  // Subtotal mensal de despesas ativas por grupo, sobre o filtro inteiro
  // (não só a página).
  const groupTotals = useMemo(() => {
    const m = new Map<string, { count: number; monthly: currency }>();
    for (const t of filteredTemplates) {
      const k = groupName(t);
      const g = m.get(k) ?? { count: 0, monthly: currency(0) };
      g.count++;
      if (t.active && t.type === "payable")
        g.monthly = g.monthly.add(monthlyAmount(t));
      m.set(k, g);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTemplates, ccNames, groupBy]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTemplates.length / pageSize),
  );
  const currentPage = Math.min(page, totalPages);
  const templates = filteredTemplates.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const setSearchTerm = (value: string) => {
    setSearchTermState(value);
    setPage(1);
  };
  const setStatusFilter = (value: string) => {
    setStatusFilterState(value);
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
    setPage(1);
  };

  const kpis = useMemo(() => {
    const active = allTemplates.filter((t) => t.active);
    const today = startOfDay(new Date());
    const sumMonthly = (type: "payable" | "receivable") =>
      active
        .filter((t) => t.type === type)
        .reduce((s, t) => s.add(monthlyAmount(t)), currency(0)).value;

    const next30 = active.filter(
      (t) =>
        t.type === "payable" && differenceInDays(t.nextDueDate, today) <= 30,
    );
    return {
      fixedCost: sumMonthly("payable"),
      revenue: sumMonthly("receivable"),
      next30Count: next30.length,
      next30Total: next30.reduce((s, t) => s.add(t.amount), currency(0)).value,
      totalActive: active.length,
      paused: allTemplates.filter((t) => statusOf(t) === "paused").length,
      ended: allTemplates.filter((t) => statusOf(t) === "ended").length,
      overdue: active.filter(
        (t) => getDueDateUrgency(t.nextDueDate, true) === "overdue",
      ).length,
      errors: active.filter((t) => t.lastError).length,
      duplicates: duplicateIds.size,
    };
  }, [allTemplates, duplicateIds]);

  const openTemplate = allTemplates.find((t) => t.id === openId) ?? null;

  if (!canViewRecurrences) return null;

  const setActive = (template: RecurringTransactionTemplate, active: boolean) =>
    recurrenceService.updateTemplate(template.id, template.companyId, {
      active,
    });

  /** Aplica a situação e oferece desfazer: pausar errado só aparece quando um boleto deixa de nascer. */
  const applyActive = async (
    targets: RecurringTransactionTemplate[],
    active: boolean,
  ) => {
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((t) => setActive(t, active)),
    );
    const done = targets.filter((_, i) => results[i].status === "fulfilled");
    const failed = targets.length - done.length;
    if (failed > 0) toast.error(`${failed} não puderam ser atualizadas.`);
    if (done.length > 0) {
      const what =
        done.length === 1 ? "Recorrência" : `${done.length} recorrências`;
      toast.success(
        `${what} ${active ? "retomada" : "pausada"}${done.length > 1 ? "s" : ""}.`,
        {
          action: {
            label: "Desfazer",
            onClick: async () => {
              const undo = await Promise.allSettled(
                done.map((t) => setActive(t, !active)),
              );
              if (undo.some((r) => r.status === "rejected"))
                toast.error("Não foi possível desfazer tudo.");
              fetchTemplates();
            },
          },
        },
      );
    }
    fetchTemplates();
  };

  const handleToggleActive = (template: RecurringTransactionTemplate) =>
    applyActive([template], !template.active);

  const selectedTargets = (active: boolean) =>
    allTemplates.filter(
      (t) => selected.has(t.id) && !t.endedAt && t.active !== active,
    );
  const bulkSetActive = async (active: boolean) => {
    await applyActive(selectedTargets(active), active);
    setSelected(new Set());
  };

  const exportCsv = () => {
    const money = (n: number) => n.toFixed(2).replace(".", ",");
    const csv = Papa.unparse(
      filteredTemplates.map((t) => ({
        Descrição: t.description,
        Tipo: t.type === "payable" ? "Despesa" : "Receita",
        "Fornecedor/cliente": t.baseTransactionData?.supplierOrClient ?? "",
        "Centro de custo": ccLabel(t),
        Valor: money(t.amount),
        "Valor mensalizado": money(monthlyAmount(t)),
        Frequência: frequencyLabel(t.frequency, t.interval),
        "Próximo vencimento": format(t.nextDueDate, "dd/MM/yyyy"),
        Situação: STATUS_LABEL[statusOf(t)],
      })),
      { delimiter: ";" },
    );
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `recorrencias-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Agrupado por centro de custo, a coluna repetiria o nome do cabeçalho.
  const showCcColumn = groupBy !== "cc";
  const colCount = 4 + (showCcColumn ? 1 : 0) + (canManageRecurrences ? 2 : 0);

  const hasActiveFilters = statusFilter !== "all";
  const filterLabel =
    STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter;

  const pageIds = templates.map((t) => t.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const pagination = (
    <Pagination
      page={currentPage}
      totalItems={filteredTemplates.length}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  const emptyState = (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-full bg-muted p-4">
        <RefreshCw className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="font-medium">
          {searchTerm || hasActiveFilters
            ? "Nenhuma recorrência encontrada"
            : "Nenhuma recorrência cadastrada"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {searchTerm
            ? `Sem resultados para "${searchTerm}"`
            : hasActiveFilters
              ? "Tente mudar o filtro de status"
              : "Marque “repetir” ao criar uma conta a pagar ou a receber."}
        </p>
      </div>
    </div>
  );

  const attentionItems = [
    { filter: "overdue", n: kpis.overdue, text: "atrasada(s)" },
    { filter: "error", n: kpis.errors, text: "com erro" },
    { filter: "duplicates", n: kpis.duplicates, text: "duplicada(s)" },
  ].filter((i) => i.n > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Recorrências
          </h1>
          <p className="text-sm text-muted-foreground">
            Contas que se repetem e geram lançamentos sozinhas.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={filteredTemplates.length === 0}
        >
          <Download className="mr-2 h-4 w-4" /> Exportar
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
        <Kpi
          label="Compromisso mensal"
          loading={isLoading}
          hint={
            kpis.revenue > 0
              ? `Receitas recorrentes: ${formatCurrency(kpis.revenue)}`
              : "Despesas ativas, mensalizadas"
          }
        >
          {formatCurrency(kpis.fixedCost)}
        </Kpi>
        <Kpi
          label="Nos próximos 30 dias"
          loading={isLoading}
          hint={`${kpis.next30Count} despesa(s) a gerar`}
        >
          {formatCurrency(kpis.next30Total)}
        </Kpi>
        <Kpi
          label="Recorrências ativas"
          loading={isLoading}
          hint={`${kpis.paused} pausada(s) · ${kpis.ended} encerrada(s)`}
        >
          {kpis.totalActive}
        </Kpi>
        <div
          className={cn(
            "px-4 py-3.5 md:px-5 md:py-4",
            attentionItems.length > 0
              ? "bg-amber-50 dark:bg-amber-950/20"
              : "bg-card",
          )}
        >
          <div className="text-xs font-medium text-muted-foreground">
            Atenção
          </div>
          {isLoading ? (
            <div className="mt-2 h-7 w-16 animate-pulse rounded bg-muted" />
          ) : attentionItems.length === 0 ? (
            <div className="mt-1 text-xl font-bold text-muted-foreground md:text-2xl">
              Em dia
            </div>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {attentionItems.map((i) => (
                <li key={i.filter}>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(i.filter)}
                    className="rounded-sm text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {i.n} {i.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Table card */}
      <Card>
        <CardHeader>
          {/* ── Desktop ── */}
          <div className="hidden md:flex flex-col gap-4 md:flex-row md:items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Modelos de Recorrência</CardTitle>
              <CardDescription>
                {isLoading || isError
                  ? "Cada modelo gera um lançamento a cada vencimento."
                  : `${filteredTemplates.length} de ${allTemplates.length} modelos`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Descrição ou fornecedor"
                  aria-label="Buscar recorrências"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[260px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-40"
                  aria-label="Filtrar por situação"
                >
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={groupBy}
                onValueChange={(v) => setGroupBy(v as GroupBy)}
              >
                <SelectTrigger className="w-52" aria-label="Agrupar por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem agrupamento</SelectItem>
                  <SelectItem value="cc">
                    Agrupar por centro de custo
                  </SelectItem>
                  <SelectItem value="supplier">
                    Agrupar por fornecedor
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Mobile: título ── */}
          <div className="flex md:hidden items-center justify-between gap-2">
            <CardTitle>Modelos de Recorrência</CardTitle>
            {!isLoading && !isError && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {filteredTemplates.length} resultado
                {filteredTemplates.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* ── Mobile: busca + filtros ── */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar recorrências..."
                aria-label="Buscar recorrências"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 h-10"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              aria-label="Abrir filtros"
              className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                hasActiveFilters
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>

          {hasActiveFilters && (
            <div className="flex md:hidden items-center gap-2">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                {filterLabel}
                <button
                  onClick={() => setStatusFilter("all")}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                  aria-label="Remover filtro"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {canManageRecurrences && selected.size > 0 && (
            <div className="flex items-center gap-2 border-y bg-muted/40 px-6 py-2 text-sm">
              <span className="font-medium tabular-nums">
                {selected.size} selecionada(s)
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedTargets(false).length === 0}
                onClick={() =>
                  selectedTargets(false).length > 1
                    ? setConfirmBulkPause(true)
                    : bulkSetActive(false)
                }
              >
                <PauseCircle className="mr-2 h-4 w-4" /> Pausar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedTargets(true).length === 0}
                onClick={() => bulkSetActive(true)}
              >
                <PlayCircle className="mr-2 h-4 w-4" /> Retomar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Limpar seleção
              </Button>
            </div>
          )}

          {isError ? (
            <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
              <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="font-medium">Erro ao carregar recorrências</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Não foi possível buscar os dados. Tente novamente.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchTemplates()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : isLoading ? (
            <>
              <div className="hidden md:block">
                <TableSkeleton />
              </div>
              <div className="md:hidden">
                <MobileCardSkeleton />
              </div>
            </>
          ) : (
            <>
              {/* ── Desktop: Table ── */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {canManageRecurrences && (
                        <TableHead className="w-10 pl-6">
                          <Checkbox
                            checked={allPageSelected}
                            onCheckedChange={(v) => togglePage(v === true)}
                            aria-label="Selecionar todas desta página"
                            className={CHECKBOX_CLASS}
                          />
                        </TableHead>
                      )}
                      <SortHead
                        label="Descrição"
                        k="description"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      {showCcColumn && <TableHead>Centro de custo</TableHead>}
                      <SortHead
                        label="Valor"
                        k="amount"
                        sort={sort}
                        onSort={toggleSort}
                        right
                      />
                      <TableHead>Frequência</TableHead>
                      <SortHead
                        label="Próx. vencimento"
                        k="due"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      {canManageRecurrences && (
                        <TableHead className="pr-6 text-right">Ações</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colCount} className="py-16">
                          {emptyState}
                        </TableCell>
                      </TableRow>
                    ) : (
                      templates.map((t, i) => {
                        const group = groupName(t);
                        const showGroup =
                          groupBy !== "none" &&
                          (i === 0 || group !== groupName(templates[i - 1]));
                        const totals = groupTotals.get(group);
                        return (
                          <Fragment key={t.id}>
                            {showGroup && totals && (
                              <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableCell
                                  colSpan={colCount}
                                  className="px-6 py-2 text-xs font-semibold"
                                >
                                  {group}
                                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                                    {totals.count} recorrência(s)
                                    {totals.monthly.value > 0 &&
                                      ` · ${formatCurrency(totals.monthly.value)} por mês`}
                                  </span>
                                </TableCell>
                              </TableRow>
                            )}
                            <TableRow
                              className={cn(
                                "transition-colors",
                                !t.active && "text-muted-foreground",
                              )}
                              data-state={
                                selected.has(t.id) ? "selected" : undefined
                              }
                            >
                              {canManageRecurrences && (
                                <TableCell className="pl-6">
                                  <Checkbox
                                    checked={selected.has(t.id)}
                                    onCheckedChange={(v) =>
                                      toggleOne(t.id, v === true)
                                    }
                                    aria-label={`Selecionar ${t.description}`}
                                    className={CHECKBOX_CLASS}
                                  />
                                </TableCell>
                              )}
                              <TableCell className="font-medium">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <button
                                    type="button"
                                    onClick={() => setOpenId(t.id)}
                                    className="rounded-sm text-left hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {t.description}
                                  </button>
                                  <Flags
                                    t={t}
                                    missingAccount={missingAccount(t)}
                                    duplicate={duplicateIds.has(t.id)}
                                  />
                                </div>
                                {groupBy !== "supplier" && supplierOf(t) && (
                                  <p className="text-xs font-normal text-muted-foreground">
                                    {supplierOf(t)}
                                  </p>
                                )}
                              </TableCell>
                              {showCcColumn && (
                                <TableCell className="text-sm text-muted-foreground">
                                  {ccLabel(t) || NO_CC}
                                </TableCell>
                              )}
                              <TableCell>
                                <AmountCell t={t} />
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {frequencyLabel(t.frequency, t.interval)}
                              </TableCell>
                              <TableCell>
                                <DueDate t={t} />
                                {t.lastGeneratedAt && (
                                  <p className="text-xs font-normal text-muted-foreground tabular-nums">
                                    gerada em{" "}
                                    {format(t.lastGeneratedAt, "dd/MM/yyyy")}
                                  </p>
                                )}
                              </TableCell>
                              {canManageRecurrences && (
                                <TableCell className="pr-6 text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        aria-label={`Ações de ${t.description}`}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => setOpenId(t.id)}
                                      >
                                        Detalhes
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setEditTemplate(t)}
                                      >
                                        <Pencil className="mr-2 h-4 w-4" />{" "}
                                        Editar
                                      </DropdownMenuItem>
                                      {!t.endedAt && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onClick={() =>
                                              handleToggleActive(t)
                                            }
                                          >
                                            {t.active ? (
                                              <PauseCircle className="mr-2 h-4 w-4" />
                                            ) : (
                                              <PlayCircle className="mr-2 h-4 w-4" />
                                            )}
                                            {t.active ? "Pausar" : "Retomar"}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              )}
                            </TableRow>
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>

                <div className="border-t px-6 py-4">{pagination}</div>
              </div>

              {/* ── Mobile: Card list ── */}
              <div className="md:hidden">
                {templates.length === 0 ? (
                  <div className="py-10 px-4">{emptyState}</div>
                ) : (
                  <>
                    <div className="divide-y">
                      {templates.map((t) => (
                        <MobileRecurrenceCard
                          key={t.id}
                          template={t}
                          canManage={canManageRecurrences}
                          missingAccount={missingAccount(t)}
                          duplicate={duplicateIds.has(t.id)}
                          onOpen={() => setOpenId(t.id)}
                          onEdit={() => setEditTemplate(t)}
                          onToggleActive={() => handleToggleActive(t)}
                        />
                      ))}
                    </div>

                    <div className="border-t px-4 py-3">{pagination}</div>
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Mobile filter sheet ── */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[60dvh] overflow-y-auto px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 shrink-0" />
          <SheetTitle className="mb-4 text-base font-semibold">
            Filtros
          </SheetTitle>
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Situação
              </p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStatusFilter("all");
                  setMobileFiltersOpen(false);
                }}
              >
                Limpar
              </Button>
              <Button
                className="flex-1"
                onClick={() => setMobileFiltersOpen(false)}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmBulkPause}
        onOpenChange={setConfirmBulkPause}
        title={`Pausar ${selectedTargets(false).length} recorrências?`}
        description="Elas param de gerar lançamentos até serem retomadas. Dá para desfazer logo depois."
        confirmText="Pausar"
        onConfirm={() => bulkSetActive(false)}
      />

      <RecurrenceDetailSheet
        template={openTemplate}
        onClose={() => setOpenId(null)}
        canManage={canManageRecurrences}
        costCenterName={openTemplate ? ccLabel(openTemplate) : undefined}
        accountLabel={(() => {
          const a = accounts.find(
            (x) => x.id === openTemplate?.baseTransactionData?.accountId,
          );
          return a ? `${a.code} ${a.name}` : undefined;
        })()}
        onEdit={() => setEditTemplate(openTemplate)}
        onToggleActive={() => openTemplate && handleToggleActive(openTemplate)}
        onChanged={() => fetchTemplates()}
      />

      <EditRecurrenceDialog
        open={!!editTemplate}
        onOpenChange={(open) => !open && setEditTemplate(null)}
        template={editTemplate}
        onSuccess={() => fetchTemplates()}
      />
    </div>
  );
}
