import currency from "currency.js";
import {
  differenceInCalendarDays,
  getDayOfYear,
  getDaysInYear,
  startOfDay,
} from "date-fns";

/**
 * Regras puras do dashboard (sem Firebase), para poderem ser verificadas em
 * `npm run check:dashboard`.
 */

export type EnvelopeStatus = "success" | "warning" | "danger" | "no-budget";

/**
 * Quanto do exercício já passou, em %. `null` para exercício futuro, em que
 * ainda não há ritmo a comparar.
 */
export function envelopePace(year: number, today = new Date()): number | null {
  const current = today.getFullYear();
  if (year > current) return null;
  if (year < current) return 100;
  return (getDayOfYear(today) / getDaysInYear(today)) * 100;
}

/**
 * Duas perguntas diferentes, duas medidas:
 * - Ainda cabe despesa? Comprometido ÷ envelope. Vermelho acima de 100%.
 * - Está gastando rápido demais? Pago ÷ envelope contra o tempo decorrido.
 *   Amarelo quando o pago passa 10 pontos do ritmo. Comprometido não entra
 *   aqui: quem empenhou o ano inteiro em janeiro planejou, não acelerou.
 * Um centro pai que repassou todo o envelope aos filhos está fazendo o
 * trabalho dele, então o ritmo só vale para folhas. E quem já pagou tudo o
 * que comprometeu não tem ritmo a vigiar: é projeto concluído, não gasto
 * acelerado.
 * - Ainda há exercício pela frente e a folha está a 95% ou mais, com contas
 *   por pagar? Amarelo "sem folga": com o bloqueio duro, a próxima despesa
 *   nesse centro será recusada.
 */
export function envelopeStatus(
  envelope: number,
  committed: number,
  paid: number,
  isLeaf: boolean,
  pace: number | null,
): {
  percentage: number;
  paidPercentage: number;
  status: EnvelopeStatus;
  /** Folha sem pendência e sem folga: tudo comprometido já foi pago. */
  exhausted: boolean;
  /** Folha em uso, a 95% ou mais, com exercício pela frente. */
  tight: boolean;
} {
  const pct = (v: number) =>
    envelope > 0 ? Math.round((v / envelope) * 100) : 0;
  const percentage = pct(committed);
  const paidPercentage = pct(paid);
  const pending = currency(committed).subtract(paid).value;
  const exhausted = isLeaf && envelope > 0 && pending <= 0 && percentage >= 100;
  const tight =
    isLeaf &&
    envelope > 0 &&
    !exhausted &&
    percentage >= 95 &&
    percentage <= 100 &&
    pace !== null &&
    pace < 100;
  const result = (status: EnvelopeStatus) => ({
    percentage,
    paidPercentage,
    status,
    exhausted,
    tight,
  });
  if (envelope === 0) return result(committed > 0 ? "danger" : "no-budget");
  if (percentage > 100) return result("danger");
  if (tight) return result("warning");
  if (isLeaf && pace !== null && pending > 0 && paidPercentage > pace + 10) {
    return result("warning");
  }
  return result("success");
}

// ── Dias úteis ───────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const holidayCache = new Map<number, Set<string>>();

/**
 * Feriados bancários nacionais (sem expediente de compensação): os fixos,
 * mais Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi.
 * ponytail: feriados estaduais e municipais ficam de fora; entram por
 * cadastro da empresa se alguém precisar.
 */
