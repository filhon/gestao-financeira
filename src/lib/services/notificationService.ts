import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
    DocumentData,
    writeBatch
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Notification } from "@/lib/types";

const COLLECTION_NAME = "notifications";

const convertDates = (data: DocumentData): Notification => {
    return {
        id: data.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
    } as Notification;
};

export const notificationService = {
    create: async (data: Omit<Notification, "id" | "createdAt" | "read">): Promise<void> => {
        const now = new Date();
        await addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            read: false,
            createdAt: Timestamp.fromDate(now),
        });
    },

    getUserNotifications: async (userId: string, limitCount = 20): Promise<Notification[]> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(limitCount)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    getUnreadCount: async (userId: string): Promise<number> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("userId", "==", userId),
            where("read", "==", false)
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    },

    markAsRead: async (id: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, {
            read: true,
        });
    },

    markAllAsRead: async (userId: string): Promise<void> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("userId", "==", userId),
            where("read", "==", false)
        );
        const snapshot = await getDocs(q);

        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => {
            batch.update(doc.ref, { read: true });
        });

        await batch.commit();
    }
};
