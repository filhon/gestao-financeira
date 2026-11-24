"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import currency from "currency.js";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPercent, lineSituation, variation } from "@/lib/reports";
import {
  isUnfavorable,
  MATRIX_ROWS,
  mergeLines,
  shownNodes,
  type CashMatrix,
  type MatrixLine,
  type MatrixNode,
  type MatrixSection,
} from "@/lib/cashMatrix";
import {
  Drill,
  DrillValue,
  HEAD,
  SCROLL,
  TD,
  TH,
  tone,
} from "@/components/features/reports/ReportTables";

const number = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plain = (v: number) => number.format(v);
const signed = (v: number) => `${v > 0 ? "+" : ""}${number.format(v)}`;

/** Linhas à vista por seção numa lista plana; o resto abre num clique. */
const FLAT_LIMIT = 15;

/** A primeira coluna fica presa; o fundo opaco esconde o que rola por baixo. */
const STICKY = "sticky left-0 z-[1] bg-background group-hover/row:bg-muted";
const NUM = "text-right font-financial";
const EDGE = "border-l border-border/60";

/** Centros abertos; contas, que têm mais níveis, só até o segundo. */
const startsClosed = (m: CashMatrix, n: MatrixNode) =>
  n.hasChildren && m.rows === "account" && n.depth >= 1;

const keyIn = (s: MatrixSection, n: MatrixNode) => `${s.type}:${n.key}`;

