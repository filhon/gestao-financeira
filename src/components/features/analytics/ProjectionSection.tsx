"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { eachMonthOfInterval, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, FlaskConical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/features/dashboard/Segmented";
import {
  horizonEnd,
  PROJECTION_HORIZONS,
  projectBalance,
  type AnalyticsReport,
  type ForecastStage,
  type Side,
  type Simulation,
} from "@/lib/analytics";
import { niceTicks } from "@/lib/dashboardRules";
import { DEFAULT_FORECAST, FORECAST_STAGES, STAGE_INFO } from "@/lib/reports";
import { cn } from "@/lib/utils";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  money,
  Section,
  StatTile,
  TooltipBox,
  VIZ,
} from "./primitives";

const BALANCE = "var(--chart-cash)";
const SIMULATED = "var(--chart-sim)";
const NEGATIVE = "var(--destructive)";

type Horizon = (typeof PROJECTION_HORIZONS)[number];
type SimKind = Simulation["kind"];

const toDate = (key: string) => new Date(`${key}T12:00:00`);
const dayText = (key: string) => format(toDate(key), "dd/MM/yyyy");
const monthText = (key: string) =>
  format(toDate(key), "MMM/yy", { locale: ptBR });
const percentText = (p: number) =>
  `${p > 0 ? "+" : "−"}${Math.abs(p * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function describe(s: Simulation) {
  if (s.kind === "percent")
    return `${s.side === "receivable" ? "Receitas" : "Despesas"} previstas ${percentText(s.percent)}`;
  const what = `${s.type === "receivable" ? "Entrada" : "Saída"} de ${money(s.amount)}`;
  return s.kind === "once"
    ? `${what} em ${dayText(s.date)}`
    : `${what} por mês, ${s.months} ${s.months === 1 ? "mês" : "meses"} desde ${dayText(s.date)}`;
}

/** Vencido e não baixado: fora da projeção, mostrado à parte. */
const overdueOf = (report: AnalyticsReport, side: Side) =>
  report.aging[side]
    .filter((b) => b.key !== "due")
    .reduce((s, b) => s + b.value, 0);

export interface CashToday {
  balance: number | null;
  isLoading: boolean;
  isError: boolean;
}

export function ProjectionSection({
  report,
  cash,
}: {
  report: AnalyticsReport;
  /** Caixa disponível hoje (contas correntes e aplicação automática). */
  cash: CashToday;
}) {
  const [months, setMonths] = useState<Horizon>(12);
  const [stages, setStages] = useState<ForecastStage[]>(
    DEFAULT_FORECAST as ForecastStage[],
  );
  const [simulations, setSimulations] = useState<Simulation[]>([]);

  const from = report.today;
  const until = horizonEnd(from, months);
  const opening = cash.balance;

  const projection = useMemo(
    () =>
      opening === null
        ? null
        : projectBalance({
            days: report.projection,
            opening,
            stages,
            from,
            until,
            simulations,
          }),
    [report.projection, opening, stages, from, until, simulations],
  );

  const toggleStage = (s: ForecastStage) =>
    setStages((prev) =>
      prev.includes(s)
        ? prev.filter((x) => x !== s)
        : (FORECAST_STAGES as ForecastStage[]).filter(
            (x) => prev.includes(x) || x === s,
          ),
    );

  const overdueIn = overdueOf(report, "receivable");
  const overdueOut = overdueOf(report, "payable");
  const overdueNote =
    overdueIn || overdueOut
      ? ` Vencidos sem baixa ficam fora: ${money(overdueIn)} a receber e ${money(overdueOut)} a pagar.`
      : "";

  const horizonSwitch = (
    <Segmented
      label="Horizonte da projeção"
      value={String(months)}
      onChange={(v) => setMonths(Number(v) as Horizon)}
      options={PROJECTION_HORIZONS.map((m) => ({
        value: String(m),
        label: `${m} meses`,
      }))}
    />
  );

  if (cash.isLoading) {
    return (
      <Section
        id="projecao"
        kicker="Projeção e simulação"
        title="Projeção do caixa"
        actions={horizonSwitch}
      >
        <Skeleton className="h-[340px] w-full" />
      </Section>
    );
  }

  if (!projection) {
    return (
      <Section
        id="projecao"
        kicker="Projeção e simulação"
        title="Projeção do caixa"
      >
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {cash.isError
            ? "Não foi possível ler o caixa de hoje. Use Atualizar para tentar de novo."
            : "A projeção parte do caixa disponível de hoje. Cadastre as contas correntes em Cadastros, Contas Bancárias."}
        </p>
      </Section>
    );
  }

  const { runs, lowest, closing, simulated } = projection;
  const first = runs[0];
  const whenText = (key: string) => (key === from ? "hoje" : dayText(key));
  const title =
    runs.length === 0
      ? `Caixa chega a ${monthText(until)} em ${money(closing)}, sem ficar negativo`
      : runs.length > 1
        ? `Caixa fica negativo em ${runs.length} trechos, o primeiro a partir de ${whenText(first.start.isoDate)}`
        : first.open
          ? `Caixa fica negativo a partir de ${whenText(first.start.isoDate)} e não se recupera até ${monthText(until)}`
          : `Caixa fica negativo entre ${whenText(first.start.isoDate)} e ${dayText(first.end.isoDate)}`;

  return (
    <Section
      id="projecao"
      kicker="Projeção e simulação"
      title={title}
      description={`A partir do caixa disponível de hoje, com o que já está lançado${stages.includes("recurring") ? " e as recorrências ainda não lançadas" : ""}.${overdueNote}`}
      actions={horizonSwitch}
    >
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <StatTile
          label="Caixa hoje"
          value={fullMoney(projection.opening)}
          tone={projection.opening < 0 ? "danger" : undefined}
          detail="Contas correntes e aplicação automática"
        />
        <StatTile
          label="Menor saldo"
          value={fullMoney(lowest.balance)}
          tone={lowest.balance < 0 ? "danger" : undefined}
          detail={
            simulated
              ? `Em ${dayText(lowest.isoDate)}. Com a simulação: ${fullMoney(simulated.lowest)}`
              : `Em ${dayText(lowest.isoDate)}, ao fim do dia`
          }
        />
        <StatTile
          label={`Em ${dayText(until)}`}
          value={fullMoney(closing)}
          tone={closing < 0 ? "danger" : undefined}
          detail={
            simulated
              ? `Com a simulação: ${fullMoney(simulated.closing)}`
              : `${closing >= projection.opening ? "+" : "−"}${money(Math.abs(closing - projection.opening))} sobre hoje`
          }
        />
      </div>

      <ProjectionChart
        projection={projection}
        months={months}
        className="mt-6"
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <StageList
          byStage={projection.byStage}
          stages={stages}
          onToggle={toggleStage}
        />
        <SimulationPanel
          from={from}
          until={until}
          simulations={simulations}
          onAdd={(s) => setSimulations((prev) => [...prev, s])}
          onRemove={(id) =>
            setSimulations((prev) => prev.filter((s) => s.id !== id))
          }
          onClear={() => setSimulations([])}
        />
      </div>
    </Section>
  );
}

// ─── Gráfico ──────────────────────────────────────────────────────────────────

function ProjectionChart({
  projection,
  months,
  className,
}: {
  projection: NonNullable<ReturnType<typeof projectBalance>>;
  months: Horizon;
  className?: string;
}) {
  const { points, runs, lowest, simulated, from, until } = projection;
  const data = points.map((p) => ({ ...p, t: toDate(p.isoDate).getTime() }));
  const start = data[0].t;
  const end = data.at(-1)!.t;
  const values = data.flatMap((p) => [
    p.balance,
    ...(p.simulatedBalance !== undefined ? [p.simulatedBalance] : []),
  ]);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const step = months <= 6 ? 1 : months === 12 ? 2 : 3;
  const monthTicks = eachMonthOfInterval({
    start: toDate(from),
    end: toDate(until),
  })
    .filter((_, i) => i % step === 0)
    .map((d) => Math.max(start, d.getTime()));

  // O traço troca de cor no zero (só quando cruza: numa linha reta a caixa
  // do gradiente tem altura zero e o SVG o descartaria).
  const balances = data.map((p) => p.balance);
  const bMax = Math.max(...balances);
  const bMin = Math.min(...balances);
  const crosses = bMin < 0 && bMax > 0;
  const zeroOffset = crosses ? bMax / (bMax - bMin) : 0;
  const lineColor = crosses
    ? "url(#projSplit)"
    : bMax <= 0 && bMin < 0
      ? NEGATIVE
      : BALANCE;

  // Trecho negativo vai do primeiro dia até a véspera do dia que sai dele.
  const bands = runs.map((r) => {
    const i = data.findIndex((p) => p.isoDate === r.end.isoDate);
    return {
      key: r.start.isoDate,
      x1: data.find((p) => p.isoDate === r.start.isoDate)!.t,
      x2: data[i + 1]?.t ?? end,
    };
  });

  const textOf = (rs: typeof runs) =>
    rs
      .map((r) =>
        r.start === r.end
          ? `em ${dayText(r.start.isoDate)}`
          : `de ${dayText(r.start.isoDate)} a ${dayText(r.end.isoDate)}${r.open ? " (segue negativo)" : ""}`,
      )
      .join(", ");
  const runsText = textOf(runs);
  const lowestT = data.find((p) => p.isoDate === lowest.isoDate)!.t;

  const label = `Saldo projetado de ${dayText(from)} a ${dayText(until)}. ${
    runs.length === 0 ? "Não fica negativo." : `Negativo ${runsText}.`
  } Menor saldo ${fullMoney(lowest.balance)} em ${dayText(lowest.isoDate)}.${
    simulated
      ? ` Com a simulação, termina em ${fullMoney(simulated.closing)}.`
      : ""
  }`;

  return (
    <ChartFrame
      className={className}
      title="Saldo ao fim de cada dia"
      label={label}
      height={320}
      legend={
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3.5 rounded-full"
              style={{ background: BALANCE }}
            />
            Saldo previsto
          </li>
          {runs.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[3px] bg-destructive/15"
              />
              Negativo
            </li>
          )}
          {simulated && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="w-3.5 border-t-2 border-dashed"
                style={{ borderColor: SIMULATED }}
              />
              Com a simulação
            </li>
          )}
        </ul>
      }
      table={{
        columns: [
          "Dia",
          "Entradas",
          "Saídas",
          "Saldo",
          ...(simulated ? ["Com a simulação"] : []),
        ],
        rows: points.map((p) => [
          dayText(p.isoDate),
          fullMoney(p.inflow),
          fullMoney(p.outflow),
          fullMoney(p.balance),
          ...(simulated ? [fullMoney(p.simulatedBalance ?? p.balance)] : []),
        ]),
      }}
      note={
        runs.length || simulated ? (
          <>
            {runs.length > 0 && (
              <span className="text-destructive">
                Saldo negativo {runsText}.{" "}
              </span>
            )}
            {simulated &&
              `Com a simulação, ${simulated.runs.length ? `fica negativo ${textOf(simulated.runs)}` : "não fica negativo"}. A linha tracejada é só uma simulação: nada foi gravado.`}
          </>
        ) : undefined
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
        >
          <defs>
            <linearGradient id="projSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={zeroOffset} stopColor={BALANCE} />
              <stop offset={zeroOffset} stopColor={NEGATIVE} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          {bands.map((b) => (
            <ReferenceArea
              key={b.key}
              x1={b.x1}
              x2={b.x2}
              fill={NEGATIVE}
              fillOpacity={0.08}
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            {...AXIS_PROPS}
            dataKey="t"
            type="number"
            scale="time"
            domain={[start, end]}
            ticks={monthTicks}
            tickFormatter={(t: number) => format(t, "MMM/yy", { locale: ptBR })}
          />
          <YAxis
            {...AXIS_PROPS}
            width={76}
            domain={[ticks[0], ticks.at(-1)!]}
            ticks={ticks}
            interval={0}
            tickFormatter={axisMoney}
          />
          <ReferenceLine
            y={0}
            stroke={runs.length ? NEGATIVE : VIZ.axis}
            strokeOpacity={runs.length ? 0.6 : 0.4}
          />
          <Tooltip
            cursor={{ stroke: VIZ.axis, strokeOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={dayText(p.isoDate)}
                  rows={[
                    { label: "Saldo", value: fullMoney(p.balance) },
                    ...(p.simulatedBalance !== undefined
                      ? [
                          {
                            label: "Com a simulação",
                            value: fullMoney(p.simulatedBalance),
                          },
                        ]
                      : []),
                  ]}
                  footer={
                    p.inflow || p.outflow ? (
                      <span className="font-financial">
                        {p.inflow ? `+${fullMoney(p.inflow)} entradas` : ""}
                        {p.inflow && p.outflow ? " · " : ""}
                        {p.outflow ? `−${fullMoney(p.outflow)} saídas` : ""}
                      </span>
                    ) : undefined
                  }
                />
              );
            }}
          />
          {/* O saldo muda no dia do vencimento: degrau, não curva. */}
          <Line
            type="stepAfter"
            dataKey="balance"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {simulated && (
            <Line
              type="stepAfter"
              dataKey="simulatedBalance"
              stroke={SIMULATED}
              strokeWidth={2}
              strokeDasharray="6 4"
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
          <ReferenceDot
            x={lowestT}
            y={lowest.balance}
            r={4}
            fill={lowest.balance < 0 ? NEGATIVE : VIZ.axis}
            stroke="var(--background)"
            strokeWidth={2}
            label={{
              value: `Menor saldo ${money(lowest.balance)}`,
              position: lowest.balance < 0 ? "bottom" : "top",
              fontSize: 11,
              fill: "var(--muted-foreground)",
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ─── Estágios ─────────────────────────────────────────────────────────────────

function StageList({
  byStage,
  stages,
  onToggle,
}: {
  byStage: { stage: ForecastStage; inflow: number; outflow: number }[];
  stages: ForecastStage[];
  onToggle: (s: ForecastStage) => void;
}) {
  const cols =
    "grid grid-cols-[auto_minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-3 px-2";
  return (
    <div>
      <p className="mb-1 px-2 text-sm font-medium">O que entra na linha</p>
      <div
        aria-hidden
        className={cn(cols, "pb-1 text-xs text-muted-foreground")}
      >
        <span className="w-4" />
        <span>Estágio, no horizonte</span>
        <span className="text-right">Entradas</span>
        <span className="text-right">Saídas</span>
      </div>
      <ul
        className="divide-y border-t"
        role="group"
        aria-label="Estágios da projeção"
      >
        {byStage.map(({ stage, inflow, outflow }) => {
          const on = stages.includes(stage);
          return (
            <li key={stage}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${STAGE_INFO[stage].label}: entradas ${money(inflow)}, saídas ${money(outflow)}`}
                onClick={() => onToggle(stage)}
                className={cn(
                  cols,
                  "w-full rounded-md py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-sm border",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-muted-foreground/50",
                  )}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      !on && "text-muted-foreground",
                    )}
                  >
                    {STAGE_INFO[stage].label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {STAGE_INFO[stage].hint}
                  </span>
                </span>
                {[inflow, outflow].map((v, i) => (
                  <span
                    key={i}
                    className={cn(
                      "text-right font-financial text-sm",
                      (!on || !v) && "text-muted-foreground",
                    )}
                  >
                    {v ? money(v) : "—"}
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Simulação ────────────────────────────────────────────────────────────────

function SimulationPanel({
  from,
  until,
  simulations,
  onAdd,
  onRemove,
  onClear,
}: {
  from: string;
  until: string;
  simulations: Simulation[];
  onAdd: (s: Simulation) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [kind, setKind] = useState<SimKind>("once");
  const [type, setType] = useState<Side>("payable");
  const [amount, setAmount] = useState<number | undefined>();
  const [date, setDate] = useState(from);
  const [count, setCount] = useState("6");
  const [percent, setPercent] = useState("-10");

  const months = Number(count);
  const pctValue = Number(percent.replace(",", ".").replace("−", "-")) / 100;
  const dateOk = date >= from && date <= until;
  const valid =
    kind === "percent"
      ? Number.isFinite(pctValue) && pctValue !== 0 && pctValue >= -1
      : !!amount &&
        amount > 0 &&
        dateOk &&
        (kind === "once" ||
          (Number.isInteger(months) && months >= 1 && months <= 120));

  function add() {
    if (!valid) return;
    const id = crypto.randomUUID();
    onAdd(
      kind === "percent"
        ? { id, kind, side: type, percent: pctValue }
        : kind === "once"
          ? { id, kind, type, amount: amount!, date }
          : { id, kind, type, amount: amount!, date, months },
    );
    setAmount(undefined);
  }

  const sideLabel =
    kind === "percent"
      ? { receivable: "Receitas", payable: "Despesas" }
      : { receivable: "Entrada", payable: "Saída" };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FlaskConical
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
          E se…
        </p>
        <p className="text-xs text-muted-foreground">Nada é gravado</p>
      </div>
      <form
        className="rounded-xl border bg-muted/30 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Tipo de simulação"
            value={kind}
            onChange={setKind}
            options={[
              { value: "once", label: "Lançamento único" },
              { value: "monthly", label: "Mensal" },
              { value: "percent", label: "Percentual" },
            ]}
          />
          <Segmented
            label={kind === "percent" ? "Sobre" : "Sentido"}
            value={type}
            onChange={setType}
            options={[
              { value: "receivable", label: sideLabel.receivable },
              { value: "payable", label: sideLabel.payable },
            ]}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          {kind === "percent" ? (
            <div className="space-y-1">
              <Label htmlFor="sim-pct" className="text-xs">
                Variação do previsto
              </Label>
              <div className="relative w-28">
                <Input
                  id="sim-pct"
                  inputMode="decimal"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  aria-describedby="sim-pct-hint"
                  className="h-8 pr-7 text-sm font-financial"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="sim-amount" className="text-xs">
                  {kind === "monthly" ? "Valor por mês" : "Valor"}
                </Label>
                <CurrencyInput
                  id="sim-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={setAmount}
                  className="h-8 w-36 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sim-date" className="text-xs">
                  {kind === "monthly" ? "Primeiro mês" : "Data"}
                </Label>
                <Input
                  id="sim-date"
                  type="date"
                  min={from}
                  max={until}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  aria-invalid={!dateOk}
                  className="h-8 w-38 text-sm"
                />
              </div>
              {kind === "monthly" && (
                <div className="space-y-1">
                  <Label htmlFor="sim-months" className="text-xs">
                    Meses
                  </Label>
                  <Input
                    id="sim-months"
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="h-8 w-20 text-sm"
                  />
                </div>
              )}
            </>
          )}
          <Button
            type="submit"
            size="sm"
            className="h-8 text-xs"
            disabled={!valid}
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden />
            Simular
          </Button>
        </div>
        <p id="sim-pct-hint" className="mt-2 text-xs text-muted-foreground">
          {kind === "percent"
            ? `Aplica a variação a cada ${type === "receivable" ? "receita" : "despesa"} prevista nos estágios marcados. Use −10 para 10% a menos.`
            : !dateOk
              ? `Escolha uma data entre ${dayText(from)} e ${dayText(until)}.`
              : kind === "monthly"
                ? "Repete no mesmo dia de cada mês; o que passar do horizonte fica de fora."
                : "Um pagamento ou recebimento que ainda não foi lançado."}
        </p>
      </form>

      {simulations.length > 0 && (
        <div className="mt-3">
          <ul className="flex flex-wrap gap-1.5" aria-label="Simulações ativas">
            {simulations.map((s) => (
              <li
                key={s.id}
                className="flex h-7 items-center gap-1 rounded-full border pl-2.5 pr-1 text-xs"
              >
                <span
                  aria-hidden
                  className="mr-0.5 w-3 border-t-2 border-dashed"
                  style={{ borderColor: SIMULATED }}
                />
                {describe(s)}
                <button
                  type="button"
                  onClick={() => onRemove(s.id)}
                  aria-label={`Remover simulação: ${describe(s)}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
            {simulations.length > 1 && (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={onClear}
                >
                  Limpar todas
                </Button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
