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
 * Prova da conciliação de uma conta.
 *
 * Saldo conciliado = base + linhas tratadas (conciliadas ou ignoradas) depois
 * da base e até a data do saldo do extrato. Se o saldo de abertura estiver
 * certo e nenhuma linha faltar no arquivo, a diferença zera quando não sobra
 * linha pendente. Ignorar conta como tratar: é a decisão consciente de que o
 * movimento não pede lançamento (transferência entre contas, aplicação).
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
  const difference =
    account.statementBalance === undefined
      ? null
      : currency(account.statementBalance).subtract(bookBalance).value;

  return {
    base,
    bookBalance,
    statementBalance: account.statementBalance ?? null,
    statementDate: account.statementBalanceDate
      ? new Date(account.statementBalanceDate)
      : null,
    difference,
    total: inWindow.length,
    handled: handled.length,
    pending,
    canClose:
      difference === 0 && pending === 0 && !!until && until > day(base.date),
  };
}

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
