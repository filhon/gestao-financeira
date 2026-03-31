import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Budget } from "@/lib/types";

const COLLECTION_NAME = "budgets";

export const budgetService = {
  getByCostCenterAndYear: async (
    costCenterId: string,
    year: number,
    companyId: string,
  ): Promise<Budget | null> => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("costCenterId", "==", costCenterId),
      where("year", "==", year),
      where("companyId", "==", companyId),
      limit(1),
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const docSnap = snapshot.docs[0];
    const data = docSnap.data();

    return {
      id: docSnap.id,
      ...data,
      createdAt: (data.createdAt as Timestamp)?.toDate(),
      updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    } as Budget;
  },

  getAllBalancesBatch: async (
    costCenterIds: string[],
    year: number,
    companyId: string,
  ): Promise<Budget[]> => {
    const budgets: Budget[] = [];
    const chunkSize = 30; // Firestore limit for 'in' is 30

    for (let i = 0; i < costCenterIds.length; i += chunkSize) {
      const chunk = costCenterIds.slice(i, i + chunkSize);
      const q = query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        where("year", "==", year),
        where("costCenterId", "in", chunk),
      );
      const snapshot = await getDocs(q);
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        budgets.push({
          id: doc.id,
          ...data,
          createdAt: (data.createdAt as Timestamp)?.toDate(),
          updatedAt: (data.updatedAt as Timestamp)?.toDate(),
        } as Budget);
      });
    }

    return budgets;
  },

  setBudget: async (
    costCenterId: string,
    year: number,
    amount: number,
    companyId: string,
  ) => {
    const existing = await budgetService.getByCostCenterAndYear(
      costCenterId,
      year,
      companyId,
    );

    if (existing) {
      const docRef = doc(db, COLLECTION_NAME, existing.id);
      await updateDoc(docRef, {
        amount,
        ...(companyId && { companyId }),
        updatedAt: serverTimestamp(),
      });
      return existing.id;
    } else {
      const docRef = await addDoc(collection(db, COLLECTION_NAME), {
        costCenterId,
        year,
        amount,
        ...(companyId && { companyId }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    }
  },
};
