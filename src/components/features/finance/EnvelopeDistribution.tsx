"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import currency from "currency.js";
import { ChevronRight, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostCenter, CostCenterBalance } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import {
  buildCostCenterTree,
  costCenterLedgerService,
} from "@/lib/services/costCenterLedgerService";
import { formatCurrency } from "@/lib/utils";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";

const add = (a: number, b: number) => currency(a).add(b).value;
const subtract = (a: number, ...rest: number[]) =>
  rest.reduce((acc, v) => acc.subtract(v), currency(a)).value;

/** Tolerância de um centavo, para não sinalizar ruído de arredondamento. */
const isNegative = (v: number) => v < -0.005;
const isZero = (v: number) => Math.abs(v) <= 0.005;

// Todas as colunas crescem, não só a de nome. Com largura fixa nas numéricas,
// o espaço extra de um monitor largo se acumulava num vão único entre o centro
// de custo e seus valores; repartido em frações, ele some.
const GRID =
  "grid grid-cols-[minmax(220px,2.2fr)_minmax(170px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(150px,1fr)] items-center gap-x-5";

interface Row {
  cc: CostCenter;
  depth: number;
  hasChildren: boolean;
  /** Último filho do seu pai: a guia vertical para no meio da linha. */
  isLast: boolean;
  /** Por nível ancestral, se aquele ramo ainda continua abaixo desta linha. */
  guides: boolean[];
}

/** Achata a árvore na ordem de leitura. O raiz fica de fora: ele é o caixa. */
function flatten(tree: ReturnType<typeof buildCostCenterTree>): Row[] {
  const rows: Row[] = [];

  const walk = (id: string, depth: number, guides: boolean[]) => {
    const children = (tree.childrenOf.get(id) || [])
      .slice()
      .sort((a, b) => (a.code || "").localeCompare(b.code || "", "pt-BR"));

    children.forEach((child, i) => {
      const isLast = i === children.length - 1;
      rows.push({
        cc: child,
        depth,
        hasChildren: (tree.childrenOf.get(child.id) || []).length > 0,
        isLast,
        guides,
      });
      walk(child.id, depth + 1, [...guides, !isLast]);
    });
  };

  walk(tree.rootId, 0, []);
  return rows;
}

const INDENT = 22;

/**
 * Guias de hierarquia. Com 22 linhas em três níveis, a indentação sozinha não
 * diz de quem cada folha descende — mas o cotovelo completo de um file tree
 * pesa demais numa tabela financeira. Só as verticais, bem claras.
 */
function TreeGuides({ row }: { row: Row }) {
  if (row.depth === 0) return null;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-4"
      style={{ width: row.depth * INDENT }}
    >
      {row.guides.map(
        (continues, i) =>
          continues && (
            <span
              key={i}
              className="absolute inset-y-0 w-px bg-border"
              style={{ left: i * INDENT + 11 }}
            />
          ),
      )}
      <span
        className="absolute top-0 w-px bg-border"
        style={{
          left: (row.depth - 1) * INDENT + 11,
          height: row.isLast ? "50%" : "100%",
        }}
      />
      <span
        className="absolute h-px w-2 bg-border"
        style={{ left: (row.depth - 1) * INDENT + 11, top: "50%" }}
      />
    </span>
  );
}

// Não há barra de utilização aqui, e a ausência é deliberada. Percentual de
// folga não mede aperto: 15% de um envelope de R$ 4 milhões são R$ 600 mil,
// enquanto 15% de R$ 2 mil são R$ 300. Um gatilho proporcional marcava as duas
// linhas igual e enchia a tabela de traços sem informação. O aperto que importa
// é binário — disponível zerado ou negativo — e já aparece na cor do número.

