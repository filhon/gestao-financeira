"use client";

import { formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, DollarSign, Wallet } from "lucide-react";
import { DashboardMetrics } from "@/lib/services/dashboardService";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface KPICardsProps {
  metrics: DashboardMetrics;
}

export function KPICards({ metrics }: KPICardsProps) {
  const forecastBalance =
    metrics.balance + metrics.shortTermReceivables - metrics.shortTermPayables;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-4 md:divide-y-0">
        {/* Receita Total */}
        <div className="flex items-start gap-2 sm:gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500 mt-0.5">
            <ArrowUpIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground leading-none mb-1.5">
              Receita Total
            </p>
            <div className="text-lg font-bold font-financial leading-none text-emerald-600 dark:text-emerald-400">
              <span className="md:hidden">
                <AnimatedCounter
                  value={metrics.totalRevenue}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              <span className="hidden md:inline">
                <AnimatedCounter
                  value={metrics.totalRevenue}
                  formatter={formatCurrency}
                />
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-financial mt-1.5">
              +
              <AnimatedCounter
                value={metrics.pendingReceivables}
                formatter={formatCurrencyAbbr}
              />{" "}
              a receber
            </p>
          </div>
        </div>

        {/* Despesas Totais */}
        <div className="flex items-start gap-2 sm:gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-500 mt-0.5">
            <ArrowDownIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground leading-none mb-1.5">
              Despesas Totais
            </p>
            <div className="text-lg font-bold font-financial leading-none text-red-600 dark:text-red-400">
              <span className="md:hidden">
                <AnimatedCounter
                  value={metrics.totalExpenses}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              <span className="hidden md:inline">
                <AnimatedCounter
                  value={metrics.totalExpenses}
                  formatter={formatCurrency}
                />
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-financial mt-1.5">
              +
              <AnimatedCounter
                value={metrics.pendingPayables}
                formatter={formatCurrencyAbbr}
              />{" "}
              a pagar
            </p>
          </div>
        </div>

        {/* Saldo Realizado */}
        <div className="flex items-start gap-2 sm:gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary mt-0.5">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground leading-none mb-1.5">
              Saldo Realizado
            </p>
            <div
              className={`text-lg font-bold font-financial leading-none ${metrics.balance >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}`}
            >
              <span className="md:hidden">
                <AnimatedCounter
                  value={metrics.balance}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              <span className="hidden md:inline">
                <AnimatedCounter
                  value={metrics.balance}
                  formatter={formatCurrency}
                />
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Receitas &minus; Despesas pagas
            </p>
          </div>
        </div>

        {/* Previsão 30 dias */}
        <div className="flex items-start gap-2 sm:gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary mt-0.5">
            <DollarSign className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground leading-none mb-1.5">
              Previsão 30 dias
            </p>
            <div
              className={`text-lg font-bold font-financial leading-none ${forecastBalance >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}`}
            >
              <span className="md:hidden">
                <AnimatedCounter
                  value={forecastBalance}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              <span className="hidden md:inline">
                <AnimatedCounter
                  value={forecastBalance}
                  formatter={formatCurrency}
                />
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-financial mt-1.5">
              <span className="text-emerald-600">
                +
                <AnimatedCounter
                  value={metrics.shortTermReceivables}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              {" / "}
              <span className="text-red-600">
                &minus;
                <AnimatedCounter
                  value={metrics.shortTermPayables}
                  formatter={formatCurrencyAbbr}
                />
              </span>
              {" venc. 30d"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
