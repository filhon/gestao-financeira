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
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  getDaysInMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ChartAccount,
  CostCenter,
  Entity,
  RecurringTransactionTemplate,
  Transaction,
} from "./types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { dreAmount, dreMonth, type DreRegime } from "./chartOfAccounts";
import {
  buildCashFlow,
  DEFAULT_FORECAST,
  flowAmount,
  FORECAST_STAGES,
  projectRecurrences,
  stageOf,
  variation,
  type FlowStage,
} from "./reports";
import {
  annotateWithSimulations,
  negativeRuns,
  type NegativeRun,
  type SimulatedEntry,
} from "./dashboardRules";
import { formatCurrencyAbbr, formatPercent } from "./utils";

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
      // ponytail: saldo de implantação não é desvio; casa pela descrição,
      // trocar por uma marca no lançamento se aparecerem outras variações.
      .filter(
        (g) => g.deviation !== 0 && !/^saldo inicial/i.test(g.description),
      )
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

// ─── Projeção do caixa ────────────────────────────────────────────────────────

export const PROJECTION_MONTHS = 24;
export const PROJECTION_HORIZONS = [3, 6, 12, 24] as const;
export type ForecastStage = Exclude<FlowStage, "realized">;

/** Movimento previsto de um dia num estágio. */
export interface ProjectionDay {
  /** "yyyy-MM-dd". */
  date: string;
  stage: ForecastStage;
  inflow: number;
  outflow: number;
}

const fromDayKey = (key: string) => new Date(`${key}T12:00:00`);

/**
 * O que ainda não passou pelo banco, de hoje a `months` meses, por dia e
 * estágio: o mesmo fluxo de caixa dos Relatórios, com as recorrências ainda
 * não lançadas. Vencido e não baixado fica de fora (como em `openingFromToday`):
 * não há data para pôr no futuro; a tela mostra o total à parte.
 */
