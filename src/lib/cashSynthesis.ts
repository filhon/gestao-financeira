/**
 * Síntese do fluxo de caixa para a contabilidade: prova contra o banco, para
 * onde foi o dinheiro e o que falta para lançar.
 *
 * Sem Firebase de propósito: o PDF, o Excel e `npm run check:reports` usam as
 * mesmas regras.
 */
import currency from "currency.js";
import { format, isSameDay, endOfMonth, startOfMonth, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  BankAccount,
  BankTransaction,
  ChartAccount,
  CostCenter,
  Entity,
  Transaction,
} from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { dayKey, isBalanceLine, isDuplicate } from "./bankReconciliation";
import { parentOf, tidyName } from "./costCenterTree";
import { isBusinessDay } from "./dashboardRules";
import { periodText, type CashFlowReport, type FlowLine } from "./reports";
import { formatCurrency } from "./utils";

// ─── Conferência com o banco ──────────────────────────────────────────────────

export interface ProofRow {
  name: string;
  /** Saldo do banco no fim do período; null sem extrato que chegue até lá. */
  balance: number | null;
  /** Data do fechamento, extrato ou abertura que sustenta o saldo. */
  date: Date | null;
}

export interface BankProof {
  status: "match" | "mismatch" | "uncovered";
  rows: ProofRow[];
  /** Soma das contas; null se alguma não tem extrato até o fim do período. */
  total: number | null;
  /** Sistema − banco. */
  difference: number | null;
}

/** Sem prova: período em andamento, recorte da empresa ou sem acesso às contas. */
export type ProofState =
  | BankProof
  | { status: "open" | "scope" | "unavailable" };

/** O banco não emite saldo novo em fim de semana e feriado. */
function lastBusinessDay(d: Date) {
  let r = d;
  while (!isBusinessDay(r)) r = subDays(r, 1);
  return r;
}

/**
 * Saldo de cada conta no fim do período, do último fechamento, extrato ou
 * abertura até lá mais as linhas do extrato depois dele. Só vale quando algum
 * extrato chega ao último dia útil: sem isso, saldo parado pareceria conferido.
 */
export function proveBalance(
  closing: number,
  accounts: BankAccount[],
  items: BankTransaction[],
  until: Date,
): BankProof {
  const end = dayKey(until);
  const needed = dayKey(lastBusinessDay(until));
  const rows = accounts
    .filter((a) => a.active)
    .map((a): ProofRow => {
      // Empate de data: vale o último da lista, e fechamento vence extrato.
      const bases = [
        { date: new Date(a.openingBalanceDate), balance: a.openingBalance },
        ...(a.statementBalance !== undefined && a.statementBalanceDate
          ? [
              {
                date: new Date(a.statementBalanceDate),
                balance: a.statementBalance,
              },
            ]
          : []),
        ...(a.closings ?? []).map((c) => ({
          date: new Date(c.through),
          balance: c.balance,
        })),
      ];
      const base = bases
        .filter((b) => dayKey(b.date) <= end)
        .sort((x, y) => dayKey(x.date).localeCompare(dayKey(y.date)))
        .at(-1);
      if (!base) return { name: a.name, balance: null, date: null };
      const covered = bases.some((b) => dayKey(b.date) >= needed);
      if (!covered) return { name: a.name, balance: null, date: base.date };
      const after = items.filter(
        (i) =>
          i.bankAccountId === a.id &&
          !isBalanceLine(i) &&
          !isDuplicate(i) &&
          dayKey(i.date) > dayKey(base.date) &&
          dayKey(i.date) <= end,
      );
      return {
        name: a.name,
        balance: after.reduce((s, i) => s.add(i.amount), currency(base.balance))
          .value,
        date: base.date,
      };
    });
  if (rows.length === 0 || rows.some((r) => r.balance === null)) {
    return { status: "uncovered", rows, total: null, difference: null };
  }
  const total = rows.reduce((s, r) => s.add(r.balance!), currency(0)).value;
  const difference = currency(closing).subtract(total).value;
  return {
    status: difference === 0 ? "match" : "mismatch",
    rows,
    total,
    difference,
  };
}

