"use client";

import { Loader2 } from "lucide-react";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  useDashboardMetrics,
  useUpcomingTransactions,
} from "@/hooks/useDashboardData";

export default function DashboardPage() {
  const { data: metrics, isLoading: isMetricsLoading } = useDashboardMetrics();
  const { data: upcomingTransactions, isLoading: isTransactionsLoading } =
    useUpcomingTransactions();

  const isLoading = isMetricsLoading || isTransactionsLoading;

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

      <div className="grid gap-4 md:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle>Próximas Transações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {upcomingTransactions?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma transação pendente.
                </p>
              ) : (
                upcomingTransactions?.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {t.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.supplierOrClient} • {format(t.dueDate, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div
                      className={`font-medium ${t.type === "receivable" ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {t.type === "receivable" ? "+" : "-"}
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(t.amount)}
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
