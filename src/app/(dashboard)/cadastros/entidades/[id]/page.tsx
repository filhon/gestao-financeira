"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import currency from "currency.js";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { doc, getDoc } from "firebase/firestore";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "@/lib/firebase/client";
import { convertEntity, entityService } from "@/lib/services/entityService";
import { transactionService } from "@/lib/services/transactionService";
import { effectiveAmount } from "@/lib/services/paymentBatchService";
import { ENTITY_BANK_FIELDS, Transaction } from "@/lib/types";
import { isOpen, isOverdue } from "@/lib/transactionTabs";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/features/finance/TransactionList";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { EntityFormSheet } from "@/components/features/entities/EntityFormSheet";
import {
  CategoryBadge,
  EntityFlags,
  PAYMENT_METHOD_LABELS,
  PIX_KEY_TYPE_LABELS,
  TAX_REGIME_LABELS,
  displayDocument,
  documentKind,
  hasBankDetails,
  isActive,
} from "@/components/features/entities/entityDisplay";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCostCenters } from "@/hooks/useCostCenters";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";

type Kind = "payable" | "receivable";

const KIND_LABEL: Record<Kind, string> = {
  payable: "A pagar",
  receivable: "A receber",
};

const BANK_FIELD_LABELS: Record<(typeof ENTITY_BANK_FIELDS)[number], string> = {
  pixKey: "Chave PIX",
  pixKeyType: "Tipo da chave",
  bankName: "Banco",
  agency: "Agência",
  account: "Conta",
  accountType: "Tipo de conta",
};

const bankValue = (
  field: (typeof ENTITY_BANK_FIELDS)[number],
  value: string | undefined,
) => {
  if (!value) return "—";
  if (field === "pixKeyType")
    return PIX_KEY_TYPE_LABELS[value as keyof typeof PIX_KEY_TYPE_LABELS];
  if (field === "accountType")
    return value === "savings" ? "Poupança" : "Corrente";
  return value;
};

/** Data que conta para o ano: pagamento quando pago, vencimento quando não. */
const refDate = (t: Transaction) =>
  t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
const amountOf = (t: Transaction) =>
  t.status === "paid"
    ? (t.finalAmount ?? effectiveAmount(t))
    : effectiveAmount(t);