export function buildProjectionDays(
  transactions: Transaction[],
  templates: RecurringTransactionTemplate[],
  today: Date,
  months = PROJECTION_MONTHS,
): ProjectionDay[] {
  const start = startOfDay(today);
  const end = addMonths(start, months);
  const flow = buildCashFlow(
    [...transactions, ...projectRecurrences(templates, start, end)],
    { start, end, stages: FORECAST_STAGES, granularity: "day" },
  );
  const rows = new Map<string, ProjectionDay>();
  for (const l of flow.lines) {
    const date = dayKey(l.date);
    const key = `${date}|${l.stage}`;
    const row = rows.get(key) ?? {
      date,
      stage: l.stage as ForecastStage,
      inflow: 0,
      outflow: 0,
    };
    if (l.tx.type === "receivable") row.inflow = add(row.inflow, l.amount);
    else row.outflow = add(row.outflow, l.amount);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Simulação "e se": nada é gravado, só desenha a linha tracejada. */
export type Simulation =
  | { id: string; kind: "once"; type: Side; amount: number; date: string }
  | {
      id: string;
      kind: "monthly";
      type: Side;
      amount: number;
      date: string;
      months: number;
    }
  /** Receita ou despesa prevista variando `percent` (−0,1 = −10%). */
  | { id: string; kind: "percent"; side: Side; percent: number };

/** Uma simulação em lançamentos datados, dentro de [from, until]. */
export function simulationEntries(
  sims: Simulation[],
  days: ProjectionDay[],
  stages: readonly ForecastStage[],
  from: string,
  until: string,
): SimulatedEntry[] {
  const out: SimulatedEntry[] = [];
  for (const s of sims) {
    if (s.kind === "once") {
      out.push({ id: s.id, type: s.type, amount: s.amount, date: s.date });
    } else if (s.kind === "monthly") {
      // Sempre a partir da data inicial: 31/01 vira 28/02 e volta a 31/03.
      for (let i = 0; i < s.months; i++) {
        out.push({
          id: `${s.id}_${i}`,
          type: s.type,
          amount: s.amount,
          date: dayKey(addMonths(fromDayKey(s.date), i)),
        });
      }
    } else {
      const wanted = new Set(stages);
      for (const d of days) {
        if (!wanted.has(d.stage)) continue;
        const base = s.side === "receivable" ? d.inflow : d.outflow;
        if (!base) continue;
        out.push({
          id: `${s.id}_${d.date}_${d.stage}`,
          type: s.side,
          amount: currency(base).multiply(s.percent).value,
          date: d.date,
        });
      }
    }
  }
  return out.filter((e) => e.amount && e.date >= from && e.date <= until);
}

export interface ProjectionPoint {
  isoDate: string;
  inflow: number;
  outflow: number;
  /** Saldo ao fim do dia. */
  balance: number;
  simulatedBalance?: number;
}

export interface Projection {
  from: string;
  until: string;
  opening: number;
  points: ProjectionPoint[];
  closing: number;
  lowest: ProjectionPoint;
  runs: NegativeRun<ProjectionPoint>[];
  /** Todos os estágios, escolhidos ou não, no horizonte. */
  byStage: { stage: ForecastStage; inflow: number; outflow: number }[];
  simulated: {
    closing: number;
    lowest: number;
    runs: NegativeRun<ProjectionPoint>[];
  } | null;
  /**
   * Quanto da média mensal já está lançado no horizonte, por lado (null sem
   * média). Receita lançada por um ano e despesa lançada por uma semana fazem
   * a linha subir sem que o caixa vá subir.
   */
  coverage: { inflow: number | null; outflow: number | null } | null;
  /** Primeiro dia do primeiro mês com menos de `COVERAGE_MIN` da média lançado. */
  thinFrom: string | null;
  /** O que a estimativa pela média acrescentou (zero sem ela). */
  estimated: { inflow: number; outflow: number };
}

/** Mês com menos desta parte da média lançada é "pouco lançado". */
export const COVERAGE_MIN = 0.5;

/** Meses do horizonte, cortados nas pontas, com a fração do mês que cobrem. */
function monthSegments(from: string, until: string) {
  const out: { start: string; days: string[]; share: number }[] = [];
  const last = fromDayKey(until);
  for (let cur = fromDayKey(from); cur <= last; ) {
    const monthEnd = fromDayKey(dayKey(endOfMonth(cur)));
    const end = monthEnd < last ? monthEnd : last;
    const days = eachDayOfInterval({ start: cur, end }).map(dayKey);
    out.push({
      start: dayKey(cur),
      days,
      share: days.length / getDaysInMonth(cur),
    });
    cur = addDays(end, 1);
  }
  return out;
}

/**
 * Saldo dia a dia de `from` a `until`, a partir do caixa de hoje, só com os
 * estágios escolhidos. Um ponto por dia com movimento (o saldo muda em
 * degrau), mais as pontas e as datas simuladas, para a linha tracejada
 * descer no dia certo.
 */
export function projectBalance(o: {
  days: ProjectionDay[];
  opening: number;
  stages: readonly ForecastStage[];
  from: string;
  until: string;
  simulations?: Simulation[];
  /** Média mensal dos meses fechados: mede quanto do futuro está lançado. */
  average?: { inflow: number; outflow: number };
  /** Completa cada mês, nos dois lados, até a média. */
  estimate?: boolean;
}): Projection {
  const wanted = new Set(o.stages);
  const inHorizon = o.days.filter((d) => d.date >= o.from && d.date <= o.until);
  const perDay = new Map<string, { inflow: number; outflow: number }>();
  const stageTotals = new Map(
    FORECAST_STAGES.map((stage) => [
      stage as ForecastStage,
      { stage: stage as ForecastStage, inflow: 0, outflow: 0 },
    ]),
  );
  for (const d of inHorizon) {
    const st = stageTotals.get(d.stage)!;
    st.inflow = add(st.inflow, d.inflow);
    st.outflow = add(st.outflow, d.outflow);
    if (!wanted.has(d.stage)) continue;
    const day = perDay.get(d.date) ?? { inflow: 0, outflow: 0 };
    day.inflow = add(day.inflow, d.inflow);
    day.outflow = add(day.outflow, d.outflow);
    perDay.set(d.date, day);
  }

  // Cobertura antes da estimativa: mede o lançado, não o que a média pôs.
  let coverage: Projection["coverage"] = null;
  let thinFrom: string | null = null;
  const estimated = { inflow: 0, outflow: 0 };
  const avg = o.average;
  if (avg && (avg.inflow > 0 || avg.outflow > 0)) {
    const got = { inflow: 0, outflow: 0 };
    const want = { inflow: 0, outflow: 0 };
    for (const seg of monthSegments(o.from, o.until)) {
      const lanc = { inflow: 0, outflow: 0 };
      for (const k of seg.days) {
        const day = perDay.get(k);
        if (!day) continue;
        lanc.inflow = add(lanc.inflow, day.inflow);
        lanc.outflow = add(lanc.outflow, day.outflow);
      }
      const target = {
        inflow: currency(avg.inflow).multiply(seg.share).value,
        outflow: currency(avg.outflow).multiply(seg.share).value,
      };
      for (const s of ["inflow", "outflow"] as const) {
        got[s] = add(got[s], lanc[s]);
        want[s] = add(want[s], target[s]);
      }
      const thin = (["inflow", "outflow"] as const).some(
        (s) => target[s] > 0 && lanc[s] < target[s] * COVERAGE_MIN,
      );
      if (thin && thinFrom === null) thinFrom = seg.start;
      if (!o.estimate) continue;
      // Espalhado por dia: a despesa do mês não sai toda num dia só.
      for (const s of ["inflow", "outflow"] as const) {
        const gap = sub(target[s], lanc[s]);
        if (gap <= 0) continue;
        estimated[s] = add(estimated[s], gap);
        currency(gap)
          .distribute(seg.days.length)
          .forEach((part, idx) => {
            const k = seg.days[idx];
            const day = perDay.get(k) ?? { inflow: 0, outflow: 0 };
            day[s] = add(day[s], part.value);
            perDay.set(k, day);
          });
      }
    }
    coverage = {
      inflow: want.inflow > 0 ? got.inflow / want.inflow : null,
      outflow: want.outflow > 0 ? got.outflow / want.outflow : null,
    };
  }

  const entries = simulationEntries(
    o.simulations ?? [],
    inHorizon,
    o.stages,
    o.from,
    o.until,
  );
  const dates = [
    ...new Set([
      o.from,
      ...perDay.keys(),
      ...entries.map((e) => e.date),
      o.until,
    ]),
  ].sort();

  let running = currency(o.opening);
  const base: ProjectionPoint[] = dates.map((isoDate) => {
    const day = perDay.get(isoDate) ?? { inflow: 0, outflow: 0 };
    running = running.add(day.inflow).subtract(day.outflow);
    return { isoDate, ...day, balance: running.value };
  });
  const points = annotateWithSimulations(base, entries);
  const lowestOf = (
    ps: ProjectionPoint[],
    key: "balance" | "simulatedBalance",
  ) =>
    ps.reduce((min, p) => ((p[key] ?? 0) < (min[key] ?? 0) ? p : min), ps[0]);
  const lowest = lowestOf(points, "balance");
  const simulated = entries.length
    ? {
        closing: points.at(-1)!.simulatedBalance!,
        lowest: lowestOf(points, "simulatedBalance").simulatedBalance!,
        runs: negativeRuns(
          points.map((p) => ({ ...p, balance: p.simulatedBalance! })),
        ),
      }
    : null;

  return {
    from: o.from,
    until: o.until,
    opening: currency(o.opening).value,
    points,
    closing: points.at(-1)!.balance,
    lowest,
    runs: negativeRuns(points),
    byStage: [...stageTotals.values()],
    simulated,
    coverage,
    thinFrom,
    estimated,
  };
}

/**
 * Até a próxima entrada: o que vence a pagar antes dela, contra o caixa de
 * hoje. Para quem vive de repasse, "dias de despesa sem receita nova" daria
 * alarme todo mês; o que importa é chegar ao próximo repasse.
 */
export interface CashCover {
  /** Primeira entrada prevista depois de hoje com pelo menos 10% da despesa média. */
  next: { date: string; amount: number } | null;
  /** A pagar de hoje até a véspera dessa entrada (estágios padrão). */
  due: number;
  covered: boolean;
}

export function cashCover(
  report: Pick<AnalyticsReport, "projection" | "today" | "average">,
  available: number | null,
): CashCover | null {
  if (available === null) return null;
  const wanted = new Set<string>(DEFAULT_FORECAST);
  const byDate = new Map<string, { inflow: number; outflow: number }>();
  for (const d of report.projection) {
    if (!wanted.has(d.stage) || d.date < report.today) continue;
    const day = byDate.get(d.date) ?? { inflow: 0, outflow: 0 };
    day.inflow = add(day.inflow, d.inflow);
    day.outflow = add(day.outflow, d.outflow);
    byDate.set(d.date, day);
  }
  // ponytail: "repasse" = entrada de 10% da despesa média ou mais; trocar pela
  // entidade mantenedora se a projeção passar a carregar a contraparte.
  const floor = Math.max(0.01, report.average.outflow * 0.1);
  const dates = [...byDate.keys()].sort();
  const nextDate = dates.find(
    (k) => k > report.today && byDate.get(k)!.inflow >= floor,
  );
  if (!nextDate) return { next: null, due: 0, covered: true };
  const due = dates
    .filter((k) => k < nextDate)
    .reduce((s, k) => add(s, byDate.get(k)!.outflow), 0);
  return {
    next: { date: nextDate, amount: byDate.get(nextDate)!.inflow },
    due,
    covered: available >= due,
  };
}

/** "yyyy-MM-dd" + n meses. */
export const horizonEnd = (from: string, months: number) =>
  dayKey(addMonths(fromDayKey(from), months));

// ─── O que pede atenção ───────────────────────────────────────────────────────

/** Limites das regras de destaque. */
export const ATTENTION = {
  /** Previsto × realizado + em aberto, no sentido ruim. */
  planDeviation: 0.1,
  /** Maior contraparte (fora a mantenedora) no total do lado. */
  concentration: 0.3,
  /** Horizonte da projeção que os destaques olham. */
  projectionMonths: 12,
  max: 5,
} as const;

export interface AttentionItem {
  id: string;
  tone: "danger" | "warning";
  text: string;
  /** Âncora da seção que explica o destaque. */
  section: string;
  sectionLabel: string;
}

export interface EnvelopeLeaf {
  name: string;
  status: "success" | "warning" | "danger" | "no-budget";
  isLeaf: boolean;
  tight: boolean;
}

const money = formatCurrencyAbbr;
// Uma casa: "10,3% abaixo" não se confunde com o limite de 10%.
const pct = (v: number) => formatPercent(v, 1);
const dayText = (key: string) => format(fromDayKey(key), "dd/MM/yyyy");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "Obras", "Obras e Eventos", "Obras, Eventos e mais 2". */
const names = (list: { name: string }[]) =>
  list.length <= 2
    ? list.map((l) => l.name).join(" e ")
    : `${list[0].name}, ${list[1].name} e mais ${list.length - 2}`;

/**
 * Destaques por regra, sem IA: cada regra que dispara vira uma frase de
 * modelo com os números e o link para a seção. Vermelho antes de âmbar; na
 * mesma cor, a ordem das regras abaixo.
 */
export function buildAttention(i: {
  report: AnalyticsReport;
  /** "2026", "jan/26 a mar/26". */
  periodLabel: string;
  envelopes: EnvelopeLeaf[] | null;
  exercise: number;
  projection: Projection | null;
}): AttentionItem[] {
  const out: AttentionItem[] = [];

  const p = i.projection;
  if (p && p.runs.length) {
    const first = p.runs[0];
    const when = first.open
      ? `a partir de ${dayText(first.start.isoDate)} e não volta ao positivo`
      : p.runs.length > 1
        ? `em ${p.runs.length} trechos, o primeiro a partir de ${dayText(first.start.isoDate)}`
        : first.start === first.end
          ? `em ${dayText(first.start.isoDate)}`
          : `entre ${dayText(first.start.isoDate)} e ${dayText(first.end.isoDate)}`;
    // O buraco e o que já devia ter entrado ficam na mesma frase: é a mesma decisão.
    const owed = overdueOf(i.report, "receivable").value;
    const owedText =
      owed > 0
        ? ` Há ${money(owed)} a receber já vencidos${owed >= Math.abs(p.lowest.balance) ? ", o bastante para cobrir o menor saldo" : ""}.`
        : "";
    out.push({
      id: "cash",
      tone: "danger",
      text: `O caixa fica negativo ${when}, no que já está lançado para os próximos ${ATTENTION.projectionMonths} meses. Menor saldo: ${money(p.lowest.balance)} em ${dayText(p.lowest.isoDate)}.${owedText}`,
      section: "projecao",
      sectionLabel: "Projeção",
    });
  }

  const leaves = (i.envelopes ?? []).filter((e) => e.isLeaf);
  const over = leaves.filter((e) => e.status === "danger");
  const pace = leaves.filter((e) => e.status === "warning" && !e.tight);
  const tight = leaves.filter((e) => e.status === "warning" && e.tight);
  if (over.length || pace.length || tight.length) {
    const parts = [
      over.length &&
        `${names(over)} ${plural(over.length, "estourou", "estouraram")}`,
      pace.length &&
        `${names(pace)} ${plural(pace.length, "gasta", "gastam")} acima do ritmo`,
      tight.length &&
        `${names(tight)} ${plural(tight.length, "está", "estão")} sem folga`,
    ].filter(Boolean);
    out.push({
      id: "envelope",
      tone: over.length ? "danger" : "warning",
      text: `Envelopes de ${i.exercise}: ${parts.join("; ")}.`,
      section: "orcamento",
      sectionLabel: "Orçamento",
    });
  }

  for (const side of SIDES) {
    const b = i.report.plan[side].bridge;
    if (b.planned <= 0) continue;
    const outlook = currency(b.realized)
      .add(b.openOverdue)
      .add(b.openFuture).value;
    const r = sub(outlook, b.planned) / b.planned;
    const bad =
      side === "receivable"
        ? r < -ATTENTION.planDeviation
        : r > ATTENTION.planDeviation;
    if (!bad) continue;
    out.push({
      id: `plan-${side}`,
      tone: "warning",
      text:
        side === "receivable"
          ? `Receitas de ${i.periodLabel}: ${money(outlook)} recebidas ou a receber, ${pct(-r)} abaixo dos ${money(b.planned)} previstos.`
          : `Despesas de ${i.periodLabel}: ${money(outlook)} pagas ou a pagar, ${pct(r)} acima dos ${money(b.planned)} previstos.`,
      section: "previsto",
      sectionLabel: "Previsto e realizado",
    });
  }

  const old = i.report.aging.receivable.find((b) => b.key === "d90p");
  if (old && old.value > 0) {
    out.push({
      id: "aging",
      tone: "warning",
      text: `${money(old.value)} a receber vencidos há mais de 90 dias, em ${old.count} ${plural(old.count, "lançamento", "lançamentos")}.`,
      section: "riscos",
      sectionLabel: "Riscos",
    });
  }

  for (const side of SIDES) {
    const c = i.report.concentration[side];
    if (c.total <= 0) continue;
    // A mantenedora é a fonte da receita por definição: não é risco a apontar.
    const top = c.top.find((t) => t.key !== i.report.anchorEntityId);
    if (!top || top.value / c.total <= ATTENTION.concentration) continue;
    out.push({
      id: `concentration-${side}`,
      tone: "warning",
      text: `${top.name} concentra ${pct(top.value / c.total)} das ${side === "receivable" ? "receitas" : "despesas"} de ${i.periodLabel} (${money(top.value)}).`,
      section: "riscos",
      sectionLabel: "Riscos",
    });
  }

  return out
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        (a.item.tone === "danger" ? 0 : 1) -
          (b.item.tone === "danger" ? 0 : 1) || a.order - b.order,
    )
    .slice(0, ATTENTION.max)
    .map((x) => x.item);
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
  /** Previsto de hoje a 24 meses; não depende do período escolhido. */
  projection: ProjectionDay[];
}

export function buildAnalytics(
  input: {
    transactions: Transaction[];
    accounts: ChartAccount[];
    costCenters: CostCenter[];
    entities: Pick<Entity, "id" | "name">[];
    templates?: RecurringTransactionTemplate[];
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
    projection: buildProjectionDays(txs, input.templates ?? [], o.today),
  };
}

// ─── Textos compartilhados: tela, PDF e IA ────────────────────────────────────
// Os títulos afirmam a conclusão do bloco. A tela, o PDF e os fatos dados à IA
// saem destas mesmas funções: o PDF não pode dizer outra coisa que a tela.

/** "+R$ 228,1 mil" / "−R$ 1,3 mi": sinal sempre visível em variações. */
export const signedMoney = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatCurrencyAbbr(Math.abs(v))}`;
const pct0 = (v: number) => formatPercent(v, 0);

/** "nov/2026", "2026", "jan/26 a mar/26". */
export function rangeLabel(r: MonthRange) {
  const d = (key: string, pattern: string) =>
    format(new Date(`${key}-01T12:00:00`), pattern, { locale: ptBR });
  if (r.from === r.to) return d(r.from, "MMM/yyyy");
  if (
    r.from.endsWith("-01") &&
    r.to.endsWith("-12") &&
    r.from.slice(0, 4) === r.to.slice(0, 4)
  )
    return r.from.slice(0, 4);
  return `${d(r.from, "MMM/yy")} a ${d(r.to, "MMM/yy")}`;
}

/** Rótulo da comparação; null quando o período comparado não teve movimento. */
export const compareLabelOf = (report: AnalyticsReport) =>
  report.compareRange && hasMovement(report.compareTotals)
    ? rangeLabel(report.compareRange)
    : null;

/** Folga em meses; abaixo de um mês, em dias ("0 mês" não diz nada). */
export function monthsText(v: number) {
  if (v >= 1)
    return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${v < 2 ? "mês" : "meses"}`;
  const days = Math.floor(v * 30);
  return days < 1 ? "menos de 1 dia" : `${days} ${plural(days, "dia", "dias")}`;
}