export function EnvelopeDistribution() {
  const { selectedCompany } = useCompany();
  const { canManageCostCenters } = usePermissions();

  const [year, setYear] = useState(new Date().getFullYear());
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [balances, setBalances] = useState<Record<string, CostCenterBalance>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedCompany) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const ccs = await costCenterService.getAll(selectedCompany.id);
      const bal = await costCenterLedgerService.getBalances(
        selectedCompany.id,
        ccs,
        year,
      );
      setCostCenters(ccs);
      setBalances(bal);
      setDrafts({});
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a distribuição.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, year]);

  useEffect(() => {
    load();
  }, [load]);

  const tree = useMemo(() => {
    if (costCenters.length === 0) return null;
    try {
      return buildCostCenterTree(costCenters);
    } catch {
      return null;
    }
  }, [costCenters]);

  const rows = useMemo(() => (tree ? flatten(tree) : []), [tree]);

  /**
   * Recalcula a árvore com os rascunhos aplicados. É o que faz o saldo do pai
   * responder enquanto o gestor digita, antes de qualquer gravação.
   */
  const projected = useMemo(() => {
    if (!tree) return {};

    const envelopeOf = (id: string) =>
      drafts[id] ?? balances[id]?.received ?? 0;

    const result: Record<
      string,
      { received: number; allocated: number; available: number }
    > = {};

    for (const cc of costCenters) {
      const base = balances[cc.id];
      if (!base) continue;
      const isRoot = cc.id === tree.rootId;
      const children = tree.childrenOf.get(cc.id) || [];
      const allocated = children.reduce(
        (acc, child) => add(acc, envelopeOf(child.id)),
        0,
      );
      const received = isRoot
        ? add(base.received, base.carryIn)
        : envelopeOf(cc.id);

      result[cc.id] = {
        received,
        allocated,
        available: subtract(received, allocated, base.spentDirect),
      };
    }
    return result;
  }, [costCenters, balances, drafts, tree]);

  const hidden = useMemo(() => {
    const set = new Set<string>();
    if (!tree) return set;
    const hide = (id: string) => {
      for (const child of tree.childrenOf.get(id) || []) {
        set.add(child.id);
        hide(child.id);
      }
    };
    collapsed.forEach(hide);
    return set;
  }, [collapsed, tree]);

  const changed = useMemo(
    () =>
      Object.entries(drafts).filter(
        ([id, value]) =>
          Math.abs(subtract(value, balances[id]?.received ?? 0)) > 0.005,
      ),
    [drafts, balances],
  );

  const overdrawn = useMemo(
    () =>
      costCenters.filter((cc) => isNegative(projected[cc.id]?.available ?? 0)),
    [costCenters, projected],
  );

  /** Centros sem nenhuma folga: o que a tela existe para resolver. */
  const tight = useMemo(
    () =>
      rows.filter(
        (row) =>
          !row.hasChildren && isZero(projected[row.cc.id]?.available ?? -1),
      ),
    [rows, projected],
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!selectedCompany || changed.length === 0) return;
    setIsSaving(true);

    // Reduções antes dos aumentos: liberar recurso primeiro evita que uma
    // realocação válida no conjunto seja rejeitada no meio do caminho.
    const ordered = [...changed].sort(
      ([aId, aValue], [bId, bValue]) =>
        subtract(aValue, balances[aId]?.received ?? 0) -
        subtract(bValue, balances[bId]?.received ?? 0),
    );

    let applied = 0;
    try {
      for (const [id, value] of ordered) {
        await costCenterLedgerService.setEnvelope(
          selectedCompany.id,
          id,
          year,
          value,
        );
        applied += 1;
      }
      toast.success(
        applied === 1
          ? "Envelope atualizado."
          : `${applied} envelopes atualizados.`,
      );
    } catch (error) {
      const name =
        costCenters.find((cc) => cc.id === ordered[applied]?.[0])?.name ||
        "centro de custo";
      toast.error(
        `Falha em ${name}: ${error instanceof Error ? error.message : "erro inesperado"}`,
        {
          description:
            applied > 0
              ? `${applied} alteração(ões) anterior(es) foram aplicadas.`
              : undefined,
        },
      );
    } finally {
      setIsSaving(false);
      await load();
    }
  };

  // ── Carregamento e erro ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !tree) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Não foi possível montar a hierarquia</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError ||
                "A distribuição exige exatamente um centro de custo raiz, do qual todos os outros descendem."}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={load}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const rootCc = tree.byId.get(tree.rootId);
  const rootBase = balances[tree.rootId];
  const rootProj = projected[tree.rootId];

  const totalCash = rootProj?.received ?? 0;
  const distributed = rootProj?.allocated ?? 0;
  const free = rootProj?.available ?? 0;
  const usedPct =
    totalCash > 0 ? Math.min((distributed / totalCash) * 100, 100) : 0;

  return (
    <div className="w-full space-y-8 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Distribuição de recursos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todo recurso desce de {rootCc?.name || "Global"}. Um centro de custo
            só gasta o que recebeu.
          </p>
        </div>
        <Select
          value={String(year)}
          onValueChange={(v) => setYear(Number(v))}
          disabled={isSaving}
        >
          <SelectTrigger className="w-[168px]" aria-label="Exercício">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }, (_, i) => year - 2 + i).map((y) => (
              <SelectItem key={y} value={String(y)}>
                Exercício {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {/*
        O raiz não é uma linha da tabela: ele é o caixa de onde tudo desce, e
        nunca se edita. Tratá-lo como cabeçalho resolve a hierarquia e elimina
        a linha com o campo de envelope vazio.
      */}
      <section className="rounded-lg border bg-card px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Livre em {rootCc?.name || "Global"}
            </p>
            <p
              className={`font-financial mt-1 text-3xl font-semibold tabular-nums ${
                isNegative(free)
                  ? "text-destructive"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {formatCurrency(free)}
            </p>
          </div>

          <dl className="flex gap-x-8 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                Caixa do exercício
              </dt>
              <dd className="font-financial mt-0.5 tabular-nums">
                {formatCurrency(totalCash)}
              </dd>
              {rootBase?.carryIn > 0 && (
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  inclui {formatCurrency(rootBase.carryIn)} do ano anterior
                </dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Distribuído</dt>
              <dd className="font-financial mt-0.5 tabular-nums">
                {formatCurrency(distributed)}
              </dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                {usedPct.toFixed(1)}% do caixa
              </dd>
            </div>
          </dl>
        </div>

        {tight.length > 0 && changed.length === 0 && (
          <p className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            />
            {tight.length === 1
              ? `${tight[0].cc.name} está sem folga e não aceita novas despesas.`
              : `${tight.length} centros de custo estão sem folga e não aceitam novas despesas.`}
          </p>
        )}
      </section>

      {/* ── Envelopes: desktop ──────────────────────────────────────────── */}
      <div className="hidden md:block">
        <div
          className={`${GRID} border-b px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground`}
        >
          <div>Centro de custo</div>
          <div className="text-right">Envelope</div>
          <div className="text-right">Aos filhos</div>
          <div className="text-right">Gasto</div>
          <div className="text-right">Disponível</div>
        </div>

        <div className="divide-y divide-border/60">
          {rows
            .filter((row) => !hidden.has(row.cc.id))
            .map((row) => {
              const base = balances[row.cc.id];
              const proj = projected[row.cc.id];
              if (!base || !proj) return null;

              const isCollapsed = collapsed.has(row.cc.id);
              const draft = drafts[row.cc.id];
              const isChanged =
                draft !== undefined &&
                Math.abs(subtract(draft, base.received)) > 0.005;
              const negative = isNegative(proj.available);
              const noSlack = !row.hasChildren && isZero(proj.available);

              return (
                <div
                  key={row.cc.id}
                  className={`${GRID} relative px-4 transition-colors ${
                    row.depth === 0 ? "border-t border-foreground/15" : ""
                  } ${
                    negative
                      ? "bg-destructive/6"
                      : isChanged
                        ? "bg-primary/4"
                        : "hover:bg-muted/50"
                  }`}
                  style={{ minHeight: "3rem" }}
                >
                  {/* As guias vivem na linha, não na célula: presas à célula
                      elas paravam no fim do conteúdo e ficavam picotadas. */}
                  <TreeGuides row={row} />

                  <div
                    className="flex min-w-0 items-center gap-2 py-2"
                    style={{ paddingLeft: `${row.depth * INDENT}px` }}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggle(row.cc.id)}
                        className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!isCollapsed}
                        aria-label={
                          isCollapsed
                            ? `Expandir ${row.cc.name}`
                            : `Recolher ${row.cc.name}`
                        }
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                            isCollapsed ? "" : "rotate-90"
                          }`}
                        />
                      </button>
                    ) : (
                      <span className="-ml-1 w-6 shrink-0" />
                    )}

                    <Link
                      href={`/centros-custo/${row.cc.id}`}
                      className={`truncate text-sm hover:underline ${
                        row.depth === 0 ? "font-semibold" : "font-normal"
                      }`}
                    >
                      {row.cc.name}
                    </Link>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground/70">
                      {row.cc.code}
                    </span>
                  </div>

                  {/* Envelope */}
                  <div className="flex justify-end py-2">
                    {canManageCostCenters ? (
                      <CurrencyInput
                        value={draft ?? base.received}
                        onChange={(v) =>
                          setDrafts((prev) => ({ ...prev, [row.cc.id]: v }))
                        }
                        disabled={isSaving}
                        aria-label={`Envelope de ${row.cc.name}`}
                        className={`font-financial h-8 rounded-md bg-background px-2 text-right text-sm tabular-nums transition-colors ${
                          isChanged
                            ? "border-primary/70 ring-1 ring-primary/20"
                            : "border-input"
                        }`}
                      />
                    ) : (
                      <span className="font-financial text-sm tabular-nums">
                        {formatCurrency(base.received)}
                      </span>
                    )}
                  </div>

                  <div className="font-financial py-2 text-right text-sm tabular-nums text-muted-foreground">
                    {proj.allocated > 0 ? formatCurrency(proj.allocated) : ""}
                  </div>

                  <div className="font-financial py-2 text-right text-sm tabular-nums text-muted-foreground">
                    {base.spentDirect > 0
                      ? formatCurrency(base.spentDirect)
                      : ""}
                  </div>

                  {/* Disponível: o dado que dirige a decisão. */}
                  <div className="flex items-center justify-end gap-1.5 py-2">
                    {noSlack && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                      />
                    )}
                    <span
                      className={`font-financial text-sm font-medium tabular-nums ${
                        negative
                          ? "text-destructive"
                          : noSlack
                            ? "text-amber-700 dark:text-amber-500"
                            : "text-foreground"
                      }`}
                    >
                      {formatCurrency(proj.available)}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ── Leitura: mobile ─────────────────────────────────────────────── */}
      <div className="md:hidden">
        <p className="pb-3 text-xs text-muted-foreground">
          A distribuição de recursos é feita no desktop.
        </p>
        <div className="divide-y divide-border/60 border-y">
          {rows.map((row) => {
            const proj = projected[row.cc.id];
            if (!proj) return null;
            const negative = isNegative(proj.available);
            const noSlack = !row.hasChildren && isZero(proj.available);
            return (
              <div
                key={row.cc.id}
                className="py-3"
                style={{ paddingLeft: `${row.depth * 14}px` }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`truncate text-sm ${row.depth === 0 ? "font-semibold" : ""}`}
                  >
                    {row.cc.name}
                  </span>
                  <span
                    className={`font-financial shrink-0 text-sm font-medium tabular-nums ${
                      negative
                        ? "text-destructive"
                        : noSlack
                          ? "text-amber-700 dark:text-amber-500"
                          : ""
                    }`}
                  >
                    {formatCurrency(proj.available)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  livre de {formatCurrency(proj.received)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Barra de commit ─────────────────────────────────────────────── */}
      {changed.length > 0 && (
        <div className="sticky bottom-4 z-10 rounded-lg border bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-card/85">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {overdrawn.length > 0 ? (
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  {overdrawn.length === 1
                    ? `${overdrawn[0].name} ficaria com ${formatCurrency(projected[overdrawn[0].id].available)}`
                    : `${overdrawn.length} centros de custo ficariam negativos`}
                </p>
              ) : (
                <p className="text-sm font-medium">
                  {changed.length === 1
                    ? "1 envelope alterado"
                    : `${changed.length} envelopes alterados`}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {overdrawn.length > 0
                  ? "Reduza a alocação ou aumente o envelope do centro de custo pai."
                  : `Livre em ${rootCc?.name || "Global"} após aplicar: ${formatCurrency(free)}`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrafts({})}
                disabled={isSaving}
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={apply}
                disabled={isSaving || overdrawn.length > 0}
                loading={isSaving}
              >
                Aplicar distribuição
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
