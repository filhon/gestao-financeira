"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { transactionService } from "@/lib/services/transactionService";
import { Entity, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  Info,
  Loader2,
  Activity,
  Wallet,
} from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");

  const id = params.id as string;

  useEffect(() => {
    const loadData = async () => {
      if (!selectedCompany || !id || !user) return;

      setIsLoading(true);
      try {
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

        const filter: { companyId: string; createdBy?: string } = {
          companyId: selectedCompany.id,
        };
        if (onlyOwnPayables) {
          filter.createdBy = user.uid;
        }

        const allTxs = await transactionService.getAll(filter);

        const entityTxs = allTxs.filter(
          (tx) =>
            tx.entityId === id ||
            (tx.supplierOrClient &&
              entityData.name &&
              tx.supplierOrClient.toLowerCase() ===
                entityData.name.toLowerCase()),
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

  if (!canViewEntities) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-2">
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

  const yearTransactions = transactions.filter((t) => {
    const dateToCheck =
      t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
    return dateToCheck.getFullYear() === selectedYear;
  });

  const payables = yearTransactions.filter(
    (t) => t.type === "payable" && t.status !== "rejected",
  );
  const receivables = yearTransactions.filter(
    (t) => t.type === "receivable" && t.status !== "rejected",
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

  const statusDistribution = [
    {
      name: "Pago",
      value:
        payables.filter((t) => t.status === "paid").length +
        receivables.filter((t) => t.status === "paid").length,
      color: "#10b981",
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
      }[],
    )
    .sort((a, b) => a.monthIndex - b.monthIndex);

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
    (_, i) => new Date().getFullYear() - 2 + i,
  );

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      approved: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
      pending_approval: "bg-amber-500/10 text-amber-600 border-amber-200",
      paid: "bg-blue-500/10 text-blue-600 border-blue-200",
      rejected: "bg-red-500/10 text-red-600 border-red-200",
      draft: "bg-zinc-100 text-zinc-500 border-zinc-200",
    };
    const labels: Record<string, string> = {
      approved: "Aprovado",
      pending_approval: "Pendente",
      paid: "Pago",
      rejected: "Rejeitado",
      draft: "Rascunho",
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${styles[status] ?? styles.draft}`}
      >
        {labels[status] ?? "Rascunho"}
      </span>
    );
  };

  const categoryConfig: Record<
    string,
    { label: string; color: string; bg: string }
  > = {
    supplier: {
      label: "Fornecedor",
      color: "text-rose-600",
      bg: "bg-rose-50 border-rose-200",
    },
    client: {
      label: "Cliente",
      color: "text-emerald-600",
      bg: "bg-emerald-50 border-emerald-200",
    },
    both: {
      label: "Fornecedor / Cliente",
      color: "text-violet-600",
      bg: "bg-violet-50 border-violet-200",
    },
  };
  const catCfg = categoryConfig[entity.category] ?? {
    label: "-",
    color: "text-zinc-500",
    bg: "bg-zinc-50 border-zinc-200",
  };

  const entityInitials = entity.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* ── Header ── */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Left: back + entity identity */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.back()}
                className="rounded-full h-9 w-9 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              {/* Avatar */}
              <div
                className={`h-11 w-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                  entity.category === "client"
                    ? "bg-emerald-100 text-emerald-700"
                    : entity.category === "supplier"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-violet-100 text-violet-700"
                }`}
              >
                {entityInitials}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {entity.name}
                  </h1>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${catCfg.bg} ${catCfg.color}`}
                  >
                    {catCfg.label}
                  </span>
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {entity.type === "company"
                    ? "Pessoa Jurídica"
                    : "Pessoa Física"}
                  {entity.document && (
                    <span className="ml-2 font-mono">{entity.document}</span>
                  )}
                </p>
              </div>
            </div>

            {/* Right: year selector */}
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(parseInt(v))}
            >
              <SelectTrigger className="w-[110px] h-9 text-sm bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
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

          {/* Tab bar */}
          <div className="flex gap-1 mt-5 -mb-px">
            {(
              [
                { id: "overview", label: "Visão Geral", icon: Activity },
                { id: "info", label: "Informações", icon: Info },
              ] as const
            ).map(({ id: tabId, label, icon: Icon }) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tabId
                    ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {activeTab === "overview" && (
          <>
            {/* KPI row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* A Pagar */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Total a Pagar
                    </p>
                    <p className="mt-1.5 text-2xl font-bold font-financial text-rose-600">
                      {formatCurrency(totalPayables)}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950">
                    <TrendingDown className="h-4 w-4 text-rose-500" />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">
                    Pendente:{" "}
                    <span className="font-medium font-financial text-zinc-700 dark:text-zinc-300">
                      {formatCurrency(pendingPayables)}
                    </span>
                  </p>
                </div>
              </div>

              {/* A Receber */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Total a Receber
                    </p>
                    <p className="mt-1.5 text-2xl font-bold font-financial text-emerald-600">
                      {formatCurrency(totalReceivables)}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">
                    Pendente:{" "}
                    <span className="font-medium font-financial text-zinc-700 dark:text-zinc-300">
                      {formatCurrency(pendingReceivables)}
                    </span>
                  </p>
                </div>
              </div>

              {/* Saldo */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Saldo
                    </p>
                    <p
                      className={`mt-1.5 text-2xl font-bold font-financial ${balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {formatCurrency(balance)}
                    </p>
                  </div>
                  <div
                    className={`p-2 rounded-lg ${balance >= 0 ? "bg-emerald-50 dark:bg-emerald-950" : "bg-rose-50 dark:bg-rose-950"}`}
                  >
                    {balance >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-rose-500" />
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">Receitas − Despesas</p>
                </div>
              </div>

              {/* Transações */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Transações
                    </p>
                    <p className="mt-1.5 text-2xl font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                      {yearTransactions.length}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <FileText className="h-4 w-4 text-zinc-500" />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">Em {selectedYear}</p>
                </div>
              </div>
            </div>

            {/* Charts row */}
            <div className="grid gap-4 lg:grid-cols-7">
              {/* Area chart */}
              <div className="lg:col-span-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Movimentação Mensal
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{selectedYear}</p>
                </div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={monthlyTrendData}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="gradPayables"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#f43f5e"
                            stopOpacity={0.18}
                          />
                          <stop
                            offset="100%"
                            stopColor="#f43f5e"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="gradReceivables"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#10b981"
                            stopOpacity={0.18}
                          />
                          <stop
                            offset="100%"
                            stopColor="#10b981"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e4e4e7"
                        strokeOpacity={0.6}
                      />
                      <XAxis
                        dataKey="name"
                        stroke="#a1a1aa"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#71717a" }}
                      />
                      <YAxis
                        stroke="#a1a1aa"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#71717a" }}
                        tickFormatter={(v) =>
                          Math.abs(v) >= 1000
                            ? `R$${(v / 1000).toFixed(0)}k`
                            : `R$${v}`
                        }
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="rounded-lg border border-zinc-200 bg-white shadow-lg px-3 py-2 text-xs space-y-1">
                                <p className="font-semibold text-zinc-700 capitalize">
                                  {label}
                                </p>
                                <p className="text-rose-600 font-financial">
                                  Despesas:{" "}
                                  {formatCurrency(
                                    (payload[0]?.value as number) || 0,
                                  )}
                                </p>
                                <p className="text-emerald-600 font-financial">
                                  Receitas:{" "}
                                  {formatCurrency(
                                    (payload[1]?.value as number) || 0,
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
                        stroke="#f43f5e"
                        strokeWidth={2}
                        fill="url(#gradPayables)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#f43f5e" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="receivables"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#gradReceivables)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#10b981" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-5 mt-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 rounded bg-rose-500" />
                    <span className="text-xs text-zinc-500">Despesas</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 rounded bg-emerald-500" />
                    <span className="text-xs text-zinc-500">Receitas</span>
                  </div>
                </div>
              </div>

              {/* Pie chart */}
              <div className="lg:col-span-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Status das Transações
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{selectedYear}</p>
                </div>
                {statusDistribution.length > 0 ? (
                  <>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusDistribution}
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={78}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {statusDistribution.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={entry.color}
                                stroke="transparent"
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(v) => [`${v} transações`]}
                            contentStyle={{
                              borderRadius: "8px",
                              border: "1px solid #e4e4e7",
                              fontSize: "12px",
                              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06)",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 space-y-2">
                      {statusDistribution.map((entry, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                              {entry.name}
                            </span>
                          </div>
                          <span className="text-xs font-semibold font-financial text-zinc-800 dark:text-zinc-200">
                            {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-60 text-sm text-zinc-400">
                    Nenhuma transação encontrada
                  </div>
                )}
              </div>
            </div>

            {/* Transactions table */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Últimas Transações
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Movimentações mais recentes com esta entidade em{" "}
                  {selectedYear}
                </p>
              </div>
              {recentTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          Data
                        </th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          Descrição
                        </th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          Tipo
                        </th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          Valor
                        </th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTransactions.map((tx, i) => {
                        const displayDate =
                          tx.status === "paid" && tx.paymentDate
                            ? tx.paymentDate
                            : tx.dueDate;
                        const isPayable = tx.type === "payable";
                        return (
                          <tr
                            key={tx.id}
                            className={`border-b border-zinc-50 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors ${
                              i === recentTransactions.length - 1
                                ? "border-b-0"
                                : ""
                            }`}
                          >
                            <td className="px-5 py-3.5 text-xs text-zinc-500 font-mono whitespace-nowrap">
                              {format(displayDate, "dd/MM/yyyy")}
                            </td>
                            <td className="px-5 py-3.5 text-sm font-medium text-zinc-800 dark:text-zinc-200 max-w-60 truncate">
                              {tx.description}
                            </td>
                            <td className="px-5 py-3.5">
                              {isPayable ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                                  <TrendingDown className="h-3 w-3" />A Pagar
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                                  <TrendingUp className="h-3 w-3" />A Receber
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-5 py-3.5 text-sm font-semibold font-financial text-right whitespace-nowrap ${
                                isPayable ? "text-rose-600" : "text-emerald-600"
                              }`}
                            >
                              {isPayable ? "−" : "+"}
                              {formatCurrency(tx.amount)}
                            </td>
                            <td className="px-5 py-3.5">
                              {getStatusBadge(tx.status)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-zinc-400">
                  Nenhuma transação encontrada para esta entidade em{" "}
                  {selectedYear}.
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "info" && (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Contact */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <User className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Contato
                </h3>
              </div>
              <div className="space-y-3">
                {entity.email ? (
                  <div className="flex items-center gap-3">
                    <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                        E-mail
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                        {entity.email}
                      </p>
                    </div>
                  </div>
                ) : null}
                {entity.phone ? (
                  <div className="flex items-center gap-3">
                    <Phone className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                        Telefone
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium font-mono">
                        {entity.phone}
                      </p>
                    </div>
                  </div>
                ) : null}
                {!entity.email && !entity.phone && (
                  <p className="text-sm text-zinc-400">
                    Nenhuma informação de contato cadastrada.
                  </p>
                )}
              </div>
            </div>

            {/* Bank */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <Banknote className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Dados Bancários
                </h3>
              </div>
              <div className="space-y-3">
                {entity.pixKey ? (
                  <div className="flex items-start gap-3">
                    <CreditCard className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                        Chave PIX
                        {entity.pixKeyType && (
                          <span className="ml-1 normal-case">
                            (
                            {entity.pixKeyType === "cpf"
                              ? "CPF"
                              : entity.pixKeyType === "cnpj"
                                ? "CNPJ"
                                : entity.pixKeyType === "email"
                                  ? "E-mail"
                                  : entity.pixKeyType === "phone"
                                    ? "Telefone"
                                    : "Aleatória"}
                            )
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium font-mono break-all">
                        {entity.pixKey}
                      </p>
                    </div>
                  </div>
                ) : null}
                {entity.bankName ? (
                  <div className="flex items-start gap-3">
                    <Building2 className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                        Banco
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                        {entity.bankName}
                      </p>
                      {(entity.agency || entity.account) && (
                        <p className="text-xs text-zinc-500 font-mono mt-0.5">
                          {entity.agency && `Ag. ${entity.agency}`}
                          {entity.agency && entity.account && " · "}
                          {entity.account && `Cc. ${entity.account}`}
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
                {!entity.pixKey && !entity.bankName && (
                  <p className="text-sm text-zinc-400">
                    Nenhuma informação bancária cadastrada.
                  </p>
                )}
              </div>
            </div>

            {/* General info */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <FileText className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Informações Gerais
                </h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Building2 className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <div>
                    <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                      Tipo
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                      {entity.type === "company"
                        ? "Pessoa Jurídica"
                        : "Pessoa Física"}
                    </p>
                  </div>
                </div>
                {entity.document && (
                  <div className="flex items-center gap-3">
                    <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                        {entity.type === "company" ? "CNPJ" : "CPF"}
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium font-mono">
                        {entity.document}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Wallet className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <div>
                    <p className="text-[11px] text-zinc-400 uppercase tracking-wide">
                      Categoria
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border mt-0.5 ${catCfg.bg} ${catCfg.color}`}
                    >
                      {catCfg.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
