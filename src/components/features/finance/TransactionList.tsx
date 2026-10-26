"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import currency from "currency.js";
import {
  AlertTriangle,
  Banknote,
  Barcode,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  Files,
  Layers,
  Loader2,
  Lock,
  MoreHorizontal,
  Handshake,
  Repeat,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import {
  PaymentDialog,
  type PaymentConfirmation,
} from "@/components/features/finance/PaymentDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useSortableData } from "@/hooks/useSortableData";
import { useCostCenters } from "@/hooks/useCostCenters";
import { transactionService } from "@/lib/services/transactionService";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { entityService } from "@/lib/services/entityService";
import { dashboardService } from "@/lib/services/dashboardService";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { reviveTransaction } from "@/hooks/useSearch";
import { AddToBatchDialog } from "@/components/features/finance/AddToBatchDialog";
import type { CostCenter, Transaction } from "@/lib/types";
import {
  agingBucket,
  agingRange,
  counterpartKey,
  defaultPeriod,
  duplicateKey,
  hasComprovante,
  hasCostCenter,
  isOpen,
  isOverdue,
  lateCharges,
  lateFeeRule,
  periodLabel,
  queueStatuses,
  relativeDue,
  splitDescription,
  tabFilter,
  type LateFeeRule,
  type TabContext,
  type TabId,
} from "@/lib/transactionTabs";

type Kind = "payable" | "receivable";

const COPY = {
  payable: {
    counterpart: "Fornecedor",
    paidTab: "Pagas",
    pay: "Pagar",
    empty: "Nenhuma conta a pagar cadastrada",
    create: "Criar primeira conta",
  },
  receivable: {
    counterpart: "Cliente",
    paidTab: "Recebidas",
    pay: "Receber",
    empty: "Nenhuma conta a receber cadastrada",
    create: "Criar primeira conta",
  },
} as const;

const STATUS: Record<
  string,
  { label: string; receivable?: string; className: string }
> = {
  // Rascunho é o estado comum: texto apagado, sem badge (ver StatusBadge).
  draft: { label: "Rascunho", className: "" },
  pending_approval: {
    label: "Pendente",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  approved: {
    label: "Aprovado",
    receivable: "Ag. Recebimento",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  pending_authorization: {
    label: "Ag. Autorização",
    className:
      "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  },
  authorized: {
    label: "Autorizado",
    className:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
  },
  paid: {
    label: "Pago",
    receivable: "Recebido",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  },
  rejected: {
    label: "Rejeitado",
    className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
};

const statusLabel = (status: string, type: Kind) =>
  (type === "receivable" && STATUS[status]?.receivable) ||
  STATUS[status]?.label ||
  status;

function StatusBadge({ status, type }: { status: string; type: Kind }) {
  if (status === "draft") {
    return (
      <span className="text-xs text-muted-foreground">
        {statusLabel(status, type)}
      </span>
    );
  }
  return (
    <Badge className={cn("font-medium border-0", STATUS[status]?.className)}>
      {statusLabel(status, type)}
    </Badge>
  );
}

const EMPTY: Record<TabId, string> = {
  overdue: "Nenhuma conta vencida. Tudo em dia.",
  today: "Nada vence hoje.",
  week: "Nada vence nos próximos 7 dias.",
  future: "Nenhuma conta com vencimento depois dos próximos 7 dias.",
  paid: "Nenhuma conta quitada no período.",
  all: "Nenhuma conta no período.",
  queue: "Sua fila está vazia.",
};

/** Abas agrupadas: vencidas por faixa de atraso; as de prazo, por dia. */
const GROUPED_TABS: TabId[] = ["overdue", "today", "week", "future"];

// ── Preferências por usuário (só conveniência local) ─────────────────────────

interface Prefs {
  tab: TabId;
  costCenterId: string;
  batchFilter: "all" | "in_batch" | "not_in_batch";
  status: string;
}

const DEFAULT_PREFS: Prefs = {
  tab: "overdue",
  costCenterId: "all",
  batchFilter: "all",
  status: "all",
};

const prefsKey = (type: Kind) => `fincontrol:list:${type}`;

// ── Cache ─────────────────────────────────────────────────────────────────────

/** Recarrega lista, totais das abas e busca depois de criar/importar/editar. */
export function refreshTransactionList(qc: QueryClient, type: Kind) {
  for (const key of ["tx-list", "tx-tabs", "tx-search"]) {
    qc.invalidateQueries({ queryKey: [key, type] });
  }
}

function descendantIds(rootId: string, all: CostCenter[]): string[] {
  return [
    rootId,
    ...all
      .filter((c) => c.parentId === rootId)
      .flatMap((c) => descendantIds(c.id, all)),
  ];
}

// ── Componente ────────────────────────────────────────────────────────────────

interface TransactionListProps {
  type: Kind;
  onCreate?: () => void;
}

export function TransactionList({ type, onCreate }: TransactionListProps) {
  const copy = COPY[type];
  const isPayable = type === "payable";
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const qc = useQueryClient();
  const perms = usePermissions();
  const onlyOwn = isPayable && perms.onlyOwnPayables;
  const { costCenters } = useCostCenters(companyId);

  const today = useMemo(() => startOfDay(new Date()), []);

  // ── Preferências ───────────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const prefsLoaded = useRef(false);
  useEffect(() => {
    let saved: Partial<Prefs> = {};
    try {
      saved = JSON.parse(localStorage.getItem(prefsKey(type)) ?? "{}");
    } catch {
      // armazenamento indisponível: segue com o padrão
    }
    // Links do dashboard abrem uma aba e um período: ?tab=paid&de=2026-01-01&ate=2026-12-31
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab") as TabId | null;
    const from = params.get("de");
    const to = params.get("ate");
    setPrefs({
      ...DEFAULT_PREFS,
      ...saved,
      ...(urlTab ? { tab: urlTab } : {}),
    });
    if (from && to) setPeriod({ from: parseISO(from), to: parseISO(to) });
    prefsLoaded.current = true;
  }, [type]);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    try {
      localStorage.setItem(prefsKey(type), JSON.stringify(prefs));
    } catch {
      // idem
    }
  }, [prefs, type]);
  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const [period, setPeriod] = useState<DateRange | undefined>(() =>
    defaultPeriod(),
  );
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm.trim(), 400);
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // ── Abas ─────────────────────────────────────────────────────────────────
  const queue = useMemo(
    () => (isPayable ? queueStatuses(perms.currentRole) : []),
    [isPayable, perms.currentRole],
  );

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string }[] = [
      { id: "overdue", label: "Vencidas" },
      { id: "today", label: "Hoje" },
      { id: "week", label: "Próximos 7 dias" },
      { id: "future", label: "Futuras" },
      { id: "paid", label: copy.paidTab },
      { id: "all", label: "Todas" },
    ];
    if (queue.length > 0) list.push({ id: "queue", label: "Minha fila" });
    return list;
  }, [copy.paidTab, queue.length]);

  const tab: TabId = tabs.some((t) => t.id === prefs.tab)
    ? prefs.tab
    : "overdue";
  const periodApplies = tab === "paid" || tab === "all";

  const costCenterIds = useMemo(
    () =>
      isPayable && prefs.costCenterId !== "all" && costCenters.length > 0
        ? descendantIds(prefs.costCenterId, costCenters)
        : undefined,
    [isPayable, prefs.costCenterId, costCenters],
  );

  const ctx: TabContext = useMemo(
    () => ({
      type,
      today,
      period: period ? { from: period.from, to: period.to } : undefined,
      status: prefs.status,
      queue,
      createdBy: onlyOwn ? user?.uid : undefined,
      costCenterIds,
    }),
    [
      type,
      today,
      period,
      prefs.status,
      queue,
      onlyOwn,
      user?.uid,
      costCenterIds,
    ],
  );

  const tabFilters = useMemo(
    () => tabs.map((t) => tabFilter(t.id, ctx)),
    [tabs, ctx],
  );
  const activeFilter = tabFilters[tabs.findIndex((t) => t.id === tab)] ?? null;

  const totalsQuery = useQuery({
    queryKey: ["tx-tabs", type, companyId, JSON.stringify(tabFilters)],
    queryFn: () => transactionService.getTabTotals(companyId!, tabFilters),
    enabled: !!companyId && !!user,
  });
  const totals = totalsQuery.data;

  // ── Dados da aba ─────────────────────────────────────────────────────────
  const searching = searchTerm.trim().length > 0;

  const list = usePaginatedQuery<Transaction>({
    queryKey: ["tx-list", type, companyId, tab, JSON.stringify(activeFilter)],
    queryFn: async (pageSize, lastDoc) => {
      if (!activeFilter) return { items: [], lastDoc: null };
      const res = await transactionService.getPaginated(
        companyId!,
        pageSize,
        lastDoc,
        activeFilter,
      );
      return { items: res.transactions, lastDoc: res.lastDoc };
    },
    pageSize: 50,
    enabled: !!companyId && !!user && !searching,
  });

  const searchQuery = useQuery({
    queryKey: ["tx-search", type, companyId, debouncedSearch, onlyOwn],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: debouncedSearch,
        companyId: companyId!,
        type,
        allDates: "true",
        limit: "50",
      });
      if (onlyOwn && user) params.set("createdBy", user.uid);
      const res = await fetch(
        `/api/internal/transactions/search?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const json = await res.json();
      return ((json.data ?? []) as Record<string, unknown>[]).map(
        reviveTransaction,
      );
    },
    enabled: !!companyId && !!user && !!debouncedSearch,
  });

  const entitiesQuery = useQuery({
    queryKey: ["entities-all", companyId],
    queryFn: () => entityService.getAll(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const ruleFor = useCallback(
    (t: Transaction): LateFeeRule =>
      lateFeeRule(entitiesQuery.data?.find((e) => e.id === t.entityId)),
    [entitiesQuery.data],
  );

  const punctualityQuery = useQuery({
    queryKey: ["punctuality", companyId],
    queryFn: () => transactionService.getPunctuality(companyId!),
    enabled: !!companyId && !isPayable,
    staleTime: 10 * 60 * 1000,
  });

  const showProjection =
    perms.canViewDashboard &&
    !onlyOwn &&
    !searching &&
    (tab === "today" || tab === "week" || tab === "future");
  const projectionQuery = useQuery({
    queryKey: ["list-projection", companyId],
    queryFn: () => dashboardService.getProjectedCashFlow(companyId!, "30days"),
    enabled: !!companyId && showProjection,
    staleTime: 5 * 60 * 1000,
  });
  const projection = useMemo(
    () =>
      new Map(
        (projectionQuery.data?.hasCompanyStats
          ? projectionQuery.data.data
          : []
        ).map((d) => [d.date, d.balance]),
      ),
    [projectionQuery.data],
  );
  // Primeiro dia em que o caixa previsto fica negativo: o número que decide o dia.
  const firstNegative = useMemo(() => {
    if (!projectionQuery.data?.hasCompanyStats) return null;
    const from = format(today, "yyyy-MM-dd");
    return (
      projectionQuery.data.data.find(
        (d) => d.isoDate >= from && d.balance < 0,
      ) ?? null
    );
  }, [projectionQuery.data, today]);

  const rawRows = useMemo(() => {
    let rows = searching ? (searchQuery.data ?? []) : list.items;
    if (searching && costCenterIds) {
      rows = rows.filter((t) =>
        (t.costCenterAllocation ?? []).some((a) =>
          costCenterIds.includes(a.costCenterId),
        ),
      );
    }
    if (isPayable && prefs.batchFilter !== "all") {
      const inBatch = prefs.batchFilter === "in_batch";
      rows = rows.filter((t) => !!t.batchId === inBatch);
    }
    return rows;
  }, [
    searching,
    searchQuery.data,
    list.items,
    costCenterIds,
    isPayable,
    prefs.batchFilter,
  ]);

  const isLoading = searching
    ? debouncedSearch !== searchTerm.trim() || searchQuery.isLoading
    : list.isLoading;
  const isError = searching ? searchQuery.isError : list.isError;

  // O filtro de lote é aplicado depois da leitura: enquanto a página vier vazia
  // e houver mais, segue carregando em vez de mostrar um vazio enganoso.
  const seekingBatch =
    !searching &&
    prefs.batchFilter !== "all" &&
    rawRows.length === 0 &&
    !list.isLoading &&
    (list.hasMore || list.isFetchingNextPage);
  const { hasMore, isFetchingNextPage, loadMore } = list;
  useEffect(() => {
    if (seekingBatch && hasMore && !isFetchingNextPage) loadMore();
  }, [seekingBatch, hasMore, isFetchingNextPage, loadMore]);

  const { targetRef: sentinelRef, isIntersecting } =
    useIntersectionObserver<HTMLDivElement>({
      threshold: 0.1,
      enabled: !searching && hasMore && !isFetchingNextPage,
    });
  useEffect(() => {
    if (isIntersecting && !searching && hasMore && !isFetchingNextPage) {
      loadMore();
    }
  }, [isIntersecting, searching, hasMore, isFetchingNextPage, loadMore]);

  // ponytail: ordenar por outra coluna reordena só as páginas já carregadas.
  const {
    items: rows,
    requestSort,
    sortConfig,
  } = useSortableData<Transaction>(rawRows, {
    key: "dueDate",
    direction: "asc",
  });

  // ponytail: compara só as contas carregadas na aba. Como duplicatas têm o
  // mesmo vencimento, caem na mesma aba; checar no cadastro se escapar algo.
  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of rawRows) {
      const key = duplicateKey(t);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      rawRows
        .filter((t) => (counts.get(duplicateKey(t) ?? "") ?? 0) > 1)
        .map((t) => t.id),
    );
  }, [rawRows]);

  // ── Agrupamento ──────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (
      searching ||
      !GROUPED_TABS.includes(tab) ||
      sortConfig?.key !== "dueDate"
    ) {
      return null;
    }
    const map = new Map<
      string,
      { key: string; label: string; rows: Transaction[]; balance?: number }
    >();
    for (const t of rows) {
      let key: string;
      let label: string;
      let balance: number | undefined;
      if (tab === "overdue") {
        key = label = agingBucket(differenceInCalendarDays(today, t.dueDate));
      } else {
        key = format(t.dueDate, "yyyy-MM-dd");
        const weekday = format(t.dueDate, "EEEE, dd/MM", { locale: ptBR });
        label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
        balance = projection.get(format(t.dueDate, "dd/MM"));
      }
      const group = map.get(key) ?? { key, label, rows: [], balance };
      group.rows.push(t);
      map.set(key, group);
    }
    return [...map.values()].map((g) => ({
      ...g,
      drafts: g.rows.filter((t) => t.status === "draft").length,
      total: g.rows.reduce((acc, t) => acc.add(t.amount), currency(0)).value,
      corrected:
        tab === "overdue"
          ? g.rows.reduce(
              (acc, t) =>
                acc.add(
                  lateCharges(t.amount, t.dueDate, today, ruleFor(t)).total,
                ),
              currency(0),
            ).value
          : undefined,
    }));
  }, [searching, tab, sortConfig, rows, today, projection, ruleFor]);

  const flat = useMemo(
    () => (groups ? groups.flatMap((g) => g.rows) : rows),
    [groups, rows],
  );
  // O servidor entrega por vencimento crescente; qualquer outra ordem é local.
  const customSort =
    sortConfig?.key !== "dueDate" || sortConfig.direction !== "asc";

  // Nas abas agrupadas por dia o cabeçalho já diz quando vence.
  const showRelative = !groups || tab === "overdue";

  // Pontualidade é do cliente, não da conta: aparece na primeira linha dele em cada grupo.
  const punctualityRows = useMemo(() => {
    const ids = new Set<string>();
    for (const groupRows of groups?.map((g) => g.rows) ?? [rows]) {
      const seen = new Set<string>();
      for (const t of groupRows) {
        const key = counterpartKey(t);
        if (key && !seen.has(key)) {
          seen.add(key);
          ids.add(t.id);
        }
      }
    }
    return ids;
  }, [groups, rows]);

  // O último grupo pode atravessar a paginação (um dia com 80 contas, 50 por
  // página): contagem, soma e rascunhos dele vêm do servidor, não das linhas.
  // O servidor pagina por vencimento crescente: o grupo incompleto é o de
  // vencimento mais tardio, último na ordem crescente e primeiro na decrescente.
  const lastGroupKey = (
    sortConfig?.direction === "desc" ? groups?.[0] : groups?.at(-1)
  )?.key;
  const lastGroupFilters = useMemo(() => {
    if (!lastGroupKey || !hasMore || !activeFilter) return null;
    // Lote é filtrado depois da leitura: o servidor não saberia somar igual.
    if (prefs.batchFilter !== "all") return null;
    const range =
      tab === "overdue"
        ? agingRange(lastGroupKey, today)
        : {
            startDate: parseISO(lastGroupKey),
            endDate: parseISO(lastGroupKey),
          };
    if (!range) return null;
    const group = { ...activeFilter, ...range };
    const drafts =
      group.status && group.status !== "draft"
        ? null
        : { ...group, status: "draft", excludeStatus: undefined };
    return [group, drafts];
  }, [lastGroupKey, hasMore, activeFilter, prefs.batchFilter, tab, today]);
  const lastGroupTotals = useQuery({
    queryKey: [
      "tx-tabs",
      type,
      companyId,
      "group",
      JSON.stringify(lastGroupFilters),
    ],
    queryFn: () =>
      transactionService.getTabTotals(companyId!, lastGroupFilters!),
    enabled: !!companyId && !!lastGroupFilters,
  }).data;

  // ── Seleção, foco e painel ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelTx, setPanelTx] = useState<Transaction | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelAction, setPanelAction] = useState<"hold" | "promise" | null>(
    null,
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setActiveId(null);
  }, [tab, debouncedSearch]);

  const selectedRows = flat.filter((t) => selectedIds.has(t.id));
  const selectedTotal = selectedRows.reduce(
    (acc, t) => acc.add(t.amount),
    currency(0),
  ).value;
  const allSelected =
    flat.length > 0 && flat.every((t) => selectedIds.has(t.id));

  const setMany = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // Shift estende a seleção desde a última linha marcada.
  const lastToggled = useRef<string | null>(null);
  const toggleSelect = (id: string, range = false) => {
    const from = flat.findIndex((t) => t.id === lastToggled.current);
    const to = flat.findIndex((t) => t.id === id);
    const ids =
      range && from >= 0 && to >= 0
        ? flat
            .slice(Math.min(from, to), Math.max(from, to) + 1)
            .map((t) => t.id)
        : [id];
    setMany(ids, !selectedIds.has(id));
    lastToggled.current = id;
  };

  const openPanel = (
    t: Transaction,
    action: "hold" | "promise" | null = null,
  ) => {
    setActiveId(t.id);
    setPanelTx(t);
    setPanelAction(action);
    setPanelOpen(true);
  };

  const refresh = useCallback(
    () => refreshTransactionList(qc, type),
    [qc, type],
  );

  const patchRow = useCallback(
    (updated: Transaction) => {
      list.updateItem(updated.id, () => updated);
      qc.setQueriesData<Transaction[]>(
        { queryKey: ["tx-search", type] },
        (old) => old?.map((t) => (t.id === updated.id ? updated : t)),
      );
      setPanelTx((cur) => (cur?.id === updated.id ? updated : cur));
      qc.invalidateQueries({ queryKey: ["tx-tabs", type] });
    },
    [list, qc, type],
  );

  // ── Ações de linha ───────────────────────────────────────────────────────
  const actor = user ? { uid: user.uid, email: user.email } : null;

  const canPayRow = (t: Transaction) =>
    t.status !== "paid" &&
    (isPayable
      ? (perms.isAdmin || perms.isFinancialManager) && !t.paymentHold
      : perms.canEditReceivables);
  const canDelete = isPayable
    ? perms.canDeletePayables
    : perms.canDeleteReceivables;
  const canRevert = (t: Transaction) =>
    isPayable && perms.canEditPayables && t.status === "pending_approval";
  const canHold = (t: Transaction) =>
    isPayable &&
    (perms.canApprovePayables || perms.canPayPayables) &&
    isOpen(t);
  const canPromise = (t: Transaction) =>
    !isPayable && perms.canEditReceivables && isOpen(t);

  const [payingTx, setPayingTx] = useState<Transaction | null>(null);
  const [isCheckingBatch, setIsCheckingBatch] = useState(false);

  const openPay = async (t: Transaction) => {
    if (!canPayRow(t)) return;
    if (t.batchId) {
      setIsCheckingBatch(true);
      try {
        const batch = await paymentBatchService.getById(t.batchId);
        const ok = ["approved", "authorized", "pending_authorization", "paid"];
        if (batch && !ok.includes(batch.status)) {
          toast.error(
            "O lote desta transação precisa estar aprovado para confirmar o pagamento.",
          );
          return;
        }
      } catch {
        toast.error("Erro ao validar lote.");
        return;
      } finally {
        setIsCheckingBatch(false);
      }
    }
    setPayingTx(t);
  };

  const confirmPay = async (data: PaymentConfirmation) => {
    if (!payingTx || !actor || !companyId) return;
    try {
      await transactionService.settle(payingTx.id, data, actor, companyId);
      toast.success(
        isPayable ? "Pagamento confirmado!" : "Recebimento confirmado!",
      );
      refresh();
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao registrar pagamento."));
      throw error;
    }
  };

  const revertToDraft = async (t: Transaction) => {
    if (!actor || !companyId) return;
    list.updateItem(t.id, (x) => ({ ...x, status: "draft" }));
    try {
      await transactionService.update(
        t.id,
        { status: "draft" },
        actor,
        companyId,
      );
      toast.success("Transação revertida para rascunho!");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao reverter transação."));
    } finally {
      refresh();
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const handleDelete = async () => {
    if (!deleteId || !actor || !companyId) return;
    const id = deleteId;
    setDeleteId(null);
    list.removeItem(id);
    try {
      await transactionService.delete(id, actor, companyId);
      toast.success("Transação excluída!");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao excluir transação."));
    } finally {
      refresh();
    }
  };

  const copyBarcode = (t: Transaction) => {
    if (!t.barcode) return;
    navigator.clipboard.writeText(t.barcode);
    toast.success("Linha digitável copiada!");
  };

  // ── Ações em lote (contas a pagar) ───────────────────────────────────────
  const [bulkDialog, setBulkDialog] = useState<
    "pay" | "batch" | "revert" | null
  >(null);
  const [bulkDate, setBulkDate] = useState<Date>(new Date());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const bulkPayable = selectedRows.filter(
    (t) => t.status !== "paid" && !t.paymentHold,
  );
  const bulkHeld = selectedRows.filter((t) => t.paymentHold).length;
  const bulkRevertable = selectedRows.filter((t) => t.status === "paid");

  const runBulk = async (
    fn: () => Promise<void>,
    success: string,
    fail: string,
  ) => {
    setIsBulkProcessing(true);
    try {
      await fn();
      toast.success(success);
      setBulkDialog(null);
      setSelectedIds(new Set());
      refresh();
    } catch (error) {
      toast.error(friendlyError(error, fail));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const bulkPay = () =>
    runBulk(
      async () => {
        if (!actor || !companyId || bulkPayable.length === 0) {
          throw new Error("Nenhuma conta elegível para pagamento selecionada.");
        }
        // A baixa não é recusada por saldo: a conta já é devida. Quando o
        // pagamento cai em exercício sem orçamento, o lançamento fica marcado.
        await transactionService.updateBatch(
          bulkPayable.map((t) => t.id),
          { status: "paid", paymentDate: bulkDate },
          actor,
          companyId,
          { enforce: false },
        );
      },
      `${bulkPayable.length} conta(s) paga(s)!`,
      "Erro ao realizar pagamento em lote.",
    );

  const bulkRevert = () =>
    runBulk(
      async () => {
        if (!actor || !companyId || bulkRevertable.length === 0) {
          throw new Error("Nenhuma conta paga selecionada para reversão.");
        }
        await transactionService.updateBatch(
          bulkRevertable.map((t) => t.id),
          { status: "draft" },
          actor,
          companyId,
        );
      },
      `${bulkRevertable.length} pagamento(s) revertido(s)!`,
      "Erro ao reverter pagamentos em lote.",
    );

  const openBatchDialog = () => setBulkDialog("batch");

  // ── Teclado ──────────────────────────────────────────────────────────────
  const moveActive = (delta: number) => {
    if (flat.length === 0) return;
    const index = flat.findIndex((t) => t.id === activeId);
    const next =
      flat[
        index < 0
          ? delta > 0
            ? 0
            : flat.length - 1
          : Math.min(flat.length - 1, Math.max(0, index + delta))
      ];
    setActiveId(next.id);
    if (panelOpen) {
      setPanelTx(next);
      setPanelAction(null);
    }
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.closest("input, textarea, select, [contenteditable='true']") ||
        target.closest("[role='dialog']:not([data-panel]), [role='menu']")
      ) {
        return;
      }
      const active = flat.find((t) => t.id === activeId);
      // Setas só com o foco numa linha, para não roubar a rolagem da página.
      const arrow =
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !!target.closest("[data-row-id]");

      if (e.key === "j" || e.key === "k" || arrow) {
        e.preventDefault();
        moveActive(e.key === "j" || e.key === "ArrowDown" ? 1 : -1);
      } else if (panelOpen) {
        return;
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) {
        setPref("tab", tabs[Number(e.key) - 1].id);
        setSearchTerm("");
      } else if ((e.key === "x" || e.key === "X") && active) {
        toggleSelect(active.id, e.shiftKey);
      } else if (e.key === "Enter" && active) {
        e.preventDefault();
        openPanel(active);
      } else if (e.key === "p" && active) {
        openPay(active);
      } else if (e.key === "c" && active) {
        copyBarcode(active);
      } else if (e.key === "Escape") {
        setSelectedIds(new Set());
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (!activeId || panelOpen) return;
    const el = document.querySelector<HTMLElement>(
      `[data-row-id="${activeId}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    // Não tira o foco de um checkbox ou botão da própria linha.
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [activeId, panelOpen]);

  // ── Filtros ──────────────────────────────────────────────────────────────
  const isDefaultPeriod = (() => {
    const def = defaultPeriod();
    return (
      period?.from?.toDateString() === def.from.toDateString() &&
      period?.to?.toDateString() === def.to.toDateString()
    );
  })();
  const activeFilterCount =
    (prefs.costCenterId !== "all" ? 1 : 0) +
    (prefs.batchFilter !== "all" ? 1 : 0) +
    (prefs.status !== "all" ? 1 : 0) +
    (periodApplies && !isDefaultPeriod ? 1 : 0);

  const clearFilters = () => {
    setPrefs((p) => ({
      ...p,
      costCenterId: "all",
      batchFilter: "all",
      status: "all",
    }));
    setPeriod(defaultPeriod());
    setSearchTerm("");
  };

  const statusOptions = Object.keys(STATUS).filter((s) =>
    tab === "paid"
      ? s === "paid"
      : tab === "queue"
        ? queue.includes(s)
        : tab === "all"
          ? true
          : !["paid", "rejected"].includes(s),
  );

  const filterControls = (mobile: boolean) => (
    <>
      {periodApplies &&
        (mobile ? (
          <div className="grid grid-cols-2 gap-2">
            {(["from", "to"] as const).map((edge) => (
              <div key={edge} className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {edge === "from" ? "Vencimento de" : "Até"}
                </Label>
                <Input
                  type="date"
                  value={
                    period?.[edge] ? format(period[edge]!, "yyyy-MM-dd") : ""
                  }
                  onChange={(e) => {
                    const d = e.target.valueAsDate;
                    if (!d) return;
                    const local = new Date(
                      d.getTime() + d.getTimezoneOffset() * 60000,
                    );
                    setPeriod((p) => ({
                      from: p?.from,
                      to: p?.to,
                      [edge]: local,
                    }));
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <DatePickerWithRange date={period} setDate={setPeriod} />
        ))}
      {isPayable && (
        <Select
          value={prefs.costCenterId}
          onValueChange={(v) => setPref("costCenterId", v)}
        >
          <SelectTrigger
            className={mobile ? "w-full" : "w-[190px]"}
            aria-label="Centro de custo"
          >
            <SelectValue placeholder="Centro de custo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os centros</SelectItem>
            {costCenters.map((cc) => (
              <SelectItem key={cc.id} value={cc.id}>
                {cc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isPayable && (
        <Select
          value={prefs.batchFilter}
          onValueChange={(v) =>
            setPref("batchFilter", v as Prefs["batchFilter"])
          }
        >
          <SelectTrigger
            className={mobile ? "w-full" : "w-[140px]"}
            aria-label="Lote"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Lote: todos</SelectItem>
            <SelectItem value="in_batch">Em lote</SelectItem>
            <SelectItem value="not_in_batch">Sem lote</SelectItem>
          </SelectContent>
        </Select>
      )}
      {statusOptions.length > 1 && (
        <Select
          value={prefs.status}
          onValueChange={(v) => setPref("status", v)}
        >
          <SelectTrigger
            className={mobile ? "w-full" : "w-[170px]"}
            aria-label="Status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );

  // ── Renderização ─────────────────────────────────────────────────────────
  const activeTotals = searching
    ? {
        count: rawRows.length,
        total: rawRows.reduce((acc, t) => acc.add(t.amount), currency(0)).value,
      }
    : totals?.[tabs.findIndex((t) => t.id === tab)];
  const noData =
    !searching &&
    activeFilterCount === 0 &&
    !!totals &&
    totals.every((t) => t.count === 0);
  const listEmpty =
    !isLoading && !seekingBatch && !isError && flat.length === 0;
  const weekTotals = totals?.[tabs.findIndex((t) => t.id === "week")];

  const gridCols =
    "md:grid-cols-[2rem_7rem_minmax(0,2fr)_minmax(0,1.2fr)_9.5rem_9rem_6.5rem]";

  const SortHead = ({
    field,
    label,
    className,
  }: {
    field: string;
    label: string;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={() => requestSort(field)}
      className={cn(
        "flex items-center gap-0.5 hover:text-foreground",
        className,
      )}
    >
      {label}
      {sortConfig?.key !== field ? (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
      ) : sortConfig.direction === "asc" ? (
        <ChevronUp className="h-3.5 w-3.5 text-primary" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-primary" />
      )}
    </button>
  );

  const renderRow = (t: Transaction) => {
    const overdue = isOverdue(t, today);
    const due = isOpen(t) ? relativeDue(t.dueDate, today) : null;
    const charges = overdue
      ? lateCharges(t.amount, t.dueDate, today, ruleFor(t))
      : null;
    const punctuality = !isPayable
      ? punctualityQuery.data?.[counterpartKey(t) ?? ""]
      : undefined;
    const promise = t.paymentPromise;
    const brokenPromise =
      promise && isOpen(t) && differenceInCalendarDays(promise.date, today) < 0;
    const selected = selectedIds.has(t.id);
    const active = activeId === t.id;
    const payAllowed = canPayRow(t);
    const desc = splitDescription(t.description);
    const installment = t.installments
      ? `${t.installments.current}/${t.installments.total}`
      : desc.installment;
    const description = (
      <>
        {desc.text}
        {installment && (
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
            {installment}
          </span>
        )}
        {desc.recurring && (
          <span title="Recorrente" className="text-muted-foreground">
            <Repeat
              className="ml-1.5 inline h-3 w-3 align-[-1px]"
              aria-hidden
            />
            <span className="sr-only"> (recorrente)</span>
          </span>
        )}
      </>
    );

    const flags = (
      <>
        {t.paymentHold && (
          <Flag icon={Lock} tone="warn" title={t.paymentHold.reason}>
            bloqueada
          </Flag>
        )}
        {promise && (
          <Flag
            icon={Handshake}
            tone={brokenPromise ? "danger" : "info"}
            title={promise.note}
          >
            {brokenPromise ? "promessa vencida" : "prometido"} p/{" "}
            {format(promise.date, "dd/MM")}
          </Flag>
        )}
        {t.batchId && <Flag icon={Layers}>lote</Flag>}
        {duplicates.has(t.id) && (
          <Flag
            icon={Files}
            tone="warn"
            title="Mesmo fornecedor/cliente, valor e vencimento de outra conta"
          >
            possível duplicata
          </Flag>
        )}
        {t.budgetExceeded && (
          <Flag icon={AlertTriangle} tone="warn" title={t.budgetExceededReason}>
            sem saldo
          </Flag>
        )}
        {isPayable && t.status === "paid" && !hasComprovante(t) && (
          <Flag>sem comprovante</Flag>
        )}
        {isPayable && !hasCostCenter(t) && <Flag>sem centro de custo</Flag>}
      </>
    );

    const dueLabel = showRelative && due?.label && (
      <span
        className={cn(
          "text-xs",
          // Vermelho só passado um mês: com tudo vermelho, nada se destaca.
          due.tone === "overdue" &&
            (differenceInCalendarDays(today, t.dueDate) > 30
              ? "text-red-600 dark:text-red-400 font-medium"
              : "text-amber-700 dark:text-amber-400 font-medium"),
          due.tone === "today" &&
            "text-amber-600 dark:text-amber-400 font-medium",
          due.tone === "soon" && "text-muted-foreground",
        )}
      >
        {due.label}
      </span>
    );

    const actions = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 max-md:h-11 max-md:w-11"
            aria-label="Mais ações"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => openPanel(t)}>
            Abrir detalhes
          </DropdownMenuItem>
          {payAllowed && (
            <DropdownMenuItem onClick={() => openPay(t)}>
              <Banknote className="mr-2 h-4 w-4" />
              Confirmar {isPayable ? "pagamento" : "recebimento"}
            </DropdownMenuItem>
          )}
          {t.barcode && (
            <DropdownMenuItem onClick={() => copyBarcode(t)}>
              <Barcode className="mr-2 h-4 w-4" />
              Copiar linha digitável
            </DropdownMenuItem>
          )}
          {canHold(t) && (
            <DropdownMenuItem onClick={() => openPanel(t, "hold")}>
              <Lock className="mr-2 h-4 w-4" />
              {t.paymentHold ? "Liberar pagamento" : "Bloquear pagamento"}
            </DropdownMenuItem>
          )}
          {canPromise(t) && (
            <DropdownMenuItem onClick={() => openPanel(t, "promise")}>
              <Handshake className="mr-2 h-4 w-4" />
              {promise ? "Alterar promessa" : "Registrar promessa"}
            </DropdownMenuItem>
          )}
          {canRevert(t) && (
            <DropdownMenuItem onClick={() => revertToDraft(t)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reverter para rascunho
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteId(t.id)}
                className="text-red-600 focus:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

    return (
      <li
        key={t.id}
        data-row-id={t.id}
        // Tab entra na lista pela linha ativa (ou a primeira); setas e j/k andam dentro dela.
        tabIndex={t.id === (activeId ?? flat[0]?.id) ? 0 : -1}
        data-selected={selected || undefined}
        onClick={() => openPanel(t)}
        onFocus={() => setActiveId(t.id)}
        className={cn(
          "group relative cursor-pointer border-b outline-none transition-colors hover:bg-muted/40",
          selected && "bg-primary/5",
          active && "bg-muted/60 ring-1 ring-inset ring-primary/40",
        )}
      >
        {/* Desktop */}
        <div
          className={cn(
            "hidden md:grid items-center gap-3 px-4 py-2.5 text-sm",
            gridCols,
          )}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect(t.id, e.shiftKey);
            }}
          >
            <Checkbox
              checked={selected}
              aria-label={`Selecionar ${t.description}`}
            />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-financial tabular-nums">
              {format(t.dueDate, "dd/MM/yy")}
            </span>
            {dueLabel}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium" title={t.description}>
              {description}
            </p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 empty:hidden">
              {flags}
            </div>
          </div>
          <div className="min-w-0 text-muted-foreground">
            <p className="truncate" title={t.supplierOrClient}>
              {t.supplierOrClient || "—"}
            </p>
            {punctuality && punctualityRows.has(t.id) && (
              <PunctualityNote {...punctuality} />
            )}
          </div>
          <div className="text-right font-financial tabular-nums">
            <p className="font-semibold">{formatCurrency(t.amount)}</p>
            {charges && (
              <p
                className="text-xs text-muted-foreground"
                title={`Multa ${formatCurrency(charges.fee)} + juros ${formatCurrency(charges.interest)} (${charges.days} dias)`}
              >
                c/ encargos {formatCurrency(charges.total)}
              </p>
            )}
            {t.status === "paid" &&
              t.finalAmount !== undefined &&
              t.finalAmount !== t.amount && (
                <p className="text-xs text-muted-foreground">
                  quitado {formatCurrency(t.finalAmount)}
                </p>
              )}
          </div>
          {/* Recuo separa o status do valor: sem ele, "R$ 2.500,00 Rascunho" lia como uma coisa só. */}
          <div className="flex flex-col items-start gap-0.5 pl-3">
            <StatusBadge status={t.status} type={type} />
            {tab === "queue" && t.updatedAt && (
              <span className="text-xs text-muted-foreground">
                parada há {differenceInCalendarDays(today, t.updatedAt)} d
              </span>
            )}
          </div>
          <div
            className="flex items-center justify-end gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                active && "opacity-100",
              )}
            >
              {t.barcode && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Copiar linha digitável (c)"
                  aria-label="Copiar linha digitável"
                  onClick={() => copyBarcode(t)}
                >
                  <Barcode className="h-4 w-4" />
                </Button>
              )}
              {payAllowed && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                  title={`${copy.pay} (p)`}
                  aria-label={copy.pay}
                  onClick={() => openPay(t)}
                >
                  <Banknote className="h-4 w-4" />
                </Button>
              )}
            </div>
            {actions}
          </div>
        </div>

        {/* Mobile */}
        <div className="flex items-start gap-1 py-2.5 pl-1 pr-1 md:hidden">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect(t.id);
            }}
          >
            <Checkbox
              checked={selected}
              className="pointer-events-none h-5 w-5"
              tabIndex={-1}
              aria-label={`Selecionar ${t.description}`}
            />
          </div>
          <div className="min-w-0 flex-1 py-1">
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 truncate text-sm font-medium">
                {description}
              </p>
              <span className="shrink-0 text-sm font-semibold font-financial tabular-nums">
                {formatCurrency(t.amount)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{t.supplierOrClient}</span>
              {charges && (
                <span className="shrink-0 font-financial">
                  c/ encargos {formatCurrency(charges.total)}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-financial text-muted-foreground">
                {format(t.dueDate, "dd/MM/yy")}
              </span>
              {dueLabel}
              <StatusBadge status={t.status} type={type} />
              {flags}
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>{actions}</div>
        </div>
      </li>
    );
  };

  const tabCountLabel = (i: number) => {
    const t = totals?.[i];
    if (!t) return totalsQuery.isError ? "—" : null;
    return t.count;
  };

  return (
    <div className="flex flex-col rounded-xl border bg-card">
      {/* ── Abas por situação ─────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Situação das contas"
        className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t, i) => {
          const selected = t.id === tab && !searching;
          const count = tabCountLabel(i);
          const late = t.id === "overdue" && !!totals?.[i]?.count;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={selected}
              title={`${t.label} (${i + 1})`}
              onClick={() => {
                setPref("tab", t.id);
                setSearchTerm("");
              }}
              className={cn(
                "relative flex shrink-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                selected
                  ? "after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  late && "text-red-600 dark:text-red-400",
                )}
              >
                {t.label}
                {count === null ? (
                  <Skeleton className="h-4 w-5 rounded-full" />
                ) : (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular-nums",
                      late
                        ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </span>
              <span className="text-xs font-financial tabular-nums text-muted-foreground">
                {totals?.[i] ? (
                  <>
                    <span className="sm:hidden">
                      {formatCurrencyAbbr(totals[i].total)}
                    </span>
                    <span className="hidden sm:inline">
                      {formatCurrency(totals[i].total)}
                    </span>
                    {/* Só estas abas filtram por período: sem o rótulo, "Todas" parece menor que "Futuras". */}
                    {(t.id === "paid" || t.id === "all") && (
                      <span className="font-sans">
                        {" "}
                        · {periodLabel(period)}
                      </span>
                    )}
                  </>
                ) : (
                  " "
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Busca e filtros secundários ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 md:px-4">
        <div className="relative min-w-0 flex-1 md:max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Buscar em todas as contas (/)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchTerm("");
                e.currentTarget.blur();
              }
            }}
            className="h-10 pl-9 pr-8 md:h-9"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {filterControls(false)}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={clearFilters}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMobileFiltersOpen(true)}
          aria-label="Abrir filtros"
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border md:hidden",
            activeFilterCount > 0
              ? "border-primary bg-primary/10 text-primary"
              : "border-input text-muted-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        {searching && (
          <p className="w-full text-xs text-muted-foreground">
            Buscando em todas as datas e situações.
          </p>
        )}
      </div>

      {/* ── Caixa negativo previsto ───────────────────────────────────── */}
      {showProjection && firstNegative && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Saldo previsto fica negativo em{" "}
            <span className="font-medium">
              {format(parseISO(firstNegative.isoDate), "EEEE, dd/MM", {
                locale: ptBR,
              })}
            </span>
            :{" "}
            <span className="font-financial font-semibold tabular-nums">
              {formatCurrency(firstNegative.balance)}
            </span>
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-red-800 dark:text-red-300"
            onClick={() => {
              const el = document.getElementById(
                `grupo-${firstNegative.isoDate}`,
              );
              if (el) {
                el.scrollIntoView({ block: "start", behavior: "smooth" });
                return;
              }
              const days = differenceInCalendarDays(
                parseISO(firstNegative.isoDate),
                today,
              );
              setPref(
                "tab",
                days <= 0 ? "today" : days <= 7 ? "week" : "future",
              );
              setSearchTerm("");
            }}
          >
            Ver o dia
          </Button>
        </div>
      )}

      {/* ── Cabeçalho das colunas ─────────────────────────────────────── */}
      <div
        className={cn(
          "hidden md:grid items-center gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground",
          gridCols,
          listEmpty && "md:hidden",
        )}
      >
        <Checkbox
          checked={allSelected}
          onCheckedChange={(c) =>
            setSelectedIds(c ? new Set(flat.map((t) => t.id)) : new Set())
          }
          aria-label="Selecionar todas"
        />
        <SortHead field="dueDate" label="Vencimento" />
        <SortHead field="description" label="Descrição" />
        <SortHead field="supplierOrClient" label={copy.counterpart} />
        <SortHead field="amount" label="Valor" className="justify-end" />
        <SortHead field="status" label="Status" className="pl-3" />
        <span className="sr-only">Ações</span>
      </div>

      {/* ── Linhas ────────────────────────────────────────────────────── */}
      {isLoading || seekingBatch ? (
        <ListSkeleton />
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="text-sm font-medium">
            Não foi possível carregar as contas.
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Tentar de novo
          </Button>
        </div>
      ) : flat.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted-foreground">
          {tab === "overdue" && !searching && activeFilterCount === 0 ? (
            <CircleCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          <p className="text-sm font-medium">
            {searching
              ? `Nenhum resultado para "${searchTerm.trim()}"`
              : noData
                ? copy.empty
                : EMPTY[tab]}
          </p>
          {(searching || activeFilterCount > 0) && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={clearFilters}
            >
              Limpar busca e filtros
            </Button>
          )}
          {noData && onCreate && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={onCreate}
            >
              {copy.create}
            </Button>
          )}
          {!searching &&
            !noData &&
            (tab === "overdue" || tab === "today") &&
            weekTotals?.count !== 0 && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setPref("tab", "week")}
              >
                Ver os próximos 7 dias
                {weekTotals && ` (${weekTotals.count})`}
              </Button>
            )}
        </div>
      ) : (
        <ul aria-label="Contas">
          {groups
            ? groups.map((g) => {
                const negative = g.balance !== undefined && g.balance < 0;
                const partial = hasMore && g.key === lastGroupKey;
                const server = partial ? lastGroupTotals : undefined;
                const count = server?.[0].count ?? g.rows.length;
                const total = server?.[0].total ?? g.total;
                const drafts = server ? server[1].count : g.drafts;
                // Encargos dependem da regra de cada entidade: só fecham com o grupo inteiro.
                const corrected = partial ? undefined : g.corrected;
                const picked = g.rows.filter((t) =>
                  selectedIds.has(t.id),
                ).length;
                return (
                  <li
                    key={g.key}
                    id={`grupo-${g.key}`}
                    className="scroll-mt-16"
                  >
                    {/* Mesma grade das linhas: o total cai sob a coluna Valor. */}
                    <div
                      className={cn(
                        "flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b px-4 py-1.5 text-xs md:grid md:gap-3",
                        gridCols,
                        negative
                          ? "bg-red-50 dark:bg-red-950/30"
                          : "bg-muted/20",
                      )}
                    >
                      <div className="hidden md:flex">
                        <Checkbox
                          checked={
                            picked === 0
                              ? false
                              : picked === g.rows.length
                                ? true
                                : "indeterminate"
                          }
                          onCheckedChange={(c) =>
                            setMany(
                              g.rows.map((t) => t.id),
                              c === true,
                            )
                          }
                          aria-label={`Selecionar ${g.label}`}
                        />
                      </div>
                      <span className="font-medium text-foreground md:col-[2/5]">
                        {g.label}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {count} {count === 1 ? "conta" : "contas"}
                          {isPayable && tab !== "future" && drafts > 0 && (
                            <>
                              {" · "}
                              {drafts === count
                                ? drafts === 1
                                  ? "em rascunho"
                                  : "todas em rascunho"
                                : `${drafts} em rascunho`}
                            </>
                          )}
                          {partial && !server && (
                            <span title="Soma só das contas já carregadas; role para carregar o resto">
                              {" · parcial"}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="ml-auto font-financial font-medium tabular-nums text-foreground md:ml-0 md:text-right">
                        {formatCurrency(total)}
                      </span>
                      {(corrected !== undefined || g.balance !== undefined) && (
                        <span
                          className={cn(
                            "whitespace-nowrap font-financial tabular-nums md:col-[6/-1]",
                            negative
                              ? "font-medium text-red-700 dark:text-red-300"
                              : "text-muted-foreground",
                          )}
                          title={
                            g.balance !== undefined
                              ? "Saldo previsto no fim do dia, somando contas a pagar e a receber"
                              : undefined
                          }
                        >
                          {corrected !== undefined
                            ? `c/ encargos ${formatCurrency(corrected)}`
                            : `saldo previsto ${formatCurrency(g.balance!)}`}
                        </span>
                      )}
                    </div>
                    <ul>{g.rows.map(renderRow)}</ul>
                  </li>
                );
              })
            : flat.map(renderRow)}
        </ul>
      )}

      {!searching && hasMore && (
        <div ref={sentinelRef} className={isFetchingNextPage ? "py-3" : "h-px"}>
          {isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando mais...
            </div>
          )}
        </div>
      )}

      {/* ── Rodapé fixo: totais, seleção e ações em lote ──────────────── */}
      <div className="sticky bottom-[max(calc(env(safe-area-inset-bottom)+4.5rem),5rem)] z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t bg-card/95 px-4 py-2.5 backdrop-blur-sm md:bottom-0">
        {selectedIds.size > 0 ? (
          <>
            <span className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {selectedIds.size} selecionada{selectedIds.size !== 1 && "s"}
              </span>
              <span className="font-financial tabular-nums text-muted-foreground">
                {formatCurrency(selectedTotal)}
              </span>
              {allSelected && !searching && hasMore && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  · só entre as {flat.length} carregadas
                </span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {isPayable && (perms.isAdmin || perms.isFinancialManager) && (
                <>
                  <Button size="sm" onClick={() => setBulkDialog("pay")}>
                    <Banknote className="mr-1.5 h-4 w-4" />
                    Pagar
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={openBatchDialog}
                  >
                    <Layers className="mr-1.5 h-4 w-4 max-sm:mr-0" />
                    <span className="max-sm:sr-only">Adicionar ao lote</span>
                  </Button>
                  {bulkRevertable.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setBulkDialog("revert")}
                    >
                      <RotateCcw className="mr-1.5 h-4 w-4 max-sm:mr-0" />
                      <span className="max-sm:sr-only">Reverter</span>
                    </Button>
                  )}
                </>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                aria-label="Desmarcar todas"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {/* Vazia, a aba e a lista já dizem "0": o rodapé não repete. */}
              {activeTotals && activeTotals.count > 0 ? (
                <>
                  <span className="font-medium text-foreground tabular-nums">
                    {activeTotals.count}
                  </span>{" "}
                  {activeTotals.count === 1 ? "conta" : "contas"} ·{" "}
                  <span className="font-financial font-medium tabular-nums text-foreground">
                    {formatCurrency(activeTotals.total)}
                  </span>
                  {!searching && activeTotals.count > flat.length && (
                    <span>
                      {" "}
                      · {flat.length} carregadas
                      {customSort && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {" "}
                          (a ordenação vale só para elas)
                        </span>
                      )}
                    </span>
                  )}
                </>
              ) : (
                " "
              )}
            </span>
            <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
              <Kbd>j</Kbd>/<Kbd>k</Kbd> navegar · <Kbd>x</Kbd> selecionar (
              <Kbd>Shift</Kbd> intervalo) · <Kbd>Enter</Kbd> abrir ·{" "}
              <Kbd>p</Kbd> {copy.pay.toLowerCase()} · <Kbd>c</Kbd> copiar boleto
              · <Kbd>/</Kbd> buscar · <Kbd>1</Kbd>–<Kbd>{tabs.length}</Kbd> abas
            </span>
          </>
        )}
      </div>

      {/* ── Painel lateral ────────────────────────────────────────────── */}
      <TransactionDetailsDialog
        panel
        transaction={panelTx}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onUpdate={(updated) => (updated ? patchRow(updated) : refresh())}
        costCenters={costCenters}
        onNavigate={moveActive}
        focusAction={panelAction}
        punctuality={
          panelTx && !isPayable
            ? punctualityQuery.data?.[counterpartKey(panelTx) ?? ""]
            : undefined
        }
      />

      {payingTx && (
        <PaymentDialog
          isOpen={!!payingTx}
          onClose={() => setPayingTx(null)}
          onConfirm={confirmPay}
          transaction={payingTx}
          type={isPayable ? "pay" : "receive"}
          lateFee={ruleFor(payingTx)}
        />
      )}
      {isCheckingBatch && <span className="sr-only">Validando lote…</span>}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir transação"
        description="Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* ── Diálogos de lote ──────────────────────────────────────────── */}
      <ResponsiveModal
        open={bulkDialog === "pay"}
        onOpenChange={(o) => !o && setBulkDialog(null)}
      >
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Pagamento em lote</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {bulkPayable.length} conta(s) serão pagas,{" "}
              {formatCurrency(
                bulkPayable.reduce((acc, t) => acc.add(t.amount), currency(0))
                  .value,
              )}
              . {bulkHeld > 0 && `${bulkHeld} bloqueada(s) ficam de fora. `}
              Já pagas são ignoradas.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-date">Data do pagamento</Label>
            <Input
              id="bulk-date"
              type="date"
              value={format(bulkDate, "yyyy-MM-dd")}
              onChange={(e) => {
                const d = e.target.valueAsDate;
                if (d)
                  setBulkDate(
                    new Date(d.getTime() + d.getTimezoneOffset() * 60000),
                  );
              }}
            />
          </div>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)}>
              Cancelar
            </Button>
            <Button
              onClick={bulkPay}
              disabled={isBulkProcessing || bulkPayable.length === 0}
            >
              {isBulkProcessing && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar pagamento
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <AddToBatchDialog
        open={bulkDialog === "batch"}
        onOpenChange={(o) => !o && setBulkDialog(null)}
        transactions={selectedRows}
        onDone={() => {
          setBulkDialog(null);
          setSelectedIds(new Set());
          refresh();
        }}
      />

      <ResponsiveModal
        open={bulkDialog === "revert"}
        onOpenChange={(o) => !o && setBulkDialog(null)}
      >
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Reverter pagamentos</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {bulkRevertable.length} conta(s) paga(s) voltam para rascunho. As
              não pagas são ignoradas.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setBulkDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={bulkRevert}
              disabled={isBulkProcessing}
            >
              {isBulkProcessing && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reverter
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* ── Filtros (mobile) ──────────────────────────────────────────── */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-3"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" />
          <SheetTitle className="mb-2 text-base font-semibold">
            Filtros
          </SheetTitle>
          <div className="space-y-3">{filterControls(true)}</div>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                clearFilters();
                setMobileFiltersOpen(false);
              }}
            >
              Limpar
            </Button>
            <Button
              className="flex-1"
              onClick={() => setMobileFiltersOpen(false)}
            >
              Ver contas
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Peças pequenas ────────────────────────────────────────────────────────────

function Flag({
  icon: Icon,
  tone = "muted",
  title,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "warn" | "danger" | "info";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] leading-5",
        tone === "muted" && "text-muted-foreground",
        tone === "warn" && "text-amber-700 dark:text-amber-400",
        tone === "danger" && "text-red-600 dark:text-red-400",
        tone === "info" && "text-sky-700 dark:text-sky-400",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function PunctualityNote({
  avgDays,
  count,
}: {
  avgDays: number;
  count: number;
}) {
  return (
    <p
      className={cn(
        "text-xs",
        avgDays > 5 && "text-amber-700 dark:text-amber-400",
      )}
      title={`Média de ${count} recebimento(s) nos últimos 12 meses`}
    >
      {avgDays > 0 ? `atraso médio de ${avgDays} d` : "costuma pagar em dia"}
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-32 md:block" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}
