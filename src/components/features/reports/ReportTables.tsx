"use client";

import { useId } from "react";
import { format } from "date-fns";
import { ArrowUpRight, Paperclip } from "lucide-react";
import currency from "currency.js";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn, formatCurrency } from "@/lib/utils";
import {
  CashFlowReport,
  PaymentsReport,
  FlowBucket,
  Granularity,
  STAGE_INFO,
  formatPercent,
  isProjection,
  situationOf,
  variation,
} from "@/lib/reports";
import type { DreReport, DreRow } from "@/lib/chartOfAccounts";
import type { Transaction } from "@/lib/types";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { receiptUrl } from "@/lib/services/reportService";

// ─── Peças comuns ─────────────────────────────────────────────────────────────

/**
 * Grupo de opções exclusivas (rádio), compacto. O rótulo fica visível: "Dia |
 * Mês" sozinho não diz que eixo está mudando.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="inline-flex max-w-full items-center gap-2">
      <span
        id={id}
        className={cn("text-xs text-muted-foreground", hideLabel && "sr-only")}
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="inline-flex h-8 min-w-0 items-center overflow-x-auto rounded-md border bg-muted/40 p-0.5 [scrollbar-width:none]"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-full rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === o.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Tabela com rolagem própria: cabeçalho e totais ficam presos enquanto as
 * linhas rolam, e os filtros acima continuam à vista numa DRE longa.
 */
const SCROLL =
  "max-h-[calc(100dvh-14rem)] min-h-64 overflow-auto rounded-lg border";
const HEAD = "sticky top-0 z-10 bg-muted";
const FOOT = "sticky bottom-0 z-10 bg-muted";

const money = (v: number) => formatCurrency(v);

/** Saída entre parênteses, como na DRE publicada. */
const dreMoney = (v: number) =>
  v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v);

const tone = (v: number) => (v < 0 ? "text-red-700 dark:text-red-400" : "");

