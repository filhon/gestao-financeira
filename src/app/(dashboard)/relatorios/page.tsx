"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, isValid, parse, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  AlertCircle,
  CalendarIcon,
  ChevronDown,
  Download,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenters } from "@/hooks/useCostCenters";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { transactionService } from "@/lib/services/transactionService";
import { entityService } from "@/lib/services/entityService";
import { reportService } from "@/lib/services/reportService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { dashboardService } from "@/lib/services/dashboardService";
import { descendantIds, flattenTree } from "@/lib/costCenterTree";
import {
  buildDre,
  DRE_MIN_COVERAGE,
  dreAmount,
  DreRegime,
  effectiveDate,
} from "@/lib/chartOfAccounts";
import {
  buildCashFlow,
  Comparison,
  comparisonRange,
  DEFAULT_FORECAST,
  defaultGranularity,
  FlowStage,
  FORECAST_STAGES,
  formatPercent,
  Granularity,
  openingFromToday,
  periodText,
  projectRecurrences,
  quickPeriods,
  situationOf,
  STAGE_INFO,
} from "@/lib/reports";
import { Transaction } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CashFlowView,
  Drill,
  DrillLine,
  DrillSheet,
  DreView,
  Segmented,
} from "@/components/features/reports/ReportTables";

type ReportKind = "cash_flow" | "dre";
type FlowMode = "realized" | "forecast" | "both";
type ExportFormat = "pdf" | "excel" | "csv";

const EXPORTS: Record<
  ReportKind,
  { format: ExportFormat; label: string; hint: string }[]
> = {
  cash_flow: [
    { format: "pdf", label: "PDF", hint: "Extrato dia a dia com saldo" },
    {
      format: "excel",
      label: "Excel",
      hint: "Extrato, tabela do fluxo e resumo",
    },
    { format: "csv", label: "CSV", hint: "Um lançamento por linha" },
  ],
  dre: [
    { format: "pdf", label: "PDF", hint: "DRE com análise vertical" },
    {
      format: "excel",
      label: "Excel",
      hint: "Mês a mês, com os lançamentos de cada linha",
    },
    { format: "csv", label: "CSV", hint: "A tabela da DRE, meses em colunas" },
  ],
};

const MODE_LABEL: Record<FlowMode, string> = {
  realized: "Realizado",
  forecast: "Previsto",
  both: "Realizado + previsto",
};

