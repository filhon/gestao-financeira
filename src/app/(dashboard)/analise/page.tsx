"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addMonths,
  endOfQuarter,
  format,
  startOfQuarter,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useAnalyticsReport, useCashAvailable } from "@/hooks/useAnalytics";
import { useBudgetProgress } from "@/hooks/useDashboardData";
import { hasMovement, type MonthRange } from "@/lib/analytics";
import type { DreRegime } from "@/lib/chartOfAccounts";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/features/dashboard/Segmented";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import { Section } from "@/components/features/analytics/primitives";
import { PositionSection } from "@/components/features/analytics/PositionSection";
import { TrendSection } from "@/components/features/analytics/TrendSection";
import { PlanSection } from "@/components/features/analytics/PlanSection";
import { CompositionSection } from "@/components/features/analytics/CompositionSection";
import { RiskSection } from "@/components/features/analytics/RiskSection";
import { InvestmentsSection } from "@/components/features/analytics/InvestmentsSection";
import { AttentionSection } from "@/components/features/analytics/AttentionSection";
import { ProjectionSection } from "@/components/features/analytics/ProjectionSection";

// ─── Período ──────────────────────────────────────────────────────────────────

type PeriodKey =
  | "month"
  | "last_month"
  | "quarter"
  | "year"
  | "last_year"
  | "last_12"
  | "custom";
type Compare = "none" | "previous" | "year";

const PERIOD_LABEL: Record<PeriodKey, string> = {
  month: "Este mês",
  last_month: "Mês anterior",
  quarter: "Este trimestre",
  year: "Este ano",
  last_year: "Ano anterior",
  last_12: "Últimos 12 meses",
  custom: "Personalizado",
};

const ym = (d: Date) => format(d, "yyyy-MM");
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Calculado na hora: a aba aberta na virada do mês não fica com o mês velho. */
function presetRange(key: Exclude<PeriodKey, "custom">): MonthRange {
  const today = new Date();
  const y = today.getFullYear();
  switch (key) {
    case "month":
      return { from: ym(today), to: ym(today) };
    case "last_month":
      return { from: ym(subMonths(today, 1)), to: ym(subMonths(today, 1)) };
    case "quarter":
      return { from: ym(startOfQuarter(today)), to: ym(endOfQuarter(today)) };
    case "year":
      return { from: `${y}-01`, to: `${y}-12` };
    case "last_year":
      return { from: `${y - 1}-01`, to: `${y - 1}-12` };
    case "last_12":
      return { from: ym(subMonths(today, 11)), to: ym(today) };
  }
}

/** "nov/2026", "2026", "jan/26 a mar/26". */
function rangeText(r: MonthRange) {
  const d = (key: string, pattern: string) =>
    format(new Date(`${key}-01T12:00:00`), pattern, { locale: ptBR });
  if (r.from === r.to) return d(r.from, "MMM/yyyy");
  if (
    r.from.endsWith("-01") &&
    r.to.endsWith("-12") &&
    r.from.slice(0, 4) === r.to.slice(0, 4)
  )
    return r.from.slice(0, 4);
  return `${d(r.from, "MMM/yy")} a ${d(r.to, "MMM/yy")}`;
}

const oneOf = <T extends string>(
  v: string | null,
  options: readonly T[],
  fallback: T,
): T => (options.includes(v as T) ? (v as T) : fallback);

// ─── Índice ───────────────────────────────────────────────────────────────────

const INDEX = [
  { id: "atencao", label: "O que pede atenção" },
  { id: "posicao", label: "Posição agora" },
  { id: "projecao", label: "Projeção" },
  { id: "resultado", label: "Resultado e tendência" },
  { id: "previsto", label: "Previsto e realizado" },
  { id: "orcamento", label: "Orçamento" },
  { id: "composicao", label: "Composição" },
  { id: "riscos", label: "Riscos" },
  { id: "aplicacoes", label: "Aplicações" },
];

function useActiveSection(ready: boolean) {
  const [active, setActive] = useState(INDEX[0].id);
  useEffect(() => {
    if (!ready) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    INDEX.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ready]);
  return active;
}

