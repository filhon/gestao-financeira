import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, DollarSign, Wallet } from "lucide-react";
import { DashboardMetrics } from "@/lib/services/dashboardService";

interface KPICardsProps {
    metrics: DashboardMetrics;
}

export function KPICards({ metrics }: KPICardsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Receita Total
                    </CardTitle>
                    <ArrowUpIcon className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                        {formatCurrency(metrics.totalRevenue)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        + {formatCurrency(metrics.pendingReceivables)} a receber
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Despesas Totais
                    </CardTitle>
                    <ArrowDownIcon className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                        {formatCurrency(metrics.totalExpenses)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        + {formatCurrency(metrics.pendingPayables)} a pagar
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Saldo Realizado
                    </CardTitle>
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className={`text-2xl font-bold ${metrics.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {formatCurrency(metrics.balance)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Receitas - Despesas (Pagas)
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Previsão de Saldo
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {formatCurrency(metrics.balance + metrics.pendingReceivables - metrics.pendingPayables)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Considerando pendências
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
