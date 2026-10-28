/**
 * Regras dos relatórios gerenciais: fluxo de caixa por estágio, períodos,
 * comparação e saldo inicial.
 *
 * Sem Firebase de propósito: a tela, as exportações e o script de verificação
 * aplicam as mesmas regras. Valor e data efetiva vêm de `chartOfAccounts`, os
 * mesmos da DRE, para que os dois relatórios nunca discordem sobre o que é um
 * lançamento no período.
 */
import currency from "currency.js";
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  isAfter,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  Entity,
  RecurringTransactionTemplate,
  Transaction,
} from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { dreAmount, effectiveDate } from "./chartOfAccounts";
import { MAIN_BANK_ACCOUNT } from "./entityBankAccounts";

// ─── Estágios do fluxo ────────────────────────────────────────────────────────

/**
 * Quão certo é o dinheiro. Realizado já passou pelo banco; o resto é previsto,
 * do mais firme (autorizado ou já num lote) ao mais incerto (rascunho).
 */
export type FlowStage =
  | "realized"
  | "confirmed"
  | "approved"
  | "in_approval"
  | "recurring"
  | "draft";

export const STAGE_INFO: Record<FlowStage, { label: string; hint: string }> = {
  realized: { label: "Realizado", hint: "Pago ou recebido" },
  confirmed: {
    label: "Autorizado ou em lote",
    hint: "Liberado para pagamento",
  },
  approved: { label: "Aprovado", hint: "Aguarda autorização" },
  in_approval: { label: "Em aprovação", hint: "Ainda pode ser rejeitado" },
  recurring: { label: "Recorrências", hint: "Ainda não lançadas" },
  draft: { label: "Rascunho", hint: "Pode não seguir adiante" },
};

/** Previsto, do mais firme ao menos firme. */
export const FORECAST_STAGES: FlowStage[] = [
  "confirmed",
  "approved",
  "in_approval",
  "recurring",
  "draft",
];

export const DEFAULT_FORECAST: FlowStage[] = [
  "confirmed",
  "approved",
  "in_approval",
  "recurring",
];

export const PROJECTION_PREFIX = "proj_";
export const isProjection = (t: Pick<Transaction, "id">) =>
  t.id.startsWith(PROJECTION_PREFIX);

export function stageOf(t: Transaction): FlowStage | null {
  if (t.status === "rejected") return null;
  // Baixa antiga sem paymentDate também é realizado (vale pelo vencimento).
  if (t.status === "paid" || t.status === "received") return "realized";
  if (isProjection(t)) return "recurring";
  if (
    t.status === "authorized" ||
    t.status === "pending_authorization" ||
    t.batchId
  ) {
    return "confirmed";
  }
  if (t.status === "approved") return "approved";
  if (t.status === "pending_approval") return "in_approval";
  return "draft";
}

/** Situação legível: "Pago"/"Recebido" quando realizado, senão o estágio. */
export function situationOf(t: Transaction) {
  const stage = stageOf(t);
  if (!stage) return "Rejeitado";
  if (stage !== "realized") return STAGE_INFO[stage].label;
  return t.type === "receivable" ? "Recebido" : "Pago";
}

/**
 * Valor no fluxo: o pago quando já saiu; antes disso, o ajustado pelo
 * aprovador do lote, que é o que vai sair.
 */
export function flowAmount(t: Transaction, costCenterIds?: readonly string[]) {
  const settled = t.status === "paid" || t.status === "received";
  return dreAmount(
    settled ? t : { ...t, finalAmount: t.batchAdjustedAmount ?? t.finalAmount },
    costCenterIds,
  );
}

const signed = (t: Transaction, amount: number) =>
  t.type === "receivable" ? amount : -amount;

// ─── Fluxo de caixa ───────────────────────────────────────────────────────────

export type Granularity = "day" | "month";

export interface FlowLine {
  tx: Transaction;
  stage: FlowStage;
  date: Date;
  /** Sempre positivo; `tx.type` diz o sentido. */
  amount: number;
}

export interface FlowBucket {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  /** Saldo ao fim do período do balde. */
  balance: number;
  lines: FlowLine[];
  /** Há previsto no balde (não só realizado). */
  forecast: boolean;
}

export interface StageTotal {
  stage: FlowStage;
  inflow: number;
  outflow: number;
  lines: FlowLine[];
}