export function positionTitle(
  available: number | null,
  cover: CashCover | null,
) {
  if (available === null) return "Posição de caixa";
  if (!cover?.next)
    return `Caixa disponível de ${money(available)}, sem entrada prevista à frente`;
  const when = dayText(cover.next.date);
  if (!cover.due)
    return `Caixa de ${money(available)}, sem nada a pagar até a próxima entrada, em ${when}`;
  return `Caixa de ${money(available)} ${cover.covered ? "cobre" : "não cobre"} os ${money(cover.due)} a pagar até a próxima entrada, em ${when}`;
}

/** "5%", "menos de 1%": parte da média já lançada. */
const shareText = (v: number) => (v < 0.005 ? "menos de 1%" : pct0(v));

/** Despesa lançada abaixo do mínimo no horizonte, sem estimativa ligada. */
export const thinOutflow = (p: Projection) =>
  !p.estimated.inflow &&
  !p.estimated.outflow &&
  p.coverage?.outflow != null &&
  p.coverage.outflow < COVERAGE_MIN
    ? p.coverage.outflow
    : null;

export function projectionTitle(p: Projection) {
  const { runs, closing, from, until } = p;
  const first = runs[0];
  const when = (key: string) => (key === from ? "hoje" : dayText(key));
  const month = monthLabel(until.slice(0, 7));
  const thin = thinOutflow(p);
  const estimated = p.estimated.inflow > 0 || p.estimated.outflow > 0;
  if (runs.length === 0)
    return thin !== null
      ? `Caixa não fica negativo até ${month}, mas a linha conta só ${shareText(thin)} da despesa média`
      : `Caixa chega a ${month} em ${money(closing)}, sem ficar negativo${estimated ? ", com o não lançado pela média" : ""}`;
  const base =
    runs.length > 1
      ? `Caixa fica negativo em ${runs.length} trechos, o primeiro a partir de ${when(first.start.isoDate)}`
      : first.open
        ? `Caixa fica negativo a partir de ${when(first.start.isoDate)} e não se recupera até ${month}`
        : `Caixa fica negativo entre ${when(first.start.isoDate)} e ${dayText(first.end.isoDate)}`;
  return thin !== null
    ? `${base}, mesmo contando só ${shareText(thin)} da despesa média`
    : base;
}

