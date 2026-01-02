import { db } from "@/lib/firebase/client";
import { doc, setDoc, increment, serverTimestamp } from "firebase/firestore";
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
          allocAmount
        );
      });
      await Promise.all(promises);
    } else if (transaction.costCenterId) {
      const signedAmount = amount * factor;
      await usageService.increment(
        transaction.companyId,
        transaction.costCenterId,
        monthKey,
        signedAmount
      );
    }
  },

  increment: async (
    companyId: string,
    costCenterId: string,
    monthKey: string,
    amount: number
  ) => {
    const id = `${companyId}_${costCenterId}_${monthKey}`;
    const ref = doc(db, COLLECTION_NAME, id);

    // Use setDoc with merge to create if not exists
    await setDoc(
      ref,
      {
        companyId,
        costCenterId,
        monthKey,
        amount: increment(amount),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  },

  getUsageByCostCenter: async (
    companyId: string,
    costCenterId: string,
    year: number
  ) => {
    const { getDocs, query, collection, where } =
      await import("firebase/firestore");
    const { db } = await import("@/lib/firebase/client");

    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("costCenterId", "==", costCenterId),
      where("monthKey", ">=", `${year}-01`),
      where("monthKey", "<=", `${year}-12`)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => doc.data() as { monthKey: string; amount: number }
    );
  },

  recalculateAll: async (companyId: string) => {
    // This function should be called once to migrate existing data
    const { getDocs, query, collection, where } =
      await import("firebase/firestore");
    const { db } = await import("@/lib/firebase/client");

    const q = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId)
    );
    const snapshot = await getDocs(q);

    console.log(`Recalculating usage for ${snapshot.size} transactions...`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const tx = {
        id: doc.id,
        ...data,
        dueDate: data.dueDate?.toDate(),
        paymentDate: data.paymentDate?.toDate(),
      } as Transaction;
      await usageService.updateUsage(tx, 1);
    }
    console.log("Recalculation complete.");
  },
};
