"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { costCenterService } from "@/lib/services/costCenterService";
import { transactionService } from "@/lib/services/transactionService";
import { CostCenter, Transaction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingDown, TrendingUp, Wallet, PieChart as PieChartIcon, Calendar } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid
} from "recharts";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { budgetService } from "@/lib/services/budgetService";

export default function CostCenterDashboard() {
    const params = useParams();
    const router = useRouter();
    const { selectedCompany } = useCompany();
    const [costCenter, setCostCenter] = useState<CostCenter | null>(null);
    const [children, setChildren] = useState<CostCenter[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [budgetAmount, setBudgetAmount] = useState(0);

    const id = params.id as string;

    useEffect(() => {
        const loadData = async () => {
            if (selectedCompany && id) {
                setIsLoading(true);
                try {
                    const [cc, kids, txs, budget] = await Promise.all([
                        costCenterService.getById(id),
                        costCenterService.getChildren(id),
                        transactionService.getByCostCenter(id, selectedCompany.id),
                        budgetService.getByCostCenterAndYear(id, selectedYear)
                    ]);

                    setCostCenter(cc);
                    setChildren(kids);
                    setTransactions(txs);
                    setBudgetAmount(budget?.amount || 0);
                } catch (error) {
                    console.error("Error loading dashboard data:", error);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        loadData();
    }, [selectedCompany, id, selectedYear]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen">Carregando...</div>;
    }

    if (!costCenter) {
        return <div className="flex items-center justify-center h-screen">Centro de Custo não encontrado.</div>;
    }

    // Filter transactions for the selected year
    const yearTransactions = transactions.filter(t => t.dueDate.getFullYear() === selectedYear);

    // Calculations
    const totalBudget = budgetAmount;
    // Note: Children allocation is still using the legacy budget field. 
    // Ideally we should fetch children's budgets for the selected year.
    const allocatedToChildren = children.reduce((acc, child) => acc + (child.budget || 0), 0);

    // Calculate direct expenses (sum of transaction amounts allocated to this CC)
    const directExpenses = yearTransactions
        .filter(t => t.type === 'payable' && t.status !== 'rejected')
        .reduce((acc, t) => {
            const allocation = t.costCenterAllocation?.find(a => a.costCenterId === id);
            return acc + (allocation ? allocation.amount : 0);
        }, 0);

    const remainingBalance = totalBudget - allocatedToChildren - directExpenses;

    const now = new Date();
    const isCurrentYear = selectedYear === now.getFullYear();
    const monthsRemaining = isCurrentYear ? (12 - now.getMonth()) : (selectedYear > now.getFullYear() ? 12 : 0);

    const suggestedMonthlySpend = monthsRemaining > 0 ? remainingBalance / monthsRemaining : 0;

    // Charts Data
    const budgetDistributionData = [
        { name: "Filhos", value: allocatedToChildren, color: "#3b82f6" }, // blue-500
        { name: "Despesas", value: directExpenses, color: "#ef4444" }, // red-500
        { name: "Disponível", value: Math.max(0, remainingBalance), color: "#22c55e" }, // green-500
    ].filter(d => d.value > 0);

    // Monthly Spending Trend (Last 6 months or all months of selected year?)
    // Let's show all months of selected year
    const monthlyTrendData = yearTransactions
        .filter(t => t.type === 'payable' && t.status !== 'rejected')
        .reduce((acc, t) => {
            const date = t.dueDate;
            const key = format(date, "MMM", { locale: ptBR });
            const monthIndex = date.getMonth();
            const allocation = t.costCenterAllocation?.find(a => a.costCenterId === id);
            const amount = allocation ? allocation.amount : 0;

            const existing = acc.find(d => d.monthIndex === monthIndex);
            if (existing) {
                existing.amount += amount;
            } else {
                acc.push({ name: key, amount, monthIndex });
            }
            return acc;
        }, [] as { name: string; amount: number; monthIndex: number }[])
        .sort((a, b) => a.monthIndex - b.monthIndex);


    const upcomingExpenses = yearTransactions
        .filter(t => t.type === 'payable' && t.status !== 'paid' && t.status !== 'rejected' && t.dueDate >= new Date())
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
        .slice(0, 5);

    const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i); // Current year - 2 to + 2

    return (
        <div className="space-y-6 p-8 pt-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">{costCenter.name}</h2>
                        <p className="text-muted-foreground">
                            Código: {costCenter.code} | Responsável: {costCenter.approverEmail || "N/A"}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Select
                        value={selectedYear.toString()}
                        onValueChange={(value) => setSelectedYear(parseInt(value))}
                    >
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Ano" />
                        </SelectTrigger>
                        <SelectContent>
                            {years.map((year) => (
                                <SelectItem key={year} value={year.toString()}>
                                    {year}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Orçamento {selectedYear}</CardTitle>
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(totalBudget)}</div>
                        <p className="text-xs text-muted-foreground">
                            Definido para este centro
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
                        <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${remainingBalance < 0 ? "text-red-500" : "text-green-500"}`}>
                            {formatCurrency(remainingBalance)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {totalBudget > 0 ? ((remainingBalance / totalBudget) * 100).toFixed(1) : 0}% do total
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Despesa Sugerida/Mês</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(suggestedMonthlySpend)}</div>
                        <p className="text-xs text-muted-foreground">
                            Para os próximos {monthsRemaining} meses
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Despesas Realizadas</CardTitle>
                        <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(directExpenses)}</div>
                        <p className="text-xs text-muted-foreground">
                            Total gasto em {selectedYear}
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                {/* Charts */}
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Tendência de Gastos ({selectedYear})</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthlyTrendData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        stroke="#888888"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        stroke="#888888"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `R$${value}`}
                                    />
                                    <Tooltip
                                        formatter={(value: number) => formatCurrency(value)}
                                        cursor={{ fill: 'transparent' }}
                                    />
                                    <Bar dataKey="amount" fill="#adfa1d" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Distribuição do Orçamento</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={budgetDistributionData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {budgetDistributionData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex justify-center gap-4 mt-4">
                                {budgetDistributionData.map((entry, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                                        <span className="text-sm text-muted-foreground">{entry.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {/* Children Cost Centers */}
                <Card>
                    <CardHeader>
                        <CardTitle>Centros de Custo Filhos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {children.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nome</TableHead>
                                        <TableHead>Orçamento</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {children.map((child) => (
                                        <TableRow key={child.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/centros-custo/${child.id}`)}>
                                            <TableCell className="font-medium">{child.name}</TableCell>
                                            <TableCell>{formatCurrency(child.budget || 0)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                Nenhum centro de custo filho.
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Upcoming Expenses */}
                <Card>
                    <CardHeader>
                        <CardTitle>Próximas Despesas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {upcomingExpenses.length > 0 ? (
                            <div className="space-y-4">
                                {upcomingExpenses.map((tx) => (
                                    <div key={tx.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                                        <div>
                                            <p className="font-medium">{tx.description}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {format(tx.dueDate, "dd/MM/yyyy")}
                                            </p>
                                        </div>
                                        <div className="font-bold text-red-500">
                                            {formatCurrency(
                                                // Display the allocated amount for this CC, not total tx amount
                                                (tx.costCenterAllocation?.find(a => a.costCenterId === id)?.amount || 0)
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                Nenhuma despesa próxima.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
