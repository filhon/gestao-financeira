/**
 * Demonstração dos fluxos de caixa pelo método direto (DFC), a partir do plano
 * de contas, e os recursos com restrição do doador.
 *
 * Doações ficam nas atividades operacionais (ITG 2002, item 25). O resultado
 * sai no formato da DRE para usar a mesma tabela e as mesmas exportações.
 * Sem Firebase de propósito.
 */
import currency from "currency.js";
import { eachMonthOfInterval, endOfDay, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ChartAccount,
  CostCenter,
  DreGroup,
  Entity,
  Transaction,
} from "@/lib/types";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { splitByCostCenter } from "./cashSynthesis";
import {
  compareCodes,
  depthOf,
  effectiveDate,
  groupResolver,
  parentCodeOf,
  type DreReport,
  type DreRow,
} from "./chartOfAccounts";
import { descendantIds, tidyName } from "./costCenterTree";
import { isOpeningEntry } from "./forecastAccuracy";
import { flowAmount, stageOf } from "./reports";

type Activity = "receipts" | "payments" | "investing" | "financing";

const activityOf = (g: DreGroup): Activity =>
  g === "investments"
    ? "investing"
    : g === "financing"
      ? "financing"
      : g === "gross_revenue" ||
          g === "financial_revenue" ||
          g === "other_revenue"
        ? "receipts"
        : "payments";

/** Contas até o terceiro nível ("3.1.01"); o detalhe abre no clique. */
const MAX_DEPTH = 2;

export interface CashStatementOptions {
  start: Date;
  end: Date;
  /** Saldo no início do período; null = sem saldo de referência. */
  opening: number | null;
  costCenterIds?: readonly string[];
}

