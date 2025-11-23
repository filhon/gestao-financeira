"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, ArrowUpCircle, ArrowDownCircle, Loader2 } from "lucide-react";
import { transactionService } from "@/lib/services/transactionService";
import { CashFlowChart } from "@/components/features/finance/CashFlowChart";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useCompany } from "@/components/providers/CompanyProvider";

export default function DashboardPage() {
    const { selectedCompany } = useCompany();
    const [stats, setStats] = useState<{
        totalBalance: number;
        monthlyIncome: number;
        monthlyExpense: number;
        chartData: any[];
        recentTransactions: any[];
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadStats = async () => {
            if (!selectedCompany) return;
            try {
                const data = await transactionService.getDashboardStats(selectedCompany.id);
                setStats(data);
            } catch (error) {
                console.error("Error loading dashboard stats:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadStats();
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
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Saldo Total</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(stats?.totalBalance || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Saldo acumulado atual
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Receitas (Mês)</CardTitle>
                        <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(stats?.monthlyIncome || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Entradas neste mês
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Despesas (Mês)</CardTitle>
                        <ArrowDownCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(stats?.monthlyExpense || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Saídas neste mês
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-7">
                <CashFlowChart data={stats?.chartData || []} />

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Transações Recentes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-8">
                            {stats?.recentTransactions.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center">Nenhuma transação recente.</p>
                            ) : (
                                stats?.recentTransactions.map((t) => (
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