export function trendTitle(
  report: AnalyticsReport,
  compareLabel: string | null,
) {
  const { totals, compareTotals } = report;
  const delta = compareTotals ? variation(totals.net, compareTotals.net) : null;
  // No ano corrido, um pico que se desfez é a história, não o saldo final.
  let peak = "";
  if (!compareLabel && report.range.from.endsWith("-01")) {
    const pts = cumulativeByYear(report).points.filter(
      (p): p is typeof p & { current: number } => p.current !== null,
    );
    const top = pts.reduce<(typeof pts)[number] | null>(
      (m, p) => (!m || p.current > m.current ? p : m),
      null,
    );
    if (
      top &&
      top !== pts.at(-1) &&
      top.current > 0 &&
      top.current - totals.net >
        Math.max(Math.abs(totals.net), top.current * 0.2)
    )
      peak = `, depois de chegar a ${signedMoney(top.current)} em ${format(new Date(2000, SHORT_MONTHS.indexOf(top.label), 1), "MMMM", { locale: ptBR })}`;
  }
  return (
    `Resultado de ${signedMoney(totals.net)} no período${peak}` +
    (compareTotals && compareLabel
      ? delta === null
        ? `, contra ${signedMoney(compareTotals.net)} em ${compareLabel}`
        : `, ${pct0(Math.abs(delta))} ${delta >= 0 ? "acima" : "abaixo"} do resultado de ${compareLabel}`
      : "")
  );
}

export function planTitle(b: PlanBridge, side: Side) {
  const noun = side === "receivable" ? "Receita" : "Despesa";
  const verb = side === "receivable" ? "recebida" : "paga";
  return b.planned
    ? `${noun} ${verb}: ${money(b.realized)} de ${money(b.planned)} previstos (${pct0(b.realized / b.planned)})`
    : `${noun} ${verb}: ${money(b.realized)}, sem previsão no período`;
}

export function riskTitle(income: Concentration) {
  const top = income.top[0];
  if (income.anchor)
    return `${income.anchor.name} responde por ${pct0(income.anchor.share)} da receita do período`;
  return top && income.total
    ? `Maior fonte de receita: ${top.name}, com ${pct0(top.value / income.total)}`
    : "Sem receita no período";
}

export function budgetTitle(
  envelopes: Pick<EnvelopeLeaf, "status" | "isLeaf" | "tight">[] | undefined,
  exercise: number,
) {
  if (envelopes === undefined) return `Envelopes de ${exercise}`;
  const leaves = envelopes.filter((b) => b.isLeaf);
  const over = leaves.filter((b) => b.status === "danger").length;
  // "Sem folga" (95% ou mais) não é "acima do ritmo": os destaques separam.
  const warn = leaves.filter((b) => b.status === "warning");
  const tight = warn.filter((b) => b.tight).length;
  const fast = warn.length - tight;
  if (over > 0)
    return `${over} ${over === 1 ? "centro de custo estourou" : "centros de custo estouraram"} o envelope de ${exercise}`;
  if (fast > 0)
    return `${fast} ${fast === 1 ? "centro de custo gasta" : "centros de custo gastam"} acima do ritmo do ano`;
  if (tight > 0)
    return `${tight} ${tight === 1 ? "centro de custo está" : "centros de custo estão"} sem folga no envelope de ${exercise}`;
  return `Todos os centros de custo dentro do envelope de ${exercise}`;
}

export function investmentsTitle(o: {
  count: number;
  invested: number;
  last: { value: number; label: string } | null;
}) {
  if (o.count === 0) return "Nenhuma aplicação cadastrada";
  return `${money(o.invested)} aplicados${o.last ? `; rendimento de ${money(o.last.value)} em ${o.last.label}` : ""}`;
}

/** Vencido e não baixado (fora da projeção). */
export function overdueOf(report: AnalyticsReport, side: Side) {
  return report.aging[side]
    .filter((b) => b.key !== "due")
    .reduce(
      (s, b) => ({ value: add(s.value, b.value), count: s.count + b.count }),
      { value: 0, count: 0 },
    );
}

/** A projeção que os destaques olham: estágios padrão, 12 meses, sem simulação. */
export const attentionProjection = (
  report: AnalyticsReport,
  opening: number | null,
) =>
  opening === null
    ? null
    : projectBalance({
        days: report.projection,
        opening,
        stages: DEFAULT_FORECAST as ForecastStage[],
        from: report.today,
        until: horizonEnd(report.today, ATTENTION.projectionMonths),
        average: report.average,
      });

// Ponte do previsto ao realizado, degrau a degrau.

