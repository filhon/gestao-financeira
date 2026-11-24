/**
 * Matriz do fluxo de caixa: linhas por centro, conta, entidade ou banco e
 * colunas por período, com o previsto, o realizado e o período anterior.
 *
 * Sem Firebase de propósito: a tela, o Excel e `npm run check:reports` usam as
 * mesmas contas.
 */
import currency from "currency.js";
import { startOfDay } from "date-fns";
import type {
  BankAccount,
  ChartAccount,
  CostCenter,
  Entity,
  Transaction,
} from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { splitByCostCenter } from "./cashSynthesis";
import { compareCodes, dreAmount, parentCodeOf } from "./chartOfAccounts";
import { parentOf, tidyName } from "./costCenterTree";
import { plannedOf, planRoles } from "./plan";
import {
  bucketsOf,
  type FlowLine,
  type Granularity,
  type PeriodBucket,
} from "./reports";

export type MatrixRows = "costCenter" | "account" | "entity" | "bank";

export const MATRIX_ROWS: Record<MatrixRows, string> = {
  costCenter: "Centro de custo",
  account: "Conta contábil",
  entity: "Entidade",
  bank: "Conta bancária",
};

/** Lançamento na matriz: realizado, previsto ou projetado, sempre positivo. */
export type MatrixLine = Pick<FlowLine, "tx" | "date" | "amount" | "late">;

export interface MatrixNode {
  key: string;
  label: string;
  depth: number;
  parent: string | null;
  hasChildren: boolean;
  /** Fluxo (ou realizado) por período, na ordem de `buckets`. */
  values: number[];
  total: number;
  lines: MatrixLine[][];
  /** Previsto por período; o total só vai até hoje, para o desvio ser justo. */
  plan: number[];
  planTotal: number;
  planLines: MatrixLine[][];
  previous: number;
}

export interface MatrixSection {
  type: Transaction["type"];
  nodes: MatrixNode[];
  values: number[];
  total: number;
  plan: number[];
  planTotal: number;
  previous: number;
}

export interface CashMatrix {
  rows: MatrixRows;
  buckets: PeriodBucket[];
  inflow: MatrixSection;
  outflow: MatrixSection;
  net: number[];
  netTotal: number;
  /** Saldo ao fim de cada período; null sem saldo inicial. */
  closing: number[] | null;
  opening: number;
  hasPlan: boolean;
  hasPrevious: boolean;
}

export interface MatrixInput {
  rows: MatrixRows;
  start: Date;
  end: Date;
  today: Date;
  granularity: Granularity;
  /** null = sem saldo de referência. */
  opening: number | null;
  lines: MatrixLine[];
  plan?: MatrixLine[];
  previous?: MatrixLine[];
  costCenters: CostCenter[];
  accounts: ChartAccount[];
  entities: Entity[];
  banks?: BankAccount[];
  costCenterIds?: readonly string[];
}

const NONE = "—";
const NONE_LABEL: Record<MatrixRows, string> = {
  costCenter: "Sem centro de custo",
  account: "Sem conta contábil",
  entity: "Sem nome",
  bank: "Sem conta bancária",
};

type Step = { key: string; label: string };

/** O caminho da linha na dimensão, da raiz da tela à folha. */
function pathsOf(
  o: MatrixInput,
): (l: MatrixLine) => { path: Step[]; amount: number }[] {
  const none: Step[] = [{ key: NONE, label: NONE_LABEL[o.rows] }];

  if (o.rows === "costCenter") {
    const byId = new Map(o.costCenters.map((c) => [c.id, c]));
    const pathOf = (id: string): Step[] => {
      const chain: CostCenter[] = [];
      for (
        let cc = byId.get(id);
        cc && !chain.includes(cc);
        cc = byId.get(parentOf(cc) ?? "")
      ) {
        chain.unshift(cc);
      }
      if (chain.length === 0) return none;
      // A raiz é a empresa inteira: só aparece quando o lançamento é nela.
      return (chain.length > 1 ? chain.slice(1) : chain).map((c) => ({
        key: c.id,
        label: tidyName(c.name),
      }));
    };
    return (l) =>
      splitByCostCenter(l, o.costCenterIds).map((s) => ({
        path: pathOf(s.id),
        amount: s.amount,
      }));
  }

  if (o.rows === "account") {
    const byId = new Map(o.accounts.map((a) => [a.id, a]));
    const byCode = new Map(o.accounts.map((a) => [a.code, a]));
    return (l) => {
      const account = byId.get(l.tx.accountId ?? "");
      const path: Step[] = [];
      for (
        let code: string | null = account?.code ?? null;
        code;
        code = parentCodeOf(code)
      ) {
        const a = byCode.get(code);
        if (a)
          path.unshift({ key: a.id, label: `${a.code} ${tidyName(a.name)}` });
      }
      return [{ path: path.length ? path : none, amount: l.amount }];
    };
  }

  if (o.rows === "entity") {
    const byId = new Map(o.entities.map((e) => [e.id, e]));
    return (l) => {
      const label =
        byId.get(l.tx.entityId ?? "")?.name || l.tx.supplierOrClient || "";
      const path = label
        ? [{ key: l.tx.entityId || `nome:${label}`, label }]
        : none;
      return [{ path, amount: l.amount }];
    };
  }

  const byId = new Map((o.banks ?? []).map((b) => [b.id, b]));
  return (l) => {
    const bank = byId.get(l.tx.bankAccountId ?? "");
    return [
      {
        path: bank ? [{ key: bank.id, label: bank.name }] : none,
        amount: l.amount,
      },
    ];
  };
}

const add = (a: number, b: number) => currency(a).add(b).value;

/**
 * As linhas que a seção mostra. Um centro só, sem filhos, é a raiz das
 * receitas: repetiria o total da seção.
 */
