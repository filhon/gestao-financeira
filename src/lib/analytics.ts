/**
 * Regras da Análise (BI da diretoria). Sem Firebase: a rota que monta o
 * relatório, a tela, o PDF e `npm run check:analytics` usam as mesmas contas.
 *
 * Valor, data efetiva e mês de cada lançamento vêm de `chartOfAccounts` e
 * `reports`, os mesmos da DRE e do fluxo de caixa: a Análise nunca discorda
 * dos Relatórios sobre o que entrou num mês.
 *
 * O relatório só carrega números e textos (chaves "yyyy-MM"), nada de Date,
 * para atravessar a rota em JSON sem conversão.
 */
import currency from "currency.js";
import {
  addMonths,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ChartAccount, CostCenter, Entity, Transaction } from "./types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { dreAmount, dreMonth, type DreRegime } from "./chartOfAccounts";
import { flowAmount, stageOf } from "./reports";

export type Side = "receivable" | "payable";
export const SIDES: Side[] = ["receivable", "payable"];

const add = (a: number, b: number) => currency(a).add(b).value;
const sub = (a: number, b: number) => currency(a).subtract(b).value;
const monthKey = (d: Date) => format(d, "yyyy-MM");
const monthLabel = (key: string) =>
  format(new Date(`${key}-01T12:00:00`), "MMM/yy", { locale: ptBR });
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export interface MonthRange {
  /** Primeiro mês, "yyyy-MM". */
  from: string;
  /** Último mês, "yyyy-MM" (inclusive). */
  to: string;
}

export const rangeStart = (r: MonthRange) =>
  startOfMonth(new Date(`${r.from}-01T12:00:00`));
export const rangeEnd = (r: MonthRange) =>
  endOfMonth(new Date(`${r.to}-01T12:00:00`));
export const monthsOf = (r: MonthRange) =>
  eachMonthOfInterval({ start: rangeStart(r), end: rangeEnd(r) }).map(monthKey);
const inRange = (key: string | null, r: MonthRange) =>
  key !== null && key >= r.from && key <= r.to;

/** Mesmo número de meses imediatamente antes, ou os mesmos meses um ano antes. */
export function compareRange(
  r: MonthRange,
  mode: "previous" | "year",
): MonthRange {
  const start = rangeStart(r);
  const months = monthsOf(r).length;
  const shift = mode === "year" ? 12 : months;
  return {
    from: monthKey(subMonths(start, shift)),
    to: monthKey(subMonths(start, shift - months + 1)),
  };
}

// ─── Previsto → Revisado → Realizado ──────────────────────────────────────────

/** "Doação da Mantenedora - abril de 2026 (2/3)" → base e posição. */
const PART_RE = /\s*\((\d+)\s*\/\s*(\d+)\)\s*$/;

const groupKey = (t: Transaction) => {
  if (!PART_RE.test(t.description ?? "")) return null;
  const base = (t.description ?? "")
    .replace(PART_RE, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return [t.type, t.entityId ?? t.supplierOrClient ?? "", base].join("|");
};

export interface PlanRole {
  /** Parte criada depois da previsão: desdobra um valor já previsto. */
  split: boolean;
  /** Mês em que o lançamento conta para a previsão. */
  month: string;
}

/**
 * Papel de cada lançamento na previsão.
 *
 * Quem divide um recebimento cria as partes à mão: edita a original para
 * "(1/3)" com o primeiro valor e lança "(2/3)" e "(3/3)" depois. Contar essas
 * partes como previsão nova dobraria o mês. Num grupo de partes (mesma
 * descrição sem o "(n/m)", tipo e entidade), só o que nasceu no primeiro dia
 * do grupo é previsão; o que nasceu depois é desdobramento: entra como revisão,
 * no mês da parte prevista que ele divide. Parcelamento lançado de uma vez
 * nasce todo no mesmo dia e segue parcela a parcela.
 */
export function planRoles(transactions: Transaction[]) {
  const roles = new Map<string, PlanRole>();
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    roles.set(t.id, { split: false, month: monthKey(t.dueDate) });
    const key = groupKey(t);
    if (!key || !t.createdAt) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const members of groups.values()) {
    const firstDay = members.map((m) => dayKey(m.createdAt)).sort()[0];
    const planned = members
      .filter((m) => dayKey(m.createdAt) === firstDay)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    for (const m of members) {
      if (dayKey(m.createdAt) === firstDay) continue;
      // A parte prevista que ela divide: a última que vence até ela.
      const origin =
        [...planned].reverse().find((p) => p.dueDate <= m.dueDate) ??
        planned[0];
      roles.set(m.id, { split: true, month: monthKey(origin.dueDate) });
    }
  }
  return roles;
}