export interface PlanStep {
  key: string;
  label: string;
  value: number;
  total?: boolean;
  hint: string;
}

export const planSteps = (b: PlanBridge, side: Side): PlanStep[] =>
  [
    {
      key: "planned",
      label: "Previsto",
      value: b.planned,
      total: true,
      hint: "Valor com que cada lançamento nasceu.",
    },
    {
      key: "revisions",
      label: "Valor alterado",
      value: b.revisions,
      hint: "Mudanças de valor depois de previsto, inclusive partes desdobradas e ajustes do aprovador do lote.",
    },
    {
      key: "unplanned",
      label: "Não previstos",
      value: b.unplanned,
      hint: "Lançados já pagos ou depois do vencimento.",
    },
    {
      key: "cancelled",
      label: "Rejeitados",
      value: -b.cancelled,
      hint: "Previstos e depois rejeitados.",
    },
    {
      key: "settlement",
      label: "Diferença na baixa",
      value: b.settlement,
      hint:
        side === "payable"
          ? "Juros, multa ou desconto no pagamento."
          : "Desconto ou acréscimo no recebimento.",
    },
    {
      key: "overdue",
      label: side === "payable" ? "Vencido, não pago" : "Vencido, não recebido",
      value: -b.openOverdue,
      hint: "Já venceu e o pagamento ainda não foi registrado.",
    },
    {
      key: "future",
      label: "A vencer",
      value: -b.openFuture,
      hint: "Ainda dentro do prazo.",
    },
    {
      key: "realized",
      label: side === "payable" ? "Pago" : "Recebido",
      value: b.realized,
      total: true,
      hint: "Baixado no período.",
    },
  ].filter((s) => s.total || s.value !== 0);

/** Degrau da ponte: a barra flutua do saldo anterior até o novo. */
export function bridgeBars(steps: PlanStep[]) {
  let running = 0;
  return steps.map((s) => {
    if (s.total) {
      running = s.value;
      return { ...s, base: 0, bar: s.value, text: money(s.value) };
    }
    const start = running;
    running += s.value;
    return {
      ...s,
      base: Math.min(start, running),
      bar: Math.abs(s.value),
      text: signedMoney(s.value),
    };
  });
}

const SHORT_MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * Resultado acumulado mês a mês no ano do fim do período e no anterior. O ano
 * corrente para no mês de hoje: mês futuro sem baixa não é resultado zero.
 */
export function cumulativeByYear(report: AnalyticsReport) {
  const year = Number(report.range.to.slice(0, 4));
  const lastKey = [report.range.to, report.today.slice(0, 7)].sort()[0];
  const byKey = new Map(report.trend.map((m) => [m.key, m]));
  let acc = currency(0);
  let accPrev = currency(0);
  const points = SHORT_MONTHS.map((label, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const cur = byKey.get(`${year}-${mm}`);
    const prev = byKey.get(`${year - 1}-${mm}`);
    if (cur) acc = acc.add(cur.net);
    if (prev) accPrev = accPrev.add(prev.net);
    return {
      label,
      current: `${year}-${mm}` <= lastKey ? acc.value : null,
      previous: prev ? accPrev.value : null,
    };
  });
  return { year, points };
}

/** Rendimento reconhecido nos 12 meses até o mês passado. */
export function yieldSeries(yields: Record<string, number>, today: Date) {
  const lastMonth = subMonths(startOfMonth(today), 1);
  return Array.from({ length: 12 }, (_, i) => {
    const key = monthKey(subMonths(lastMonth, 11 - i));
    return { key, label: monthLabel(key), value: yields[key] ?? 0 };
  });
}

// Composição: o nível que a tela abre primeiro.

export type CompositionMode = "accounts" | "costCenters";

/**
 * Filhos do nível escolhido, do maior para o menor. Nível com um filho só (o
 * centro raiz, "4 Despesas") não informa nada: desce até o primeiro nível
 * que divide o valor.
 */
export function compositionLevel(
  comp: Composition,
  side: Side,
  path: string[] = [],
) {
  const byId = new Map(comp.nodes.map((n) => [n.id, n]));
  const childrenOf = (parentId: string | null) =>
    comp.nodes
      .filter(
        (n) =>
          n.parentId === parentId && (n.value[side] > 0 || n.compare[side] > 0),
      )
      .sort((a, b) => b.value[side] - a.value[side]);
  const hasChildren = (id: string) => childrenOf(id).length > 0;

  const trail = path.filter((id) => byId.has(id));
  let parent: string | null = trail.at(-1) ?? null;
  // Sem conta/centro abaixo de 0,5% não segura o nível de cima: "Global
  // concentra 100%" não diz nada.
  const rootTotal =
    childrenOf(null).reduce((s, k) => s + k.value[side], 0) +
    Math.max(0, comp.unassigned[side]);
  for (;;) {
    const kids = childrenOf(parent);
    const loose = parent === null && comp.unassigned[side] > rootTotal * 0.005;
    if (kids.length !== 1 || loose || !hasChildren(kids[0].id)) break;
    parent = kids[0].id;
    trail.push(parent);
  }
  const kids = childrenOf(parent);
  const unassigned = parent === null ? comp.unassigned[side] : 0;
  const unassignedCompare = parent === null ? comp.unassignedCompare[side] : 0;
  return {
    byId,
    childrenOf,
    hasChildren,
    trail,
    parent,
    parentNode: parent ? byId.get(parent) : undefined,
    kids,
    unassigned,
    unassignedCompare,
    total:
      kids.reduce((s, k) => s + k.value[side], 0) + Math.max(0, unassigned),
  };
}

/**
 * "MISSÕES E PROJETOS" → "Missões e projetos". ponytail: sigla em nome todo
 * maiúsculo vira minúscula ("INSS" → "Inss"); lista de siglas se incomodar.
 */
export const tidyName = (name: string) =>
  /[a-zà-ú]/.test(name) || !/[A-ZÀ-Ú]/.test(name)
    ? name
    : name.charAt(0) + name.slice(1).toLocaleLowerCase("pt-BR");

/**
 * Plano de contas com menos da metade do movimento classificado vira manchete
 * de cadastro ("98% sem conta"): abre por centro de custo até ele valer.
 */
export const defaultCompositionMode = (
  report: Pick<AnalyticsReport, "accounts">,
): CompositionMode =>
  report.accounts.coverage < 0.5 ? "costCenters" : "accounts";

export function compositionTitle(
  level: ReturnType<typeof compositionLevel>,
  side: Side,
  mode: CompositionMode,
) {
  const word = side === "receivable" ? "receitas" : "despesas";
  const { kids, total, unassigned, parentNode } = level;
  const top = kids[0];
  if (!total) return `Sem ${word} no período`;
  // A raiz ("Global") é o todo: "das despesas de Global" não diz nada.
  const of = parentNode?.parentId ? ` de ${tidyName(parentNode.name)}` : "";
  return top && top.value[side] >= unassigned
    ? `${tidyName(top.name)} concentra ${pct0(top.value[side] / total)} das ${word}${of}`
    : `${pct0(unassigned / total)} das ${word} estão sem ${mode === "accounts" ? "conta contábil" : "centro de custo"}`;
}

// ─── Resumo da análise: o que a tela, o PDF e a IA compartilham ───────────────