// ─── Para onde foi ────────────────────────────────────────────────────────────

export interface Slice {
  label: string;
  value: number;
  count: number;
  children?: Slice[];
}

export interface AccountSlice {
  label: string;
  inflow: number;
  outflow: number;
  count: number;
  /** Linha dos lançamentos sem conta contábil. */
  missing?: boolean;
}

export interface PersonSlice {
  name: string;
  document: string;
  count: number;
  value: number;
  /** Do que se trata: a natureza decide a retenção. */
  what: string;
}

export interface Gap {
  label: string;
  lines: FlowLine[];
  value: number;
}

export interface CashSynthesis {
  inflows: Slice[];
  areas: Slice[];
  accounts: AccountSlice[];
  /** Parte do movimento com conta contábil (0 a 1). */
  coverage: number;
  people: PersonSlice[];
  gaps: Gap[];
  /** Pagos sem nota nem comprovante: a lista que volta para a equipe. */
  undocumented: FlowLine[];
  /** Saldo ao fim de cada dia com movimento. */
  daily: { date: Date; balance: number }[];
}

export interface SynthesisInput {
  costCenters: CostCenter[];
  accounts: ChartAccount[];
  entities: Entity[];
  costCenterIds?: readonly string[];
  hasReceipt: (t: Transaction) => boolean;
}

const NO_COST_CENTER = "Sem centro de custo";
/** Os que cabem na primeira página. */
const TOP_PAYERS = 5;

const sumLines = (lines: FlowLine[]) =>
  lines.reduce((s, l) => s.add(l.amount), currency(0)).value;

const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
};

/** O valor da linha por centro; a sobra do arredondamento fica no último. */
export function splitByCostCenter(
  line: Pick<FlowLine, "tx" | "amount">,
  costCenterIds?: readonly string[],
): { id: string; amount: number }[] {
  const parts = (line.tx.costCenterAllocation ?? []).filter(
    (a) => !costCenterIds?.length || costCenterIds.includes(a.costCenterId),
  );
  const weight = parts.reduce((s, a) => s + a.percentage, 0);
  if (parts.length === 0 || weight <= 0) {
    return [{ id: line.tx.costCenterId ?? "", amount: line.amount }];
  }
  let left = currency(line.amount);
  return parts.map((a, i) => {
    const amount =
      i === parts.length - 1
        ? left.value
        : currency(line.amount).multiply(a.percentage / weight).value;
    left = left.subtract(amount);
    return { id: a.costCenterId, amount };
  });
}

const bySize = (a: Slice, b: Slice) => b.value - a.value;

