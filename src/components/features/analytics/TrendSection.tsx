"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import currency from "currency.js";
import type { AnalyticsReport } from "@/lib/analytics";
import { niceTicks } from "@/lib/dashboardRules";
import { variation } from "@/lib/reports";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  Legend,
  money,
  pct,
  Section,
  signedMoney,
  TooltipBox,
  VIZ,
} from "./primitives";

const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** Resultado acumulado mês a mês no ano e no anterior; o ano corrente para em `lastKey`. */
function cumulativeByYear(
  trend: AnalyticsReport["trend"],
  year: number,
  lastKey: string,
) {
  const byKey = new Map(trend.map((m) => [m.key, m]));
  let acc = currency(0);
  let accPrev = currency(0);
  return MONTHS.map((label, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const cur = byKey.get(`${year}-${mm}`);
    const prev = byKey.get(`${year - 1}-${mm}`);
    if (cur) acc = acc.add(cur.net);
    if (prev) accPrev = accPrev.add(prev.net);
    return {
      label,
      current: `${year}-${mm}` <= lastKey ? acc.value : null,
      previous: prev ? accPrev.value : null,
    };
  });
}

export function TrendSection({
  report,
  compareLabel,
}: {
  report: AnalyticsReport;
  compareLabel: string | null;
}) {
  const { range, totals, compareTotals, trend } = report;
  const inRange = (key: string) => key >= range.from && key <= range.to;

  const top = Math.max(...trend.map((m) => Math.max(m.inflow, m.outflow)), 0);
  const ticks = niceTicks(0, top, 5);

  // Resultado acumulado no ano do fim do período contra o ano anterior. O ano
  // corrente para no mês de hoje: mês futuro sem baixa não é resultado zero.
  const year = Number(range.to.slice(0, 4));
  const yoy = cumulativeByYear(
    trend,
    year,
    [range.to, report.today.slice(0, 7)].sort()[0],
  );
  const yoyValues = yoy.flatMap((p) =>
    [p.current, p.previous].filter((v): v is number => v !== null),
  );
  const yoyTicks = niceTicks(
    Math.min(0, ...yoyValues),
    Math.max(0, ...yoyValues),
    5,
  );
  const lastCurrent = [...yoy].reverse().find((p) => p.current !== null);
  const samePrev = lastCurrent ? yoy[yoy.indexOf(lastCurrent)].previous : null;

  const delta = compareTotals ? variation(totals.net, compareTotals.net) : null;
  const title =
    `Resultado de ${signedMoney(totals.net)} no período` +
    (compareTotals && compareLabel
      ? delta === null
        ? `, contra ${signedMoney(compareTotals.net)} em ${compareLabel}`
        : `, ${pct(Math.abs(delta))} ${delta >= 0 ? "acima" : "abaixo"} do resultado de ${compareLabel}`
      : "");

  return (
    <Section
      id="resultado"
      kicker="Resultado e tendência"
      title={title}
      description={
        report.regime === "cash"
          ? "Regime de caixa: só o que foi pago ou recebido, no mês da baixa."
          : "Regime de competência: o mês a que o lançamento pertence, pago ou não. Rejeitados ficam fora."
      }
    >
      <div className="grid gap-8 xl:grid-cols-5">
        <ChartFrame
          className="xl:col-span-3"
          title="Entradas e saídas, 24 meses"
          label={`Entradas e saídas mês a mês. No período: receitas ${fullMoney(totals.inflow)}, despesas ${fullMoney(totals.outflow)}.`}
          legend={
            <Legend
              items={[
                { label: "Receitas", color: VIZ.in },
                { label: "Despesas", color: VIZ.out },
              ]}
            />
          }
          note="Meses fora do período escolhido aparecem esmaecidos."
          table={{
            columns: ["Mês", "Receitas", "Despesas", "Resultado"],
            rows: trend.map((m) => [
              m.label,
              fullMoney(m.inflow),
              fullMoney(m.outflow),
              fullMoney(m.net),
            ]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend}
              margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
              barGap={2}
              barCategoryGap="22%"
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke={VIZ.grid} />
              <XAxis
                dataKey="label"
                {...AXIS_PROPS}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                {...AXIS_PROPS}
                width={68}
                ticks={ticks}
                domain={[ticks[0], ticks[ticks.length - 1]]}
                tickFormatter={axisMoney}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const m = payload[0].payload as (typeof trend)[number];
                  return (
                    <TooltipBox
                      title={m.label}
                      rows={[
                        {
                          label: "Receitas",
                          value: fullMoney(m.inflow),
                          color: VIZ.in,
                        },
                        {
                          label: "Despesas",
                          value: fullMoney(m.outflow),
                          color: VIZ.out,
                        },
                        { label: "Resultado", value: fullMoney(m.net) },
                      ]}
                    />
                  );
                }}
              />
              <Bar
                dataKey="inflow"
                name="Receitas"
                fill={VIZ.in}
                radius={[4, 4, 0, 0]}
                maxBarSize={14}
              >
                {trend.map((m) => (
                  <Cell key={m.key} fillOpacity={inRange(m.key) ? 1 : 0.35} />
                ))}
              </Bar>
              <Bar
                dataKey="outflow"
                name="Despesas"
                fill={VIZ.out}
                radius={[4, 4, 0, 0]}
                maxBarSize={14}
              >
                {trend.map((m) => (
                  <Cell key={m.key} fillOpacity={inRange(m.key) ? 1 : 0.35} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          className="xl:col-span-2"
          title={`Resultado acumulado em ${year}`}
          label={
            lastCurrent
              ? `Resultado acumulado de ${year} até ${lastCurrent.label}: ${fullMoney(lastCurrent.current!)}${samePrev !== null ? `; em ${year - 1}, no mesmo mês: ${fullMoney(samePrev)}` : ""}.`
              : `Sem resultado em ${year} até agora.`
          }
          legend={
            <Legend
              items={[
                { label: String(year), color: VIZ.in, shape: "line" },
                { label: String(year - 1), color: VIZ.context, shape: "line" },
              ]}
            />
          }
          note={
            lastCurrent && samePrev !== null
              ? `Até ${lastCurrent.label}: ${money(lastCurrent.current!)} em ${year}, ${money(samePrev)} em ${year - 1}.`
              : undefined
          }
          table={{
            columns: ["Mês", String(year), String(year - 1)],
            rows: yoy.map((p) => [
              p.label,
              p.current === null ? "—" : fullMoney(p.current),
              p.previous === null ? "—" : fullMoney(p.previous),
            ]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={yoy}
              margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke={VIZ.grid} />
              <XAxis dataKey="label" {...AXIS_PROPS} />
              <YAxis
                {...AXIS_PROPS}
                width={68}
                ticks={yoyTicks}
                domain={[yoyTicks[0], yoyTicks[yoyTicks.length - 1]]}
                tickFormatter={axisMoney}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof yoy)[number];
                  return (
                    <TooltipBox
                      title={`Até ${label}`}
                      rows={[
                        ...(p.current !== null
                          ? [
                              {
                                label: String(year),
                                value: fullMoney(p.current),
                                color: VIZ.in,
                              },
                            ]
                          : []),
                        ...(p.previous !== null
                          ? [
                              {
                                label: String(year - 1),
                                value: fullMoney(p.previous),
                                color: VIZ.context,
                              },
                            ]
                          : []),
                      ]}
                    />
                  );
                }}
              />
              <Line
                dataKey="previous"
                stroke={VIZ.context}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                dataKey="current"
                stroke={VIZ.in}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
    </Section>
  );
}
