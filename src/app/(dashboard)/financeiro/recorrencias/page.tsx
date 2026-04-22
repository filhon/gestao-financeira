"use client";

import { useEffect, useMemo, useState } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { recurrenceService } from "@/lib/services/recurrenceService";
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
import {
  Loader2,
  Trash2,
  PauseCircle,
  PlayCircle,
  Pencil,
  Search,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  RefreshCw,
  AlertTriangle,
  RepeatIcon,
  MoreHorizontal,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format, differenceInDays, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";
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
import { toast } from "sonner";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditRecurrenceDialog } from "@/components/features/finance/EditRecurrenceDialog";
import { AnimatedCounter } from "@/components/ui/animated-counter";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";

function getFrequencyLabel(freq: string, interval: number) {
  const intervalLabel = interval > 1 ? `A cada ${interval} ` : "";
  switch (freq) {
    case "daily":
      return `${intervalLabel}${interval > 1 ? "dias" : "Diário"}`;
    case "weekly":
      return `${intervalLabel}${interval > 1 ? "semanas" : "Semanal"}`;
    case "monthly":
      return `${intervalLabel}${interval > 1 ? "meses" : "Mensal"}`;
    case "yearly":
      return `${intervalLabel}${interval > 1 ? "anos" : "Anual"}`;
    default:
      return freq;
  }
}

function getFrequencyIcon(freq: string) {
  switch (freq) {
    case "daily":
      return "D";
    case "weekly":
      return "S";
    case "monthly":
      return "M";
    case "yearly":
      return "A";
    default:
      return "?";
  }
}

function getDueDateUrgency(nextDueDate: Date, active: boolean) {
  if (!active) return null;
  const today = new Date();
  const diff = differenceInDays(nextDueDate, today);
  if (!isAfter(nextDueDate, today)) return "overdue";
  if (diff <= 3) return "critical";
  if (diff <= 7) return "warning";
  return null;
}

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-3 border-b">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-16 rounded-full" />
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
          <Skeleton className="h-8 w-8 rounded mt-0.5 shrink-0" />
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
  urgency: string | null;
  canManage: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

function MobileRecurrenceCard({
  template: t,
  urgency,
  canManage,
  onEdit,
  onToggleActive,
  onDelete,
}: MobileRecurrenceCardProps) {
  return (
    <div
      className={[
        "flex items-start gap-3 px-4 py-3.5 transition-colors select-none",
        "border-l-4",
        urgency === "overdue"
          ? "border-l-red-500 bg-red-50 dark:bg-red-900/10"
          : urgency === "critical"
            ? "border-l-orange-400"
            : urgency === "warning"
              ? "border-l-yellow-400"
              : t.type === "payable"
                ? "border-l-red-200 dark:border-l-red-800"
                : "border-l-green-200 dark:border-l-green-800",
        !t.active && "opacity-60",
      ].join(" ")}
    >
      {/* Frequency icon badge */}
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs font-bold mt-0.5",
          t.type === "payable"
            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
            : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
        )}
        title={t.frequency}
      >
        {getFrequencyIcon(t.frequency)}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug truncate flex-1">
            {t.description}
          </p>
          <span className="text-sm font-bold font-financial shrink-0">
            {formatCurrency(t.amount)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {getFrequencyLabel(t.frequency, t.interval)} ·{" "}
          {t.type === "payable" ? "Despesa" : "Receita"}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className={cn(
              "text-xs flex items-center gap-0.5",
              urgency === "overdue" &&
                "text-red-500 dark:text-red-400 font-medium",
              urgency === "critical" &&
                "text-orange-600 dark:text-orange-400 font-medium",
              urgency === "warning" &&
                "text-yellow-600 dark:text-yellow-500 font-medium",
              !urgency && "text-muted-foreground",
            )}
          >
            {urgency === "overdue" && (
              <AlertTriangle className="h-3 w-3 mr-0.5 shrink-0" />
            )}
            {format(t.nextDueDate, "dd MMM yyyy", { locale: ptBR })}
            {urgency === "overdue" && " · Vencida"}
          </span>
          <Badge
            variant={t.active ? "default" : "secondary"}
            className={cn(
              "h-5 text-[10px] px-1.5",
              t.active
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "",
            )}
          >
            {t.active ? "Ativo" : "Pausado"}
          </Badge>
        </div>
      </div>

      {/* Actions menu */}
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
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleActive}>
              {t.active ? (
                <PauseCircle className="mr-2 h-4 w-4" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              {t.active ? "Pausar" : "Ativar"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-red-600 focus:text-red-700"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="w-11 h-11 shrink-0" />
      )}
    </div>
  );
}