export function buildSynthesis(
  report: CashFlowReport,
  o: SynthesisInput,
): CashSynthesis {
  const entityById = new Map(o.entities.map((e) => [e.id, e]));
  const entityOf = (t: Transaction) =>
    t.entityId ? entityById.get(t.entityId) : undefined;
  const partyOf = (t: Transaction) =>
    entityOf(t)?.name || t.supplierOrClient || "Sem nome";
  const digits = (t: Transaction) =>
    (entityOf(t)?.document ?? "").replace(/\D/g, "");

  const ins = report.lines.filter((l) => l.tx.type === "receivable");
  const outs = report.lines.filter((l) => l.tx.type === "payable");

  // Entradas por pagador: os maiores, e o resto numa linha só.
  const payers = [...groupBy(ins, (l) => partyOf(l.tx))]
    .map(([label, lines]) => ({
      label,
      value: sumLines(lines),
      count: lines.length,
    }))
    .sort(bySize);
  const rest = payers.slice(TOP_PAYERS);
  const inflows =
    rest.length > 1
      ? [
          ...payers.slice(0, TOP_PAYERS),
          {
            label: `Outros ${rest.length} pagadores`,
            value: rest.reduce((s, p) => s.add(p.value), currency(0)).value,
            count: rest.reduce((s, p) => s + p.count, 0),
          },
        ]
      : payers;

  // Saídas por centro, dentro da área (o ancestral logo abaixo da raiz).
  const ccById = new Map(o.costCenters.map((c) => [c.id, c]));
  const areaOf = (id: string): string => {
    let current = ccById.get(id);
    let parent = ccById.get(parentOf(current) ?? "");
    while (parent && ccById.has(parentOf(parent) ?? "")) {
      current = parent;
      parent = ccById.get(parentOf(parent) ?? "");
    }
    return current?.id ?? "";
  };
  const nameOf = (id: string) => {
    const cc = ccById.get(id);
    return cc ? tidyName(cc.name) : NO_COST_CENTER;
  };
  /** O centro com o caminho abaixo da área: "Flats, Manutenção". */
  const pathOf = (id: string, areaId: string) => {
    const names: string[] = [];
    for (
      let cc = ccById.get(id);
      cc && cc.id !== areaId;
      cc = ccById.get(parentOf(cc) ?? "")
    ) {
      names.unshift(tidyName(cc.name));
    }
    return names.join(", ") || nameOf(id);
  };
  const shares = outs.flatMap((l) => splitByCostCenter(l, o.costCenterIds));
  const areas = [...groupBy(shares, (s) => areaOf(s.id))]
    .map(([areaId, list]) => {
      const slice = (label: string, xs: typeof list): Slice => ({
        label,
        value: xs.reduce((s, x) => s.add(x.amount), currency(0)).value,
        count: xs.length,
      });
      const children = [...groupBy(list, (s) => s.id)].map(([id, xs]) =>
        slice(pathOf(id, areaId), xs),
      );
      return {
        ...slice(nameOf(areaId), list),
        // Área sem filhos no período: uma linha só.
        children:
          children.length > 1 || children[0].label !== nameOf(areaId)
            ? children.sort(bySize)
            : undefined,
      };
    })
    .sort(bySize);

  // Contas contábeis, na ordem do plano; sem conta por último.
  const accountById = new Map(o.accounts.map((a) => [a.id, a]));
  const accounts = [
    ...groupBy(report.lines, (l) =>
      l.tx.accountId && accountById.has(l.tx.accountId) ? l.tx.accountId : "",
    ),
  ]
    .map(([id, lines]): AccountSlice & { code: string } => {
      const a = accountById.get(id);
      return {
        code: a?.code ?? "",
        label: a ? `${a.code} ${a.name}` : "Sem conta contábil",
        inflow: sumLines(lines.filter((l) => l.tx.type === "receivable")),
        outflow: sumLines(lines.filter((l) => l.tx.type === "payable")),
        count: lines.length,
        missing: !a,
      };
    })
    .sort(
      (a, b) =>
        Number(a.missing) - Number(b.missing) ||
        a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
    );
  const movement = currency(report.inflow).add(report.outflow).value;
  const missing = accounts.find((a) => a.missing);
  const coverage =
    movement === 0
      ? 1
      : 1 -
        currency(missing?.inflow ?? 0).add(missing?.outflow ?? 0).value /
          movement;

  // Pessoas físicas: o documento de 11 dígitos, não o nome, que se repete.
  const realized = report.lines.filter((l) => l.stage === "realized");
  const paid = realized.filter((l) => l.tx.type === "payable");
  const people = [
    ...groupBy(
      paid.filter((l) => digits(l.tx).length === 11),
      (l) => digits(l.tx),
    ),
  ]
    .map(([document, lines]) => ({
      name: partyOf(lines[0].tx),
      document,
      count: lines.length,
      value: sumLines(lines),
      what: [
        ...new Set(lines.map((l) => l.tx.description?.trim()).filter(Boolean)),
      ].join("; "),
    }))
    .sort((a, b) => b.value - a.value);

  const hasNote = (l: FlowLine) =>
    (l.tx.attachments ?? []).some((a) => !!a.url);
  const undocumented = paid.filter((l) => !hasNote(l) && !o.hasReceipt(l.tx));
  const gap = (label: string, lines: FlowLine[]): Gap => ({
    label,
    lines,
    value: sumLines(lines),
  });
  const gaps = [
    gap("Pagos sem nota nem comprovante", undocumented),
    gap(
      "Pagos com nota, sem comprovante",
      paid.filter((l) => hasNote(l) && !o.hasReceipt(l.tx)),
    ),
    gap(
      "Lançamentos sem conta contábil",
      realized.filter(
        (l) => !l.tx.accountId || !accountById.has(l.tx.accountId),
      ),
    ),
    gap(
      "Pagos a favorecido sem CNPJ/CPF",
      paid.filter((l) => !digits(l.tx)),
    ),
    gap("Vencidos sem baixa, fora do saldo", report.pending.lines),
  ].filter((g) => g.lines.length > 0);

  let running = currency(report.opening);
  const daily: CashSynthesis["daily"] = [];
  for (const l of report.lines) {
    running =
      l.tx.type === "receivable"
        ? running.add(l.amount)
        : running.subtract(l.amount);
    const last = daily.at(-1);
    if (last && isSameDay(last.date, l.date)) last.balance = running.value;
    else daily.push({ date: l.date, balance: running.value });
  }

  return {
    inflows,
    areas,
    accounts,
    coverage,
    people,
    gaps,
    undocumented,
    daily,
  };
}