/** Previsão do lançamento: o valor com que nasceu, salvo as exceções. */
export function plannedOf(t: Transaction, role?: PlanRole) {
  if (role?.split || t.unplanned) return 0;
  return t.plannedAmount ?? t.amount;
}

/** Valor revisado: o atual, ou o ajustado pelo aprovador do lote. */
export const revisedOf = (t: Transaction) =>
  t.status === "rejected" ? 0 : (t.batchAdjustedAmount ?? t.amount);

const isRealized = (t: Transaction) => stageOf(t) === "realized";

export interface PlanBridge {
  planned: number;
  /** Mudanças de valor depois de previsto, inclusive partes desdobradas. */
  revisions: number;
  /** Nasceu já pago ou depois do vencimento. */
  unplanned: number;
  /** Previsto e rejeitado. */
  cancelled: number;
  /** Pago − revisado: desconto, juros, glosa na baixa. */
  settlement: number;
  /** Ainda sem baixa e já vencido. */
  openOverdue: number;
  /** Ainda sem baixa, a vencer. */
  openFuture: number;
  realized: number;
}

export interface PlanMonth {
  key: string;
  label: string;
  planned: number;
  revised: number;
  realized: number;
}

export interface PlanDeviation {
  /** Lançamento que abre o detalhe (a parte prevista, quando há partes). */
  id: string;
  description: string;
  counterpart: string;
  month: string;
  planned: number;
  revised: number;
  realized: number;
  open: number;
  /** realizado + em aberto − previsto. */
  deviation: number;
  parts: number;
}

export interface PlanSide {
  bridge: PlanBridge;
  months: PlanMonth[];
  deviations: PlanDeviation[];
  /** Quanto da previsão tem origem conhecida (criação ou auditoria). */
  history: { known: number; total: number; knownShare: number };
}

const emptyBridge = (): PlanBridge => ({
  planned: 0,
  revisions: 0,
  unplanned: 0,
  cancelled: 0,
  settlement: 0,
  openOverdue: 0,
  openFuture: 0,
  realized: 0,
});

/**
 * A ponte fecha por construção: previsto + revisões + não previstos −
 * cancelados + diferença na baixa − em aberto = realizado.
 */
export const bridgeCloses = (b: PlanBridge) =>
  currency(b.planned)
    .add(b.revisions)
    .add(b.unplanned)
    .subtract(b.cancelled)
    .add(b.settlement)
    .subtract(b.openOverdue)
    .subtract(b.openFuture).value === b.realized;