export interface CashFlowReport {
  opening: number;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
  /** Menor saldo ao fim de um dia com movimento (ou o inicial). */
  lowest: { balance: number; date: Date };
  buckets: FlowBucket[];
  byStage: StageTotal[];
  lines: FlowLine[];
}

export interface FlowOptions {
  start: Date;
  end: Date;
  opening?: number;
  stages: readonly FlowStage[];
  costCenterIds?: readonly string[];
  granularity: Granularity;
}

/** Até ~2 meses o fluxo vai dia a dia; acima disso, mês a mês. */
export const defaultGranularity = (start: Date, end: Date): Granularity =>
  differenceInCalendarDays(end, start) <= 62 ? "day" : "month";

export function buildCashFlow(
  transactions: Transaction[],
  o: FlowOptions,
): CashFlowReport {
  const from = startOfDay(o.start);
  const to = endOfDay(o.end);
  const wanted = new Set(o.stages);
  const opening = currency(o.opening ?? 0);

  const lines: FlowLine[] = [];
  for (const tx of transactions) {
    const stage = stageOf(tx);
    if (!stage || !wanted.has(stage)) continue;
    const date = effectiveDate(tx);
    if (date < from || date > to) continue;
    const amount = flowAmount(tx, o.costCenterIds);
    if (!amount) continue;
    lines.push({ tx, stage, date, amount });
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime());

  const keyOf = (d: Date) =>
    format(d, o.granularity === "day" ? "yyyy-MM-dd" : "yyyy-MM");
  const labelOf = (d: Date) =>
    o.granularity === "day"
      ? format(d, "dd/MM/yyyy")
      : format(d, "MMM/yyyy", { locale: ptBR });

  const buckets = new Map<string, FlowBucket>();
  if (o.granularity === "month") {
    // Mês sem movimento também aparece: a lacuna é informação.
    for (let d = startOfMonth(from); d <= to; d = addMonths(d, 1)) {
      buckets.set(keyOf(d), {
        key: keyOf(d),
        label: labelOf(d),
        inflow: 0,
        outflow: 0,
        net: 0,
        balance: 0,
        lines: [],
        forecast: false,
      });
    }
  }

  const stageTotals = new Map<FlowStage, StageTotal>(
    [...wanted].map((stage) => [
      stage,
      { stage, inflow: 0, outflow: 0, lines: [] },
    ]),
  );

  let inflow = currency(0);
  let outflow = currency(0);

  for (const line of lines) {
    const key = keyOf(line.date);
    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        label: labelOf(line.date),
        inflow: 0,
        outflow: 0,
        net: 0,
        balance: 0,
        lines: [],
        forecast: false,
      };
      buckets.set(key, b);
    }
    const isIn = line.tx.type === "receivable";
    if (isIn) {
      b.inflow = currency(b.inflow).add(line.amount).value;
      inflow = inflow.add(line.amount);
    } else {
      b.outflow = currency(b.outflow).add(line.amount).value;
      outflow = outflow.add(line.amount);
    }
    b.lines.push(line);
    if (line.stage !== "realized") b.forecast = true;

    const st = stageTotals.get(line.stage)!;
    if (isIn) st.inflow = currency(st.inflow).add(line.amount).value;
    else st.outflow = currency(st.outflow).add(line.amount).value;
    st.lines.push(line);
  }

  // Saldo acumulado por balde, na ordem do calendário.
  let balance = opening;
  const ordered = [...buckets.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  for (const b of ordered) {
    b.net = currency(b.inflow).subtract(b.outflow).value;
    balance = balance.add(b.net);
    b.balance = balance.value;
  }

  return {
    opening: opening.value,
    inflow: inflow.value,
    outflow: outflow.value,
    net: inflow.subtract(outflow).value,
    closing: balance.value,
    lowest: lowestAtDayEnd(lines, opening.value, from),
    buckets: ordered,
    byStage: [...stageTotals.values()].sort(
      (a, b) =>
        ["realized", ...FORECAST_STAGES].indexOf(a.stage) -
        ["realized", ...FORECAST_STAGES].indexOf(b.stage),
    ),
    lines,
  };
}