export interface BriefContext {
  /** Caixa disponível hoje; null sem contas correntes cadastradas. */
  cash: number | null;
  /** Envelopes do exercício; null enquanto não lidos. */
  envelopes: EnvelopeLeaf[] | null;
}

export function analysisBrief(report: AnalyticsReport, ctx: BriefContext) {
  const periodLabel = rangeLabel(report.range);
  const compareLabel = compareLabelOf(report);
  const exercise = Number(report.range.to.slice(0, 4));
  const projection = attentionProjection(report, ctx.cash);
  const attention = buildAttention({
    report,
    periodLabel,
    envelopes: ctx.envelopes,
    exercise,
    projection,
  });
  return {
    periodLabel,
    compareLabel,
    exercise,
    cash: ctx.cash,
    envelopes: ctx.envelopes,
    projection,
    attention,
    headlines: {
      posicao:
        ctx.cash === null
          ? null
          : positionTitle(ctx.cash, cashCover(report, ctx.cash)),
      projecao: projection ? projectionTitle(projection) : null,
      resultado: trendTitle(report, compareLabel),
      previstoReceitas: planTitle(report.plan.receivable.bridge, "receivable"),
      previstoDespesas: planTitle(report.plan.payable.bridge, "payable"),
      orcamento: ctx.envelopes ? budgetTitle(ctx.envelopes, exercise) : null,
      composicao: compositionTitle(
        compositionLevel(report[defaultCompositionMode(report)], "payable"),
        "payable",
        defaultCompositionMode(report),
      ),
      riscos: riskTitle(report.concentration.receivable),
    },
  };
}

export type AnalysisBrief = ReturnType<typeof analysisBrief>;

/** Resumo por regra, sem IA: as conclusões das seções principais. */
export function ruleSummary(brief: AnalysisBrief): string[] {
  const h = brief.headlines;
  const n = brief.attention.length;
  return [
    h.posicao,
    h.projecao,
    h.resultado,
    h.previstoReceitas,
    h.previstoDespesas,
    n
      ? `${n} ${plural(n, "ponto pede", "pontos pedem")} atenção, listados a seguir`
      : "Nenhum ponto passou dos limites de atenção",
  ]
    .filter((s): s is string => !!s)
    .map((s) => `${s}.`);
}

/**
 * Tudo o que a IA pode citar, em texto. A conferência usa este mesmo texto:
 * número que não está aqui não aparece na resposta.
 */
export function factsText(
  report: AnalyticsReport,
  brief: AnalysisBrief,
  companyName: string,
): string {
  const L: string[] = [];
  const sideWord = (s: Side) => (s === "receivable" ? "receitas" : "despesas");
  const regime =
    report.regime === "cash" ? "regime de caixa" : "regime de competência";
  const t = report.totals;
  const count = (n: number) => `${n} ${plural(n, "lançamento", "lançamentos")}`;

  L.push(`Empresa: ${companyName}.`);
  L.push(
    `Período analisado: ${brief.periodLabel}, ${regime}. Hoje: ${dayText(report.today)}.`,
  );
  L.push(
    `No período: receitas ${money(t.inflow)}, despesas ${money(t.outflow)}, resultado ${signedMoney(t.net)}.`,
  );
  if (brief.compareLabel && report.compareTotals) {
    const c = report.compareTotals;
    L.push(
      `Em ${brief.compareLabel} (comparação): receitas ${money(c.inflow)}, despesas ${money(c.outflow)}, resultado ${signedMoney(c.net)}.`,
    );
  } else {
    L.push("Sem período de comparação com movimento.");
  }
  const a = report.average;
  L.push(
    `Média mensal dos ${a.months} meses fechados até ${monthLabel(a.range.to)}: receitas ${money(a.inflow)}, despesas ${money(a.outflow)}.`,
  );
  L.push(
    brief.cash === null
      ? "Caixa disponível hoje: não informado (sem contas correntes)."
      : `Caixa disponível hoje, em contas correntes e aplicação automática: ${money(brief.cash)}.`,
  );

  const p = brief.projection;
  if (p) {
    L.push(
      `Projeção de ${ATTENTION.projectionMonths} meses, de ${dayText(p.from)} a ${dayText(p.until)}, com o que está lançado e as recorrências: saldo final ${money(p.closing)}; menor saldo ${money(p.lowest.balance)} em ${dayText(p.lowest.isoDate)}; ${p.runs.length ? `negativo em ${p.runs.length} ${plural(p.runs.length, "trecho", "trechos")}, o primeiro a partir de ${dayText(p.runs[0].start.isoDate)}` : "não fica negativo"}.`,
    );
    if (p.coverage)
      L.push(
        `Parte da média mensal que a projeção conta no horizonte (estágios padrão, sem rascunhos): receitas ${p.coverage.inflow === null ? "sem média" : shareText(p.coverage.inflow)}, despesas ${p.coverage.outflow === null ? "sem média" : shareText(p.coverage.outflow)}. O que não está lançado não entra na projeção.`,
      );
  }
  const cover = cashCover(report, brief.cash);
  if (cover?.next)
    L.push(
      `Próxima entrada prevista: ${money(cover.next.amount)} em ${dayText(cover.next.date)}; a pagar até lá: ${money(cover.due)}; o caixa de hoje ${cover.covered ? "cobre" : "não cobre"}.`,
    );
  const oin = overdueOf(report, "receivable");
  const oout = overdueOf(report, "payable");
  L.push(
    `Vencidos sem baixa hoje, fora da projeção: ${money(oin.value)} a receber em ${count(oin.count)}; ${money(oout.value)} a pagar em ${count(oout.count)}.`,
  );

  for (const s of SIDES) {
    const b = report.plan[s].bridge;
    const done = s === "receivable" ? "recebido" : "pago";
    L.push(
      `Previsto e realizado, ${sideWord(s)} de ${brief.periodLabel}: previsto ${money(b.planned)}; valor alterado ${signedMoney(b.revisions)}; não previstos ${money(b.unplanned)}; rejeitados ${money(b.cancelled)}; diferença na baixa ${signedMoney(b.settlement)}; vencido e não ${done} ${money(b.openOverdue)}; a vencer ${money(b.openFuture)}; ${done} ${money(b.realized)}${b.planned ? ` (${formatPercent(b.realized / b.planned, 1)} do previsto)` : ""}.`,
    );
    const devs = report.plan[s].deviations.slice(0, 5);
    if (devs.length) {
      L.push(
        `Maiores desvios em ${sideWord(s)}, realizado e em aberto contra o previsto:`,
      );
      for (const d of devs)
        L.push(
          `- ${d.description} (${d.counterpart}, ${monthLabel(d.month)}): previsto ${money(d.planned)}, ${done} ${money(d.realized)}, em aberto ${money(d.open)}, desvio ${signedMoney(d.deviation)}.`,
        );
    }
  }

  const leaves = (brief.envelopes ?? []).filter((e) => e.isLeaf);
  if (leaves.length) {
    const names = (f: (e: EnvelopeLeaf) => boolean) =>
      leaves
        .filter(f)
        .map((e) => e.name)
        .join(", ") || "nenhum";
    const group = (label: string, f: (e: EnvelopeLeaf) => boolean) =>
      `${label}, ${leaves.filter(f).length}: ${names(f)}`;
    L.push(
      `Envelopes de ${brief.exercise}, ${leaves.length} centros de custo; ${group("estourados", (e) => e.status === "danger")}; ${group("acima do ritmo", (e) => e.status === "warning" && !e.tight)}; ${group("sem folga", (e) => e.status === "warning" && e.tight)}.`,
    );
  }

  const composition = (
    comp: Composition,
    s: Side,
    mode: CompositionMode,
    title: string,
  ) => {
    const lv = compositionLevel(comp, s);
    if (!lv.total) return;
    L.push(`${title}:`);
    for (const k of lv.kids.slice(0, 6))
      L.push(
        `- ${mode === "accounts" ? `${k.code} ${k.name}` : k.name}: ${money(k.value[s])} (${formatPercent(k.value[s] / lv.total, 1)}).`,
      );
    if (lv.unassigned > 0)
      L.push(
        `- ${mode === "accounts" ? "Sem conta contábil" : "Sem centro de custo"}: ${money(lv.unassigned)} (${formatPercent(lv.unassigned / lv.total, 1)}).`,
      );
  };
  composition(
    report.accounts,
    "payable",
    "accounts",
    "Despesas por conta contábil",
  );
  composition(
    report.accounts,
    "receivable",
    "accounts",
    "Receitas por conta contábil",
  );
  L.push(
    `Parte do movimento com conta contábil: ${formatPercent(report.accounts.coverage, 1)}; com centro de custo: ${formatPercent(report.costCenters.coverage, 1)}.`,
  );
  composition(
    report.costCenters,
    "payable",
    "costCenters",
    "Despesas por centro de custo",
  );

  for (const s of SIDES) {
    const c = report.concentration[s];
    if (!c.total) continue;
    L.push(
      `Maiores contrapartes em ${sideWord(s)} do período, de ${money(c.total)}:`,
    );
    for (const x of c.top.slice(0, 5))
      L.push(
        `- ${x.name}: ${money(x.value)} (${formatPercent(x.value / c.total, 1)})${x.key === report.anchorEntityId ? ", a mantenedora" : ""}.`,
      );
  }

  for (const s of SIDES) {
    L.push(
      `Em aberto ${s === "receivable" ? "a receber" : "a pagar"} hoje, pelo atraso: ${report.aging[
        s
      ]
        .map(
          (b) =>
            `${b.label.toLowerCase()}: ${money(b.value)} em ${count(b.count)}`,
        )
        .join("; ")}.`,
    );
    const tm = report.timing[s];
    if (tm.avgDays !== null) {
      const days = Math.round(Math.abs(tm.avgDays));
      const verb = s === "receivable" ? "recebe" : "paga";
      L.push(
        `Pontualidade em ${sideWord(s)}: ${tm.count} baixas no período; em média ${verb} ${days === 0 ? "no vencimento" : `${days} ${plural(days, "dia", "dias")} ${tm.avgDays > 0 ? "depois do" : "antes do"} vencimento`}; ${formatPercent(tm.lateShare ?? 0, 1)} com atraso.`,
      );
    }
  }

  L.push("Resultado mês a mês no período:");
  for (const m of report.trend)
    if (m.key >= report.range.from && m.key <= report.range.to)
      L.push(
        `- ${m.label}: receitas ${money(m.inflow)}, despesas ${money(m.outflow)}, resultado ${signedMoney(m.net)}.`,
      );

  if (brief.attention.length) {
    const n = brief.attention.length;
    L.push(`O que pede atenção, ${n} ${plural(n, "ponto", "pontos")}:`);
    for (const it of brief.attention) L.push(`- ${it.text}`);
  }
  L.push("Conclusões das seções:");
  for (const h of Object.values(brief.headlines)) if (h) L.push(`- ${h}.`);
  return L.join("\n");
}

