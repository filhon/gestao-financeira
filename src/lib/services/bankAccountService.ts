import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { auditService } from "@/lib/services/auditService";
import { BankAccount, BankAccountClosing } from "@/lib/types";
import { stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "bank_accounts";

type Actor = { uid: string; email: string };

export type BankAccountDraft = Pick<
  BankAccount,
  | "name"
  | "bankName"
  | "bankCode"
  | "agency"
  | "accountNumber"
  | "openingBalance"
  | "openingBalanceDate"
  | "active"
  | "kind"
  | "product"
  | "liquidity"
  | "linkedAccountId"
  | "yieldAccountId"
>;

const toDate = (v: unknown) =>
  v instanceof Timestamp ? v.toDate() : v ? new Date(v as string) : undefined;

const fromDoc = (id: string, data: Record<string, unknown>): BankAccount =>
  ({
    id,
    ...data,
    openingBalanceDate: toDate(data.openingBalanceDate),
    statementBalanceDate: toDate(data.statementBalanceDate),
    closings: ((data.closings as BankAccountClosing[] | undefined) ?? []).map(
      (c) => ({
        ...c,
        through: toDate(c.through)!,
        closedAt: toDate(c.closedAt)!,
      }),
    ),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }) as BankAccount;

const rawDigits = (v?: string) => (v ?? "").replace(/\D/g, "");
/** Só dígitos, sem zeros à esquerda: "0001234-5" e "1234-5" viram "12345". */
const digits = (v?: string) => rawDigits(v).replace(/^0+/, "");

/**
 * Quão especificamente o extrato aponta para a conta (0 = não é ela).
 *
 * Cada banco monta o ACCTID de um jeito: Itaú manda agência+conta+DV
 * ("0364362426"), BB e Bradesco põem a agência no BRANCHID, Caixa inclui a
 * operação, alguns omitem o DV. Então a conta cadastrada é procurada como
 * sufixo dos dígitos do extrato (BRANCHID + ACCTID), com e sem o DV dos dois
 * lados. A pontuação é o tamanho do trecho que bateu.
 */
function statementScore(a: BankAccount, statementDigits: string): number {
  const account = rawDigits(a.accountNumber);
  if (!account) return 0;
  const keys = [
    a.agency ? rawDigits(a.agency) + account : "",
    account,
    // "12345-6" cadastrado, extrato sem o DV.
    /\D\s*\w$/.test(a.accountNumber ?? "") ? account.slice(0, -1) : "",
  ]
    .map((k) => k.replace(/^0+/, ""))
    .filter((k) => k.length >= 4);

  let best = 0;
  for (const key of keys) {
    if (statementDigits.endsWith(key)) best = Math.max(best, key.length);
    // Cadastro sem o DV, extrato com ele.
    else if (statementDigits.slice(0, -1).endsWith(key))
      best = Math.max(best, key.length - 0.5);
  }
  return best;
}

export const bankAccountService = {
  async getAll(companyId: string): Promise<BankAccount[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
      ),
    );
    return snap.docs
      .map((d) => fromDoc(d.id, d.data()))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  },

  /**
   * Conta cadastrada que corresponde ao BANKID/BRANCHID/ACCTID de um OFX.
   * Empate entre duas contas = ambíguo: melhor não escolher do que importar
   * na conta errada.
   */
  findByStatement(
    accounts: BankAccount[],
    statement: { bankCode?: string; branchId?: string; accountNumber?: string },
  ): BankAccount | undefined {
    if (!digits(statement.accountNumber)) return undefined;
    const statementDigits = (
      rawDigits(statement.branchId) + rawDigits(statement.accountNumber)
    ).replace(/^0+/, "");
    // Código COMPE tem até 3 dígitos; há bancos que mandam o ISPB (8) no
    // BANKID, e esse não dá para comparar com o cadastro.
    const bank = digits(statement.bankCode);
    const comparableBank = bank.length > 0 && bank.length <= 3 ? bank : "";

    let best: BankAccount | undefined;
    let bestScore = 0;
    let tie = false;
    for (const a of accounts) {
      if (!a.active) continue;
      if (comparableBank && a.bankCode && digits(a.bankCode) !== comparableBank)
        continue;
      const score = statementScore(a, statementDigits);
      if (score > bestScore) {
        best = a;
        bestScore = score;
        tie = false;
      } else if (score > 0 && score === bestScore) {
        tie = true;
      }
    }
    return tie ? undefined : best;
  },

  async create(draft: BankAccountDraft, companyId: string, actor: Actor) {
    const ref = await addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...draft,
        companyId,
        closings: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "create",
      entity: "bank_account",
      entityId: ref.id,
      details: { name: draft.name },
    });
    return ref.id;
  },

  async update(account: BankAccount, draft: BankAccountDraft, actor: Actor) {
    // O saldo de abertura é a base de toda conciliação; depois do primeiro
    // fechamento, mudá-lo reescreveria períodos já conferidos.
    if (
      account.closings?.length &&
      (draft.openingBalance !== account.openingBalance ||
        draft.openingBalanceDate.getTime() !==
          account.openingBalanceDate.getTime())
    ) {
      throw new Error(
        "O saldo de abertura não pode mudar depois do primeiro fechamento. Reabra os períodos antes.",
      );
    }
    await updateDoc(
      doc(db, COLLECTION_NAME, account.id),
      stripUndefined({ ...draft, updatedAt: serverTimestamp() }),
    );
    await auditService.log({
      companyId: account.companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "bank_account",
      entityId: account.id,
      details: { name: draft.name },
    });
  },

  /** Saldo final do extrato (LEDGERBAL do OFX ou digitado para CSV). */
  async setStatementBalance(id: string, balance: number, date: Date) {
    await updateDoc(doc(db, COLLECTION_NAME, id), {
      statementBalance: balance,
      statementBalanceDate: Timestamp.fromDate(date),
      updatedAt: serverTimestamp(),
    });
  },

  async close(
    account: BankAccount,
    through: Date,
    balance: number,
    actor: Actor,
  ) {
    const closing = {
      through: Timestamp.fromDate(through),
      balance,
      closedBy: actor.uid,
      closedAt: Timestamp.now(),
    };
    const ref = doc(db, COLLECTION_NAME, account.id);
    const current = (await getDoc(ref)).data()?.closings ?? [];
    await updateDoc(ref, {
      closings: [...current, closing],
      updatedAt: serverTimestamp(),
    });
    await auditService.log({
      companyId: account.companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "close_period",
      entity: "bank_account",
      entityId: account.id,
      details: { name: account.name, through: through.toISOString(), balance },
    });
  },

  /** Desfaz só o último fechamento; os anteriores continuam valendo. */
  async reopenLast(account: BankAccount, actor: Actor) {
    const ref = doc(db, COLLECTION_NAME, account.id);
    const current: unknown[] = (await getDoc(ref)).data()?.closings ?? [];
    if (current.length === 0) return;
    await updateDoc(ref, {
      closings: current.slice(0, -1),
      updatedAt: serverTimestamp(),
    });
    const last = account.closings?.at(-1);
    await auditService.log({
      companyId: account.companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "reopen_period",
      entity: "bank_account",
      entityId: account.id,
      details: {
        name: account.name,
        through: last?.through.toISOString(),
      },
    });
  },
};
