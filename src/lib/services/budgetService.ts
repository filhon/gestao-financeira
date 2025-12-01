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
    limit
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Budget } from "@/lib/types";

const COLLECTION_NAME = "budgets";

export const budgetService = {
    getByCostCenterAndYear: async (costCenterId: string, year: number): Promise<Budget | null> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("costCenterId", "==", costCenterId),
            where("year", "==", year),
            limit(1)
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

    setBudget: async (costCenterId: string, year: number, amount: number) => {
        const existing = await budgetService.getByCostCenterAndYear(costCenterId, year);

        if (existing) {
            const docRef = doc(db, COLLECTION_NAME, existing.id);
            await updateDoc(docRef, {
                amount,
                updatedAt: serverTimestamp(),
            });
            return existing.id;
        } else {
            const docRef = await addDoc(collection(db, COLLECTION_NAME), {
                costCenterId,
                year,
                amount,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            return docRef.id;
        }
    }
};
