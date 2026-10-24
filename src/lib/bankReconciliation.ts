import currency from "currency.js";
import { format } from "date-fns";
import type {
  BankAccount,
  BankAccountClosing,
  BankTransaction,
} from "@/lib/types";

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