/** Menor saldo de fim de dia; um pagamento e um recebimento no mesmo dia se compensam. */
function lowestAtDayEnd(lines: FlowLine[], opening: number, from: Date) {
  let running = currency(opening);
  let lowest = { balance: opening, date: from };
  lines.forEach((line, i) => {
    running = running.add(signed(line.tx, line.amount));
    const next = lines[i + 1];
    if (next && isSameDay(next.date, line.date)) return;
    if (running.value < lowest.balance) {
      lowest = { balance: running.value, date: line.date };
    }
  });
  return lowest;
}

// ─── Recorrências ainda não lançadas ──────────────────────────────────────────

/**
 * Ocorrências futuras dos modelos de recorrência dentro do período. O job
 * noturno lança a próxima ocorrência e avança `nextDueDate`, então daqui em
 * diante nada está lançado ainda e não há duplicidade com as transações.
 */
export function projectRecurrences(
  templates: RecurringTransactionTemplate[],
  start: Date,
  end: Date,
): Transaction[] {
  const from = startOfDay(start);
  const to = endOfDay(end);
  const out: Transaction[] = [];
  for (const template of templates) {
    const interval = template.interval || 1;
    let next = template.nextDueDate;
    let guard = 0;
    while (
      next &&
      !isAfter(next, to) &&
      (!template.endDate || !isAfter(next, template.endDate)) &&
      guard++ < 1000
    ) {
      if (next >= from) {
        out.push({
          ...template.baseTransactionData,
          id: `${PROJECTION_PREFIX}${template.id}_${next.getTime()}`,
          companyId: template.companyId,
          description: template.description,
          amount: template.amount,
          finalAmount: undefined,
          type: template.type,
          status: "draft",
          dueDate: next,
          paymentDate: undefined,
          batchId: undefined,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
          createdBy: template.baseTransactionData.createdBy ?? "system",
        } as Transaction);
      }
      next =
        template.frequency === "daily"
          ? addDays(next, interval)
          : template.frequency === "weekly"
            ? addWeeks(next, interval)
            : template.frequency === "yearly"
              ? addYears(next, interval)
              : addMonths(next, interval);
    }
  }
  return out;
}

// ─── Saldo inicial ────────────────────────────────────────────────────────────

/**
 * Saldo no início do período a partir do saldo de hoje.
 *
 * Período que começa no passado: desfaz o que foi pago ou recebido do início
 * até hoje. Período futuro: soma o previsto de hoje até a véspera do início.
 * `movements` precisa cobrir esse intervalo.
 * ponytail: contas vencidas e não pagas antes de hoje não entram no saldo de
 * um período futuro; o dashboard as trata à parte, aqui ficam de fora.
 */
export function openingFromToday(
  todayBalance: number,
  start: Date,
  today: Date,
  movements: Transaction[],
  stages: readonly FlowStage[] = DEFAULT_FORECAST,
) {
  const from = startOfDay(start);
  const now = endOfDay(today);
  let balance = currency(todayBalance);
  if (from <= now) {
    for (const t of movements) {
      if (stageOf(t) !== "realized") continue;
      const d = effectiveDate(t);
      if (d >= from && d <= now) {
        balance = balance.subtract(signed(t, flowAmount(t)));
      }
    }
    return balance.value;
  }
  const wanted = new Set(stages);
  const tomorrow = startOfDay(addDays(today, 1));
  for (const t of movements) {
    const stage = stageOf(t);
    if (!stage || stage === "realized" || !wanted.has(stage)) continue;
    if (t.dueDate >= tomorrow && t.dueDate < from) {
      balance = balance.add(signed(t, flowAmount(t)));
    }
  }
  return balance.value;
}

// ─── Períodos ─────────────────────────────────────────────────────────────────

