import { db } from "@/lib/firebase/client";
import { doc, getDoc, setDoc, onSnapshot, deleteDoc } from "firebase/firestore";
import { BankTransaction } from "@/lib/types";

export const reconciliationSessionService = {
  getSessionRef(companyId: string) {
    if (!companyId) throw new Error("companyId is required");
    return doc(db, "reconciliation_sessions", companyId);
  },

  async saveSession(
    companyId: string,
    transactions: BankTransaction[],
  ): Promise<void> {
    const ref = this.getSessionRef(companyId);

    // Serialize to plain JSON to avoid nested objects or unsupported date types in Firebase
    const serializedTxs = JSON.parse(JSON.stringify(transactions));

    await setDoc(ref, {
      transactions: serializedTxs,
      updatedAt: new Date().toISOString(),
    });
  },

  async getSession(companyId: string): Promise<BankTransaction[] | null> {
    const ref = this.getSessionRef(companyId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data().transactions as BankTransaction[];
  },

  async clearSession(companyId: string): Promise<void> {
    const ref = this.getSessionRef(companyId);
    await deleteDoc(ref);
  },

  subscribeToSession(
    companyId: string,
    callback: (transactions: BankTransaction[]) => void,
  ): () => void {
    const ref = this.getSessionRef(companyId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback((data.transactions || []) as BankTransaction[]);
      } else {
        callback([]);
      }
    });
  },
};