export function CashMatrixView({
  matrix,
  today,
  closedPeriod,
  onDrill,
}: {
  matrix: CashMatrix;
  today: Date;
  closedPeriod: boolean;
  onDrill: (d: Drill) => void;
}) {
  const sections = [matrix.inflow, matrix.outflow];
  const parents = sections.flatMap((s) =>
    s.nodes.filter((n) => n.hasChildren).map((n) => keyIn(s, n)),
  );
  const [closed, setClosed] = useState<Set<string>>(
    () =>
      new Set(
        sections.flatMap((s) =>
          s.nodes
            .filter((n) => startsClosed(matrix, n))
            .map((n) => keyIn(s, n)),
        ),
      ),
  );
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  const { buckets, hasPlan } = matrix;
  // O previsto que ainda não venceu não é desvio.
  const totalLabel =
    hasPlan && !closedPeriod ? `Até ${format(today, "dd/MM")}` : "Total";
  const columns =
    1 +
    buckets.length * (hasPlan ? 2 : 1) +
    (hasPlan ? 3 : 1 + (matrix.hasPrevious ? 2 : 0));

  const open = (title: string, subtitle: string, lines: MatrixLine[]) =>
    onDrill({
      title,
      subtitle,
      lines: mergeLines(lines).map((l) => ({
        tx: l.tx,
        date: l.date,
        amount: l.amount,
        status: lineSituation(l),
      })),
    });

  /** Só o que está aberto, e os primeiros de uma lista plana longa. */
  const visible = (s: MatrixSection) => {
    const hidden = new Set<string>();
    const rows = shownNodes(matrix, s).filter((n) => {
      const out =
        n.parent !== null &&
        (hidden.has(n.parent) || closed.has(`${s.type}:${n.parent}`));
      if (out) hidden.add(n.key);
      return !out;
    });
    const flat = !s.nodes.some((n) => n.hasChildren);
    const cut = flat && !showAll.has(s.type) && rows.length > FLAT_LIMIT + 1;
    return {
      rows: cut ? rows.slice(0, FLAT_LIMIT) : rows,
      more: cut ? rows.length - FLAT_LIMIT : 0,
    };
  };

  /** As células de números de uma linha, nó ou seção. */
  const cells = (
    row: MatrixNode | MatrixSection,
    s: MatrixSection,
    label: string,
  ) => {
    const tops = s.nodes.filter((n) => n.depth === 0);
    const at = (i: number) =>
      "lines" in row ? row.lines[i] : tops.flatMap((n) => n.lines[i]);
    const planAt = (i: number) =>
      "planLines" in row
        ? row.planLines[i]
        : tops.flatMap((n) => n.planLines[i]);
    const every = (pick: (i: number) => MatrixLine[]) =>
      buckets.flatMap((_, i) => pick(i));
    const deviation = currency(row.total).subtract(row.planTotal).value;
    const value = (
      v: number,
      title: string,
      subtitle: string,
      lines: () => MatrixLine[],
    ) => (
      <DrillValue
        label={`${title}, ${subtitle}`}
        value={v}
        display={plain(v)}
        onOpen={() => open(title, subtitle, lines())}
      />
    );
    return (
      <>
        {hasPlan && (
          <>
            <td className={cn(TD, NUM, EDGE, "text-muted-foreground")}>
              {value(row.planTotal, `${label}: previsto`, totalLabel, () =>
                every(planAt).filter((l) => l.date <= today),
              )}
            </td>
            <td className={cn(TD, NUM)}>
              {value(row.total, label, totalLabel, () => every(at))}
            </td>
            <td
              className={cn(
                TD,
                NUM,
                isUnfavorable(s.type, deviation) && tone(-1),
              )}
            >
              {deviation === 0 ? (
                <span className="text-muted-foreground/60">—</span>
              ) : (
                signed(deviation)
              )}
              <span className="ml-1.5 inline-block min-w-14 text-xs text-muted-foreground">
                {formatPercent(variation(row.total, row.planTotal), true)}
              </span>
            </td>
          </>
        )}
        {buckets.map((b, i) =>
          hasPlan ? (
            <PairCells
              key={b.key}
              plan={value(row.plan[i], `${label}: previsto`, b.label, () =>
                planAt(i),
              )}
              real={value(row.values[i], label, b.label, () => at(i))}
            />
          ) : (
            <td key={b.key} className={cn(TD, NUM)}>
              {value(row.values[i], label, b.label, () => at(i))}
            </td>
          ),
        )}
        {!hasPlan && (
          <>
            <td className={cn(TD, NUM, EDGE, "font-semibold")}>
              {value(row.total, label, totalLabel, () => every(at))}
            </td>
            {matrix.hasPrevious && (
              <>
                <td className={cn(TD, NUM, EDGE, "text-muted-foreground")}>
                  {row.previous ? plain(row.previous) : "—"}
                </td>
                <td className={cn(TD, NUM, "text-muted-foreground")}>
                  {formatPercent(variation(row.total, row.previous), true)}
                </td>
              </>
            )}
          </>
        )}
      </>
    );
  };

  /** Resultado e saldos: contas da matriz, sem lançamentos por baixo. */
  const balanceRow = (
    label: string,
    values: number[],
    total: number | null,
    extra?: { plan: number[]; planTotal: number; previous: number },
    strong = true,
  ) => (
    <tr
      className={cn(
        "border-b border-border/60",
        strong ? "bg-muted font-semibold" : "text-muted-foreground",
      )}
    >
      <th
        scope="row"
        className={cn(
          TD,
          STICKY,
          "text-left",
          strong ? "bg-muted font-semibold" : "font-normal",
        )}
      >
        {label}
      </th>
      {hasPlan && extra && (
        <>
          <td className={cn(TD, NUM, EDGE, "text-muted-foreground")}>
            {plain(extra.planTotal)}
          </td>
          <td className={cn(TD, NUM, tone(total ?? 0))}>{plain(total ?? 0)}</td>
          <td className={cn(TD, NUM)}>
            {signed(currency(total ?? 0).subtract(extra.planTotal).value)}
            <span className="ml-1.5 inline-block min-w-14" />
          </td>
        </>
      )}
      {buckets.map((b, i) =>
        hasPlan ? (
          <PairCells
            key={b.key}
            plan={extra ? plain(extra.plan[i]) : ""}
            real={<span className={tone(values[i])}>{plain(values[i])}</span>}
          />
        ) : (
          <td key={b.key} className={cn(TD, NUM, tone(values[i]))}>
            {plain(values[i])}
          </td>
        ),
      )}
      {!(hasPlan && extra) && (
        <>
          <td className={cn(TD, NUM, EDGE, total !== null && tone(total))}>
            {total === null ? "" : plain(total)}
          </td>
          {matrix.hasPrevious && (
            <>
              <td className={cn(TD, NUM, EDGE, "text-muted-foreground")}>
                {extra ? plain(extra.previous) : ""}
              </td>
              <td />
            </>
          )}
        </>
      )}
    </tr>
  );

  const openings = matrix.closing
    ? [matrix.opening, ...matrix.closing.slice(0, -1)]
    : null;
  const diff = (a: number, b: number) => currency(a).subtract(b).value;

  return (
    <div className="space-y-2">
      {parents.length > 0 && (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setClosed(new Set())}
          >
            Abrir tudo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setClosed(new Set(parents))}
          >
            Fechar tudo
          </Button>
        </div>
      )}
      <div className={SCROLL}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Fluxo de caixa por {MATRIX_ROWS[matrix.rows].toLowerCase()}, valores
            em reais
          </caption>
          <thead className={HEAD}>
            <tr className="border-b text-left">
              <th
                scope="col"
                rowSpan={hasPlan ? 2 : 1}
                className={cn(TH, STICKY, "z-20 min-w-[16rem] bg-muted")}
              >
                {MATRIX_ROWS[matrix.rows]}
                <span className="ml-1 font-normal">(R$)</span>
              </th>
              {hasPlan && (
                <th
                  scope="col"
                  colSpan={3}
                  className={cn(TH, EDGE, "text-center text-foreground")}
                >
                  {totalLabel}
                </th>
              )}
              {buckets.map((b) => (
                <th
                  key={b.key}
                  scope="col"
                  colSpan={hasPlan ? 2 : 1}
                  className={cn(
                    TH,
                    "capitalize",
                    hasPlan ? cn("text-center", EDGE) : "text-right",
                  )}
                >
                  {b.label.replace(" a ", " – ")}
                </th>
              ))}
              {!hasPlan && (
                <th scope="col" className={cn(TH, EDGE, "text-right")}>
                  {totalLabel}
                </th>
              )}
              {!hasPlan && matrix.hasPrevious && (
                <>
                  <th scope="col" className={cn(TH, EDGE, "text-right")}>
                    Anterior
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    Variação
                  </th>
                </>
              )}
            </tr>
            {hasPlan && (
              <tr className="border-b text-right">
                <th scope="col" className={cn(TH, EDGE, "text-right")}>
                  Previsto
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Realizado
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Desvio
                </th>
                {buckets.map((b) => (
                  <PairHeads key={b.key} />
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {!hasPlan &&
              openings &&
              balanceRow(
                "Saldo inicial",
                openings,
                matrix.opening,
                undefined,
                false,
              )}
            {sections.map((s) => {
              const name = s.type === "receivable" ? "Entradas" : "Saídas";
              const { rows, more } = visible(s);
              return [
                <tr
                  key={s.type}
                  className="border-b border-border/60 bg-muted font-semibold"
                >
                  <th
                    scope="row"
                    className={cn(
                      TD,
                      STICKY,
                      "bg-muted text-left font-semibold",
                    )}
                  >
                    {name}
                  </th>
                  {cells(s, s, name)}
                </tr>,
                ...rows.map((n) => (
                  <tr
                    key={keyIn(s, n)}
                    className="group/row border-b border-border/60 hover:bg-muted/60"
                  >
                    <th
                      scope="row"
                      className={cn(
                        TD,
                        STICKY,
                        "max-w-[22rem] text-left font-normal",
                      )}
                      style={{ paddingLeft: `${0.75 + n.depth * 1}rem` }}
                    >
                      {n.hasChildren ? (
                        <button
                          type="button"
                          aria-expanded={!closed.has(keyIn(s, n))}
                          onClick={() => setClosed(flip(closed, keyIn(s, n)))}
                          className="-ml-1 flex max-w-full items-center gap-1 rounded-sm pr-1 text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                              !closed.has(keyIn(s, n)) && "rotate-90",
                            )}
                          />
                          <span className="truncate" title={n.label}>
                            {n.label}
                          </span>
                        </button>
                      ) : (
                        <span className="block truncate pl-3.5" title={n.label}>
                          {n.label}
                        </span>
                      )}
                    </th>
                    {cells(n, s, n.label)}
                  </tr>
                )),
                more > 0 && (
                  <tr
                    key={`${s.type}-more`}
                    className="border-b border-border/60"
                  >
                    <td colSpan={columns} className="px-3 py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="sticky left-3 h-7 text-xs"
                        onClick={() => setShowAll(flip(showAll, s.type))}
                      >
                        Mostrar mais {more}
                      </Button>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
          <tbody>
            {balanceRow("Resultado", matrix.net, matrix.netTotal, {
              plan: buckets.map((_, i) =>
                diff(matrix.inflow.plan[i], matrix.outflow.plan[i]),
              ),
              planTotal: diff(
                matrix.inflow.planTotal,
                matrix.outflow.planTotal,
              ),
              previous: diff(matrix.inflow.previous, matrix.outflow.previous),
            })}
            {!hasPlan &&
              matrix.closing &&
              balanceRow(
                "Saldo final",
                matrix.closing,
                matrix.closing.at(-1) ?? matrix.opening,
              )}
          </tbody>
        </table>
      </div>
      {hasPlan && (
        <p className="text-xs text-muted-foreground">
          Previsto: o valor com que o lançamento nasceu, no vencimento, mesmo
          que depois tenha sido rejeitado ou siga em rascunho. Realizado: o que
          foi pago ou recebido, na data da baixa. Desvio: realizado menos
          previsto
          {closedPeriod
            ? "."
            : `, contando só o que venceu até ${format(today, "dd/MM")}.`}{" "}
          Vermelho quando entrou menos ou saiu mais.
        </p>
      )}
      {matrix.rows === "bank" && (
        <p className="text-xs text-muted-foreground">
          A conta bancária vem da conciliação: o que ainda não passou por ela
          aparece sem conta.
        </p>
      )}
    </div>
  );
}

function PairCells({
  plan,
  real,
}: {
  plan: React.ReactNode;
  real: React.ReactNode;
}) {
  return (
    <>
      <td className={cn(TD, NUM, EDGE, "font-normal text-muted-foreground")}>
        {plan}
      </td>
      <td className={cn(TD, NUM)}>{real}</td>
    </>
  );
}

function PairHeads() {
  return (
    <>
      <th scope="col" className={cn(TH, EDGE, "text-right font-normal")}>
        Previsto
      </th>
      <th scope="col" className={cn(TH, "text-right")}>
        Realizado
      </th>
    </>
  );
}
