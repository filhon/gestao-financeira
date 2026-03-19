"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Receita Total */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Receita Total
                    </CardTitle>
                    <ArrowUpIcon className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                        <AnimatedCounter value={metrics.totalRevenue} formatter={formatCurrency} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        +{" "}
                        <AnimatedCounter value={metrics.pendingReceivables} formatter={formatCurrency} />
                        {" "}a receber (ano)
                    </p>
                </CardContent>
            </Card>

            {/* Despesas Totais */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Despesas Totais
                    </CardTitle>
                    <ArrowDownIcon className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                        <AnimatedCounter value={metrics.totalExpenses} formatter={formatCurrency} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        +{" "}
                        <AnimatedCounter value={metrics.pendingPayables} formatter={formatCurrency} />
                        {" "}a pagar (ano)
                    </p>
                </CardContent>
            </Card>

            {/* Saldo Realizado */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Saldo Realizado
                    </CardTitle>
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className={`text-2xl font-bold ${metrics.balance >= 0 ? "text-blue-600" : "text-red-600"}`}>
                        <AnimatedCounter value={metrics.balance} formatter={formatCurrency} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Receitas &minus; Despesas (pagas)
                    </p>
                </CardContent>
            </Card>

            {/* Previsão 30 dias */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Previsão 30 dias
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className={`text-2xl font-bold ${forecastBalance >= 0 ? "text-blue-600" : "text-red-600"}`}>
                        <AnimatedCounter
                            value={forecastBalance}
                            formatter={formatCurrency}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        <span className="text-green-600">
                            +<AnimatedCounter value={metrics.shortTermReceivables} formatter={formatCurrency} />
                        </span>
                        {" / "}
                        <span className="text-red-600">
                            &minus;<AnimatedCounter value={metrics.shortTermPayables} formatter={formatCurrency} />
                        </span>
                        {" venc. próx. 30d"}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
