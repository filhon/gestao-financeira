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
import {
  FileText,
  Download,
  CalendarIcon,
  TrendingUp,
  BarChart3,
  Layers,
  Sparkles,
  Sheet,
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

  const { costCenters, fetchCostCenters } = useCostCenterStore();

  useEffect(() => {
    if (selectedCompany) {
      const forUserId = onlyOwnPayables ? user?.uid : undefined;
      fetchCostCenters(selectedCompany.id, forUserId);
    }
  }, [selectedCompany, user, onlyOwnPayables, fetchCostCenters]);

  const selectedReportType =
    REPORT_TYPES.find((r) => r.value === reportType) ?? REPORT_TYPES[0];

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
    <div className="space-y-6">
      {/* Header — padrão do sistema */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground">
            Gere e exporte relatórios financeiros por período.
          </p>
        </div>
      </div>

      {/* Report Type Cards */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "0ms", animationFillMode: "both" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

      {/* Period & Filters Card */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
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
                      <SelectItem value="paid">Somente Pagas</SelectItem>
                      <SelectItem value="approved">
                        Somente Aprovadas
                      </SelectItem>
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
                  <div className="max-w-[200px]">
                    <CurrencyInput
                      value={initialBalance}
                      onChange={setInitialBalance}
                      placeholder="R$ 0,00"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Separator + Actions */}
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between flex-wrap gap-3">
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleGenerate("csv")}
                  disabled={isLoading}
                  loading={loadingFormat === "csv"}
                >
                  {loadingFormat !== "csv" && <Download className="h-4 w-4" />}
                  Exportar CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleGenerate("excel")}
                  disabled={isLoading}
                  loading={loadingFormat === "excel"}
                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-950"
                >
                  {loadingFormat !== "excel" && <Sheet className="h-4 w-4" />}
                  Exportar Excel
                </Button>
                <Button
                  onClick={() => handleGenerate("pdf")}
                  disabled={isLoading}
                  loading={loadingFormat === "pdf"}
                >
                  {loadingFormat !== "pdf" && <FileText className="h-4 w-4" />}
                  Gerar PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
