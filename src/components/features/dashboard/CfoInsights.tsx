"use client";

import { useMemo } from "react";
import { DashboardMetrics } from "@/lib/services/dashboardService";
import { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import {
  AlertTriangle,
  BadgeDollarSign,
  ShieldAlert,
  TrendingDown,
  Zap,
} from "lucide-react";
import Link from "next/link";

// ─── Insight type ─────────────────────────────────────────────────────────────
type InsightSeverity = "critical" | "warning" | "info";

interface Insight {
  id: string;
  severity: InsightSeverity;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta?: { label: string; href: string };
}

// ─── Style maps ──────────────────────────────────────────────────────────────
const severityStyles: Record<
  InsightSeverity,
  { bar: string; bg: string; title: string; icon: string; badge: string }
> = {
  critical: {
    bar: "bg-red-500",
    bg: "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900",
    title: "text-red-700 dark:text-red-400",
    icon: "text-red-500",
    badge: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300",
  },
  warning: {
    bar: "bg-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900",
    title: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500",
    badge:
      "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  },
  info: {
    bar: "bg-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900",
    title: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-500",
    badge: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
  },
};

const severityLabel: Record<InsightSeverity, string> = {
  critical: "Crítico",
  warning: "Atenção",
  info: "Info",
};

// ─── Rule engine ─────────────────────────────────────────────────────────────
function buildInsights(
  metrics: DashboardMetrics,
  overdueTransactions: Transaction[],
): Insight[] {
  const insights: Insight[] = [];

  const {
    balance,
    pendingPayables,
    pendingReceivables,
    shortTermPayables,
    shortTermReceivables,
  } = metrics;

  // ── Rule 1 — Overdue transactions (interest risk) ──
  if (overdueTransactions.length > 0) {
    const totalOverdue = overdueTransactions.reduce(
      (sum, t) => sum + t.amount,
      0,
    );
    insights.push({
      id: "overdue-interest-risk",
      severity: overdueTransactions.length >= 5 ? "critical" : "warning",
      icon: <BadgeDollarSign className="h-4 w-4" />,
      title: `${overdueTransactions.length} conta${overdueTransactions.length > 1 ? "s" : ""} em atraso — risco de juros e multas`,
      description: `Total vencido de ${formatCurrency(totalOverdue)}. Cada dia adicional pode gerar encargos sobre o principal. Regularize o mais rápido possível para evitar negativação e aumento do passivo.`,
      cta: {
        label: "Ver contas em atraso",
        href: "/financeiro/contas-pagar?status=overdue",
      },
    });
  }

  // ── Rule 2 — Cash break risk ──
  // SE pendingPayables > (balance + pendingReceivables) → ruptura de caixa
  const projectedAvailable = balance + pendingReceivables;
  if (pendingPayables > projectedAvailable) {
    const gap = pendingPayables - projectedAvailable;
    insights.push({
      id: "cash-break-risk",
      severity: "critical",
      icon: <ShieldAlert className="h-4 w-4" />,
      title: "Risco de ruptura de caixa detectado",
      description: `As obrigações pendentes (${formatCurrency(pendingPayables)}) superam o saldo disponível mais os recebíveis esperados (${formatCurrency(projectedAvailable)}). Há um déficit projetado de ${formatCurrency(gap)}. Avalie antecipação de recebíveis ou renegociação de prazos.`,
      cta: {
        label: "Ver contas a pagar",
        href: "/financeiro/contas-pagar",
      },
    });
  }

  // ── Rule 3 — Short-term pressure (30 days) ──
  // Payables nos próximos 30 dias excedem receivables no mesmo período
  if (shortTermPayables > shortTermReceivables && shortTermPayables > 0) {
    const shortfall = shortTermPayables - shortTermReceivables;
    insights.push({
      id: "short-term-pressure",
      severity: "warning",
      icon: <TrendingDown className="h-4 w-4" />,
      title: "Pressão de caixa nos próximos 30 dias",
      description: `Saídas previstas (${formatCurrency(shortTermPayables)}) superam entradas (${formatCurrency(shortTermReceivables)}) no curto prazo — déficit de ${formatCurrency(shortfall)}. Monitore o fluxo de caixa projetado para evitar surpresas.`,
      cta: {
        label: "Ver fluxo de caixa",
        href: "/financeiro",
      },
    });
  }

  // ── Rule 4 — Healthy state ──
  if (insights.length === 0) {
    insights.push({
      id: "healthy",
      severity: "info",
      icon: <Zap className="h-4 w-4" />,
      title: "Caixa saudável",
      description:
        "Nenhum risco financeiro imediato identificado. Continue monitorando seus indicadores regularmente.",
    });
  }

  // Sort: critical first, then warning, then info
  const order: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ─── Component ────────────────────────────────────────────────────────────────
interface CfoInsightsProps {
  metrics: DashboardMetrics;
  overdueTransactions: Transaction[];
}

export function CfoInsights({
  metrics,
  overdueTransactions,
}: CfoInsightsProps) {
  const insights = useMemo(
    () => buildInsights(metrics, overdueTransactions),
    [metrics, overdueTransactions],
  );

  return (
    <section aria-label="Análise CFO" className="space-y-2">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Análise de Riscos
        </h2>
      </div>

      {/* Insights list */}
      <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => {
          const styles = severityStyles[insight.severity];
          return (
            <div
              key={insight.id}
              className={`relative flex gap-3 rounded-xl px-4 py-3.5 overflow-hidden ${styles.bg}`}
            >
              {/* Left accent bar */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${styles.bar}`}
              />

              {/* Icon */}
              <div className={`mt-0.5 shrink-0 ${styles.icon}`}>
                {insight.icon}
              </div>

              {/* Content */}
              <div className="flex flex-col gap-1 min-w-0">
                {/* Badge + title */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles.badge}`}
                  >
                    {severityLabel[insight.severity]}
                  </span>
                  <p
                    className={`text-xs font-semibold leading-snug ${styles.title}`}
                  >
                    {insight.title}
                  </p>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {insight.description}
                </p>

                {/* CTA */}
                {insight.cta && (
                  <Link
                    href={insight.cta.href}
                    className={`mt-1 self-start text-[11px] font-semibold underline underline-offset-2 ${styles.title} hover:opacity-80 transition-opacity`}
                  >
                    {insight.cta.label} →
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
