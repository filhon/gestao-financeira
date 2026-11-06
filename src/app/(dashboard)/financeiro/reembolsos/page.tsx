"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  reimbursementReportService,
  approvalStatus,
  sumItems,
} from "@/lib/services/reimbursementReportService";
import { emailService } from "@/lib/services/emailService";
import { entityService } from "@/lib/services/entityService";
import { expenseSubmissionService } from "@/lib/services/expenseSubmissionService";
import { flagMessage } from "@/lib/reimbursement/receiptChecks";
import {
  ReimbursementReport,
  Entity,
  Transaction,
  ExpenseSubmission,
} from "@/lib/types";
import { formatCurrency, normalizeText, cn } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Link2,
  Plus,
  Search,
} from "lucide-react";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import { CreateReimbursementDialog } from "@/components/features/finance/reembolsos/CreateReimbursementDialog";
import { SubmissionReviewPanel } from "@/components/features/finance/reembolsos/SubmissionReviewPanel";
import { SubmissionLinksDialog } from "@/components/features/finance/reembolsos/SubmissionLinksDialog";
import {
  ReimbursementDetailsDialog,
  actionError,
} from "@/components/features/finance/reembolsos/ReimbursementDetailsDialog";
import {
  ApprovalBadge,
  PaymentLabel,
  formatPeriod,
  paymentOf,
} from "@/components/features/finance/reembolsos/reimbursementUi";

/** Rascunho parado há mais que isso vira alerta. */
const STALE_DAYS = 30;

type View = "queue" | "reports";
type SortKey = "number" | "period" | "total";

const SITUATIONS = [
  ["all", "Todas as situações"],
  ["draft", "Rascunho"],
  ["stale", `Parados há +${STALE_DAYS} dias`],
  ["pending_approval", "Em aprovação"],
  ["approved", "Aprovado"],
  ["to_pay", "Aprovado, a pagar"],
  ["rejected", "Rejeitado"],
] as const;

const NO_REPORTS: ReimbursementReport[] = [];
const NO_ENTITIES: Entity[] = [];
const NO_ITEMS: Transaction[] = [];
const NO_SUBMISSIONS: ExpenseSubmission[] = [];

/** Data em que o relatório chegou à situação atual. */
const since = (r: ReimbursementReport) =>
  r.approvedAt ?? r.rejectedAt ?? r.sentForApprovalAt ?? r.createdAt;

