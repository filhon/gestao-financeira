"use client";

import { useState, useMemo } from "react";
import {
  AlertCircle,
  Clock,
  ArrowRight,
  RefreshCcw,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { CfoInsights } from "@/components/features/dashboard/CfoInsights";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useDashboardMetrics,
  useOverdueTransactions,
  usePendingApprovals,
} from "@/hooks/useDashboardData";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@/lib/types";

// ─── Skeleton helpers ─────────────────────────────────────────────────────────

function KPICardsSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-3 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

function ActionCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-44 mb-1.5" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section-level error ──────────────────────────────────────────────────────

function SectionError({
  onRetry,
  label,
}: {
  onRetry: () => void;
  label: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Falha ao carregar {label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verifique sua conexão e tente novamente.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 text-xs"
        >
          <RefreshCcw className="mr-1.5 h-3 w-3" />
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Overdue card ─────────────────────────────────────────────────────────────

function OverdueCard({ transactions }: { transactions: Transaction[] }) {
  const hasItems = transactions.length > 0;

  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base md:text-lg flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            Contas em Atraso
            {hasItems && (
              <span className="relative inline-flex">
                {/* Pulsing urgency ring */}
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-50" />
                <span className="relative inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">
                  {transactions.length}
                </span>
              </span>
            )}
          </CardTitle>
          <Link href="/financeiro/contas-pagar?status=overdue">
            <Button variant="ghost" size="sm" className="h-8 text-xs">
              Ver todas <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </div>
        <CardDescription>
          Pagamentos vencidos que requerem atenção imediata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {!hasItems ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              Nenhuma conta em atraso.
            </div>
          ) : (
            transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="space-y-1 min-w-0 pr-2">
                  <p className="text-sm font-medium leading-none truncate">
                    {t.description}
                  </p>
                  <p className="text-xs text-red-500 font-medium">
                    Venceu em {format(t.dueDate, "dd/MM/yyyy")}
                  </p>
                </div>
                <div className="font-bold font-financial text-red-600 shrink-0">
                  {formatCurrency(t.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pending approvals card ───────────────────────────────────────────────────

function PendingCard({ transactions }: { transactions: Transaction[] }) {
  const hasItems = transactions.length > 0;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base md:text-lg flex items-center gap-2 text-amber-600">
            <Clock className="h-5 w-5" />
            Pendentes de Aprovação
            {hasItems && (
              <span className="inline-flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-[10px] font-bold min-w-[18px] h-[18px] px-1">
                {transactions.length}
              </span>
            )}
          </CardTitle>
          <Link href="/financeiro/contas-pagar?status=pending_approval">
            <Button variant="ghost" size="sm" className="h-8 text-xs">
              Ver todas <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </div>
        <CardDescription>
          Transações aguardando sua aprovação ou do time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {!hasItems ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              Nenhuma pendência de aprovação.
            </div>
          ) : (
            transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="space-y-1 min-w-0 pr-2">
                  <p className="text-sm font-medium leading-none truncate">
                    {t.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.supplierOrClient} • {format(t.dueDate, "dd/MM/yyyy")}
                  </p>
                </div>
                <div className="font-medium font-financial text-amber-600 shrink-0">
                  {formatCurrency(t.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const {
    data: metrics,
    isLoading: isMetricsLoading,
    isError: isMetricsError,
    refetch: refetchMetrics,
  } = useDashboardMetrics(selectedYear);

  const {
    data: overdueTransactions,
    isLoading: isOverdueLoading,
    isError: isOverdueError,
    refetch: refetchOverdue,
  } = useOverdueTransactions();

  const {
    data: pendingApprovals,
    isLoading: isPendingLoading,
    isError: isPendingError,
    refetch: refetchPending,
  } = usePendingApprovals();

  const queryClient = useQueryClient();

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const todayLabel = useMemo(
    () => format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
    [],
  );

  const isRefreshing = isMetricsLoading || isOverdueLoading || isPendingLoading;

  function handleRefreshAll() {
    queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["overdue-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Dashboard Financeiro
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {todayLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            title="Atualizar todos os dados"
          >
            <RefreshCcw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section aria-label="Indicadores principais">
        {isMetricsLoading ? (
          <KPICardsSkeleton />
        ) : isMetricsError ? (
          <SectionError
            onRetry={() => refetchMetrics()}
            label="métricas financeiras"
          />
        ) : (
          metrics && <KPICards metrics={metrics} />
        )}
      </section>

      {/* ── CFO Insights ───────────────────────────────────────────── */}
      <section aria-label="Análise de riscos">
        {isMetricsLoading || isOverdueLoading ? (
          <InsightsSkeleton />
        ) : isMetricsError ? null : (
          metrics && (
            <CfoInsights
              metrics={metrics}
              overdueTransactions={overdueTransactions ?? []}
            />
          )
        )}
      </section>

      {/* ── Charts ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-7">
        <CashFlowChart year={selectedYear} />
        <CostCenterChart year={selectedYear} />
      </div>

      {/* ── Action Cards ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {isOverdueLoading ? (
          <ActionCardSkeleton />
        ) : isOverdueError ? (
          <SectionError
            onRetry={() => refetchOverdue()}
            label="contas em atraso"
          />
        ) : (
          <OverdueCard transactions={overdueTransactions ?? []} />
        )}

        {isPendingLoading ? (
          <ActionCardSkeleton />
        ) : isPendingError ? (
          <SectionError
            onRetry={() => refetchPending()}
            label="pendências de aprovação"
          />
        ) : (
          <PendingCard transactions={pendingApprovals ?? []} />
        )}
      </div>
    </div>
  );
}