export function buildPlan(
  transactions: Transaction[],
  range: MonthRange,
  today: Date,
  nameOf: (t: Transaction) => string,
): Record<Side, PlanSide> {
  const roles = planRoles(transactions);
  const months = monthsOf(range);
  const todayStart = startOfDay(today);
  const out = {} as Record<Side, PlanSide>;

  for (const side of SIDES) {
    const bridge = emptyBridge();
    const perMonth = new Map(
      months.map((key) => [
        key,
        { key, label: monthLabel(key), planned: 0, revised: 0, realized: 0 },
      ]),
    );
    const groups = new Map<string, PlanDeviation>();
    let known = 0;
    let total = 0;

    for (const t of transactions) {
      if (t.type !== side) continue;
      const role = roles.get(t.id)!;
      if (!inRange(role.month, range)) continue;

      const planned = plannedOf(t, role);
      const rejected = t.status === "rejected";
      const revised = revisedOf(t);
      const realized = isRealized(t) ? flowAmount(t) : 0;
      const open = !rejected && !isRealized(t) ? revised : 0;

      bridge.planned = add(bridge.planned, planned);
      if (rejected) {
        bridge.cancelled = add(bridge.cancelled, planned);
      } else if (t.unplanned && !role.split) {
        bridge.unplanned = add(bridge.unplanned, revised);
      } else {
        bridge.revisions = add(bridge.revisions, sub(revised, planned));
      }
      if (isRealized(t)) {
        bridge.settlement = add(bridge.settlement, sub(realized, revised));
        bridge.realized = add(bridge.realized, realized);
      } else if (open) {
        if (startOfDay(t.dueDate) < todayStart)
          bridge.openOverdue = add(bridge.openOverdue, open);
        else bridge.openFuture = add(bridge.openFuture, open);
      }

      const m = perMonth.get(role.month)!;
      m.planned = add(m.planned, planned);
      m.revised = add(m.revised, revised);
      m.realized = add(m.realized, realized);

      if (planned) {
        total++;
        if (t.plannedSource === "create" || t.plannedSource === "audit")
          known++;
      }

      // Desvio por grupo de partes: a parte "(1/3)" sozinha parece um rombo
      // que as outras duas compensam.
      const gKey = groupKey(t) ?? t.id;
      const g = groups.get(gKey) ?? {
        id: t.id,
        description: (t.description ?? "").replace(PART_RE, "").trim(),
        counterpart: nameOf(t),
        month: role.month,
        planned: 0,
        revised: 0,
        realized: 0,
        open: 0,
        deviation: 0,
        parts: 0,
      };
      if (!role.split && planned) {
        g.id = t.id;
        g.month = role.month;
      }
      g.planned = add(g.planned, planned);
      g.revised = add(g.revised, revised);
      g.realized = add(g.realized, realized);
      g.open = add(g.open, open);
      g.parts++;
      groups.set(gKey, g);
    }

    const deviations = [...groups.values()]
      .map((g) => ({
        ...g,
        deviation: currency(g.realized).add(g.open).subtract(g.planned).value,
      }))
      .filter((g) => g.deviation !== 0)
      .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
      .slice(0, 10);

    out[side] = {
      bridge,
      months: [...perMonth.values()],
      deviations,
      history: { known, total, knownShare: total ? known / total : 1 },
    };
  }
  return out;
}

// ─── Resultado e tendência ────────────────────────────────────────────────────

export interface TrendMonth {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

/** Entradas e saídas por mês no regime escolhido (o mesmo mês da DRE). */
export function buildTrend(
  transactions: Transaction[],
  range: MonthRange,
  regime: DreRegime,
): TrendMonth[] {
  const months = new Map(
    monthsOf(range).map((key) => [
      key,
      { key, label: monthLabel(key), inflow: 0, outflow: 0, net: 0 },
    ]),
  );
  for (const t of transactions) {
    const m = months.get(dreMonth(t, regime) ?? "");
    if (!m) continue;
    const v = dreAmount(t);
    if (t.type === "receivable") m.inflow = add(m.inflow, v);
    else m.outflow = add(m.outflow, v);
  }
  return [...months.values()].map((m) => ({
    ...m,
    net: sub(m.inflow, m.outflow),
  }));
}

/**
 * Período de comparação sem nenhum lançamento (antes de a empresa usar o
 * sistema): comparar com zero sugeriria um salto que não aconteceu.
 */
export const hasMovement = (
  t: { inflow: number; outflow: number } | null | undefined,
) => !!t && (t.inflow !== 0 || t.outflow !== 0);

export const sumTrend = (months: TrendMonth[]) =>
  months.reduce(
    (s, m) => ({
      inflow: add(s.inflow, m.inflow),
      outflow: add(s.outflow, m.outflow),
      net: add(s.net, m.net),
    }),
    { inflow: 0, outflow: 0, net: 0 },
  );

/** Média mensal paga e recebida nos `months` meses fechados antes de hoje. */
export function monthlyAverage(
  transactions: Transaction[],
  today: Date,
  months = 6,
) {
  const last = subMonths(startOfMonth(today), 1);
  const range = {
    from: monthKey(subMonths(last, months - 1)),
    to: monthKey(last),
  };
  const total = sumTrend(buildTrend(transactions, range, "cash"));
  return {
    months,
    range,
    inflow: currency(total.inflow).divide(months).value,
    outflow: currency(total.outflow).divide(months).value,
  };
}

// ─── Composição: plano de contas e centros de custo ───────────────────────────

export interface CompositionNode {
  id: string;
  /** Pai na árvore; null = topo. */
  parentId: string | null;
  code: string;
  name: string;
  /** Soma da subárvore no período, por lado (sempre positiva). */
  value: Record<Side, number>;
  compare: Record<Side, number>;
}

export interface Composition {
  nodes: CompositionNode[];
  unassigned: Record<Side, number>;
  unassignedCompare: Record<Side, number>;
  /** Parte do movimento com conta/centro, 0 a 1. */
  coverage: number;
}

const zeroSides = (): Record<Side, number> => ({ receivable: 0, payable: 0 });

/** Soma folhas e sobe pelos pais: cada nó carrega o total da subárvore. */
function rollUp(
  base: Omit<CompositionNode, "value" | "compare">[],
  direct: Map<string, Record<Side, number>>,
  directCompare: Map<string, Record<Side, number>>,
): CompositionNode[] {
  const byId = new Map<string, CompositionNode>(
    base.map((n) => [n.id, { ...n, value: zeroSides(), compare: zeroSides() }]),
  );
  const climb = (
    id: string,
    v: Record<Side, number>,
    key: "value" | "compare",
  ) => {
    const seen = new Set<string>();
    for (
      let n = byId.get(id);
      n && !seen.has(n.id);
      n = n.parentId ? byId.get(n.parentId) : undefined
    ) {
      seen.add(n.id);
      for (const s of SIDES) n[key][s] = add(n[key][s], v[s]);
    }
  };
  direct.forEach((v, id) => climb(id, v, "value"));
  directCompare.forEach((v, id) => climb(id, v, "compare"));
  return [...byId.values()].filter((n) =>
    SIDES.some((s) => n.value[s] || n.compare[s]),
  );
}

function bump(
  map: Map<string, Record<Side, number>>,
  id: string,
  s: Side,
  v: number,
) {
  const cur = map.get(id) ?? zeroSides();
  cur[s] = add(cur[s], v);
  map.set(id, cur);
}

/** Pai de uma conta pelo código: o maior prefixo que existe no plano. */
function accountParent(code: string, byCode: Map<string, ChartAccount>) {
  const parts = code.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = byCode.get(parts.slice(0, i).join("."));
    if (parent) return parent.id;
  }
  return null;
}