// ─── Texto ────────────────────────────────────────────────────────────────────

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Outubro de 2026" para um mês inteiro; senão as datas. */
export function periodName(start: Date, end: Date) {
  return isSameDay(start, startOfMonth(start)) &&
    isSameDay(end, endOfMonth(start))
    ? capital(format(start, "MMMM 'de' yyyy", { locale: ptBR }))
    : periodText(start, end);
}

/** A conclusão da primeira página: o saldo e se ele confere com o banco. */
export function synthesisTitle(
  report: CashFlowReport,
  proof: ProofState,
  start: Date,
  end: Date,
  /** Há saldo inicial; sem ele os valores são só o acumulado do recorte. */
  known: boolean,
) {
  const name = periodName(start, end);
  const closing = formatCurrency(report.closing);
  if (!known || proof.status === "scope") {
    return `${name}: entraram ${formatCurrency(report.inflow)} e saíram ${formatCurrency(report.outflow)} neste recorte.`;
  }
  if (proof.status === "open") {
    return report.lines.some((l) => l.stage !== "realized")
      ? `${name} em andamento: saldo previsto de ${closing} em ${format(end, "dd/MM/yyyy")}.`
      : `${name} em andamento: saldo de ${closing} até agora.`;
  }
  if (proof.status === "match") {
    return `${name} fechou com ${closing}, igual ao saldo do banco.`;
  }
  if (proof.status === "mismatch") {
    return `${name} fechou com ${closing}; o banco mostra ${formatCurrency(proof.total!)}, diferença de ${formatCurrency(Math.abs(proof.difference!))}.`;
  }
  return `${name} fechou com ${closing}, ainda sem conferência com o banco.`;
}

/** Por que não há conferência, em palavras. */
export function proofNote(proof: ProofState) {
  switch (proof.status) {
    case "open":
      return "Período em andamento: a conferência sai depois que ele encerrar.";
    case "scope":
      return "Recorte da empresa: o saldo do banco é da empresa inteira e não se compara.";
    case "unavailable":
      return "Não foi possível ler as contas bancárias ao gerar o arquivo.";
    case "uncovered":
      if (proof.rows.length === 0)
        return "Nenhuma conta bancária cadastrada na Conciliação.";
      return proof.rows.every((r) => !r.date)
        ? "As contas entraram na Conciliação depois deste período: não há extrato dele para conferir."
        : "Falta extrato até o último dia útil do período nas contas marcadas.";
    default:
      return null;
  }
}
