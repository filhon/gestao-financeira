"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { transactionService } from "@/lib/services/transactionService";
import { Entity, Transaction } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  TrendingDown,
  TrendingUp,
  Building2,
  User,
  Phone,
  Mail,
  FileText,
  Banknote,
  CreditCard,
  BarChart3,
  Info,
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
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/components/providers/AuthProvider";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export default function EntityDashboard() {
  const params = useParams();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canViewEntities, onlyOwnPayables } = usePermissions();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const id = params.id as string;

  useEffect(() => {
    const loadData = async () => {
      if (!selectedCompany || !id || !user) return;

      setIsLoading(true);
      try {
        // Load entity
        const entityDoc = await getDoc(doc(db, "entities", id));
        if (!entityDoc.exists()) {
          setEntity(null);
          return;
        }

        const entityData = {
          id: entityDoc.id,
          ...entityDoc.data(),
          createdAt: entityDoc.data().createdAt?.toDate(),
          updatedAt: entityDoc.data().updatedAt?.toDate(),
        } as Entity;

        setEntity(entityData);

        // For 'user' role, filter by createdBy to match Firestore rules
        const filter: { companyId: string; createdBy?: string } = {
          companyId: selectedCompany.id,
        };
        if (onlyOwnPayables) {
          filter.createdBy = user.uid;
        }

        // Load all transactions for the company
        const allTxs = await transactionService.getAll(filter);

        // Filter transactions associated with this entity
        // Match by entityId OR by supplierOrClient name (for legacy/manual entries)
        const entityTxs = allTxs.filter(
          (tx) =>
            tx.entityId === id ||
            (tx.supplierOrClient &&
              entityData.name &&
              tx.supplierOrClient.toLowerCase() ===
                entityData.name.toLowerCase())
        );

        setTransactions(entityTxs);
      } catch (error) {
        console.error("Error loading entity dashboard data:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [selectedCompany, id, user, onlyOwnPayables]);

  // Redirect if user doesn't have permission
  if (!canViewEntities) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Acesso Negado</h2>
          <p className="text-muted-foreground">
            Você não tem permissão para visualizar esta página.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        Carregando...
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex items-center justify-center h-screen">
        Entidade não encontrada.
      </div>
    );
  }

  // Filter transactions for the selected year
  // For paid transactions, use paymentDate; for others use dueDate
  const yearTransactions = transactions.filter((t) => {
    const dateToCheck =
      t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
    return dateToCheck.getFullYear() === selectedYear;
  });

  // Calculations
  const payables = yearTransactions.filter(
    (t) => t.type === "payable" && t.status !== "rejected"
  );
  const receivables = yearTransactions.filter(
    (t) => t.type === "receivable" && t.status !== "rejected"
  );

  const totalPayables = payables.reduce((acc, t) => acc + t.amount, 0);
  const totalReceivables = receivables.reduce((acc, t) => acc + t.amount, 0);

  const paidPayables = payables
    .filter((t) => t.status === "paid")
    .reduce((acc, t) => acc + (t.finalAmount || t.amount), 0);
  const paidReceivables = receivables
    .filter((t) => t.status === "paid")
    .reduce((acc, t) => acc + (t.finalAmount || t.amount), 0);

  const pendingPayables = totalPayables - paidPayables;
  const pendingReceivables = totalReceivables - paidReceivables;

  const balance = totalReceivables - totalPayables;

  // Status distribution for pie chart
  const statusDistribution = [
    {
      name: "Pago",
      value:
        payables.filter((t) => t.status === "paid").length +
        receivables.filter((t) => t.status === "paid").length,
      color: "#22c55e",
    },
    {
      name: "Aprovado",
      value:
        payables.filter((t) => t.status === "approved").length +
        receivables.filter((t) => t.status === "approved").length,
      color: "#3b82f6",
    },
    {
      name: "Pendente",
      value:
        payables.filter((t) => t.status === "pending_approval").length +
        receivables.filter((t) => t.status === "pending_approval").length,
      color: "#f59e0b",
    },
    {
      name: "Rascunho",
      value:
        payables.filter((t) => t.status === "draft").length +
        receivables.filter((t) => t.status === "draft").length,
      color: "#6b7280",
    },
  ].filter((d) => d.value > 0);

  // Monthly trend data
  // For paid transactions, use paymentDate; for others use dueDate
  const monthlyTrendData = yearTransactions
    .reduce(
      (acc, t) => {
        const dateToUse =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        const key = format(dateToUse, "MMM", { locale: ptBR });
        const monthIndex = dateToUse.getMonth();
        const amount =
          t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;
        const isPayable = t.type === "payable";

        const existing = acc.find((d) => d.monthIndex === monthIndex);
        if (existing) {
          if (isPayable) {
            existing.payables += amount;
          } else {
            existing.receivables += amount;
          }
        } else {
          acc.push({
            name: key,
            monthIndex,
            payables: isPayable ? amount : 0,
            receivables: isPayable ? 0 : amount,
          });
        }
        return acc;
      },
      [] as {
        name: string;
        monthIndex: number;
        payables: number;
        receivables: number;
      }[]
    )
    .sort((a, b) => a.monthIndex - b.monthIndex);

  // Recent transactions - sorted by the actual date (payment or due)
  const recentTransactions = [...yearTransactions]
    .sort((a, b) => {
      const dateA =
        a.status === "paid" && a.paymentDate ? a.paymentDate : a.dueDate;
      const dateB =
        b.status === "paid" && b.paymentDate ? b.paymentDate : b.dueDate;
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, 10);

  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() - 2 + i
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-emerald-500">Aprovado</Badge>;
      case "pending_approval":
        return <Badge className="bg-amber-500">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-blue-500">Pago</Badge>;
      case "rejected":
        return <Badge className="bg-red-500">Rejeitado</Badge>;
      default:
        return <Badge variant="secondary">Rascunho</Badge>;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "supplier":
        return (
          <Badge variant="outline" className="border-red-500 text-red-600">
            Fornecedor
          </Badge>
        );
      case "client":
        return (
          <Badge variant="outline" className="border-green-500 text-green-600">
            Cliente
          </Badge>
        );
      case "both":
        return (
          <Badge
            variant="outline"
            className="border-purple-500 text-purple-600"
          >
            Fornecedor/Cliente
          </Badge>
        );
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight">
                {entity.name}
              </h2>
            </div>
            <p className="text-muted-foreground">
              {entity.type === "company" ? "Pessoa Jurídica" : "Pessoa Física"}
              {entity.document && ` • ${entity.document}`}
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

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-2">
            <Info className="h-4 w-4" />
            Informações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total a Pagar
                </CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(totalPayables)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pendente: {formatCurrency(pendingPayables)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total a Receber
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(totalReceivables)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pendente: {formatCurrency(pendingReceivables)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo</CardTitle>
                {balance >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {formatCurrency(balance)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Receitas - Despesas
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Transações
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {yearTransactions.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Em {selectedYear}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            {/* Monthly Trend Chart */}
            <Card className="col-span-4">
              <CardHeader>
                <CardTitle>Movimentação Mensal ({selectedYear})</CardTitle>
              </CardHeader>
              <CardContent className="pl-2">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={monthlyTrendData}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="payablesGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#ef4444"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#ef4444"
                            stopOpacity={0.05}
                          />
                        </linearGradient>
                        <linearGradient
                          id="receivablesGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#22c55e"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#22c55e"
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
                                <p className="text-sm text-red-600">
                                  Despesas:{" "}
                                  {formatCurrency(
                                    (payload[0]?.value as number) || 0
                                  )}
                                </p>
                                <p className="text-sm text-green-600">
                                  Receitas:{" "}
                                  {formatCurrency(
                                    (payload[1]?.value as number) || 0
                                  )}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="payables"
                        stroke="#ef4444"
                        strokeWidth={2}
                        fill="url(#payablesGradient)"
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="receivables"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill="url(#receivablesGradient)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Status Distribution */}
            <Card className="col-span-3">
              <CardHeader>
                <CardTitle>Status das Transações</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col h-[300px]">
                  <div className="flex-1 min-h-0">
                    {statusDistribution.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusDistribution}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {statusDistribution.map((entry, index) => (
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
                                | undefined
                            ) => `${value} transações`}
                            contentStyle={{
                              borderRadius: "8px",
                              border: "1px solid #e5e7eb",
                              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Nenhuma transação encontrada
                      </div>
                    )}
                  </div>
                  <div className="flex justify-center gap-4 pt-2 flex-shrink-0">
                    {statusDistribution.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {entry.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <CardTitle>Últimas Transações</CardTitle>
              <CardDescription>
                Transações mais recentes com esta entidade em {selectedYear}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentTransactions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTransactions.map((tx) => {
                      const displayDate =
                        tx.status === "paid" && tx.paymentDate
                          ? tx.paymentDate
                          : tx.dueDate;
                      return (
                        <TableRow key={tx.id}>
                          <TableCell>
                            {format(displayDate, "dd/MM/yyyy")}
                          </TableCell>
                          <TableCell className="font-medium">
                            {tx.description}
                          </TableCell>
                          <TableCell>
                            {tx.type === "payable" ? (
                              <Badge
                                variant="outline"
                                className="border-red-500 text-red-600"
                              >
                                A Pagar
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-green-500 text-green-600"
                              >
                                A Receber
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell
                            className={
                              tx.type === "payable"
                                ? "text-red-600"
                                : "text-green-600"
                            }
                          >
                            {tx.type === "payable" ? "-" : "+"}
                            {formatCurrency(tx.amount)}
                          </TableCell>
                          <TableCell>{getStatusBadge(tx.status)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma transação encontrada para esta entidade em{" "}
                  {selectedYear}.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="space-y-4">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informações de Contato
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {entity.email && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">E-mail</p>
                      <p className="font-medium">{entity.email}</p>
                    </div>
                  </div>
                )}
                {entity.phone && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Telefone</p>
                      <p className="font-medium">{entity.phone}</p>
                    </div>
                  </div>
                )}
                {!entity.email && !entity.phone && (
                  <p className="text-muted-foreground col-span-full">
                    Nenhuma informação de contato cadastrada.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bank Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Informações Bancárias
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {entity.pixKey && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Chave PIX
                        {entity.pixKeyType && (
                          <span className="ml-1">
                            (
                            {entity.pixKeyType === "cpf"
                              ? "CPF"
                              : entity.pixKeyType === "cnpj"
                                ? "CNPJ"
                                : entity.pixKeyType === "email"
                                  ? "E-mail"
                                  : entity.pixKeyType === "phone"
                                    ? "Telefone"
                                    : entity.pixKeyType === "random"
                                      ? "Chave Aleatória"
                                      : ""}
                            )
                          </span>
                        )}
                      </p>
                      <p className="font-medium break-all">{entity.pixKey}</p>
                    </div>
                  </div>
                )}
                {entity.bankName && (
                  <div className="flex items-center gap-3 md:col-span-2">
                    <div className="p-2 rounded-lg bg-muted">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Conta Bancária
                      </p>
                      <p className="font-medium">
                        {entity.bankName}
                        {entity.agency && ` • Agência: ${entity.agency}`}
                        {entity.account && ` • Conta: ${entity.account}`}
                      </p>
                    </div>
                  </div>
                )}
                {!entity.pixKey && !entity.bankName && (
                  <p className="text-muted-foreground col-span-full">
                    Nenhuma informação bancária cadastrada.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Additional Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Informações Adicionais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tipo</p>
                    <p className="font-medium">
                      {entity.type === "company"
                        ? "Pessoa Jurídica"
                        : "Pessoa Física"}
                    </p>
                  </div>
                </div>
                {entity.document && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {entity.type === "company" ? "CNPJ" : "CPF"}
                      </p>
                      <p className="font-medium">{entity.document}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Categoria</p>
                    <div className="mt-1">
                      {getCategoryBadge(entity.category)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
