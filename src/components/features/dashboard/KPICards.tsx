"use client";

import Link from "next/link";
import { parseISO, format } from "date-fns";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import {
  DashboardMetrics,
  ProjectedCashFlowResult,
} from "@/lib/services/dashboardService";
import { Skeleton } from "@/components/ui/skeleton";

interface KPICardsProps {
  metrics: DashboardMetrics;
  /** Projeção de 30 dias: a mesma série do gráfico de fluxo de caixa. */
  projection?: ProjectedCashFlowResult | null;
  projectionLoading: boolean;
}

function Money({ value }: { value: number }) {
  return (
    <>
      <span className="md:hidden">{formatCurrencyAbbr(value)}</span>
      <span className="hidden md:inline">{formatCurrency(value)}</span>
    </>
  );
}

function Kpi({
  label,
  href,
  value,
  className,
  children,
}: {
  label: string;
  href: string;
  value: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block bg-card px-4 py-3 sm:px-5 sm:py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground leading-none">{label}</p>
      <div className="mt-2 text-lg font-semibold font-financial leading-none">
        {value}
      </div>
      {children && (
        <div className="mt-2 space-y-0.5 text-xs leading-snug text-muted-foreground font-financial">
          {children}
        </div>
      )}
    </Link>
  );
}

/** "▲ 12,3% vs mesmo período de 2025". Seta e texto, sem depender de cor. */
function Delta({
  current,
  previous,
  previousYear,
  partial,
}: {
  current: number;
  previous: number;
  previousYear: number;
  partial: boolean;
}) {
  const base = partial ? `mesmo período de ${previousYear}` : previousYear;
  // Sem base de comparação não há o que dizer: a linha some.
  if (!previous) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return (
    <p>
      {pct >= 0 ? "▲" : "▼"}{" "}
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs{" "}
      {base}
    </p>
  );
}

export function KPICards({
  metrics,
  projection,
  projectionLoading,
}: KPICardsProps) {
  const { year } = metrics;
  const points = projection?.data ?? [];
  const last = points.at(-1);
  const lowest = points.reduce<(typeof points)[number] | undefined>(
    (min, p) => (!min || p.balance < min.balance ? p : min),
    undefined,
  );
  const range = `de=${year}-01-01&ate=${year}-12-31`;
  const negative = (v: number) => (v < 0 ? "text-destructive" : undefined);
  // Sem baixas de outros anos, o saldo pelas baixas é o próprio resultado do
  // exercício.
  const cashIsResult = Math.abs(metrics.cashBalance - metrics.result) < 0.005;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      <Kpi
        label="Saldo pelas baixas"
        href="/financeiro/conciliacao"
        value={
          <span className={negative(metrics.cashBalance)}>
            <Money value={metrics.cashBalance} />
          </span>
        }
      >
        {!metrics.hasCompanyStats ? (
          <p className="text-amber-700 dark:text-amber-400">
            Saldo base não calculado
          </p>
        ) : cashIsResult ? (
          // Saldo igual ao resultado do ano = o sistema não conhece o que
          // havia no banco antes. Dizer isso vale mais que repetir o número.
          <p className="text-amber-700 dark:text-amber-400">
            Só baixas registradas · sem saldo de abertura
          </p>
        ) : (
          <p>
            Resultado de {year}: {formatCurrencyAbbr(metrics.result)}
          </p>
        )}
      </Kpi>

      <Kpi
        label={
          last
            ? `Saldo previsto em ${format(parseISO(last.isoDate), "dd/MM")}`
            : "Saldo previsto em 30 dias"
        }
        href="#fluxo-caixa"
        value={
          projectionLoading ? (
            <Skeleton className="h-[18px] w-32" />
          ) : last ? (
            <span className={negative(last.balance)}>
              <Money value={last.balance} />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Sem dados</span>
          )
        }
      >
        {projection?.bankBase && (
          <p>
            Contas correntes desde o extrato de{" "}
            {format(projection.bankBase.asOf, "dd/MM")} · sem aplicações
          </p>
        )}
        {lowest && lowest.balance < last!.balance && (
          <p className={negative(lowest.balance)}>
            Menor: {formatCurrencyAbbr(lowest.balance)} em {lowest.date}
          </p>
        )}
        {projection && projection.overdueIncome > 0 && (
          <p>
            Exclui {formatCurrencyAbbr(projection.overdueIncome)} a receber em
            atraso
          </p>
        )}
        {projection && projection.overdueExpense > 0 && (
          <p>
            Inclui {formatCurrencyAbbr(projection.overdueExpense)} a pagar em
            atraso
          </p>
        )}
      </Kpi>

      <Kpi
        label={`Recebido em ${year}`}
        href={`/financeiro/contas-receber?tab=paid&${range}`}
        value={<Money value={metrics.totalRevenue} />}
      >
        <Delta
          current={metrics.totalRevenue}
          previous={metrics.previousRevenue}
          previousYear={year - 1}
          partial={metrics.comparisonIsPartial}
        />
        <p>
          {formatCurrencyAbbr(metrics.pendingReceivables)} a receber no
          exercício
        </p>
      </Kpi>

      <Kpi
        label={`Pago em ${year}`}
        href={`/financeiro/contas-pagar?tab=paid&${range}`}
        value={<Money value={metrics.totalExpenses} />}
      >
        <Delta
          current={metrics.totalExpenses}
          previous={metrics.previousExpenses}
          previousYear={year - 1}
          partial={metrics.comparisonIsPartial}
        />
        <p>
          {formatCurrencyAbbr(metrics.pendingPayables)} a pagar no exercício
        </p>
      </Kpi>
    </div>
  );
}
