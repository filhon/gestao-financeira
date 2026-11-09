"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  CircleCheck,
  OctagonAlert,
} from "lucide-react";
import {
  ATTENTION,
  buildAttention,
  horizonEnd,
  projectBalance,
  type AnalyticsReport,
  type EnvelopeLeaf,
  type ForecastStage,
} from "@/lib/analytics";
import { DEFAULT_FORECAST } from "@/lib/reports";
import type { CashToday } from "./ProjectionSection";
import { cn } from "@/lib/utils";

/**
 * Abre a página: o que passou de algum limite, numa frase cada, com o link
 * para a seção que explica. Regras em `buildAttention`, sem IA.
 */
export function AttentionSection({
  report,
  periodLabel,
  envelopes,
  exercise,
  cash,
}: {
  report: AnalyticsReport;
  cash: CashToday;
  periodLabel: string;
  envelopes: EnvelopeLeaf[] | null;
  exercise: number;
}) {
  const opening = cash.balance;
  // A projeção dos destaques é fixa (estágios padrão, 12 meses, sem
  // simulação): mexer na seção de projeção não muda o topo da página.
  const items = useMemo(
    () =>
      buildAttention({
        report,
        periodLabel,
        envelopes,
        exercise,
        projection:
          opening === null
            ? null
            : projectBalance({
                days: report.projection,
                opening,
                stages: DEFAULT_FORECAST as ForecastStage[],
                from: report.today,
                until: horizonEnd(report.today, ATTENTION.projectionMonths),
              }),
      }),
    [report, periodLabel, envelopes, exercise, opening],
  );
  const pending = cash.isLoading || envelopes === null;

  return (
    <section
      id="atencao"
      aria-labelledby="atencao-title"
      className="scroll-mt-24"
    >
      <h2
        id="atencao-title"
        className="flex items-baseline gap-2 text-sm font-semibold"
      >
        O que pede atenção
        {items.length > 0 && (
          <span className="font-financial text-xs font-normal text-muted-foreground">
            {items.length}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
          <CircleCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          {pending
            ? "Conferindo caixa projetado e envelopes…"
            : `Nada passou dos limites: caixa projetado em ${ATTENTION.projectionMonths} meses, envelopes, previsto, recebíveis antigos e concentração.`}
        </p>
      ) : (
        <ol className="mt-2 divide-y border-t">
          {items.map((item) => {
            const Icon = item.tone === "danger" ? OctagonAlert : AlertTriangle;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.section}`}
                  className="group grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-1 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <Icon
                    aria-label={item.tone === "danger" ? "Crítico" : "Atenção"}
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      item.tone === "danger"
                        ? "text-destructive"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  />
                  <span className="text-sm text-pretty">{item.text}</span>
                  <span className="col-start-2 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground sm:col-start-3 sm:mt-0.5">
                    {item.sectionLabel}
                    <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
      {pending && items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          Conferindo caixa projetado e envelopes…
        </p>
      )}
    </section>
  );
}
