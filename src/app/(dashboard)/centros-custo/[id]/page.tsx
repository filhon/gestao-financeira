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
  HandCoins,
  Pencil,
  Receipt,
  TrendingDown,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  committedOf,
  costCenterLedgerService,
} from "@/lib/services/costCenterLedgerService";
import { costCenterService } from "@/lib/services/costCenterService";
import { budgetRequestService } from "@/lib/services/budgetRequestService";
import { transactionService } from "@/lib/services/transactionService";
import {
  BudgetRequest,
  CostCenter,
  CostCenterBalance,
  Transaction,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CostCenterFormDialog } from "@/components/features/finance/CostCenterFormDialog";
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
import { formatCurrency, formatPercent } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import type { MonthlyPoint } from "@/components/features/finance/CostCenterCharts";

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
      <Skeleton className="h-[300px] w-full rounded-xl" />
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
  const { onlyOwnPayables, canManageCostCenters, canCreatePayables } =
    usePermissions();

  const id = params.id as string;

  // Recarrega estrutura e exercício: depois de editar o centro, ou no "Tentar
  // novamente" quando o razão falha.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestAmount, setRequestAmount] = useState(0);
  const [requestReason, setRequestReason] = useState("");

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
  }, [selectedCompany, id, user, reloadKey]);

  useEffect(() => {
    if (!selectedCompany || !id) return;
    budgetRequestService
      .getByCostCenter(selectedCompany.id, id)
      .then(setRequests)
      .catch((error) => console.error("Error loading budget requests:", error));
  }, [selectedCompany, id, reloadKey]);

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

      // Falha do razão vira erro na tela: mostrar "sem envelope" e R$ 0 seria
      // afirmar um saldo que ninguém leu.
      if (ledgerResult.status === "fulfilled") {
        setBalances(ledgerResult.value);
        setLedgerError(null);
      } else {
        console.error(
          "Error loading cost center balances:",
          ledgerResult.reason,
        );
        setBalances({});
        setLedgerError(
          ledgerResult.reason instanceof Error
            ? ledgerResult.reason.message
            : "Não foi possível ler o saldo deste centro.",
        );
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
    reloadKey,
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
  const committedRatio = committedOf(balance).ratio;

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

  /**
   * Projeção até dezembro pelo ritmo do ano: média mensal do gasto lançado
   * até o mês corrente. Só em folha (é onde há gasto direto) e no exercício
   * corrente, que é o único que ainda pode mudar.
   *
   * ponytail: ritmo linear, ignora sazonalidade (13º, férias, obra por fase).
   * Trocar por orçamento mensal quando o envelope ganhar distribuição por mês.
   */
  const projection = useMemo(() => {
    if (hasChildren || selectedYear !== currentYear || totalBudget <= 0)
      return null;
    if (monthlyTrendData.length === 0) return null;
    const spentSoFar = monthlyTrendData.reduce((acc, p) => acc + p.amount, 0);
    const perMonth = spentSoFar / monthlyTrendData.length;
    if (perMonth <= 0) return null;

    // O comprometido já inclui despesas futuras lançadas; o ritmo nunca
    // projeta menos do que isso.
    const yearEnd = Math.max(directCommitted, perMonth * 12);
    const exhaustMonth = Math.ceil(totalBudget / perMonth) - 1;
    return {
      perMonth,
      leftover: totalBudget - yearEnd,
      exhaustsIn:
        yearEnd > totalBudget && exhaustMonth <= 11
          ? format(
              new Date(currentYear, Math.max(exhaustMonth, 0), 1),
              "MMMM",
              {
                locale: ptBR,
              },
            )
          : null,
    };
  }, [
    hasChildren,
    selectedYear,
    currentYear,
    totalBudget,
    monthlyTrendData,
    directCommitted,
  ]);

  const pendingRequest = requests.find((r) => r.status === "pending");

  const submitRequest = async () => {
    if (!selectedCompany || !user) return;
    try {
      await budgetRequestService.create({
        companyId: selectedCompany.id,
        costCenterId: id,
        year: selectedYear,
        amount: requestAmount,
        reason: requestReason,
        requestedBy: user.uid,
        requestedByName: user.displayName || user.email,
      });
      toast.success("Pedido enviado. O gestor financeiro foi avisado.");
      setRequestAmount(0);
      setRequestReason("");
      reload();
    } catch (error) {
      toast.error(friendlyError(error, "Não foi possível enviar o pedido."));
      throw error;
    }
  };

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

  const parentCc = allCostCenters.find((cc) => cc.id === costCenter.parentId);
  // Pedido só faz sentido onde a despesa é lançada: folha, e por quem lança
  // mas não distribui (o gestor ajusta o envelope direto na árvore).
  const canRequest =
    !hasChildren && canCreatePayables && !canManageCostCenters && !!parentCc;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            className="hidden shrink-0 md:inline-flex"
            asChild
          >
            <Link href="/centros-custo">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Centros de custo</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-xl font-bold tracking-tight md:text-2xl">
              {costCenter.name}
              {costCenter.archived && (
                <Badge variant="secondary">Arquivado</Badge>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-mono">{costCenter.code}</span>
              {parentCc && (
                <>
                  <span aria-hidden="true" className="mx-1.5">
                    ·
                  </span>
                  abaixo de{" "}
                  <Link
                    href={`/centros-custo/${parentCc.id}`}
                    className="text-foreground hover:underline"
                  >
                    {parentCc.name}
                  </Link>
                </>
              )}
              {costCenter.approverEmail && (
                <>
                  <span aria-hidden="true" className="mx-1.5">
                    ·
                  </span>
                  Aprovador: {costCenter.approverEmail}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRequest && (
            <Button
              variant="outline"
              onClick={() => setRequestOpen(true)}
              disabled={!!pendingRequest}
              title={
                pendingRequest
                  ? "Já existe um pedido aguardando decisão"
                  : undefined
              }
            >
              <HandCoins className="mr-2 h-4 w-4" />
              Pedir suplementação
            </Button>
          )}
          {canManageCostCenters && (
            <>
              <Button variant="outline" asChild>
                <Link href="/centros-custo/distribuicao">
                  <Wallet className="mr-2 h-4 w-4" />
                  Distribuir
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            </>
          )}
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
      </div>

      {canManageCostCenters && (
        <CostCenterFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editing={costCenter}
          costCenters={allCostCenters}
          onSaved={reload}
        />
      )}

      <ConfirmDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title={`Pedir suplementação para ${costCenter.name}`}
        description={`O valor sai do envelope de ${parentCc?.name ?? "do centro pai"} se o gestor financeiro aprovar. Exercício ${selectedYear}.`}
        confirmText="Enviar pedido"
        confirmDisabled={!(requestAmount > 0) || !requestReason.trim()}
        onConfirm={submitRequest}
      >
        <div className="space-y-3">
          <CurrencyInput
            value={requestAmount}
            onChange={setRequestAmount}
            aria-label="Valor pedido"
            placeholder="0,00"
          />
          <Textarea
            value={requestReason}
            onChange={(e) => setRequestReason(e.target.value)}
            placeholder="Para que é o recurso"
            aria-label="Motivo do pedido"
          />
        </div>
      </ConfirmDialog>

      {pendingRequest && (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
          <HandCoins className="h-4 w-4 shrink-0 text-amber-600" />
          Pedido de {formatCurrency(pendingRequest.amount)} de{" "}
          {pendingRequest.requestedByName} aguardando o gestor financeiro.
        </p>
      )}

      {isLoadingYear ? (
        <DataSkeleton />
      ) : ledgerError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Não foi possível ler o saldo</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ledgerError}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={reload}
              >
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
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
                    ? `${formatPercent(remainingBalance / totalBudget)} do envelope`
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
                    {formatPercent(committedRatio)} comprometido
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

                {projection && (
                  <p
                    className={`flex items-start gap-2 border-t pt-3 text-sm ${
                      projection.exhaustsIn
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    <TrendingDown
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>
                      No ritmo do ano ({formatCurrency(projection.perMonth)} por
                      mês),{" "}
                      {projection.exhaustsIn
                        ? `o envelope acaba em ${projection.exhaustsIn}. Faltariam ${formatCurrency(-projection.leftover)} até dezembro.`
                        : `sobram ${formatCurrency(projection.leftover)} em dezembro.`}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          <Card>
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
                      <TableHead className="text-right">Disponível</TableHead>
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
                        <TableCell className="text-right font-financial tabular-nums">
                          {formatCurrency(balances[child.id]?.received ?? 0)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-financial tabular-nums ${
                            (balances[child.id]?.available ?? 0) < 0
                              ? "text-destructive"
                              : ""
                          }`}
                        >
                          {formatCurrency(balances[child.id]?.available ?? 0)}
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
