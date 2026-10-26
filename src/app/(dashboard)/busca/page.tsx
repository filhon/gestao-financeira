"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import currency from "currency.js";
import { DateRange } from "react-day-picker";
import {
  addDays,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronsUpDown,
  Download,
  Layers,
  Loader2,
  Paperclip,
  Search,
  SlidersHorizontal,
  Wand2,
  X,
} from "lucide-react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import {
  recentSearches,
  savedSearches,
  useSearch,
  type SavedSearch,
  type SearchRow,
} from "@/hooks/useSearch";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import {
  REQUEST_ORIGIN_TYPE_LABELS,
  REQUEST_ORIGIN_TYPE_SHORT,
} from "@/lib/constants/requestOrigin";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  highlightRanges,
  isSettled,
  looksLikePhrase,
  needsReceipt,
  normalizeText,
  parseBRL,
  parseQuery,
  removeToken,
  statusKey,
  statusLabel,
  type StatusKey,
} from "@/lib/search/query";
import { hasComprovante } from "@/lib/transactionTabs";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { friendlyError } from "@/lib/errors";
import { formatCurrency, cn } from "@/lib/utils";
import type { RequestOriginType } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { AddToBatchDialog } from "@/components/features/finance/AddToBatchDialog";
import { exportSearchXlsx } from "@/components/features/search/exportSearch";

// ── Constantes ────────────────────────────────────────────────────────────────

type TypeFilter = "all" | "payable" | "receivable";
type GroupByMode = "none" | "origin" | "status";

const TYPE_OPTIONS: { label: string; value: TypeFilter }[] = [
  { label: "Todos", value: "all" },
  { label: "A pagar", value: "payable" },
  { label: "A receber", value: "receivable" },
];

const GROUP_LABELS: Record<GroupByMode, string> = {
  none: "Nenhum",
  origin: "Origem",
  status: "Status",
};

const ORIGIN_TYPE_ORDER: RequestOriginType[] = [
  "director",
  "department",
  "sector",
];

const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "7d", label: "Próx. 7 dias" },
  { value: "30d", label: "Próx. 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Período…" },
];

const STATUS_STYLE: Record<StatusKey, string> = {
  late: "border-destructive/40 bg-destructive/10 text-destructive",
  draft: "border-border bg-muted text-muted-foreground",
  pending_approval:
    "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approved:
    "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  pending_authorization:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  authorized:
    "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "border-dashed border-border text-muted-foreground",
};

/** Cada exemplo é um token que funciona sozinho no campo. */
const SYNTAX: { examples: string[]; meaning: string }[] = [
  {
    examples: ["Filipe reembolso"],
    meaning: "todas as palavras, em qualquer campo",
  },
  { examples: ['"da Silva"'], meaning: "frase exata" },
  { examples: ["-combustível"], meaning: "exclui a palavra" },
  {
    examples: ["6128", "12.345.678/0001-90"],
    meaning: "nº do documento, CNPJ ou valor",
  },
  { examples: ["tipo:pagar", "tipo:receber"], meaning: "tipo de conta" },
  {
    examples: ["status:atrasado"],
    meaning: "ou rascunho, aprovacao, aprovado, autorizado, pago, rejeitado",
  },
  { examples: ["valor:>500", "100-500"], meaning: "faixa de valor" },
  {
    examples: ["venc:2026-07", "pago:2026"],
    meaning: "vencimento ou pagamento: ano, mês ou dd/mm/aaaa..dd/mm/aaaa",
  },
  {
    examples: ["sem:comprovante"],
    meaning: "pagas sem comprovante, desde o início do controle",
  },
];

const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

type Row = SearchRow & { status: StatusKey };

type Role = "counterpart" | "origin" | "other";
const ROLE_ORDER: Role[] = ["counterpart", "origin", "other"];
const ROLE_LABELS: Record<Role, string> = {
  counterpart: "Como fornecedor ou cliente",
  origin: "Como solicitante",
  other: "Outras menções",
};

// ── Peças ─────────────────────────────────────────────────────────────────────

function Highlight({ text, needles }: { text?: string; needles: string[] }) {
  if (!text) return null;
  const ranges = highlightRanges(text, needles);
  if (ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    out.push(
      text.slice(at, start),
      <mark
        key={i}
        className="bg-transparent font-semibold text-foreground underline decoration-foreground/30 underline-offset-2"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

function StatusBadge({ row, today }: { row: Row; today: Date }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[row.status],
      )}
    >
      {statusLabel(row.tx, today)}
    </span>
  );
}

function Amount({ row, className }: { row: Row; className?: string }) {
  const payable = row.tx.type === "payable";
  return (
    <span
      className={cn(
        "font-financial tabular-nums whitespace-nowrap",
        !payable && "text-emerald-700 dark:text-emerald-400",
        row.status === "rejected" && "text-muted-foreground line-through",
        className,
      )}
    >
      {payable ? "−" : "+"}
      {formatCurrency(row.tx.amount)}
    </span>
  );
}

/**
 * Comprovante só importa em conta paga: clipe quando anexado; aviso em âmbar
 * só quando a empresa já cobrava comprovante na data do pagamento.
 */
function ReceiptMark({
  row,
  receiptsStart,
}: {
  row: Row;
  receiptsStart: Date | null;
}) {
  if (row.tx.type !== "payable") return null;
  if (hasComprovante(row.tx))
    return (
      <Paperclip
        className="h-3.5 w-3.5 text-muted-foreground"
        aria-label="Comprovante anexado"
      />
    );
  return needsReceipt(row.tx, receiptsStart) ? (
    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
      sem comprovante
    </span>
  ) : null;
}

