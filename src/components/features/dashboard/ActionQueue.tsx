"use client";

import Link from "next/link";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { QueueSection } from "@/lib/services/dashboardService";
import { relativeDue } from "@/lib/transactionTabs";
import { groupByCounterpart } from "@/lib/dashboardRules";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { Transaction } from "@/lib/types";

const toneText: Record<QueueSection["tone"], string> = {
  danger: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  neutral: "text-foreground",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const MAX_ROWS = 5;

function dueText(t: Transaction) {
  const due = relativeDue(t.dueDate);
  if (due.tone === "overdue") return `venceu ${due.label}`;
  if (due.label) return `vence ${due.label}`;
  return `vence em ${format(t.dueDate, "dd/MM/yyyy")}`;
}

// Card largo (fila com uma seção só): colunas que usam a largura. Estreito
// (seções lado a lado): nome em cima, detalhe embaixo, valor à direita.
const txCols =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_10rem]";
const groupCols =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 @3xl:grid-cols-[minmax(0,1fr)_5rem_9rem_11rem_10rem]";
const wide = "hidden @3xl:block";

/** Dias de atraso com tom: acima de 90 é crédito duvidoso, acima de 30 pede régua. */
function lateTone(days: number) {
  if (days > 90) return "text-red-700 dark:text-red-400 font-medium";
  if (days > 30) return "text-amber-700 dark:text-amber-400";
  return "";
}

function TransactionRow({
  t,
  showCounterpart,
}: {
  t: Transaction;
  showCounterpart: boolean;
}) {
  const { openTransaction } = useTransactionDetailStore();
  return (
    <button
      type="button"
      onClick={() => openTransaction(t)}
      className={cn(
        txCols,
        "w-full px-4 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-inset",
        focusRing,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {t.description}
        </span>
        <span className="block truncate text-xs text-muted-foreground @3xl:hidden">
          {showCounterpart && t.supplierOrClient
            ? `${t.supplierOrClient} · `
            : ""}
          {dueText(t)}
        </span>
      </span>
      <span className={cn(wide, "truncate text-sm text-muted-foreground")}>
        {showCounterpart ? t.supplierOrClient : ""}
      </span>
      <span className={cn(wide, "text-right text-sm text-muted-foreground")}>
        {dueText(t)}
      </span>
      <span className="text-right text-sm font-medium font-financial">
        {formatCurrency(t.amount)}
      </span>
    </button>
  );
}

/** Vencidas agrupadas por contraparte; cada grupo abre suas contas. */
function GroupedRows({
  section,
  relatedPartyIds,
}: {
  section: QueueSection;
  relatedPartyIds: Set<string>;
}) {
  const today = startOfDay(new Date());
  const groups = groupByCounterpart(section.items, today);
  const partial = section.items.length < section.count;

  return (
    <>
      <div
        className={cn(
          groupCols,
          "hidden border-b px-4 py-1.5 text-xs text-muted-foreground @3xl:grid",
        )}
        aria-hidden
      >
        <span className="pl-5">Contraparte</span>
        <span className="text-right">Contas</span>
        <span className="text-right">Mais antiga</span>
        <span className="text-right">Há mais de 90 dias</span>
        <span className="text-right">Total</span>
      </div>
      <ul className="divide-y">
        {groups.slice(0, MAX_ROWS).map((g) => {
          const days = differenceInCalendarDays(today, g.oldest);
          const daysText = `há ${days} ${days === 1 ? "dia" : "dias"}`;
          return (
            <li key={g.key}>
              <details className="group/row">
                <summary
                  className={cn(
                    groupCols,
                    "cursor-pointer list-none px-4 py-2 transition-colors hover:bg-muted/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden",
                    focusRing,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/row:rotate-90" />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {g.name}
                        </span>
                        {relatedPartyIds.has(g.key) && (
                          <span className="shrink-0 rounded border px-1.5 text-[11px] font-medium text-muted-foreground">
                            parte relacionada
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground @3xl:hidden">
                        {g.count} {g.count === 1 ? "conta" : "contas"} · mais
                        antiga{" "}
                        <span className={lateTone(days)}>{daysText}</span>
                      </span>
                    </span>
                  </span>
                  {/* O cabeçalho de colunas é visual; cada célula leva o
                      próprio rótulo para o leitor de tela. */}
                  <span
                    className={cn(wide, "text-right text-sm font-financial")}
                  >
                    <span className="sr-only">Contas: </span>
                    {g.count}
                  </span>
                  <span
                    className={cn(wide, "text-right text-sm", lateTone(days))}
                  >
                    <span className="sr-only">Mais antiga: </span>
                    {daysText}
                  </span>
                  <span
                    className={cn(
                      wide,
                      "text-right text-sm font-financial",
                      g.over90 > 0
                        ? "text-red-700 dark:text-red-400"
                        : "text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">Há mais de 90 dias: </span>
                    {g.over90 > 0 ? formatCurrency(g.over90) : "nenhum"}
                  </span>
                  <span className="text-right text-sm font-medium font-financial">
                    <span className="sr-only">Total: </span>
                    {formatCurrency(g.total)}
                  </span>
                </summary>
                <div className="divide-y border-t bg-muted/30 pl-6">
                  {g.items.map((t) => (
                    <TransactionRow key={t.id} t={t} showCounterpart={false} />
                  ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {(groups.length > MAX_ROWS || partial) && (
        <Link
          href={section.href}
          className={cn(
            "mt-auto block border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-inset",
            focusRing,
          )}
        >
          {groups.length > MAX_ROWS
            ? `Mais ${groups.length - MAX_ROWS} ${groups.length - MAX_ROWS === 1 ? "contraparte" : "contrapartes"}`
            : "Ver todas"}
          {partial && ` · agrupando as ${section.items.length} mais antigas`}
        </Link>
      )}
    </>
  );
}

function Section({
  section,
  relatedPartyIds,
}: {
  section: QueueSection;
  relatedPartyIds: Set<string>;
}) {
  const hidden = section.count - section.items.length;

  return (
    <div className="@container flex flex-col rounded-xl border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className={cn("text-sm font-semibold", toneText[section.tone])}>
            {section.label}{" "}
            <span className="font-financial">({section.count})</span>
          </h3>
          <p className="text-xs text-muted-foreground font-financial">
            {formatCurrency(section.total)}
          </p>
        </div>
        <Link
          href={section.href}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground",
            focusRing,
          )}
        >
          Ver todas <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {section.grouped ? (
        <GroupedRows section={section} relatedPartyIds={relatedPartyIds} />
      ) : (
        <>
          <ul className="divide-y">
            {section.items.map((t) => (
              <li key={t.id}>
                <TransactionRow t={t} showCounterpart />
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <Link
              href={section.href}
              className={cn(
                "mt-auto block border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-inset",
                focusRing,
              )}
            >
              Mais {hidden} {hidden === 1 ? "conta" : "contas"}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/** Seções ocupam a largura toda: uma sozinha não deixa a linha vazia. */
export const QUEUE_GRID =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-4";

export function ActionQueue({
  sections,
  relatedPartyIds,
}: {
  sections: QueueSection[];
  relatedPartyIds: Set<string>;
}) {
  const open = sections.filter((s) => s.count > 0);

  if (open.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        Nada vencido, nada vencendo hoje e nenhuma conta esperando sua ação.
      </p>
    );
  }

  return (
    <div className={QUEUE_GRID}>
      {open.map((s) => (
        <Section key={s.id} section={s} relatedPartyIds={relatedPartyIds} />
      ))}
    </div>
  );
}
