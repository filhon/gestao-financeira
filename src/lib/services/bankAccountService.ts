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

/** Só dígitos: o OFX traz "0001234-5", o cadastro pode ter "1234-5". */
const digits = (v?: string) => (v ?? "").replace(/\D/g, "").replace(/^0+/, "");

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

  /** Conta cadastrada que corresponde ao BANKID/ACCTID de um OFX. */
  findByStatement(
    accounts: BankAccount[],
    statement: { bankCode?: string; accountNumber?: string },
  ): BankAccount | undefined {
    const acct = digits(statement.accountNumber);
    if (!acct) return undefined;
    return accounts.find(
      (a) =>
        a.active &&
        digits(a.accountNumber) === acct &&
        (!a.bankCode ||
          !statement.bankCode ||
          digits(a.bankCode) === digits(statement.bankCode)),
    );
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