export function buildAccountComposition(
  transactions: Transaction[],
  accounts: ChartAccount[],
  range: MonthRange,
  compare: MonthRange | null,
  regime: DreRegime,
): Composition {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const direct = new Map<string, Record<Side, number>>();
  const directCompare = new Map<string, Record<Side, number>>();
  const unassigned = zeroSides();
  const unassignedCompare = zeroSides();
  let classified = 0;
  let volume = 0;

  for (const t of transactions) {
    const month = dreMonth(t, regime);
    const current = inRange(month, range);
    const previous = !!compare && inRange(month, compare);
    if (!current && !previous) continue;
    const v = dreAmount(t);
    if (!v) continue;
    const account = t.accountId ? byId.get(t.accountId) : undefined;
    const valid = account?.type === "analytic";
    if (current) {
      volume = add(volume, Math.abs(v));
      if (valid) classified = add(classified, Math.abs(v));
    }
    if (valid) {
      if (current) bump(direct, account.id, t.type, v);
      if (previous) bump(directCompare, account.id, t.type, v);
    } else {
      if (current) unassigned[t.type] = add(unassigned[t.type], v);
      if (previous)
        unassignedCompare[t.type] = add(unassignedCompare[t.type], v);
    }
  }

  return {
    nodes: rollUp(
      accounts.map((a) => ({
        id: a.id,
        parentId: accountParent(a.code, byCode),
        code: a.code,
        name: a.name,
      })),
      direct,
      directCompare,
    ),
    unassigned,
    unassignedCompare,
    coverage: volume ? classified / volume : 1,
  };
}

/** Fatia de cada centro no lançamento, proporcional ao valor final. */
function costCenterShares(t: Transaction, full: number) {
  const allocation = (t.costCenterAllocation ?? []).filter(
    (a) => a.costCenterId,
  );
  if (allocation.length === 0)
    return t.costCenterId ? [{ id: t.costCenterId, value: full }] : [];
  const base = t.amount || allocation.reduce((s, a) => s + a.amount, 0);
  if (!base) return [];
  return allocation.map((a) => ({
    id: a.costCenterId,
    value: currency(full).multiply(a.amount).divide(base).value,
  }));
}

