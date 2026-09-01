"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

/**
 * Gráficos do painel de centro de custo, isolados num módulo próprio para que
 * a página os carregue via `next/dynamic`: recharts é pesado e nada acima da
 * dobra depende dele.
 *
 * As cores saem de `var(--state-*)`, não de hex: SVG resolve custom properties
 * normalmente em `fill`/`stroke`, então os dois temas acompanham sem prop extra.
 */

// A index signature é exigida pelo tipo `ChartDataInput` do recharts 3.

export interface MonthlyPoint {
  /** Rótulo curto do mês, já localizado. */
  name: string;
  amount: number;
  monthIndex: number;
  [key: string]: string | number;
}

export interface CompositionSlice {
  name: string;
  value: number;
  /** Referência de token, ex.: "var(--state-spent)". */
  color: string;
  [key: string]: string | number;
}

/** Eixo Y: compacto o bastante para não roubar largura da área de plotagem. */
function formatAxisTick(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) {
    return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`;
  }
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/**
 * Tabela só para leitor de tela. O SVG do recharts não expõe os valores, e a
 * série mensal não existe em texto em nenhum outro ponto da página.
 */
function ChartDataTable({
  caption,
  labelHeader,
  rows,
}: {
  caption: string;
  labelHeader: string;
  rows: { label: string; value: number }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">Valor</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>{formatCurrency(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SpendingTrendChart({
  data,
  year,
}: {
  data: MonthlyPoint[];
  year: number;
}) {
  return (
    <div className="h-[220px] sm:h-[300px]">
      <ChartDataTable
        caption={`Gasto direto por mês em ${year}`}
        labelHeader="Mês"
        rows={data.map((point) => ({ label: point.name, value: point.amount }))}
      />
      <div
        className="h-full"
        role="img"
        aria-label={`Gráfico da tendência de gastos em ${year}. Os valores estão na tabela acima.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="ccSpendingFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--state-spent)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="95%"
                  stopColor="var(--state-spent)"
                  stopOpacity={0.04}
                />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="name"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={formatAxisTick}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-financial text-sm font-semibold text-state-spent">
                      {formatCurrency(Number(payload[0].value) || 0)}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke="var(--state-spent)"
              strokeWidth={2}
              fill="url(#ccSpendingFill)"
              dot={false}
              activeDot={{
                r: 5,
                fill: "var(--state-spent)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function EnvelopeCompositionChart({
  data,
  year,
}: {
  data: CompositionSlice[];
  year: number;
}) {
  return (
    <div className="flex h-[220px] flex-col sm:h-[300px]">
      <ChartDataTable
        caption={`Composição do envelope de ${year}`}
        labelHeader="Parcela"
        rows={data.map((slice) => ({ label: slice.name, value: slice.value }))}
      />
      <div
        className="min-h-0 flex-1"
        role="img"
        aria-label={`Gráfico da composição do envelope de ${year}. Os valores estão na tabela acima.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={70}
              paddingAngle={4}
              dataKey="value"
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const slice = payload[0];
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                    <p className="text-xs text-muted-foreground">
                      {slice.name}
                    </p>
                    <p className="font-financial text-sm font-semibold text-popover-foreground">
                      {formatCurrency(Number(slice.value) || 0)}
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-1.5 pt-2">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-xs text-muted-foreground">{slice.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