// ─── IA: pedidos ──────────────────────────────────────────────────────────────

const AI_RULES = `Regras:
- Use somente os FATOS. Não use conhecimento de fora.
- Copie cada número, valor, percentual e data exatamente como aparece nos FATOS. Não calcule, não some, não arredonde, não converta.
- Não cite pessoa, empresa, conta, centro de custo ou mês que não esteja nos FATOS.
- Português do Brasil, frases curtas e diretas, tom de relatório para a diretoria.
- Sem markdown, sem listas, sem travessão.`;

export const NO_ANSWER = "O relatório não traz esse dado.";

/** Os três pedidos à IA; a rota e o script do PDF usam os mesmos. */
export const aiPrompt = {
  summary: (facts: string) =>
    `Escreva o resumo executivo que abre o relatório financeiro para o conselho e a diretoria: um parágrafo de 4 a 6 frases. Comece pela conclusão mais importante (caixa, resultado e o que pede atenção) e termine com o principal risco. Não repita a lista de destaques; sintetize.

${AI_RULES}

FATOS:
${facts}`,
  attention: (items: AttentionItem[]) =>
    `Reescreva cada destaque abaixo numa frase clara para a diretoria, dizendo primeiro o que importa. Mantenha todos os números, datas e nomes exatamente como estão em cada destaque e não acrescente nenhum outro. Responda só com JSON: [{"id": "...", "text": "..."}], um objeto por destaque, mesmo id.

${AI_RULES}

DESTAQUES:
${JSON.stringify(items.map(({ id, text }) => ({ id, text })))}`,
  question: (facts: string, question: string) =>
    `Responda a pergunta da diretoria em até 4 frases, usando só os FATOS. Se os FATOS não trazem a resposta, responda exatamente: "${NO_ANSWER}"

${AI_RULES}

FATOS:
${facts}

PERGUNTA: ${JSON.stringify(question)}`,
};

// ─── IA: conferência dos números citados ──────────────────────────────────────

export type CitedKind =
  | "money"
  | "percent"
  | "date"
  | "daymonth"
  | "month"
  | "monthName"
  | "number";

