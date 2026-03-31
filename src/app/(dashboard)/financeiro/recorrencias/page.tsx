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
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditRecurrenceDialog } from "@/components/features/finance/EditRecurrenceDialog";
import { AnimatedCounter } from "@/components/ui/animated-counter";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";

export default function RecorrenciasPage() {
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canViewRecurrences, canManageRecurrences } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] =
    useState<RecurringTransactionTemplate | null>(null);

  // All active templates for KPI calculation (unfiltered)
  const [allTemplates, setAllTemplates] = useState<RecurringTransactionTemplate[]>([]);
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
    queryKey: ["recurrences", selectedCompany?.id, statusFilter, debouncedSearchTerm],
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

    // Monthly equivalent for each active template
    const toMonthlyAmount = (t: RecurringTransactionTemplate): number => {
      switch (t.frequency) {
        case "daily":   return t.amount * 30 / t.interval;
        case "weekly":  return t.amount * (52 / 12) / t.interval;
        case "monthly": return t.amount / t.interval;
        case "yearly":  return t.amount / 12 / t.interval;
        default:        return 0;
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
      // Refresh KPI data
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

  const getFrequencyLabel = (freq: string, interval: number) => {
    const intervalLabel = interval > 1 ? `A cada ${interval} ` : "";
    switch (freq) {
      case "daily":   return `${intervalLabel}${interval > 1 ? "dias" : "Diário"}`;
      case "weekly":  return `${intervalLabel}${interval > 1 ? "semanas" : "Semanal"}`;
      case "monthly": return `${intervalLabel}${interval > 1 ? "meses" : "Mensal"}`;
      case "yearly":  return `${intervalLabel}${interval > 1 ? "anos" : "Anual"}`;
      default:        return freq;
    }
  };

  const getFrequencyIcon = (freq: string) => {
    switch (freq) {
      case "daily":   return "D";
      case "weekly":  return "S";
      case "monthly": return "M";
      case "yearly":  return "A";
      default:        return "?";
    }
  };

  const getDueDateUrgency = (nextDueDate: Date, active: boolean) => {
    if (!active) return null;
    const today = new Date();
    const diff = differenceInDays(nextDueDate, today);
    if (!isAfter(nextDueDate, today)) return "overdue";
    if (diff <= 3) return "critical";
    if (diff <= 7) return "warning";
    return null;
  };

  if (isLoading && templates.length === 0) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recorrências</h1>
          <p className="text-muted-foreground">
            Gerencie suas assinaturas e transações recorrentes.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                <AnimatedCounter
                  value={kpis.mrr}
                  formatter={formatCurrency}
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
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                <AnimatedCounter
                  value={kpis.fixedCost}
                  formatter={formatCurrency}
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
        <Card className={cn(
          kpis.overdue.length > 0 && "border-red-300 dark:border-red-800",
          kpis.overdue.length === 0 && kpis.dueIn7.length > 0 && "border-yellow-300 dark:border-yellow-800",
        )}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Atenção Necessária
            </CardTitle>
            <div className={cn(
              "rounded-md p-1.5",
              kpis.overdue.length > 0
                ? "bg-red-100 dark:bg-red-900/30"
                : kpis.dueIn7.length > 0
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "bg-muted",
            )}>
              {kpis.overdue.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
              ) : (
                <CalendarClock className={cn(
                  "h-4 w-4",
                  kpis.dueIn7.length > 0
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-muted-foreground",
                )} />
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
                    {kpis.overdue.length} vencida{kpis.overdue.length > 1 ? "s" : ""}
                  </div>
                )}
                {kpis.overdue.length === 0 && kpis.dueIn7.length > 0 && (
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {kpis.dueIn7.length} em 7 dias
                  </div>
                )}
                {kpis.overdue.length === 0 && kpis.dueIn7.length === 0 && (
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
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
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Modelos de Recorrência</CardTitle>
              <CardDescription>
                Lista de transações que são geradas automaticamente.
              </CardDescription>
            </div>
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
                  const urgency = getDueDateUrgency(t.nextDueDate, t.active);
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
                          {/* Frequency badge */}
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
                      <TableCell className="tabular-nums font-medium">
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
                              urgency === "overdue" && "font-semibold text-red-600 dark:text-red-400",
                              urgency === "critical" && "font-semibold text-orange-600 dark:text-orange-400",
                              urgency === "warning" && "font-medium text-yellow-600 dark:text-yellow-500",
                            )}
                          >
                            {format(t.nextDueDate, "dd/MM/yyyy", { locale: ptBR })}
                          </span>
                          {urgency === "overdue" && (
                            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
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
        </CardContent>
      </Card>

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
          recurrenceService.getTemplates(selectedCompany!.id).then(setAllTemplates);
        }}
      />
    </div>
  );
}
