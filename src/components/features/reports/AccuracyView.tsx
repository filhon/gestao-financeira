"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, RotateCcw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AXIS_PROPS,
  axisMoney,
  ChartFrame,
  fullMoney,
  Legend,
  money,
  SIDE_COLOR,
  TooltipBox,
  VIZ,
} from "@/components/features/analytics/primitives";
import { Segmented, TD, TH } from "@/components/features/reports/ReportTables";
import { niceTicks } from "@/lib/dashboardRules";
import {
  accuracyTitle,
  CAUSES,
  type AccuracyReport,
  type Horizon,
  type Side,
  type SideStats,
} from "@/lib/forecastAccuracy";
import { transactionService } from "@/lib/services/transactionService";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { cn } from "@/lib/utils";

const day = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const shortDay = (iso: string) => day(iso).slice(0, 5);
const percent = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;
const weeksText = (w: number) => (w === 1 ? "1 semana" : `${w} semanas`);

/** "previu 14% a mais" diz mais que um sinal. */
const biasText = (s: SideStats) =>
  s.bias === null
    ? ""
    : Math.abs(s.bias) < 0.01
      ? "na medida"
      : `previu ${Math.round(Math.abs(s.bias) * 100)}% ${s.bias > 0 ? "a mais" : "a menos"}`;

const SIDE_NAME: Record<Side, string> = {
  payable: "Saídas",
  receivable: "Entradas",
};