export interface Cited {
  kind: CitedKind;
  /** Reais, pontos percentuais, yyyymmdd, mmdd, yyyymm, mm ou o número. */
  value: number;
  /** Precisão com que foi escrito: "R$ 1,8 mi" = 100 mil. 0 = exato. */
  step: number;
  /** Escrito com sinal de menos ("−R$ 47,6 mil"). */
  negative?: boolean;
  raw: string;
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
const SCALE: Record<string, number> = {
  mil: 1e3,
  mi: 1e6,
  milhão: 1e6,
  milhões: 1e6,
  bi: 1e9,
  bilhão: 1e9,
  bilhões: 1e9,
};

const NUMBER_WORDS: Record<string, number> = {
  dois: 2,
  duas: 2,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
};

/** "1.840.942,72" → 1840942.72, escrito com precisão de centavo. */
function readNum(s: string) {
  const [int, dec = ""] = s.split(",");
  return {
    value: Number(`${int.replace(/\./g, "")}.${dec || "0"}`),
    step: 10 ** -dec.length,
  };
}

const CITE_RULES: {
  kind: CitedKind;
  re: RegExp;
  read: (m: string[]) => { value: number; step: number; negative?: boolean };
}[] = [
  {
    kind: "money",
    re: new RegExp(
      String.raw`([-−]\s*)?R\$\s*([-−])?\s*(${NUM})(?:\s*(milhões|milhão|mil|mi|bilhões|bilhão|bi)(?!\p{L}))?`,
      "giu",
    ),
    read: (m) => {
      const n = readNum(m[3]);
      const scale = m[4] ? SCALE[m[4].toLowerCase()] : 1;
      return {
        value: n.value * scale,
        step: n.step * scale,
        negative: !!(m[1] || m[2]),
      };
    },
  },
  {
    kind: "percent",
    re: new RegExp(String.raw`(${NUM})\s*%`, "g"),
    read: (m) => readNum(m[1]),
  },
  {
    kind: "date",
    re: /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g,
    read: (m) => ({ value: +m[3] * 1e4 + +m[2] * 100 + +m[1], step: 0 }),
  },
  {
    kind: "month",
    re: /(?<!\p{L})(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\/(\d{4}|\d{2})(?!\d)/giu,
    read: (m) => ({
      value:
        (m[2].length === 2 ? 2000 + +m[2] : +m[2]) * 100 +
        SHORT_MONTHS.indexOf(m[1].toLowerCase()) +
        1,
      step: 0,
    }),
  },
  {
    kind: "month",
    re: new RegExp(
      String.raw`(?<!\p{L})(${MONTH_NAMES.join("|")})\s+de\s+(\d{4})(?!\d)`,
      "giu",
    ),
    read: (m) => ({
      value: +m[2] * 100 + MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1,
      step: 0,
    }),
  },
  {
    kind: "monthName",
    re: new RegExp(
      String.raw`(?<!\p{L})(${MONTH_NAMES.join("|")})(?!\p{L})`,
      "giu",
    ),
    read: (m) => ({
      value: MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1,
      step: 0,
    }),
  },
  {
    kind: "daymonth",
    re: /(?<!\d)(\d{1,2})\/(\d{1,2})(?![\d/])/g,
    read: (m) => ({ value: +m[2] * 100 + +m[1], step: 0 }),
  },
  {
    kind: "number",
    re: new RegExp(String.raw`(?<![\d,.])(${NUM})(?!\d)`, "g"),
    read: (m) => readNum(m[1]),
  },
  {
    // "Três centros de custo": contagem por extenso também é número citado.
    // "Um"/"uma" ficam de fora: são artigo na maior parte das frases.
    kind: "number",
    re: new RegExp(
      String.raw`(?<!\p{L})(${Object.keys(NUMBER_WORDS).join("|")})(?!\p{L})`,
      "giu",
    ),
    read: (m) => ({ value: NUMBER_WORDS[m[1].toLowerCase()], step: 1 }),
  },
];

/**
 * Números, datas e meses citados num texto em português. Cada regra apaga o
 * trecho que leu antes da seguinte: "R$ 1,8 mi" não vira também "1,8".
 */
export function extractCited(text: string): Cited[] {
  let rest = text.replace(/ /g, " ");
  const out: Cited[] = [];
  for (const rule of CITE_RULES) {
    for (const m of [...rest.matchAll(rule.re)]) {
      out.push({ kind: rule.kind, ...rule.read(m), raw: m[0] });
      const at = m.index ?? 0;
      rest =
        rest.slice(0, at) +
        " ".repeat(m[0].length) +
        rest.slice(at + m[0].length);
    }
  }
  return out;
}

/** Fatos citáveis: o que o texto traz, mais o ano de cada data e mês. */
function knownCited(facts: string): Cited[] {
  const cited = extractCited(facts);
  const years: Cited[] = cited
    .filter((c) => c.kind === "date" || c.kind === "month")
    .map((c) => ({
      kind: "number",
      value: Math.floor(c.value / (c.kind === "date" ? 1e4 : 100)),
      step: 1,
      raw: "",
    }));
  return [...cited, ...years];
}

/**
 * O número citado sai de algum fato: mesmo tipo e, na precisão com que foi
 * escrito, o mesmo valor ("R$ 234 mil" de "R$ 233,6 mil"). Mais preciso que
 * o fato não pode ser: "R$ 1.840.000" não sai de "R$ 1,8 mi". Sem sinal, vale
 * para os dois lados ("déficit de R$ 47,6 mil" cita "−R$ 47,6 mil"); com
 * sinal de menos, só um fato negativo.
 */
export function citedMatches(c: Cited, f: Cited) {
  const monthOf = (x: Cited) =>
    x.kind === "month"
      ? x.value % 100
      : x.kind === "date"
        ? Math.floor(x.value / 100) % 100
        : x.kind === "monthName"
          ? x.value
          : null;
  if (c.kind === "monthName") return monthOf(f) === c.value;
  if (c.kind === "daymonth")
    return (
      (f.kind === "date" && f.value % 1e4 === c.value) ||
      (f.kind === "daymonth" && f.value === c.value)
    );
  if (c.kind !== f.kind) return false;
  // Sem sinal vale para os dois ("déficit de R$ 47,6 mil"); com sinal de
  // menos, só um fato negativo.
  if (c.negative && !f.negative) return false;
  if (c.step === 0) return c.value === f.value;
  if (c.step < f.step - 1e-9) return false;
  const q = (v: number) => Math.round(Math.abs(v) / c.step + 1e-9);
  return q(c.value) === q(f.value);
}

/** Frases de um texto: quebra de linha, ou ponto seguido de maiúscula. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\*\*|__|`/g, "")
    .split(/\n+/)
    .flatMap((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
        .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

const wordsOf = (text: string) =>
  new Set(text.toLocaleLowerCase("pt-BR").match(/\p{L}+/gu) ?? []);

/**
 * Por que a frase não pode aparecer, ou null se pode: todo número, data e mês
 * citado sai dos fatos, e toda palavra com maiúscula fora do início da frase
 * (nome de pessoa, empresa, conta) está nos fatos.
 */
export function sentenceProblem(
  sentence: string,
  known: Cited[],
  factWords: Set<string>,
): string | null {
  for (const c of extractCited(sentence))
    if (!known.some((f) => citedMatches(c, f)))
      return `"${c.raw.trim()}" não está no relatório`;
  const first = sentence.search(/\p{L}/u);
  for (const m of sentence.matchAll(/(?<![\p{L}\d])\p{Lu}\p{L}+/gu)) {
    if (m.index === first) continue;
    if (!factWords.has(m[0].toLocaleLowerCase("pt-BR")))
      return `"${m[0]}" não está no relatório`;
  }
  return null;
}

/** Separa as frases da IA que batem com os fatos das que não batem. */
export function verifyAiText(text: string, facts: string) {
  const known = knownCited(facts);
  const words = wordsOf(facts);
  const kept: string[] = [];
  const dropped: { sentence: string; reason: string }[] = [];
  for (const s of splitSentences(text)) {
    const reason = sentenceProblem(s, known, words);
    if (reason) dropped.push({ sentence: s, reason });
    else kept.push(s);
  }
  return { kept, dropped };
}

/**
 * Destaque redigido pela IA: só vale se cada frase cita apenas o que está no
 * texto de modelo daquele destaque. Senão, volta o texto de modelo.
 */
export function verifyAttention(
  items: AttentionItem[],
  ai: { id: string; text: string }[],
): (AttentionItem & { ai: boolean })[] {
  return items.map((item) => {
    const text = ai.find((a) => a.id === item.id)?.text?.trim() ?? "";
    const check = verifyAiText(text, item.text);
    return check.kept.length && !check.dropped.length
      ? { ...item, text: check.kept.join(" "), ai: true }
      : { ...item, ai: false };
  });
}
