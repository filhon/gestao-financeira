/**
 * Índice de acerto da previsão de caixa: o que o sistema previa em cada
 * segunda-feira para 1, 4 e 13 semanas, contra o que passou pelo banco.
 *
 * A previsão de cada data é reconstituída: o que já estava lançado, com o valor
 * e o vencimento daquele dia (a auditoria guarda os anteriores), mais as
 * recorrências que já rodavam. Sem Firebase de propósito.
 */
import currency from "currency.js";
import { addDays, format, startOfDay, startOfWeek, subDays } from "date-fns";
import type { Transaction } from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { effectiveDate } from "./chartOfAccounts";
import { groupKey, planRoles } from "./plan";
import { flowAmount, stageOf } from "./reports";

export const HORIZONS = [1, 4, 13] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Side = Transaction["type"];

/** Segundas-feiras medidas, contando para trás. */
export const ORIGINS = 26;

/** Valor ou vencimento antes de uma edição, tirado da auditoria. */
export interface HistoryChange {
  id: string;
  at: Date;
  field: "amount" | "dueDate";
  old: number | Date;
}

export const CAUSES = {
  late_entry: {
    label: "Lançado depois",
    hint: "Não estava no sistema quando a previsão foi feita",
  },
  postponed: {
    label: "Não saiu na data",
    hint: "Previsto na janela e pago ou recebido depois, ou ainda em aberto",
  },
  shifted: {
    label: "Pago fora da data",
    hint: "Já lançado, com vencimento fora da janela",
  },
  value: {
    label: "Valor mudou",
    hint: "Saiu na data, com outro valor",
  },
} as const;
export type Cause = keyof typeof CAUSES;

export interface AccuracyItem {
  id: string;
  side: Side;
  description: string;
  party: string;
  cause: Cause;
  forecast: number;
  actual: number;
}

export interface AccuracyPoint {
  /** Segunda-feira da previsão, yyyy-MM-dd. */
  origin: string;
  /** Último dia da janela. */
  end: string;
  forecast: Record<Side, number>;
  actual: Record<Side, number>;
}

export interface SideStats {
  forecast: number;
  actual: number;
  /** Σ|realizado − previsto| ÷ Σ realizado; null sem realizado. */
  error: number | null;
  /** 1 − erro, nunca abaixo de zero. */
  accuracy: number | null;
  /** (previsto − realizado) ÷ realizado: positivo previu demais. */
  bias: number | null;
}

export interface CauseStats {
  cause: Cause;
  /** Lançamentos e diferença (realizado − previsto) por previsão, em média. */
  count: number;
  amount: number;
}

export interface HorizonReport {
  weeks: Horizon;
  points: AccuracyPoint[];
  sides: Record<Side, SideStats>;
  /** Erro do saldo: média, e o teto de 8 em cada 10 previsões. */
  balance: { mean: number; p80: number; worst: number } | null;
  causes: Record<Side, CauseStats[]>;
  /** As maiores diferenças da última previsão que já venceu. */
  last: { origin: string; end: string; items: AccuracyItem[] } | null;
}

export interface AccuracyReport {
  horizons: HorizonReport[];
  /** Primeira data que dá para reconstituir. */
  since: string | null;
}

const SIDES: Side[] = ["receivable", "payable"];
const key = (d: Date) => format(d, "yyyy-MM-dd");
const add = (a: number, b: number) => currency(a).add(b).value;

/** Implantação do saldo não é movimento que alguém pudesse prever. */
export const isOpeningEntry = (t: Pick<Transaction, "description">) =>
  /^saldo inicial/i.test((t.description ?? "").trim());

const RECURRING = /\(recorrência\)\s*$/i;
/** Recorrência de mesma origem: o modelo, ou a descrição com o favorecido. */
function seriesOf(t: Transaction): string | null {
  if (t.recurringTemplateId) return `m:${t.recurringTemplateId}`;
  const d = (t.description ?? "").trim();
  if (!RECURRING.test(d)) return null;
  return [
    "d",
    t.type,
    t.entityId ?? t.supplierOrClient ?? "",
    d.replace(RECURRING, "").trim().toLowerCase(),
  ].join("|");
}

