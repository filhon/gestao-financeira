import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    orderBy,
    serverTimestamp,
    Timestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { CostCenter } from "@/lib/types";
import { CostCenterFormData } from "@/lib/validations/costCenter";

const COLLECTION_NAME = "cost_centers";

export const costCenterService = {
    getAll: async (): Promise<CostCenter[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy("name"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate(),
            } as CostCenter;
        });
    },

    create: async (data: CostCenterFormData) => {
        return addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    },

    update: async (id: string, data: CostCenterFormData) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    delete: async (id: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return deleteDoc(docRef);
    },
};