export function buildCostCenterComposition(
  transactions: Transaction[],
  costCenters: CostCenter[],
  range: MonthRange,
  compare: MonthRange | null,
  regime: DreRegime,
): Composition {
  const known = new Set(costCenters.map((c) => c.id));
  const direct = new Map<string, Record<Side, number>>();
  const directCompare = new Map<string, Record<Side, number>>();
  const unassigned = zeroSides();
  const unassignedCompare = zeroSides();
  let assigned = 0;
  let volume = 0;

  for (const t of transactions) {
    const month = dreMonth(t, regime);
    const current = inRange(month, range);
    const previous = !!compare && inRange(month, compare);
    if (!current && !previous) continue;
    const full = dreAmount(t);
    if (!full) continue;
    let left = full;
    for (const share of costCenterShares(t, full)) {
      if (!known.has(share.id)) continue;
      left = sub(left, share.value);
      if (current) bump(direct, share.id, t.type, share.value);
      if (previous) bump(directCompare, share.id, t.type, share.value);
    }
    if (current) {
      volume = add(volume, Math.abs(full));
      assigned = add(assigned, Math.abs(sub(full, left)));
    }
    if (left) {
      if (current) unassigned[t.type] = add(unassigned[t.type], left);
      if (previous)
        unassignedCompare[t.type] = add(unassignedCompare[t.type], left);
    }
  }

  return {
    nodes: rollUp(
      costCenters.map((c) => ({
        id: c.id,
        parentId: c.parentId && known.has(c.parentId) ? c.parentId : null,
        code: c.code,
        name: c.name,
      })),
      direct,
      directCompare,
    ),
    unassigned,
    unassignedCompare,
    coverage: volume ? assigned / volume : 1,
  };
}

// ─── Riscos: concentração, atraso, prazo ──────────────────────────────────────

export interface Counterpart {
  key: string;
  name: string;
  value: number;
}

export interface Concentration {
  total: number;
  top: Counterpart[];
  /** Soma de quem ficou fora do top. */
  rest: number;
  restCount: number;
  anchor: (Counterpart & { share: number }) | null;
}

export function buildConcentration(
  transactions: Transaction[],
  side: Side,
  range: MonthRange,
  regime: DreRegime,
  nameOf: (t: Transaction) => string,
  anchorEntityId?: string | null,
  limit = 8,
): Concentration {
  const by = new Map<string, Counterpart>();
  let total = 0;
  for (const t of transactions) {
    if (t.type !== side || !inRange(dreMonth(t, regime), range)) continue;
    const v = dreAmount(t);
    if (!v) continue;
    const name = nameOf(t);
    const key = t.entityId ?? `nome:${name.toLowerCase()}`;
    const c = by.get(key) ?? { key, name, value: 0 };
    c.value = add(c.value, v);
    by.set(key, c);
    total = add(total, v);
  }
  const ranked = [...by.values()].sort((a, b) => b.value - a.value);
  const top = ranked.slice(0, limit);
  const anchor = anchorEntityId ? by.get(anchorEntityId) : undefined;
  return {
    total,
    top,
    rest: ranked.slice(limit).reduce((s, c) => add(s, c.value), 0),
    restCount: Math.max(0, ranked.length - limit),
    anchor: anchor
      ? { ...anchor, share: total ? anchor.value / total : 0 }
      : null,
  };
}

