"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  ArrowLeft,
  FolderTree,
  Receipt,
  TrendingDown,
} from "lucide-react";

import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { costCenterLedgerService } from "@/lib/services/costCenterLedgerService";
import { costCenterService } from "@/lib/services/costCenterService";
import { transactionService } from "@/lib/services/transactionService";
import { CostCenter, CostCenterBalance, Transaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type {
  CompositionSlice,
  MonthlyPoint,
} from "@/components/features/finance/CostCenterCharts";

// recharts entra num chunk separado: o envelope e os números do topo renderizam
// sem esperar a biblioteca de gráficos.
const SpendingTrendChart = dynamic(
  () =>
    import("@/components/features/finance/CostCenterCharts").then(
      (m) => m.SpendingTrendChart,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full sm:h-[300px]" />,
  },
);

const EnvelopeCompositionChart = dynamic(
  () =>
    import("@/components/features/finance/CostCenterCharts").then(
      (m) => m.EnvelopeCompositionChart,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full sm:h-[300px]" />,
  },
);

/** Rótulo de seção. `CardTitle` renderiza uma div, então não serve como heading. */
function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className="leading-none font-semibold">
      {children}
    </h2>
  );
}

function DataSkeleton() {
  return (
    <div className="space-y-6" role="status">
      <span className="sr-only">Carregando dados do exercício…</span>
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap gap-x-12 gap-y-5 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t px-5 py-4">
          <Skeleton className="h-4 w-full max-w-xs" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Skeleton className="h-[300px] w-full rounded-xl lg:col-span-4" />
        <Skeleton className="h-[300px] w-full rounded-xl lg:col-span-3" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-44" />
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CostCenterDashboard() {
  const params = useParams();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  const id = params.id as string;

  // Estrutura do centro: não depende do exercício, então não recarrega quando o
  // ano muda.
  const [costCenter, setCostCenter] = useState<CostCenter | null>(null);
  const [children, setChildren] = useState<CostCenter[]>([]);
  const [allCostCenters, setAllCostCenters] = useState<CostCenter[]>([]);
  const [isLoadingStructure, setIsLoadingStructure] = useState(true);

  // Dados do exercício selecionado.
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [balances, setBalances] = useState<Record<string, CostCenterBalance>>(
    {},
  );
  /** Despesas do exercício: alimentam a série mensal e a lista de despesas. */
  const [yearPayables, setYearPayables] = useState<Transaction[]>([]);
  const [isLoadingYear, setIsLoadingYear] = useState(true);

  useEffect(() => {
    if (!selectedCompany || !id || !user) return;
    let cancelled = false;

    setIsLoadingStructure(true);
    (async () => {
      try {
        const [cc, kids, all] = await Promise.all([
          costCenterService.getById(id),
          costCenterService.getChildren(id),
          costCenterService.getAll(selectedCompany.id),
        ]);
        if (cancelled) return;
        setCostCenter(cc);
        setChildren(kids);
        setAllCostCenters(all);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading cost center:", error);
        setCostCenter(null);
      } finally {
        if (!cancelled) setIsLoadingStructure(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompany, id, user]);

  useEffect(() => {
    if (!selectedCompany || !id || !user || isLoadingStructure) return;

    // Sem a árvore não há razão a consultar. Encerra o carregamento em vez de
    // deixar o skeleton preso esperando um dado que não vem.
    if (allCostCenters.length === 0) {
      setBalances({});
      setYearPayables([]);
      setIsLoadingYear(false);
      return;
    }

    let cancelled = false;

    setIsLoadingYear(true);
    (async () => {
      // Papel 'user' só enxerga os próprios lançamentos; sem isto a consulta
      // esbarra nas regras do Firestore em vez de retornar subconjunto.
      const createdBy = onlyOwnPayables ? user.uid : undefined;
      const start = new Date(selectedYear, 0, 1);
      const end = new Date(selectedYear, 11, 31, 23, 59, 59);

      // Duas consultas porque uma despesa paga pertence ao exercício do
      // pagamento, que pode cair fora da faixa de vencimento. `allSettled`
      // para que a falha do razão não derrube a lista de despesas.
      const [ledgerResult, byDueResult, byPaymentResult] =
        await Promise.allSettled([
          costCenterLedgerService.getBalances(
            selectedCompany.id,
            allCostCenters,
            selectedYear,
          ),
          transactionService.getAll({
            companyId: selectedCompany.id,
            costCenterId: id,
            type: "payable",
            startDate: start,
            endDate: end,
            createdBy,
          }),
          transactionService.getByPaymentDate({
            companyId: selectedCompany.id,
            costCenterId: id,
            startDate: start,
            endDate: end,
            createdBy,
          }),
        ]);
      if (cancelled) return;

      if (ledgerResult.status === "fulfilled") {
        setBalances(ledgerResult.value);
      } else {
        console.error(
          "Error loading cost center balances:",
          ledgerResult.reason,
        );
        setBalances({});
      }

      const unique = new Map<string, Transaction>();
      for (const result of [byDueResult, byPaymentResult]) {
        if (result.status === "fulfilled") {
          result.value.forEach((t) => unique.set(t.id, t));
        } else {
          console.error("Error loading transactions:", result.reason);
        }
      }
      setYearPayables([...unique.values()]);
      setIsLoadingYear(false);
    })().catch((error) => {
      if (cancelled) return;
      console.error("Error loading year data:", error);
      setIsLoadingYear(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    selectedCompany,
    id,
    user,
    selectedYear,
    allCostCenters,
    onlyOwnPayables,
    isLoadingStructure,
  ]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const isPastYear = selectedYear < currentYear;

  // Tudo abaixo sai do razão de envelope — a mesma fonte da tela de
  // distribuição, do formulário de despesa e da listagem de centros.
  const balance = balances[id];
  const carryIn = balance?.carryIn ?? 0;

  // O recurso do exercício: receitas (se raiz) ou envelope do pai, mais a
  // sobra consolidada do ano anterior.
  const totalBudget = (balance?.received ?? 0) + carryIn;

  // Realizado = despesa direta já paga; comprometido inclui as pendentes.
  const directRealized = balance?.spentDirectPaid ?? 0;
  const directCommitted = balance?.spentDirect ?? 0;
  const directPending = directCommitted - directRealized;

  // O que o pai entregou aos filhos sai do bolso dele no momento da
  // distribuição, tenha o filho gasto ou não — é essa a regra do envelope.
  const hasChildren = children.length > 0;
  const allocatedToChildren = balance?.allocatedToChildren ?? 0;
  const totalConsumed = allocatedToChildren + directCommitted;

  // Gasto de toda a subárvore, só informativo: não entra na conta do saldo.
  const subtreeSpent = balance?.subtreeSpent ?? 0;
  const remainingBalance = balance?.available ?? 0;

  const monthsRemaining =
    selectedYear === currentYear
      ? 12 - now.getMonth()
      : selectedYear > currentYear
        ? 12
        : 0;
  const suggestedMonthlySpend =
    monthsRemaining > 0 ? remainingBalance / monthsRemaining : 0;

  /** Parcela rateada desta transação para este centro de custo. */
  const allocatedAmount = useMemo(
    () => (tx: Transaction) =>
      tx.costCenterAllocation?.find((a) => a.costCenterId === id)?.amount ??
      (tx.costCenterId === id ? (tx.finalAmount ?? tx.amount) : 0),
    [id],
  );

  // Série mensal com a mesma regra de exercício do razão: a despesa pertence ao
  // mês do pagamento quando está paga, e ao do vencimento quando não. Assim a
  // soma das barras fecha com o gasto direto do ano.
  const monthlyTrendData: MonthlyPoint[] = useMemo(() => {
    // Ano corrente para no mês atual: meses que ainda não aconteceram apareceriam
    // como gasto zero, o que se lê como "não gastou" em vez de "não chegou".
    const lastMonth =
      selectedYear < currentYear
        ? 11
        : selectedYear > currentYear
          ? -1
          : new Date().getMonth();
    if (lastMonth < 0) return [];

    const totals = new Array<number>(lastMonth + 1).fill(0);
    let hasAny = false;

    for (const tx of yearPayables) {
      // `getByPaymentDate` não filtra por tipo, então um recebimento quitado
      // chega aqui junto — sem esta guarda ele entraria como gasto.
      if (tx.type !== "payable" || tx.status === "rejected") continue;

      const effective =
        tx.status === "paid" && tx.paymentDate ? tx.paymentDate : tx.dueDate;
      if (!effective || effective.getFullYear() !== selectedYear) continue;

      const month = effective.getMonth();
      if (month > lastMonth) continue;

      const amount = allocatedAmount(tx);
      if (!amount) continue;

      totals[month] += amount;
      hasAny = true;
    }

    if (!hasAny) return [];

    // Meses sem lançamento entram como zero: a linha do ano fica contínua em
    // vez de ligar janeiro direto em setembro.
    return totals.map((amount, monthIndex) => ({
      monthIndex,
      name: format(new Date(selectedYear, monthIndex, 1), "MMM", {
        locale: ptBR,
      }),
      amount,
    }));
  }, [yearPayables, selectedYear, currentYear, allocatedAmount]);

  const compositionData: CompositionSlice[] = useMemo(() => {
    const slices: CompositionSlice[] = [];
    if (hasChildren && allocatedToChildren > 0) {
      slices.push({
        name: "Distribuído aos filhos",
        value: allocatedToChildren,
        color: "var(--state-allocated)",
      });
    }
    if (directRealized > 0) {
      slices.push({
        name: "Realizado",
        value: directRealized,
        color: "var(--state-spent)",
      });
    }
    if (directPending > 0) {
      slices.push({
        name: "Pendente",
        value: directPending,
        color: "var(--state-committed)",
      });
    }
    if (remainingBalance > 0) {
      slices.push({
        name: "Disponível",
        value: remainingBalance,
        color: "var(--state-positive)",
      });
    }
    return slices;
  }, [
    hasChildren,
    allocatedToChildren,
    directRealized,
    directPending,
    remainingBalance,
  ]);

  // Mesma fonte da série mensal: a lista não pode discordar do gráfico, e a
  // consulta já vem filtrada por centro de custo no servidor.
  const listedExpenses = useMemo(() => {
    const reference = new Date();
    const past = selectedYear < reference.getFullYear();
    return yearPayables
      .filter((t) => {
        if (t.type !== "payable" || t.status === "rejected") return false;
        const effective =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        if (!effective || effective.getFullYear() !== selectedYear)
          return false;
        return past || (t.status !== "paid" && t.dueDate >= reference);
      })
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 5);
  }, [yearPayables, selectedYear]);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  // Larguras dos segmentos, encadeadas para nunca somarem mais que a barra.
  const pctOf = (value: number) =>
    totalBudget > 0
      ? Math.max(0, Math.min((value / totalBudget) * 100, 100))
      : 0;
  const allocatedPct = pctOf(allocatedToChildren);
  const realizedPct = Math.min(pctOf(directRealized), 100 - allocatedPct);
  const pendingPct = Math.min(
    pctOf(directPending),
    100 - allocatedPct - realizedPct,
  );

  type LegendItem = {
    key: string;
    label: string;
    value: number;
    swatch: string;
    valueClass: string;
  };
  const legendItems: LegendItem[] = [];
  if (hasChildren) {
    legendItems.push({
      key: "allocated",
      label: "Distribuído aos filhos",
      value: allocatedToChildren,
      swatch: "bg-state-allocated",
      valueClass: "text-foreground",
    });
  }
  if (directRealized > 0) {
    legendItems.push({
      key: "realized",
      label: "Realizado",
      value: directRealized,
      swatch: "bg-state-spent",
      valueClass: "text-foreground",
    });
  }
  if (directPending > 0) {
    legendItems.push({
      key: "pending",
      label: "Pendente",
      value: directPending,
      swatch: "bg-state-committed",
      valueClass: "text-foreground",
    });
  }
  legendItems.push({
    key: "available",
    label: "Disponível",
    value: Math.max(0, remainingBalance),
    swatch: "bg-state-positive",
    valueClass:
      remainingBalance < 0 ? "text-destructive" : "text-state-positive",
  });

  if (isLoadingStructure) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-[110px]" />
        </div>
        <DataSkeleton />
      </div>
    );
  }

  if (!costCenter) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Centro de custo não encontrado"
        description="Ele pode ter sido excluído, ou pertence a outra empresa. Verifique a empresa selecionada no topo."
        action={{ label: "Voltar", onClick: () => router.back() }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            className="hidden shrink-0 md:inline-flex"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Voltar</span>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">
              {costCenter.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-mono">{costCenter.code}</span>
              {costCenter.approverEmail && (
                <>
                  <span aria-hidden="true" className="mx-1.5">
                    ·
                  </span>
                  Responsável: {costCenter.approverEmail}
                </>
              )}
            </p>
          </div>
        </div>
        <Select
          value={selectedYear.toString()}
          onValueChange={(value) => setSelectedYear(parseInt(value))}
        >
          <SelectTrigger className="w-[110px]" aria-label="Exercício">
            <SelectValue />
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

      {isLoadingYear ? (
        <DataSkeleton />
      ) : (
        <>
          <section
            aria-labelledby="envelope-title"
            className="rounded-lg border bg-card"
          >
            <div className="flex flex-wrap items-baseline gap-x-12 gap-y-5 p-5">
              <div>
                <h2
                  id="envelope-title"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Envelope de {selectedYear}
                </h2>
                <p className="mt-1 font-financial text-2xl font-semibold tracking-tight sm:text-3xl">
                  {formatCurrency(totalBudget)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {balance?.isRoot
                    ? "Receitas do exercício"
                    : "Recebido do centro pai"}
                  {carryIn !== 0 &&
                    ` + ${formatCurrency(carryIn)} do ano anterior`}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Saldo disponível
                </h2>
                <p
                  className={`mt-1 font-financial text-2xl font-semibold tracking-tight sm:text-3xl ${
                    remainingBalance < 0
                      ? "text-destructive"
                      : "text-state-positive"
                  }`}
                >
                  {formatCurrency(remainingBalance)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totalBudget > 0
                    ? `${((remainingBalance / totalBudget) * 100).toFixed(1)}% do envelope`
                    : "Sem envelope neste exercício"}
                  {monthsRemaining > 0 && remainingBalance > 0 && (
                    <>
                      <span aria-hidden="true" className="mx-1">
                        ·
                      </span>
                      {formatCurrency(suggestedMonthlySpend)} por mês nos{" "}
                      {monthsRemaining === 1
                        ? "último mês"
                        : `${monthsRemaining} meses restantes`}
                    </>
                  )}
                </p>
              </div>
            </div>

            {totalBudget > 0 && (
              <div className="space-y-3 border-t px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Uso do envelope</span>
                  <span className="font-financial text-muted-foreground">
                    {((totalConsumed / totalBudget) * 100).toFixed(1)}%
                    comprometido
                  </span>
                </div>

                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                  {allocatedPct > 0 && (
                    <div
                      className="h-full bg-state-allocated"
                      style={{ width: `${allocatedPct}%` }}
                      title={`Distribuído aos filhos: ${formatCurrency(allocatedToChildren)}`}
                    />
                  )}
                  {realizedPct > 0 && (
                    <div
                      className="h-full bg-state-spent"
                      style={{ width: `${realizedPct}%` }}
                      title={`Realizado: ${formatCurrency(directRealized)}`}
                    />
                  )}
                  {pendingPct > 0 && (
                    <div
                      className="h-full bg-state-committed"
                      style={{ width: `${pendingPct}%` }}
                      title={`Comprometido pendente: ${formatCurrency(directPending)}`}
                    />
                  )}
                </div>

                <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  {legendItems.map((item) => (
                    <li key={item.key} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`size-2.5 shrink-0 rounded-sm ${item.swatch}`}
                      />
                      {item.label}:{" "}
                      <span
                        className={`font-financial font-medium ${item.valueClass}`}
                      >
                        {formatCurrency(item.value)}
                      </span>
                    </li>
                  ))}
                  {/* Fora da barra: o gasto da subárvore não consome o envelope
                      do pai — quem consome é a distribuição. */}
                  {hasChildren && (
                    <li className="flex items-center gap-1.5">
                      <TrendingDown
                        aria-hidden="true"
                        className="size-3 shrink-0"
                      />
                      Gasto na subárvore:{" "}
                      <span className="font-financial font-medium text-foreground">
                        {formatCurrency(subtreeSpent)}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <SectionHeading>
                  Tendência de gastos em {selectedYear}
                </SectionHeading>
              </CardHeader>
              <CardContent className="pl-2">
                {monthlyTrendData.length > 0 ? (
                  <SpendingTrendChart
                    data={monthlyTrendData}
                    year={selectedYear}
                  />
                ) : (
                  <div className="flex h-[220px] items-center justify-center px-4 text-center text-sm text-muted-foreground sm:h-[300px]">
                    Nenhuma despesa lançada neste centro em {selectedYear}.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <SectionHeading>Composição do envelope</SectionHeading>
              </CardHeader>
              <CardContent>
                {compositionData.length > 0 ? (
                  <EnvelopeCompositionChart
                    data={compositionData}
                    year={selectedYear}
                  />
                ) : (
                  <div className="flex h-[220px] items-center justify-center px-4 text-center text-sm text-muted-foreground sm:h-[300px]">
                    Este centro não recebeu envelope em {selectedYear}.
                    Distribua recurso do centro pai para ver a composição.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <section aria-labelledby="filhos-title">
              <SectionHeading id="filhos-title">
                Centros de custo filhos
              </SectionHeading>
              {hasChildren ? (
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="text-right">
                        Envelope {selectedYear}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {children.map((child) => (
                      <TableRow key={child.id} className="relative">
                        <TableCell className="font-medium">
                          {/* O ::after estende o alvo de clique por toda a
                              linha sem abrir mão do link real: teclado, foco e
                              abrir em nova aba continuam funcionando. */}
                          <Link
                            href={`/centros-custo/${child.id}`}
                            className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {child.name}
                          </Link>
                          {child.code && (
                            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                              {child.code}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-financial">
                          {formatCurrency(balances[child.id]?.received ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={FolderTree}
                  title="Centro de folha"
                  description="Não há centros abaixo deste, então as despesas são lançadas diretamente aqui."
                />
              )}
            </section>

            <section aria-labelledby="despesas-title">
              <SectionHeading id="despesas-title">
                {isPastYear
                  ? `Despesas de ${selectedYear}`
                  : "Próximas despesas"}
              </SectionHeading>
              {listedExpenses.length > 0 ? (
                <ul className="mt-3 divide-y border-t">
                  {listedExpenses.map((tx) => (
                    <li
                      key={tx.id}
                      className="flex items-baseline justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {tx.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Vence em {format(tx.dueDate, "dd/MM/yyyy")}
                        </p>
                      </div>
                      <span className="shrink-0 font-financial text-sm font-semibold text-state-spent">
                        {formatCurrency(allocatedAmount(tx))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Receipt}
                  title={
                    isPastYear
                      ? "Nenhuma despesa no período"
                      : "Nenhuma despesa prevista"
                  }
                  description={
                    isPastYear
                      ? `Nenhum lançamento deste centro em ${selectedYear}.`
                      : "As despesas com vencimento a partir de hoje aparecem aqui assim que forem lançadas."
                  }
                />
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