export function buildCashStatement(
  transactions: Transaction[],
  accounts: ChartAccount[],
  o: CashStatementOptions,
): DreReport<Transaction> {
  const from = startOfDay(o.start);
  const to = endOfDay(o.end);
  const columns = eachMonthOfInterval({ start: from, end: to }).map((d) => ({
    key: format(d, "yyyy-MM"),
    label: format(d, "MMM/yy", { locale: ptBR }),
  }));
  const colIndex = new Map(columns.map((c, i) => [c.key, i]));
  const zero = () => columns.map(() => 0);
  const addTo = (into: number[], vs: number[]) =>
    vs.forEach((v, i) => (into[i] = currency(into[i]).add(v).value));
  const sum = (vs: number[]) =>
    vs.reduce((s, v) => s.add(v), currency(0)).value;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const groupOf = groupResolver(accounts);

  type Bucket = { values: number[]; sources: Transaction[] };
  const bucket = (): Bucket => ({ values: zero(), sources: [] });
  const put = (b: Bucket, t: Transaction, col: number, v: number) => {
    b.values[col] = currency(b.values[col]).add(v).value;
    b.sources.push(t);
  };

  const perCode: Record<Activity, Map<string, Bucket>> = {
    receipts: new Map(),
    payments: new Map(),
    investing: new Map(),
    financing: new Map(),
  };
  const totals: Record<Activity, Bucket> = {
    receipts: bucket(),
    payments: bucket(),
    investing: bucket(),
    financing: bucket(),
  };
  const missing = { receivable: bucket(), payable: bucket() };
  const implanted = bucket();
  let missingCount = 0;
  let classified = currency(0);
  let volume = currency(0);

  for (const t of transactions) {
    if (stageOf(t) !== "realized") continue;
    const date = effectiveDate(t);
    if (date < from || date > to) continue;
    const raw = flowAmount(t, o.costCenterIds);
    if (!raw) continue;
    const col = colIndex.get(format(date, "yyyy-MM"))!;
    const v = t.type === "receivable" ? raw : -raw;
    // Saldo digitado ao implantar o sistema não é recebimento.
    if (isOpeningEntry(t) && t.type === "receivable") {
      put(implanted, t, col, v);
      continue;
    }
    volume = volume.add(raw);
    const account = t.accountId ? byId.get(t.accountId) : undefined;
    const group = account
      ? (account.dreGroup ?? groupOf(account.code))
      : undefined;
    if (!account || !group) {
      put(missing[t.type], t, col, v);
      missingCount++;
      continue;
    }
    classified = classified.add(raw);
    const activity = activityOf(group);
    put(totals[activity], t, col, v);
    for (
      let code: string | null = account.code;
      code;
      code = parentCodeOf(code)
    ) {
      // A conta raiz ("3 Receitas") repetiria o total da atividade.
      if (depthOf(code) < 1 || depthOf(code) > MAX_DEPTH) continue;
      if (!byCode.has(code)) continue;
      const b = perCode[activity].get(code) ?? bucket();
      put(b, t, col, v);
      perCode[activity].set(code, b);
    }
    // Conta rasa demais para ter nível 1: entra por ela mesma.
    if (depthOf(account.code) < 1) {
      const b = perCode[activity].get(account.code) ?? bucket();
      put(b, t, col, v);
      perCode[activity].set(account.code, b);
    }
  }

  const rows: DreRow<Transaction>[] = [];
  const net = zero();
  const row = (
    kind: DreRow["kind"],
    label: string,
    b: Pick<Bucket, "values"> & { sources?: Transaction[] },
    extra: Partial<DreRow<Transaction>> = {},
  ) =>
    rows.push({
      kind,
      label,
      level: 0,
      values: b.values,
      total: sum(b.values),
      sources: b.sources,
      ...extra,
    });
  const heading = (label: string) => row("heading", label, { values: zero() });
  const accountsOf = (activity: Activity) => {
    const codes = [...perCode[activity].keys()].sort(compareCodes);
    for (const code of codes) {
      let level = 1;
      for (let p = parentCodeOf(code); p; p = parentCodeOf(p))
        if (perCode[activity].has(p)) level++;
      const a = byCode.get(code)!;
      row("account", tidyName(a.name), perCode[activity].get(code)!, {
        code,
        level,
      });
    }
  };
  const subtotal = (label: string, parts: Bucket[]) => {
    const values = zero();
    parts.forEach((p) => addTo(values, p.values));
    addTo(net, values);
    row("subtotal", label, { values }, { key: label });
  };

  heading("Atividades operacionais");
  row("group", "Recebimentos", totals.receipts);
  accountsOf("receipts");
  row("group", "Pagamentos", totals.payments);
  accountsOf("payments");
  subtotal("Caixa das atividades operacionais", [
    totals.receipts,
    totals.payments,
  ]);
  for (const [activity, name] of [
    ["investing", "investimento"],
    ["financing", "financiamento"],
  ] as const) {
    heading(`Atividades de ${name}`);
    accountsOf(activity);
    subtotal(`Caixa das atividades de ${name}`, [totals[activity]]);
  }
  if (missingCount > 0) {
    heading("Movimento sem conta contábil");
    for (const [side, label] of [
      ["receivable", "Recebimentos sem conta"],
      ["payable", "Pagamentos sem conta"],
    ] as const) {
      if (missing[side].sources.length === 0) continue;
      row("info", label, missing[side], { level: 1 });
      addTo(net, missing[side].values);
    }
  }
  row(
    "result",
    "Variação líquida de caixa",
    { values: net },
    {
      key: "Variação líquida de caixa",
    },
  );

  if (o.opening !== null) {
    heading("Caixa e equivalentes de caixa");
    const start = currency(o.opening);
    let running = start;
    const openings: number[] = [];
    const closings: number[] = [];
    net.forEach((v, i) => {
      openings.push(running.value);
      running = running.add(v).add(implanted.values[i]);
      closings.push(running.value);
    });
    rows.push({
      kind: "account",
      label: "No início do período",
      level: 1,
      values: openings,
      total: start.value,
    });
    if (implanted.sources.length > 0)
      row("account", "Saldo informado ao implantar o sistema", implanted, {
        level: 1,
      });
    rows.push({
      kind: "result",
      key: "No fim do período",
      label: "No fim do período",
      level: 0,
      values: closings,
      total: running.value,
    });
  }

  return {
    columns,
    rows,
    // Sem análise vertical: a DFC não tem base de receita líquida.
    base: 0,
    unclassifiedCount: missingCount,
    coverage: volume.value ? classified.value / volume.value : 1,
  };
}

