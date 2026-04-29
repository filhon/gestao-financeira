"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenterStore } from "@/lib/store/useCostCenterStore";
import { transactionService } from "@/lib/services/transactionService";
import { entityService } from "@/lib/services/entityService";
import { reportService } from "@/lib/services/reportService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { Transaction, Entity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  FileText,
  Download,
  CalendarIcon,
  TrendingUp,
  BarChart3,
  Layers,
  Sparkles,
  Sheet as SheetIcon,
  SlidersHorizontal,
  X,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  format,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isAfter,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CurrencyInput } from "@/components/ui/currency-input";

const REPORT_TYPES = [
  {
    value: "cash_flow",
    label: "Fluxo de Caixa",
    description: "Entradas e saídas por período com saldo acumulado",
    icon: TrendingUp,
    accentClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950",
    borderClass: "border-emerald-200 dark:border-emerald-800",
    stripClass: "bg-gradient-to-r from-emerald-500 to-teal-400",
    dotClass: "bg-emerald-500",
  },
  {
    value: "consolidated",
    label: "Fluxo Consolidado",
    description: "Inclui projeções de recorrências futuras",
    icon: Layers,
    accentClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950",
    borderClass: "border-blue-200 dark:border-blue-800",
    stripClass: "bg-gradient-to-r from-blue-500 to-indigo-400",
    dotClass: "bg-blue-500",
  },
  {
    value: "dre",
    label: "DRE",
    description: "Demonstrativo de Resultados do Exercício",
    icon: BarChart3,
    accentClass: "text-violet-600 dark:text-violet-400",
    bgClass: "bg-violet-50 dark:bg-violet-950",
    borderClass: "border-violet-200 dark:border-violet-800",
    stripClass: "bg-gradient-to-r from-violet-500 to-purple-400",
    dotClass: "bg-violet-500",
  },
  {
    value: "transfer_guide",
    label: "Guia de Transferências",
    description: "PIX agrupado por entidade/dia e boletos com linha digitável",
    icon: Landmark,
    accentClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950",
    borderClass: "border-amber-200 dark:border-amber-800",
    stripClass: "bg-gradient-to-r from-amber-500 to-orange-400",
    dotClass: "bg-amber-500",
  },
];

const QUICK_PERIODS = [
  {
    label: "Este mês",
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
  },
  {
    label: "Mês anterior",
    start: startOfMonth(subMonths(new Date(), 1)),
    end: endOfMonth(subMonths(new Date(), 1)),
  },
  {
    label: "Trimestre",
    start: new Date(
      new Date().getFullYear(),
      Math.floor(new Date().getMonth() / 3) * 3,
      1,
    ),
    end: new Date(
      new Date().getFullYear(),
      Math.floor(new Date().getMonth() / 3) * 3 + 3,
      0,
    ),
  },
  {
    label: "Este ano",
    start: new Date(new Date().getFullYear(), 0, 1),
    end: new Date(new Date().getFullYear(), 11, 31),
  },
];

const STATUS_LABELS: Record<string, string> = {
  all: "Todos os status",
  paid: "Somente Pagas",
  authorized: "Somente Autorizadas",
  approved: "Somente Aprovadas",
  pending_approval: "Somente Pendentes",
  draft: "Somente Rascunhos",
};