/** Valor que abre os lançamentos que o formam. */
function DrillValue({
  value,
  display,
  onOpen,
  className,
  label,
}: {
  value: number;
  display?: string;
  onOpen?: () => void;
  className?: string;
  label: string;
}) {
  const text = display ?? money(value);
  if (!onOpen || value === 0) {
    return (
      <span
        className={cn(value === 0 && "text-muted-foreground/60", className)}
      >
        {value === 0 ? "—" : text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}: ${text}. Ver lançamentos`}
      className={cn(
        "rounded-sm underline-offset-4 decoration-muted-foreground/40 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {text}
    </button>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const v = variation(current, previous);
  return (
    <span className="text-xs text-muted-foreground">
      ant. {money(previous)}{" "}
      <span className="tabular-nums">({formatPercent(v, true)})</span>
    </span>
  );
}

const TH =
  "px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-1.5 whitespace-nowrap";

// ─── Drill-down ───────────────────────────────────────────────────────────────

export interface DrillLine {
  tx: Transaction;
  date: Date;
  /** Positivo; o tipo da transação diz o sentido. */
  amount: number;
  status: string;
}

export interface Drill {
  title: string;
  subtitle: string;
  lines: DrillLine[];
}

export function DrillSheet({
  drill,
  onClose,
}: {
  drill: Drill | null;
  onClose: () => void;
}) {
  const { openTransaction } = useTransactionDetailStore();
  const lines = [...(drill?.lines ?? [])].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const total = lines.reduce(
    (s, l) => s.add(l.tx.type === "receivable" ? l.amount : -l.amount),
    currency(0),
  ).value;

  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <div className="border-b px-5 py-4">
          <SheetTitle className="text-base">{drill?.title}</SheetTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {drill?.subtitle}
          </p>
          <p className="mt-3 flex items-baseline gap-3 text-sm">
            <span
              className={cn(
                "font-financial text-xl font-semibold",
                tone(total),
              )}
            >
              {money(total)}
            </span>
            <span className="text-muted-foreground">
              {lines.length} {lines.length === 1 ? "lançamento" : "lançamentos"}
            </span>
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left">
                <th className={TH}>Data</th>
                <th className={TH}>Descrição</th>
                <th className={TH}>Situação</th>
                <th className={cn(TH, "text-right")}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const projection = isProjection(l.tx);
                const signedValue =
                  l.tx.type === "receivable" ? l.amount : -l.amount;
                return (
                  <tr
                    key={l.tx.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td
                      className={cn(TD, "font-financial text-muted-foreground")}
                    >
                      {format(l.date, "dd/MM/yyyy")}
                    </td>
                    <td className="max-w-[18rem] px-3 py-1.5">
                      {projection ? (
                        <span className="block truncate">
                          {l.tx.description}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openTransaction(l.tx)}
                          className="group flex max-w-full items-center gap-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate">{l.tx.description}</span>
                          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {l.tx.supplierOrClient || "—"}
                      </span>
                    </td>
                    <td className={cn(TD, "text-xs text-muted-foreground")}>
                      {l.status}
                    </td>
                    <td
                      className={cn(
                        TD,
                        "text-right font-financial",
                        tone(signedValue),
                      )}
                    >
                      {money(signedValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Fluxo de caixa ───────────────────────────────────────────────────────────

export function CashFlowView({
  report,
  previous,
  showStages,
  hasOpening,
  granularity,
  onDrill,
}: {
  report: CashFlowReport;
  previous: CashFlowReport | null;
  showStages: boolean;
  /** Sem saldo de referência (filtro de centro de custo), o saldo é só o acumulado. */
  hasOpening: boolean;
  granularity: Granularity;
  onDrill: (d: Drill) => void;
}) {
  const drill = (
    title: string,
    subtitle: string,
    lines: CashFlowReport["lines"],
  ) =>
    onDrill({
      title,
      subtitle,
      lines: lines.map((l) => ({
        tx: l.tx,
        date: l.date,
        amount: l.amount,
        status: situationOf(l.tx),
      })),
    });
  const ins = (lines: CashFlowReport["lines"]) =>
    lines.filter((l) => l.tx.type === "receivable");
  const outs = (lines: CashFlowReport["lines"]) =>
    lines.filter((l) => l.tx.type === "payable");

  // Menor saldo só é notícia quando não é o próprio saldo final; senão o
  // que explica o período costuma ser a maior saída.
  const lowestIsNews = report.lowest.balance < report.closing;
  const biggest = report.buckets.reduce<FlowBucket | null>(
    (m, b) => (b.outflow > (m?.outflow ?? 0) ? b : m),
    null,
  );
  const biggestShare =
    biggest && report.outflow ? biggest.outflow / report.outflow : 0;
  // Uma linha que concentra boa parte das saídas não pode ter o mesmo peso
  // das outras.
  const standout =
    biggestShare >= 0.3 && report.buckets.length > 2 ? biggest : null;

  // O saldo inicial já está no campo dos filtros e na primeira linha da
  // tabela; o resumo começa no que aconteceu no período.
  const summary = [
    {
      label: "Entradas",
      value: report.inflow,
      prev: previous?.inflow ?? null,
      open: () => drill("Entradas", "Período inteiro", ins(report.lines)),
    },
    {
      label: "Saídas",
      value: report.outflow,
      prev: previous?.outflow ?? null,
      open: () => drill("Saídas", "Período inteiro", outs(report.lines)),
    },
    {
      label: "Resultado",
      value: report.net,
      prev: previous?.net ?? null,
      signed: true,
    },
    {
      label: hasOpening ? "Saldo final" : "Acumulado",
      value: report.closing,
      prev: null,
      signed: true,
    },
  ];

  return (
    <div className="space-y-6">
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-lg border bg-border">
        {summary.map((s) => (
          <div key={s.label} className="min-w-40 flex-1 bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd
              className={cn(
                "mt-1 font-financial text-lg font-semibold",
                "signed" in s && s.signed && tone(s.value),
              )}
            >
              <DrillValue
                label={s.label}
                value={s.value}
                onOpen={"open" in s ? s.open : undefined}
              />
            </dd>
            {s.prev !== null && <Delta current={s.value} previous={s.prev} />}
          </div>
        ))}
        {lowestIsNews ? (
          <div className="min-w-40 flex-1 bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">Menor saldo</dt>
            <dd
              className={cn(
                "mt-1 font-financial text-lg font-semibold",
                tone(report.lowest.balance),
              )}
            >
              {money(report.lowest.balance)}
            </dd>
            <span className="text-xs text-muted-foreground">
              em {format(report.lowest.date, "dd/MM/yyyy")}
            </span>
          </div>
        ) : biggest ? (
          <div className="min-w-40 flex-1 bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">Maior saída</dt>
            <dd className="mt-1 font-financial text-lg font-semibold">
              <DrillValue
                label="Maior saída"
                value={biggest.outflow}
                onOpen={() =>
                  drill("Saídas", biggest.label, outs(biggest.lines))
                }
              />
            </dd>
            <span className="text-xs text-muted-foreground">
              <span className="capitalize">{biggest.label}</span> ·{" "}
              {formatPercent(biggestShare)} das saídas
            </span>
          </div>
        ) : null}
      </dl>

      <div className={SCROLL}>
        <table className="w-full text-sm">
          <thead className={HEAD}>
            <tr className="border-b text-left">
              <th className={TH}>{granularity === "day" ? "Data" : "Mês"}</th>
              <th className={cn(TH, "text-right")}>Entradas</th>
              <th className={cn(TH, "text-right")}>Saídas</th>
              <th className={cn(TH, "text-right")}>Resultado</th>
              <th className={cn(TH, "text-right")}>
                {hasOpening ? "Saldo" : "Acumulado"}
              </th>
            </tr>
          </thead>
          <tbody className="font-financial">
            {hasOpening && (
              <tr className="border-b border-border/60 text-muted-foreground">
                <td className={TD}>Saldo inicial</td>
                <td className={TD} />
                <td className={TD} />
                <td className={TD} />
                <td className={cn(TD, "text-right", tone(report.opening))}>
                  {money(report.opening)}
                </td>
              </tr>
            )}
            {report.buckets.map((b) => (
              <tr
                key={b.key}
                className={cn(
                  "border-b border-border/60 last:border-0 hover:bg-muted/30",
                  b === standout && "bg-muted/50",
                )}
              >
                <td className={TD}>
                  <span
                    className={cn(
                      "font-sans capitalize",
                      b === standout && "font-semibold",
                    )}
                  >
                    {b.label}
                  </span>
                  {b === standout && (
                    <span className="ml-2 font-sans text-[11px] text-muted-foreground">
                      maior saída · {formatPercent(biggestShare)} das saídas
                    </span>
                  )}
                  {b.forecast && (
                    <span className="ml-2 font-sans text-[11px] text-muted-foreground">
                      inclui previsto
                    </span>
                  )}
                </td>
                <td className={cn(TD, "text-right")}>
                  <DrillValue
                    label={`Entradas ${b.label}`}
                    value={b.inflow}
                    onOpen={() => drill("Entradas", b.label, ins(b.lines))}
                  />
                </td>
                <td className={cn(TD, "text-right")}>
                  <DrillValue
                    label={`Saídas ${b.label}`}
                    value={b.outflow}
                    onOpen={() => drill("Saídas", b.label, outs(b.lines))}
                  />
                </td>
                <td className={cn(TD, "text-right", tone(b.net))}>
                  <DrillValue
                    label={`Resultado ${b.label}`}
                    value={b.net}
                    onOpen={() => drill("Movimento", b.label, b.lines)}
                  />
                </td>
                <td className={cn(TD, "text-right", tone(b.balance))}>
                  {money(b.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className={cn(FOOT, "font-financial")}>
            <tr className="border-t font-semibold">
              <td className={cn(TD, "font-sans")}>Total</td>
              <td className={cn(TD, "text-right")}>{money(report.inflow)}</td>
              <td className={cn(TD, "text-right")}>{money(report.outflow)}</td>
              <td className={cn(TD, "text-right", tone(report.net))}>
                {money(report.net)}
              </td>
              <td className={cn(TD, "text-right", tone(report.closing))}>
                {money(report.closing)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {showStages && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Por situação</h2>
          <p className="text-xs text-muted-foreground">
            Do mais firme ao menos firme. Quanto mais do previsto estiver nas
            últimas linhas, menos confiável é o saldo final.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="border-b text-left">
                  <th className={TH}>Situação</th>
                  <th className={cn(TH, "text-right")}>Lançamentos</th>
                  <th className={cn(TH, "text-right")}>Entradas</th>
                  <th className={cn(TH, "text-right")}>Saídas</th>
                  <th className={cn(TH, "text-right")}>Líquido</th>
                </tr>
              </thead>
              <tbody className="font-financial">
                {report.byStage.map((s) => {
                  const net = currency(s.inflow).subtract(s.outflow).value;
                  const info = STAGE_INFO[s.stage];
                  return (
                    <tr
                      key={s.stage}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className={cn(TD, "font-sans")}>
                        {info.label}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {info.hint}
                        </span>
                      </td>
                      <td
                        className={cn(TD, "text-right text-muted-foreground")}
                      >
                        {s.lines.length}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <DrillValue
                          label={`Entradas ${info.label}`}
                          value={s.inflow}
                          onOpen={() =>
                            drill("Entradas", info.label, ins(s.lines))
                          }
                        />
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <DrillValue
                          label={`Saídas ${info.label}`}
                          value={s.outflow}
                          onOpen={() =>
                            drill("Saídas", info.label, outs(s.lines))
                          }
                        />
                      </td>
                      <td className={cn(TD, "text-right", tone(net))}>
                        {net === 0 ? "—" : money(net)}
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
  );
}

// ─── DRE ──────────────────────────────────────────────────────────────────────

const rowKey = (r: DreRow<unknown>) =>
  `${r.kind}:${r.key ?? r.code ?? r.label}`;

export function DreView({
  dre,
  previous,
  monthly,
  hideZero,
  lineFor,
  onDrill,
}: {
  dre: DreReport<Transaction>;
  previous: DreReport<Transaction> | null;
  monthly: boolean;
  /** Esconde grupos e contas sem valor (nem no período de comparação). */
  hideZero: boolean;
  /** Valor e data com que o lançamento entrou na DRE (regime e centro de custo). */
  lineFor: (t: Transaction) => DrillLine;
  onDrill: (d: Drill) => void;
}) {
  const prevByKey = new Map(previous?.rows.map((r) => [rowKey(r), r.total]));
  const showMonths = monthly && dre.columns.length > 1;
  // Sem receita líquida não há base: uma coluna inteira de traços só ocupa
  // espaço. A nota abaixo da tabela explica a ausência.
  const showAv = dre.base > 0;
  const cols =
    1 +
    (showMonths ? dre.columns.length : 0) +
    1 +
    (showAv ? 1 : 0) +
    (previous ? 2 : 0);
  const rows = hideZero
    ? dre.rows.filter(
        (r) =>
          (r.kind !== "group" && r.kind !== "account") ||
          r.total !== 0 ||
          r.values.some((v) => v !== 0) ||
          !!prevByKey.get(rowKey(r)),
      )
    : dre.rows;

  return (
    <div className={SCROLL}>
      <table className="w-full text-sm">
        <thead className={HEAD}>
          <tr className="border-b text-left">
            <th className={cn(TH, "min-w-[18rem]")}>Conta</th>
            {showMonths &&
              dre.columns.map((c) => (
                <th key={c.key} className={cn(TH, "text-right capitalize")}>
                  {c.label}
                </th>
              ))}
            <th className={cn(TH, "text-right")}>Total</th>
            {showAv && <th className={cn(TH, "text-right")}>AV %</th>}
            {previous && (
              <>
                <th className={cn(TH, "text-right")}>Anterior</th>
                <th className={cn(TH, "text-right")}>AH %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="font-financial">
          {rows.map((r, i) => {
            if (r.kind === "heading") {
              return (
                <tr key={i}>
                  <td
                    colSpan={cols}
                    className="px-3 pb-1 pt-4 font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {r.label}
                  </td>
                </tr>
              );
            }
            const strong = r.kind !== "account" && r.kind !== "info";
            // Despesa já tem (−) e parênteses; vermelho só onde é alarme: um
            // subtotal ou resultado negativo.
            const alarm = (v: number) =>
              r.kind === "subtotal" || r.kind === "result" ? tone(v) : "";
            const prev = prevByKey.get(rowKey(r));
            const sources = r.sources ?? [];
            const open = sources.length
              ? () =>
                  onDrill({
                    title: r.code ? `${r.code} · ${r.label}` : r.label,
                    subtitle: "Lançamentos que formam a linha",
                    lines: sources.map(lineFor),
                  })
              : undefined;
            return (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/60",
                  r.kind === "group" && "bg-muted/30",
                  r.kind === "subtotal" && "bg-muted/60",
                  r.kind === "result" && "bg-foreground/7",
                  strong && "font-semibold",
                )}
              >
                <td
                  className="px-3 py-1.5 font-sans"
                  style={{
                    paddingLeft:
                      r.kind === "account" || r.kind === "info"
                        ? `${0.75 + r.level * 1}rem`
                        : undefined,
                  }}
                >
                  {r.kind === "subtotal" || r.kind === "result" ? "(=) " : ""}
                  {r.code && (
                    <span className="mr-2 font-financial text-xs text-muted-foreground">
                      {r.code}
                    </span>
                  )}
                  <span
                    className={cn(
                      r.kind === "info" && "text-amber-800 dark:text-amber-300",
                    )}
                  >
                    {r.label}
                  </span>
                </td>
                {showMonths &&
                  r.values.map((v, ci) => (
                    <td key={ci} className={cn(TD, "text-right", alarm(v))}>
                      {v === 0 ? (
                        <span className="font-normal text-muted-foreground/60">
                          —
                        </span>
                      ) : (
                        dreMoney(v)
                      )}
                    </td>
                  ))}
                <td className={cn(TD, "text-right", alarm(r.total))}>
                  <DrillValue
                    label={r.label}
                    value={r.total}
                    display={dreMoney(r.total)}
                    onOpen={open}
                    className={r.total === 0 ? "font-normal" : undefined}
                  />
                </td>
                {showAv && (
                  <td
                    className={cn(
                      TD,
                      "text-right font-normal text-muted-foreground",
                    )}
                  >
                    {r.total === 0 ? "—" : formatPercent(r.total / dre.base)}
                  </td>
                )}
                {previous && (
                  <>
                    <td className={cn(TD, "text-right", alarm(prev ?? 0))}>
                      {prev ? dreMoney(prev) : "—"}
                    </td>
                    <td className={cn(TD, "text-right text-muted-foreground")}>
                      {formatPercent(variation(r.total, prev ?? 0), true)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagamentos ───────────────────────────────────────────────────────────────

export function PaymentsView({
  report,
  payable,
  showParty,
  accountOf,
}: {
  report: PaymentsReport;
  payable: boolean;
  /** Sem entidade filtrada, cada linha diz a quem foi. */
  showParty: boolean;
  /** Conta da entidade que recebeu, quando ela tem mais de uma. */
  accountOf?: (t: Transaction) => string;
}) {
  const { openTransaction } = useTransactionDetailStore();
  const withReceipt = report.lines.filter((l) => receiptUrl(l.tx)).length;
  return (
    <div className="space-y-2">
      <div className={SCROLL}>
        <table className="w-full text-sm">
          <thead className={HEAD}>
            <tr className="text-left">
              <th className={TH}>{payable ? "Pago em" : "Recebido em"}</th>
              <th className={cn(TH, "w-full")}>Descrição</th>
              <th className={TH}>Nº documento</th>
              {accountOf && <th className={TH}>Conta</th>}
              <th className={cn(TH, "text-right")}>
                {payable ? "Valor pago" : "Valor recebido"}
              </th>
              <th className={cn(TH, "text-center")}>Comprovante</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l) => {
              const receipt = receiptUrl(l.tx);
              return (
                <tr
                  key={l.tx.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td
                    className={cn(TD, "font-financial text-muted-foreground")}
                  >
                    {format(l.date, "dd/MM/yyyy")}
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => openTransaction(l.tx)}
                      className="group flex max-w-full items-center gap-1 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{l.tx.description}</span>
                      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
                    </button>
                    {showParty && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {l.tx.supplierOrClient || "—"}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(TD, "font-financial text-muted-foreground")}
                  >
                    {l.tx.documentNumber || "—"}
                  </td>
                  {accountOf && (
                    <td className={cn(TD, "text-muted-foreground")}>
                      {accountOf(l.tx)}
                    </td>
                  )}
                  <td className={cn(TD, "text-right font-financial")}>
                    {money(l.amount)}
                  </td>
                  <td className={cn(TD, "text-center")}>
                    {receipt ? (
                      <a
                        href={receipt}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        Abrir
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className={cn(FOOT, "font-financial")}>
            <tr className="border-t font-semibold">
              <td className={cn(TD, "font-sans")} colSpan={accountOf ? 4 : 3}>
                Total · {report.lines.length}{" "}
                {report.lines.length === 1 ? "lançamento" : "lançamentos"}
              </td>
              <td className={cn(TD, "text-right")}>{money(report.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Pela data {payable ? "do pagamento" : "do recebimento"}. {withReceipt}{" "}
        de {report.lines.length} com comprovante.
      </p>
    </div>
  );
}
