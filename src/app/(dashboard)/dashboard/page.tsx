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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";

// ─── Skeleton helpers ─────────────────────────────────────────────────────────

function KPICardsSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-4 md:divide-y-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-2 sm:gap-3 px-3 py-3 sm:px-5 sm:py-4"
          >
            <Skeleton className="h-8 w-8 rounded-md shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1 min-w-0">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
  const { openTransaction } = useTransactionDetailStore();

  return (
    <Card
      className={
        hasItems
          ? "border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20"
          : ""
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base md:text-lg flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            Contas em Atraso
            {hasItems && (
              <span className="relative inline-flex">
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
                role="button"
                tabIndex={0}
                onClick={() => openTransaction(t)}
                onKeyDown={(e) => e.key === "Enter" && openTransaction(t)}
                className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors"
              >
                <div className="space-y-1 min-w-0 pr-2">
                  <p className="text-sm font-medium leading-none truncate">
                    {t.description}
                  </p>
                  <p className="text-xs text-red-500 font-medium">
                    Venceu em {format(t.dueDate, "dd/MM/yyyy")}
                  </p>
                </div>
                <div className="text-sm font-bold font-financial text-red-600 shrink-0 whitespace-nowrap">
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
  const { openTransaction } = useTransactionDetailStore();

  return (
    <Card
      className={
        hasItems
          ? "border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20"
          : ""
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base md:text-lg flex items-center gap-2 text-amber-600 dark:text-amber-400">
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
                role="button"
                tabIndex={0}
                onClick={() => openTransaction(t)}
                onKeyDown={(e) => e.key === "Enter" && openTransaction(t)}
                className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors"
              >
                <div className="space-y-1 min-w-0 pr-2">
                  <p className="text-sm font-medium leading-none truncate">
                    {t.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.supplierOrClient} • {format(t.dueDate, "dd/MM/yyyy")}
                  </p>
                </div>
                <div className="text-sm font-medium font-financial text-amber-600 shrink-0 whitespace-nowrap">
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
    <div className="flex flex-col gap-6">
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-7">
        <CashFlowChart year={selectedYear} />
        <CostCenterChart year={selectedYear} />
      </div>

      {/* ── Action Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
