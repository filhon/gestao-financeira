"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, isSameDay, endOfDay, startOfDay } from "date-fns";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";

import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useAuditNames } from "@/hooks/useAuditNames";
import { auditService, type AuditFilter } from "@/lib/services/auditService";
import { transactionService } from "@/lib/services/transactionService";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { AuditLog } from "@/lib/types";
import {
  ACTION_NOUNS,
  ACTOR_KIND_LABELS,
  AUDIT_VIEWS,
  ENTITY_LABELS,
  actorKind,
  dayLabel,
  detailRows,
  getActionSummary,
  getEntityLink,
  isSensitive,
  type NameResolver,
} from "@/lib/auditFormatter";
import { AuditDetailTable } from "@/components/features/audit/AuditDetailTable";
import { exportAuditXlsx } from "@/components/features/audit/exportAudit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const EXPORT_MAX = 5000;
/** Sequência do mesmo usuário, ação e entidade a partir da qual vira um grupo. */
const RUN_MIN = 3;

const PERIODS: Record<string, string> = {
  all: "Todo o período",
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  custom: "Personalizado",
};

const POSITIVE = new Set([
  "approve",
  "authorize",
  "pay",
  "confirm_match",
  "auto_confirm_match",
  "release",
]);
const NEGATIVE = new Set([
  "delete",
  "delete_comprovante",
  "reject",
  "remove_match",
  "hold",
  "reopen_period",
]);

// Ações que aparecem no filtro: uma por substantivo (delete_comprovante = delete).
const ACTION_OPTIONS = Object.keys(ACTION_NOUNS).filter(
  (a) => a !== "delete_comprovante",
);

type Params = {
  view: string;
  period: string;
  from: string;
  to: string;
  user: string;
  action: string;
  entity: string;
  record: string;
};

const PARAM_KEYS: Record<keyof Params, string> = {
  view: "v",
  period: "p",
  from: "de",
  to: "ate",
  user: "u",
  action: "a",
  entity: "e",
  record: "r",
};

function toFilter(p: Params): AuditFilter {
  const view = AUDIT_VIEWS[p.view];
  const filter: AuditFilter = {
    userId: p.user || undefined,
    action: view?.action ?? (p.action || undefined),
    entity: view?.entity ?? (p.entity || undefined),
    entityId: p.record || undefined,
    fields: view?.fields,
  };
  const now = Date.now();
  const hours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[p.period];
  if (hours) filter.startDate = new Date(now - hours * 3600_000);
  if (p.period === "custom") {
    if (p.from) filter.startDate = startOfDay(new Date(`${p.from}T00:00`));
    if (p.to) filter.endDate = endOfDay(new Date(`${p.to}T00:00`));
  }
  return filter;
}

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        POSITIVE.has(action)
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
          : NEGATIVE.has(action)
            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
            : "border-border bg-transparent text-foreground",
      )}
    >
      {ACTION_NOUNS[action] ?? action}
    </span>
  );
}

function actorName(log: AuditLog, names: NameResolver) {
  const kind = actorKind(log);
  if (kind !== "user") return ACTOR_KIND_LABELS[kind];
  return names.get(log.userId) ?? log.userName ?? log.userEmail;
}

type Item =
  | { kind: "day"; key: string; label: string }
  | { kind: "log"; log: AuditLog }
  | { kind: "run"; key: string; logs: AuditLog[] };

/** Cabeçalho por dia e rajadas (14 edições seguidas da mesma pessoa) num grupo. */
function buildItems(logs: AuditLog[]): Item[] {
  const items: Item[] = [];
  let i = 0;
  while (i < logs.length) {
    const first = logs[i];
    const prev = logs[i - 1];
    if (!prev || !isSameDay(prev.createdAt, first.createdAt)) {
      items.push({
        kind: "day",
        key: `day-${first.id}`,
        label: dayLabel(first.createdAt),
      });
    }
    let j = i + 1;
    while (
      j < logs.length &&
      logs[j].userId === first.userId &&
      logs[j].action === first.action &&
      logs[j].entity === first.entity &&
      isSameDay(logs[j].createdAt, first.createdAt)
    ) {
      j++;
    }
    if (j - i >= RUN_MIN) {
      items.push({
        kind: "run",
        key: `run-${first.id}`,
        logs: logs.slice(i, j),
      });
    } else {
      for (let k = i; k < j; k++) items.push({ kind: "log", log: logs[k] });
    }
    i = j;
  }
  return items;
}