// ─── Página ───────────────────────────────────────────────────────────────────

/** useSearchParams exige Suspense para a página continuar pré-renderizada. */
export default function AnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsContent />
    </Suspense>
  );
}

function AnalyticsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { canViewAnalytics } = usePermissions();

  const period = oneOf<PeriodKey>(
    searchParams.get("periodo"),
    [
      "month",
      "last_month",
      "quarter",
      "year",
      "last_year",
      "last_12",
      "custom",
    ],
    "year",
  );
  const compare = oneOf<Compare>(
    searchParams.get("comparar"),
    ["none", "previous", "year"],
    "year",
  );
  const regime = oneOf<DreRegime>(
    searchParams.get("regime"),
    ["cash", "competence"],
    "cash",
  );
  const customFrom = searchParams.get("de") ?? "";
  const customTo = searchParams.get("ate") ?? "";
  const customValid =
    MONTH_RE.test(customFrom) &&
    MONTH_RE.test(customTo) &&
    customFrom <= customTo;
  const range: MonthRange =
    period === "custom" && customValid
      ? { from: customFrom, to: customTo }
      : presetRange(period === "custom" ? "year" : period);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/analise?${next}`, { scroll: false });
  };

  const query = useAnalyticsReport({ range, compare, regime });
  const report = query.data?.report;
  const meta = query.data?.meta;
  const active = useActiveSection(!!report);

  const exercise = Number(range.to.slice(0, 4));
  const budget = useBudgetProgress(exercise);
  const cash = useCashAvailable();
  const cashToday = {
    balance: cash.data?.balance ?? null,
    isLoading: cash.isLoading,
    isError: cash.isError,
  };

  if (user && selectedCompany && !canViewAnalytics) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-base font-medium">
          A Análise é da diretoria financeira
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Ela mostra a empresa inteira e fica disponível para administradores e
          gestores financeiros.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  const compareLabel =
    report?.compareRange && hasMovement(report.compareTotals)
      ? rangeText(report.compareRange)
      : null;
  const regimeText =
    regime === "cash" ? "regime de caixa" : "regime de competência";
  const leaves = (budget.data ?? []).filter((b) => b.isLeaf);
  const over = leaves.filter((b) => b.status === "danger").length;
  const fast = leaves.filter((b) => b.status === "warning").length;
  const budgetTitle =
    budget.data === undefined
      ? `Envelopes de ${exercise}`
      : over > 0
        ? `${over} ${over === 1 ? "centro de custo estourou" : "centros de custo estouraram"} o envelope de ${exercise}`
        : fast > 0
          ? `${fast} ${fast === 1 ? "centro de custo gasta" : "centros de custo gastam"} acima do ritmo do ano`
          : `Todos os centros de custo dentro do envelope de ${exercise}`;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Cabeçalho e filtros ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Análise
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {selectedCompany?.name ? `${selectedCompany.name} · ` : ""}
            {rangeText(range)} · {regimeText}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {query.isFetching
              ? "Recalculando…"
              : meta
                ? `Calculado às ${format(new Date(meta.generatedAt), "HH:mm")}`
                : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => query.refresh()}
            disabled={query.isFetching}
          >
            <RefreshCcw
              className={cn(
                "mr-1.5 h-3.5 w-3.5",
                query.isFetching && "animate-spin",
              )}
              aria-hidden
            />
            Atualizar
          </Button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtros da análise"
      >
        <Select
          value={period}
          onValueChange={(v) => {
            const p = v as PeriodKey;
            setParams(
              p === "custom"
                ? { periodo: p, de: range.from, ate: range.to }
                : { periodo: p, de: null, ate: null },
            );
          }}
        >
          <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {PERIOD_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <label className="sr-only" htmlFor="analise-de">
              Primeiro mês
            </label>
            <input
              id="analise-de"
              type="month"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) =>
                e.target.value && setParams({ de: e.target.value })
              }
              className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
            />
            a
            <label className="sr-only" htmlFor="analise-ate">
              Último mês
            </label>
            <input
              id="analise-ate"
              type="month"
              value={customTo}
              min={customFrom || undefined}
              max={ym(
                addMonths(
                  new Date(`${customFrom || ym(new Date())}-01T12:00:00`),
                  35,
                ),
              )}
              onChange={(e) =>
                e.target.value && setParams({ ate: e.target.value })
              }
              className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
            />
          </div>
        )}
        <Select
          value={compare}
          onValueChange={(v) => setParams({ comparar: v })}
        >
          <SelectTrigger
            className="h-8 w-[230px] text-xs"
            aria-label="Comparar com"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="year">Comparar com o ano anterior</SelectItem>
            <SelectItem value="previous">
              Comparar com o período anterior
            </SelectItem>
            <SelectItem value="none">Sem comparação</SelectItem>
          </SelectContent>
        </Select>
        <Segmented
          label="Regime"
          value={regime}
          onChange={(v) => setParams({ regime: v })}
          options={[
            { value: "cash", label: "Caixa" },
            { value: "competence", label: "Competência" },
          ]}
        />
      </div>
      {period === "custom" && !customValid && (
        <p className="text-xs text-muted-foreground">
          Escolha o primeiro e o último mês; enquanto isso, a análise mostra
          este ano.
        </p>
      )}

      {/* ── Conteúdo ────────────────────────────────────────────────── */}
      {query.isError && !report ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">
              Não foi possível montar a análise
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {(query.error as Error)?.message ?? "Tente novamente."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => query.refetch()}
          >
            <RefreshCcw className="mr-1.5 h-3 w-3" aria-hidden />
            Tentar novamente
          </Button>
        </div>
      ) : !report ? (
        <div
          className="space-y-8"
          aria-busy="true"
          aria-label="Carregando a análise"
        >
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : meta?.transactionCount === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Ainda não há lançamentos</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            A análise se forma com as contas a pagar e a receber. Lance as
            primeiras em Contas a Pagar ou Contas a Receber.
          </p>
        </div>
      ) : (
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_176px] xl:gap-10">
          <div
            className={cn(
              "flex min-w-0 flex-col gap-10 transition-opacity",
              query.isPlaceholderData && "opacity-60",
            )}
          >
            {query.isError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />A última
                atualização falhou; os números abaixo são da anterior.
              </p>
            )}
            {report.compareRange && !compareLabel && (
              <p className="text-xs text-muted-foreground">
                Nenhum lançamento em {rangeText(report.compareRange)}: a
                comparação fica de fora.
              </p>
            )}
            {meta?.capped && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />A empresa
                passou do limite de lançamentos lidos de uma vez; os mais
                antigos podem ter ficado de fora.
              </p>
            )}
            <AttentionSection
              report={report}
              periodLabel={rangeText(report.range)}
              // Sem orçamento legível, a regra dos envelopes fica de fora.
              envelopes={budget.isError ? [] : (budget.data ?? null)}
              exercise={exercise}
              cash={cashToday}
            />
            <PositionSection report={report} compareLabel={compareLabel} />
            <ProjectionSection report={report} cash={cashToday} />
            <TrendSection report={report} compareLabel={compareLabel} />
            <PlanSection report={report} />
            <Section
              id="orcamento"
              kicker="Orçamento por centro de custo"
              title={budgetTitle}
              description="Envelope anual de cada centro contra o comprometido e o pago, com o ritmo esperado para a data. Mesmo cálculo de Centros de Custo."
            >
              <CostCenterChart year={exercise} />
            </Section>
            <CompositionSection report={report} />
            <RiskSection
              report={report}
              onAnchorChange={() => query.refresh()}
            />
            <InvestmentsSection />
          </div>

          <nav aria-label="Seções da análise" className="hidden xl:block">
            <ol className="sticky top-20 space-y-0.5 text-sm">
              {INDEX.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={active === s.id ? "location" : undefined}
                    className={cn(
                      "block rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active === s.id
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      )}
    </div>
  );
}