/** Quanto a previsão de caixa costuma errar, e por quê. */
export function AccuracyView({ companyId }: { companyId: string }) {
  const [weeks, setWeeks] = useState<Horizon>(4);
  const [side, setSide] = useState<Side>("payable");
  const [opening, setOpening] = useState<string | null>(null);
  const { openTransaction } = useTransactionDetailStore();
  /** "Medir de novo" passa por cima do cache do servidor. */
  const fresh = useRef(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["forecast-accuracy", companyId],
    queryFn: async (): Promise<AccuracyReport> => {
      const res = await fetch(
        `/api/internal/forecast-accuracy?companyId=${encodeURIComponent(companyId)}${fresh.current ? "&fresh=1" : ""}`,
      );
      fresh.current = false;
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error ?? "Não foi possível medir a previsão.");
      return body;
    },
    staleTime: 30 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="text-sm text-muted-foreground">
          Reconstituindo o que o sistema previa em cada semana…
        </p>
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm">
          {(error as Error | null)?.message ??
            "Não foi possível medir a previsão."}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  const h = data.horizons.find((x) => x.weeks === weeks);
  if (!h || data.horizons.every((x) => x.points.length === 0)) {
    return (
      <div className="rounded-lg border py-16 text-center">
        <p className="text-sm">Ainda não há previsão vencida para medir.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          O índice aparece duas semanas depois dos primeiros lançamentos.
        </p>
      </div>
    );
  }

  const open = async (id: string) => {
    setOpening(id);
    try {
      const [t] = await transactionService.getByIds([id]);
      if (t) openTransaction(t);
      else toast.error("Este lançamento não existe mais.");
    } catch {
      toast.error("Não foi possível abrir o lançamento.");
    } finally {
      setOpening(null);
    }
  };

  const points = h.points.map((p) => ({
    ...p,
    label: shortDay(p.origin),
    f: p.forecast[side],
    a: p.actual[side],
  }));
  const ticks = niceTicks(0, Math.max(...points.flatMap((p) => [p.f, p.a])), 5);
  const causes = h.causes[side];
  const items = (h.last?.items ?? []).filter((i) => i.side === side);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-3xl space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-balance md:text-xl">
            {accuracyTitle(h, money)}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            O que o sistema previa em cada segunda-feira contra o que passou
            pelo banco, nas últimas {h.points.length} previsões já vencidas.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          disabled={isFetching}
          onClick={() => {
            fresh.current = true;
            void refetch();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isFetching ? "Medindo…" : "Medir de novo"}
        </Button>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="border-b text-left">
              <th scope="col" className={TH}>
                Previsão para
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Acerto das saídas
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Acerto das entradas
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Erro médio do saldo
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                8 em cada 10 erram até
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Previsões
              </th>
            </tr>
          </thead>
          <tbody>
            {data.horizons.map((x) => (
              <tr
                key={x.weeks}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  x.weeks === weeks && "bg-muted/50",
                )}
              >
                <th scope="row" className={cn(TD, "text-left font-medium")}>
                  {weeksText(x.weeks)}
                </th>
                {(["payable", "receivable"] as const).map((s) => (
                  <td key={s} className={cn(TD, "text-right")}>
                    <span className="font-financial font-semibold">
                      {percent(x.sides[s].accuracy)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {biasText(x.sides[s])}
                    </span>
                  </td>
                ))}
                <td className={cn(TD, "text-right font-financial")}>
                  {x.balance ? fullMoney(x.balance.mean) : "—"}
                </td>
                <td className={cn(TD, "text-right font-financial")}>
                  {x.balance ? fullMoney(x.balance.p80) : "—"}
                </td>
                <td
                  className={cn(
                    TD,
                    "text-right font-financial text-muted-foreground",
                  )}
                >
                  {x.points.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Segmented
          label="Previsão para"
          value={String(weeks)}
          onChange={(v) => setWeeks(Number(v) as Horizon)}
          options={data.horizons.map((x) => ({
            value: String(x.weeks),
            label: weeksText(x.weeks),
          }))}
        />
        <Segmented
          label="Mostrar"
          value={side}
          onChange={setSide}
          options={[
            { value: "payable", label: "Saídas" },
            { value: "receivable", label: "Entradas" },
          ]}
        />
      </div>

      {points.length > 0 && (
        <ChartFrame
          title={`${SIDE_NAME[side]}: previsto e realizado em ${weeksText(weeks)}`}
          label={`${SIDE_NAME[side]} previstas e realizadas por segunda-feira da previsão. Acerto de ${percent(h.sides[side].accuracy)}.`}
          legend={
            <Legend
              items={[
                { label: "Realizado", color: SIDE_COLOR[side], shape: "line" },
                { label: "Previsto", color: VIZ.step, shape: "line" },
              ]}
            />
          }
          note="Cada ponto é uma segunda-feira; as janelas de 4 e 13 semanas se sobrepõem."
          table={{
            columns: ["Previsão de", "Até", "Previsto", "Realizado", "Erro"],
            numeric: [2, 3, 4],
            rows: points.map((p) => [
              day(p.origin),
              day(p.end),
              fullMoney(p.f),
              fullMoney(p.a),
              fullMoney(p.a - p.f),
            ]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke={VIZ.grid} />
              <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={24} />
              <YAxis
                {...AXIS_PROPS}
                width={64}
                ticks={ticks}
                domain={[0, ticks[ticks.length - 1]]}
                tickFormatter={axisMoney}
              />
              <Tooltip
                cursor={{ stroke: VIZ.context }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as
                    | (typeof points)[number]
                    | undefined;
                  return active && p ? (
                    <TooltipBox
                      title={`${day(p.origin)} a ${day(p.end)}`}
                      rows={[
                        {
                          label: "Realizado",
                          value: fullMoney(p.a),
                          color: SIDE_COLOR[side],
                        },
                        {
                          label: "Previsto",
                          value: fullMoney(p.f),
                          color: VIZ.step,
                        },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Line
                type="linear"
                dataKey="f"
                stroke={VIZ.step}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="a"
                stroke={SIDE_COLOR[side]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}

      <div className="grid gap-8 xl:grid-cols-2">
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">
            Por que as {SIDE_NAME[side].toLowerCase()} erram
          </h3>
          <p className="text-xs text-muted-foreground">
            Média por previsão de {weeksText(weeks)}. Positivo: aconteceu mais
            do que se previa.
          </p>
          {causes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma diferença neste horizonte.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr className="border-b text-left">
                    <th scope="col" className={TH}>
                      Causa
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Lançamentos
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Diferença
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {causes.map((c) => (
                    <tr
                      key={c.cause}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-1.5">
                        {CAUSES[c.cause].label}
                        <span className="block text-xs text-muted-foreground">
                          {CAUSES[c.cause].hint}
                        </span>
                      </td>
                      <td className={cn(TD, "text-right font-financial")}>
                        {c.count.toLocaleString("pt-BR", {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                      <td className={cn(TD, "text-right font-financial")}>
                        {c.amount > 0 ? "+" : ""}
                        {fullMoney(c.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">
            Maiores diferenças da última previsão
          </h3>
          <p className="text-xs text-muted-foreground">
            {h.last
              ? `Feita em ${day(h.last.origin)}, para até ${day(h.last.end)}.`
              : "Ainda não há previsão vencida neste horizonte."}
          </p>
          {h.last && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada entre as maiores diferenças deste lado.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr className="border-b text-left">
                    <th scope="col" className={cn(TH, "w-full")}>
                      Lançamento
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Previsto
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Realizado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="w-full max-w-0 px-3 py-1.5">
                        <button
                          type="button"
                          disabled={opening !== null}
                          onClick={() => void open(i.id)}
                          className="group flex max-w-full items-center gap-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate">{i.description}</span>
                          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        </button>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[CAUSES[i.cause].label, i.party]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </td>
                      <td className={cn(TD, "text-right font-financial")}>
                        {i.forecast ? fullMoney(i.forecast) : "—"}
                      </td>
                      <td className={cn(TD, "text-right font-financial")}>
                        {i.actual ? fullMoney(i.actual) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Como se mede
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Previsão de uma segunda-feira: tudo que já estava lançado, em
            qualquer situação menos rejeitado, com o valor e o vencimento
            daquele dia, mais as recorrências que já rodavam. A pagar vencido
            conta; a receber vencido, não.
          </li>
          <li>
            Acerto: 100% menos a soma dos erros dividida pelo que aconteceu. Um
            erro para mais não compensa um erro para menos.
          </li>
          <li>
            O valor e o vencimento antigos vêm da auditoria. Lançamento excluído
            não deixa rastro e fica fora, então o índice é um pouco otimista.
          </li>
          <li>
            Partes de um recebimento dividido à mão contam como um lançamento
            só.
            {data.since && ` Medido desde ${day(data.since)}.`}
          </li>
        </ul>
      </details>
    </div>
  );
}
