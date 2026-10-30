import currency from "currency.js";
import { format } from "date-fns";
import type {
  BankAccount,
  BankAccountClosing,
  BankTransaction,
  ReconciliationRule,
} from "@/lib/types";
import type { TransactionFormData } from "@/lib/validations/transaction";
// Relativo: o script de verificação roda fora do Next, sem o alias "@/".
import { normalizeText } from "./utils";

// Datas comparadas pelo dia civil: o saldo de abertura e o de fechamento valem
// "ao fim do dia", e uma linha do extrato daquele mesmo dia já está dentro dele.
const day = (d: Date) => format(new Date(d), "yyyy-MM-dd");

/** Conta escolhida na conciliação, lembrada por empresa neste navegador. */
export const reconciliationAccountKey = (companyId: string) =>
  `reconciliation-account-${companyId}`;

export const lastClosing = (
  account: Pick<BankAccount, "closings">,
): BankAccountClosing | undefined => account.closings?.at(-1);

/** Ponto de partida do saldo: o último fechamento, ou o saldo de abertura. */
export function balanceBase(account: BankAccount) {
  const closing = lastClosing(account);
  return closing
    ? { date: new Date(closing.through), balance: closing.balance }
    : {
        date: new Date(account.openingBalanceDate),
        balance: account.openingBalance,
      };
}

/** Linhas fechadas não mudam mais: sem desfazer, sem baixa, sem ignorar. */
export const isLocked = (tx: BankTransaction, account?: BankAccount) => {
  const closing = account && lastClosing(account);
  return !!closing && day(tx.date) <= day(closing.through);
};

/**
 * Linha até a data da base: já está dentro do saldo inicial e não entra na
 * prova. Com fechamento, essas linhas já são `isLocked`.
 */
export const isBeforeBase = (tx: BankTransaction, account: BankAccount) =>
  day(tx.date) <= day(balanceBase(account).date);

/**
 * Saldo que o banco manda como se fosse lançamento ("SALDO ANTERIOR", "SALDO
 * TOTAL DISPONÍVEL DIA", "SDO APLIC AUT MAIS"). Não é movimento: fica fora da
 * prova e vira a conferência do dia.
 */
// ponytail: pelo histórico; se algum banco mandar movimento que comece com "SALDO", marcar na importação.
export const isBalanceLine = (tx: Pick<BankTransaction, "description">) =>
  /^(saldo|sdo)\b/.test(normalizeText(tx.description.trim()));

/**
 * Prova da conciliação de uma conta.
 *
 * Saldo conciliado = base + linhas tratadas (conciliadas ou ignoradas) depois
 * da base e até a data do saldo do extrato. Se o saldo de abertura estiver
 * certo e nenhuma linha faltar no arquivo, a diferença zera quando não sobra
 * linha pendente. Ignorar conta como tratar: é a decisão consciente de que o
 * movimento não pede lançamento (transferência entre contas, aplicação).
 *
 * Como tratar soma a linha do mesmo jeito que conciliar, a diferença final já
 * é conhecida antes: `projectedDifference` conta as pendentes como estão.
 */
export function summarizeAccount(
  account: BankAccount,
  items: BankTransaction[],
) {
  const base = balanceBase(account);
  const until = account.statementBalanceDate
    ? day(account.statementBalanceDate)
    : null;

  const inWindow = items.filter(
    (tx) =>
      tx.bankAccountId === account.id &&
      !isBalanceLine(tx) &&
      day(tx.date) > day(base.date) &&
      (!until || day(tx.date) <= until),
  );
  const handled = inWindow.filter(
    (tx) => tx.status === "matched" || tx.status === "ignored",
  );
  const pending = inWindow.length - handled.length;

  const bookBalance = handled.reduce(
    (sum, tx) => sum.add(tx.amount),
    currency(base.balance),
  ).value;
  const pendingAmount = inWindow
    .filter((tx) => !handled.includes(tx))
    .reduce((sum, tx) => sum.add(tx.amount), currency(0)).value;
  const statement =
    account.statementBalance === undefined
      ? null
      : currency(account.statementBalance);
  const difference = statement ? statement.subtract(bookBalance).value : null;
  const projectedDifference = statement
    ? statement.subtract(bookBalance).subtract(pendingAmount).value
    : null;

  return {
    base,
    bookBalance,
    statementBalance: account.statementBalance ?? null,
    statementDate: account.statementBalanceDate
      ? new Date(account.statementBalanceDate)
      : null,
    difference,
    projectedDifference,
    pendingAmount,
    total: inWindow.length,
    handled: handled.length,
    pending,
    hasMovement: !!until && until > day(base.date),
    canClose:
      difference === 0 && pending === 0 && !!until && until > day(base.date),
  };
}