export interface Period {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

/** Calculado na hora: a aba aberta na virada do mês não fica com o mês velho. */
export function quickPeriods(today = new Date()): Period[] {
  const lastMonth = subMonths(today, 1);
  const lastYear = subYears(today, 1);
  return [
    {
      key: "month",
      label: "Este mês",
      start: startOfMonth(today),
      end: endOfMonth(today),
    },
    {
      key: "last_month",
      label: "Mês anterior",
      start: startOfMonth(lastMonth),
      end: endOfMonth(lastMonth),
    },
    {
      key: "quarter",
      label: "Este trimestre",
      start: startOfQuarter(today),
      end: endOfQuarter(today),
    },
    {
      key: "year",
      label: "Este ano",
      start: startOfYear(today),
      end: endOfYear(today),
    },
    {
      key: "last_year",
      label: "Ano anterior",
      start: startOfYear(lastYear),
      end: endOfYear(lastYear),
    },
    {
      key: "last_12",
      label: "Últimos 12 meses",
      start: startOfMonth(subMonths(today, 11)),
      end: endOfMonth(today),
    },
  ];
}

export type Comparison = "none" | "previous" | "year";

const isWholeMonths = (start: Date, end: Date) =>
  isSameDay(start, startOfMonth(start)) && isSameDay(end, endOfMonth(end));

/**
 * Período de comparação. Meses inteiros comparam com os meses inteiros
 * anteriores (fevereiro contra janeiro, não contra os 28 dias antes dele).
 */
export function comparisonRange(
  start: Date,
  end: Date,
  mode: Comparison,
): { start: Date; end: Date } | null {
  if (mode === "none") return null;
  const whole = isWholeMonths(start, end);
  if (mode === "year") {
    const s = subYears(start, 1);
    return {
      start: s,
      end: whole ? endOfMonth(subYears(end, 1)) : subYears(end, 1),
    };
  }
  if (whole) {
    const months = differenceInCalendarMonths(end, start) + 1;
    return {
      start: subMonths(start, months),
      end: endOfMonth(subMonths(end, months)),
    };
  }
  const days = differenceInCalendarDays(end, start) + 1;
  return { start: subDays(start, days), end: subDays(end, days) };
}

/** Variação relativa (AH). Sem base, não há porcentagem que signifique algo. */
export function variation(current: number, previous: number): number | null {
  if (!previous) return null;
  return currency(current).subtract(previous).value / Math.abs(previous);
}

export const formatPercent = (v: number | null, signedValue = false) =>
  v === null || !Number.isFinite(v)
    ? "—"
    : `${signedValue && v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}%`;

export const periodText = (start: Date, end: Date) =>
  `${format(start, "dd/MM/yyyy")} a ${format(end, "dd/MM/yyyy")}`;

export const periodSlug = (start: Date, end: Date) =>
  `${format(start, "yyyyMMdd")}_${format(end, "yyyyMMdd")}`;

// ─── Pagamentos de uma entidade (extrato para parceiro) ───────────────────────

/**
 * Lançamento da entidade — pelo cadastro ou, nos antigos sem cadastro, pelo
 * nome — e, se pedida, da conta dela que recebeu (ausente = principal).
 */
export function belongsTo(
  t: Transaction,
  entity: Pick<Entity, "id" | "name">,
  accountId?: string,
) {
  const own = t.entityId
    ? t.entityId === entity.id
    : t.supplierOrClient === entity.name;
  return (
    own &&
    (!accountId || (t.entityBankAccountId ?? MAIN_BANK_ACCOUNT) === accountId)
  );
}

export interface PaymentLine {
  tx: Transaction;
  /** Data da baixa (vencimento nas baixas antigas sem data). */
  date: Date;
  amount: number;
}

/** Pago (ou recebido) no período, pela data da baixa, do mais antigo ao mais novo. */
export function buildPayments(
  transactions: Transaction[],
  opts: {
    start: Date;
    end: Date;
    type: Transaction["type"];
    costCenterIds?: readonly string[];
  },
) {
  const from = startOfDay(opts.start);
  const to = endOfDay(opts.end);
  const lines: PaymentLine[] = transactions
    .filter((t) => t.type === opts.type && stageOf(t) === "realized")
    .map((t) => ({
      tx: t,
      date: t.paymentDate ?? t.dueDate,
      amount: flowAmount(t, opts.costCenterIds),
    }))
    .filter((l) => l.date >= from && l.date <= to && l.amount !== 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    lines,
    total: lines.reduce((s, l) => s.add(l.amount), currency(0)).value,
  };
}

export type PaymentsReport = ReturnType<typeof buildPayments>;

// ─── CSV no padrão do Excel em português ──────────────────────────────────────

type CsvCell = string | number | Date | null | undefined;

/**
 * Ponto e vírgula como separador e vírgula decimal: é o que o Excel em
 * pt-BR abre em colunas com um duplo clique. BOM para os acentos.
 */
export function toCsv(rows: CsvCell[][]): string {
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return format(v, "dd/MM/yyyy");
    if (typeof v === "number") return v.toFixed(2).replace(".", ",");
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