/** Junta as consultas (vencimento, pagamento, competência) sem repetir. */
function dedupe(lists: Transaction[][]) {
  const seen = new Set<string>();
  return lists.flat().filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

// ── Estado na URL: o relatório aberto é um link que dá para salvar e enviar ──

const oneOf = <T extends string>(
  v: string | null,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);

const parseDay = (v: string | null) => {
  const d = v ? parse(v, "yyyy-MM-dd", new Date()) : null;
  return d && isValid(d) ? d : null;
};

function rangeFromParams(sp: URLSearchParams) {
  const periods = quickPeriods();
  const p = periods.find((x) => x.key === sp.get("periodo"));
  if (p) return { start: p.start, end: p.end, key: p.key as string | null };
  const start = parseDay(sp.get("de"));
  const end = parseDay(sp.get("ate"));
  if (start && end && start <= end) return { start, end, key: null };
  return { start: periods[0].start, end: periods[0].end, key: periods[0].key };
}

/** useSearchParams exige Suspense para a página continuar pré-renderizada. */
export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { onlyOwnPayables, canViewReports } = usePermissions();

  useEffect(() => {
    if (!canViewReports) router.push("/dashboard");
  }, [canViewReports, router]);

  const periods = quickPeriods();
  const [kind, setKind] = useState<ReportKind>(() =>
    oneOf(searchParams.get("relatorio"), ["cash_flow", "dre"], "cash_flow"),
  );
  const [range, setRange] = useState(() => rangeFromParams(searchParams));
  const [costCenterFilter, setCostCenterFilter] = useState(
    () => searchParams.get("cc") ?? "all",
  );
  const [comparison, setComparison] = useState<Comparison>(() =>
    oneOf(searchParams.get("comparar"), ["none", "previous", "year"], "none"),
  );
  const [mode, setMode] = useState<FlowMode>(() =>
    oneOf(
      searchParams.get("situacao"),
      ["realized", "forecast", "both"],
      "both",
    ),
  );
  const [forecast, setForecast] = useState<FlowStage[]>(DEFAULT_FORECAST);
  const [granularity, setGranularity] = useState<Granularity | "auto">("auto");
  const [openingOverride, setOpeningOverride] = useState<{
    start: number;
    value: number;
  } | null>(null);
  const [regime, setRegime] = useState<DreRegime>(() =>
    oneOf(searchParams.get("regime"), ["competence", "cash"], "competence"),
  );
  const [monthly, setMonthly] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [confirmExport, setConfirmExport] = useState<ExportFormat | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();

  useEffect(() => {
    const params = new URLSearchParams({ relatorio: kind });
    if (range.key) params.set("periodo", range.key);
    else {
      params.set("de", format(range.start, "yyyy-MM-dd"));
      params.set("ate", format(range.end, "yyyy-MM-dd"));
    }
    if (costCenterFilter !== "all") params.set("cc", costCenterFilter);
    if (comparison !== "none") params.set("comparar", comparison);
    if (kind === "cash_flow" && mode !== "both") params.set("situacao", mode);
    if (kind === "dre" && regime !== "competence") params.set("regime", regime);
    const next = params.toString();
    if (next !== window.location.search.slice(1)) {
      router.replace(`/relatorios?${next}`, { scroll: false });
    }
  }, [kind, range, costCenterFilter, comparison, mode, regime, router]);

  const companyId = selectedCompany?.id;
  const createdBy = onlyOwnPayables ? user?.uid : undefined;
  const { costCenters } = useCostCenters(companyId, createdBy);
  const { accounts } = useChartOfAccounts(companyId);
  const ccTree = useMemo(() => flattenTree(costCenters), [costCenters]);
  const ccIds = useMemo(
    () =>
      costCenterFilter === "all"
        ? undefined
        : descendantIds(costCenterFilter, costCenters),
    [costCenterFilter, costCenters],
  );
  const ccName = costCenters.find((c) => c.id === costCenterFilter)?.name;

  const stages = useMemo<FlowStage[]>(
    () =>
      mode === "realized"
        ? ["realized"]
        : mode === "forecast"
          ? forecast
          : ["realized", ...forecast],
    [mode, forecast],
  );
  const isFlow = kind === "cash_flow";
  const wantsRecurring = isFlow && stages.includes("recurring");
  // Saldo da empresa não vale para um recorte (centro de custo ou só os
  // próprios lançamentos): aí o fluxo mostra o acumulado do recorte.
  const hasOpening = isFlow && !ccIds && !onlyOwnPayables;
  const compRange = useMemo(
    () => comparisonRange(range.start, range.end, comparison),
    [range, comparison],
  );
  const competence = kind === "dre" && regime === "competence";

  // ── Dados ────────────────────────────────────────────────────────────────
  const scopeKey = [
    companyId,
    createdBy ?? "",
    ccIds?.join(",") ?? "",
    competence ? "competence" : "dates",
  ];

  const fetchPeriod = async (start: Date, end: Date) => {
    const base = {
      companyId: companyId!,
      startDate: start,
      endDate: end,
      createdBy,
      costCenterIds: ccIds,
    };
    const [byDue, byPayment, byCompetence] = await Promise.all([
      transactionService.getAll(base),
      transactionService.getByPaymentDate(base),
      competence
        ? transactionService
            .getByCompetence({
              companyId: companyId!,
              from: format(start, "yyyy-MM"),
              to: format(end, "yyyy-MM"),
              createdBy,
              costCenterIds: ccIds,
            })
            .catch((error) => {
              // Sem o índice publicado a DRE ainda sai, só sem os lançamentos
              // de competência no período e data fora dele; a tela avisa.
              console.warn("Consulta por competência indisponível", error);
              return null;
            })
        : [],
    ]);
    return {
      transactions: dedupe([byDue, byPayment, byCompetence ?? []]),
      competenceMissing: byCompetence === null,
    };
  };

  const current = useQuery({
    queryKey: ["report", ...scopeKey, +range.start, +range.end],
    queryFn: () => fetchPeriod(range.start, range.end),
    enabled: !!companyId && canViewReports,
    staleTime: 60_000,
  });
  const prior = useQuery({
    queryKey: [
      "report",
      ...scopeKey,
      +(compRange?.start ?? 0),
      +(compRange?.end ?? 0),
    ],
    queryFn: () => fetchPeriod(compRange!.start, compRange!.end),
    enabled: !!companyId && canViewReports && !!compRange,
    staleTime: 60_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["recurring-templates", companyId, "active"],
    queryFn: () => recurrenceService.getTemplates(companyId!, { active: true }),
    enabled: !!companyId && wantsRecurring,
    staleTime: 5 * 60_000,
  });
  const templates = useMemo(
    () =>
      (templatesQuery.data ?? []).filter(
        (t) => !createdBy || t.baseTransactionData.createdBy === createdBy,
      ),
    [templatesQuery.data, createdBy],
  );

  const openingQuery = useQuery({
    queryKey: [
      "report-opening",
      companyId,
      +range.start,
      stages.join(","),
      templates.length,
    ],
    queryFn: async () => {
      const { balance, hasCompanyStats } =
        await dashboardService.getCashBalance(companyId!);
      if (!hasCompanyStats) return null;
      const today = new Date();
      let movements: Transaction[];
      if (range.start <= today) {
        movements = await transactionService.getByPaymentDate({
          companyId: companyId!,
          startDate: range.start,
          endDate: today,
        });
      } else {
        const from = addDays(startOfDay(today), 1);
        const eve = subDays(range.start, 1);
        movements = [
          ...(await transactionService.getAll({
            companyId: companyId!,
            startDate: from,
            endDate: eve,
          })),
          ...(wantsRecurring ? projectRecurrences(templates, from, eve) : []),
        ];
      }
      return {
        value: openingFromToday(balance, range.start, today, movements, stages),
        todayBalance: balance,
      };
    },
    enabled:
      !!companyId &&
      hasOpening &&
      (!wantsRecurring || templatesQuery.isSuccess),
    staleTime: 60_000,
  });

  const openingTyped =
    openingOverride?.start === +range.start ? openingOverride.value : null;
  const opening = hasOpening
    ? (openingTyped ?? openingQuery.data?.value ?? 0)
    : 0;

  // ── Relatórios (os mesmos números vão para a tela e para os arquivos) ────
  const gran =
    granularity === "auto"
      ? defaultGranularity(range.start, range.end)
      : granularity;

  const flow = useMemo(() => {
    if (!isFlow || !current.data) return null;
    const projected = wantsRecurring
      ? projectRecurrences(templates, range.start, range.end)
      : [];
    return buildCashFlow([...current.data.transactions, ...projected], {
      start: range.start,
      end: range.end,
      opening,
      stages,
      costCenterIds: ccIds,
      granularity: gran,
    });
  }, [
    isFlow,
    current.data,
    templates,
    wantsRecurring,
    range,
    opening,
    stages,
    ccIds,
    gran,
  ]);

  const flowPrev = useMemo(() => {
    if (!isFlow || !compRange || !prior.data) return null;
    const projected = wantsRecurring
      ? projectRecurrences(templates, compRange.start, compRange.end)
      : [];
    return buildCashFlow([...prior.data.transactions, ...projected], {
      start: compRange.start,
      end: compRange.end,
      stages,
      costCenterIds: ccIds,
      granularity: gran,
    });
  }, [
    isFlow,
    prior.data,
    templates,
    wantsRecurring,
    compRange,
    stages,
    ccIds,
    gran,
  ]);

  const dre = useMemo(
    () =>
      kind === "dre" && current.data
        ? buildDre(current.data.transactions, accounts, {
            start: range.start,
            end: range.end,
            costCenterIds: ccIds,
            regime,
          })
        : null,
    [kind, current.data, accounts, range, ccIds, regime],
  );
  const drePrev = useMemo(
    () =>
      kind === "dre" && compRange && prior.data
        ? buildDre(prior.data.transactions, accounts, {
            start: compRange.start,
            end: compRange.end,
            costCenterIds: ccIds,
            regime,
          })
        : null,
    [kind, prior.data, accounts, compRange, ccIds, regime],
  );

  const dreLine = (t: Transaction): DrillLine => ({
    tx: t,
    date: effectiveDate(t),
    amount: dreAmount(t, ccIds),
    status: situationOf(t),
  });

  const isEmpty = isFlow
    ? !!flow && flow.lines.length === 0
    : !!dre && !dre.rows.some((r) => r.total !== 0);

  // ── Ações ────────────────────────────────────────────────────────────────
  const filtersText = [
    isFlow
      ? MODE_LABEL[mode] +
        (mode !== "realized" && forecast.length < FORECAST_STAGES.length
          ? ` (previsto: ${forecast.map((s) => STAGE_INFO[s].label.toLowerCase()).join(", ")})`
          : "")
      : regime === "cash"
        ? "Regime de caixa"
        : "Regime de competência",
    ccName ? `Centro de custo: ${ccName} e subordinados` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const handleExport = async (fmt: ExportFormat) => {
    if (!selectedCompany || !companyId) return;
    setExporting(fmt);
    try {
      const ctx = {
        start: range.start,
        end: range.end,
        companyName: selectedCompany.name,
        filters: filtersText,
        accounts,
        costCenters,
        costCenterIds: ccIds,
        entities: await entityService.getAll(companyId),
      };
      if (isFlow && flow) {
        if (fmt === "pdf") await reportService.generateCashFlowPDF(flow, ctx);
        if (fmt === "excel") await reportService.exportCashFlowExcel(flow, ctx);
        if (fmt === "csv") reportService.exportCashFlowCSV(flow, ctx);
      } else if (dre) {
        const dreCtx = {
          ...ctx,
          regime,
          competenceMissing: current.data?.competenceMissing,
        };
        if (fmt === "pdf") await reportService.generateDREPDF(dre, dreCtx);
        if (fmt === "excel") await reportService.exportDREExcel(dre, dreCtx);
        if (fmt === "csv") reportService.exportDRECSV(dre, dreCtx);
      }
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      setExporting(null);
    }
  };

  const pickPeriod = (key: string) => {
    const p = periods.find((x) => x.key === key)!;
    setRange({ start: p.start, end: p.end, key: p.key });
  };

  const toggleStage = (stage: FlowStage) =>
    setForecast((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : FORECAST_STAGES.filter((s) => prev.includes(s) || s === stage),
    );

  // DRE em que o resultado das contas não representa o período: o arquivo só
  // sai depois de a pessoa confirmar que viu isso.
  const lowCoverage = !isFlow && !!dre && dre.coverage < DRE_MIN_COVERAGE;
  const requestExport = (fmt: ExportFormat) =>
    lowCoverage ? setConfirmExport(fmt) : handleExport(fmt);

  const unclassified = dre?.rows.filter((r) => r.kind === "info") ?? [];
  const unclassifiedLines = unclassified.flatMap((r) => r.sources ?? []);
  const resultOf = (key: string) =>
    dre?.rows.find((r) => r.key === key)?.total ?? 0;

  const emptyHint =
    isFlow && mode === "realized"
      ? "Nada foi pago ou recebido no período. Para ver o que vem por aí, escolha Previsto em Situação."
      : ccIds
        ? "Retire o filtro de centro de custo ou escolha um período maior."
        : "Escolha um período maior.";

  if (!canViewReports) return null;

  const loading =
    current.isLoading || (wantsRecurring && templatesQuery.isLoading);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-3">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Relatórios
          </h1>
          <Tabs value={kind} onValueChange={(v) => setKind(v as ReportKind)}>
            <TabsList>
              <TabsTrigger value="cash_flow" className="px-3">
                Fluxo de caixa
              </TabsTrigger>
              <TabsTrigger value="dre" className="px-3">
                DRE gerencial
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {/* Não modal: o item pode abrir a confirmação, e dois modais Radix
            seguidos deixam a página sem cliques. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              loading={exporting !== null}
              disabled={
                exporting !== null || loading || isEmpty || !!current.error
              }
            >
              {exporting === null && <Download className="h-4 w-4" />}
              Exportar
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {EXPORTS[kind].map((e) => (
              <DropdownMenuItem
                key={e.format}
                onSelect={() => requestExport(e.format)}
              >
                <div>
                  <p>{e.label}</p>
                  <p className="text-xs text-muted-foreground">{e.hint}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* ── Filtros ───────────────────────────────────────────────────── */}
      <section
        aria-label="Filtros do relatório"
        className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Popover
            open={calendarOpen}
            onOpenChange={(o) => {
              setCalendarOpen(o);
              if (o) setDraftRange(undefined);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="font-financial font-normal"
              >
                <CalendarIcon className="h-4 w-4 opacity-60" />
                {periodText(range.start, range.end)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                numberOfMonths={2}
                defaultMonth={range.start}
                selected={draftRange ?? { from: range.start, to: range.end }}
                onSelect={setDraftRange}
                locale={ptBR}
              />
              <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
                <span className="font-financial">
                  {draftRange?.from
                    ? `${format(draftRange.from, "dd/MM/yyyy")} a ${
                        draftRange.to
                          ? format(draftRange.to, "dd/MM/yyyy")
                          : "…"
                      }`
                    : "Escolha o primeiro e o último dia"}
                </span>
                <Button
                  size="sm"
                  disabled={!draftRange?.from}
                  onClick={() => {
                    const from = draftRange!.from!;
                    const to = draftRange!.to ?? from;
                    setRange({ start: from, end: to, key: null });
                    setCalendarOpen(false);
                  }}
                >
                  Aplicar
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              label="Atalhos de período"
              hideLabel
              value={range.key ?? ""}
              onChange={pickPeriod}
              options={periods.map((p) => ({ value: p.key, label: p.label }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Centro de custo
            <Select
              value={costCenterFilter}
              onValueChange={setCostCenterFilter}
            >
              <SelectTrigger size="sm" className="min-w-44 text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {ccTree.map(({ cc, depth }) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    <span style={{ paddingLeft: `${depth * 0.75}rem` }}>
                      {cc.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {isFlow ? (
            <>
              <Segmented
                label="Situação"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "realized", label: "Realizado" },
                  { value: "forecast", label: "Previsto" },
                  { value: "both", label: MODE_LABEL.both },
                ]}
              />
              <Segmented
                label="Agrupar por"
                value={granularity === "auto" ? gran : granularity}
                onChange={setGranularity}
                options={[
                  { value: "day", label: "Dia" },
                  { value: "month", label: "Mês" },
                ]}
              />
            </>
          ) : (
            <>
              <Segmented
                label="Regime"
                value={regime}
                onChange={setRegime}
                options={[
                  { value: "competence", label: "Competência" },
                  { value: "cash", label: "Caixa" },
                ]}
              />
              <Segmented
                label="Colunas"
                value={monthly ? "monthly" : "total"}
                onChange={(v) => setMonthly(v === "monthly")}
                options={[
                  { value: "total", label: "Só o total" },
                  { value: "monthly", label: "Mês a mês" },
                ]}
              />
              <Segmented
                label="Linhas zeradas"
                value={hideZero ? "hide" : "show"}
                onChange={(v) => setHideZero(v === "hide")}
                options={[
                  { value: "hide", label: "Ocultar" },
                  { value: "show", label: "Mostrar" },
                ]}
              />
            </>
          )}

          <Segmented
            label="Comparar com"
            value={comparison}
            onChange={setComparison}
            options={[
              { value: "none", label: "Sem comparação" },
              { value: "previous", label: "Período anterior" },
              { value: "year", label: "Mesmo período do ano anterior" },
            ]}
          />
        </div>

        {isFlow && mode !== "realized" && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="mr-1 text-xs text-muted-foreground">
              Previsto inclui
            </span>
            {FORECAST_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={forecast.includes(s)}
                onClick={() => toggleStage(s)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  forecast.includes(s)
                    ? "border-foreground/30 bg-foreground/6 text-foreground"
                    : "border-dashed text-muted-foreground hover:text-foreground",
                )}
              >
                {STAGE_INFO[s].label}
                <span className="ml-1.5 text-muted-foreground">
                  {STAGE_INFO[s].hint.toLowerCase()}
                </span>
              </button>
            ))}
          </div>
        )}

        {hasOpening && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>Saldo inicial em {format(range.start, "dd/MM/yyyy")}</span>
            <div className="w-40">
              <CurrencyInput
                value={opening}
                onChange={(value) =>
                  setOpeningOverride({ start: +range.start, value })
                }
                className="h-8 font-financial text-sm text-foreground"
                aria-label="Saldo inicial"
              />
            </div>
            {openingTyped !== null ? (
              <button
                type="button"
                onClick={() => setOpeningOverride(null)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Usar o calculado
              </button>
            ) : openingQuery.isLoading ? (
              <span>calculando…</span>
            ) : openingQuery.data ? (
              <span>
                Calculado do saldo de hoje (
                {formatCurrency(openingQuery.data.todayBalance)}) até o início
                do período. Pode ajustar.
              </span>
            ) : (
              <span>Sem saldo de referência: digite o saldo das contas.</span>
            )}
          </div>
        )}
      </section>

      {/* ── Relatório ─────────────────────────────────────────────────── */}
      {current.error ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
          <AlertCircle className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm">Não foi possível carregar os lançamentos.</p>
          <Button size="sm" variant="outline" onClick={() => current.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : loading || (!flow && !dre) ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-sm">
            Nenhum lançamento no período com esses filtros.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      ) : isFlow && flow ? (
        <CashFlowView
          report={flow}
          previous={flowPrev}
          showStages={mode !== "realized"}
          hasOpening={hasOpening}
          granularity={gran}
          onDrill={setDrill}
        />
      ) : dre ? (
        <div className="space-y-3">
          {current.data?.competenceMissing && (
            <div
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <p className="font-medium">Esta DRE pode estar incompleta.</p>
              <p className="mt-1 text-amber-900 dark:text-amber-200">
                Lançamentos com competência neste período, mas vencimento ou
                pagamento em outro mês, ficaram de fora: a busca por competência
                ainda não foi liberada no banco de dados. Peça ao administrador
                do sistema para publicar os índices do Firestore.
              </p>
            </div>
          )}
          {lowCoverage && (
            <div
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <p className="font-medium">
                Só {formatPercent(dre.coverage)} do movimento do período tem
                conta contábil.
              </p>
              <p className="mt-1 text-amber-900 dark:text-amber-200">
                O resultado das contas classificadas é{" "}
                <span className="font-financial font-medium">
                  {formatCurrency(resultOf("Resultado Líquido do Período"))}
                </span>
                ; com os {unclassifiedLines.length} lançamentos sem conta, o
                período fecha em{" "}
                <span className="font-financial font-medium">
                  {formatCurrency(
                    resultOf("Resultado com Lançamentos sem Conta"),
                  )}
                </span>
                . Classifique-os para a DRE valer como demonstrativo.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                <button
                  type="button"
                  onClick={() =>
                    setDrill({
                      title: "Lançamentos sem conta contábil",
                      subtitle: `${periodText(range.start, range.end)} · abra um lançamento para escolher a conta`,
                      lines: unclassifiedLines.map(dreLine),
                    })
                  }
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Ver os {unclassifiedLines.length} lançamentos
                </button>
                <Link
                  href={`/busca?q=${encodeURIComponent("sem:conta")}`}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Todos os sem conta na busca
                </Link>
              </div>
            </div>
          )}
          <DreView
            dre={dre}
            previous={drePrev}
            monthly={monthly}
            hideZero={hideZero}
            lineFor={dreLine}
            onDrill={setDrill}
          />
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              {regime === "cash"
                ? "Regime de caixa: só o que foi pago ou recebido, no mês da baixa."
                : "Regime de competência: o mês de competência do lançamento; sem competência, a data de pagamento ou de vencimento."}{" "}
              Rejeitadas não entram.{" "}
              {dre.base > 0
                ? "AV % sobre a receita líquida."
                : "AV % indisponível: não há receita líquida classificada no período."}
            </li>
            {accounts.length === 0 && (
              <li>
                Sem plano de contas, tudo aparece como &ldquo;sem conta
                contábil&rdquo;.{" "}
                <Link
                  href="/cadastros/plano-de-contas"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Cadastrar o plano
                </Link>
              </li>
            )}
          </ul>
        </div>
      ) : null}

      <DrillSheet drill={drill} onClose={() => setDrill(null)} />
      <ConfirmDialog
        open={confirmExport !== null}
        onOpenChange={(o) => !o && setConfirmExport(null)}
        title="Exportar uma DRE com pouca classificação?"
        description={`Só ${dre ? formatPercent(dre.coverage) : ""} do movimento do período tem conta contábil, então o resultado das contas classificadas não representa o período. O arquivo sai com esse aviso no topo.`}
        confirmText="Exportar com o aviso"
        onConfirm={() => {
          const fmt = confirmExport;
          setConfirmExport(null);
          if (fmt) void handleExport(fmt);
        }}
      />
    </div>
  );
}
