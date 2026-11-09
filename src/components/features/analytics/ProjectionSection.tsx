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
  attentionProjection,
  horizonEnd,
  overdueOf,
  PROJECTION_HORIZONS,
  projectBalance,
  projectionTitle,
  thinOutflow,
  type AnalyticsReport,
  type ForecastStage,
  type ProjectionPoint,
  type Side,
  type Simulation,
} from "@/lib/analytics";
import { differenceInCalendarDays } from "date-fns";
import { niceTicks } from "@/lib/dashboardRules";
import { DEFAULT_FORECAST, FORECAST_STAGES, STAGE_INFO } from "@/lib/reports";
import { cn } from "@/lib/utils";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  money,
  pct,
  Section,
  TooltipBox,
  VIZ,
} from "./primitives";

/** Negativo nos próximos 90 dias: o gráfico abre em 3 meses, onde ele se vê. */
const NEAR_DAYS = 90;

const BALANCE = "var(--chart-cash)";
const SIMULATED = "var(--chart-sim)";
const NEGATIVE = "var(--destructive)";

type Horizon = (typeof PROJECTION_HORIZONS)[number];
type SimKind = Simulation["kind"];

const toDate = (key: string) => new Date(`${key}T12:00:00`);
const dayText = (key: string) => format(toDate(key), "dd/MM/yyyy");
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
  const [chosen, setChosen] = useState<Horizon | null>(null);
  const [stages, setStages] = useState<ForecastStage[]>(
    DEFAULT_FORECAST as ForecastStage[],
  );
  const [estimate, setEstimate] = useState(false);
  const [simulations, setSimulations] = useState<Simulation[]>([]);

  const from = report.today;
  const opening = cash.balance;

  // Até a pessoa escolher, o horizonte segue o perigo: buraco perto, 3 meses.
  const auto = useMemo<Horizon>(() => {
    const run = attentionProjection(report, opening)?.runs[0];
    return run &&
      differenceInCalendarDays(toDate(run.start.isoDate), toDate(from)) <=
        NEAR_DAYS
      ? 3
      : 12;
  }, [report, opening, from]);
  const months = chosen ?? auto;
  const until = horizonEnd(from, months);

  // As duas versões: a linha usa uma, a lista mostra o que a média somaria.
  const [plain, filled] = useMemo(() => {
    if (opening === null) return [null, null];
    const base = {
      days: report.projection,
      opening,
      stages,
      from,
      until,
      simulations,
      average: report.average,
    };
    return [projectBalance(base), projectBalance({ ...base, estimate: true })];
  }, [report, opening, stages, from, until, simulations]);
  const projection = estimate ? filled : plain;

  const toggleStage = (s: ForecastStage) =>
    setStages((prev) =>
      prev.includes(s)
        ? prev.filter((x) => x !== s)
        : (FORECAST_STAGES as ForecastStage[]).filter(
            (x) => prev.includes(x) || x === s,
          ),
    );

  // Vencido e não baixado: fora da projeção, mostrado à parte.
  const overdueIn = overdueOf(report, "receivable").value;
  const overdueOut = overdueOf(report, "payable").value;
  const overdueNote =
    overdueIn || overdueOut
      ? ` Vencidos que ainda não entraram nem saíram ficam fora: ${money(overdueIn)} a receber e ${money(overdueOut)} a pagar.`
      : "";

  const horizonSwitch = (
    <Segmented
      label="Horizonte da projeção"
      value={String(months)}
      onChange={(v) => setChosen(Number(v) as Horizon)}
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

  const { lowest, closing, simulated } = projection;
  const title = projectionTitle(projection);
  const thin = thinOutflow(projection);
  const avgMonths = report.average.months;
  const draftOut =
    projection.byStage.find((s) => s.stage === "draft")?.outflow ?? 0;

  return (
    <Section
      id="projecao"
      kicker="Projeção e simulação"
      title={title}
      description={`A partir do caixa disponível de hoje (${money(projection.opening)}), com o que já está lançado${stages.includes("recurring") ? " e as recorrências ainda não lançadas" : ""}.${overdueNote}`}
      actions={horizonSwitch}
    >
      {/* Frases, não blocos de número: o fim do horizonte só faz sentido
          ao lado do quanto dele está lançado. */}
      <p className="max-w-3xl text-sm text-pretty">
        Menor saldo{" "}
        <strong className="font-financial font-semibold">
          {fullMoney(lowest.balance)}
        </strong>{" "}
        em {dayText(lowest.isoDate)}
        {simulated && (
          <>
            {" "}
            (com a simulação,{" "}
            <span className="font-financial">
              {fullMoney(simulated.lowest)}
            </span>
            )
          </>
        )}
        . Em {dayText(until)},{" "}
        <span className="font-financial">{fullMoney(closing)}</span>
        {thin !== null ? (
          <>
            , mas a linha conta só {pct(thin)} da despesa média dos últimos{" "}
            {avgMonths} meses ({money(report.average.outflow)} por mês)
            {draftOut > 0 && !stages.includes("draft") && (
              <>
                ; {money(draftOut)} em despesas ainda em rascunho ficam de fora
              </>
            )}
            . Ela sobe porque faltam saídas, não porque o caixa vá sobrar.
            Marque{" "}
            {draftOut > 0 && !stages.includes("draft") ? "Rascunho ou " : ""}
            &quot;Não lançado, pela média&quot; para ver com elas.
          </>
        ) : projection.estimated.outflow || projection.estimated.inflow ? (
          <>
            , com {money(projection.estimated.outflow)} de despesas e{" "}
            {money(projection.estimated.inflow)} de receitas estimadas pela
            média dos últimos {avgMonths} meses.
          </>
        ) : (
          "."
        )}
      </p>

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
          estimate={{
            on: estimate,
            inflow: filled!.estimated.inflow,
            outflow: filled!.estimated.outflow,
            months: avgMonths,
            onToggle: () => setEstimate((v) => !v),
          }}
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
  // Depois do primeiro mês com menos da metade da despesa média na conta, a
  // linha fica clara: dali em diante ela sobe por falta de saídas.
  const thinFrom =
    thinOutflow(projection) !== null ? projection.thinFrom : null;
  const rows: (ProjectionPoint & {
    t: number;
    solid?: number;
    loose?: number;
  })[] = points.map((p) => ({ ...p, t: toDate(p.isoDate).getTime() }));
  if (thinFrom) {
    const j = rows.findIndex((p) => p.isoDate >= thinFrom);
    // Ponto no dia da virada, para a troca de traço cair no dia certo.
    if (j > 0 && rows[j].isoDate !== thinFrom)
      rows.splice(j, 0, {
        isoDate: thinFrom,
        t: toDate(thinFrom).getTime(),
        inflow: 0,
        outflow: 0,
        balance: rows[j - 1].balance,
        simulatedBalance: rows[j - 1].simulatedBalance,
      });
  }
  const data = rows.map((p) => ({
    ...p,
    solid: !thinFrom || p.isoDate <= thinFrom ? p.balance : undefined,
    loose: thinFrom && p.isoDate >= thinFrom ? p.balance : undefined,
  }));
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
  // do gradiente tem altura zero e o SVG o descartaria). Cada trecho tem a
  // própria caixa, então o próprio gradiente.
  const split = (id: string, values: (number | undefined)[]) => {
    const vs = values.filter((v): v is number => v !== undefined);
    const max = Math.max(...vs);
    const min = Math.min(...vs);
    const crosses = min < 0 && max > 0;
    return {
      id,
      offset: crosses ? max / (max - min) : 0,
      crosses,
      color: crosses ? `url(#${id})` : max <= 0 && min < 0 ? NEGATIVE : BALANCE,
    };
  };
  const solidSplit = split(
    "projSolid",
    data.map((p) => p.solid),
  );
  const looseSplit = split(
    "projLoose",
    data.map((p) => p.loose),
  );
  const hasSolid = data.some((p) => p.solid !== undefined);

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
    thinFrom
      ? ` A partir de ${dayText(thinFrom)}, saídas incompletas: a linha fica clara.`
      : ""
  }${
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
          {thinFrom && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-3.5 rounded-full opacity-35"
                style={{ background: BALANCE }}
              />
              Saídas incompletas
            </li>
          )}
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
        simulated
          ? `Com a simulação, ${simulated.runs.length ? `fica negativo ${textOf(simulated.runs)}` : "não fica negativo"}. A linha tracejada é só uma simulação: nada foi gravado.`
          : undefined
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
        >
          <defs>
            {[solidSplit, looseSplit].map((s) => (
              <linearGradient key={s.id} id={s.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset={s.offset} stopColor={BALANCE} />
                <stop offset={s.offset} stopColor={NEGATIVE} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          {bands.map((b, i) => (
            <ReferenceArea
              key={b.key}
              x1={b.x1}
              x2={b.x2}
              fill={NEGATIVE}
              fillOpacity={0.12}
              ifOverflow="hidden"
              label={
                i === 0
                  ? {
                      value: "Negativo",
                      position: "insideTopLeft",
                      fontSize: 12,
                      fill: NEGATIVE,
                    }
                  : undefined
              }
            />
          ))}
          {thinFrom && thinFrom !== from && (
            <ReferenceLine
              x={toDate(thinFrom).getTime()}
              stroke={VIZ.axis}
              strokeDasharray="2 3"
              strokeOpacity={0.6}
              label={{
                value: "Saídas incompletas →",
                position: "insideTopRight",
                fontSize: 12,
                fill: "var(--muted-foreground)",
              }}
            />
          )}
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
          {hasSolid && (
            <Line
              type="stepAfter"
              dataKey="solid"
              stroke={solidSplit.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
          {thinFrom && (
            <Line
              type="stepAfter"
              dataKey="loose"
              stroke={looseSplit.color}
              strokeOpacity={0.35}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
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
  estimate,
}: {
  byStage: { stage: ForecastStage; inflow: number; outflow: number }[];
  stages: ForecastStage[];
  onToggle: (s: ForecastStage) => void;
  estimate: {
    on: boolean;
    inflow: number;
    outflow: number;
    months: number;
    onToggle: () => void;
  };
}) {
  const cols =
    "grid grid-cols-[auto_minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-3 px-2";
  const rows = [
    ...byStage.map(({ stage, inflow, outflow }) => ({
      key: stage,
      label: STAGE_INFO[stage].label,
      hint: STAGE_INFO[stage].hint,
      inflow,
      outflow,
      on: stages.includes(stage),
      toggle: () => onToggle(stage),
    })),
    ...(estimate.inflow || estimate.outflow
      ? [
          {
            key: "estimate",
            label: "Não lançado, pela média",
            hint: `Completa cada mês até a média dos últimos ${estimate.months} meses`,
            inflow: estimate.inflow,
            outflow: estimate.outflow,
            on: estimate.on,
            toggle: estimate.onToggle,
          },
        ]
      : []),
  ];
  return (
    <div>
      <p className="mb-1 px-2 text-sm font-medium">O que entra na linha</p>
      <div
        aria-hidden
        className={cn(cols, "pb-1 text-xs text-muted-foreground")}
      >
        <span className="w-4" />
        <span>Situação do lançamento</span>
        <span className="text-right">Entradas</span>
        <span className="text-right">Saídas</span>
      </div>
      <ul
        className="divide-y border-t"
        role="group"
        aria-label="O que entra na projeção"
      >
        {rows.map(({ key, label, hint, inflow, outflow, on, toggle }) => {
          return (
            <li
              key={key}
              className={cn(key === "estimate" && "border-t-2 border-dashed")}
            >
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${label}: entradas ${money(inflow)}, saídas ${money(outflow)}`}
                onClick={toggle}
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
                    {label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {hint}
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
