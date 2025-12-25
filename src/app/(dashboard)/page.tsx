"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  dashboardService,
  DashboardMetrics,
} from "@/lib/services/dashboardService";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { transactionService } from "@/lib/services/transactionService";
import { format, isAfter, startOfDay } from "date-fns";
import { Transaction } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";

export default function DashboardPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();
  const [isLoading, setIsLoading] = useState(true);

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [upcomingTransactions, setUpcomingTransactions] = useState<
    Transaction[]
  >([]);

  useEffect(() => {
    const loadDashboard = async () => {
      if (!selectedCompany || !user) return;
      try {
        // For 'user' role, filter by createdBy to match Firestore rules
        const filter: { companyId: string; createdBy?: string } = {
          companyId: selectedCompany.id,
        };
        if (onlyOwnPayables) {
          filter.createdBy = user.uid;
        }

        const [metricsData, transactions] = await Promise.all([
          dashboardService.getFinancialMetrics(
            selectedCompany.id,
            onlyOwnPayables ? user.uid : undefined
          ),
          transactionService.getAll(filter),
        ]);

        setMetrics(metricsData);

        // Filter and sort upcoming transactions
        // 1. Filter: only future or today's transactions that are not paid/rejected
        // 2. Sort: closest date first, then highest value first for same date
        const today = startOfDay(new Date());
        const upcoming = transactions
          .filter((t) => {
            const dueDate = startOfDay(t.dueDate);
            return (
              (isAfter(dueDate, today) ||
                dueDate.getTime() === today.getTime()) &&
              t.status !== "paid" &&
              t.status !== "rejected"
            );
          })
          .sort((a, b) => {
            // First, sort by date (closest first)
            const dateCompare = a.dueDate.getTime() - b.dueDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            // If same date, sort by amount (highest first)
            return b.amount - a.amount;
          })
          .slice(0, 5);

        setUpcomingTransactions(upcoming);
      } catch (error) {
        console.error("Error loading dashboard:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadDashboard();
  }, [selectedCompany, user, onlyOwnPayables]);

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
              {upcomingTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma transação pendente.
                </p>
              ) : (
                upcomingTransactions.map((t) => (
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