export default function RecorrenciasPage() {
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canViewRecurrences, canManageRecurrences } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] =
    useState<RecurringTransactionTemplate | null>(null);

  // All active templates for KPI calculation (unfiltered)
  const [allTemplates, setAllTemplates] = useState<
    RecurringTransactionTemplate[]
  >([]);
  const [kpiLoading, setKpiLoading] = useState(true);

  useEffect(() => {
    if (!canViewRecurrences) {
      router.push("/dashboard");
    }
  }, [canViewRecurrences, router]);

  // Load all active templates for KPI computation
  useEffect(() => {
    if (!selectedCompany || !canViewRecurrences) return;
    setKpiLoading(true);
    recurrenceService
      .getTemplates(selectedCompany.id)
      .then(setAllTemplates)
      .catch(() => {})
      .finally(() => setKpiLoading(false));
  }, [selectedCompany, canViewRecurrences]);

  const {
    items: templates,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    refresh: fetchTemplates,
  } = usePaginatedQuery<RecurringTransactionTemplate>({
    queryKey: [
      "recurrences",
      selectedCompany?.id,
      statusFilter,
      debouncedSearchTerm,
    ],
    queryFn: async (pageSize, lastDoc) => {
      const filter: { active?: boolean; searchTerm?: string } = {
        active: statusFilter === "all" ? undefined : statusFilter === "active",
      };
      if (debouncedSearchTerm) {
        filter.searchTerm = debouncedSearchTerm;
      }
      const { templates: items, lastDoc: newLastDoc } =
        await recurrenceService.getPaginated(
          selectedCompany!.id,
          pageSize,
          lastDoc,
          filter,
        );
      return { items, lastDoc: newLastDoc };
    },
    pageSize: 25,
    enabled: !!selectedCompany && canViewRecurrences,
  });

  // KPIs derived from all active templates
  const kpis = useMemo(() => {
    const active = allTemplates.filter((t) => t.active);
    const today = new Date();

    const toMonthlyAmount = (t: RecurringTransactionTemplate): number => {
      switch (t.frequency) {
        case "daily":
          return (t.amount * 30) / t.interval;
        case "weekly":
          return (t.amount * (52 / 12)) / t.interval;
        case "monthly":
          return t.amount / t.interval;
        case "yearly":
          return t.amount / 12 / t.interval;
        default:
          return 0;
      }
    };

    const mrr = active
      .filter((t) => t.type === "receivable")
      .reduce((sum, t) => sum + toMonthlyAmount(t), 0);

    const fixedCost = active
      .filter((t) => t.type === "payable")
      .reduce((sum, t) => sum + toMonthlyAmount(t), 0);

    const dueIn7 = active.filter((t) => {
      const diff = differenceInDays(t.nextDueDate, today);
      return diff >= 0 && diff <= 7;
    });

    const overdue = active.filter((t) => !isAfter(t.nextDueDate, today));

    return { mrr, fixedCost, totalActive: active.length, dueIn7, overdue };
  }, [allTemplates]);

  if (!canViewRecurrences) return null;

  const handleToggleActive = async (template: RecurringTransactionTemplate) => {
    try {
      await recurrenceService.updateTemplate(template.id, {
        active: !template.active,
      });
      toast.success(
        `Recorrência ${template.active ? "pausada" : "ativada"} com sucesso!`,
      );
      fetchTemplates();
      recurrenceService.getTemplates(selectedCompany!.id).then(setAllTemplates);
    } catch {
      toast.error("Erro ao atualizar recorrência.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await recurrenceService.deleteTemplate(deleteId);
      toast.success("Recorrência excluída com sucesso!");
      fetchTemplates();
      recurrenceService.getTemplates(selectedCompany!.id).then(setAllTemplates);
    } catch {
      toast.error("Erro ao excluir recorrência.");
    } finally {
      setDeleteId(null);
    }
  };

  const activeFilterCount = statusFilter !== "all" ? 1 : 0;
  const hasActiveFilters = activeFilterCount > 0;

  const statusLabels: Record<string, string> = {
    active: "Ativos",
    paused: "Pausados",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            Recorrências
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie suas assinaturas e transações recorrentes.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* MRR */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              MRR (Receita Mensal)
            </CardTitle>
            <div className="rounded-md bg-green-100 p-1.5 dark:bg-green-900/30">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            {kpiLoading ? (
              <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            ) : (
              <div
                className="text-2xl font-bold text-green-600 dark:text-green-400"
                title={formatCurrency(kpis.mrr)}
              >
                <AnimatedCounter
                  value={kpis.mrr}
                  formatter={formatCurrencyAbbr}
                  duration={700}
                />
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Receitas ativas mensalizadas
            </p>
          </CardContent>
        </Card>

        {/* Compromisso fixo */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Compromisso Fixo
            </CardTitle>
            <div className="rounded-md bg-red-100 p-1.5 dark:bg-red-900/30">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            {kpiLoading ? (
              <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            ) : (
              <div
                className="text-2xl font-bold text-red-600 dark:text-red-400"
                title={formatCurrency(kpis.fixedCost)}
              >
                <AnimatedCounter
                  value={kpis.fixedCost}
                  formatter={formatCurrencyAbbr}
                  duration={700}
                />
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Despesas ativas mensalizadas
            </p>
          </CardContent>
        </Card>

        {/* Total ativo */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recorrências Ativas
            </CardTitle>
            <div className="rounded-md bg-blue-100 p-1.5 dark:bg-blue-900/30">
              <RepeatIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            {kpiLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-2xl font-bold">
                <AnimatedCounter
                  value={kpis.totalActive}
                  formatter={(v) => Math.round(v).toString()}
                  duration={500}
                />
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Templates em execução
            </p>
          </CardContent>
        </Card>

        {/* Vencendo em breve / vencidas */}
        <Card
          className={cn(
            kpis.overdue.length > 0 && "border-red-300 dark:border-red-800",
            kpis.overdue.length === 0 &&
              kpis.dueIn7.length > 0 &&
              "border-yellow-300 dark:border-yellow-800",
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Atenção Necessária
            </CardTitle>
            <div
              className={cn(
                "rounded-md p-1.5",
                kpis.overdue.length > 0
                  ? "bg-red-100 dark:bg-red-900/30"
                  : kpis.dueIn7.length > 0
                    ? "bg-yellow-100 dark:bg-yellow-900/30"
                    : "bg-muted",
              )}
            >
              {kpis.overdue.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
              ) : (
                <CalendarClock
                  className={cn(
                    "h-4 w-4",
                    kpis.dueIn7.length > 0
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-muted-foreground",
                  )}
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {kpiLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <>
                {kpis.overdue.length > 0 && (
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {kpis.overdue.length} vencida
                    {kpis.overdue.length > 1 ? "s" : ""}
                  </div>
                )}
                {kpis.overdue.length === 0 && kpis.dueIn7.length > 0 && (
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {kpis.dueIn7.length} em 7 dias
                  </div>
                )}
                {kpis.overdue.length === 0 && kpis.dueIn7.length === 0 && (
                  <div className="text-2xl font-bold text-muted-foreground">
                    —
                  </div>
                )}
              </>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {kpis.overdue.length > 0
                ? "Verifique as recorrências vencidas"
                : kpis.dueIn7.length > 0
                  ? `${kpis.dueIn7.length} vencem nos próximos 7 dias`
                  : "Nenhum vencimento próximo"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table card */}
      <Card>
        <CardHeader className="space-y-3">
          {/* ── Title row ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Modelos de Recorrência</CardTitle>
            {!isLoading && (
              <span className="md:hidden text-xs text-muted-foreground tabular-nums shrink-0">
                {templates.length}
                {hasMore ? "+" : ""} resultado
                {templates.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* ── Mobile: busca + botão de filtros numa linha ───────── */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar recorrências..."
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
              className={[
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                activeFilterCount > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* ── Mobile: chips de filtros ativos (scroll horizontal) ── */}
          {hasActiveFilters && (
            <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {statusFilter !== "all" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
                  {statusLabels[statusFilter] ?? statusFilter}
                  <button
                    onClick={() => setStatusFilter("all")}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                    aria-label="Remover filtro de status"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              <button
                onClick={() => setStatusFilter("all")}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors ml-1"
              >
                Limpar tudo
              </button>
            </div>
          )}

          {/* ── Desktop: descrição + busca + filtro de status ───────── */}
          <div className="hidden md:flex flex-col gap-4 md:flex-row md:items-center justify-between">
            <CardDescription>
              Lista de transações que são geradas automaticamente.
            </CardDescription>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por descrição exata..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[250px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="paused">Pausados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading && templates.length === 0 ? (
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
              {/* ── Desktop: Table ───────────────────────────────────── */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Descrição</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Frequência</TableHead>
                      <TableHead>Próx. Vencimento</TableHead>
                      <TableHead>Status</TableHead>
                      {canManageRecurrences && (
                        <TableHead className="pr-6 text-right">Ações</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canManageRecurrences ? 7 : 6}
                          className="py-16 text-center"
                        >
                          <div className="flex flex-col items-center gap-3">
                            <div className="rounded-full bg-muted p-4">
                              <RefreshCw className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {searchTerm || statusFilter !== "all"
                                  ? "Nenhuma recorrência encontrada"
                                  : "Nenhuma recorrência cadastrada"}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {searchTerm
                                  ? `Sem resultados para "${searchTerm}"`
                                  : statusFilter !== "all"
                                    ? "Tente mudar o filtro de status"
                                    : "As recorrências gerarão transações automaticamente"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      templates.map((t) => {
                        const urgency = getDueDateUrgency(
                          t.nextDueDate,
                          t.active,
                        );
                        return (
                          <TableRow
                            key={t.id}
                            className={cn(
                              "transition-colors",
                              !t.active && "opacity-50",
                            )}
                          >
                            {/* Descrição */}
                            <TableCell className="pl-6 font-medium">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                                    t.type === "payable"
                                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                      : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
                                  )}
                                  title={t.frequency}
                                >
                                  {getFrequencyIcon(t.frequency)}
                                </span>
                                {t.description}
                              </div>
                            </TableCell>

                            {/* Tipo */}
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-medium",
                                  t.type === "payable"
                                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                                    : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400",
                                )}
                              >
                                {t.type === "payable" ? "Despesa" : "Receita"}
                              </Badge>
                            </TableCell>

                            {/* Valor */}
                            <TableCell className="font-financial font-medium">
                              {formatCurrency(t.amount)}
                            </TableCell>

                            {/* Frequência */}
                            <TableCell className="text-sm text-muted-foreground">
                              {getFrequencyLabel(t.frequency, t.interval)}
                            </TableCell>

                            {/* Próx. Vencimento */}
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {urgency === "overdue" && (
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                                )}
                                <span
                                  className={cn(
                                    "text-sm tabular-nums",
                                    urgency === "overdue" &&
                                      "font-semibold text-red-600 dark:text-red-400",
                                    urgency === "critical" &&
                                      "font-semibold text-orange-600 dark:text-orange-400",
                                    urgency === "warning" &&
                                      "font-medium text-yellow-600 dark:text-yellow-500",
                                  )}
                                >
                                  {format(t.nextDueDate, "dd/MM/yyyy", {
                                    locale: ptBR,
                                  })}
                                </span>
                                {urgency === "overdue" && (
                                  <Badge
                                    variant="destructive"
                                    className="h-4 px-1 text-[10px]"
                                  >
                                    Vencida
                                  </Badge>
                                )}
                                {urgency === "critical" && (
                                  <Badge className="h-4 bg-orange-100 px-1 text-[10px] text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                    3 dias
                                  </Badge>
                                )}
                              </div>
                            </TableCell>

                            {/* Status */}
                            <TableCell>
                              <Badge
                                variant={t.active ? "default" : "secondary"}
                                className={cn(
                                  t.active
                                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : "",
                                )}
                              >
                                {t.active ? "Ativo" : "Pausado"}
                              </Badge>
                            </TableCell>

                            {/* Ações */}
                            {canManageRecurrences && (
                              <TableCell className="pr-6 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setEditTemplate(t)}
                                    title="Editar"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleToggleActive(t)}
                                    title={t.active ? "Pausar" : "Ativar"}
                                  >
                                    {t.active ? (
                                      <PauseCircle className="h-3.5 w-3.5" />
                                    ) : (
                                      <PlayCircle className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                                    onClick={() => setDeleteId(t.id)}
                                    title="Excluir"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>

                {hasMore && (
                  <div className="flex justify-center border-t py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMore}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Carregando...
                        </>
                      ) : (
                        "Carregar Mais"
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* ── Mobile: Card list ────────────────────────────────── */}
              <div className="md:hidden">
                {templates.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 px-4 text-muted-foreground">
                    <div className="rounded-full bg-muted p-4">
                      <RefreshCw className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium">
                        {searchTerm || statusFilter !== "all"
                          ? "Nenhuma recorrência encontrada"
                          : "Nenhuma recorrência cadastrada"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {searchTerm
                          ? `Sem resultados para "${searchTerm}"`
                          : statusFilter !== "all"
                            ? "Tente mudar o filtro de status"
                            : "As recorrências gerarão transações automaticamente"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="divide-y">
                      {templates.map((t) => {
                        const urgency = getDueDateUrgency(
                          t.nextDueDate,
                          t.active,
                        );
                        return (
                          <MobileRecurrenceCard
                            key={t.id}
                            template={t}
                            urgency={urgency}
                            canManage={canManageRecurrences}
                            onEdit={() => setEditTemplate(t)}
                            onToggleActive={() => handleToggleActive(t)}
                            onDelete={() => setDeleteId(t.id)}
                          />
                        );
                      })}
                    </div>

                    {hasMore && (
                      <div className="flex justify-center border-t py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadMore}
                          disabled={isFetchingNextPage}
                        >
                          {isFetchingNextPage ? (
                            <>
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              Carregando...
                            </>
                          ) : (
                            "Carregar Mais"
                          )}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Mobile filter sheet ──────────────────────────────────── */}
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
                Status
              </p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="paused">Pausados</SelectItem>
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
                onClick={() => {
                  setMobileFiltersOpen(false);
                  if (activeFilterCount > 0) toast.success("Filtros aplicados");
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Desativar Recorrência"
        description="Tem certeza que deseja desativar esta recorrência? Ela parará de gerar transações, mas poderá ser reativada depois."
        confirmText="Desativar"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <EditRecurrenceDialog
        open={!!editTemplate}
        onOpenChange={(open) => !open && setEditTemplate(null)}
        template={editTemplate}
        onSuccess={() => {
          fetchTemplates();
          recurrenceService
            .getTemplates(selectedCompany!.id)
            .then(setAllTemplates);
        }}
      />
    </div>
  );
}