function LogRow({
  log,
  names,
  subjects,
  nested,
  onShowRecord,
  onOpenTransaction,
}: {
  log: AuditLog;
  names: NameResolver;
  subjects: Record<string, string>;
  nested?: boolean;
  onShowRecord: (log: AuditLog) => void;
  onOpenTransaction: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = detailRows(log.details, names);
  const summary = getActionSummary(log.action, log.details, names);
  const sensitive = isSensitive(log.action, log.details);
  const subject =
    log.subject ?? subjects[log.entityId] ?? names.get(log.entityId);
  const link = getEntityLink(log.entity, log.entityId);
  const kind = actorKind(log);
  const name = actorName(log, names);
  const isBulk = log.entityId.includes(":");

  return (
    <tr className={cn("group border-b align-top", nested && "bg-muted/30")}>
      <td
        className={cn(
          "py-2.5 pr-3 tabular-nums text-sm",
          nested ? "pl-10" : "pl-4",
        )}
      >
        <span title={format(log.createdAt, "dd/MM/yyyy HH:mm:ss")}>
          {format(log.createdAt, "HH:mm")}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        <div className="truncate text-sm font-medium" title={log.userEmail}>
          {name}
        </div>
        {kind === "user" && name !== log.userEmail ? (
          <div className="truncate text-xs text-muted-foreground">
            {log.userEmail}
          </div>
        ) : kind !== "user" ? (
          <div className="text-xs text-muted-foreground">{log.userEmail}</div>
        ) : null}
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col items-start gap-1">
          <ActionBadge action={log.action} />
          {sensitive && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              Sensível
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <div className="text-xs text-muted-foreground">
          {ENTITY_LABELS[log.entity] ?? log.entity}
        </div>
        <div className="text-sm wrap-break-word">
          {subject ?? (
            <span className="text-muted-foreground">
              {isBulk ? log.entityId : "registro não identificado"}
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        {rows.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex max-w-full items-start gap-1 text-left text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="wrap-break-word">{summary || "Detalhes"}</span>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
            {open && (
              <div className="mt-2">
                <AuditDetailTable rows={rows} />
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {summary || "—"}
          </span>
        )}
      </td>
      <td className="py-2 pr-4">
        <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {!isBulk && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Histórico deste registro"
              aria-label="Histórico deste registro"
              onClick={() => onShowRecord(log)}
            >
              <History className="h-4 w-4" />
            </Button>
          )}
          {log.entity === "transaction" && !isBulk ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Abrir transação"
              aria-label="Abrir transação"
              onClick={() => onOpenTransaction(log.entityId)}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          ) : link ? (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Abrir registro"
            >
              <Link href={link} aria-label="Abrir registro">
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function AuditLogsContent() {
  const { selectedCompany, isLoading: isCompanyLoading } = useCompany();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canViewAuditLogs } = usePermissions();
  const { openTransaction } = useTransactionDetailStore();
  const companyId = canViewAuditLogs ? selectedCompany?.id : undefined;
  const { names, users } = useAuditNames(companyId);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // Filtros vivem na URL: o link de uma visão pode ir para o auditor.
  const params = useMemo(() => {
    const p = {} as Params;
    for (const [k, short] of Object.entries(PARAM_KEYS)) {
      p[k as keyof Params] = searchParams.get(short) ?? "";
    }
    if (!p.period) p.period = "all";
    return p;
  }, [searchParams]);

  const setParams = (patch: Partial<Params>) => {
    const next = { ...params, ...patch };
    const qs = new URLSearchParams();
    for (const [k, short] of Object.entries(PARAM_KEYS)) {
      const v = next[k as keyof Params];
      if (v && !(k === "period" && v === "all")) qs.set(short, v);
    }
    router.replace(qs.size ? `?${qs}` : "?", { scroll: false });
  };

  useEffect(() => {
    if (!isCompanyLoading && !canViewAuditLogs) {
      toast.error("Acesso negado.");
      router.push("/dashboard");
    }
  }, [canViewAuditLogs, router, isCompanyLoading]);

  const filter = useMemo(() => toFilter(params), [params]);
  const filterKey = JSON.stringify(params);

  const {
    items: logs,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    isError,
    refresh,
  } = usePaginatedQuery<AuditLog>({
    queryKey: ["audit-logs", companyId, filterKey],
    queryFn: async (pageSize, lastDoc) => {
      const { logs: items, lastDoc: next } = await auditService.getPaginated(
        companyId!,
        pageSize,
        lastDoc,
        filter,
      );
      return { items, lastDoc: next };
    },
    pageSize: PAGE_SIZE,
    enabled: !!companyId,
  });

  const { data: total, refetch: refetchTotal } = useQuery({
    queryKey: ["audit-count", companyId, filterKey],
    queryFn: () => auditService.count(companyId!, filter),
    enabled: !!companyId,
  });

  const unnamed = logs
    .filter(
      (l) =>
        !l.subject && (l.entity === "transaction" || l.entity === "entity"),
    )
    .map((l) => l.entityId);
  const { data: subjects = {} } = useQuery({
    queryKey: ["audit-subjects", [...new Set(unnamed)].sort().join(",")],
    queryFn: () => auditService.resolveSubjects(logs),
    enabled: unnamed.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const items = useMemo(() => buildItems(logs), [logs]);

  if (!canViewAuditLogs) return null;

  const recordLabel = params.record
    ? (logs.find((l) => l.entityId === params.record)?.subject ??
      subjects[params.record] ??
      names.get(params.record) ??
      "registro selecionado")
    : "";

  const activeLabels = [
    AUDIT_VIEWS[params.view]?.label,
    params.period !== "all" &&
      (params.period === "custom"
        ? `De ${params.from || "início"} até ${params.to || "hoje"}`
        : PERIODS[params.period]),
    params.user && `Usuário: ${names.get(params.user) ?? params.user}`,
    params.action && `Ação: ${ACTION_NOUNS[params.action] ?? params.action}`,
    params.entity &&
      `Entidade: ${ENTITY_LABELS[params.entity] ?? params.entity}`,
    params.record && `Registro: ${recordLabel}`,
  ].filter(Boolean) as string[];

  const viewLocks = AUDIT_VIEWS[params.view];

  const openTx = async (id: string) => {
    const [tx] = await transactionService.getByIds([id]).catch(() => []);
    if (tx) openTransaction(tx);
    else
      toast.info("Esta transação foi excluída ou você não tem acesso a ela.");
  };

  const handleExport = async () => {
    if (!companyId || !user) return;
    setIsExporting(true);
    try {
      const all = await auditService.getAll(companyId, filter, EXPORT_MAX);
      const extra = await auditService.resolveSubjects(all);
      const summary = activeLabels.join("; ") || "nenhum";
      await exportAuditXlsx(all, names, { ...subjects, ...extra }, summary);
      auditService.log({
        companyId,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || undefined,
        action: "export",
        entity: "audit_log",
        entityId: "audit_logs",
        details: { rows: all.length, filters: summary },
      });
      if (all.length >= EXPORT_MAX) {
        toast.warning(
          `Exportados os ${EXPORT_MAX.toLocaleString("pt-BR")} mais recentes. Use um período menor para o restante.`,
        );
      } else {
        toast.success(
          `${all.length.toLocaleString("pt-BR")} registros exportados.`,
        );
      }
    } catch (error) {
      console.error("Audit export failed:", error);
      toast.error("Não foi possível exportar.");
    } finally {
      setIsExporting(false);
    }
  };

  const toggleRun = (key: string) =>
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rowProps = {
    names,
    subjects,
    onShowRecord: (log: AuditLog) => setParams({ record: log.entityId }),
    onOpenTransaction: openTx,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60">
            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">
              Logs de Auditoria
            </h1>
            <p className="text-sm text-muted-foreground">
              Quem fez o quê, quando e em qual registro. Registros não podem ser
              editados nem apagados.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {total !== undefined && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {total.toLocaleString("pt-BR")}{" "}
              {total === 1 ? "registro" : "registros"}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="Atualizar"
            aria-label="Atualizar"
            onClick={() => {
              refresh();
              refetchTotal();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || total === 0}
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exportar XLSX
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={params.view || "none"}
          onValueChange={(v) => setParams({ view: v === "none" ? "" : v })}
        >
          <SelectTrigger className="w-56" aria-label="Visão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Todas as ações</SelectItem>
            {Object.entries(AUDIT_VIEWS).map(([key, v]) => (
              <SelectItem key={key} value={key}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.period}
          onValueChange={(v) => setParams({ period: v })}
        >
          <SelectTrigger className="w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PERIODS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {params.period === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              className="w-40"
              aria-label="De"
              value={params.from}
              max={params.to || undefined}
              onChange={(e) => setParams({ from: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">até</span>
            <Input
              type="date"
              className="w-40"
              aria-label="Até"
              value={params.to}
              min={params.from || undefined}
              onChange={(e) => setParams({ to: e.target.value })}
            />
          </div>
        )}

        <Select
          value={params.user || "all"}
          onValueChange={(v) => setParams({ user: v === "all" ? "" : v })}
        >
          <SelectTrigger className="w-52" aria-label="Usuário">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os usuários</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.uid} value={u.uid}>
                {u.displayName || u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={viewLocks?.action ?? (params.action || "all")}
          onValueChange={(v) => setParams({ action: v === "all" ? "" : v })}
          disabled={!!viewLocks?.action}
        >
          <SelectTrigger className="w-44" aria-label="Ação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer ação</SelectItem>
            {ACTION_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {ACTION_NOUNS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.entity || "all"}
          onValueChange={(v) => setParams({ entity: v === "all" ? "" : v })}
        >
          <SelectTrigger className="w-48" aria-label="Entidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as entidades</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {params.record && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/50 py-1 pl-2.5 pr-1 text-sm">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-64 truncate">{recordLabel}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Remover filtro de registro"
              onClick={() => setParams({ record: "" })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}

        {activeLabels.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => router.replace("?", { scroll: false })}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        )}
      </div>

      {viewLocks?.fields && (
        <p className="text-xs text-muted-foreground">
          Esta visão usa os campos gravados a partir de 26/10/2026; alterações
          anteriores aparecem em &ldquo;Todas as ações&rdquo;.
        </p>
      )}

      <div className="rounded-xl border bg-card">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-20" />
            <col className="w-[16%]" />
            <col className="w-32" />
            <col className="w-[24%]" />
            <col />
            <col className="w-24" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              <th className="py-3 pl-4 pr-3 font-semibold">Hora</th>
              <th className="py-3 pr-3 font-semibold">Quem</th>
              <th className="py-3 pr-3 font-semibold">Ação</th>
              <th className="py-3 pr-3 font-semibold">Registro</th>
              <th className="py-3 pr-3 font-semibold">O que mudou</th>
              <th className="py-3 pr-4">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm">
                  <p className="font-medium">
                    Não foi possível carregar os registros.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Algumas combinações de filtros ainda não têm índice no
                    banco. Tente remover um filtro.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => refresh()}
                  >
                    Tentar de novo
                  </Button>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-16 text-center text-sm text-muted-foreground"
                >
                  <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  {activeLabels.length
                    ? "Nenhum registro com esses filtros."
                    : "Nenhum registro ainda."}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                if (item.kind === "day") {
                  return (
                    <tr key={item.key} className="border-b bg-muted/40">
                      <td
                        colSpan={6}
                        className="py-1.5 pl-4 text-xs font-semibold capitalize text-muted-foreground"
                      >
                        {item.label}
                      </td>
                    </tr>
                  );
                }
                if (item.kind === "log") {
                  return (
                    <LogRow key={item.log.id} log={item.log} {...rowProps} />
                  );
                }
                const first = item.logs[0];
                const last = item.logs[item.logs.length - 1];
                const open = expandedRuns.has(item.key);
                const entityLabel = ENTITY_LABELS[first.entity] ?? first.entity;
                const sensitiveCount = item.logs.filter((l) =>
                  isSensitive(l.action, l.details),
                ).length;
                return (
                  <Fragment key={item.key}>
                    <tr className="border-b align-top">
                      <td className="py-2.5 pl-4 pr-3 text-sm tabular-nums">
                        {format(first.createdAt, "HH:mm")}
                        <div className="text-xs text-muted-foreground">
                          desde {format(last.createdAt, "HH:mm")}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="truncate text-sm font-medium">
                          {actorName(first, names)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          <ActionBadge action={first.action} />
                          {sensitiveCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <TriangleAlert className="h-3 w-3" aria-hidden />
                              {sensitiveCount} sensíve
                              {sensitiveCount === 1 ? "l" : "is"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td colSpan={3} className="py-2.5 pr-4">
                        <button
                          type="button"
                          onClick={() => toggleRun(item.key)}
                          aria-expanded={open}
                          className="flex items-center gap-1 text-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {item.logs.length} registros de{" "}
                          {entityLabel.toLowerCase()}
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              open && "rotate-180",
                            )}
                          />
                        </button>
                      </td>
                    </tr>
                    {open &&
                      item.logs.map((log) => (
                        <LogRow key={log.id} log={log} nested {...rowProps} />
                      ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        {hasMore && logs.length > 0 && (
          <div className="flex items-center justify-center gap-3 border-t p-4">
            <span className="text-sm tabular-nums text-muted-foreground">
              {logs.length.toLocaleString("pt-BR")}
              {total !== undefined && ` de ${total.toLocaleString("pt-BR")}`}
            </span>
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={isFetchingNextPage}
              className="min-w-[140px]"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                "Carregar mais"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AuditLogsContent />
    </Suspense>
  );
}
