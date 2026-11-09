"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  compositionLevel,
  compositionTitle,
  defaultCompositionMode,
  hasMovement,
  tidyName,
  type AnalyticsReport,
  type CompositionMode,
  type CompositionNode,
  type Side,
} from "@/lib/analytics";
import { variation } from "@/lib/reports";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/features/dashboard/Segmented";
import {
  pct,
  RankedBars,
  rankShade,
  Section,
  SIDE_COLOR,
  SIDE_LABEL,
  ThinSplitBar,
  VIZ,
  type RankedItem,
} from "./primitives";

type Mode = CompositionMode;
const VISIBLE = 12;
const SWATCHES = 5;
const ALL = "__all__";

export function CompositionSection({ report }: { report: AnalyticsReport }) {
  const [mode, setMode] = useState<Mode>(() => defaultCompositionMode(report));
  const [sideChoice, setSide] = useState<Side>("payable");
  const [path, setPath] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);

  // Receita credita sempre o centro raiz: por centro, só despesa diz algo.
  const side: Side = mode === "costCenters" ? "payable" : sideChoice;
  const comp = mode === "accounts" ? report.accounts : report.costCenters;
  const level = useMemo(
    () => compositionLevel(comp, side, path),
    [comp, side, path],
  );
  const {
    byId,
    hasChildren,
    trail,
    parent,
    parentNode,
    kids,
    unassigned,
    unassignedCompare,
    total,
  } = level;
  const color = SIDE_COLOR[side];
  const nameOf = (n: CompositionNode) =>
    mode === "accounts" ? `${n.code} ${tidyName(n.name)}` : tidyName(n.name);
  const looseLabel =
    mode === "accounts" ? "Sem conta contábil" : "Sem centro de custo";

  const comparing = hasMovement(report.compareTotals);
  const delta = (value: number, compare: number) => {
    if (!comparing) return undefined;
    if (!compare) return value ? "novo" : undefined;
    const v = variation(value, compare);
    return v === null ? undefined : `${v > 0 ? "+" : ""}${pct(v)}`;
  };

  const items: RankedItem[] = [
    ...kids.map((k, i) => ({
      key: k.id,
      label: nameOf(k),
      sublabel: mode === "costCenters" ? k.code : undefined,
      value: k.value[side],
      swatch: i < SWATCHES ? rankShade(color, i) : VIZ.context,
      aside: (
        <>
          {total ? pct(k.value[side] / total) : "—"}
          {delta(k.value[side], k.compare[side]) && (
            <span className="ml-1.5">
              {delta(k.value[side], k.compare[side])}
            </span>
          )}
        </>
      ),
      onClick: hasChildren(k.id)
        ? () => {
            setPath([...trail, k.id]);
            setShowAll(false);
          }
        : undefined,
      actionLabel: hasChildren(k.id) ? `Abrir ${nameOf(k)}` : undefined,
    })),
    ...(unassigned > 0
      ? [
          {
            key: "loose",
            label: looseLabel,
            value: unassigned,
            muted: true,
            swatch: VIZ.context,
            aside: (
              <>
                {pct(unassigned / total)}
                {delta(unassigned, unassignedCompare) && (
                  <span className="ml-1.5">
                    {delta(unassigned, unassignedCompare)}
                  </span>
                )}
              </>
            ),
          },
        ]
      : []),
  ];
  const shown = showAll ? items : items.slice(0, VISIBLE);

  const parts = [
    ...kids.slice(0, SWATCHES).map((k, i) => ({
      key: k.id,
      name: nameOf(k),
      value: k.value[side],
      color: rankShade(color, i),
    })),
    {
      key: "rest",
      name: "Demais",
      value:
        kids.slice(SWATCHES).reduce((s, k) => s + k.value[side], 0) +
        Math.max(0, unassigned),
      color: VIZ.context,
    },
  ];

  // Filtro direto: qualquer nó que se abre em outros.
  const filterOptions = comp.nodes
    .filter((n) => n.value[side] > 0 && hasChildren(n.id))
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  const depthOf = (n: CompositionNode) => {
    let d = 0;
    for (let p = n.parentId; p && d < 10; p = byId.get(p)?.parentId ?? null)
      d++;
    return d;
  };
  const chainOf = (id: string) => {
    const chain: string[] = [];
    for (
      let cur: string | null = id;
      cur && chain.length < 10;
      cur = byId.get(cur)?.parentId ?? null
    )
      chain.unshift(cur);
    return chain;
  };

  const sideWord = SIDE_LABEL[side].toLowerCase();
  const title = compositionTitle(level, side, mode);

  const coverageNote =
    comp.coverage < 0.95
      ? mode === "accounts"
        ? `Só ${pct(comp.coverage)} do movimento tem conta do plano de contas, obrigatório a partir do exercício definido em Plano de Contas.`
        : `Só ${pct(comp.coverage)} do movimento tem centro de custo.`
      : null;

  return (
    <Section
      id="composicao"
      kicker="Composição"
      title={title}
      description="Do maior para o menor, um nível por vez. Clique numa linha com subníveis para abrir; a trilha volta."
      actions={
        <>
          <Segmented
            label="Agrupar por"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setPath([]);
              setShowAll(false);
            }}
            options={[
              { value: "accounts", label: "Plano de contas" },
              { value: "costCenters", label: "Centros de custo" },
            ]}
          />
          {mode === "accounts" && (
            <Segmented
              label="Lado"
              value={sideChoice}
              onChange={(v) => {
                setSide(v);
                setPath([]);
                setShowAll(false);
              }}
              options={[
                { value: "payable", label: "Despesas" },
                { value: "receivable", label: "Receitas" },
              ]}
            />
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Nível"
          className="flex min-w-0 flex-wrap items-center gap-1 text-sm"
        >
          <button
            type="button"
            onClick={() => setPath([])}
            className="rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Todas as {sideWord}
          </button>
          {trail.map((id, i) => {
            const n = byId.get(id)!;
            const last = i === trail.length - 1;
            return (
              <span key={id} className="flex items-center gap-1">
                <ChevronRight
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
                {last ? (
                  <span aria-current="page" className="font-medium">
                    {n.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPath(trail.slice(0, i + 1))}
                    className="rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {n.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        {filterOptions.length > 0 && (
          <Select
            value={parent ?? ALL}
            onValueChange={(v) => {
              setPath(v === ALL ? [] : chainOf(v));
              setShowAll(false);
            }}
          >
            <SelectTrigger
              className="h-8 w-[260px] text-xs"
              aria-label="Filtrar por conta ou centro"
            >
              <SelectValue placeholder="Filtrar por…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as {sideWord}</SelectItem>
              {filterOptions.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  <span style={{ paddingLeft: depthOf(n) * 12 }}>
                    {nameOf(n)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {total ? (
        <>
          <div className="mt-4">
            <ThinSplitBar
              parts={parts}
              label={`Divisão das ${sideWord}${parentNode ? ` de ${parentNode.name}` : ""}`}
            />
          </div>
          <div className="mt-3">
            <RankedBars items={shown} color={color} />
          </div>
          {items.length > VISIBLE && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-8 text-xs"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Mostrar menos" : `Mostrar todos (${items.length})`}
            </Button>
          )}
          {comparing && (
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              À direita: participação no nível e variação sobre o período de
              comparação.
            </p>
          )}
        </>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          Nenhum lançamento de {sideWord} no período, no regime escolhido.
        </p>
      )}

      {coverageNote && (
        <p className="mt-4 text-xs text-muted-foreground text-pretty">
          {coverageNote}{" "}
          {mode === "accounts" && (
            <Link
              href="/busca?q=sem%3Aconta"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Ver lançamentos sem conta
            </Link>
          )}
        </p>
      )}
    </Section>
  );
}