/** Mensagem de erro do serviço escrita para o usuário; o resto vira genérica. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && !("code" in error) ? error.message : fallback;

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 wrap-break-word", mono && "font-financial")}>
        {children}
      </dd>
    </div>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-b py-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <dl>{children}</dl>
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-128 w-full" />
      </div>
    </div>
  );
}

export default function EntityPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const {
    canViewEntities,
    canManageEntities,
    canApproveBankChanges,
    canCreatePayables,
    canCreateReceivables,
    onlyOwnPayables,
  } = usePermissions();
  const { openTransaction } = useTransactionDetailStore();
  const id = params.id as string;
  const companyId = selectedCompany?.id;
  const ownOnly = onlyOwnPayables ? user?.uid : undefined;

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [kindChoice, setKindChoice] = useState<Kind | null>(null);
  const [listTab, setListTab] = useState<"open" | "paid" | "all">("open");

  const entityQuery = useQuery({
    queryKey: ["entity", companyId, id],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "entities", id));
      // Outra empresa conta como inexistente aqui
      if (!snap.exists() || snap.data().companyId !== companyId) return null;
      return convertEntity({ id: snap.id, ...snap.data() });
    },
    enabled: !!companyId && !!id && canViewEntities,
  });
  const entity = entityQuery.data ?? null;

  const txQuery = useQuery({
    queryKey: ["entity-transactions", companyId, id, ownOnly],
    queryFn: () =>
      transactionService.getForEntity(companyId!, entity!, ownOnly),
    enabled: !!entity && !!user,
  });
  const transactions = useMemo(() => txQuery.data ?? [], [txQuery.data]);

  const { accounts } = useChartOfAccounts(companyId);
  const { costCenters } = useCostCenters(companyId);

  const kinds: Kind[] = !entity
    ? []
    : entity.category === "both"
      ? ["payable", "receivable"]
      : [entity.category === "client" ? "receivable" : "payable"];
  // Cadastro "ambos" sem escolha mostra o lado que tem movimento
  const kind: Kind =
    kindChoice ??
    (kinds.length > 1 && !transactions.some((t) => t.type === "payable")
      ? "receivable"
      : (kinds[0] ?? "payable"));

  const today = startOfDay(new Date());
  const position = useMemo(() => {
    const byKind = (k: Kind) => {
      const list = transactions.filter(
        (t) => t.type === k && t.status !== "rejected",
      );
      const open = list.filter(isOpen);
      const sum = (l: Transaction[]) =>
        l.reduce((acc, t) => acc.add(amountOf(t)), currency(0)).value;
      const next = open
        .filter((t) => !isOverdue(t, today))
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      return {
        open: sum(open),
        overdue: sum(open.filter((t) => isOverdue(t, today))),
        next30: sum(
          open.filter(
            (t) => !isOverdue(t, today) && t.dueDate <= addDays(today, 30),
          ),
        ),
        paidYear: sum(
          list.filter(
            (t) => t.status === "paid" && refDate(t).getFullYear() === year,
          ),
        ),
        next,
      };
    };
    return Object.fromEntries(kinds.map((k) => [k, byKind(k)])) as Record<
      Kind,
      ReturnType<typeof byKind>
    >;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, year, kinds.join()]);

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear()]);
    transactions.forEach((t) => set.add(refDate(t).getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [transactions]);

  // Todos os meses do ano, mesmo vazios: o buraco também é informação.
  const monthly = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, m) => ({
      name: format(new Date(year, m, 1), "MMM", { locale: ptBR }),
      paid: currency(0),
      open: currency(0),
    }));
    for (const t of transactions) {
      if (t.type !== kind || t.status === "rejected") continue;
      const d = refDate(t);
      if (d.getFullYear() !== year) continue;
      const m = months[d.getMonth()];
      if (t.status === "paid") m.paid = m.paid.add(amountOf(t));
      else m.open = m.open.add(amountOf(t));
    }
    return months.map((m) => ({
      name: m.name,
      paid: m.paid.value,
      open: m.open.value,
    }));
  }, [transactions, kind, year]);

  const listed = useMemo(() => {
    const ofKind = transactions.filter((t) => t.type === kind);
    if (listTab === "open")
      return ofKind
        .filter(isOpen)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return ofKind
      .filter(
        (t) =>
          refDate(t).getFullYear() === year &&
          (listTab === "all" || t.status === "paid"),
      )
      .sort((a, b) => refDate(b).getTime() - refDate(a).getTime());
  }, [transactions, kind, listTab, year]);

  const openCount = transactions.filter(
    (t) => t.type === kind && isOpen(t),
  ).length;

  if (!canViewEntities) {
    return (
      <div className="py-24 text-center">
        <h2 className="text-lg font-semibold">Acesso negado</h2>
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para ver esta página.
        </p>
      </div>
    );
  }

  if (entityQuery.isLoading || !companyId) return <PageSkeleton />;

  if (entityQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="font-medium">Não foi possível carregar a entidade.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => entityQuery.refetch()}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-medium">Entidade não encontrada nesta empresa.</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/cadastros/entidades">Voltar para entidades</Link>
        </Button>
      </div>
    );
  }

  const actor = user ? { uid: user.uid, email: user.email } : null;
  const refreshEntity = () => {
    queryClient.invalidateQueries({ queryKey: ["entity"] });
    queryClient.invalidateQueries({ queryKey: ["entities-all"] });
  };

  const pending = entity.pendingBankChange;
  const isRequester = pending?.requestedBy === user?.uid;

  const decide = async (action: "approve" | "reject") => {
    if (!actor) return;
    setDeciding(action);
    try {
      if (action === "approve") {
        await entityService.approveBankChange(entity, actor, companyId);
        toast.success(
          "Troca aprovada. Os próximos pagamentos usam os dados novos.",
        );
      } else {
        await entityService.rejectBankChange(entity, actor, companyId);
        toast.success("Troca recusada. Os dados atuais continuam valendo.");
      }
      refreshEntity();
    } catch (error) {
      console.error("Error deciding bank change:", error);
      toast.error(messageOf(error, "Não foi possível registrar a decisão."));
    } finally {
      setDeciding(null);
    }
  };

  const toggleActive = async () => {
    if (!actor) return;
    const active = !isActive(entity);
    try {
      await entityService.setActive([entity], active, actor, companyId);
      toast.success(active ? "Entidade reativada." : "Entidade inativada.");
      refreshEntity();
    } catch (error) {
      console.error("Error toggling entity:", error);
      toast.error("Não foi possível alterar a situação.");
    }
  };

  const newTransactionHref = (k: Kind) =>
    `/financeiro/${k === "payable" ? "contas-pagar" : "contas-receber"}?novo=1&entidade=${entity.id}`;
  const canCreate = (k: Kind) =>
    isActive(entity) &&
    (k === "payable" ? canCreatePayables : canCreateReceivables);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiad${label === "Chave PIX" ? "a" : "o"}.`);
  };

  const w = entity.withholdings;
  const withholdings = [
    w?.irrf != null && `IRRF ${w.irrf}%`,
    w?.pcc != null && `PIS/COFINS/CSLL ${w.pcc}%`,
    w?.inss != null && `INSS ${w.inss}%`,
    w?.iss != null && `ISS ${w.iss}%`,
  ].filter(Boolean);
  const defaultAccount = accounts.find((a) => a.id === entity.defaultAccountId);
  const defaultCostCenter = costCenters.find(
    (c) => c.id === entity.defaultCostCenterId,
  );
  const addressLines = [
    [entity.street, entity.number, entity.complement]
      .filter(Boolean)
      .join(", "),
    entity.district,
    [entity.city, entity.state].filter(Boolean).join(" - "),
    entity.zipCode && `CEP ${entity.zipCode}`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho ── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-0.5 shrink-0"
            onClick={() => router.back()}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                {entity.name}
              </h1>
              <CategoryBadge category={entity.category} />
              <EntityFlags entity={entity} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                entity.tradeName,
                entity.document &&
                  `${documentKind(entity)} ${displayDocument(entity.document)}`,
                entity.taxRegime && TAX_REGIME_LABELS[entity.taxRegime],
                entity.city &&
                  [entity.city, entity.state].filter(Boolean).join("/"),
              ]
                .filter(Boolean)
                .join(" · ") ||
                (entity.type === "company"
                  ? "Pessoa jurídica"
                  : "Pessoa física")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {kinds.filter(canCreate).map((k) => (
            <Button key={k} size="sm" className="h-9" asChild>
              <Link href={newTransactionHref(k)}>
                <Plus className="h-4 w-4" />
                Conta {k === "payable" ? "a pagar" : "a receber"}
              </Link>
            </Button>
          ))}
          {canManageEntities && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    aria-label="Mais ações"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isActive(entity) ? (
                    <DropdownMenuItem
                      onClick={() => setConfirmDeactivate(true)}
                    >
                      <Archive className="mr-2 h-4 w-4" /> Inativar
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={toggleActive}>
                      <ArchiveRestore className="mr-2 h-4 w-4" /> Reativar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>

      {/* ── Troca bancária pendente ── */}
      {pending && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Troca de dados bancários aguardando aprovação
              </h2>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                Pedida por {pending.requestedByEmail} em{" "}
                {format(pending.requestedAt, "dd/MM/yyyy 'às' HH:mm")}. Antes de
                aprovar, confirme com o fornecedor por um telefone ou e-mail já
                conhecido, não pelo contato que pediu a troca.
              </p>
            </div>
            {canApproveBankChanges && !isRequester && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 bg-background"
                  onClick={() => decide("reject")}
                  loading={deciding === "reject"}
                  disabled={!!deciding}
                >
                  <X className="h-3.5 w-3.5" /> Recusar
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => decide("approve")}
                  loading={deciding === "approve"}
                  disabled={!!deciding}
                >
                  <Check className="h-3.5 w-3.5" /> Aprovar troca
                </Button>
              </div>
            )}
            {isRequester && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-900/80 dark:text-amber-200/80">
                  Outra pessoa precisa aprovar.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 bg-background"
                  onClick={() => decide("reject")}
                  loading={deciding === "reject"}
                >
                  Cancelar pedido
                </Button>
              </div>
            )}
          </div>
          <table className="mt-3 w-full max-w-2xl text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-4 font-medium">Campo</th>
                <th className="py-1 pr-4 font-medium">Atual</th>
                <th className="py-1 font-medium">Proposto</th>
              </tr>
            </thead>
            <tbody>
              {ENTITY_BANK_FIELDS.filter(
                (f) => (entity[f] ?? "") !== (pending[f] ?? ""),
              ).map((f) => (
                <tr
                  key={f}
                  className="border-t border-amber-200/70 dark:border-amber-900/60"
                >
                  <td className="py-1.5 pr-4 text-muted-foreground">
                    {BANK_FIELD_LABELS[f]}
                  </td>
                  <td className="py-1.5 pr-4 font-financial line-through decoration-muted-foreground/50">
                    {bankValue(f, entity[f])}
                  </td>
                  <td className="py-1.5 font-financial font-medium">
                    {bankValue(f, pending[f])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {/* ── Posição ── */}
          <section aria-label="Posição financeira">
            {txQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : txQuery.isError ? (
              <div className="flex items-center justify-between rounded-lg border p-4 text-sm">
                <span className="text-destructive">
                  Não foi possível carregar os lançamentos.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => txQuery.refetch()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">
                        <span className="sr-only">Tipo</span>
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Em aberto
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Vencido
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Vence em 30 dias
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        {kinds.length === 1 && kinds[0] === "receivable"
                          ? "Recebido"
                          : "Pago"}{" "}
                        em {year}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Próximo vencimento
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {kinds.map((k) => {
                      const p = position[k];
                      return (
                        <tr key={k} className="border-t">
                          <th
                            scope="row"
                            className="px-4 py-3 text-left font-medium"
                          >
                            {KIND_LABEL[k]}
                          </th>
                          <td className="px-4 py-3 text-right font-financial text-base font-semibold tabular-nums">
                            {formatCurrency(p.open)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right font-financial tabular-nums",
                              p.overdue > 0
                                ? "font-semibold text-destructive"
                                : "text-muted-foreground",
                            )}
                          >
                            {formatCurrency(p.overdue)}
                          </td>
                          <td className="px-4 py-3 text-right font-financial tabular-nums">
                            {formatCurrency(p.next30)}
                          </td>
                          <td className="px-4 py-3 text-right font-financial tabular-nums text-muted-foreground">
                            {formatCurrency(p.paidYear)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {p.next ? (
                              <button
                                type="button"
                                className="text-left hover:text-foreground hover:underline"
                                onClick={() => openTransaction(p.next!)}
                              >
                                <span className="font-financial">
                                  {format(p.next.dueDate, "dd/MM/yyyy")}
                                </span>{" "}
                                · {formatCurrency(amountOf(p.next))}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Movimento mensal ── */}
          <section className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Movimento por mês</h2>
                <p className="text-xs text-muted-foreground">
                  Pago pela data de pagamento; em aberto pelo vencimento.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {kinds.length > 1 && (
                  <Tabs
                    value={kind}
                    onValueChange={(v) => setKindChoice(v as Kind)}
                  >
                    <TabsList className="h-8">
                      <TabsTrigger value="payable" className="text-xs">
                        A pagar
                      </TabsTrigger>
                      <TabsTrigger value="receivable" className="text-xs">
                        A receber
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                <Select
                  value={String(year)}
                  onValueChange={(v) => setYear(Number(v))}
                >
                  <SelectTrigger className="h-8 w-24" aria-label="Ano">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthly}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    tick={{ fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={56}
                    tick={{ fill: "var(--muted-foreground)" }}
                    tickFormatter={(v: number) => formatCurrencyAbbr(v)}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="space-y-0.5 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                          <p className="font-medium capitalize">
                            {label} {year}
                          </p>
                          <p className="font-financial">
                            {kind === "receivable" ? "Recebido" : "Pago"}:{" "}
                            {formatCurrency(Number(payload[0]?.value ?? 0))}
                          </p>
                          <p className="font-financial text-muted-foreground">
                            Em aberto:{" "}
                            {formatCurrency(Number(payload[1]?.value ?? 0))}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar
                    dataKey="paid"
                    stackId="m"
                    fill="var(--chart-cash)"
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="open"
                    stackId="m"
                    fill="var(--chart-cash)"
                    fillOpacity={0.3}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-(--chart-cash)" />
                {kind === "receivable" ? "Recebido" : "Pago"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-(--chart-cash) opacity-30" />
                Em aberto
              </span>
            </div>
          </section>

          {/* ── Lançamentos ── */}
          <section className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                Lançamentos
                {kinds.length > 1 && ` · ${KIND_LABEL[kind].toLowerCase()}`}
              </h2>
              <Tabs
                value={listTab}
                onValueChange={(v) => setListTab(v as typeof listTab)}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="open" className="text-xs">
                    Em aberto ({openCount})
                  </TabsTrigger>
                  <TabsTrigger value="paid" className="text-xs">
                    {kind === "receivable" ? "Recebidos" : "Pagos"} em {year}
                  </TabsTrigger>
                  <TabsTrigger value="all" className="text-xs">
                    Todos de {year}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {txQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : listed.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {listTab === "open"
                  ? "Nada em aberto com esta entidade."
                  : `Nenhum lançamento em ${year}.`}
                {listTab === "open" && canCreate(kind) && (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={newTransactionHref(kind)}>
                        <Plus className="h-4 w-4" /> Lançar conta{" "}
                        {kind === "payable" ? "a pagar" : "a receber"}
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">
                        {listTab === "paid" ? "Pagamento" : "Vencimento"}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Descrição
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Situação
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Valor
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((t) => {
                      const overdueDays = isOverdue(t, today)
                        ? differenceInCalendarDays(today, t.dueDate)
                        : 0;
                      return (
                        <tr
                          key={t.id}
                          className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                          onClick={() => openTransaction(t)}
                        >
                          <td className="whitespace-nowrap px-4 py-2.5 font-financial text-xs">
                            {format(
                              listTab === "paid" ? refDate(t) : t.dueDate,
                              "dd/MM/yyyy",
                            )}
                            {overdueDays > 0 && (
                              <span className="ml-2 text-destructive">
                                {overdueDays}d
                              </span>
                            )}
                          </td>
                          <td className="max-w-0 px-4 py-2.5">
                            <button
                              type="button"
                              className="block w-full truncate text-left font-medium hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTransaction(t);
                              }}
                            >
                              {t.description}
                            </button>
                            {t.documentNumber && (
                              <span className="text-xs text-muted-foreground">
                                Doc. {t.documentNumber}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <StatusBadge status={t.status} type={t.type} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-financial tabular-nums">
                            {formatCurrency(amountOf(t))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30 text-xs">
                      <td
                        colSpan={3}
                        className="px-4 py-2 text-muted-foreground"
                      >
                        {listed.length} lançamento{listed.length !== 1 && "s"}
                      </td>
                      <td className="px-4 py-2 text-right font-financial font-semibold tabular-nums">
                        {formatCurrency(
                          listed.reduce(
                            (acc, t) => acc.add(amountOf(t)),
                            currency(0),
                          ).value,
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Cadastro ── */}
        <aside className="h-fit rounded-lg border px-4 xl:sticky xl:top-4">
          <Panel
            title="Dados de pagamento"
            action={
              entity.bankDetailsChangedAt && (
                <span className="text-xs text-muted-foreground">
                  trocados em{" "}
                  {format(entity.bankDetailsChangedAt, "dd/MM/yyyy")}
                </span>
              )
            }
          >
            {entity.pixKey && (
              <Field label="Chave PIX" mono>
                <span className="flex items-start gap-1.5">
                  <span className="break-all">
                    {entity.pixKey}
                    {entity.pixKeyType && (
                      <span className="ml-1 font-sans text-xs text-muted-foreground">
                        ({PIX_KEY_TYPE_LABELS[entity.pixKeyType]})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(entity.pixKey!, "Chave PIX")}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Copiar chave PIX"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </span>
              </Field>
            )}
            {entity.bankName && <Field label="Banco">{entity.bankName}</Field>}
            {(entity.agency || entity.account) && (
              <Field label="Agência / conta" mono>
                {[entity.agency, entity.account].filter(Boolean).join(" / ")}
                {entity.accountType && (
                  <span className="ml-1 font-sans text-xs text-muted-foreground">
                    (
                    {entity.accountType === "savings" ? "poupança" : "corrente"}
                    )
                  </span>
                )}
              </Field>
            )}
            {!hasBankDetails(entity) && (
              <p className="py-1 text-sm text-amber-700 dark:text-amber-400">
                {entity.category === "client"
                  ? "Nenhum dado bancário cadastrado."
                  : "Sem PIX nem conta: o lote de pagamento vai sinalizar."}
              </p>
            )}
          </Panel>

          <Panel title="Contato">
            {entity.email ? (
              <Field label="E-mail">
                <a href={`mailto:${entity.email}`} className="hover:underline">
                  {entity.email}
                </a>
              </Field>
            ) : null}
            {entity.phone ? (
              <Field label="Telefone" mono>
                {entity.phone}
              </Field>
            ) : null}
            {addressLines.length > 0 ? (
              <Field label="Endereço">
                {addressLines.map((l, i) => (
                  <span key={i} className="block">
                    {l}
                  </span>
                ))}
              </Field>
            ) : entity.address ? (
              <Field label="Endereço">{entity.address}</Field>
            ) : null}
            {!entity.email && !entity.phone && !entity.address && (
              <p className="py-1 text-sm text-muted-foreground">
                Nenhum contato cadastrado.
              </p>
            )}
          </Panel>

          <Panel title="Fiscal">
            <Field label="Tipo">
              {entity.type === "company" ? "Pessoa jurídica" : "Pessoa física"}
            </Field>
            {entity.document && (
              <Field label={documentKind(entity)} mono>
                <span className="flex items-center gap-1.5">
                  {displayDocument(entity.document)}
                  <button
                    type="button"
                    onClick={() => copy(entity.document!, documentKind(entity))}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Copiar ${documentKind(entity)}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </span>
              </Field>
            )}
            {entity.taxRegime && (
              <Field label="Regime">
                {TAX_REGIME_LABELS[entity.taxRegime]}
              </Field>
            )}
            {entity.stateRegistration && (
              <Field label="Insc. estadual" mono>
                {entity.stateRegistration}
              </Field>
            )}
            {entity.municipalRegistration && (
              <Field label="Insc. municipal" mono>
                {entity.municipalRegistration}
              </Field>
            )}
            {entity.category !== "client" && (
              <Field label="Retenções">
                {withholdings.length > 0 ? withholdings.join(" · ") : "Nenhuma"}
              </Field>
            )}
          </Panel>

          <Panel title="Padrões para lançamentos">
            <Field label="Conta">
              {defaultAccount
                ? `${defaultAccount.code} ${defaultAccount.name}`
                : "—"}
            </Field>
            {entity.category !== "client" && (
              <Field label="Centro de custo">
                {defaultCostCenter
                  ? `${defaultCostCenter.code} ${defaultCostCenter.name}`
                  : "—"}
              </Field>
            )}
            <Field label="Forma">
              {entity.defaultPaymentMethod
                ? PAYMENT_METHOD_LABELS[entity.defaultPaymentMethod]
                : "—"}
            </Field>
            <Field label="Prazo">
              {entity.paymentTermDays != null
                ? `${entity.paymentTermDays} dias`
                : "—"}
            </Field>
            <Field label="Multa / juros">
              {entity.lateFeePercent ?? 2}% ·{" "}
              {entity.monthlyInterestPercent ?? 1}% a.m.
              {entity.lateFeePercent == null &&
                entity.monthlyInterestPercent == null && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    (padrão)
                  </span>
                )}
            </Field>
          </Panel>

          <section className="py-4">
            <RecordHistory companyId={companyId} recordId={entity.id} />
          </section>
        </aside>
      </div>

      <EntityFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        entity={entity}
        onSaved={refreshEntity}
      />

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Inativar ${entity.name}?`}
        description="Inativa sai dos formulários de lançamento e da busca de fornecedor. O histórico continua, e dá para reativar quando quiser."
        confirmText="Inativar"
        onConfirm={toggleActive}
      />
    </div>
  );
}