export const AGING_BUCKETS = [
  { key: "due", label: "A vencer em 30 dias" },
  { key: "d30", label: "1 a 30 dias" },
  { key: "d60", label: "31 a 60 dias" },
  { key: "d90", label: "61 a 90 dias" },
  { key: "d90p", label: "Mais de 90 dias" },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

export interface AgingBucket {
  key: AgingKey;
  label: string;
  value: number;
  count: number;
}

/** Em aberto hoje, pelo atraso. "A vencer" olha só os próximos 30 dias. */
export function buildAging(
  transactions: Transaction[],
  side: Side,
  today: Date,
): AgingBucket[] {
  const buckets = AGING_BUCKETS.map((b) => ({ ...b, value: 0, count: 0 }));
  const at = (key: AgingKey) => buckets.find((b) => b.key === key)!;
  for (const t of transactions) {
    if (t.type !== side || t.status === "rejected" || isRealized(t)) continue;
    const late = differenceInCalendarDays(today, t.dueDate);
    const key: AgingKey | null =
      late <= 0
        ? late >= -30
          ? "due"
          : null
        : late <= 30
          ? "d30"
          : late <= 60
            ? "d60"
            : late <= 90
              ? "d90"
              : "d90p";
    if (!key) continue;
    const b = at(key);
    b.value = add(b.value, revisedOf(t));
    b.count++;
  }
  return buckets;
}

export interface Timing {
  count: number;
  /** Dias entre vencimento e baixa, média ponderada pelo valor. */
  avgDays: number | null;
  lateShare: number | null;
}

/** Pontualidade das baixas do período (pela data da baixa). */
export function buildTiming(
  transactions: Transaction[],
  side: Side,
  range: MonthRange,
): Timing {
  let weighted = 0;
  let weight = 0;
  let late = 0;
  let count = 0;
  for (const t of transactions) {
    if (t.type !== side || !isRealized(t) || !t.paymentDate) continue;
    if (!inRange(monthKey(t.paymentDate), range)) continue;
    const v = flowAmount(t);
    const days = differenceInCalendarDays(t.paymentDate, t.dueDate);
    weighted += days * v;
    weight += v;
    count++;
    if (days > 0) late++;
  }
  return {
    count,
    avgDays: weight ? weighted / weight : null,
    lateShare: count ? late / count : null,
  };
}

// ─── Relatório ────────────────────────────────────────────────────────────────

export interface AnalyticsOptions {
  range: MonthRange;
  compare: "none" | "previous" | "year";
  regime: DreRegime;
  today: Date;
  anchorEntityId?: string | null;
}

export interface AnalyticsReport {
  range: MonthRange;
  compareRange: MonthRange | null;
  regime: DreRegime;
  /** "yyyy-MM-dd" do dia em que foi calculado. */
  today: string;
  totals: { inflow: number; outflow: number; net: number };
  compareTotals: { inflow: number; outflow: number; net: number } | null;
  /** 24 meses até o fim do período. */
  trend: TrendMonth[];
  average: ReturnType<typeof monthlyAverage>;
  plan: Record<Side, PlanSide>;
  accounts: Composition;
  costCenters: Composition;
  concentration: Record<Side, Concentration>;
  aging: Record<Side, AgingBucket[]>;
  timing: Record<Side, Timing>;
  anchorEntityId: string | null;
}

export function buildAnalytics(
  input: {
    transactions: Transaction[];
    accounts: ChartAccount[];
    costCenters: CostCenter[];
    entities: Pick<Entity, "id" | "name">[];
  },
  o: AnalyticsOptions,
): AnalyticsReport {
  const entityName = new Map(input.entities.map((e) => [e.id, e.name]));
  const nameOf = (t: Transaction) =>
    (t.entityId && entityName.get(t.entityId)) ||
    t.supplierOrClient?.trim() ||
    "Sem favorecido";
  const txs = input.transactions;
  const compareRangeValue =
    o.compare === "none" ? null : compareRange(o.range, o.compare);
  const end = rangeStart({ from: o.range.to, to: o.range.to });
  const trend = buildTrend(
    txs,
    { from: monthKey(addMonths(end, -23)), to: o.range.to },
    o.regime,
  );
  const anchor = o.anchorEntityId ?? null;

  return {
    range: o.range,
    compareRange: compareRangeValue,
    regime: o.regime,
    today: dayKey(o.today),
    totals: sumTrend(buildTrend(txs, o.range, o.regime)),
    compareTotals: compareRangeValue
      ? sumTrend(buildTrend(txs, compareRangeValue, o.regime))
      : null,
    trend,
    average: monthlyAverage(txs, o.today),
    plan: buildPlan(txs, o.range, o.today, nameOf),
    accounts: buildAccountComposition(
      txs,
      input.accounts,
      o.range,
      compareRangeValue,
      o.regime,
    ),
    costCenters: buildCostCenterComposition(
      txs,
      input.costCenters,
      o.range,
      compareRangeValue,
      o.regime,
    ),
    concentration: {
      receivable: buildConcentration(
        txs,
        "receivable",
        o.range,
        o.regime,
        nameOf,
        anchor,
      ),
      payable: buildConcentration(txs, "payable", o.range, o.regime, nameOf),
    },
    aging: {
      receivable: buildAging(txs, "receivable", o.today),
      payable: buildAging(txs, "payable", o.today),
    },
    timing: {
      receivable: buildTiming(txs, "receivable", o.range),
      payable: buildTiming(txs, "payable", o.range),
    },
    anchorEntityId: anchor,
  };
}
