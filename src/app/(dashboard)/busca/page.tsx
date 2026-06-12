"use client";

import React, { useMemo, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { DateRange } from "react-day-picker";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { transactionService } from "@/lib/services/transactionService";
import { Transaction, RequestOriginType } from "@/lib/types";
import {
  REQUEST_ORIGIN_TYPE_LABELS,
  REQUEST_ORIGIN_TYPE_SHORT,
} from "@/lib/constants/requestOrigin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandInput,
} from "@/components/ui/command";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { formatCurrency } from "@/lib/utils";
import { format, addDays, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileX,
  ChevronRight,
  Check,
  ChevronsUpDown,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Matching utilities ────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesValue(amount: number, raw: string): boolean {
  const q = raw.trim();

  const rangeMatch = q.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1].replace(",", "."));
    const max = parseFloat(rangeMatch[2].replace(",", "."));
    return amount >= min && amount <= max;
  }

  const gtMatch = q.match(/^>(\d+(?:[.,]\d+)?)$/);
  if (gtMatch) return amount > parseFloat(gtMatch[1].replace(",", "."));

  const ltMatch = q.match(/^<(\d+(?:[.,]\d+)?)$/);
  if (ltMatch) return amount < parseFloat(ltMatch[1].replace(",", "."));

  if (/^\d/.test(q)) {
    const num = parseFloat(q.replace(",", ".").replace(/[^\d.]/g, ""));
    if (!isNaN(num)) return Math.abs(amount - num) < 0.01;
  }

  return false;
}

function matchesQuery(
  t: Transaction,
  normalizedQ: string,
  rawQ: string,
): boolean {
  const textFields = [
    t.description,
    t.supplierOrClient ?? "",
    t.requestOrigin?.name ?? "",
  ];
  if (textFields.some((f) => normalizeText(f).includes(normalizedQ)))
    return true;
  if (matchesValue(t.amount, rawQ)) return true;
  return false;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/15 text-primary rounded-[2px] px-0.5 font-medium not-italic">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function SortIcon({
  column,
  sortConfig,
}: {
  column: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== column)
    return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40 inline-block" />;
  return sortConfig.direction === "asc" ? (
    <ArrowUp className="h-3 w-3 ml-1 text-primary inline-block" />
  ) : (
    <ArrowDown className="h-3 w-3 ml-1 text-primary inline-block" />
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "paid":
    case "received":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-500/20">
          Concluído
        </Badge>
      );
    case "pending":
      return (
        <Badge
          variant="outline"
          className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950"
        >
          Pendente
        </Badge>
      );
    case "pending_approval":
      return (
        <Badge
          variant="outline"
          className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950"
        >
          Ag. Aprovação
        </Badge>
      );
    case "approved":
      return (
        <Badge
          variant="outline"
          className="text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950"
        >
          Aprovado
        </Badge>
      );
    case "pending_authorization":
      return (
        <Badge
          variant="outline"
          className="text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950"
        >
          Ag. Autorização
        </Badge>
      );
    case "authorized":
      return (
        <Badge
          variant="outline"
          className="text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950"
        >
          Autorizado
        </Badge>
      );
    case "late":
      return <Badge variant="destructive">Atrasado</Badge>;
    case "rejected":
      return (
        <Badge
          variant="outline"
          className="text-destructive border-destructive/40 bg-destructive/5"
        >
          Rejeitado
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

type TypeFilter = "all" | "payable" | "receivable";

const TYPE_FILTER_OPTIONS: { label: string; value: TypeFilter }[] = [
  { label: "Todos", value: "all" },
  { label: "A pagar", value: "payable" },
  { label: "A receber", value: "receivable" },
];

const ORIGIN_TYPE_ORDER: RequestOriginType[] = [
  "director",
  "department",
  "sector",
];

type GroupByMode = "none" | "origin" | "status";

const GROUP_BY_LABELS: Record<GroupByMode, string> = {
  none: "Nenhum",
  origin: "Origem",
  status: "Status",
};

const STATUS_GROUP_LABELS: Record<string, string> = {
  late: "Atrasado",
  pending: "Pendente",
  draft: "Rascunho",
  pending_approval: "Ag. Aprovação",
  approved: "Aprovado",
  pending_authorization: "Ag. Autorização",
  authorized: "Autorizado",
  paid: "Pago / Recebido",
  received: "Pago / Recebido",
  rejected: "Rejeitado",
};

const STATUS_GROUP_ORDER = [
  "late",
  "pending",
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "paid",
  "received",
  "rejected",
];

const STATUS_FILTER_OPTIONS: {
  value: string;
  label: string;
  colorClass: string;
}[] = [
  { value: "late", label: "Atrasado", colorClass: "text-destructive" },
  {
    value: "pending",
    label: "Pendente",
    colorClass: "text-amber-600 dark:text-amber-400",
  },
  {
    value: "pending_approval",
    label: "Ag. Aprovação",
    colorClass: "text-blue-600 dark:text-blue-400",
  },
  {
    value: "approved",
    label: "Aprovado",
    colorClass: "text-indigo-600 dark:text-indigo-400",
  },
  {
    value: "pending_authorization",
    label: "Ag. Autorização",
    colorClass: "text-violet-600 dark:text-violet-400",
  },
  {
    value: "authorized",
    label: "Autorizado",
    colorClass: "text-teal-600 dark:text-teal-400",
  },
  {
    value: "paid",
    label: "Pago / Recebido",
    colorClass: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "draft",
    label: "Rascunho",
    colorClass: "text-muted-foreground",
  },
  {
    value: "rejected",
    label: "Rejeitado",
    colorClass: "text-destructive",
  },
];

const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "overdue", label: "Vencidos" },
  { value: "7d", label: "Próx. 7d" },
  { value: "30d", label: "Próx. 30d" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Período..." },
];

