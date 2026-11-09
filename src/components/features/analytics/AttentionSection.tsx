"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  CircleCheck,
  OctagonAlert,
} from "lucide-react";
import {
  ATTENTION,
  attentionProjection,
  buildAttention,
  type AnalyticsReport,
  type AttentionItem,
  type EnvelopeLeaf,
} from "@/lib/analytics";
import {
  analyticsService,
  type AnalyticsParams,
} from "@/lib/services/analyticsService";
import { useCompany } from "@/components/providers/CompanyProvider";
import type { CashToday } from "./ProjectionSection";
import { cn } from "@/lib/utils";

export type AiAttentionItem = AttentionItem & { ai: boolean };

/** Destaques redigidos pela IA; a tela e o PDF usam a mesma chave de cache. */
export const attentionAiQuery = (o: {
  companyId: string | undefined;
  params: AnalyticsParams;
  items: AttentionItem[];
  cash: number | null;
  envelopes: EnvelopeLeaf[] | null;
}) => ({
  queryKey: [
    "analytics-ai-attention",
    o.companyId,
    o.params.range.from,
    o.params.range.to,
    o.params.compare,
    o.params.regime,
    o.items.map((i) => i.text).join("|"),
  ],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    analyticsService.ai<{ items: AiAttentionItem[] }>(
      o.companyId!,
      o.params,
      { kind: "attention", cash: o.cash, envelopes: o.envelopes },
      signal,
    ),
  staleTime: Infinity,
  retry: false,
});

/**
 * Abre a página: o que passou de algum limite, numa frase cada, com o link
 * para a seção que explica. As regras de `buildAttention` decidem o que entra;
 * a IA só redige, e cada destaque redigido é conferido no servidor contra o
 * texto de modelo. Até a IA responder (ou se ela falhar), fica o modelo.
 */
export function AttentionSection({
  report,
  params,
  periodLabel,
  envelopes,
  exercise,
  cash,
}: {
  report: AnalyticsReport;
  params: AnalyticsParams;
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
        projection: attentionProjection(report, opening),
      }),
    [report, periodLabel, envelopes, exercise, opening],
  );
  const pending = cash.isLoading || envelopes === null;

  const companyId = useCompany().selectedCompany?.id;
  const written = useQuery({
    ...attentionAiQuery({
      companyId,
      params,
      items,
      cash: opening,
      envelopes,
    }),
    enabled: !!companyId && !pending && items.length > 0,
  });
  const shown = items.map((item) => {
    const ai = written.data?.items.find((w) => w.id === item.id && w.ai);
    return ai ? { ...item, text: ai.text, ai: true } : { ...item, ai: false };
  });
  const anyAi = shown.some((i) => i.ai);

  return (
    <section
      id="atencao"
      aria-labelledby="atencao-title"
      className="scroll-mt-24"
    >
      <h2
        id="atencao-title"
        className="flex items-baseline gap-2 text-lg font-semibold tracking-tight md:text-xl"
      >
        O que pede atenção
        {items.length > 0 && (
          <span className="font-financial text-sm font-normal text-muted-foreground">
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
        <ol className="mt-3 divide-y border-t">
          {shown.map((item) => {
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
      {items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {pending
            ? "Conferindo caixa projetado e envelopes…"
            : written.isFetching
              ? "Redigindo os destaques…"
              : anyAi
                ? "Redigido pela IA e conferido com os números do relatório."
                : null}
        </p>
      )}
    </section>
  );
}
