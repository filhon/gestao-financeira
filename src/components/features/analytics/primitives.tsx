"use client";

import { useState, type ReactNode } from "react";
import { Table2, ChartColumn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import type { Side } from "@/lib/analytics";
export { signedMoney } from "@/lib/analytics";

/** Cores por papel (globals.css, validadas nos dois temas). */
export const VIZ = {
  in: "var(--viz-in)",
  out: "var(--viz-out)",
  extra: "var(--viz-extra)",
  context: "var(--viz-context)",
  step: "var(--viz-step)",
  grid: "var(--viz-grid)",
  axis: "var(--muted-foreground)",
} as const;

export const SIDE_COLOR: Record<Side, string> = {
  receivable: VIZ.in,
  payable: VIZ.out,
};
export const SIDE_LABEL: Record<Side, string> = {
  receivable: "Receitas",
  payable: "Despesas",
};

export const money = formatCurrencyAbbr;
export const fullMoney = formatCurrency;

export const pct = (ratio: number, digits = 0) =>
  ratio.toLocaleString("pt-BR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Eixo: "R$ 0", "R$ 500 mil", "R$ 1,5 mi". */
export const axisMoney = (v: number) =>
  v === 0
    ? "R$ 0"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);

export const AXIS_PROPS = {
  stroke: VIZ.axis,
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

// ─── Seção ────────────────────────────────────────────────────────────────────

/**
 * Bloco da leitura contínua. O título afirma a conclusão do bloco (estilo
 * FT): o diretor lê a frase e decide se precisa olhar o gráfico.
 */
export function Section({
  id,
  kicker,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  kicker: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-t pt-8"
    >
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <p className="text-xs font-medium text-muted-foreground">{kicker}</p>
          <h2
            id={`${id}-title`}
            className="mt-1 text-lg font-semibold tracking-tight text-balance md:text-xl"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {children}
    </section>
  );
}

// ─── Quadro de gráfico com tabela ─────────────────────────────────────────────

export interface FrameTable {
  columns: string[];
  rows: (string | number)[][];
  /** Colunas numéricas (alinhadas à direita). Padrão: todas menos a primeira. */
  numeric?: number[];
}

/**
 * Todo gráfico tem a versão em tabela: quem não distingue as cores, lê por
 * leitor de tela ou quer o número exato chega no mesmo dado.
 */
export function ChartFrame({
  title,
  label,
  legend,
  table,
  height = 280,
  note,
  children,
  className,
}: {
  title?: ReactNode;
  /** Descrição do gráfico para leitor de tela. */
  label: string;
  legend?: ReactNode;
  table: FrameTable;
  height?: number;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const numeric =
    table.numeric ?? table.columns.map((_, i) => i).filter((i) => i > 0);
  return (
    <figure className={cn("min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          {title && (
            <figcaption className="text-sm font-medium">{title}</figcaption>
          )}
          {!asTable && legend}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? (
            <ChartColumn className="mr-1 h-3.5 w-3.5" aria-hidden />
          ) : (
            <Table2 className="mr-1 h-3.5 w-3.5" aria-hidden />
          )}
          {asTable ? "Ver gráfico" : "Ver tabela"}
        </Button>
      </div>
      {asTable ? (
        <div className="max-h-[420px] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-xs font-medium text-muted-foreground",
                      numeric.includes(i) ? "text-right" : "text-left",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-3 py-1.5",
                        numeric.includes(i)
                          ? "text-right font-financial"
                          : "text-left",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={label} style={{ height }}>
          {children}
        </div>
      )}
      {note && (
        <p className="mt-2 text-[13px] text-muted-foreground text-pretty">
          {note}
        </p>
      )}
    </figure>
  );
}

// ─── Legenda e dica ───────────────────────────────────────────────────────────

export function Legend({
  items,
}: {
  items: { label: string; color: string; shape?: "bar" | "line" | "tick" }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "inline-block shrink-0",
              it.shape === "line"
                ? "h-0.5 w-3.5 rounded-full"
                : it.shape === "tick"
                  ? "h-0.5 w-3.5"
                  : "h-2.5 w-2.5 rounded-[3px]",
            )}
            style={{ background: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function TooltipBox({
  title,
  rows,
  footer,
}: {
  title: ReactNode;
  rows: { label: string; value: string; color?: string }[];
  footer?: ReactNode;
}) {
  return (
    <div className="min-w-48 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
      <p className="mb-2 text-sm font-medium">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-4 text-xs"
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && (
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-[2px]"
                  style={{ background: r.color }}
                />
              )}
              {r.label}
            </span>
            <span className="font-financial font-medium">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && (
        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── Barras ordenadas ─────────────────────────────────────────────────────────

export interface RankedItem {
  key: string;
  label: ReactNode;
  sublabel?: ReactNode;
  value: number;
  /** Texto à direita do valor (participação, variação). */
  aside?: ReactNode;
  /** Barra em cinza (sem conta, outros). */
  muted?: boolean;
  /** Amostra de cor ligando a linha a um trecho da barra segmentada. */
  swatch?: string;
  /** Cor própria da barra (rampa de atraso). */
  barColor?: string;
  onClick?: () => void;
  actionLabel?: string;
}

/**
 * Barras horizontais do maior ao menor numa escala só: comparam com mais
 * exatidão que fatias de pizza, e o nome cabe inteiro.
 */
export function RankedBars({
  items,
  color,
  max,
}: {
  items: RankedItem[];
  color: string;
  max?: number;
}) {
  const top = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="divide-y">
      {items.map((it) => {
        const width = `${Math.max(0, (Math.abs(it.value) / top) * 100)}%`;
        const body = (
          <>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {it.swatch && (
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: it.swatch }}
                  />
                )}
                <span
                  className="truncate text-sm"
                  title={typeof it.label === "string" ? it.label : undefined}
                >
                  {it.label}
                </span>
                {it.sublabel && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {it.sublabel}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="font-financial text-sm font-medium">
                  {money(it.value)}
                </span>
                {it.aside && (
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    {it.aside}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full">
              <div
                className="h-2 rounded-r-lg"
                style={{
                  width,
                  background: it.barColor ?? (it.muted ? VIZ.context : color),
                }}
              />
            </div>
          </>
        );
        return (
          <li key={it.key}>
            {it.onClick ? (
              <button
                type="button"
                onClick={it.onClick}
                aria-label={it.actionLabel}
                className="block w-full rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {body}
              </button>
            ) : (
              <div className="px-2 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Barra fina de partes de um todo, sem texto: a lista ao lado carrega os
 * números, e a amostra de cor em cada linha liga a linha ao trecho.
 */
export function ThinSplitBar({
  parts,
  label,
}: {
  parts: { key: string; value: number; color: string; name: string }[];
  label: string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (!total) return null;
  return (
    <div
      role="img"
      aria-label={`${label}: ${parts
        .filter((p) => p.value > 0)
        .map((p) => `${p.name} ${pct(p.value / total)}`)
        .join(", ")}`}
      className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
    >
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            title={`${p.name}: ${pct(p.value / total, 1)}`}
            style={{
              width: `${(p.value / total) * 100}%`,
              background: p.color,
            }}
          />
        ))}
    </div>
  );
}

/** Tons de um matiz só para as partes, na ordem do ranking. */
export const rankShade = (color: string, i: number) =>
  `color-mix(in oklch, ${color} ${[100, 78, 60, 45, 34][i] ?? 34}%, var(--card))`;