export default function ReportsPage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { onlyOwnPayables } = usePermissions();
  const [loadingFormat, setLoadingFormat] = useState<
    "pdf" | "csv" | "excel" | null
  >(null);
  const isLoading = loadingFormat !== null;

  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [reportType, setReportType] = useState("cash_flow");
  const [initialBalance, setInitialBalance] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [costCenterFilter, setCostCenterFilter] = useState("all");
  const [activeQuickPeriod, setActiveQuickPeriod] = useState<string | null>(
    "Este mês",
  );
  const [mobileConfigOpen, setMobileConfigOpen] = useState(false);

  const { costCenters, fetchCostCenters } = useCostCenterStore();

  useEffect(() => {
    if (selectedCompany) {
      const forUserId = onlyOwnPayables ? user?.uid : undefined;
      fetchCostCenters(selectedCompany.id, forUserId);
    }
  }, [selectedCompany, user, onlyOwnPayables, fetchCostCenters]);

  // Ao selecionar o Guia de Transferências, pré-seleciona status "Autorizado"
  // (apenas se o filtro ainda estiver no padrão "all")
  useEffect(() => {
    if (reportType === "transfer_guide" && statusFilter === "all") {
      setStatusFilter("authorized");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  const selectedReportType =
    REPORT_TYPES.find((r) => r.value === reportType) ?? REPORT_TYPES[0];

  const activeConfigCount =
    (statusFilter !== "all" ? 1 : 0) + (costCenterFilter !== "all" ? 1 : 0);

  const handleGenerate = async (formatType: "pdf" | "csv" | "excel") => {
    if (!selectedCompany || !user) return;

    try {
      setLoadingFormat(formatType);

      // A query do Firestore filtra por dueDate. Para capturar transações com
      // vencimento anterior ao período mas pagas dentro dele (ex: vencimento 26/02,
      // pago em 03/03), alargamos a janela em 90 dias no passado. O filtro preciso
      // pela data efetiva é feito em memória logo abaixo.
      const filter: {
        companyId: string;
        createdBy?: string;
        startDate?: Date;
        endDate?: Date;
        costCenterId?: string;
      } = {
        companyId: selectedCompany.id,
        startDate: subDays(startDate, 90),
        endDate: endDate,
      };
      if (onlyOwnPayables) {
        filter.createdBy = user.uid;
      }
      if (costCenterFilter !== "all") {
        filter.costCenterId = costCenterFilter;
      }

      const [allTransactions, entities] = await Promise.all([
        transactionService.getAll(filter),
        entityService.getAll(selectedCompany.id),
      ]);

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      let filtered = allTransactions.filter((t) => {
        const dateToCheck =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        return dateToCheck >= start && dateToCheck <= end;
      });

      if (reportType === "consolidated") {
        const templates = await recurrenceService.getTemplates(
          selectedCompany.id,
          { active: true },
        );

        const projectedTransactions: Transaction[] = [];

        templates.forEach((template) => {
          let nextDate = template.nextDueDate;
          const interval = template.interval || 1;

          while (
            !isAfter(nextDate, end) &&
            (!template.endDate || !isAfter(nextDate, template.endDate))
          ) {
            if (nextDate >= start) {
              projectedTransactions.push({
                ...template.baseTransactionData,
                id: `proj_${template.id}_${nextDate.getTime()}`,
                companyId: selectedCompany.id,
                description: `${template.description} (Projeção)`,
                amount: template.amount,
                type: template.type,
                status: "draft",
                dueDate: nextDate,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: "system",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any as Transaction);
            }

            switch (template.frequency) {
              case "daily":
                nextDate = addDays(nextDate, interval);
                break;
              case "weekly":
                nextDate = addWeeks(nextDate, interval);
                break;
              case "monthly":
                nextDate = addMonths(nextDate, interval);
                break;
              case "yearly":
                nextDate = addYears(nextDate, interval);
                break;
              default:
                nextDate = addMonths(nextDate, interval);
            }
          }
        });

        filtered = [...filtered, ...projectedTransactions];
        filtered.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      }

      if (statusFilter !== "all") {
        filtered = filtered.filter((t) => t.status === statusFilter);
      }

      // ── Guia de Transferências ──────────────────────────────────────────
      if (reportType === "transfer_guide") {
        if (formatType !== "excel") {
          toast.info(
            "O Guia de Transferências está disponível apenas no formato Excel.",
          );
          return;
        }
        const payablesForGuide = filtered.filter((t) => t.type === "payable");
        const hasData = payablesForGuide.some(
          (t) => t.paymentMethod === "pix" || t.paymentMethod === "boleto",
        );
        if (!hasData) {
          toast.warning(
            "Nenhuma transação com forma de pagamento PIX ou Boleto encontrada no período.",
          );
          return;
        }
        await reportService.exportTransferGuide(
          payablesForGuide,
          start,
          end,
          selectedCompany.name,
          entities as Entity[],
        );
        toast.success("Guia de Transferências gerado!");
        return;
      }

      if (filtered.length === 0) {
        toast.warning("Nenhuma transação encontrada no período.");
        return;
      }

      if (formatType === "csv") {
        reportService.exportToCSV(filtered);
        toast.success("Exportação CSV concluída!");
      } else if (formatType === "excel") {
        await reportService.exportToExcel(
          filtered,
          start,
          end,
          selectedCompany.name,
          entities as Entity[],
        );
        toast.success("Exportação Excel concluída!");
      } else {
        if (reportType === "cash_flow") {
          await reportService.generateCashFlowPDF(
            filtered,
            start,
            end,
            selectedCompany.name,
            entities as Entity[],
          );
        } else if (reportType === "dre") {
          await reportService.generateDREPDF(
            filtered,
            start,
            end,
            selectedCompany.name,
          );
        } else if (reportType === "consolidated") {
          await reportService.generateConsolidatedCashFlowPDF(
            filtered,
            start,
            end,
            selectedCompany.name,
            initialBalance,
          );
        }
        toast.success("Relatório PDF gerado!");
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar relatório.");
    } finally {
      setLoadingFormat(null);
    }
  };

  return (
    <div className="space-y-6 pb-28 md:pb-0">
      {/* Header — padrão do sistema */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Relatórios
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Gere e exporte relatórios financeiros por período.
          </p>
        </div>
      </div>

      {/* Report Type Cards */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "0ms", animationFillMode: "both" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {REPORT_TYPES.map((type) => {
            const Icon = type.icon;
            const isSelected = reportType === type.value;
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => setReportType(type.value)}
                className={cn(
                  "relative text-left rounded-xl border transition-all duration-200 overflow-hidden",
                  "hover:shadow-md hover:shadow-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? cn(type.bgClass, type.borderClass)
                    : "border-border bg-card hover:-translate-y-0.5",
                )}
              >
                {/* accent strip — igual ao CadastrosPage */}
                {isSelected && (
                  <div
                    className={cn(
                      "absolute top-0 left-0 h-1 w-full",
                      type.stripClass,
                    )}
                  />
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg",
                        isSelected ? type.bgClass : "bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          isSelected
                            ? type.accentClass
                            : "text-muted-foreground",
                        )}
                      />
                    </div>
                    {isSelected && (
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full mt-1",
                          type.dotClass,
                        )}
                      />
                    )}
                  </div>
                  <p
                    className={cn(
                      "text-sm font-semibold leading-tight",
                      isSelected ? type.accentClass : "text-foreground",
                    )}
                  >
                    {type.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    {type.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Mobile: compact config summary ──────────────────────────────── */}
      <div
        className="md:hidden space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "80ms", animationFillMode: "both" }}
      >
        {/* Active config chips — scrollable horizontal row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* Period chip — always shown */}
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted pl-2.5 pr-3 py-1 text-xs font-medium text-foreground">
            <CalendarIcon className="h-3 w-3 text-muted-foreground" />
            {format(startDate, "dd MMM", { locale: ptBR })}
            {" → "}
            {format(endDate, "dd MMM yy", { locale: ptBR })}
          </span>

          {/* Status chip */}
          {statusFilter !== "all" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary">
              {STATUS_LABELS[statusFilter] ?? statusFilter}
              <button
                onClick={() => setStatusFilter("all")}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                aria-label="Remover filtro de status"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}

          {/* Cost center chip */}
          {costCenterFilter !== "all" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-0.5 text-xs font-medium text-primary max-w-[140px]">
              <span className="truncate">
                {costCenters.find((c) => c.id === costCenterFilter)?.name ??
                  "CC"}
              </span>
              <button
                onClick={() => setCostCenterFilter("all")}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                aria-label="Remover filtro de centro de custo"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
        </div>

        {/* Config button */}
        <button
          type="button"
          onClick={() => setMobileConfigOpen(true)}
          className={cn(
            "relative flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
            activeConfigCount > 0
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Configurar relatório
          {activeConfigCount > 0 && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {activeConfigCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Desktop: Period & Filters Card ──────────────────────────────── */}
      <div
        className="hidden md:block animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "80ms", animationFillMode: "both" }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Configurar Relatório</CardTitle>
                <CardDescription>
                  Defina o período, filtros e formato de exportação.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Período */}
            <div className="space-y-3">
              <Label>Período</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_PERIODS.map((range) => (
                  <button
                    key={range.label}
                    type="button"
                    onClick={() => {
                      setStartDate(range.start);
                      setEndDate(range.end);
                      setActiveQuickPeriod(range.label);
                    }}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-md border transition-all duration-100 font-medium",
                      activeQuickPeriod === range.label
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">
                    Data Inicial
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full pl-3 text-left font-normal",
                          !startDate && "text-muted-foreground",
                        )}
                      >
                        {startDate
                          ? format(startDate, "dd MMM yyyy", { locale: ptBR })
                          : "Selecione"}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={(date) => {
                          if (date) {
                            setStartDate(date);
                            setActiveQuickPeriod(null);
                          }
                        }}
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">
                    Data Final
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full pl-3 text-left font-normal",
                          !endDate && "text-muted-foreground",
                        )}
                      >
                        {endDate
                          ? format(endDate, "dd MMM yyyy", { locale: ptBR })
                          : "Selecione"}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={(date) => {
                          if (date) {
                            setEndDate(date);
                            setActiveQuickPeriod(null);
                          }
                        }}
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Separator */}
            <div className="h-px bg-border" />

            {/* Filtros */}
            <div className="space-y-3">
              <Label>Filtros</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">
                    Status das Transações
                  </Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="authorized">
                        Somente Autorizadas
                      </SelectItem>
                      <SelectItem value="approved">
                        Somente Aprovadas
                      </SelectItem>
                      <SelectItem value="paid">Somente Pagas</SelectItem>
                      <SelectItem value="pending_approval">
                        Somente Pendentes
                      </SelectItem>
                      <SelectItem value="draft">Somente Rascunhos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">
                    Centro de Custo
                  </Label>
                  <Select
                    value={costCenterFilter}
                    onValueChange={setCostCenterFilter}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os centros</SelectItem>
                      {costCenters.map((cc) => (
                        <SelectItem key={cc.id} value={cc.id}>
                          {cc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Saldo Inicial (apenas para fluxo consolidado) */}
            {reportType === "consolidated" && (
              <>
                <div className="h-px bg-border" />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Label>Saldo Inicial</Label>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-full px-2 py-0.5">
                      <Sparkles className="h-2.5 w-2.5" />
                      Projeção
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground -mt-1">
                    Saldo das contas no dia anterior ao início do período.
                  </p>
                  <div className="w-full sm:max-w-[200px]">
                    <CurrencyInput
                      value={initialBalance}
                      onChange={setInitialBalance}
                      placeholder="R$ 0,00"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Nota para Guia de Transferências */}
            {reportType === "transfer_guide" && (
              <>
                <div className="h-px bg-border" />
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Landmark className="h-4 w-4 shrink-0" />
                    Guia de Transferências
                  </p>
                  <ul className="list-disc list-inside text-xs space-y-0.5 text-amber-700 dark:text-amber-400">
                    <li>
                      <strong>Aba PIX:</strong> transações agrupadas por
                      entidade + dia — uma transferência por grupo.
                    </li>
                    <li>
                      <strong>Aba Boletos:</strong> listagem individual com
                      linha digitável para cada boleto.
                    </li>
                    <li>
                      Recomenda-se filtrar por status{" "}
                      <strong>Autorizado</strong> ou <strong>Aprovado</strong>{" "}
                      para exibir apenas o que ainda precisa ser pago.
                    </li>
                    <li>
                      Os dados bancários (banco, agência, conta, chave PIX) são
                      carregados do cadastro da entidade.
                    </li>
                  </ul>
                </div>
              </>
            )}

            {/* Separator + Actions */}
            <div className="h-px bg-border" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {format(startDate, "dd MMM", { locale: ptBR })}
                </span>
                {" → "}
                <span className="font-medium text-foreground">
                  {format(endDate, "dd MMM yyyy", { locale: ptBR })}
                </span>
                {" · "}
                {selectedReportType.label}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {reportType !== "transfer_guide" && (
                  <Button
                    variant="outline"
                    onClick={() => handleGenerate("csv")}
                    disabled={isLoading}
                    loading={loadingFormat === "csv"}
                    className="w-full sm:w-auto"
                  >
                    {loadingFormat !== "csv" && (
                      <Download className="h-4 w-4" />
                    )}
                    Exportar CSV
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => handleGenerate("excel")}
                  disabled={isLoading}
                  loading={loadingFormat === "excel"}
                  className={cn(
                    "w-full sm:w-auto",
                    reportType === "transfer_guide"
                      ? "text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950"
                      : "text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-950",
                  )}
                >
                  {loadingFormat !== "excel" && (
                    <SheetIcon className="h-4 w-4" />
                  )}
                  {reportType === "transfer_guide"
                    ? "Gerar Guia (Excel)"
                    : "Exportar Excel"}
                </Button>
                {reportType !== "transfer_guide" && (
                  <Button
                    onClick={() => handleGenerate("pdf")}
                    disabled={isLoading}
                    loading={loadingFormat === "pdf"}
                    className="w-full sm:w-auto"
                  >
                    {loadingFormat !== "pdf" && (
                      <FileText className="h-4 w-4" />
                    )}
                    Gerar PDF
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Mobile: sticky export bar ───────────────────────────────────── */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-0 right-0 z-40 md:hidden border-t bg-background/95 backdrop-blur-sm px-4 py-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          <span className={cn("font-medium", selectedReportType.accentClass)}>
            {selectedReportType.label}
          </span>
          {" · "}
          <span className="font-medium text-foreground">
            {format(startDate, "dd MMM", { locale: ptBR })}
            {" → "}
            {format(endDate, "dd MMM yy", { locale: ptBR })}
          </span>
        </p>
        {reportType === "transfer_guide" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleGenerate("excel")}
            disabled={isLoading}
            loading={loadingFormat === "excel"}
            className="w-full text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950"
          >
            {loadingFormat !== "excel" && <SheetIcon className="h-3.5 w-3.5" />}
            Gerar Guia (Excel)
          </Button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleGenerate("csv")}
              disabled={isLoading}
              loading={loadingFormat === "csv"}
            >
              {loadingFormat !== "csv" && <Download className="h-3.5 w-3.5" />}
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleGenerate("excel")}
              disabled={isLoading}
              loading={loadingFormat === "excel"}
              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-950"
            >
              {loadingFormat !== "excel" && (
                <SheetIcon className="h-3.5 w-3.5" />
              )}
              Excel
            </Button>
            <Button
              size="sm"
              onClick={() => handleGenerate("pdf")}
              disabled={isLoading}
              loading={loadingFormat === "pdf"}
            >
              {loadingFormat !== "pdf" && <FileText className="h-3.5 w-3.5" />}
              PDF
            </Button>
          </div>
        )}
      </div>

      {/* ── Mobile: config sheet ─────────────────────────────────────────── */}
      <Sheet open={mobileConfigOpen} onOpenChange={setMobileConfigOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[92dvh] overflow-y-auto px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 shrink-0" />
          <SheetTitle className="mb-4 text-base font-semibold">
            Configurar Relatório
          </SheetTitle>

          <div className="space-y-5">
            {/* Período rápido */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Período Rápido
              </p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PERIODS.map((range) => (
                  <button
                    key={range.label}
                    type="button"
                    onClick={() => {
                      setStartDate(range.start);
                      setEndDate(range.end);
                      setActiveQuickPeriod(range.label);
                    }}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-md border transition-all duration-100 font-medium",
                      activeQuickPeriod === range.label
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Período personalizado — native date inputs (evita conflito Popover/Sheet) */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Período Personalizado
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Input
                    type="date"
                    value={format(startDate, "yyyy-MM-dd")}
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setStartDate(adjusted);
                      setActiveQuickPeriod(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Até</Label>
                  <Input
                    type="date"
                    value={format(endDate, "yyyy-MM-dd")}
                    onChange={(e) => {
                      const d = e.target.valueAsDate;
                      if (!d) return;
                      const adjusted = new Date(
                        d.getTime() + d.getTimezoneOffset() * 60000,
                      );
                      setEndDate(adjusted);
                      setActiveQuickPeriod(null);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="authorized">
                    Somente Autorizadas
                  </SelectItem>
                  <SelectItem value="approved">Somente Aprovadas</SelectItem>
                  <SelectItem value="paid">Somente Pagas</SelectItem>
                  <SelectItem value="pending_approval">
                    Somente Pendentes
                  </SelectItem>
                  <SelectItem value="draft">Somente Rascunhos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Centro de Custo */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Centro de Custo
              </p>
              <Select
                value={costCenterFilter}
                onValueChange={setCostCenterFilter}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os centros</SelectItem>
                  {costCenters.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Saldo Inicial (apenas para fluxo consolidado) */}
            {reportType === "consolidated" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Saldo Inicial
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-full px-2 py-0.5">
                    <Sparkles className="h-2.5 w-2.5" />
                    Projeção
                  </span>
                </div>
                <CurrencyInput
                  value={initialBalance}
                  onChange={setInitialBalance}
                  placeholder="R$ 0,00"
                />
              </div>
            )}

            {/* Nota para Guia de Transferências (mobile) */}
            {reportType === "transfer_guide" && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  Guia de Transferências
                </p>
                <p>
                  Gera um Excel com 2 abas: <strong>PIX</strong> (agrupado por
                  entidade/dia) e <strong>Boletos</strong> (com linha
                  digitável). Recomende filtrar por status{" "}
                  <strong>Autorizado</strong>.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              {activeConfigCount > 0 && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setStatusFilter("all");
                    setCostCenterFilter("all");
                  }}
                >
                  Limpar filtros
                </Button>
              )}
              <Button
                className="flex-1"
                onClick={() => setMobileConfigOpen(false)}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