// ─── Recursos com restrição ───────────────────────────────────────────────────

export interface RestrictedFund {
  id: string;
  name: string;
  before: number;
  received: number;
  applied: number;
  /** Ainda a aplicar; negativo = recurso próprio cobriu. */
  balance: number;
  /** Recebido no período, por doador. */
  donors: { name: string; value: number; lines: Transaction[] }[];
  /** Aplicado no período, por favorecido. */
  uses: { name: string; value: number; lines: Transaction[] }[];
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A receita que financia o centro: pela conta ou por uma palavra na descrição. */
export function fundsReceipt(
  cc: Pick<CostCenter, "restrictedAccountIds" | "restrictedText">,
  t: Transaction,
): boolean {
  if (t.type !== "receivable") return false;
  if (t.accountId && cc.restrictedAccountIds?.includes(t.accountId))
    return true;
  const word = norm(cc.restrictedText?.trim() ?? "");
  return word.length >= 3 && norm(t.description ?? "").includes(word);
}

/**
 * Cada recurso vinculado: o que entrou dos doadores e o que já foi aplicado no
 * centro e nos filhos, desde o começo. Uma receita conta para um recurso só.
 */
export function buildRestrictedFunds(
  transactions: Transaction[],
  costCenters: CostCenter[],
  entities: Pick<Entity, "id" | "name">[],
  o: { start: Date; end: Date },
): RestrictedFund[] {
  const from = startOfDay(o.start);
  const to = endOfDay(o.end);
  const nameById = new Map(entities.map((e) => [e.id, e.name]));
  const partyOf = (t: Transaction) =>
    nameById.get(t.entityId ?? "") || t.supplierOrClient || "Sem nome";
  const realized = transactions
    .filter((t) => stageOf(t) === "realized")
    .map((t) => ({ t, date: effectiveDate(t) }))
    .filter((x) => x.date <= to);
  const taken = new Set<string>();

  return costCenters
    .filter((c) => c.restricted)
    .map((cc) => {
      const ids = new Set(descendantIds(cc.id, costCenters));
      let before = currency(0);
      let received = currency(0);
      let applied = currency(0);
      const donors = new Map<string, { value: number; lines: Transaction[] }>();
      const uses = new Map<string, { value: number; lines: Transaction[] }>();
      const into = (m: typeof donors, t: Transaction, v: number) => {
        const e = m.get(partyOf(t)) ?? { value: 0, lines: [] };
        e.value = currency(e.value).add(v).value;
        e.lines.push(t);
        m.set(partyOf(t), e);
      };

      for (const { t, date } of realized) {
        if (t.type === "receivable") {
          if (taken.has(t.id) || !fundsReceipt(cc, t)) continue;
          taken.add(t.id);
          const v = flowAmount(t);
          if (date < from) before = before.add(v);
          else {
            received = received.add(v);
            into(donors, t, v);
          }
          continue;
        }
        const v = splitByCostCenter({ tx: t, amount: flowAmount(t) })
          .filter((s) => ids.has(s.id))
          .reduce((s, x) => s.add(x.amount), currency(0)).value;
        if (!v) continue;
        if (date < from) before = before.subtract(v);
        else {
          applied = applied.add(v);
          into(uses, t, v);
        }
      }
      const list = (m: typeof donors) =>
        [...m]
          .map(([name, e]) => ({ name, ...e }))
          .sort((a, b) => b.value - a.value);
      return {
        id: cc.id,
        name: tidyName(cc.name),
        before: before.value,
        received: received.value,
        applied: applied.value,
        balance: before.add(received).subtract(applied).value,
        donors: list(donors),
        uses: list(uses),
      };
    });
}