export function buildAccuracy(
  transactions: Transaction[],
  changes: HistoryChange[],
  today: Date,
  nameOf: (t: Transaction) => string,
): AccuracyReport {
  const now = startOfDay(today);
  const list = transactions.filter((t) => t.createdAt && !isOpeningEntry(t));

  const history = new Map<string, HistoryChange[]>();
  for (const c of [...changes].sort((a, b) => a.at.getTime() - b.at.getTime()))
    history.set(c.id, [...(history.get(c.id) ?? []), c]);

  /** O valor do campo naquele dia: o "antes" da primeira edição seguinte. */
  const asOf = <T extends number | Date>(
    t: Transaction,
    field: HistoryChange["field"],
    at: Date,
    current: T,
  ): T =>
    (history.get(t.id)?.find((c) => c.field === field && c.at >= at)
      ?.old as T) ?? current;

  // Recebimento dividido à mão em "(1/3)", "(2/3)"…: as partes criadas depois
  // são a mesma previsão, não lançamento novo. Contam juntas na causa.
  const roles = planRoles(list);
  const split = new Set(
    list.filter((t) => roles.get(t.id)!.split).map((t) => groupKey(t)!),
  );
  const unitOf = (t: Transaction) => {
    const k = groupKey(t);
    return k && split.has(k) ? k : t.id;
  };

  const settledAt = (t: Transaction) =>
    stageOf(t) === "realized" ? startOfDay(effectiveDate(t)) : null;

  const seriesStart = new Map<string, number>();
  for (const t of list) {
    const s = seriesOf(t);
    if (!s) continue;
    const at = t.createdAt.getTime();
    seriesStart.set(s, Math.min(seriesStart.get(s) ?? Infinity, at));
  }
  /** Estava lançado, ou a recorrência que o gerou já rodava. */
  const isKnown = (t: Transaction, at: Date) => {
    if (t.createdAt < at) return true;
    const s = seriesOf(t);
    return !!s && seriesStart.get(s)! < at.getTime();
  };

  const first = list.reduce<number | null>((m, t) => {
    const at = t.createdAt.getTime();
    return m === null ? at : Math.min(m, at);
  }, null);
  if (first === null) return { horizons: [], since: null };
  // Na primeira semana o sistema ainda estava sendo preenchido.
  const since = addDays(startOfWeek(new Date(first), { weekStartsOn: 1 }), 14);

  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });

  const horizons = HORIZONS.map((weeks): HorizonReport => {
    const points: AccuracyPoint[] = [];
    const causeSum: Record<Side, Record<Cause, { n: number; v: number }>> = {
      receivable: emptyCauses(),
      payable: emptyCauses(),
    };
    let last: HorizonReport["last"] = null;

    for (let i = 0; i < ORIGINS; i++) {
      const origin = subDays(thisMonday, 7 * (weeks + i));
      if (origin < since) break;
      const end = addDays(origin, 7 * weeks);
      const forecast: Record<Side, number> = { receivable: 0, payable: 0 };
      const actual: Record<Side, number> = { receivable: 0, payable: 0 };
      const units = new Map<
        string,
        { t: Transaction; known: boolean; f: number; a: number }
      >();

      for (const t of list) {
        if (t.status === "rejected") continue;
        const paid = settledAt(t);
        if (paid && paid < origin) continue;
        const known = isKnown(t, origin);
        const due = startOfDay(asOf(t, "dueDate", origin, t.dueDate));
        // A regra do relatório: a pagar vencido sai logo; a receber vencido
        // não conta.
        const late = due < origin;
        const inForecast = known && (late ? t.type === "payable" : due < end);
        const f = inForecast ? asOf(t, "amount", origin, t.amount) : 0;
        const a = paid && paid < end ? flowAmount(t) : 0;
        if (!f && !a) continue;

        forecast[t.type] = add(forecast[t.type], f);
        actual[t.type] = add(actual[t.type], a);
        const id = unitOf(t);
        const u = units.get(id) ?? { t, known: false, f: 0, a: 0 };
        // O detalhe abre a parte que já estava na previsão.
        if (f && !u.f) u.t = t;
        u.known ||= known;
        u.f = add(u.f, f);
        u.a = add(u.a, a);
        units.set(id, u);
      }

      const items: AccuracyItem[] = [];
      for (const { t, known, f, a } of units.values()) {
        const diff = currency(a).subtract(f).value;
        if (diff === 0) continue;
        const cause: Cause =
          f && a ? "value" : f ? "postponed" : known ? "shifted" : "late_entry";
        const sum = causeSum[t.type][cause];
        sum.n++;
        sum.v = add(sum.v, diff);
        if (i === 0)
          items.push({
            id: t.id,
            side: t.type,
            description: t.description ?? "",
            party: nameOf(t),
            cause,
            forecast: f,
            actual: a,
          });
      }

      points.unshift({
        origin: key(origin),
        end: key(subDays(end, 1)),
        forecast,
        actual,
      });
      if (i === 0)
        last = {
          origin: key(origin),
          end: key(subDays(end, 1)),
          items: items
            .sort(
              (x, y) =>
                Math.abs(y.actual - y.forecast) -
                Math.abs(x.actual - x.forecast),
            )
            .slice(0, 15),
        };
    }

    const stats = (side: Side): SideStats => {
      const sum = (pick: (p: AccuracyPoint) => number) =>
        points.reduce((s, p) => s.add(pick(p)), currency(0)).value;
      const f = sum((p) => p.forecast[side]);
      const a = sum((p) => p.actual[side]);
      const miss = sum((p) => Math.abs(p.actual[side] - p.forecast[side]));
      const error = a > 0 ? miss / a : null;
      return {
        forecast: f,
        actual: a,
        error,
        accuracy: error === null ? null : Math.max(0, 1 - error),
        bias: a > 0 ? currency(f).subtract(a).value / a : null,
      };
    };

    const misses = points
      .map((p) =>
        Math.abs(
          currency(p.actual.receivable)
            .subtract(p.actual.payable)
            .subtract(p.forecast.receivable)
            .add(p.forecast.payable).value,
        ),
      )
      .sort((x, y) => x - y);
    const n = points.length;

    return {
      weeks,
      points,
      sides: { receivable: stats("receivable"), payable: stats("payable") },
      balance: n
        ? {
            mean: currency(misses.reduce((s, v) => s + v, 0)).divide(n).value,
            p80: misses[Math.ceil(n * 0.8) - 1],
            worst: misses[n - 1],
          }
        : null,
      causes: Object.fromEntries(
        SIDES.map((side) => [
          side,
          (Object.keys(CAUSES) as Cause[])
            .map((cause) => ({
              cause,
              count: n ? causeSum[side][cause].n / n : 0,
              amount: n ? currency(causeSum[side][cause].v).divide(n).value : 0,
            }))
            .filter((c) => c.count > 0)
            .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)),
        ]),
      ) as Record<Side, CauseStats[]>,
      last,
    };
  });

  return { horizons, since: key(since) };
}