export const shownNodes = (m: Pick<CashMatrix, "rows">, s: MatrixSection) =>
  m.rows === "costCenter" && s.nodes.length === 1 ? [] : s.nodes;

export function buildMatrix(o: MatrixInput): CashMatrix {
  const pathsFor = pathsOf(o);
  const today = startOfDay(o.today);
  const all = [...o.lines, ...(o.plan ?? [])];
  const { keyOf, buckets } = bucketsOf(
    o.start,
    o.end,
    o.granularity,
    all.map((l) => l.date),
  );
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const zeros = () => buckets.map(() => 0);

  const section = (type: Transaction["type"]): MatrixSection => {
    const nodes = new Map<string, MatrixNode>();
    const out: MatrixSection = {
      type,
      nodes: [],
      values: zeros(),
      total: 0,
      plan: zeros(),
      planTotal: 0,
      previous: 0,
    };

    const visit = (
      lines: MatrixLine[] | undefined,
      apply: (
        target: MatrixNode | MatrixSection,
        line: MatrixLine,
        amount: number,
      ) => void,
    ) => {
      for (const line of lines ?? []) {
        if (line.tx.type !== type) continue;
        apply(out, line, line.amount);
        for (const { path, amount } of pathsFor(line)) {
          let parent: string | null = null;
          path.forEach((step, depth) => {
            let node = nodes.get(step.key);
            if (!node) {
              node = {
                ...step,
                depth,
                parent,
                hasChildren: false,
                values: zeros(),
                total: 0,
                lines: buckets.map(() => []),
                plan: zeros(),
                planTotal: 0,
                planLines: buckets.map(() => []),
                previous: 0,
              };
              nodes.set(step.key, node);
              if (parent) nodes.get(parent)!.hasChildren = true;
            }
            apply(node, line, amount);
            parent = step.key;
          });
        }
      }
    };

    visit(o.lines, (t, line, amount) => {
      const i = index.get(keyOf(line.date));
      if (i === undefined) return;
      t.values[i] = add(t.values[i], amount);
      t.total = add(t.total, amount);
      if ("lines" in t) t.lines[i].push({ ...line, amount });
    });
    visit(o.plan, (t, line, amount) => {
      const i = index.get(keyOf(line.date));
      if (i === undefined) return;
      t.plan[i] = add(t.plan[i], amount);
      if (startOfDay(line.date) <= today)
        t.planTotal = add(t.planTotal, amount);
      if ("planLines" in t) t.planLines[i].push({ ...line, amount });
    });
    visit(o.previous, (t, _line, amount) => {
      t.previous = add(t.previous, amount);
    });

    // Irmãos: contas na ordem do plano; o resto, do maior para o menor.
    // O que está sem classificação fecha a lista.
    const size = (n: MatrixNode) => Math.max(n.total, n.planTotal);
    const order = (a: MatrixNode, b: MatrixNode) =>
      Number(a.key === NONE) - Number(b.key === NONE) ||
      (o.rows === "account"
        ? compareCodes(a.label.split(" ")[0], b.label.split(" ")[0])
        : size(b) - size(a) ||
          b.previous - a.previous ||
          a.label.localeCompare(b.label, "pt-BR"));
    const children = (parent: string | null): MatrixNode[] =>
      [...nodes.values()]
        .filter((n) => n.parent === parent)
        .sort(order)
        .flatMap((n) => [n, ...children(n.key)]);
    out.nodes = children(null);
    return out;
  };

  const inflow = section("receivable");
  const outflow = section("payable");
  const net = buckets.map(
    (_, i) => currency(inflow.values[i]).subtract(outflow.values[i]).value,
  );
  let running = currency(o.opening ?? 0);
  const closing = net.map((v) => (running = running.add(v)).value);

  return {
    rows: o.rows,
    buckets,
    inflow,
    outflow,
    net,
    netTotal: currency(inflow.total).subtract(outflow.total).value,
    closing: o.opening === null ? null : closing,
    opening: o.opening ?? 0,
    hasPlan: !!o.plan,
    hasPrevious: !!o.previous,
  };
}

/**
 * O previsto de cada lançamento, pelo vencimento, com o valor de quando nasceu:
 * a mesma previsão da Análise. `transactions` precisa ir além do período, para
 * que as partes "(1/3)" de um recebimento dividido se reconheçam.
 */
export function planLines(
  transactions: Transaction[],
  start: Date,
  end: Date,
  costCenterIds?: readonly string[],
): MatrixLine[] {
  const roles = planRoles(transactions);
  return transactions.flatMap((tx) => {
    if (tx.dueDate < startOfDay(start) || startOfDay(tx.dueDate) > end)
      return [];
    const planned = plannedOf(tx, roles.get(tx.id));
    if (!planned) return [];
    const full = dreAmount(tx);
    const amount =
      costCenterIds?.length && full
        ? currency(planned).multiply(dreAmount(tx, costCenterIds) / full).value
        : planned;
    return amount ? [{ tx, date: tx.dueDate, amount }] : [];
  });
}

/** Um lançamento rateado aparece uma vez só na lista que abre da célula. */
export function mergeLines(lines: MatrixLine[]): MatrixLine[] {
  const byTx = new Map<string, MatrixLine>();
  for (const l of lines) {
    const seen = byTx.get(l.tx.id);
    byTx.set(
      l.tx.id,
      seen ? { ...seen, amount: add(seen.amount, l.amount) } : l,
    );
  }
  return [...byTx.values()];
}

/**
 * Desvio que merece atenção: entrou menos ou saiu mais do que o previsto.
 */
export const isUnfavorable = (type: Transaction["type"], deviation: number) =>
  type === "receivable" ? deviation < 0 : deviation > 0;