function SortHead({
  label,
  column,
  sortConfig,
  onSort,
  className,
}: {
  label: string;
  column: string;
  sortConfig: {
    key: string | number | symbol;
    direction: "asc" | "desc";
  } | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sortConfig?.key === column;
  const Icon = !active
    ? ArrowUpDown
    : sortConfig.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={
        active
          ? sortConfig.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon
          className={cn("h-3 w-3", active ? "text-primary" : "opacity-40")}
        />
      </button>
    </TableHead>
  );
}

function FilterChip({
  label,
  onRemove,
  invalid,
}: {
  label: string;
  onRemove: () => void;
  invalid?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border py-0.5 pl-2 pr-1 text-xs",
        invalid
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "bg-muted/60 text-foreground",
      )}
      title={invalid ? "Filtro não reconhecido: é ignorado" : undefined}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover ${label}`}
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function FacetHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-medium text-muted-foreground">{children}</p>
  );
}

function SyntaxHelp() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {SYNTAX.map((s) => (
        <React.Fragment key={s.meaning}>
          <dt className="flex flex-wrap gap-1">
            {s.examples.map((ex) => (
              <code
                key={ex}
                className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono"
              >
                {ex}
              </code>
            ))}
          </dt>
          <dd className="text-muted-foreground">{s.meaning}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const perms = usePermissions();
  const { openTransaction } = useTransactionDetailStore();
  const today = useMemo(() => startOfDay(new Date()), []);

  // Estado na URL: link compartilhável e busca salva = query string.
  const query = searchParams.get("q") ?? "";
  const typeFilter = (searchParams.get("type") as TypeFilter) || "all";
  const statusFilters = csv(searchParams.get("status")) as StatusKey[];
  const originTypes = csv(searchParams.get("origem")) as RequestOriginType[];
  const originName = searchParams.get("nome") ?? "";
  const year = searchParams.get("ano") ?? "";
  const preset = searchParams.get("preset") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const minVal = searchParams.get("minVal") ?? "";
  const maxVal = searchParams.get("maxVal") ?? "";
  const groupBy = (searchParams.get("agrupar") as GroupByMode) || "none";

  const updateURL = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      router.replace(`/busca?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  // ── Campo de busca (digitar atualiza a URL após uma pausa) ──
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(query);
  const lastPushed = useRef(query);
  const [phraseBefore, setPhraseBefore] = useState<string | null>(null);

  useEffect(() => {
    // Mudança vinda de fora (paleta, chip, voltar do navegador).
    if (query !== lastPushed.current) {
      lastPushed.current = query;
      setDraft(query);
      setPhraseBefore(null);
    }
  }, [query]);

  const pushQuery = useCallback(
    (value: string) => {
      lastPushed.current = value;
      updateURL({ q: value || null });
    },
    [updateURL],
  );

  useEffect(() => {
    const v = draft.trim();
    if (v === query) return;
    const id = setTimeout(() => pushQuery(v), 350);
    return () => clearTimeout(id);
  }, [draft, query, pushQuery]);

  // "/" leva ao campo de busca, como em Gmail e GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.key !== "/" ||
        el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
      )
        return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    if (companyId) recentSearches.add(companyId, v);
    pushQuery(v);
  };

  const parsed = useMemo(() => parseQuery(query), [query]);
  const needles = useMemo(() => parsed.terms.map((t) => t.text), [parsed]);

  // ── Frase → filtros (IA) ──
  const [interpreting, setInterpreting] = useState(false);
  const isPhrase = useMemo(() => looksLikePhrase(query), [query]);

  const interpret = async () => {
    if (!companyId) return;
    setInterpreting(true);
    try {
      const res = await fetch("/api/internal/search/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ input: query, companyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDraft(json.query);
      pushQuery(json.query);
      setPhraseBefore(query);
    } catch (error) {
      toast.error(friendlyError(error, "Falha ao interpretar a frase."));
    } finally {
      setInterpreting(false);
    }
  };

  // ── Dados ──
  const { data, isLoading, isFetching, error, refresh } = useSearch(query);

  const rows: Row[] = useMemo(
    () =>
      (data?.rows ?? []).map((r) => ({ ...r, status: statusKey(r.tx, today) })),
    [data, today],
  );

  // Filtros laterais rodam no cliente, sobre o que a busca trouxe.
  const filteredBase = useMemo(
    () =>
      typeFilter === "all"
        ? rows
        : rows.filter((r) => r.tx.type === typeFilter),
    [rows, typeFilter],
  );

  const facetCounts = useMemo(() => {
    const status: Partial<Record<StatusKey, number>> = {};
    const origin: Partial<Record<RequestOriginType, number>> = {};
    const years: Record<string, number> = {};
    const names = new Set<string>();
    for (const r of filteredBase) {
      status[r.status] = (status[r.status] ?? 0) + 1;
      const y = String(r.tx.dueDate.getFullYear());
      years[y] = (years[y] ?? 0) + 1;
      const o = r.tx.requestOrigin;
      if (o?.type) origin[o.type] = (origin[o.type] ?? 0) + 1;
      if (o?.name && (!originTypes.length || originTypes.includes(o.type)))
        names.add(o.name);
    }
    return {
      status,
      origin,
      years: Object.entries(years).sort(([a], [b]) => b.localeCompare(a)),
      names: [...names].sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }, [filteredBase, originTypes]);

  const hasBothTypes = useMemo(
    () =>
      rows.some((r) => r.tx.type === "payable") &&
      rows.some((r) => r.tx.type === "receivable"),
    [rows],
  );

  const filtered = useMemo(() => {
    const min = minVal ? parseBRL(minVal) : undefined;
    const max = maxVal ? parseBRL(maxVal) : undefined;
    const range = (() => {
      if (preset === "7d") return [today, addDays(today, 7)];
      if (preset === "30d") return [today, addDays(today, 30)];
      if (preset === "month") return [startOfMonth(today), endOfMonth(today)];
      if (preset === "custom" && dateFrom) {
        const from = startOfDay(new Date(dateFrom));
        return [from, dateTo ? new Date(dateTo) : from];
      }
      return null;
    })();

    return filteredBase.filter(({ tx, status }) => {
      if (statusFilters.length && !statusFilters.includes(status)) return false;
      if (
        originTypes.length &&
        (!tx.requestOrigin || !originTypes.includes(tx.requestOrigin.type))
      )
        return false;
      if (originName && tx.requestOrigin?.name !== originName) return false;
      if (year && String(tx.dueDate.getFullYear()) !== year) return false;
      if (range && (tx.dueDate < range[0] || tx.dueDate > range[1]))
        return false;
      if (min !== undefined && tx.amount < min) return false;
      if (max !== undefined && tx.amount > max) return false;
      return true;
    });
  }, [
    filteredBase,
    statusFilters,
    originTypes,
    originName,
    year,
    preset,
    dateFrom,
    dateTo,
    minVal,
    maxVal,
    today,
  ]);

  const {
    items: sorted,
    requestSort,
    sortConfig,
  } = useSortableData<Row>(filtered);

  // ── Resumo: aberto e liquidado separados; rejeitadas fora ──
  const summary = useMemo(() => {
    const zero = () => ({ sum: currency(0), n: 0 });
    const s = {
      payOpen: zero(),
      recOpen: zero(),
      paid: zero(),
      received: zero(),
      late: zero(),
      all: zero(),
    };
    const add = (b: { sum: currency; n: number }, v: number) => {
      b.sum = b.sum.add(v);
      b.n++;
    };
    for (const { tx, status } of filtered) {
      if (status === "rejected") continue;
      add(s.all, tx.amount);
      const payable = tx.type === "payable";
      if (status === "paid") add(payable ? s.paid : s.received, tx.amount);
      else {
        add(payable ? s.payOpen : s.recOpen, tx.amount);
        if (status === "late") add(s.late, tx.amount);
      }
    }
    const singleType = !filtered.some(
      (r) => r.tx.type !== filtered[0]?.tx.type,
    );
    return {
      ...s,
      avgTicket:
        singleType && s.all.n > 0 ? s.all.sum.divide(s.all.n).value : null,
    };
  }, [filtered]);

  // Coluna "Fornecedor / Cliente" some quando todas as linhas têm o mesmo.
  const sameCounterpart = useMemo(() => {
    const first = filtered[0]?.tx.supplierOrClient;
    if (!first || filtered.length < 2) return null;
    const n = normalizeText(first.trim());
    return filtered.every(
      (r) => normalizeText((r.tx.supplierOrClient ?? "").trim()) === n,
    )
      ? first
      : null;
  }, [filtered]);

  // Cadastro que o termo nomeia (resultado principal).
  const entity = data?.entities.find((e) => e.stats);

  /**
   * Papel do cadastro em cada linha: a mesma pessoa pode ser contraparte
   * (recebeu ou pagou) ou só quem pediu o lançamento (origem). Misturar os
   * dois na mesma lista faz o card e a tabela parecerem se contradizer.
   */
  const roleOf = useCallback(
    (r: Row): Role => {
      if (!entity) return "other";
      const name = normalizeText(entity.name.trim());
      if (
        r.tx.entityId === entity.id ||
        normalizeText((r.tx.supplierOrClient ?? "").trim()) === name
      )
        return "counterpart";
      const origin = normalizeText(r.tx.requestOrigin?.name ?? "");
      return needles.length > 0 && needles.every((n) => origin.includes(n))
        ? "origin"
        : "other";
    },
    [entity, needles],
  );

  const groups = useMemo(() => {
    const byRole = groupBy === "none" && !!entity;
    if (groupBy === "none" && !byRole) return null;
    const keyOf = (r: Row): string =>
      byRole
        ? roleOf(r)
        : groupBy === "origin"
          ? (r.tx.requestOrigin?.type ?? "__none__")
          : r.status;
    const map = new Map<string, Row[]>();
    for (const r of sorted) {
      const key = keyOf(r);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // Um papel só: a seção não acrescenta nada.
    if (byRole && map.size < 2) return null;

    const order: string[] = byRole
      ? ROLE_ORDER
      : groupBy === "origin"
        ? ORIGIN_TYPE_ORDER
        : STATUS_ORDER;
    const labelOf = (key: string) => {
      if (byRole) {
        if (key !== "counterpart") return ROLE_LABELS[key as Role];
        return entity!.category === "client"
          ? "Como cliente"
          : entity!.category === "supplier"
            ? "Como fornecedor"
            : "Como fornecedor ou cliente";
      }
      if (groupBy === "origin")
        return key === "__none__"
          ? "Sem origem"
          : REQUEST_ORIGIN_TYPE_LABELS[key as RequestOriginType];
      return STATUS_LABELS[key as StatusKey];
    };
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([key, items]) => {
        const sumOf = (type: string) =>
          items
            .filter((r) => r.tx.type === type && r.status !== "rejected")
            .reduce((acc, r) => acc.add(r.tx.amount), currency(0)).value;
        return {
          key,
          label: labelOf(key),
          items,
          payable: sumOf("payable"),
          receivable: sumOf("receivable"),
        };
      });
  }, [sorted, groupBy, entity, roleOf]);

  // O que o cadastro pediu como solicitante, para o card resumir os dois papéis.
  const requested = useMemo(() => {
    if (!entity) return null;
    const own = filtered.filter(
      (r) => r.status !== "rejected" && roleOf(r) === "origin",
    );
    return own.length
      ? {
          n: own.length,
          sum: own.reduce((acc, r) => acc.add(r.tx.amount), currency(0)).value,
        }
      : null;
  }, [entity, filtered, roleOf]);

  const receiptsStart = useMemo(
    () => (data?.receiptsStart ? new Date(data.receiptsStart) : null),
    [data?.receiptsStart],
  );

  // ── Seleção ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [query]);
  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.tx.id)),
    [filtered, selected],
  );
  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.tx.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedTotal = selectedRows.reduce(
    (acc, r) =>
      r.tx.type === "payable"
        ? acc.subtract(r.tx.amount)
        : acc.add(r.tx.amount),
    currency(0),
  ).value;
  const canAddToBatch =
    perms.canManageBatches &&
    selectedRows.length > 0 &&
    selectedRows.every((r) => r.tx.type === "payable");
  const [batchOpen, setBatchOpen] = useState(false);

  const [exporting, setExporting] = useState(false);
  const exportRows = async (list: Row[]) => {
    setExporting(true);
    try {
      await exportSearchXlsx(list, query);
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao exportar."));
    } finally {
      setExporting(false);
    }
  };

  // ── Busca salva ──
  const [saveName, setSaveName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const saveSearch = () => {
    if (!companyId || !saveName.trim()) return;
    savedSearches.save(companyId, {
      name: saveName.trim(),
      params: searchParams.toString(),
    });
    toast.success("Busca salva. Ela aparece no Ctrl+K e nesta página.");
    setSaveName("");
    setSaveOpen(false);
  };

  // ── Filtros ativos (chips) ──
  const facetChips: { label: string; remove: Record<string, string | null> }[] =
    [
      ...(typeFilter !== "all"
        ? [
            {
              label: typeFilter === "payable" ? "A pagar" : "A receber",
              remove: { type: null },
            },
          ]
        : []),
      ...statusFilters.map((s) => ({
        label: STATUS_LABELS[s] ?? s,
        remove: {
          status: statusFilters.filter((x) => x !== s).join(",") || null,
        },
      })),
      ...originTypes.map((o) => ({
        label: REQUEST_ORIGIN_TYPE_LABELS[o],
        remove: {
          origem: originTypes.filter((x) => x !== o).join(",") || null,
          nome: null,
        },
      })),
      ...(originName ? [{ label: originName, remove: { nome: null } }] : []),
      ...(year ? [{ label: `Exercício ${year}`, remove: { ano: null } }] : []),
      ...(preset
        ? [
            {
              label:
                preset === "custom" && dateFrom
                  ? `Venc. ${format(new Date(dateFrom), "dd/MM/yyyy")}${dateTo ? ` a ${format(new Date(dateTo), "dd/MM/yyyy")}` : ""}`
                  : (DATE_PRESETS.find((p) => p.value === preset)?.label ??
                    preset),
              remove: { preset: null, dateFrom: null, dateTo: null },
            },
          ]
        : []),
      ...(minVal || maxVal
        ? [
            {
              label: `Valor ${minVal || "0"} a ${maxVal || "…"}`,
              remove: { minVal: null, maxVal: null },
            },
          ]
        : []),
    ];

  const clearFacets = () =>
    updateURL({
      type: null,
      status: null,
      origem: null,
      nome: null,
      ano: null,
      preset: null,
      dateFrom: null,
      dateTo: null,
      minVal: null,
      maxVal: null,
    });

  const toggleIn = (list: string[], v: string) =>
    (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(",") ||
    null;

  // ── Teclado na tabela ──
  const onRowKey = (e: React.KeyboardEvent<HTMLElement>, row: Row) => {
    const list = Array.from(
      e.currentTarget
        .closest("[data-rows]")!
        .querySelectorAll<HTMLElement>("[data-row]"),
    );
    const i = list.indexOf(e.currentTarget);
    if (e.key === "Enter") {
      e.preventDefault();
      openTransaction(row.tx);
    } else if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      list[i + 1]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      list[i - 1]?.focus();
    } else if (e.key === " " || e.key === "x") {
      e.preventDefault();
      toggle(row.tx.id);
    }
  };

  // ── Filtros laterais ──
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [originNameOpen, setOriginNameOpen] = useState(false);
  const [minDraft, setMinDraft] = useState(minVal);
  const [maxDraft, setMaxDraft] = useState(maxVal);
  useEffect(() => setMinDraft(minVal), [minVal]);
  useEffect(() => setMaxDraft(maxVal), [maxVal]);

  const commitValue = () =>
    updateURL({
      minVal: minDraft && parseBRL(minDraft) !== undefined ? minDraft : null,
      maxVal: maxDraft && parseBRL(maxDraft) !== undefined ? maxDraft : null,
    });

  // Grupo de filtro com uma opção só não filtra nada: some (salvo se marcado).
  const statusOptions = STATUS_ORDER.filter(
    (k) => facetCounts.status[k] || statusFilters.includes(k),
  );
  const originOptions = ORIGIN_TYPE_ORDER.filter(
    (k) => facetCounts.origin[k] || originTypes.includes(k),
  );
  const showOriginNames = facetCounts.names.length > 1 || !!originName;

  const customRange: DateRange | undefined = dateFrom
    ? { from: new Date(dateFrom), to: dateTo ? new Date(dateTo) : undefined }
    : undefined;

  const filterSections = (
    <div className="space-y-5">
      {hasBothTypes && !parsed.type && (
        <div>
          <FacetHeading>Tipo</FacetHeading>
          <div className="flex overflow-hidden rounded-md border">
            {TYPE_OPTIONS.map(({ label, value }) => (
              <button
                type="button"
                key={value}
                aria-pressed={typeFilter === value}
                onClick={() =>
                  updateURL({ type: value === "all" ? null : value })
                }
                className={cn(
                  "flex-1 py-1 text-xs transition-colors",
                  typeFilter === value
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {statusOptions.length > 1 && (
        <div>
          <FacetHeading>Status</FacetHeading>
          <div className="space-y-1.5">
            {statusOptions.map((key) => {
              const count = facetCounts.status[key] ?? 0;
              const checked = statusFilters.includes(key);
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() =>
                      updateURL({ status: toggleIn(statusFilters, key) })
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className={cn(
                      "flex-1",
                      key === "late" && "font-medium text-destructive",
                    )}
                  >
                    {STATUS_LABELS[key]}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {facetCounts.years.length > 1 && (
        <div>
          <FacetHeading>Exercício</FacetHeading>
          <div className="flex flex-wrap gap-1">
            {facetCounts.years.map(([y, n]) => (
              <button
                type="button"
                key={y}
                aria-pressed={year === y}
                onClick={() => updateURL({ ano: year === y ? null : y })}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors",
                  year === y
                    ? "border-primary/30 bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {y} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(originOptions.length > 1 || showOriginNames) && (
        <div>
          <FacetHeading>Origem</FacetHeading>
          <div className="space-y-1.5">
            {originOptions.length > 1 &&
              originOptions.map((type) => {
                const count = facetCounts.origin[type] ?? 0;
                const checked = originTypes.includes(type);
                return (
                  <label
                    key={type}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        updateURL({
                          origem: toggleIn(originTypes, type),
                          nome: null,
                        })
                      }
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1">
                      {REQUEST_ORIGIN_TYPE_LABELS[type]}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </label>
                );
              })}
          </div>
          {showOriginNames && (
            <Popover open={originNameOpen} onOpenChange={setOriginNameOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "mt-2 flex h-7 w-full items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                    originName
                      ? "border-primary/50 bg-primary/5"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex-1 truncate text-left">
                    {originName || "Nome da origem"}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Filtrar nome…"
                    className="h-8 text-xs"
                  />
                  <CommandList>
                    <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                      Nenhum nome encontrado
                    </CommandEmpty>
                    <CommandGroup>
                      {facetCounts.names.map((name) => (
                        <CommandItem
                          key={name}
                          value={name}
                          className="text-xs"
                          onSelect={() => {
                            updateURL({
                              nome: originName === name ? null : name,
                            });
                            setOriginNameOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3 w-3",
                              originName === name ? "opacity-100" : "opacity-0",
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
          )}
        </div>
      )}

      <div>
        <FacetHeading>Vencimento</FacetHeading>
        <div className="flex flex-wrap gap-1">
          {DATE_PRESETS.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              aria-pressed={preset === value}
              onClick={() =>
                updateURL({
                  preset: preset === value ? null : value,
                  dateFrom: null,
                  dateTo: null,
                })
              }
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                preset === value
                  ? "border-primary/30 bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="mt-2">
            <DatePickerWithRange
              date={customRange}
              setDate={(range) =>
                updateURL({
                  preset: "custom",
                  dateFrom: range?.from ? range.from.toISOString() : null,
                  dateTo: range?.to ? range.to.toISOString() : null,
                })
              }
            />
          </div>
        )}
      </div>

      <div>
        <FacetHeading>Valor (R$)</FacetHeading>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            commitValue();
          }}
        >
          <Input
            inputMode="decimal"
            placeholder="Mín."
            aria-label="Valor mínimo"
            value={minDraft}
            onChange={(e) => setMinDraft(e.target.value)}
            onBlur={commitValue}
            className="h-7 px-2 text-xs tabular-nums"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <Input
            inputMode="decimal"
            placeholder="Máx."
            aria-label="Valor máximo"
            value={maxDraft}
            onChange={(e) => setMaxDraft(e.target.value)}
            onBlur={commitValue}
            className="h-7 px-2 text-xs tabular-nums"
          />
        </form>
      </div>
    </div>
  );

  // ── Linhas ──
  const showTypeTag = hasBothTypes && typeFilter === "all" && !parsed.type;

  const renderRow = (row: Row) => {
    const { tx, info } = row;
    const isSelected = selected.has(tx.id);
    return (
      <TableRow
        key={tx.id}
        data-row
        tabIndex={0}
        aria-selected={isSelected}
        onClick={() => openTransaction(tx)}
        onKeyDown={(e) => onRowKey(e, row)}
        className={cn(
          "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          isSelected && "bg-primary/5",
        )}
      >
        <TableCell className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggle(tx.id)}
            aria-label={`Selecionar ${tx.description}`}
            tabIndex={-1}
          />
        </TableCell>
        <TableCell className="min-w-64 whitespace-normal">
          <div className="flex items-baseline gap-2">
            {showTypeTag && (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tx.type === "payable" ? "Pagar" : "Receber"}
              </span>
            )}
            <span className="line-clamp-2 font-medium">
              <Highlight text={tx.description} needles={needles} />
            </span>
          </div>
          {(tx.documentNumber || info.batch || info.rd) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                tx.documentNumber && `Doc. ${tx.documentNumber}`,
                info.batch && `Lote ${info.batch}`,
                info.rd,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </TableCell>
        {!sameCounterpart && (
          <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
            {tx.supplierOrClient ? (
              tx.supplierOrClient
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </TableCell>
        )}
        <TableCell className="whitespace-normal text-muted-foreground">
          {tx.requestOrigin ? (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {REQUEST_ORIGIN_TYPE_SHORT[tx.requestOrigin.type]}
              </span>
              {tx.requestOrigin.name}
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell className="whitespace-normal text-muted-foreground">
          {info.costCenter ?? (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell className="tabular-nums text-muted-foreground">
          {format(tx.dueDate, "dd/MM/yyyy", { locale: ptBR })}
        </TableCell>
        <TableCell className="tabular-nums text-muted-foreground">
          {tx.paymentDate && isSettled(tx) ? (
            format(tx.paymentDate, "dd/MM/yyyy", { locale: ptBR })
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-2">
            <StatusBadge row={row} today={today} />
            <ReceiptMark row={row} receiptsStart={receiptsStart} />
          </span>
        </TableCell>
        <TableCell className="pr-6 text-right">
          <Amount row={row} className="font-semibold" />
        </TableCell>
      </TableRow>
    );
  };

  const columnCount = sameCounterpart ? 8 : 9;
  // Texto livre fica no campo; chip só para filtro estruturado ou exclusão.
  const queryChips = parsed.tokens.filter((t) => !t.text);
  const otherHits = [
    ...(data?.entities ?? [])
      .filter((e) => e !== entity)
      .map((e) => ({
        key: `e-${e.id}`,
        label: e.name,
        kind: "Cadastro",
        href: `/cadastros/entidades/${e.id}`,
      })),
    ...(data?.batches ?? []).map((b) => ({
      key: `b-${b.id}`,
      label: b.name,
      kind: "Lote",
      href: `/financeiro/lotes/${b.id}`,
    })),
    ...(data?.reimbursements ?? []).map((r) => ({
      key: `r-${r.id}`,
      label: `${r.rdNumber} · ${r.employeeName}`,
      kind: "RD",
      href: "/financeiro/reembolsos",
    })),
  ];

  // ── Render ──
  return (
    <div className="space-y-5">
      <h1 className="sr-only">Busca</h1>

      {/* Campo de busca + chips */}
      <div className="space-y-2.5">
        <form
          role="search"
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus={!query}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Buscar por descrição, fornecedor, CNPJ, nº do documento ou valor"
              aria-label="Buscar transações"
              className="h-11 pl-9 pr-9 text-base"
            />
            {isFetching && query && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {isPhrase && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={interpret}
              disabled={interpreting}
            >
              {interpreting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-4 w-4" />
              )}
              Interpretar frase
            </Button>
          )}
          {/* Sem termo, a ajuda já está aberta na página. */}
          {query && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 text-muted-foreground"
                >
                  Como buscar
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(36rem,calc(100vw-2rem))]"
              >
                <SyntaxHelp />
              </PopoverContent>
            </Popover>
          )}
        </form>

        {phraseBefore && (
          <p className="text-xs text-muted-foreground">
            Interpretado de “{phraseBefore}”. Confira os filtros abaixo.{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setDraft(phraseBefore);
                pushQuery(phraseBefore);
                setPhraseBefore(null);
              }}
            >
              Voltar à frase
            </button>
          </p>
        )}

        {(queryChips.length > 0 || facetChips.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {queryChips.map((t, i) => (
              <FilterChip
                key={`${t.raw}-${i}`}
                label={t.label}
                invalid={t.invalid}
                onRemove={() => {
                  const next = removeToken(query, t.raw);
                  setDraft(next);
                  pushQuery(next);
                }}
              />
            ))}
            {facetChips.map((c) => (
              <FilterChip
                key={c.label}
                label={c.label}
                onRemove={() => updateURL(c.remove)}
              />
            ))}
            {facetChips.length > 0 && (
              <button
                type="button"
                onClick={clearFacets}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {!query ? (
        <EmptyStart
          key={companyId}
          companyId={companyId}
          onPick={(q) => pushQuery(q)}
        />
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">A busca falhou.</p>
          <p className="mt-1 text-muted-foreground">
            {friendlyError(error, "Tente de novo em instantes.")}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => refresh()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : (
        <>
          {/* Resposta principal: a entidade que o termo nomeia */}
          {entity?.stats && (
            <section
              aria-label="Cadastro encontrado"
              className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border bg-card px-5 py-4"
            >
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {entity.category === "client"
                    ? "Cliente"
                    : entity.category === "both"
                      ? "Fornecedor e cliente"
                      : "Fornecedor"}
                  {entity.document && ` · ${formatCpfCnpj(entity.document)}`}
                </p>
                <p className="truncate text-lg font-semibold">{entity.name}</p>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Em aberto</dt>
                  {entity.stats.openCount === 0 ? (
                    <dd className="text-muted-foreground">Nada em aberto</dd>
                  ) : (
                    <dd className="font-financial font-semibold tabular-nums">
                      {formatCurrency(entity.stats.openAmount)}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {entity.stats.openCount} conta
                        {entity.stats.openCount !== 1 && "s"}
                        {entity.stats.lateCount > 0 && (
                          <span className="text-destructive">
                            , {entity.stats.lateCount} atrasada
                            {entity.stats.lateCount !== 1 && "s"}
                          </span>
                        )}
                      </span>
                    </dd>
                  )}
                </div>
                {entity.stats.paidThisYear > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Pago em {today.getFullYear()}
                    </dt>
                    <dd className="font-financial font-semibold tabular-nums">
                      {formatCurrency(entity.stats.paidThisYear)}
                    </dd>
                  </div>
                )}
                {entity.stats.receivedThisYear > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Recebido em {today.getFullYear()}
                    </dt>
                    <dd className="font-financial font-semibold tabular-nums">
                      {formatCurrency(entity.stats.receivedThisYear)}
                    </dd>
                  </div>
                )}
                {entity.stats.lastPayment && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {entity.stats.lastPayment.type === "receivable"
                        ? "Último recebimento"
                        : "Último pagamento"}
                    </dt>
                    <dd className="tabular-nums">
                      {format(
                        new Date(entity.stats.lastPayment.date),
                        "dd/MM/yyyy",
                      )}
                      <span className="ml-1.5 font-financial text-muted-foreground">
                        {formatCurrency(entity.stats.lastPayment.amount)}
                      </span>
                    </dd>
                  </div>
                )}
                {requested && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Como solicitante
                    </dt>
                    <dd className="font-financial font-semibold tabular-nums">
                      {formatCurrency(requested.sum)}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {requested.n} lançamento{requested.n !== 1 && "s"}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
              {perms.canViewEntities && (
                <Link
                  href={`/cadastros/entidades/${entity.id}`}
                  className="ml-auto inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Abrir cadastro <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </section>
          )}

          {otherHits.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Também encontrado:</span>
              {otherHits.map((h) => (
                <Link
                  key={h.key}
                  href={h.href}
                  className="inline-flex items-baseline gap-1 hover:underline"
                >
                  <span className="text-xs text-muted-foreground">
                    {h.kind}
                  </span>
                  {h.label}
                </Link>
              ))}
            </p>
          )}

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[13rem_1fr] lg:gap-8">
            {/* Filtros (lg+) */}
            <aside
              aria-label="Filtros"
              className="sticky top-6 hidden max-h-[calc(100vh-6rem)] overflow-y-auto pb-4 lg:block"
            >
              {rows.length > 0 && filterSections}
            </aside>

            <div className="min-w-0 space-y-3">
              {/* Filtros (mobile) */}
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className="flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm text-muted-foreground lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="flex-1 text-left">Filtros</span>
                  {facetChips.length > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      {facetChips.length}
                    </span>
                  )}
                </button>
              )}
              <Sheet
                open={mobileFiltersOpen}
                onOpenChange={setMobileFiltersOpen}
              >
                <SheetContent
                  side="bottom"
                  className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-6 pb-6"
                >
                  <SheetTitle className="py-3 text-sm">Filtros</SheetTitle>
                  {filterSections}
                </SheetContent>
              </Sheet>

              {/* Resumo: em aberto e liquidado separados */}
              {filtered.length > 0 && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {summary.payOpen.n > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">
                        A pagar em aberto
                      </dt>
                      <dd className="font-financial font-semibold tabular-nums">
                        {formatCurrency(summary.payOpen.sum.value)}
                      </dd>
                    </div>
                  )}
                  {summary.recOpen.n > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">
                        A receber em aberto
                      </dt>
                      <dd className="font-financial font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(summary.recOpen.sum.value)}
                      </dd>
                    </div>
                  )}
                  {summary.late.n > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="font-medium text-destructive">
                        {summary.late.n} atrasada{summary.late.n !== 1 && "s"}
                      </dt>
                      <dd className="font-financial font-semibold tabular-nums text-destructive">
                        {formatCurrency(summary.late.sum.value)}
                      </dd>
                    </div>
                  )}
                  {summary.paid.n > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">Pago</dt>
                      <dd className="font-financial tabular-nums">
                        {formatCurrency(summary.paid.sum.value)}
                      </dd>
                    </div>
                  )}
                  {summary.received.n > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">Recebido</dt>
                      <dd className="font-financial tabular-nums">
                        {formatCurrency(summary.received.sum.value)}
                      </dd>
                    </div>
                  )}
                  {summary.avgTicket !== null && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">Ticket médio</dt>
                      <dd className="font-financial tabular-nums">
                        {formatCurrency(summary.avgTicket)}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {/* Resultados */}
              <div className="overflow-hidden rounded-lg border bg-card">
                {/* Barra: contagem e ações, ou seleção */}
                <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
                  {selected.size > 0 ? (
                    <>
                      <span className="text-sm font-medium">
                        {selectedRows.length} selecionada
                        {selectedRows.length !== 1 && "s"}
                        <span className="ml-2 font-financial font-normal tabular-nums text-muted-foreground">
                          {selectedTotal < 0 ? "−" : ""}
                          {formatCurrency(Math.abs(selectedTotal))}
                        </span>
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={exporting}
                          onClick={() => exportRows(selectedRows)}
                        >
                          <Download className="mr-1.5 h-4 w-4" />
                          Exportar seleção
                        </Button>
                        {canAddToBatch && (
                          <Button size="sm" onClick={() => setBatchOpen(true)}>
                            <Layers className="mr-1.5 h-4 w-4" />
                            Adicionar ao lote
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label="Desmarcar todas"
                          onClick={() => setSelected(new Set())}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm" aria-live="polite">
                        {isLoading ? (
                          <span className="text-muted-foreground">
                            Buscando…
                          </span>
                        ) : (
                          <>
                            <span className="font-medium tabular-nums">
                              {filtered.length.toLocaleString("pt-BR")}
                            </span>{" "}
                            transaç{filtered.length === 1 ? "ão" : "ões"}
                            {facetChips.length > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                de {filteredBase.length.toLocaleString("pt-BR")}
                              </span>
                            )}
                            {sameCounterpart && (
                              <span className="text-muted-foreground">
                                , todas de {sameCounterpart}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                      {filtered.length > 0 && (
                        <div className="ml-auto flex flex-wrap items-center gap-1">
                          <span className="mr-1 text-xs text-muted-foreground">
                            Agrupar:
                          </span>
                          {(Object.keys(GROUP_LABELS) as GroupByMode[]).map(
                            (mode) => (
                              <button
                                type="button"
                                key={mode}
                                aria-pressed={groupBy === mode}
                                onClick={() =>
                                  updateURL({
                                    agrupar: mode === "none" ? null : mode,
                                  })
                                }
                                className={cn(
                                  "rounded-md px-2 py-1 text-xs transition-colors",
                                  groupBy === mode
                                    ? "bg-primary/10 font-medium text-primary"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {GROUP_LABELS[mode]}
                              </button>
                            ),
                          )}
                          <span className="mx-1 h-4 w-px bg-border" />
                          <Popover open={saveOpen} onOpenChange={setSaveOpen}>
                            <PopoverTrigger asChild>
                              <Button size="sm" variant="ghost">
                                <Bookmark className="mr-1.5 h-4 w-4" />
                                Salvar busca
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72">
                              <form
                                className="space-y-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  saveSearch();
                                }}
                              >
                                <label
                                  htmlFor="save-name"
                                  className="text-xs font-medium"
                                >
                                  Nome da busca
                                </label>
                                <div className="flex gap-2">
                                  <Input
                                    id="save-name"
                                    autoFocus
                                    value={saveName}
                                    onChange={(e) =>
                                      setSaveName(e.target.value)
                                    }
                                    placeholder="Ex.: Reembolsos sem comprovante"
                                    className="h-8 text-sm"
                                  />
                                  <Button size="sm" type="submit">
                                    Salvar
                                  </Button>
                                </div>
                              </form>
                            </PopoverContent>
                          </Popover>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={exporting}
                            onClick={() => exportRows(sorted)}
                          >
                            {exporting ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="mr-1.5 h-4 w-4" />
                            )}
                            Exportar
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {(data?.truncated || data?.scanCapped) && (
                  <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {data.truncated
                      ? `Mostrando ${data.rows.length.toLocaleString("pt-BR")} de ${data.total.toLocaleString("pt-BR")} resultados. Refine a busca para ver o resto.`
                      : "A busca cobre os 10.000 lançamentos mais recentes da empresa."}
                  </p>
                )}

                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Buscando transações…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <p className="text-sm font-medium">
                      Nenhuma transação encontrada
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      {facetChips.length > 0
                        ? "Os filtros laterais esconderam todos os resultados."
                        : isPhrase
                          ? "Parece uma frase. A busca procura cada palavra; transforme a frase em filtros."
                          : "Tente menos palavras, outro nome ou o valor (ex.: 1.234,56 ou >500)."}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      {facetChips.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={clearFacets}
                        >
                          Limpar filtros
                        </Button>
                      )}
                      {isPhrase && facetChips.length === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={interpret}
                          disabled={interpreting}
                        >
                          <Wand2 className="mr-1.5 h-4 w-4" />
                          Interpretar frase
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Mobile: lista */}
                    <div className="divide-y lg:hidden" data-rows>
                      {sorted.map((row) => (
                        <div
                          key={row.tx.id}
                          data-row
                          role="button"
                          tabIndex={0}
                          onClick={() => openTransaction(row.tx)}
                          onKeyDown={(e) => onRowKey(e, row)}
                          className="flex items-start gap-3 px-4 py-3 focus-visible:bg-muted/60 focus-visible:outline-none"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug">
                              <Highlight
                                text={row.tx.description}
                                needles={needles}
                              />
                            </p>
                            {row.tx.supplierOrClient && !sameCounterpart && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {row.tx.supplierOrClient}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <StatusBadge row={row} today={today} />
                              {format(row.tx.dueDate, "dd/MM/yyyy")}
                              <ReceiptMark
                                row={row}
                                receiptsStart={receiptsStart}
                              />
                            </div>
                          </div>
                          <Amount row={row} className="text-sm font-semibold" />
                        </div>
                      ))}
                    </div>

                    {/* Desktop: tabela */}
                    <div className="hidden lg:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-10 pl-4">
                              <Checkbox
                                checked={allSelected}
                                onCheckedChange={() =>
                                  setSelected(
                                    allSelected
                                      ? new Set()
                                      : new Set(filtered.map((r) => r.tx.id)),
                                  )
                                }
                                aria-label="Selecionar todas"
                              />
                            </TableHead>
                            <SortHead
                              label="Descrição"
                              column="tx.description"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            {!sameCounterpart && (
                              <SortHead
                                label="Fornecedor / Cliente"
                                column="tx.supplierOrClient"
                                sortConfig={sortConfig}
                                onSort={requestSort}
                              />
                            )}
                            <SortHead
                              label="Origem"
                              column="tx.requestOrigin.name"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            <SortHead
                              label="Centro de custo"
                              column="info.costCenter"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            <SortHead
                              label="Vencimento"
                              column="tx.dueDate"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            <SortHead
                              label="Pagamento"
                              column="tx.paymentDate"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            <SortHead
                              label="Status"
                              column="status"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                            />
                            <SortHead
                              label="Valor"
                              column="tx.amount"
                              sortConfig={sortConfig}
                              onSort={requestSort}
                              className="pr-6 text-right"
                            />
                          </TableRow>
                        </TableHeader>
                        <TableBody data-rows>
                          {groups
                            ? groups.map((g) => (
                                <React.Fragment key={g.key}>
                                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                                    <TableCell
                                      colSpan={columnCount}
                                      className="py-2 pl-4 pr-6"
                                    >
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold">
                                          {g.label}
                                          <span className="ml-2 font-normal text-muted-foreground">
                                            {g.items.length}{" "}
                                            {g.items.length !== 1
                                              ? "itens"
                                              : "item"}
                                          </span>
                                        </span>
                                        <span className="flex gap-4 font-financial tabular-nums text-muted-foreground">
                                          {g.payable > 0 && (
                                            <span>
                                              Pagar{" "}
                                              <span className="font-semibold text-foreground">
                                                {formatCurrency(g.payable)}
                                              </span>
                                            </span>
                                          )}
                                          {g.receivable > 0 && (
                                            <span>
                                              Receber{" "}
                                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                                {formatCurrency(g.receivable)}
                                              </span>
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  {g.items.map(renderRow)}
                                </React.Fragment>
                              ))
                            : sorted.map(renderRow)}
                        </TableBody>
                      </Table>
                      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
                        ↑↓ navegar · Enter abrir · Espaço selecionar · / buscar
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <AddToBatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        transactions={selectedRows.map((r) => r.tx)}
        onDone={() => {
          setBatchOpen(false);
          setSelected(new Set());
          refresh();
        }}
      />
    </div>
  );
}

// ── Início sem termo: salvas, recentes, atalhos e sintaxe ─────────────────────

function EmptyStart({
  companyId,
  onPick,
}: {
  companyId?: string;
  onPick: (query: string) => void;
}) {
  const router = useRouter();
  // Montado com key={companyId}: trocar de empresa relê o que está salvo.
  const [saved, setSaved] = useState<SavedSearch[]>(() =>
    companyId ? savedSearches.get(companyId) : [],
  );
  const [recent] = useState<string[]>(() =>
    companyId ? recentSearches.get(companyId) : [],
  );

  const month = format(new Date(), "yyyy-MM");
  const shortcuts = [
    { label: "Contas atrasadas", query: "status:atrasado" },
    { label: "Aguardando aprovação", query: "status:aprovacao" },
    { label: "Vencendo este mês", query: `venc:${month}` },
    { label: "Pagas sem comprovante", query: "sem:comprovante" },
  ];

  const linkClass =
    "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted";

  return (
    // Duas colunas: o que dá para clicar à esquerda, a sintaxe com espaço à
    // direita (em quatro colunas ela ficava espremida e quebrava os exemplos).
    <div className="grid gap-10 pt-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid content-start gap-8 sm:grid-cols-3">
        <section>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            Atalhos
          </h2>
          {shortcuts.map((s) => (
            <button
              key={s.query}
              type="button"
              className={linkClass}
              onClick={() => onPick(s.query)}
            >
              {s.label}
            </button>
          ))}
        </section>
        <section>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            Buscas salvas
          </h2>
          {saved.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">
              Salve uma busca para voltar a ela com um clique.
            </p>
          ) : (
            saved.map((s) => (
              <div key={s.name} className="group flex items-center">
                <button
                  type="button"
                  className={linkClass}
                  onClick={() => router.replace(`/busca?${s.params}`)}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  aria-label={`Excluir busca ${s.name}`}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    savedSearches.remove(companyId!, s.name);
                    setSaved(savedSearches.get(companyId!));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </section>
        <section>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            Recentes
          </h2>
          {recent.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">
              Nenhuma busca recente.
            </p>
          ) : (
            recent.map((q) => (
              <button
                key={q}
                type="button"
                className={linkClass}
                onClick={() => onPick(q)}
              >
                {q}
              </button>
            ))
          )}
        </section>
      </div>
      <section>
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">
          Como buscar
        </h2>
        <SyntaxHelp />
      </section>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