const AGING_COLORS: Record<string, string> = {
  late: "bg-destructive",
  pending: "bg-amber-400",
  draft: "bg-muted-foreground/30",
  pending_approval: "bg-blue-400",
  approved: "bg-indigo-400",
  pending_authorization: "bg-violet-400",
  authorized: "bg-teal-400",
  paid: "bg-emerald-400",
  received: "bg-emerald-400",
  rejected: "bg-muted-foreground/20",
};

// ── Aging bar ─────────────────────────────────────────────────────────────────

function AgingBar({
  data,
  total,
}: {
  data: Record<string, number>;
  total: number;
}) {
  const segments = STATUS_GROUP_ORDER.filter((key) => (data[key] ?? 0) > 0).map(
    (key) => ({
      key,
      label: STATUS_GROUP_LABELS[key] ?? key,
      count: data[key],
      pct: (data[key] / total) * 100,
      colorClass: AGING_COLORS[key] ?? "bg-muted",
    }),
  );

  if (segments.length === 0) return null;

  return (
    <div
      className="rounded-lg border bg-card p-3 animate-in fade-in duration-200"
      aria-label={`Distribuição por status: ${segments.map((s) => `${s.label} ${s.count}`).join(", ")}`}
    >
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Distribuição por status
      </p>
      <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-px">
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn(s.colorClass)}
            style={{
              width: `${s.pct}%`,
              transition: "width 300ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {segments.map((s) => (
          <span
            key={s.key}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                s.colorClass,
              )}
            />
            {s.label} · {s.count}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Top origins chart ─────────────────────────────────────────────────────────

function TopOriginsChart({
  data,
}: {
  data: { name: string; total: number }[];
}) {
  return (
    <div
      className="rounded-lg border bg-card p-3 animate-in fade-in duration-200"
      aria-label={`Top origens por valor: ${data.map((d) => `${d.name} ${formatCurrency(d.total)}`).join(", ")}`}
    >
      <p className="text-xs font-medium text-muted-foreground mb-3">
        Top origens por valor
      </p>
      <ResponsiveContainer width="100%" height={data.length * 32 + 8}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatCurrency(v)}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => [formatCurrency(value), "Total"]}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar
            dataKey="total"
            fill="hsl(var(--chart-1))"
            radius={[0, 3, 3, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Mobile transaction row (for < lg viewports) ───────────────────────────────

function MobileTransactionRow({ t, query }: { t: Transaction; query: string }) {
  const isPayable = t.type === "payable";
  const { openTransaction } = useTransactionDetailStore();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTransaction(t)}
      onKeyDown={(e) => e.key === "Enter" && openTransaction(t)}
      className="flex items-start gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors cursor-pointer"
    >
      <span
        className={cn(
          "mt-0.5 shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          isPayable
            ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
            : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400",
        )}
      >
        {isPayable ? "Pagar" : "Receber"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug flex-1 min-w-0">
            <HighlightedText text={t.description} query={query} />
          </p>
          <span
            className={cn(
              "shrink-0 text-sm font-semibold font-financial tabular-nums",
              isPayable
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {isPayable ? "−" : "+"}
            {formatCurrency(t.amount)}
          </span>
        </div>
        {t.supplierOrClient && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            <HighlightedText text={t.supplierOrClient} query={query} />
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {getStatusBadge(t.status)}
          <span className="text-xs text-muted-foreground">
            {format(t.dueDate, "dd/MM/yyyy", { locale: ptBR })}
          </span>
          {t.requestOrigin && (
            <span className="text-xs text-muted-foreground/70 truncate max-w-[120px]">
              {t.requestOrigin.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openTransaction } = useTransactionDetailStore();
  const query = searchParams.get("q") || "";
  const typeParam = searchParams.get("type") as TypeFilter | null;
  const originParam = searchParams.get("origem") || "";
  const nameParam = searchParams.get("nome") || "";
  const statusParam = searchParams.get("status") || "";
  const presetParam = searchParams.get("preset") || "";
  const dateFromParam = searchParams.get("dateFrom") || "";
  const dateToParam = searchParams.get("dateTo") || "";
  const minValParam = searchParams.get("minVal") || "";
  const maxValParam = searchParams.get("maxVal") || "";

  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    typeParam && typeParam !== "all" ? typeParam : "all",
  );
  const [originTypes, setOriginTypes] = useState<RequestOriginType[]>(() =>
    originParam
      ? (originParam
          .split(",")
          .filter((v) =>
            ORIGIN_TYPE_ORDER.includes(v as RequestOriginType),
          ) as RequestOriginType[])
      : [],
  );
  const [originName, setOriginName] = useState<string>(nameParam);
  const [originNameOpen, setOriginNameOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByMode>("none");
  const [statusFilters, setStatusFilters] = useState<string[]>(() =>
    statusParam ? statusParam.split(",").filter(Boolean) : [],
  );
  const [dueDatePreset, setDueDatePreset] = useState(presetParam);
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(
    () => {
      if (!dateFromParam) return undefined;
      return {
        from: new Date(dateFromParam),
        to: dateToParam ? new Date(dateToParam) : undefined,
      };
    },
  );
  const [minValue, setMinValue] = useState(minValParam);
  const [maxValue, setMaxValue] = useState(maxValParam);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  // ── React Query fetch — cached 60s ──
  const { data: allTransactions = [], isLoading } = useQuery({
    queryKey: [
      "busca-transactions",
      selectedCompany?.id,
      onlyOwnPayables ? user?.uid : null,
    ],
    queryFn: () =>
      transactionService.getAll({
        companyId: selectedCompany!.id,
        ...(onlyOwnPayables && user ? { createdBy: user.uid } : {}),
      }),
    enabled: !!selectedCompany && !!user,
    staleTime: 60_000,
  });

  // ── URL helper ──
  const updateURL = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      });
      router.replace(`/busca?${params.toString()}`);
    },
    [searchParams, router],
  );

  // ── Base filter: query + typeFilter only ──
  const filteredBase = useMemo(() => {
    if (!query) return [];
    const normalizedQ = normalizeText(query);
    return allTransactions.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return matchesQuery(t, normalizedQ, query);
    });
  }, [allTransactions, query, typeFilter]);

  // ── Facet counts (from filteredBase, before facet filters) ──
  const originTypeCounts = useMemo(() => {
    const counts: Partial<Record<RequestOriginType, number>> = {};
    filteredBase.forEach((t) => {
      const type = t.requestOrigin?.type;
      if (type) counts[type] = (counts[type] ?? 0) + 1;
    });
    return counts;
  }, [filteredBase]);

  const statusCounts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const counts: Record<string, number> = {};
    filteredBase.forEach((t) => {
      const isLate =
        t.status !== "paid" &&
        t.status !== "received" &&
        t.status !== "rejected" &&
        t.dueDate < today;
      const key = isLate ? "late" : t.status === "received" ? "paid" : t.status;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [filteredBase]);

  const availableOriginNames = useMemo(() => {
    const names = new Set<string>();
    filteredBase.forEach((t) => {
      if (!t.requestOrigin?.name) return;
      if (
        originTypes.length === 0 ||
        originTypes.includes(t.requestOrigin.type)
      ) {
        names.add(t.requestOrigin.name);
      }
    });
    return Array.from(names).sort();
  }, [filteredBase, originTypes]);

  const hasOriginData = useMemo(
    () => filteredBase.some((t) => t.requestOrigin?.type),
    [filteredBase],
  );

  // ── Full filtered set: base + all facet filters ──
  const filtered = useMemo(() => {
    let result = filteredBase;

    // Origin
    if (originTypes.length > 0 || originName) {
      result = result.filter((t) => {
        if (
          originTypes.length > 0 &&
          (!t.requestOrigin?.type ||
            !originTypes.includes(t.requestOrigin.type))
        )
          return false;
        if (originName && t.requestOrigin?.name !== originName) return false;
        return true;
      });
    }

    // Status
    if (statusFilters.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      result = result.filter((t) =>
        statusFilters.some((sf) => {
          if (sf === "late")
            return (
              t.status !== "paid" &&
              t.status !== "received" &&
              t.status !== "rejected" &&
              t.dueDate < today
            );
          if (sf === "paid")
            return t.status === "paid" || t.status === "received";
          return t.status === sf;
        }),
      );
    }

    // Due date preset / range
    if (dueDatePreset) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      result = result.filter((t) => {
        const due = t.dueDate;
        if (dueDatePreset === "overdue") return due < today;
        if (dueDatePreset === "7d")
          return due >= today && due <= addDays(today, 7);
        if (dueDatePreset === "30d")
          return due >= today && due <= addDays(today, 30);
        if (dueDatePreset === "month") {
          return due >= startOfMonth(today) && due <= endOfMonth(today);
        }
        if (dueDatePreset === "custom" && customDateRange?.from) {
          const to = customDateRange.to ?? customDateRange.from;
          return due >= customDateRange.from && due <= to;
        }
        return true;
      });
    }

    // Value range
    if (minValue !== "" || maxValue !== "") {
      const min =
        minValue !== "" ? parseFloat(minValue.replace(",", ".")) : null;
      const max =
        maxValue !== "" ? parseFloat(maxValue.replace(",", ".")) : null;
      result = result.filter((t) => {
        if (min !== null && !isNaN(min) && t.amount < min) return false;
        if (max !== null && !isNaN(max) && t.amount > max) return false;
        return true;
      });
    }

    return result;
  }, [
    filteredBase,
    originTypes,
    originName,
    statusFilters,
    dueDatePreset,
    customDateRange,
    minValue,
    maxValue,
  ]);

  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(filtered);

  // ── Summary computations ──
  const summary = useMemo(() => {
    if (filtered.length === 0)
      return {
        totalPayable: 0,
        totalReceivable: 0,
        saldo: 0,
        lateCount: 0,
        avgTicket: 0,
      };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalPayable = filtered
      .filter((t) => t.type === "payable")
      .reduce((acc, t) => acc + t.amount, 0);

    const totalReceivable = filtered
      .filter((t) => t.type === "receivable")
      .reduce((acc, t) => acc + t.amount, 0);

    const lateCount = filtered.filter(
      (t) =>
        t.status !== "paid" &&
        t.status !== "received" &&
        t.status !== "rejected" &&
        t.dueDate < today,
    ).length;

    const avgTicket =
      filtered.reduce((acc, t) => acc + t.amount, 0) / filtered.length;

    return {
      totalPayable,
      totalReceivable,
      saldo: totalReceivable - totalPayable,
      lateCount,
      avgTicket,
    };
  }, [filtered]);

  // ── Groups (preserves sort order within groups) ──
  const groups = useMemo(() => {
    if (groupBy === "none") return null;

    const groupMap = new Map<string, Transaction[]>();
    sortedTransactions.forEach((t) => {
      const key =
        groupBy === "origin" ? (t.requestOrigin?.type ?? "__none__") : t.status;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(t);
    });

    const orderArr =
      groupBy === "origin" ? ORIGIN_TYPE_ORDER : STATUS_GROUP_ORDER;
    const orderMap = Object.fromEntries(orderArr.map((k, i) => [k, i]));

    return Array.from(groupMap.entries())
      .sort(([a], [b]) => (orderMap[a] ?? 99) - (orderMap[b] ?? 99))
      .map(([key, items]) => {
        const label =
          groupBy === "origin"
            ? key === "__none__"
              ? "Sem origem"
              : (REQUEST_ORIGIN_TYPE_LABELS[key as RequestOriginType] ?? key)
            : (STATUS_GROUP_LABELS[key] ?? key);

        const subtotalPayable = items
          .filter((t) => t.type === "payable")
          .reduce((acc, t) => acc + t.amount, 0);
        const subtotalReceivable = items
          .filter((t) => t.type === "receivable")
          .reduce((acc, t) => acc + t.amount, 0);

        return { key, label, items, subtotalPayable, subtotalReceivable };
      });
  }, [sortedTransactions, groupBy]);

  // ── Aging bar data (conditional: ≥8 results) ──
  const agingBarData = useMemo(() => {
    if (filtered.length < 8) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = {};
    filtered.forEach((t) => {
      const isLate =
        t.status !== "paid" &&
        t.status !== "received" &&
        t.status !== "rejected" &&
        t.dueDate < today;
      const key = isLate ? "late" : t.status === "received" ? "paid" : t.status;
      buckets[key] = (buckets[key] ?? 0) + 1;
    });
    return buckets;
  }, [filtered]);

  // ── Top origins chart (conditional: ≥15 results or grouped by origin) ──
  const topOriginsData = useMemo(() => {
    if (filtered.length < 15 && groupBy !== "origin") return null;
    const map: Record<string, number> = {};
    filtered.forEach((t) => {
      if (!t.requestOrigin?.name) return;
      map[t.requestOrigin.name] = (map[t.requestOrigin.name] ?? 0) + t.amount;
    });
    const entries = Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    if (entries.length < 2) return null;
    return entries.map(([name, total]) => ({ name, total }));
  }, [filtered, groupBy]);

  // ── Active filter count ──
  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    statusFilters.length +
    originTypes.length +
    (originName ? 1 : 0) +
    (dueDatePreset ? 1 : 0) +
    (minValue || maxValue ? 1 : 0);

  // ── Handlers ──
  const handleTypeFilter = useCallback(
    (value: TypeFilter) => {
      setTypeFilter(value);
      updateURL({ type: value !== "all" ? value : null });
    },
    [updateURL],
  );

  const handleStatusToggle = useCallback(
    (status: string) => {
      setStatusFilters((prev) => {
        const next = prev.includes(status)
          ? prev.filter((s) => s !== status)
          : [...prev, status];
        updateURL({ status: next.length > 0 ? next.join(",") : null });
        return next;
      });
    },
    [updateURL],
  );

  const handleOriginTypeToggle = useCallback(
    (type: RequestOriginType) => {
      const newTypes = originTypes.includes(type)
        ? originTypes.filter((t) => t !== type)
        : [...originTypes, type];
      setOriginTypes(newTypes);
      setOriginName("");
      updateURL({
        origem: newTypes.length > 0 ? newTypes.join(",") : null,
        nome: null,
      });
    },
    [originTypes, updateURL],
  );

  const handleOriginNameSelect = useCallback(
    (name: string) => {
      const newName = originName === name ? "" : name;
      setOriginName(newName);
      setOriginNameOpen(false);
      updateURL({ nome: newName || null });
    },
    [originName, updateURL],
  );

  const handleDueDatePreset = useCallback(
    (preset: string) => {
      const newPreset = dueDatePreset === preset ? "" : preset;
      setDueDatePreset(newPreset);
      if (newPreset !== "custom") {
        setCustomDateRange(undefined);
        updateURL({ preset: newPreset || null, dateFrom: null, dateTo: null });
      } else {
        updateURL({ preset: newPreset });
      }
    },
    [dueDatePreset, updateURL],
  );

  const handleCustomDateRange = useCallback(
    (range: DateRange | undefined) => {
      setCustomDateRange(range);
      setDueDatePreset("custom");
      updateURL({
        preset: "custom",
        dateFrom: range?.from ? range.from.toISOString() : null,
        dateTo: range?.to ? range.to.toISOString() : null,
      });
    },
    [updateURL],
  );

  const handleClearAllFilters = useCallback(() => {
    setTypeFilter("all");
    setStatusFilters([]);
    setOriginTypes([]);
    setOriginName("");
    setDueDatePreset("");
    setCustomDateRange(undefined);
    setMinValue("");
    setMaxValue("");
    updateURL({
      type: null,
      status: null,
      origem: null,
      nome: null,
      preset: null,
      dateFrom: null,
      dateTo: null,
      minVal: null,
      maxVal: null,
    });
  }, [updateURL]);

  const hasResults = !isLoading && filtered.length > 0;
  const hasBaseResults = !isLoading && filteredBase.length > 0;

  // ── Row renderer ──
  function renderRow(transaction: Transaction, index: number) {
    const isPayable = transaction.type === "payable";
    return (
      <TableRow
        key={transaction.id}
        onClick={() => openTransaction(transaction)}
        className="group cursor-pointer animate-in fade-in-0 slide-in-from-bottom-1"
        style={{
          animationDelay: `${Math.min(index, 30) * 25}ms`,
          animationFillMode: "both",
          animationTimingFunction: "cubic-bezier(0.25, 1, 0.5, 1)",
        }}
      >
        <TableCell className="font-medium pl-6">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isPayable
                  ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                  : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isPayable ? "Pagar" : "Receber"}
            </span>
            <span className="truncate max-w-[200px]">
              <HighlightedText text={transaction.description} query={query} />
            </span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {transaction.supplierOrClient ? (
            <HighlightedText
              text={transaction.supplierOrClient}
              query={query}
            />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {transaction.requestOrigin ? (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50 shrink-0">
                {REQUEST_ORIGIN_TYPE_SHORT[transaction.requestOrigin.type]}
              </span>
              <span className="text-sm">
                <HighlightedText
                  text={transaction.requestOrigin.name}
                  query={query}
                />
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums text-sm">
          {format(transaction.dueDate, "dd/MM/yyyy", { locale: ptBR })}
        </TableCell>
        <TableCell>{getStatusBadge(transaction.status)}</TableCell>
        <TableCell
          className={cn(
            "text-right font-semibold font-financial tabular-nums pr-6",
            isPayable
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {isPayable ? "−" : "+"}
          {formatCurrency(transaction.amount)}
        </TableCell>
        <TableCell className="pr-4">
          <span className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </span>
        </TableCell>
      </TableRow>
    );
  }

  const filterSections = (
    <div className="divide-y divide-border/50">
      {/* Tipo */}
      <div className="px-6 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Tipo</p>
        <div className="flex rounded-md border overflow-hidden">
          {TYPE_FILTER_OPTIONS.map(({ label, value }) => (
            <button
              type="button"
              key={value}
              onClick={() => handleTypeFilter(value)}
              className={cn(
                "flex-1 py-1 text-xs transition-colors",
                typeFilter === value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      {hasBaseResults && (
        <div className="px-6 py-4 animate-in fade-in duration-200">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Status
          </p>
          <div className="space-y-1.5">
            {STATUS_FILTER_OPTIONS.map(({ value, label, colorClass }) => {
              const count = statusCounts[value] ?? 0;
              if (count === 0 && !statusFilters.includes(value)) return null;
              return (
                <label
                  key={value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={statusFilters.includes(value)}
                    onCheckedChange={() => handleStatusToggle(value)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className={cn("text-xs flex-1", colorClass)}>
                    {label}
                  </span>
                  {count > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Tipo de Origem */}
      {hasBaseResults && hasOriginData && (
        <div className="px-6 py-4 animate-in fade-in duration-200">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Tipo de Origem
          </p>
          <div className="space-y-1.5">
            {ORIGIN_TYPE_ORDER.map((type) => {
              const count = originTypeCounts[type] ?? 0;
              if (count === 0 && !originTypes.includes(type)) return null;
              return (
                <label
                  key={type}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={originTypes.includes(type)}
                    onCheckedChange={() => handleOriginTypeToggle(type)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="text-xs flex-1 text-foreground">
                    {REQUEST_ORIGIN_TYPE_LABELS[type]}
                  </span>
                  {count > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Nome origem combobox */}
          {availableOriginNames.length > 0 && (
            <div className="mt-2">
              <Popover open={originNameOpen} onOpenChange={setOriginNameOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                      originName
                        ? "border-primary/50 bg-primary/5 text-foreground"
                        : "border-muted-foreground/20 bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex-1 truncate text-left">
                      {originName || "Nome origem"}
                    </span>
                    {originName ? (
                      <X
                        className="h-3 w-3 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOriginNameSelect("");
                        }}
                      />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 shrink-0" />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Filtrar nome..."
                      className="h-8 text-xs"
                    />
                    <CommandList>
                      <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                        Nenhum nome encontrado
                      </CommandEmpty>
                      <CommandGroup>
                        {availableOriginNames.map((name) => (
                          <CommandItem
                            key={name}
                            value={name}
                            onSelect={() => handleOriginNameSelect(name)}
                            className="text-xs"
                          >
                            <Check
                              className={cn(
                                "mr-2 h-3 w-3 shrink-0",
                                originName === name
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      )}

      {/* Vencimento */}
      {hasBaseResults && (
        <div className="px-6 py-4 animate-in fade-in duration-200">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Vencimento
          </p>
          <div className="flex flex-wrap gap-1">
            {DATE_PRESETS.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                onClick={() => handleDueDatePreset(value)}
                className={cn(
                  "px-2 py-0.5 text-xs rounded-md border transition-colors",
                  dueDatePreset === value
                    ? "bg-primary/10 border-primary/30 text-primary font-medium"
                    : "border-muted-foreground/20 text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {dueDatePreset === "custom" && (
            <div className="mt-2">
              <DatePickerWithRange
                date={customDateRange}
                setDate={handleCustomDateRange}
              />
            </div>
          )}
        </div>
      )}

      {/* Valor */}
      {hasBaseResults && (
        <div className="px-6 py-3 animate-in fade-in duration-200">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Valor (R$)
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              placeholder="Mín"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              onBlur={(e) => updateURL({ minVal: e.target.value || null })}
              className="h-7 text-xs px-2"
            />
            <span className="text-xs text-muted-foreground shrink-0">–</span>
            <Input
              type="number"
              placeholder="Máx"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              onBlur={(e) => updateURL({ maxVal: e.target.value || null })}
              className="h-7 text-xs px-2"
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Resultados da Busca
        </h1>
        <p className="text-muted-foreground">
          {query
            ? `Mostrando resultados para "${query}"`
            : "Use a barra de busca para pesquisar transações."}
        </p>
      </div>

      {/* Summary bar */}
      {hasResults && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationFillMode: "both" }}
        >
          <span className="text-muted-foreground">
            A pagar{" "}
            <span className="font-financial font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCurrency(summary.totalPayable)}
            </span>
          </span>
          <span className="text-muted-foreground/40 select-none">·</span>
          <span className="text-muted-foreground">
            A receber{" "}
            <span className="font-financial font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.totalReceivable)}
            </span>
          </span>
          <span className="text-muted-foreground/40 select-none">·</span>
          <span className="text-muted-foreground">
            Saldo{" "}
            <span
              className={cn(
                "font-financial font-semibold tabular-nums",
                summary.saldo >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {summary.saldo >= 0 ? "+" : ""}
              {formatCurrency(summary.saldo)}
            </span>
          </span>
          {summary.lateCount > 0 && (
            <>
              <span className="text-muted-foreground/40 select-none">·</span>
              <span className="font-medium text-destructive">
                {summary.lateCount} atrasado
                {summary.lateCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
          <span className="text-muted-foreground/40 select-none">·</span>
          <span className="text-muted-foreground">
            Ticket médio{" "}
            <span className="font-financial font-semibold tabular-nums text-foreground">
              {formatCurrency(summary.avgTicket)}
            </span>
          </span>
        </div>
      )}

      {/* No query: full-width empty state */}
      {!query ? (
        <div
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationDelay: "60ms", animationFillMode: "both" }}
        >
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  Nenhum termo de busca
                </p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Use a barra de busca no topo (Ctrl+K) para pesquisar por
                  descrição, fornecedor, cliente ou valor.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Has query: sidebar + main */
        <div
          className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 lg:gap-8 items-start animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationDelay: "60ms", animationFillMode: "both" }}
        >
          {/* ── Sidebar (lg+) ── */}
          <aside className="hidden lg:block sticky top-6 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filtros
                    {activeFilterCount > 0 && (
                      <span
                        key={activeFilterCount}
                        className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground animate-in zoom-in-75 duration-150"
                      >
                        {activeFilterCount}
                      </span>
                    )}
                  </CardTitle>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllFilters}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors animate-in fade-in slide-in-from-right-2 duration-150"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-1">{filterSections}</CardContent>
            </Card>
          </aside>

          {/* ── Main content ── */}
          <div className="space-y-4 min-w-0">
            {/* Mobile: filter trigger (< lg) */}
            {hasBaseResults && (
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="lg:hidden flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Filtros</span>
                {activeFilterCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}

            {/* Mobile: filter sheet (< lg) */}
            <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <SheetContent
                side="bottom"
                className="rounded-t-2xl max-h-[80vh] overflow-y-auto border-t border-x border-border px-0 pb-6 pt-0"
              >
                <SheetTitle className="sr-only">Filtros de busca</SheetTitle>
                <div className="flex justify-center pt-3 pb-1">
                  <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
                </div>
                <div className="flex items-center justify-between px-6 py-3 mb-1 border-b">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filtros
                    {activeFilterCount > 0 && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                        {activeFilterCount}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-3">
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllFilters}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Limpar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMobileFiltersOpen(false)}
                      className="text-sm font-medium text-primary"
                    >
                      Pronto
                    </button>
                  </div>
                </div>
                {filterSections}
              </SheetContent>
            </Sheet>

            {/* Aging bar (≥8 results) */}
            {agingBarData && (
              <AgingBar data={agingBarData} total={filtered.length} />
            )}

            {/* Top origins chart */}
            {topOriginsData && <TopOriginsChart data={topOriginsData} />}

            {/* Results card */}
            <Card>
              <CardHeader>
                <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <CardTitle>Transações encontradas</CardTitle>
                    <CardDescription>
                      {isLoading
                        ? "Buscando..."
                        : hasResults
                          ? `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""}${activeFilterCount > 0 ? ` (filtrado de ${filteredBase.length})` : ""} para "${query}"`
                          : `Nenhuma transação encontrada para "${query}"`}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Buscando transações...
                    </p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                      <FileX className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">
                      Nenhum resultado encontrado
                    </p>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      {activeFilterCount > 0
                        ? "Tente remover alguns filtros na barra lateral."
                        : `Não encontramos transações para "${query}". Tente outros termos como descrição, fornecedor, valor (ex: >500, 100-500).`}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Grouping toggle */}
                    <div className="flex items-center gap-1 px-6 py-2.5 border-b">
                      <span className="text-xs text-muted-foreground mr-1">
                        Agrupar por:
                      </span>
                      {(["none", "origin", "status"] as GroupByMode[]).map(
                        (mode) => (
                          <button
                            type="button"
                            key={mode}
                            onClick={() => setGroupBy(mode)}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded-md transition-colors",
                              groupBy === mode
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {GROUP_BY_LABELS[mode]}
                          </button>
                        ),
                      )}
                    </div>

                    {/* Mobile: card list (< lg) */}
                    <div className="lg:hidden divide-y">
                      {groupBy !== "none" && groups
                        ? groups.map((group) => (
                            <React.Fragment key={group.key}>
                              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-y">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {group.label}
                                  <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                                    · {group.items.length}{" "}
                                    {group.items.length !== 1
                                      ? "itens"
                                      : "item"}
                                  </span>
                                </span>
                                <span className="text-xs font-financial tabular-nums flex items-center gap-2">
                                  {group.subtotalPayable > 0 && (
                                    <span className="font-semibold text-red-600 dark:text-red-400">
                                      −{formatCurrency(group.subtotalPayable)}
                                    </span>
                                  )}
                                  {group.subtotalReceivable > 0 && (
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      +
                                      {formatCurrency(group.subtotalReceivable)}
                                    </span>
                                  )}
                                </span>
                              </div>
                              {group.items.map((t) => (
                                <MobileTransactionRow
                                  key={t.id}
                                  t={t}
                                  query={query}
                                />
                              ))}
                            </React.Fragment>
                          ))
                        : sortedTransactions.map((t) => (
                            <MobileTransactionRow
                              key={t.id}
                              t={t}
                              query={query}
                            />
                          ))}
                    </div>

                    {/* Desktop: table (lg+) */}
                    <div className="hidden lg:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead
                              className="cursor-pointer hover:text-foreground select-none pl-6"
                              onClick={() => requestSort("description")}
                            >
                              <span className="inline-flex items-center">
                                Descrição
                                <SortIcon
                                  column="description"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer hover:text-foreground select-none"
                              onClick={() => requestSort("supplierOrClient")}
                            >
                              <span className="inline-flex items-center">
                                Fornecedor / Cliente
                                <SortIcon
                                  column="supplierOrClient"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer hover:text-foreground select-none"
                              onClick={() => requestSort("requestOrigin.name")}
                            >
                              <span className="inline-flex items-center">
                                Origem
                                <SortIcon
                                  column="requestOrigin.name"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer hover:text-foreground select-none"
                              onClick={() => requestSort("dueDate")}
                            >
                              <span className="inline-flex items-center">
                                Vencimento
                                <SortIcon
                                  column="dueDate"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer hover:text-foreground select-none"
                              onClick={() => requestSort("status")}
                            >
                              <span className="inline-flex items-center">
                                Status
                                <SortIcon
                                  column="status"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:text-foreground select-none pr-6"
                              onClick={() => requestSort("amount")}
                            >
                              <span className="inline-flex items-center justify-end w-full">
                                Valor
                                <SortIcon
                                  column="amount"
                                  sortConfig={sortConfig}
                                />
                              </span>
                            </TableHead>
                            <TableHead className="w-8 pr-4" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupBy !== "none" && groups
                            ? groups.map((group) => (
                                <React.Fragment key={group.key}>
                                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-y">
                                    <TableCell
                                      colSpan={7}
                                      className="py-2 pl-6 pr-6"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                          {group.label}
                                          <span className="ml-2 font-normal normal-case tracking-normal">
                                            · {group.items.length}{" "}
                                            {group.items.length !== 1
                                              ? "itens"
                                              : "item"}
                                          </span>
                                        </span>
                                        <span className="text-xs font-financial tabular-nums text-muted-foreground flex items-center gap-2">
                                          {group.subtotalPayable > 0 && (
                                            <span>
                                              Pagar{" "}
                                              <span className="font-semibold text-red-600 dark:text-red-400">
                                                {formatCurrency(
                                                  group.subtotalPayable,
                                                )}
                                              </span>
                                            </span>
                                          )}
                                          {group.subtotalPayable > 0 &&
                                            group.subtotalReceivable > 0 && (
                                              <span className="text-muted-foreground/40">
                                                ·
                                              </span>
                                            )}
                                          {group.subtotalReceivable > 0 && (
                                            <span>
                                              Receber{" "}
                                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(
                                                  group.subtotalReceivable,
                                                )}
                                              </span>
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  {group.items.map((t, i) => renderRow(t, i))}
                                </React.Fragment>
                              ))
                            : sortedTransactions.map((t, i) => renderRow(t, i))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
