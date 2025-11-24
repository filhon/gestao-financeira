import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, getDoc, setDoc, query, orderBy, Timestamp } from "firebase/firestore";
import { Company } from "@/lib/types";

const COLLECTION_NAME = "companies";

export const companyService = {
    getAll: async (): Promise<Company[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy("name", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
            } as Company;
        });
    },

    getById: async (id: string): Promise<Company | null> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) return null;

        const data = snapshot.data();
        return {
            id: snapshot.id,
            ...data,
            createdAt: data.createdAt?.toDate(),
            updatedAt: data.updatedAt?.toDate(),
        } as Company;
    },

    create: async (data: Omit<Company, "id" | "createdAt" | "updatedAt">): Promise<Company> => {
        const docRef = doc(collection(db, COLLECTION_NAME));
        const now = new Date();

        const company: Company = {
            id: docRef.id,
            ...data,
            createdAt: now,
            updatedAt: now,
        };

        await setDoc(docRef, {
            ...data,
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
        });

        return company;
    },

    update: async (id: string, data: Partial<Omit<Company, "id" | "createdAt" | "updatedAt">>): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const now = new Date();

        await setDoc(docRef, {
            ...data,
            updatedAt: Timestamp.fromDate(now),
        }, { merge: true });
    },

    delete: async (id: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        // Ideally we should check for related data (users, transactions) before deleting
        // For now, we just delete the company document
        await setDoc(docRef, { active: false }, { merge: true }); // Soft delete or actual delete? Plan said hard delete but soft is safer. 
        // Let's do hard delete as per plan, but maybe soft is better? 
        // The plan said "Hard delete for now". Okay.
        const { deleteDoc } = await import("firebase/firestore");
        await deleteDoc(docRef);
    }
};
