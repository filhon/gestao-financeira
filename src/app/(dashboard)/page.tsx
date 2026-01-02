"use client";

import { Loader2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { format } from "date-fns";
import {
  useDashboardMetrics,
  useOverdueTransactions,
  usePendingApprovals,
} from "@/hooks/useDashboardData";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const { data: metrics, isLoading: isMetricsLoading } = useDashboardMetrics();
  const { data: overdueTransactions, isLoading: isOverdueLoading } =
    useOverdueTransactions();
  const { data: pendingApprovals, isLoading: isPendingLoading } =
    usePendingApprovals();

  const isLoading = isMetricsLoading || isOverdueLoading || isPendingLoading;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">
        Dashboard Financeiro
      </h1>

      {metrics && <KPICards metrics={metrics} />}

      <div className="grid gap-4 md:grid-cols-7">
        <CashFlowChart />
        <CostCenterChart />
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