export default function ReembolsosPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { isAdmin, isFinancialManager } = usePermissions();
  const canManage = isAdmin || isFinancialManager;

  const [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [situation, setSituation] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "number",
    desc: true,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSendOpen, setBulkSendOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createFor, setCreateFor] = useState<string | undefined>();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["reimbursement-reports", selectedCompany?.id],
    queryFn: async () => {
      const companyId = selectedCompany!.id;
      const [reports, entities, items, submissions] = await Promise.all([
        reimbursementReportService.getAll(companyId),
        entityService.getAll(companyId),
        // Papel sem leitura de todas as contas: sem fila, só os relatórios.
        reimbursementReportService.getItems(companyId).catch(() => NO_ITEMS),
        expenseSubmissionService
          .getPending(companyId)
          .catch(() => NO_SUBMISSIONS),
      ]);
      return {
        reports,
        individuals: entities.filter((e) => e.type === "individual"),
        items,
        submissions,
      };
    },
    enabled: !!selectedCompany,
    staleTime: 0,
  });
  const reports = data?.reports ?? NO_REPORTS;
  const individuals = data?.individuals ?? NO_ENTITIES;
  const items = data?.items ?? NO_ITEMS;
  const submissions = data?.submissions ?? NO_SUBMISSIONS;
  const reload = () => void refetch();

  useEffect(() => {
    if (isError) toast.error("Erro ao carregar os reembolsos.");
  }, [isError]);

  // ── Derivados ────────────────────────────────────────────────────────────
  const itemsById = useMemo(
    () => new Map(items.map((t) => [t.id, t])),
    [items],
  );

  /**
   * Fila: despesa de reembolso viva, sem relatório. Relatórios antigos não
   * gravavam o vínculo no item, então o `transactionIds` deles também conta.
   */
  const queue = useMemo(() => {
    const inReport = new Set(
      reports
        .filter((r) => r.status !== "rejected")
        .flatMap((r) => r.transactionIds),
    );
    const live = new Set(reports.map((r) => r.id));
    const byEmployee = new Map<string, Transaction[]>();
    for (const t of items) {
      if (t.status === "rejected" || !t.entityId || inReport.has(t.id))
        continue;
      if (t.reimbursementReportId && live.has(t.reimbursementReportId))
        continue;
      byEmployee.set(t.entityId, [...(byEmployee.get(t.entityId) ?? []), t]);
    }
    return byEmployee;
  }, [items, reports]);

  const rows = useMemo(
    () =>
      reports.map((r) => {
        const own = r.transactionIds
          .map((id) => itemsById.get(id))
          .filter((t): t is Transaction => !!t);
        const complete = own.length === r.transactionIds.length;
        const status = approvalStatus(r);
        const age = differenceInCalendarDays(
          new Date(),
          since(r) ?? new Date(),
        );
        return {
          report: r,
          status,
          total: complete ? sumItems(own) : r.totalAmount,
          payment: paymentOf(own),
          unpaid: sumItems(own.filter((t) => t.status !== "paid")),
          age,
          stale: status === "draft" && age > STALE_DAYS,
        };
      }),
    [reports, itemsById],
  );

  const queueRows = useMemo(
    () =>
      [...queue.entries()]
        .map(([employeeId, list]) => {
          const oldest = list.reduce((a, b) => (a.dueDate < b.dueDate ? a : b));
          const employee = individuals.find((e) => e.id === employeeId);
          return {
            employeeId,
            name: employee?.name ?? list[0].supplierOrClient ?? "Sem cadastro",
            document: employee?.document,
            count: list.length,
            total: sumItems(list),
            oldest: oldest.dueDate,
            withoutNote: list.filter(
              (t) => !(t.attachments ?? []).some((a) => a.url),
            ).length,
          };
        })
        .sort((a, b) => a.oldest.getTime() - b.oldest.getTime()),
    [queue, individuals],
  );

  const summary = useMemo(() => {
    const queued = [...queue.values()].flat();
    const pending = rows.filter((r) => r.status === "pending_approval");
    const toPay = rows.filter((r) => r.status === "approved" && r.unpaid > 0);
    const stale = rows.filter((r) => r.stale);
    return {
      submitted: {
        count: submissions.length,
        total: submissions.reduce((s, x) => s + (x.amount ?? 0), 0),
      },
      queued: { count: queued.length, total: sumItems(queued) },
      pending: {
        count: pending.length,
        total: pending.reduce((s, r) => s + r.total, 0),
      },
      toPay: {
        count: toPay.length,
        total: toPay.reduce((s, r) => s + r.unpaid, 0),
      },
      stale: {
        count: stale.length,
        total: stale.reduce((s, r) => s + r.total, 0),
      },
    };
  }, [queue, rows, submissions]);

  const queueCount = queueRows.length + submissions.length;
  const activeView: View = view ?? (queueCount ? "queue" : "reports");
  const reviewing = submissions.find((s) => s.id === reviewId) ?? null;

  const visibleRows = useMemo(() => {
    const term = normalizeText(search.trim());
    const filtered = rows.filter((row) => {
      const r = row.report;
      if (filterEmployee !== "all" && r.employeeId !== filterEmployee)
        return false;
      if (situation === "stale" && !row.stale) return false;
      if (
        situation === "to_pay" &&
        !(row.status === "approved" && row.unpaid > 0)
      )
        return false;
      if (
        !["all", "stale", "to_pay"].includes(situation) &&
        row.status !== situation
      )
        return false;
      if (
        term &&
        !normalizeText(
          `${r.rdNumber} ${r.employeeName} ${r.employeeDocument ?? ""}`,
        ).includes(term)
      )
        return false;
      return true;
    });
    const value = (row: (typeof rows)[number]) =>
      sort.key === "total"
        ? row.total
        : sort.key === "period"
          ? row.report.periodStart.getTime()
          : row.report.rdSequence;
    return filtered.sort(
      (a, b) => (value(a) - value(b)) * (sort.desc ? -1 : 1),
    );
  }, [rows, search, filterEmployee, situation, sort]);

  const selectableIds = visibleRows
    .filter((r) => r.status === "draft")
    .map((r) => r.report.id);
  const selectedDrafts = reports.filter(
    (r) => selected.has(r.id) && r.status === "draft",
  );

  const detailsReport = reports.find((r) => r.id === detailsId) ?? null;
  const hasFilters =
    !!search || filterEmployee !== "all" || situation !== "all";

  // ── Ações ────────────────────────────────────────────────────────────────
  const openCreate = (employeeId?: string) => {
    setCreateFor(employeeId);
    setCreateOpen(true);
  };

  const showSituation = (value: string) => {
    setView("reports");
    setSituation(value);
  };

  const downloadPdf = async (report: ReimbursementReport) => {
    if (!selectedCompany) return;
    const employee = individuals.find((e) => e.id === report.employeeId);
    if (!employee) {
      toast.error("Funcionário não encontrado nos cadastros.");
      return;
    }
    try {
      await reimbursementReportService.downloadPDF(
        report,
        employee,
        selectedCompany,
      );
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar o PDF.");
    }
  };

  const handleBulkSend = async (_id: string, email: string) => {
    if (!user) return;
    const actor = { uid: user.uid, email: user.email };
    const results = await Promise.allSettled(
      selectedDrafts.map(async (report) => {
        const { token } = await reimbursementReportService.sendForApproval(
          report,
          email,
          actor,
        );
        await emailService.sendReimbursementApprovalRequest(
          report.id,
          token,
          email,
        );
      }),
    );
    const failed = results.filter((r) => r.status === "rejected");
    reload();
    setSelected(new Set());
    if (failed.length === results.length) {
      const reason = (failed[0] as PromiseRejectedResult).reason;
      toast.error(actionError(reason, "Erro ao enviar para aprovação."));
      throw reason;
    }
    const sent = results.length - failed.length;
    if (failed.length)
      toast.warning(
        `${sent} enviados, ${failed.length} com erro. Confira os rascunhos.`,
      );
    else
      toast.success(
        sent === 1
          ? `Link enviado para ${email}.`
          : `${sent} relatórios enviados para ${email}.`,
      );
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          Reembolsos
        </h1>
        {canManage && (
          <Button onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" />
            Novo relatório
          </Button>
        )}
      </div>

      {/* Resumo: quanto o financeiro deve aos funcionários, por etapa */}
      {isPending ? (
        <Skeleton className="h-[68px] w-full rounded-lg" />
      ) : (
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border md:grid-cols-5 md:divide-y-0">
          {(
            [
              {
                label: "Enviadas, a conferir",
                value: summary.submitted,
                unit: ["nota", "notas"],
                onClick: () => setView("queue"),
                active: false,
              },
              {
                label: "Lançadas sem relatório",
                value: summary.queued,
                unit: ["despesa", "despesas"],
                onClick: () => setView("queue"),
                active: activeView === "queue",
              },
              {
                label: "Em aprovação",
                value: summary.pending,
                unit: ["relatório", "relatórios"],
                onClick: () => showSituation("pending_approval"),
                active:
                  activeView === "reports" && situation === "pending_approval",
              },
              {
                label: "Aprovado, a pagar",
                value: summary.toPay,
                unit: ["relatório", "relatórios"],
                onClick: () => showSituation("to_pay"),
                active: activeView === "reports" && situation === "to_pay",
              },
              {
                label: `Rascunhos parados há +${STALE_DAYS} dias`,
                value: summary.stale,
                unit: ["relatório", "relatórios"],
                onClick: () => showSituation("stale"),
                active: activeView === "reports" && situation === "stale",
                warn: summary.stale.count > 0,
              },
            ] as const
          ).map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              className={cn(
                "px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                s.active && "bg-muted/70",
              )}
            >
              <p
                className={cn(
                  "text-xs text-muted-foreground",
                  "warn" in s && s.warn && "text-amber-700 dark:text-amber-400",
                )}
              >
                {s.label}
              </p>
              <p className="font-financial text-lg font-semibold tabular-nums">
                {formatCurrency(s.value.total)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {s.value.count} {s.value.count === 1 ? s.unit[0] : s.unit[1]}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Abas */}
      <div className="flex items-center gap-1 border-b" role="tablist">
        {(
          [
            ["queue", "A reembolsar", queueCount],
            ["reports", "Relatórios", reports.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeView === key}
            onClick={() => setView(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              activeView === key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : activeView === "queue" ? (
        <div className="space-y-6">
          {canManage && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinksOpen(true)}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Links de envio
              </Button>
            </div>
          )}

          {/* ── Notas enviadas pelo link, a conferir ──────────────────── */}
          {submissions.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium">
                Enviadas pelos funcionários
                <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                  {submissions.length}
                </span>
              </h2>
              <ul className="divide-y rounded-lg border">
                {submissions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setReviewId(s.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {s.attachment.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.attachment.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {s.description}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.employeeName} ·{" "}
                          {s.date ? format(s.date, "dd/MM/yyyy") : "sem data"}
                        </span>
                        {s.flags.length > 0 && (
                          <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
                            {s.flags.map(flagMessage).join(" ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-financial text-sm font-semibold tabular-nums">
                        {s.amount != null ? formatCurrency(s.amount) : "-"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Fila: despesas lançadas sem relatório, por funcionário ───── */}
          {queueRows.length === 0 ? (
            submissions.length === 0 && (
              <div className="py-14 text-center">
                <p className="font-medium">Nada a reembolsar</p>
                <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                  Toda despesa marcada como reembolso já está em um relatório.
                  Para aparecer aqui, a conta a pagar precisa da opção Despesa
                  de reembolso e do funcionário como fornecedor, ou o
                  funcionário manda a nota pelo link de envio.
                </p>
              </div>
            )
          ) : (
            <section>
              {submissions.length > 0 && (
                <h2 className="mb-2 text-sm font-medium">
                  Lançadas, sem relatório
                </h2>
              )}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium">
                        Funcionário
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Despesas
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium">
                        Mais antiga
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Sem nota
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Total
                      </th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {queueRows.map((q) => {
                      const days = differenceInCalendarDays(
                        new Date(),
                        q.oldest,
                      );
                      return (
                        <tr
                          key={q.employeeId}
                          className="border-b last:border-b-0 hover:bg-muted/30"
                        >
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{q.name}</p>
                            {q.document && (
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {formatCpfCnpj(q.document)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {q.count}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                            {format(q.oldest, "dd/MM/yyyy")}
                            <span
                              className={cn(
                                "ml-2 text-xs",
                                days > STALE_DAYS
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-muted-foreground",
                              )}
                            >
                              {days > 0 ? `há ${days} dias` : "hoje"}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-right tabular-nums",
                              q.withoutNote
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {q.withoutNote || "-"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-financial font-semibold tabular-nums whitespace-nowrap">
                            {formatCurrency(q.total)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canManage && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openCreate(q.employeeId)}
                              >
                                Gerar relatório
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      ) : (
        /* ── Relatórios ─────────────────────────────────────────────────── */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nº, nome ou CPF"
                className="pl-8"
                aria-label="Buscar relatório"
              />
            </div>
            <Select value={filterEmployee} onValueChange={setFilterEmployee}>
              <SelectTrigger className="w-56" aria-label="Funcionário">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os funcionários</SelectItem>
                {individuals
                  .filter((e) => reports.some((r) => r.employeeId === e.id))
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={situation} onValueChange={setSituation}>
              <SelectTrigger className="w-56" aria-label="Situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITUATIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFilterEmployee("all");
                  setSituation("all");
                }}
              >
                Limpar filtros
              </Button>
            )}
            {canManage && selectedDrafts.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedDrafts.length} selecionado
                  {selectedDrafts.length > 1 && "s"}
                </span>
                <Button size="sm" onClick={() => setBulkSendOpen(true)}>
                  Enviar para aprovação
                </Button>
              </div>
            )}
          </div>

          {visibleRows.length === 0 ? (
            <div className="py-14 text-center">
              <p className="font-medium">
                {reports.length === 0
                  ? "Nenhum relatório ainda"
                  : "Nenhum relatório com esses filtros"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {reports.length === 0
                  ? "Gere o primeiro a partir da aba A reembolsar."
                  : "Ajuste a busca ou limpe os filtros."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    {canManage && (
                      <th className="w-10 px-4 py-2.5">
                        <Checkbox
                          aria-label="Selecionar rascunhos"
                          disabled={!selectableIds.length}
                          checked={
                            selectableIds.length > 0 &&
                            selectableIds.every((id) => selected.has(id))
                          }
                          onCheckedChange={(v) =>
                            setSelected(v ? new Set(selectableIds) : new Set())
                          }
                        />
                      </th>
                    )}
                    <SortHeader
                      label="Nº"
                      active={sort.key === "number"}
                      desc={sort.desc}
                      onClick={() => toggleSort("number")}
                    />
                    <th className="px-4 py-2.5 text-left font-medium">
                      Funcionário
                    </th>
                    <SortHeader
                      label="Período"
                      active={sort.key === "period"}
                      desc={sort.desc}
                      onClick={() => toggleSort("period")}
                      className="hidden sm:table-cell"
                    />
                    <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                      Itens
                    </th>
                    <SortHeader
                      label="Total"
                      active={sort.key === "total"}
                      desc={sort.desc}
                      onClick={() => toggleSort("total")}
                      align="right"
                    />
                    <th className="px-4 py-2.5 text-left font-medium">
                      Situação
                    </th>
                    <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">
                      Pagamento
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const r = row.report;
                    const isDraft = row.status === "draft";
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setDetailsId(r.id)}
                        className={cn(
                          "cursor-pointer border-b last:border-b-0 hover:bg-muted/30",
                          detailsId === r.id && "bg-muted/50",
                        )}
                      >
                        {canManage && (
                          <td
                            className="px-4 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isDraft && (
                              <Checkbox
                                aria-label={`Selecionar ${r.rdNumber}`}
                                checked={selected.has(r.id)}
                                onCheckedChange={(v) =>
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (v) next.add(r.id);
                                    else next.delete(r.id);
                                    return next;
                                  })
                                }
                              />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold whitespace-nowrap">
                          {r.rdNumber}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{r.employeeName}</p>
                          {r.employeeDocument && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {formatCpfCnpj(r.employeeDocument)}
                            </p>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell">
                          {formatPeriod(r.periodStart, r.periodEnd)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right text-muted-foreground tabular-nums md:table-cell">
                          {r.transactionIds.length}
                        </td>
                        <td className="px-4 py-2.5 text-right font-financial font-semibold tabular-nums whitespace-nowrap">
                          {formatCurrency(row.total)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <ApprovalBadge report={r} />
                          <span
                            className={cn(
                              "ml-2 text-xs",
                              row.stale
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground",
                            )}
                            title={
                              since(r)
                                ? format(since(r)!, "dd/MM/yyyy")
                                : undefined
                            }
                          >
                            {row.age > 0 ? `há ${row.age} dias` : "hoje"}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 whitespace-nowrap lg:table-cell">
                          <PaymentLabel payment={row.payment} />
                          {row.status === "approved" && row.unpaid > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                              falta {formatCurrency(row.unpaid)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <CreateReimbursementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        employees={individuals.filter((e) => e.active !== false)}
        queue={queue}
        initialEmployeeId={createFor}
        onCreated={(id) => {
          reload();
          setView("reports");
          setDetailsId(id);
        }}
      />

      <SubmissionReviewPanel
        submission={reviewing}
        onClose={() => setReviewId(null)}
        onDone={reload}
      />

      <SubmissionLinksDialog
        open={linksOpen}
        onOpenChange={setLinksOpen}
        employees={individuals.filter((e) => e.active !== false)}
      />

      <ReimbursementDetailsDialog
        report={detailsReport}
        open={!!detailsReport}
        onOpenChange={(open) => !open && setDetailsId(null)}
        onUpdated={reload}
        onDownloadPdf={downloadPdf}
      />

      {selectedCompany && (
        <BatchSendDialog
          isOpen={bulkSendOpen}
          onClose={() => setBulkSendOpen(false)}
          onSend={handleBulkSend}
          companyId={selectedCompany.id}
          title={
            selectedDrafts.length === 1
              ? `Enviar ${selectedDrafts[0].rdNumber} para aprovação`
              : `Enviar ${selectedDrafts.length} relatórios para aprovação`
          }
          description={`Total de ${formatCurrency(
            selectedDrafts.reduce(
              (s, r) =>
                s + (rows.find((x) => x.report.id === r.id)?.total ?? 0),
              0,
            ),
          )}. Cada relatório gera um link por e-mail, válido por 7 dias. Quem envia não pode aprovar.`}
          buttonText="Enviar"
        />
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = "left",
  className,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon = desc ? ArrowDown : ArrowUp;
  return (
    <th
      className={cn("px-4 py-2.5 font-medium", className)}
      aria-sort={active ? (desc ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "w-full justify-end",
          active && "text-foreground",
        )}
      >
        {label}
        {active && <Icon className="h-3 w-3" />}
      </button>
    </th>
  );
}