export function bankHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const e = easter(year);
  const shift = (days: number) =>
    iso(new Date(e.getFullYear(), e.getMonth(), e.getDate() + days));
  const set = new Set([
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`,
    shift(-48), // Carnaval (segunda)
    shift(-47), // Carnaval (terça)
    shift(-2), // Sexta-feira Santa
    shift(60), // Corpus Christi
  ]);
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(d: Date) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !bankHolidays(d.getFullYear()).has(iso(d));
}

/**
 * Conta que vence em fim de semana ou feriado se paga no dia útil seguinte
 * sem encargo, e é nesse dia que o dinheiro sai ou entra.
 */
export function nextBusinessDay(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (!isBusinessDay(r)) r.setDate(r.getDate() + 1);
  return r;
}

// ── Eixo ─────────────────────────────────────────────────────────────────────

/**
 * Marcas redondas (1, 2, 2,5 ou 5 × 10ⁿ) cobrindo [min, max], sempre com o
 * zero quando o intervalo o atravessa: o leitor encontra o R$ 0 sem rótulo.
 */
export function niceTicks(min: number, max: number, count = 6): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

export interface NegativeRun<T> {
  start: T;
  end: T;
  lowest: T;
  /** Vai até o último ponto da projeção. */
  open: boolean;
}

/** Trechos contínuos de saldo negativo: "amanhã" e "de 31/10 a 22/11" são dois. */
export function negativeRuns<T extends { balance: number }>(
  points: T[],
): NegativeRun<T>[] {
  const runs: NegativeRun<T>[] = [];
  let current: NegativeRun<T> | null = null;
  points.forEach((p, i) => {
    if (p.balance < 0) {
      if (!current) {
        current = { start: p, end: p, lowest: p, open: false };
        runs.push(current);
      }
      current.end = p;
      if (p.balance < current.lowest.balance) current.lowest = p;
      current.open = i === points.length - 1;
    } else {
      current = null;
    }
  });
  return runs;
}

/**
 * Menor conjunto de contrapartes em atraso que cobre `deficit`, começando
 * pelos atrasos mais recentes: são os mais prováveis de entrar. `null` se nem
 * todos juntos cobrem.
 */
export function coveringCounterparts<T extends { oldest: Date; total: number }>(
  groups: T[],
  deficit: number,
): T[] | null {
  const byRecency = [...groups].sort(
    (a, b) => b.oldest.getTime() - a.oldest.getTime(),
  );
  const chosen: T[] = [];
  let sum = currency(0);
  for (const g of byRecency) {
    if (sum.value >= deficit) break;
    chosen.push(g);
    sum = sum.add(g.total);
  }
  return sum.value >= deficit ? chosen : null;
}

/** Risco primeiro; no mesmo nível, folhas antes dos pais. */
export function envelopeRank(d: { status: EnvelopeStatus; isLeaf: boolean }) {
  if (d.status === "danger") return 0;
  if (d.status === "warning") return 1;
  if (d.status === "no-budget") return 4;
  return d.isLeaf ? 2 : 3;
}

export interface CounterpartGroup<T> {
  key: string;
  name: string;
  count: number;
  total: number;
  /** Parte do total vencida há mais de 90 dias: crédito duvidoso. */
  over90: number;
  oldest: Date;
  items: T[];
}

/**
 * Cobrança e pagamento se fazem por contraparte, não por parcela: oito
 * doações atrasadas do mesmo doador são uma conversa só. Maior total primeiro.
 */
export function groupByCounterpart<
  T extends {
    entityId?: string;
    supplierOrClient?: string;
    amount: number;
    dueDate: Date;
  },
>(items: T[], today = startOfDay(new Date())): CounterpartGroup<T>[] {
  const groups = new Map<string, CounterpartGroup<T>>();
  for (const t of items) {
    const name = (t.supplierOrClient ?? "").trim() || "Sem contraparte";
    const key = t.entityId || name.toLowerCase();
    const late = differenceInCalendarDays(today, t.dueDate) > 90 ? t.amount : 0;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.total = currency(g.total).add(t.amount).value;
      g.over90 = currency(g.over90).add(late).value;
      if (t.dueDate < g.oldest) g.oldest = t.dueDate;
      g.items.push(t);
    } else {
      groups.set(key, {
        key,
        name,
        count: 1,
        total: currency(t.amount).value,
        over90: currency(late).value,
        oldest: t.dueDate,
        items: [t],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export interface SimulatedEntry {
  id: string;
  amount: number;
  type: "receivable" | "payable";
  date: string; // "yyyy-MM-dd"
}

/**
 * Cada simulação entra no balde que contém a sua data (dia no modo 30 dias,
 * semana no modo ano) e se acumula daí em diante.
 */
export function annotateWithSimulations<
  T extends { isoDate: string; balance: number },
>(
  data: T[],
  simulations: SimulatedEntry[],
): (T & { simulatedBalance?: number })[] {
  if (simulations.length === 0) return data;
  return data.map((point, i) => {
    const nextStart = data[i + 1]?.isoDate;
    const delta = simulations.reduce(
      (acc, s) =>
        nextStart === undefined || s.date < nextStart
          ? acc.add(s.type === "receivable" ? s.amount : -s.amount)
          : acc,
      currency(0),
    );
    return {
      ...point,
      simulatedBalance: currency(point.balance).add(delta).value,
    };
  });
}
