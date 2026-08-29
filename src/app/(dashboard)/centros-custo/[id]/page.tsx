"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { costCenterService } from "@/lib/services/costCenterService";
import { transactionService } from "@/lib/services/transactionService";
import { CostCenter, CostCenterBalance, Transaction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  TrendingDown,
  Wallet,
  PieChart as PieChartIcon,
  Calendar,
  Loader2,
} from "lucide-react";
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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { costCenterLedgerService } from "@/lib/services/costCenterLedgerService";

export default function CostCenterDashboard() {
  const params = useParams();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();
  const [costCenter, setCostCenter] = useState<CostCenter | null>(null);
  const [children, setChildren] = useState<CostCenter[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [balances, setBalances] = useState<Record<string, CostCenterBalance>>(
    {},
  );
  /** Despesas do exercício usadas só para a série mensal. */
  const [yearPayables, setYearPayables] = useState<Transaction[]>([]);

  const id = params.id as string;

  useEffect(() => {
    const loadData = async () => {
      if (selectedCompany && id && user) {
        setIsLoading(true);
        try {
          const [cc, kids, allCostCenters] = await Promise.all([
            costCenterService.getById(id),
            costCenterService.getChildren(id),
            costCenterService.getAll(selectedCompany.id),
          ]);

          setCostCenter(cc);
          setChildren(kids);

          // Saldo do centro e dos filhos numa leitura só, do razão de envelope.
          try {
            setBalances(
              await costCenterLedgerService.getBalances(
                selectedCompany.id,
                allCostCenters,
                selectedYear,
              ),
            );
          } catch (error) {
            console.error("Error loading cost center balances:", error);
            setBalances({});
          }

          // A série mensal sai das próprias transações, não de um agregado
          // paralelo: `cost_center_usage` data o lançamento por `paymentDate`
          // sempre que ele existe, enquanto o razão só o faz quando a despesa
          // está paga — as barras do mês não fechariam com o total do ano.
          //
          // Duas consultas porque uma despesa paga pertence ao exercício do
          // pagamento, que pode cair fora da faixa de vencimento.
          const start = new Date(selectedYear, 0, 1);
          const end = new Date(selectedYear, 11, 31, 23, 59, 59);
          const [byDue, byPayment] = await Promise.all([
            transactionService.getAll({
              companyId: selectedCompany.id,
              costCenterId: id,
              type: "payable",
              startDate: start,
              endDate: end,
            }),
            transactionService.getByPaymentDate({
              companyId: selectedCompany.id,
              costCenterId: id,
              startDate: start,
              endDate: end,
            }),
          ]);
          const unique = new Map<string, Transaction>();
          [...byDue, ...byPayment].forEach((t) => unique.set(t.id, t));
          setYearPayables([...unique.values()]);
        } catch (error) {
          console.error("Error loading dashboard data:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadData();
  }, [selectedCompany, id, selectedYear, user]);

  useEffect(() => {
    const loadTransactions = async () => {
      if (selectedCompany && id && user) {
        const now = new Date();
        const isPast = selectedYear < now.getFullYear();

        try {
          const userId = onlyOwnPayables ? user.uid : undefined;

          // For past years: fetch the full year range (including paid) for history
          // For current/future: fetch upcoming payables from today
          const startDate = isPast ? new Date(selectedYear, 0, 1) : now;
          const endDate = isPast
            ? new Date(selectedYear, 11, 31, 23, 59, 59)
            : undefined;

          const { transactions: txs } = await transactionService.getPaginated(
            selectedCompany.id,
            100,
            null,
            {
              startDate,
              ...(endDate && { endDate }),
              type: "payable",
              // Past years: include all statuses for historical view
              // Current/future: exclude paid and rejected
              ...(!isPast && { excludeStatus: ["paid", "rejected"] }),
              createdBy: userId,
            },
          );

          // Filter by cost center in memory
          const filtered = txs.filter((t) =>
            t.costCenterAllocation?.some((a) => a.costCenterId === id),
          );

          setTransactions(filtered);
        } catch (error) {
          console.error("Error loading transactions:", error);
        }
      }
    };
    loadTransactions();
  }, [selectedCompany, id, user, onlyOwnPayables, selectedYear]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!costCenter) {
    return (
      <div className="flex items-center justify-center h-screen">
        Centro de Custo não encontrado.
      </div>
    );
  }

  // Tudo abaixo sai do razão de envelope — a mesma fonte da tela de
  // distribuição, do formulário de despesa e da listagem de centros.
  const balance = balances[id];

  // O recurso do exercício: receitas (se raiz) ou envelope do pai, mais a
  // sobra consolidada do ano anterior.
  const totalBudget = (balance?.received ?? 0) + (balance?.carryIn ?? 0);

  // Realizado = despesa direta já paga; comprometido inclui as pendentes.
  const directRealized = balance?.spentDirectPaid ?? 0;
  const directCommitted = balance?.spentDirect ?? 0;
  const directPending = directCommitted - directRealized;

  // O que o pai entregou aos filhos sai do bolso dele no momento da
  // distribuição, tenha o filho gasto ou não — é essa a regra do envelope.
  // A versão anterior descontava o *gasto* dos filhos, e por isso mostrava
  // como disponível um recurso que já havia sido prometido.
  const hasChildren = children.length > 0;
  const allocatedToChildren = balance?.allocatedToChildren ?? 0;
  const totalConsumed = allocatedToChildren + directCommitted;

  // Gasto de toda a subárvore, só informativo: não entra na conta do saldo.
  const subtreeSpent = balance?.subtreeSpent ?? 0;

  const remainingBalance = balance?.available ?? 0;

  const now = new Date();
  const isPastYear = selectedYear < now.getFullYear();
  const isCurrentYear = selectedYear === now.getFullYear();
  const monthsRemaining = isCurrentYear
    ? 12 - now.getMonth()
    : selectedYear > now.getFullYear()
      ? 12
      : 0;

  const suggestedMonthlySpend =
    monthsRemaining > 0 ? remainingBalance / monthsRemaining : 0;

  // Charts Data
  const budgetDistributionData = [
    ...(hasChildren && allocatedToChildren > 0
      ? [
          {
            name: "Distribuído aos filhos",
            value: allocatedToChildren,
            color: "#3b82f6",
          },
        ]
      : []),
    ...(directRealized > 0
      ? [{ name: "Realizado", value: directRealized, color: "#ef4444" }]
      : []),
    ...(directPending > 0
      ? [{ name: "Pendente", value: directPending, color: "#fb923c" }]
      : []),
    ...(remainingBalance > 0
      ? [{ name: "Disponível", value: remainingBalance, color: "#22c55e" }]
      : []),
  ].filter((d) => d.value > 0);

  // Série mensal montada com a mesma regra de exercício do razão: a despesa
  // pertence ao mês do pagamento quando está paga, e ao do vencimento quando
  // não. Assim a soma das barras fecha com o gasto direto do ano acima.
  const monthlyTrendData = yearPayables
    .reduce(
      (acc, tx) => {
        if (tx.status === "rejected") return acc;

        const effective =
          tx.status === "paid" && tx.paymentDate ? tx.paymentDate : tx.dueDate;
        if (!effective || effective.getFullYear() !== selectedYear) return acc;

        // Só a parte rateada para este centro de custo.
        const amount =
          tx.costCenterAllocation?.find((a) => a.costCenterId === id)?.amount ??
          (tx.costCenterId === id ? (tx.finalAmount ?? tx.amount) : 0);
        if (!amount) return acc;

        const monthIndex = effective.getMonth();
        const existing = acc.find((d) => d.monthIndex === monthIndex);
        if (existing) {
          existing.amount += amount;
        } else {
          acc.push({
            name: format(effective, "MMM", { locale: ptBR }),
            amount,
            monthIndex,
          });
        }
        return acc;
      },
      [] as { name: string; amount: number; monthIndex: number }[],
    )
    .sort((a, b) => a.monthIndex - b.monthIndex);

  // Filter transactions for the selected year for the list
  const yearTransactions = transactions.filter((t) => {
    const dateToCheck =
      t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
    return dateToCheck.getFullYear() === selectedYear;
  });

  const upcomingExpenses = yearTransactions
    .filter(
      (t) =>
        t.type === "payable" &&
        t.status !== "rejected" &&
        (isPastYear || (t.status !== "paid" && t.dueDate >= now)),
    )
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 5);

  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() - 2 + i,
  ); // Current year - 2 to + 2

  return (
    <div className="space-y-6 p-4 sm:p-8 pt-6">
      <div className="flex flex-wrap items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="hidden md:flex"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl md:text-3xl font-bold tracking-tight">
              {costCenter.name}
            </h2>
            <p className="text-muted-foreground">
              Código: {costCenter.code} | Responsável:{" "}
              {costCenter.approverEmail || "N/A"}
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
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Envelope {selectedYear}
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold font-financial"
              title={formatCurrency(totalBudget)}
            >
              <span className="md:hidden">
                {formatCurrencyAbbr(totalBudget)}
              </span>
              <span className="hidden md:inline">
                {formatCurrency(totalBudget)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {balance?.isRoot
                ? "Receitas do exercício"
                : "Recebido do centro pai"}
              {(balance?.carryIn ?? 0) !== 0 &&
                ` + ${formatCurrency(balance!.carryIn)} do ano anterior`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Saldo Disponível
            </CardTitle>
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-financial ${remainingBalance < 0 ? "text-red-500" : "text-green-500"}`}
              title={formatCurrency(remainingBalance)}
            >
              <span className="md:hidden">
                {formatCurrencyAbbr(remainingBalance)}
              </span>
              <span className="hidden md:inline">
                {formatCurrency(remainingBalance)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {totalBudget > 0
                ? ((remainingBalance / totalBudget) * 100).toFixed(1)
                : 0}
              % do total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Despesa Sugerida/Mês
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold font-financial"
              title={formatCurrency(suggestedMonthlySpend)}
            >
              <span className="md:hidden">
                {formatCurrencyAbbr(suggestedMonthlySpend)}
              </span>
              <span className="hidden md:inline">
                {formatCurrency(suggestedMonthlySpend)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Para os próximos {monthsRemaining} meses
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Despesas Realizadas
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold font-financial text-red-600"
              title={formatCurrency(directRealized)}
            >
              <span className="md:hidden">
                {formatCurrencyAbbr(directRealized)}
              </span>
              <span className="hidden md:inline">
                {formatCurrency(directRealized)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Pagamentos efetivados em {selectedYear}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Comprometido Pendente
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold font-financial text-orange-500"
              title={formatCurrency(directPending)}
            >
              <span className="md:hidden">
                {formatCurrencyAbbr(directPending)}
              </span>
              <span className="hidden md:inline">
                {formatCurrency(directPending)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Aprovado mas ainda não pago
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de progresso segmentada do orçamento */}
      {totalBudget > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Envelope de {selectedYear}</span>
            <span className="text-muted-foreground tabular-nums">
              {totalBudget > 0
                ? ((totalConsumed / totalBudget) * 100).toFixed(1)
                : 0}
              % comprometido
            </span>
          </div>
          {/* Stacked bar: filhos (azul) + realizado (vermelho) + pendente (laranja) */}
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex">
            {hasChildren && allocatedToChildren > 0 && (
              <div
                className="h-full bg-blue-500 transition-all duration-700"
                style={{
                  width: `${Math.min((allocatedToChildren / totalBudget) * 100, 100)}%`,
                }}
                title={`Distribuído aos filhos: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(allocatedToChildren)}`}
              />
            )}
            {directRealized > 0 && (
              <div
                className="h-full bg-red-500 transition-all duration-700"
                style={{
                  width: `${Math.min((directRealized / totalBudget) * 100, Math.max(0, 100 - (allocatedToChildren / totalBudget) * 100))}%`,
                }}
                title={`Realizado: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(directRealized)}`}
              />
            )}
            {directPending > 0 && (
              <div
                className="h-full bg-orange-400 transition-all duration-700"
                style={{
                  width: `${Math.min((directPending / totalBudget) * 100, Math.max(0, 100 - ((allocatedToChildren + directRealized) / totalBudget) * 100))}%`,
                }}
                title={`Comprometido pendente: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(directPending)}`}
              />
            )}
          </div>
          {/* Legenda */}
          <div className="flex items-center gap-5 text-xs text-muted-foreground flex-wrap">
            {hasChildren && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-500 shrink-0" />
                <span>
                  Distribuído aos filhos:{" "}
                  <span className="font-medium text-foreground font-financial">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(allocatedToChildren)}
                  </span>
                </span>
              </div>
            )}
            {directRealized > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-red-500 shrink-0" />
                <span>
                  Realizado:{" "}
                  <span className="font-medium text-foreground font-financial">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(directRealized)}
                  </span>
                </span>
              </div>
            )}
            {directPending > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-orange-400 shrink-0" />
                <span>
                  Pendente:{" "}
                  <span className="font-medium text-foreground font-financial">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(directPending)}
                  </span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
              <span>
                Disponível:{" "}
                <span
                  className={`font-medium font-financial ${remainingBalance < 0 ? "text-red-500" : "text-emerald-600"}`}
                >
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(Math.max(0, remainingBalance))}
                </span>
              </span>
            </div>
            {/* Fora da barra: o gasto da subárvore não consome o envelope do
                pai — quem consome é a distribuição. Fica como informação de
                quanto do que foi distribuído já virou despesa. */}
            {hasChildren && (
              <div className="flex items-center gap-1.5">
                <TrendingDown className="w-3 h-3 text-muted-foreground shrink-0" />
                <span>
                  Gasto na subárvore:{" "}
                  <span className="font-medium text-foreground font-financial">
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(subtreeSpent)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Charts */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Tendência de Gastos ({selectedYear})</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[220px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={monthlyTrendData}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="spendingGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop
                        offset="95%"
                        stopColor="#ef4444"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
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
                    tickFormatter={(value) => {
                      if (Math.abs(value) >= 1000) {
                        return `R$${(value / 1000).toFixed(0)}k`;
                      }
                      return `R$${value}`;
                    }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="rounded-lg border bg-popover p-3 shadow-md">
                            <p className="text-sm font-medium text-popover-foreground">
                              {label}
                            </p>
                            <p className="text-sm text-red-600 font-medium">
                              {formatCurrency(payload[0].value as number)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    fill="url(#spendingGradient)"
                    dot={false}
                    activeDot={{
                      r: 6,
                      fill: "#ef4444",
                      stroke: "#fff",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-4 lg:col-span-3">
          <CardHeader>
            <CardTitle>Composição do Envelope</CardTitle>
          </CardHeader>
          <CardContent>
            {budgetDistributionData.length === 0 ? (
              <div className="flex items-center justify-center h-[220px] sm:h-[300px] text-sm text-muted-foreground text-center px-4">
                Este centro não recebeu envelope em {selectedYear}. Distribua
                recurso do centro pai para ver a composição.
              </div>
            ) : (
              <div className="flex flex-col h-[220px] sm:h-[300px]">
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={budgetDistributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {budgetDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(
                          value:
                            | number
                            | string
                            | Array<number | string>
                            | readonly (number | string)[]
                            | undefined,
                        ) => formatCurrency(Number(value) || 0)}
                        contentStyle={{
                          borderRadius: "8px",
                          border: "1px solid #e5e7eb",
                          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-4 pt-2 shrink-0">
                  {budgetDistributionData.map((entry, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {entry.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Children Cost Centers */}
        <Card>
          <CardHeader>
            <CardTitle>Centros de Custo Filhos</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-6">
            {children.length > 0 ? (
              <>
                {/* Desktop: table */}
                <div className="hidden sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Envelope</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {children.map((child) => (
                        <TableRow
                          key={child.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            router.push(`/centros-custo/${child.id}`)
                          }
                        >
                          <TableCell className="font-medium">
                            {child.name}
                          </TableCell>
                          <TableCell className="font-financial">
                            {formatCurrency(balances[child.id]?.received ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Mobile: card list */}
                <div className="sm:hidden divide-y">
                  {children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => router.push(`/centros-custo/${child.id}`)}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {child.name}
                        </p>
                        {child.code && (
                          <p className="text-[11px] font-mono text-muted-foreground">
                            {child.code}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-semibold font-financial shrink-0">
                        {formatCurrency(balances[child.id]?.received ?? 0)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground px-6">
                Nenhum centro de custo filho.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Expenses */}
        <Card>
          <CardHeader>
            <CardTitle>
              {isPastYear ? "Despesas do Período" : "Próximas Despesas"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingExpenses.length > 0 ? (
              <div className="space-y-4">
                {upcomingExpenses.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0"
                  >
                    <div>
                      <p className="font-medium">{tx.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(tx.dueDate, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div className="font-bold font-financial text-red-500">
                      {formatCurrency(
                        // Display the allocated amount for this CC, not total tx amount
                        tx.costCenterAllocation?.find(
                          (a) => a.costCenterId === id,
                        )?.amount || 0,
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