const emptyCauses = () =>
  Object.fromEntries(
    Object.keys(CAUSES).map((c) => [c, { n: 0, v: 0 }]),
  ) as Record<Cause, { n: number; v: number }>;

/** A conclusão da tela, para o horizonte escolhido. */
export function accuracyTitle(
  h: HorizonReport,
  money: (v: number) => string,
): string {
  const when = h.weeks === 1 ? "Em 1 semana" : `Em ${h.weeks} semanas`;
  if (!h.balance) return `${when}: ainda não há previsão vencida para medir.`;
  const part = (s: SideStats) =>
    s.accuracy === null ? "sem movimento" : `${Math.round(s.accuracy * 100)}%`;
  return `${when}, a previsão acerta ${part(h.sides.payable)} das saídas e ${part(h.sides.receivable)} das entradas; o saldo erra ${money(h.balance.mean)} em média.`;
}

/** Extrai da auditoria o valor e o vencimento anteriores de cada edição. */
export function historyOf(
  logs: {
    entityId?: string;
    createdAt?: Date;
    details?: { changes?: unknown };
  }[],
  toDate: (v: unknown) => Date | null,
): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const log of logs) {
    const changes = log.details?.changes;
    if (!log.entityId || !log.createdAt || !Array.isArray(changes)) continue;
    for (const c of changes as { field?: string; oldValue?: unknown }[]) {
      if (c.field === "amount" && typeof c.oldValue === "number")
        out.push({
          id: log.entityId,
          at: log.createdAt,
          field: "amount",
          old: c.oldValue,
        });
      if (c.field === "dueDate") {
        const old = toDate(c.oldValue);
        if (old)
          out.push({
            id: log.entityId,
            at: log.createdAt,
            field: "dueDate",
            old,
          });
      }
    }
  }
  return out;
}
