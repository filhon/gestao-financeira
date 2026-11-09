"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AnalyticsReport, PlanBridge, Side } from "@/lib/analytics";
import { niceTicks } from "@/lib/dashboardRules";
import { transactionService } from "@/lib/services/transactionService";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { Segmented } from "@/components/features/dashboard/Segmented";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  Legend,
  money,
  pct,
  Section,
  SIDE_COLOR,
  SIDE_LABEL,
  signedMoney,
  TooltipBox,
  VIZ,
} from "./primitives";

interface Step {
  key: string;
  label: string;
  value: number;
  total?: boolean;
  hint: string;
}

const stepsOf = (b: PlanBridge, side: Side): Step[] =>
  [
    {
      key: "planned",
      label: "Previsto",
      value: b.planned,
      total: true,
      hint: "Valor com que cada lançamento nasceu.",
    },
    {
      key: "revisions",
      label: "Revisões",
      value: b.revisions,
      hint: "Mudanças de valor depois de previsto, inclusive partes desdobradas e ajustes do aprovador do lote.",
    },
    {
      key: "unplanned",
      label: "Não previstos",
      value: b.unplanned,
      hint: "Lançados já pagos ou depois do vencimento.",
    },
    {
      key: "cancelled",
      label: "Rejeitados",
      value: -b.cancelled,
      hint: "Previstos e depois rejeitados.",
    },
    {
      key: "settlement",
      label: "Diferença na baixa",
      value: b.settlement,
      hint:
        side === "payable"
          ? "Juros, multa ou desconto no pagamento."
          : "Desconto ou acréscimo no recebimento.",
    },
    {
      key: "overdue",
      label: "Vencido sem baixa",
      value: -b.openOverdue,
      hint: "Já venceu e ainda não foi baixado.",
    },
    {
      key: "future",
      label: "A vencer",
      value: -b.openFuture,
      hint: "Ainda dentro do prazo.",
    },
    {
      key: "realized",
      label: side === "payable" ? "Pago" : "Recebido",
      value: b.realized,
      total: true,
      hint: "Baixado no período.",
    },
  ].filter((s) => s.total || s.value !== 0);

/** Degrau da ponte: a barra flutua do saldo anterior até o novo. */
function bridgeData(steps: Step[]) {
  let running = 0;
  return steps.map((s) => {
    if (s.total) {
      running = s.value;
      return { ...s, base: 0, bar: s.value, text: money(s.value) };
    }
    const start = running;
    running += s.value;
    return {
      ...s,
      base: Math.min(start, running),
      bar: Math.abs(s.value),
      text: signedMoney(s.value),
    };
  });
}

