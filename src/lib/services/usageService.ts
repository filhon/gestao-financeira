import { db } from "@/lib/firebase/client";
import {
  doc,
  setDoc,
  increment,
  serverTimestamp,
  getDocs,
  query,
  collection,
  where,
  writeBatch,
} from "firebase/firestore";
import { Transaction } from "@/lib/types";

const COLLECTION_NAME = "cost_center_usage";

export const usageService = {
  updateUsage: async (transaction: Transaction, factor: 1 | -1) => {
    if (transaction.status === "rejected") return;
    // Only track payables for budget usage
    if (transaction.type !== "payable") return;

    // Determine date (paymentDate if paid, else dueDate)
    // Note: This logic must match dashboardService logic
    const date =
      transaction.status === "paid" && transaction.paymentDate
        ? transaction.paymentDate
        : transaction.dueDate;

    if (!date) return; // Should not happen

    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;

    const amount =
      transaction.status === "paid" && transaction.finalAmount
        ? transaction.finalAmount
        : transaction.amount;

    const isPaid = transaction.status === "paid";

    // Handle allocations
    if (
      transaction.costCenterAllocation &&
      transaction.costCenterAllocation.length > 0
    ) {
      const promises = transaction.costCenterAllocation.map((alloc) => {
        const allocAmount = (alloc.amount || 0) * factor;
        return usageService.increment(
          transaction.companyId,
          alloc.costCenterId,
          monthKey,
          allocAmount,
          isPaid ? allocAmount : 0,
        );
      });
      await Promise.all(promises);
    } else if (transaction.costCenterId) {
      const signedAmount = amount * factor;
      await usageService.increment(
        transaction.companyId,
        transaction.costCenterId,
        monthKey,
        signedAmount,
        isPaid ? signedAmount : 0,
      );
    }
  },

  increment: async (
    companyId: string,
    costCenterId: string,
    monthKey: string,
    amount: number,
    amountPaid: number = 0,
  ) => {
    const id = `${companyId}_${costCenterId}_${monthKey}`;
    const ref = doc(db, COLLECTION_NAME, id);

    // Use setDoc with merge to create if not exists
    try {
      await setDoc(
        ref,
        {
          companyId,
          costCenterId,
          monthKey,
          amount: increment(amount),
          amountPaid: increment(amountPaid),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      // Ignore permission errors if locked down for clients (CF fallback)
      console.warn("Could not update cost center usage:", error);
    }
  },

  getUsageByCostCenter: async (
    companyId: string,
    costCenterId: string,
    year: number,
  ) => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("costCenterId", "==", costCenterId),
      where("monthKey", ">=", `${year}-01`),
      where("monthKey", "<=", `${year}-12`),
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => doc.data() as { monthKey: string; amount: number },
    );
  },

  getUsageByCompanyAndYear: async (companyId: string, year: number) => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("monthKey", ">=", `${year}-01`),
      where("monthKey", "<=", `${year}-12`),
    );

    const snapshot = await getDocs(q);
    const usages: Record<string, number> = {};

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as { costCenterId: string; amount: number };
      if (!usages[data.costCenterId]) {
        usages[data.costCenterId] = 0;
      }
      usages[data.costCenterId] += data.amount || 0;
    });

    return usages;
  },

  recalculateAll: async (companyId: string) => {
    const BATCH_SIZE = 499;

    // 1. Lê transações e documentos existentes em paralelo
    const [txSnap, existingSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "transactions"),
          where("companyId", "==", companyId),
          where("type", "==", "payable"),
        ),
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAME),
          where("companyId", "==", companyId),
        ),
      ),
    ]);

    // 2. Agrega tudo em memória: docId → { costCenterId, monthKey, amount, amountPaid }
    const aggregated = new Map<
      string,
      { costCenterId: string; monthKey: string; amount: number; amountPaid: number }
    >();

    for (const d of txSnap.docs) {
      const data = d.data();
      if (data.status === "rejected") continue;

      const date = data.paymentDate?.toDate() ?? data.dueDate?.toDate();
      if (!date) continue;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const isPaid = data.status === "paid";
      const amount = Number(
        isPaid && data.finalAmount != null ? data.finalAmount : data.amount ?? 0,
      );

      const allocations: { costCenterId: string; amount: number }[] =
        data.costCenterAllocation?.length > 0
          ? data.costCenterAllocation
          : data.costCenterId
            ? [{ costCenterId: data.costCenterId, amount }]
            : [];

      for (const alloc of allocations) {
        const allocAmount = Number(alloc.amount ?? 0);
        const key = `${companyId}_${alloc.costCenterId}_${monthKey}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.amount += allocAmount;
          if (isPaid) existing.amountPaid += allocAmount;
        } else {
          aggregated.set(key, {
            costCenterId: alloc.costCenterId,
            monthKey,
            amount: allocAmount,
            amountPaid: isPaid ? allocAmount : 0,
          });
        }
      }
    }

    // 3. Deleta docs antigos + escreve novos — tudo em batches de 499
    let batch = writeBatch(db);
    let count = 0;
    const batches: ReturnType<typeof writeBatch>[] = [batch];

    const flush = () => {
      batch = writeBatch(db);
      batches.push(batch);
      count = 0;
    };

    for (const d of existingSnap.docs) {
      batch.delete(d.ref);
      if (++count >= BATCH_SIZE) flush();
    }

    for (const [key, entry] of aggregated) {
      const ref = doc(db, COLLECTION_NAME, key);
      batch.set(ref, {
        companyId,
        costCenterId: entry.costCenterId,
        monthKey: entry.monthKey,
        amount: entry.amount,
        amountPaid: entry.amountPaid,
        updatedAt: serverTimestamp(),
      });
      if (++count >= BATCH_SIZE) flush();
    }

    await Promise.all(batches.map((b) => b.commit()));
  },
};
