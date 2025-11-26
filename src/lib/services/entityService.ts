import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
    DocumentData
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Entity } from "@/lib/types";
import { auditService } from "./auditService";

const COLLECTION_NAME = "entities";

const convertDates = (data: DocumentData): Entity => {
    return {
        id: data.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    } as Entity;
};

export const entityService = {
    getAll: async (companyId: string, category?: 'supplier' | 'client'): Promise<Entity[]> => {
        let q = query(
            collection(db, COLLECTION_NAME),
            where("companyId", "==", companyId),
            orderBy("name", "asc")
        );

        if (category) {
            // If category is specified, we want entities that match the category OR are 'both'
            // Firestore doesn't support logical OR in simple queries easily without multiple queries or "in" array.
            // Since 'both' is a valid value for any category search, we can use "in"
            q = query(q, where("category", "in", [category, 'both']));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    create: async (data: Omit<Entity, "id" | "createdAt" | "updatedAt">, user: { uid: string; email: string }): Promise<Entity> => {
        const now = new Date();
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
        });

        await auditService.log({
            companyId: data.companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'create',
            entity: 'entity',
            entityId: docRef.id,
            details: { name: data.name, type: data.type }
        });

        return {
            id: docRef.id,
            ...data,
            createdAt: now,
            updatedAt: now,
        };
    },

    update: async (id: string, data: Partial<Omit<Entity, "id" | "createdAt" | "updatedAt">>, user: { uid: string; email: string }, companyId: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const now = new Date();

        await updateDoc(docRef, {
            ...data,
            updatedAt: Timestamp.fromDate(now),
        });

        await auditService.log({
            companyId: companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'update',
            entity: 'entity',
            entityId: id,
            details: data
        });
    },

    delete: async (id: string, user: { uid: string; email: string }, companyId: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await deleteDoc(docRef);

        await auditService.log({
            companyId: companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'delete',
            entity: 'entity',
            entityId: id,
            details: {}
        });
    }
};
