"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import currency from "currency.js";
import { Skeleton } from "@/components/ui/skeleton";
import { niceTicks } from "@/lib/dashboardRules";
import { curveGap, investmentLabel } from "@/lib/investment";
import { useAccountPositions } from "@/hooks/useAnalytics";
import { investmentsTitle, yieldSeries } from "@/lib/analytics";
import { useCashReserve } from "@/hooks/useDashboardData";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  money,
  Section,
  signedMoney,
  TooltipBox,
  VIZ,
} from "./primitives";

export function InvestmentsSection() {
  const accounts = useAccountPositions();
  const reserve = useCashReserve();

  const positions = (accounts.data?.positions ?? []).filter(
    (p) => p.investment,
  );
  const invested = positions.reduce(
    (s, p) => s.add(p.balance),
    currency(0),
  ).value;
  const yields = accounts.data?.yields ?? {};

  // Doze meses até o mês passado: o rendimento é reconhecido ao fechar o mês.
  const series = yieldSeries(yields, new Date());
  const yearTotal = series.reduce((s, m) => s.add(m.value), currency(0)).value;
  const ticks = niceTicks(0, Math.max(...series.map((m) => m.value), 0), 4);
  const last = [...series].reverse().find((m) => m.value > 0);

  const rows = (reserve.data ?? []).map(({ account, position }) => {
    const bank = positions.find((p) => p.id === account.id)?.balance ?? null;
    return { account, position, gap: curveGap(position, bank) };
  });

  const loading = accounts.isLoading;
  const title = loading
    ? "Aplicações"
    : investmentsTitle({
        count: positions.length,
        invested,
        last: last ?? null,
      });

  return (
    <Section
      id="aplicacoes"
      kicker="Aplicações"
      title={title}
      description={
        positions.length > 0
          ? "Saldo bruto do último extrato de cada aplicação. O rendimento entra quando a conciliação do mês é fechada."
          : "Cadastre as aplicações em Contas Bancárias para acompanhar saldo e rendimento aqui."
      }
    >
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : positions.length === 0 ? null : (
        <div className="grid gap-8 xl:grid-cols-5">
          <ChartFrame
            className="xl:col-span-3"
            title="Rendimento reconhecido por mês"
            label={`Rendimento reconhecido nos últimos 12 meses: ${fullMoney(yearTotal)}.`}
            height={240}
            note={`Nos 12 meses: ${fullMoney(yearTotal)}.`}
            table={{
              columns: ["Mês", "Rendimento"],
              rows: series.map((m) => [m.label, fullMoney(m.value)]),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={series}
                margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
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
                  width={64}
                  ticks={ticks}
                  domain={[0, ticks[ticks.length - 1]]}
                  tickFormatter={axisMoney}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const m = payload[0].payload as (typeof series)[number];
                    return (
                      <TooltipBox
                        title={m.label}
                        rows={[
                          {
                            label: "Rendimento",
                            value: fullMoney(m.value),
                            color: VIZ.extra,
                          },
                        ]}
                      />
                    );
                  }}
                />
                <Bar
                  dataKey="value"
                  fill={VIZ.extra}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>

          <div className="min-w-0 xl:col-span-2">
            <p className="mb-3 text-sm font-medium">
              Posição de cada aplicação
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Aplicação
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right font-medium"
                    >
                      Bruto
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right font-medium"
                    >
                      Se resgatar hoje
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const r = rows.find((x) => x.account.id === p.id);
                    return (
                      <tr key={p.id} className="border-t align-top">
                        <td className="px-3 py-2">
                          <span className="block">{p.name}</span>
                          {r && (
                            <span className="block text-xs text-muted-foreground">
                              {investmentLabel(r.account)}
                            </span>
                          )}
                          {r?.gap && (
                            <span className="block text-xs text-muted-foreground">
                              Banco {signedMoney(r.gap.gap)}{" "}
                              {r.gap.off
                                ? "fora da curva do CDI"
                                : "dentro da curva do CDI"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-financial">
                          {fullMoney(p.balance)}
                        </td>
                        <td className="px-3 py-2 text-right font-financial">
                          {r ? fullMoney(r.position.net) : "—"}
                          {r && r.position.ir + r.position.iof > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              IR e IOF {money(r.position.ir + r.position.iof)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              &quot;Se resgatar hoje&quot; só para aplicações de liquidez diária
              com saldo informado.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}
