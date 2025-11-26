import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
    DocumentData
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuditLog } from "@/lib/types";

const COLLECTION_NAME = "audit_logs";

const convertDates = (data: DocumentData): AuditLog => {
    return {
        id: data.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
    } as AuditLog;
};

export const auditService = {
    log: async (data: Omit<AuditLog, "id" | "createdAt">): Promise<void> => {
        try {
            await addDoc(collection(db, COLLECTION_NAME), {
                ...data,
                createdAt: Timestamp.now(),
            });
        } catch (error) {
            console.error("Failed to create audit log:", error);
            // We don't throw here to avoid blocking the main action if logging fails
        }
    },

    getLogs: async (
        companyId: string,
        filter?: {
            userId?: string;
            entity?: string;
            action?: string;
            startDate?: Date;
            endDate?: Date;
        },
        limitCount = 50
    ): Promise<AuditLog[]> => {
        let q = query(
            collection(db, COLLECTION_NAME),
            where("companyId", "==", companyId),
            orderBy("createdAt", "desc")
        );

        if (filter?.userId) {
            q = query(q, where("userId", "==", filter.userId));
        }
        if (filter?.entity) {
            q = query(q, where("entity", "==", filter.entity));
        }
        if (filter?.action) {
            q = query(q, where("action", "==", filter.action));
        }
        if (filter?.startDate) {
            q = query(q, where("createdAt", ">=", Timestamp.fromDate(filter.startDate)));
        }
        if (filter?.endDate) {
            q = query(q, where("createdAt", "<=", Timestamp.fromDate(filter.endDate)));
        }

        q = query(q, limit(limitCount));

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    }
};