export interface DayBalance {
  day: string;
  date: Date;
  /** Linhas de saldo que o banco mandou neste dia. */
  lines: BankTransaction[];
  /** Base + todo movimento do arquivo até o fim do dia; null antes da base. */
  computed: number | null;
  /** Algum saldo do banco bate com o calculado. */
  matches: boolean;
}

/**
 * Conferência diária com as linhas de saldo do banco. O calculado soma todo
 * movimento do arquivo, tratado ou não: o banco diz que ele aconteceu. Quando
 * um dia não bate, a falta está nele, não no período inteiro.
 */
export function dailyBalances(
  account: BankAccount,
  items: BankTransaction[],
): DayBalance[] {
  const base = balanceBase(account);
  const baseDay = day(base.date);
  const own = items.filter((tx) => tx.bankAccountId === account.id);
  const movements = own.filter((tx) => !isBalanceLine(tx));

  const byDay = new Map<string, BankTransaction[]>();
  for (const tx of own.filter(isBalanceLine)) {
    const key = day(tx.date);
    byDay.set(key, [...(byDay.get(key) ?? []), tx]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, lines]) => {
      const computed =
        key < baseDay
          ? null
          : movements
              .filter((tx) => day(tx.date) > baseDay && day(tx.date) <= key)
              .reduce((sum, tx) => sum.add(tx.amount), currency(base.balance))
              .value;
      return {
        day: key,
        date: new Date(lines[0].date),
        lines,
        computed,
        matches:
          computed !== null &&
          lines.some((tx) => currency(tx.amount).value === computed),
      };
    });
}

export const dayKey = day;

/** Um dia do extrato: quantas linhas, quantas faltam e o saldo do banco. */
export interface DayGroup {
  day: string;
  date: Date;
  total: number;
  pending: number;
  locked: boolean;
  balance?: DayBalance;
  /** Nada a fazer: sem pendente e, se o banco mandou saldo, ele bate. */
  done: boolean;
}

