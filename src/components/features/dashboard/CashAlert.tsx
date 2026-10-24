"use client";

import Link from "next/link";
import currency from "currency.js";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
import { CircleHelp, RefreshCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ProjectedCashFlowData,
  ProjectedCashFlowResult,
  QueueSection,
} from "@/lib/services/dashboardService";
import {
  coveringCounterparts,
  groupByCounterpart,
  negativeRuns,
  type NegativeRun,
} from "@/lib/dashboardRules";
import { formatCurrencyAbbr } from "@/lib/utils";

const link =
  "rounded text-xs font-semibold text-red-700 underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-red-400";

function dayWord(isoDate: string) {
  const today = format(startOfDay(new Date()), "yyyy-MM-dd");
  const tomorrow = format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd");
  if (isoDate === today) return "hoje";
  if (isoDate === tomorrow) return "amanhã";
  return format(new Date(`${isoDate}T00:00:00`), "dd/MM");
}

function runText(r: NegativeRun<ProjectedCashFlowData>) {
  const start = dayWord(r.start.isoDate);
  if (r.start === r.end)
    return start === "hoje" || start === "amanhã" ? start : `em ${start}`;
  if (r.open) return `a partir de ${start}`;
  return `de ${start} a ${dayWord(r.end.isoDate)}`;
}

const days = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/**
 * O alerta de saldo diz quando, quanto e o que resolve, em três linhas:
 * os trechos negativos; o pior saldo e a entrada de que ele depende; quem em
 * atraso cobre o buraco (mais recentes primeiro) e a saída que o abre.
 * Fica junto da fila porque a resposta dele está nela.
 */
export function CashAlert({
  projection,
  projectionFailed,
  onRetry,
  receivables,
  relatedPartyIds,
}: {
  projection: ProjectedCashFlowResult | null | undefined;
  projectionFailed: boolean;
  onRetry: () => void;
  receivables?: QueueSection;
  relatedPartyIds: Set<string>;
}) {
  const points = projection?.data ?? [];

  if (projectionFailed || (projection && points.length === 0)) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <CircleHelp className="h-4 w-4 shrink-0" />
        Não foi possível avaliar o saldo dos próximos 30 dias.
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onRetry}
        >
          <RefreshCcw className="mr-1 h-3 w-3" />
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!projection) return null;
  if (!projection.hasCompanyStats) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleHelp className="h-4 w-4 shrink-0" />
        Saldo não avaliado: o saldo base ainda não foi calculado.
      </p>
    );
  }

  const runs = negativeRuns(points);
  if (runs.length === 0) return null;

  const worstRun = runs.reduce((w, r) =>
    r.lowest.balance < w.lowest.balance ? r : w,
  );
  const worst = worstRun.lowest;
  const deficit = -worst.balance;
  const nearest = runs[0] !== worstRun ? runs[0].lowest : null;

  // A entrada grande antes do pior ponto, sem a qual ele seria mais fundo.
  const inflow = points
    .filter((p) => p.isoDate < worst.isoDate && p.income >= deficit)
    .reduce<
      ProjectedCashFlowData | undefined
    >((m, p) => (!m || p.income > m.income ? p : m), undefined);
  const withoutInflow =
    inflow &&
    Math.min(
      ...points.map((p) =>
        p.isoDate >= inflow.isoDate
          ? currency(p.balance).subtract(inflow.income).value
          : p.balance,
      ),
    );

  // O dia em que o trecho do pior saldo começa e quanto sai nele.
  const trigger = worstRun.start.expense > 0 ? worstRun.start : null;

  const groups = receivables ? groupByCounterpart(receivables.items) : [];
  const cover = coveringCounterparts(groups, deficit);
  const partial = !!receivables && receivables.items.length < receivables.count;
  const today = startOfDay(new Date());

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between dark:border-red-900 dark:bg-red-950/30">
      <div className="flex min-w-0 gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
        <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground font-financial">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 font-sans">
            Saldo previsto negativo {runs.map(runText).join(" e ")}
          </p>
          <p>
            Pior: {formatCurrencyAbbr(worst.balance)} em {worst.date}
            {nearest &&
              ` · antes disso, ${formatCurrencyAbbr(nearest.balance)} em ${nearest.date}`}
            {inflow &&
              withoutInflow !== undefined &&
              ` · depende de ${formatCurrencyAbbr(inflow.income)} previstos para ${inflow.date} (sem eles, ${formatCurrencyAbbr(withoutInflow)})`}
          </p>
          {(cover || trigger || (receivables && receivables.total > 0)) && (
            <p className="flex min-w-0 flex-wrap gap-x-1">
              {cover ? (
                <>
                  <span>Cobre:</span>
                  {cover.map((g, i) => (
                    <span
                      key={g.key}
                      className="inline-flex min-w-0 max-w-full"
                    >
                      <span className="truncate" title={g.name}>
                        {formatCurrencyAbbr(g.total)} de {g.name}
                      </span>
                      <span className="shrink-0 whitespace-pre">
                        {` (há ${days(differenceInCalendarDays(today, g.oldest))}${relatedPartyIds.has(g.key) ? ", parte relacionada" : ""})`}
                        {i < cover.length - 1 ? "," : ""}
                      </span>
                    </span>
                  ))}
                </>
              ) : receivables && receivables.total >= deficit && partial ? (
                <span>
                  Os {formatCurrencyAbbr(receivables.total)} em atraso
                  cobririam; veja quem deve na lista.
                </span>
              ) : receivables && receivables.total > 0 ? (
                <span>
                  Os {formatCurrencyAbbr(receivables.total)} em atraso não
                  bastam.
                </span>
              ) : null}
              {trigger && (
                <span>
                  · em {trigger.date} saem {formatCurrencyAbbr(trigger.expense)}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-4 sm:pt-0.5">
        {receivables && receivables.total > 0 && (
          <Link href={receivables.href} className={link}>
            Ver em atraso
          </Link>
        )}
        <Link href="#fluxo-caixa" className={link}>
          Ver fluxo de caixa
        </Link>
      </div>
    </div>
  );
}
