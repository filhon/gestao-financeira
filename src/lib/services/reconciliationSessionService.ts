import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  limit,
  writeBatch,
  deleteField,
} from "firebase/firestore";
import { BankTransaction } from "@/lib/types";

// Firestore write batches are capped at 500 operations; keep headroom.
const BATCH_SIZE = 400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj !== null && typeof obj === "object") {
    return Object.entries(obj).reduce(
      (acc, [key, value]) => {
        if (value !== undefined) acc[key] = stripUndefined(value);
        return acc;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
  }
  return obj;
};

// Serialize to plain JSON so nested Dates/undefined fields (matchedDetails,
// matchCandidates, etc.) become Firestore-safe values, same as the previous
// single-document format.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serializeItem = (tx: Partial<BankTransaction>): any =>
  stripUndefined(JSON.parse(JSON.stringify(tx)));

const runBatched = async <T>(
  items: T[],
  apply: (batch: ReturnType<typeof writeBatch>, item: T) => void,
): Promise<void> => {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    items.slice(i, i + BATCH_SIZE).forEach((item) => apply(batch, item));
    await batch.commit();
  }
};

export const reconciliationSessionService = {
  getItemsCollection(companyId: string) {
    if (!companyId) throw new Error("companyId is required");
    return collection(db, "reconciliation_sessions", companyId, "items");
  },

  /**
   * Upserts newly parsed bank transactions without touching items that already
   * exist in the session — reimporting the same (or an overlapping) statement
   * never discards in-progress matches/confirmations.
   */
  async mergeItems(
    companyId: string,
    transactions: BankTransaction[],
  ): Promise<{ added: number; skipped: number }> {
    const colRef = this.getItemsCollection(companyId);
    const existingSnap = await getDocs(colRef);
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const newItems = transactions.filter((tx) => !existingIds.has(tx.id));

    await runBatched(newItems, (batch, tx) => {
      batch.set(doc(colRef, tx.id), serializeItem(tx));
    });

    return {
      added: newItems.length,
      skipped: transactions.length - newItems.length,
    };
  },

  /** Partial update of a single bank transaction (status change, confirmed match, etc). */
  async updateItem(
    companyId: string,
    id: string,
    updates: Partial<BankTransaction>,
  ): Promise<void> {
    const colRef = this.getItemsCollection(companyId);
    const batch = writeBatch(db);
    batch.set(doc(colRef, id), serializeItem(updates), { merge: true });
    await batch.commit();
  },

  /** Partial update of many bank transactions at once (e.g. after auto-matching). */
  async bulkUpdateItems(
    companyId: string,
    updates: { id: string; data: Partial<BankTransaction> }[],
  ): Promise<void> {
    const colRef = this.getItemsCollection(companyId);
    await runBatched(updates, (batch, { id, data }) => {
      batch.set(doc(colRef, id), serializeItem(data), { merge: true });
    });
  },

  async clearSession(companyId: string): Promise<void> {
    const colRef = this.getItemsCollection(companyId);
    const snap = await getDocs(colRef);
    await runBatched(snap.docs, (batch, d) => batch.delete(d.ref));
  },

  subscribeToSession(
    companyId: string,
    callback: (transactions: BankTransaction[]) => void,
  ): () => void {
    const colRef = this.getItemsCollection(companyId);
    return onSnapshot(colRef, (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BankTransaction),
      );
    });
  },

  /**
   * One-time migration from the legacy single-document session
   * (`reconciliation_sessions/{companyId}` with a `transactions` array field)
   * into the per-item subcollection. No-op once the subcollection has any
   * item, so it's safe to call on every mount.
   */
  async migrateLegacySessionIfNeeded(companyId: string): Promise<void> {
    const colRef = this.getItemsCollection(companyId);
    const probe = await getDocs(query(colRef, limit(1)));
    if (!probe.empty) return;

    const legacyRef = doc(db, "reconciliation_sessions", companyId);
    const legacySnap = await getDoc(legacyRef);
    if (!legacySnap.exists()) return;

    const legacyTxs = (legacySnap.data().transactions ||
      []) as BankTransaction[];
    if (legacyTxs.length === 0) return;

    await runBatched(legacyTxs, (batch, tx) => {
      batch.set(doc(colRef, tx.id), serializeItem(tx));
    });

    // Clear the legacy array so this migration doesn't run again.
    const clearBatch = writeBatch(db);
    clearBatch.set(legacyRef, { transactions: deleteField() }, { merge: true });
    await clearBatch.commit();
  },
};
