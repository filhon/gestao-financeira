"use client";

import { useMemo, useState } from "react";
import currency from "currency.js";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "./Segmented";
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
  dashboardService,
  ProjectedCashFlowData,
} from "@/lib/services/dashboardService";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  AlertTriangle,
  FlaskConical,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import {
  DASHBOARD_QUERY_KEYS,
  useProjectedCashFlow,
} from "@/hooks/useDashboardData";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { format, parseISO } from "date-fns";
import {
  annotateWithSimulations,
  negativeRuns,
  niceTicks,
  type SimulatedEntry,
} from "@/lib/dashboardRules";

// No eixo, marcas redondas dispensam o ",0": "R$ 300 mil", "R$ 1,2 mi".
const axisFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const axisMoney = (v: number) => axisFormat.format(v);

const REAL = "var(--chart-cash)";
const SIMULATED = "var(--chart-sim)";
const NEGATIVE = "var(--destructive)";

type ChartPoint = ProjectedCashFlowData & { simulatedBalance?: number };

function lowestPoint<T extends { balance: number }>(points: T[]) {
  return points.reduce<T | undefined>(
    (min, p) => (!min || p.balance < min.balance ? p : min),
    undefined,
  );
}

export function CashFlowChart({ year }: { year?: number }) {
  const [chosenMode, setMode] = useState<"30days" | "year">("30days");
  // Exercício futuro ainda não tem saldo de partida: a projeção do ano
  // começaria de hoje e pularia os meses até lá. Só os 30 dias valem.
  const futureYear =
    (year ?? new Date().getFullYear()) > new Date().getFullYear();
  const mode = futureYear ? "30days" : chosenMode;
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useProjectedCashFlow(mode, year);
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();
  const queryClient = useQueryClient();
  const [recalculating, setRecalculating] = useState(false);

  const [simulatedTransactions, setSimulatedTransactions] = useState<
    SimulatedEntry[]
  >([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [formAmount, setFormAmount] = useState<number | undefined>();
  const [formType, setFormType] = useState<"receivable" | "payable">("payable");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [formDate, setFormDate] = useState(todayStr);

  const hasCompanyStats = result?.hasCompanyStats ?? true;

  const data = useMemo(
    () => annotateWithSimulations(result?.data ?? [], simulatedTransactions),
    [result?.data, simulatedTransactions],
  );

  const isSimulating = simulatedTransactions.length > 0;
  const first = data[0];
  const last = data.at(-1);
  const lowest = lowestPoint(data);
  const minBalance =
    data.length > 0
      ? Math.min(
          ...data.map((d) =>
            Math.min(d.balance, d.simulatedBalance ?? d.balance),
          ),
        )
      : 0;
  const hasNegative = minBalance < 0;
  const overdueIncome = result?.overdueIncome ?? 0;
  const [showOverdue, setShowOverdue] = useState(false);
  const runs = negativeRuns(data);

  // Escala pela série conservadora (e pela simulação). O cenário otimista só
  // entra na escala quando ligado: senão o pico dele achata o trecho negativo.
  const scaleValues = data.flatMap((d) => [
    d.balance,
    ...(d.simulatedBalance !== undefined ? [d.simulatedBalance] : []),
    ...(showOverdue && d.balanceWithOverdue !== undefined
      ? [d.balanceWithOverdue]
      : []),
  ]);
  const ticks = niceTicks(
    Math.min(0, ...scaleValues),
    Math.max(0, ...scaleValues),
  );

  // Onde o gradiente troca de cor: no zero, relativo ao alcance do saldo.
  const balances = data.map((d) => d.balance);
  const bMax = Math.max(...balances, 0);
  const bMin = Math.min(...balances, 0);
  const zeroOffset = bMax === bMin ? 1 : bMax / (bMax - bMin);
  const rangeMax = last
    ? mode === "year"
      ? `${last.isoDate.slice(0, 4)}-12-31`
      : last.isoDate
    : undefined;

  function addSimulation() {
    if (!formAmount || formAmount <= 0 || !formDate) return;
    setSimulatedTransactions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        amount: currency(formAmount).value,
        type: formType,
        date: formDate,
      },
    ]);
    setFormAmount(undefined);
    setFormDate(todayStr);
    setPopoverOpen(false);
  }

  async function recalculate() {
    if (!selectedCompany) return;
    setRecalculating(true);
    try {
      const r = await dashboardService.recalculateBalance(selectedCompany.id);
      toast.success(
        `Saldo recalculado: ${formatCurrency(r.newBalance)} (${r.transactionCount} baixas).`,
      );
      DASHBOARD_QUERY_KEYS.forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      );
    } catch {
      toast.error("Não foi possível recalcular o saldo.");
    } finally {
      setRecalculating(false);
    }
  }

  return (
    <Card id="fluxo-caixa" className="col-span-full scroll-mt-20 md:col-span-4">
      <CardHeader className="flex flex-col gap-2 pb-2 md:flex-row md:items-center md:justify-between md:gap-0 md:space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-sm md:text-base font-medium"
          >
            Fluxo de caixa projetado
          </CardTitle>
          {isSimulating && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-950/50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-400">
              <FlaskConical className="h-3 w-3" />
              Simulação
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                Simular lançamento
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <p className="text-sm font-semibold">E se…</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Veja o efeito de uma entrada ou saída no saldo. Nada é gravado.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="sim-amount" className="text-xs">
                    Valor
                  </Label>
                  <CurrencyInput
                    id="sim-amount"
                    inputMode="numeric"
                    value={formAmount}
                    onChange={setFormAmount}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sim-type" className="text-xs">
                    Tipo
                  </Label>
                  <Select
                    value={formType}
                    onValueChange={(v) =>
                      setFormType(v as "receivable" | "payable")
                    }
                  >
                    <SelectTrigger id="sim-type" className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receivable">↑ Entrada</SelectItem>
                      <SelectItem value="payable">↓ Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sim-date" className="text-xs">
                    Data
                  </Label>
                  <Input
                    id="sim-date"
                    type="date"
                    min={first?.isoDate}
                    max={rangeMax}
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <Button
                  className="h-8 w-full text-xs"
                  onClick={addSimulation}
                  disabled={!formAmount || !formDate}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Adicionar
                </Button>
              </div>

              {simulatedTransactions.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Simulações ativas
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => setSimulatedTransactions([])}
                    >
                      Limpar todas
                    </Button>
                  </div>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                    {simulatedTransactions.map((sim) => (
                      <li
                        key={sim.id}
                        className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs"
                      >
                        <span className="font-medium font-financial">
                          {sim.type === "receivable" ? "+" : "-"}
                          {formatCurrency(sim.amount)}
                        </span>
                        <span className="mx-2 text-muted-foreground">
                          {format(parseISO(sim.date), "dd/MM")}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          aria-label="Remover simulação"
                          onClick={() =>
                            setSimulatedTransactions((prev) =>
                              prev.filter((s) => s.id !== sim.id),
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {isSimulating && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Limpar simulações"
              title="Limpar simulações"
              onClick={() => setSimulatedTransactions([])}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}

          <Segmented
            label="Período da projeção"
            value={mode}
            onChange={setMode}
            options={[
              { value: "30days", label: "30 dias" },
              ...(futureYear
                ? []
                : [
                    {
                      value: "year" as const,
                      label: `Exercício ${year ?? new Date().getFullYear()}`,
                    },
                  ]),
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="pl-2">
        {!hasCompanyStats && !isLoading && (
          <div className="mb-2 ml-4 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              O saldo de partida ainda não foi calculado e está em R$ 0,00.
            </span>
            {(isAdmin || isFinancialManager) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={recalculate}
                disabled={recalculating}
              >
                <RefreshCcw
                  className={cn(
                    "mr-1 h-3 w-3",
                    recalculating && "animate-spin",
                  )}
                />
                Recalcular saldo
              </Button>
            )}
          </div>
        )}
        {isSimulating && !isLoading && (
          <div className="mb-2 ml-4 flex items-center gap-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
            <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            <span>
              Linha tracejada: projeção com {simulatedTransactions.length}{" "}
              {simulatedTransactions.length === 1
                ? "lançamento simulado"
                : "lançamentos simulados"}
              . Os dados reais não mudam.
            </span>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="ml-4 h-[220px] md:h-[370px]" />
        ) : isError ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3 md:h-[370px]">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar a projeção.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => refetch()}
            >
              <RefreshCcw className="mr-1.5 h-3 w-3" />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            {first && last && lowest && (
              <dl className="mb-3 ml-4 flex min-h-4 flex-wrap gap-x-6 gap-y-1 text-xs">
                {/* No modo 30 dias, hoje, o menor e o fim já estão nos KPIs
                    e no alerta logo acima; aqui só no exercício. */}
                {mode === "year" && (
                  <>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Em {first.date}</dt>
                      <dd className="font-medium font-financial">
                        {formatCurrency(first.balance)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">
                        Menor saldo, {lowest.date}
                      </dt>
                      <dd
                        className={cn(
                          "font-medium font-financial",
                          lowest.balance < 0 && "text-destructive",
                        )}
                      >
                        {formatCurrency(lowest.balance)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Em {last.date}</dt>
                      <dd
                        className={cn(
                          "font-medium font-financial",
                          last.balance < 0 && "text-destructive",
                        )}
                      >
                        {formatCurrency(last.balance)}
                      </dd>
                    </div>
                  </>
                )}
                {overdueIncome > 0 && (
                  <div className="flex items-center gap-1.5">
                    <dt>
                      {/* A legenda liga e desliga o cenário otimista. */}
                      <button
                        type="button"
                        aria-pressed={showOverdue}
                        onClick={() => setShowOverdue((v) => !v)}
                        className="flex items-center gap-1.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            "inline-block w-4 border-t-2 border-dashed",
                            showOverdue
                              ? "border-foreground"
                              : "border-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                        {showOverdue ? "Ocultar" : "Mostrar"} cenário com{" "}
                        {formatCurrencyAbbr(overdueIncome)} em atraso recebidos
                      </button>
                    </dt>
                  </div>
                )}
              </dl>
            )}
            {/* figure, não role="img": img tornaria o conteúdo apresentacional
                e esconderia a camada de teclado do Recharts (setas percorrem os
                dias e o tooltip é lido). */}
            <figure
              className="h-[200px] md:h-[330px]"
              aria-label={
                lowest
                  ? `Saldo projetado. ${
                      runs.length === 0
                        ? "Não fica negativo."
                        : `Negativo ${runs.map((r) => (r.start === r.end ? `em ${r.start.date}` : `de ${r.start.date} a ${r.end.date}`)).join(" e ")}.`
                    } Menor saldo ${formatCurrency(lowest.balance)} em ${lowest.date}.`
                  : "Saldo projetado"
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data}
                  margin={{ top: 16, right: 16, left: 4, bottom: 0 }}
                  accessibilityLayer
                >
                  <defs>
                    {/* Acima de zero azul, abaixo vermelho. */}
                    <linearGradient
                      id="cfSplitStroke"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset={zeroOffset} stopColor={REAL} />
                      <stop offset={zeroOffset} stopColor={NEGATIVE} />
                    </linearGradient>
                    <linearGradient
                      id="cfSplitFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset={zeroOffset}
                        stopColor={REAL}
                        stopOpacity={0.08}
                      />
                      <stop
                        offset={zeroOffset}
                        stopColor={NEGATIVE}
                        stopOpacity={0.18}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    domain={[ticks[0], ticks[ticks.length - 1]]}
                    ticks={ticks}
                    interval={0}
                    tickFormatter={axisMoney}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as ChartPoint;
                      return (
                        <div className="min-w-44 rounded-lg border bg-popover p-3 shadow-md">
                          <p className="mb-2 text-sm font-medium text-popover-foreground">
                            {mode === "year" ? `Semana de ${label}` : label}
                          </p>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground">
                              Saldo
                            </span>
                            <span
                              className={cn(
                                "text-xs font-medium font-financial",
                                point.balance < 0 && "text-destructive",
                              )}
                            >
                              {formatCurrency(point.balance)}
                            </span>
                          </div>
                          {showOverdue &&
                            point.balanceWithOverdue !== undefined && (
                              <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">
                                  Se os atrasados entrarem
                                </span>
                                <span className="text-xs font-medium font-financial">
                                  {formatCurrency(point.balanceWithOverdue)}
                                </span>
                              </div>
                            )}
                          {isSimulating &&
                            point.simulatedBalance !== undefined && (
                              <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">
                                  Simulado
                                </span>
                                <span
                                  className={cn(
                                    "text-xs font-medium font-financial",
                                    point.simulatedBalance < 0 &&
                                      "text-destructive",
                                  )}
                                >
                                  {formatCurrency(point.simulatedBalance)}
                                </span>
                              </div>
                            )}
                          {(point.income > 0 || point.expense > 0) && (
                            <div className="mt-2 space-y-0.5 border-t pt-2 text-xs font-financial">
                              {point.income > 0 && (
                                <p>+ {formatCurrency(point.income)} entradas</p>
                              )}
                              {point.expense > 0 && (
                                <p>- {formatCurrency(point.expense)} saídas</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={
                      hasNegative ? "var(--destructive)" : "var(--border)"
                    }
                    strokeWidth={hasNegative ? 1.5 : 1}
                  />
                  {/* Saldo muda no dia do vencimento: degrau, não curva. */}
                  <Area
                    type="stepAfter"
                    dataKey="balance"
                    name="Saldo"
                    // Gradiente só quando cruza o zero: numa linha reta a
                    // caixa do traço tem altura zero e o SVG o descartaria.
                    stroke={hasNegative ? "url(#cfSplitStroke)" : REAL}
                    strokeWidth={2}
                    fill="url(#cfSplitFill)"
                    dot={false}
                    activeDot={(props: {
                      cx?: number;
                      cy?: number;
                      payload?: ChartPoint;
                    }) => (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
                        fill={
                          (props.payload?.balance ?? 0) < 0 ? NEGATIVE : REAL
                        }
                        stroke="var(--background)"
                        strokeWidth={2}
                      />
                    )}
                    isAnimationActive={false}
                  />
                  {showOverdue && overdueIncome > 0 && (
                    <Area
                      type="stepAfter"
                      dataKey="balanceWithOverdue"
                      name="Se os atrasados entrarem"
                      stroke="var(--muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      fill="none"
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {isSimulating && (
                    <Area
                      type="stepAfter"
                      dataKey="simulatedBalance"
                      name="Simulado"
                      stroke={SIMULATED}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      fill="none"
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: SIMULATED,
                        stroke: "var(--background)",
                        strokeWidth: 2,
                      }}
                      isAnimationActive={false}
                    />
                  )}
                  {lowest && (
                    <ReferenceDot
                      x={lowest.date}
                      y={lowest.balance}
                      r={4}
                      fill={
                        lowest.balance < 0
                          ? "var(--destructive)"
                          : "var(--muted-foreground)"
                      }
                      stroke="var(--background)"
                      strokeWidth={2}
                      label={{
                        value: "Menor saldo",
                        position: "bottom",
                        fontSize: 11,
                        fill: "var(--muted-foreground)",
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </figure>
          </>
        )}
      </CardContent>
    </Card>
  );
}
