"use client";

import { useState } from "react";
import {
  Loader2,
  AlertCircle,
  Clock,
  ArrowRight,
  RefreshCcw,
  CalendarDays,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import {
  useDashboardMetrics,
  useOverdueTransactions,
  usePendingApprovals,
} from "@/hooks/useDashboardData";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export default function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const {
    data: metrics,
    isLoading: isMetricsLoading,
    isError: isMetricsError,
  } = useDashboardMetrics(selectedYear);
  const {
    data: overdueTransactions,
    isLoading: isOverdueLoading,
    isError: isOverdueError,
  } = useOverdueTransactions();
  const {
    data: pendingApprovals,
    isLoading: isPendingLoading,
    isError: isPendingError,
  } = usePendingApprovals();

  const queryClient = useQueryClient();

  const isLoading = isMetricsLoading || isOverdueLoading || isPendingLoading;
  const hasError = isMetricsError || isOverdueError || isPendingError;

  // Generate year options (current year and 4 previous years)
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-red-500" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Erro ao carregar dados</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Não foi possível carregar os dados do dashboard. Verifique sua
            conexão e tente novamente.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({
              queryKey: ["dashboard-metrics"],
            });
            queryClient.invalidateQueries({
              queryKey: ["overdue-transactions"],
            });
            queryClient.invalidateQueries({
              queryKey: ["pending-approvals"],
            });
          }}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Dashboard Financeiro
        </h1>
        <div className="flex items-center gap-2">
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

      {metrics && <KPICards metrics={metrics} />}

      {metrics && (
        <CfoInsights
          metrics={metrics}
          overdueTransactions={overdueTransactions ?? []}
        />
      )}

      <div className="grid gap-4 md:grid-cols-7">
        <CashFlowChart year={selectedYear} />
        <CostCenterChart year={selectedYear} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Contas em Atraso */}
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                Contas em Atraso
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
            <div className="space-y-4">
              {overdueTransactions?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhuma conta em atraso.
                </p>
              ) : (
                overdueTransactions?.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none truncate max-w-[200px]">
                        {t.description}
                      </p>
                      <p className="text-xs text-red-500 font-medium">
                        Venceu em {format(t.dueDate, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div className="font-bold text-red-600">
                      {formatCurrency(t.amount)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pendências de Aprovação */}
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-amber-600">
                <Clock className="h-5 w-5" />
                Pendentes de Aprovação
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
            <div className="space-y-4">
              {pendingApprovals?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhuma pendência de aprovação.
                </p>
              ) : (
                pendingApprovals?.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none truncate max-w-[200px]">
                        {t.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.supplierOrClient} • {format(t.dueDate, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div className="font-medium text-amber-600">
                      {formatCurrency(t.amount)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
