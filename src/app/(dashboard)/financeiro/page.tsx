"use client";

import Link from "next/link";
import {
  Receipt,
  Wallet,
  FileText,
  RotateCcw,
  Scale,
  ArrowUpRight,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useDashboardMetrics, useOverdueTransactions } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Featured modules (primary) ──────────────────────────────────────────────

function PayablesCard({
  pendingPayables,
  shortTermPayables,
  overdueCount,
  loading,
}: {
  pendingPayables: number;
  shortTermPayables: number;
  overdueCount: number;
  loading: boolean;
}) {
  return (
    <Link href="/financeiro/contas-pagar" className="group block h-full">
      <div className="relative h-full rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5 hover:border-rose-200 dark:hover:border-rose-900 overflow-hidden">
        {/* accent strip */}
        <div className="absolute top-0 left-0 h-1 w-full rounded-t-xl bg-gradient-to-r from-rose-500 to-red-400" />

        <div className="flex items-start justify-between mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950">
            <Receipt className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-rose-500" />
        </div>

        <p className="text-sm font-medium text-muted-foreground mb-1">Contas a Pagar</p>

        {loading ? (
          <div className="space-y-2 mt-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold font-financial tracking-tight text-foreground">
              {formatCurrency(pendingPayables)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">total pendente</p>
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {!loading && overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-950 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
              <AlertTriangle className="h-3 w-3" />
              {overdueCount} vencida{overdueCount > 1 ? "s" : ""}
            </span>
          )}
          {!loading && shortTermPayables > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950 px-2.5 py-1 text-xs font-medium font-financial text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <Clock className="h-3 w-3" />
              {formatCurrency(shortTermPayables)} nos próx. 30d
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function ReceivablesCard({
  pendingReceivables,
  shortTermReceivables,
  loading,
}: {
  pendingReceivables: number;
  shortTermReceivables: number;
  loading: boolean;
}) {
  return (
    <Link href="/financeiro/contas-receber" className="group block h-full">
      <div className="relative h-full rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5 hover:border-emerald-200 dark:hover:border-emerald-900 overflow-hidden">
        {/* accent strip */}
        <div className="absolute top-0 left-0 h-1 w-full rounded-t-xl bg-gradient-to-r from-emerald-500 to-teal-400" />

        <div className="flex items-start justify-between mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
            <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-emerald-500" />
        </div>

        <p className="text-sm font-medium text-muted-foreground mb-1">Contas a Receber</p>

        {loading ? (
          <div className="space-y-2 mt-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold font-financial tracking-tight text-foreground">
              {formatCurrency(pendingReceivables)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">total pendente</p>
          </>
        )}

        {!loading && shortTermReceivables > 0 && (
          <div className="mt-5">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 text-xs font-medium font-financial text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Clock className="h-3 w-3" />
              {formatCurrency(shortTermReceivables)} nos próx. 30d
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Utility modules (secondary) ─────────────────────────────────────────────

const utilityModules = [
  {
    title: "Conciliação Bancária",
    description: "Importe extratos OFX e concilie lançamentos.",
    href: "/financeiro/conciliacao",
    icon: Scale,
    accent: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950",
    hoverBorder: "hover:border-blue-200 dark:hover:border-blue-900",
    arrowHover: "group-hover:text-blue-500",
  },
  {
    title: "Lotes de Pagamento",
    description: "Organize pagamentos em lotes para processamento.",
    href: "/financeiro/lotes",
    icon: FileText,
    accent: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950",
    hoverBorder: "hover:border-violet-200 dark:hover:border-violet-900",
    arrowHover: "group-hover:text-violet-500",
  },
  {
    title: "Recorrências",
    description: "Gerencie transações automáticas e assinaturas.",
    href: "/financeiro/recorrencias",
    icon: RotateCcw,
    accent: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950",
    hoverBorder: "hover:border-orange-200 dark:hover:border-orange-900",
    arrowHover: "group-hover:text-orange-500",
  },
];

function UtilityCard({
  title,
  description,
  href,
  icon: Icon,
  accent,
  bg,
  hoverBorder,
  arrowHover,
}: (typeof utilityModules)[0]) {
  return (
    <Link href={href} className="group block h-full">
      <div
        className={cn(
          "h-full rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5",
          hoverBorder,
        )}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bg)}>
            <Icon className={cn("h-4 w-4", accent)} />
          </div>
          <ArrowUpRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
              arrowHover,
            )}
          />
        </div>
        <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceiroPage() {
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics();
  const { data: overdue } = useOverdueTransactions();

  const overduePayablesCount =
    overdue?.filter((t) => t.type === "payable").length ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
        <p className="text-muted-foreground mt-1">
          Acesse os módulos financeiros do sistema.
        </p>
      </div>

      {/* Featured modules */}
      <div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: "0ms", animationFillMode: "both" }}
          >
            <PayablesCard
              pendingPayables={metrics?.pendingPayables ?? 0}
              shortTermPayables={metrics?.shortTermPayables ?? 0}
              overdueCount={overduePayablesCount}
              loading={metricsLoading}
            />
          </div>
          <div
            className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: "80ms", animationFillMode: "both" }}
          >
            <ReceivablesCard
              pendingReceivables={metrics?.pendingReceivables ?? 0}
              shortTermReceivables={metrics?.shortTermReceivables ?? 0}
              loading={metricsLoading}
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Ferramentas
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Utility modules */}
      <div className="grid gap-4 sm:grid-cols-3">
        {utilityModules.map((mod, i) => (
          <div
            key={mod.href}
            className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: `${160 + i * 60}ms`, animationFillMode: "both" }}
          >
            <UtilityCard {...mod} />
          </div>
        ))}
      </div>
    </div>
  );
}