/** Agrupa as linhas de movimento por dia, com a conferência de saldo de cada um. */
export function groupByDay(
  account: BankAccount,
  lines: BankTransaction[],
  balances: DayBalance[],
): DayGroup[] {
  const closing = lastClosing(account);
  const groups = new Map<string, DayGroup>();
  const at = (date: Date) => {
    const key = day(date);
    let g = groups.get(key);
    if (!g) {
      g = {
        day: key,
        date: new Date(date),
        total: 0,
        pending: 0,
        locked: !!closing && key <= day(closing.through),
        done: false,
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const tx of lines) {
    const g = at(tx.date);
    g.total++;
    if (tx.status === "unmatched" || tx.status === "potential_match")
      g.pending++;
  }
  for (const b of balances) at(b.date).balance = b;
  return [...groups.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((g) => ({
      ...g,
      done:
        g.pending === 0 &&
        (!g.balance || g.balance.computed === null || g.balance.matches),
    }));
}

/**
 * Saldo do extrato a gravar depois de importar. O Itaú manda no saldo final
 * do OFX o total com a aplicação automática, mas os movimentos são da conta
 * corrente: a linha de saldo do último dia que bate com o calculado mostra a
 * base da conta e vence o arquivo. Nenhuma bate: vale o saldo do arquivo.
 */
export function pickStatementBalance(
  account: BankAccount,
  items: BankTransaction[],
  fromFile: { balance: number; date: Date } | null,
): { balance: number; date: Date } | null {
  const last = dailyBalances(account, items).at(-1);
  if (last?.matches && last.computed !== null) {
    return { balance: last.computed, date: last.date };
  }
  return fromFile;
}

const lineKey = (tx: BankTransaction) =>
  [
    tx.bankAccountId ?? "",
    day(tx.date),
    currency(tx.amount).intValue,
    normalizeText(tx.description.trim()),
  ].join("|");

/**
 * Linhas do arquivo que ainda não estão na sessão. Duplicata é o mesmo
 * movimento (conta, dia, valor, histórico), não o mesmo FITID: o Itaú numera o
 * FITID pela posição no arquivo, e outro recorte do mesmo dia repete o número
 * para outro movimento. Id já usado por outra linha ganha sufixo. Movimentos
 * iguais no mesmo dia (duas tarifas de R$ 12) contam pela quantidade.
 */
export function newStatementLines(
  existing: BankTransaction[],
  incoming: BankTransaction[],
): BankTransaction[] {
  const ids = new Set(existing.map((tx) => tx.id));
  const left = new Map<string, number>();
  for (const tx of existing) {
    const k = lineKey(tx);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  const added: BankTransaction[] = [];
  for (const tx of incoming) {
    const k = lineKey(tx);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      left.set(k, n - 1);
      continue;
    }
    let id = tx.id;
    for (let i = 2; ids.has(id); i++) id = `${tx.id}~${i}`;
    ids.add(id);
    added.push({ ...tx, id });
  }
  return added;
}

// ─── Aplicações e transferências ──────────────────────────────────────────────

export const isInvestment = (account?: Pick<BankAccount, "kind">) =>
  account?.kind === "investment";

const DAY_MS = 86_400_000;

/** Como a ponta criada pelo sistema aparece na conta dela. */
function mirrorDescription(amount: number, from: BankAccount, to: BankAccount) {
  const what = isInvestment(to)
    ? amount > 0
      ? "Aplicação"
      : "Resgate"
    : isInvestment(from)
      ? amount > 0
        ? "Resgate"
        : "Aplicação"
      : "Transferência";
  return `${what} ${amount > 0 ? "de" : "para"} ${from.name}`;
}

/**
 * As duas pontas de uma transferência entre contas da empresa: não é receita
 * nem despesa, o dinheiro só muda de conta. Se a outra conta já tem a linha
 * (extrato das duas importado), casa com ela; senão nasce a ponta espelho,
 * com id derivado da origem, então transferir de novo sobrescreve em vez de
 * duplicar. Devolve o que gravar em cada ponta.
 */
export function transferPair(
  tx: BankTransaction,
  from: BankAccount,
  to: BankAccount,
  candidates: BankTransaction[],
): {
  origin: Partial<BankTransaction>;
  other: Partial<BankTransaction> & { id: string };
} {
  const amount = currency(tx.amount).multiply(-1).value;
  const existing = candidates.find(
    (c) =>
      c.bankAccountId === to.id &&
      (c.status === "unmatched" || c.status === "potential_match") &&
      !isBalanceLine(c) &&
      !isLocked(c, to) &&
      currency(c.amount).value === amount &&
      Math.abs(new Date(c.date).getTime() - new Date(tx.date).getTime()) <=
        3 * DAY_MS,
  );
  const link = (id: string, accountId: string) => ({
    status: "matched" as const,
    resolution: "transfer" as const,
    transferId: id,
    transferAccountId: accountId,
    confidence: 100,
  });
  const other = existing
    ? { id: existing.id, ...link(tx.id, from.id), ruleId: undefined }
    : {
        id: `${tx.id}~t`,
        date: tx.date,
        amount,
        description: mirrorDescription(amount, from, to),
        type: amount < 0 ? ("debit" as const) : ("credit" as const),
        bankAccountId: to.id,
        origin: "transfer" as const,
        ...link(tx.id, from.id),
      };
  return {
    origin: { ...link(other.id, to.id), ignoreReason: undefined },
    other,
  };
}

/**
 * Aplicação: com tudo tratado, o que o saldo bruto do banco tem a mais que o
 * sistema é o rendimento do período. Entra como receita ao fechar; conferir o
 * saldo todo dia só mostra quanto já rendeu.
 *
 * Os resgates entram líquidos (o que caiu na conta corrente), então o banco
 * mostra `tax` a menos do que rendeu: o rendimento bruto é a diferença mais o
 * IR/IOF retido, e o imposto vira despesa ao lado dele.
 */
export function yieldToRecognize(
  account: BankAccount,
  s: ReturnType<typeof summarizeAccount>,
  tax = 0,
) {
  if (!isInvestment(account) || s.pending !== 0 || !s.hasMovement) return 0;
  const gross = currency(s.projectedDifference ?? 0).add(tax).value;
  return gross > 0 ? gross : 0;
}

/** Linha do rendimento reconhecido, no dia do saldo informado. */
export const yieldLine = (
  account: BankAccount,
  amount: number,
  date: Date,
): BankTransaction => ({
  id: `${account.id}~yield~${day(date)}`,
  date,
  amount,
  description: `Rendimento até ${format(date, "dd/MM/yyyy")}`,
  type: "credit",
  bankAccountId: account.id,
  status: "unmatched",
  origin: "yield",
});

/** Linha do IR/IOF retido nos resgates do período, no mesmo dia do rendimento. */
export const taxLine = (
  account: BankAccount,
  amount: number,
  date: Date,
): BankTransaction => ({
  id: `${account.id}~tax~${day(date)}`,
  date,
  amount: -amount,
  description: `IR/IOF retido nos resgates até ${format(date, "dd/MM/yyyy")}`,
  type: "debit",
  bankAccountId: account.id,
  status: "unmatched",
  origin: "tax",
});

// ─── Regras ───────────────────────────────────────────────────────────────────

/**
 * Forma comparável de um histórico. Dígitos saem: "TARIFA PACOTE 10/2026" e
 * "TARIFA PACOTE 11/2026" são a mesma tarifa em meses diferentes.
 */
export const rulePattern = (description: string) =>
  normalizeText(description)
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Regra ativa que cobre a linha; a de padrão mais longo (mais específica) vence. */
export function findRule(
  tx: BankTransaction,
  rules: ReconciliationRule[],
): ReconciliationRule | undefined {
  const text = rulePattern(tx.description);
  const direction = tx.amount < 0 ? "debit" : "credit";
  return rules
    .filter(
      (r) =>
        r.active &&
        r.pattern &&
        r.direction === direction &&
        text.includes(r.pattern),
    )
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
}

/**
 * Linhas ainda pendentes que alguma regra cobre viram sugestão. Título casado
 * vence regra: quem chama passa as linhas depois do casamento com o sistema.
 * Devolve a mesma referência para o que não mudou.
 */
export function applyRules(
  lines: BankTransaction[],
  rules: ReconciliationRule[],
): BankTransaction[] {
  return lines.map((tx) => {
    if (tx.status !== "unmatched") return tx;
    const rule = findRule(tx, rules);
    return rule ? { ...tx, status: "potential_match", ruleId: rule.id } : tx;
  });
}

/**
 * Lançamento já quitado para uma linha do extrato: valor e data são os do
 * banco, o resto vem do modelo (regra ou lançamento direto).
 */
export function lineTransaction(
  tx: BankTransaction,
  template: NonNullable<ReconciliationRule["template"]>,
): TransactionFormData {
  const amount = Math.abs(tx.amount);
  const date = new Date(tx.date);
  const isPayable = tx.amount < 0;
  return {
    type: isPayable ? "payable" : "receivable",
    // A baixa do sistema grava "paid" também para receita; "received" é legado.
    status: "paid",
    description: template.description,
    supplierOrClient: template.supplierOrClient,
    accountId: template.accountId,
    amount,
    finalAmount: amount,
    dueDate: date,
    paymentDate: date,
    paymentMethod: "transfer",
    bankAccountId: tx.bankAccountId,
    costCenterAllocation: [
      { costCenterId: template.costCenterId, percentage: 100, amount },
    ],
  };
}
