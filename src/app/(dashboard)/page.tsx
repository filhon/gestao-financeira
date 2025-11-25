"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { dashboardService, DashboardMetrics, CashFlowData, CostCenterData } from "@/lib/services/dashboardService";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { transactionService } from "@/lib/services/transactionService";
import { format } from "date-fns";
import { Transaction } from "@/lib/types";

export default function DashboardPage() {
    const { selectedCompany } = useCompany();
    const [isLoading, setIsLoading] = useState(true);

    const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
    const [cashFlow, setCashFlow] = useState<CashFlowData[]>([]);
    const [costCenterData, setCostCenterData] = useState<CostCenterData[]>([]);
    const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);

    useEffect(() => {
        const loadDashboard = async () => {
            if (!selectedCompany) return;
            try {
                const [metricsData, cashFlowData, ccData, transactions] = await Promise.all([
                    dashboardService.getFinancialMetrics(selectedCompany.id),
                    dashboardService.getCashFlowData(selectedCompany.id),
                    dashboardService.getExpensesByCostCenter(selectedCompany.id),
                    transactionService.getAll({ companyId: selectedCompany.id }) // We might want to limit this query later
                ]);

                setMetrics(metricsData);
                setCashFlow(cashFlowData);
                setCostCenterData(ccData);
                setRecentTransactions(transactions.slice(0, 5)); // Just take first 5 for now, assuming service returns sorted or we sort here
            } catch (error) {
                console.error("Error loading dashboard:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadDashboard();
    }, [selectedCompany]);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Financeiro</h1>

            {metrics && <KPICards metrics={metrics} />}

            <div className="grid gap-4 md:grid-cols-7">
                <CashFlowChart data={cashFlow} />
                <CostCenterChart data={costCenterData} />
            </div>

            <div className="grid gap-4 md:grid-cols-1">
                <Card>
                    <CardHeader>
                        <CardTitle>Transações Recentes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-8">
                            {recentTransactions.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center">Nenhuma transação recente.</p>
                            ) : (
                                recentTransactions.map((t) => (
                                    <div key={t.id} className="flex items-center">
                                        <div className="ml-4 space-y-1">
                                            <p className="text-sm font-medium leading-none">{t.description}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t.supplierOrClient} • {format(t.dueDate, "dd/MM/yyyy")}
                                            </p>
                                        </div>
                                        <div className={`ml-auto font-medium ${t.type === 'receivable' ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {t.type === 'receivable' ? '+' : '-'}
                                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(t.amount)}
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