/** Marca horizontal do valor revisado, atravessando o par de colunas do mês. */
function RevisedTick(props: { cx?: number; cy?: number; value?: number }) {
  const { cx, cy, value } = props;
  if (cx === undefined || cy === undefined || !value) return null;
  return (
    <line
      x1={cx - 13}
      x2={cx + 13}
      y1={cy}
      y2={cy}
      stroke="var(--foreground)"
      strokeOpacity={0.75}
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
}

export function PlanSection({ report }: { report: AnalyticsReport }) {
  const [side, setSide] = useState<Side>("receivable");
  const [opening, setOpening] = useState<string | null>(null);
  const openTransaction = useTransactionDetailStore((s) => s.openTransaction);

  const plan = report.plan[side];
  const b = plan.bridge;
  const color = SIDE_COLOR[side];
  const steps = stepsOf(b, side);
  const bridge = bridgeData(steps);
  const months = plan.months;
  const monthTicks = niceTicks(
    0,
    Math.max(
      ...months.map((m) => Math.max(m.planned, m.revised, m.realized)),
      0,
    ),
    5,
  );
  const bridgeTicks = niceTicks(
    0,
    Math.max(...bridge.map((s) => s.base + s.bar), 0),
    5,
  );

  const noun = side === "receivable" ? "Receita" : "Despesa";
  const verb = side === "receivable" ? "recebida" : "paga";
  const title = b.planned
    ? `${noun} ${verb}: ${money(b.realized)} de ${money(b.planned)} previstos (${pct(b.realized / b.planned)})`
    : `${noun} ${verb}: ${money(b.realized)}, sem previsão no período`;

  async function open(id: string) {
    setOpening(id);
    try {
      const [tx] = await transactionService.getByIds([id]);
      if (!tx) throw new Error("not-found");
      openTransaction(tx);
    } catch {
      toast.error("Não foi possível abrir o lançamento.");
    } finally {
      setOpening(null);
    }
  }

  const monthLabel = (key: string) =>
    format(new Date(`${key}-01T12:00:00`), "MMM/yy", { locale: ptBR });

  return (
    <Section
      id="previsto"
      kicker="Previsto, revisado e realizado"
      title={title}
      description={
        <>
          Por mês de vencimento. A previsão é o valor com que o lançamento
          nasceu; quando ele é editado depois (o faturamento consolidado da
          mantenedora, por exemplo), a diferença vira revisão.
          {b.openOverdue > 0 &&
            ` ${money(b.openOverdue)} já venceram sem baixa.`}
        </>
      }
      actions={
        <Segmented
          label="Lado da previsão"
          value={side}
          onChange={setSide}
          options={[
            { value: "receivable", label: "Receitas" },
            { value: "payable", label: "Despesas" },
          ]}
        />
      }
    >
      <div className="grid gap-8 xl:grid-cols-2">
        <ChartFrame
          title="Do previsto ao realizado"
          label={steps
            .map((s) => `${s.label}: ${fullMoney(s.value)}`)
            .join("; ")}
          height={Math.max(220, bridge.length * 40)}
          table={{
            columns: ["Etapa", "Valor", "O que é"],
            numeric: [1],
            rows: steps.map((s) => [
              s.label,
              s.total ? fullMoney(s.value) : signedMoney(s.value),
              s.hint,
            ]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bridge}
              layout="vertical"
              margin={{ top: 0, right: 72, left: 0, bottom: 0 }}
              barCategoryGap="28%"
              accessibilityLayer
            >
              <CartesianGrid horizontal={false} stroke={VIZ.grid} />
              <XAxis
                type="number"
                {...AXIS_PROPS}
                ticks={bridgeTicks}
                domain={[0, bridgeTicks[bridgeTicks.length - 1]]}
                tickFormatter={axisMoney}
              />
              <YAxis
                type="category"
                dataKey="label"
                {...AXIS_PROPS}
                width={128}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const s = payload[0].payload as (typeof bridge)[number];
                  return (
                    <TooltipBox
                      title={s.label}
                      rows={[
                        {
                          label: "Valor",
                          value: s.total
                            ? fullMoney(s.value)
                            : signedMoney(s.value),
                        },
                      ]}
                      footer={s.hint}
                    />
                  );
                }}
              />
              <Bar
                dataKey="base"
                stackId="b"
                fill="transparent"
                isAnimationActive={false}
              />
              <Bar
                dataKey="bar"
                stackId="b"
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              >
                {bridge.map((s) => (
                  <Cell
                    key={s.key}
                    fill={
                      s.key === "planned"
                        ? VIZ.context
                        : s.total
                          ? color
                          : VIZ.step
                    }
                  />
                ))}
                <LabelList
                  dataKey="text"
                  position="right"
                  className="fill-foreground"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Mês a mês"
          label={months
            .map(
              (m) =>
                `${m.label}: previsto ${fullMoney(m.planned)}, revisado ${fullMoney(m.revised)}, realizado ${fullMoney(m.realized)}`,
            )
            .join("; ")}
          legend={
            <Legend
              items={[
                { label: "Previsto", color: VIZ.context },
                {
                  label: "Revisado",
                  color: "var(--foreground)",
                  shape: "tick",
                },
                { label: side === "payable" ? "Pago" : "Recebido", color },
              ]}
            />
          }
          table={{
            columns: [
              "Mês",
              "Previsto",
              "Revisado",
              side === "payable" ? "Pago" : "Recebido",
            ],
            rows: months.map((m) => [
              m.label,
              fullMoney(m.planned),
              fullMoney(m.revised),
              fullMoney(m.realized),
            ]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={months}
              margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
              barGap={2}
              barCategoryGap="28%"
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke={VIZ.grid} />
              <XAxis
                dataKey="label"
                {...AXIS_PROPS}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                {...AXIS_PROPS}
                width={68}
                ticks={monthTicks}
                domain={[0, monthTicks[monthTicks.length - 1]]}
                tickFormatter={axisMoney}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const m = payload[0].payload as (typeof months)[number];
                  return (
                    <TooltipBox
                      title={m.label}
                      rows={[
                        {
                          label: "Previsto",
                          value: fullMoney(m.planned),
                          color: VIZ.context,
                        },
                        { label: "Revisado", value: fullMoney(m.revised) },
                        {
                          label: side === "payable" ? "Pago" : "Recebido",
                          value: fullMoney(m.realized),
                          color,
                        },
                      ]}
                      footer={
                        m.planned
                          ? `Realizado ${pct(m.realized / m.planned)} do previsto`
                          : undefined
                      }
                    />
                  );
                }}
              />
              <Bar
                dataKey="planned"
                fill={VIZ.context}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Bar
                dataKey="realized"
                fill={color}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Line
                dataKey="revised"
                stroke="transparent"
                dot={<RevisedTick />}
                activeDot={false}
                legendType="none"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium">Maiores desvios</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Recebido ou pago, mais o que ainda está em aberto, contra o previsto.
          Partes de um mesmo lançamento (1/3, 2/3…) contam juntas.
        </p>
        {plan.deviations.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhum desvio: tudo saiu pelo valor previsto.
          </p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border">
            {plan.deviations.map((d) => {
              const up = d.deviation > 0;
              const Icon = up ? ArrowUpRight : ArrowDownRight;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => open(d.id)}
                    disabled={opening !== null}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait sm:grid-cols-[1fr_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {d.description}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.counterpart} · {monthLabel(d.month)}
                        {d.parts > 1 ? ` · ${d.parts} partes` : ""}
                      </span>
                    </span>
                    <span className="hidden text-right font-financial text-xs text-muted-foreground sm:block">
                      {money(d.planned)} previsto
                      <br />
                      {money(d.realized + d.open)}{" "}
                      {d.open
                        ? "com o em aberto"
                        : side === "payable"
                          ? "pago"
                          : "recebido"}
                    </span>
                    <span className="flex items-center justify-end gap-1 font-financial text-sm font-medium">
                      {opening === d.id ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <Icon
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      {signedMoney(d.deviation)}
                      <span className="sr-only">
                        {up ? "acima do previsto" : "abaixo do previsto"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {plan.history.total > 0 && plan.history.knownShare < 1 && (
          <p className="mt-3 text-xs text-muted-foreground text-pretty">
            {pct(plan.history.knownShare)} dos lançamentos previstos de{" "}
            {SIDE_LABEL[side].toLowerCase()} no período têm a previsão
            registrada (na criação ou pela auditoria). Nos demais, o previsto é
            o valor atual, então revisões antigas não aparecem.
          </p>
        )}
      </div>
    </Section>
  );
}
