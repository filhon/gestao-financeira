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
    },

    notifyAdminsOfNewUser: async (
        companyId: string,
        companyName: string,
        userName: string,
        requestedRole: string
    ): Promise<void> => {
        // Find global admins (users with role === 'admin')
        const usersRef = collection(db, "users");
        const adminQuery = query(usersRef, where("role", "==", "admin"));
        const adminSnapshot = await getDocs(adminQuery);

        console.log(`[notifyAdminsOfNewUser] Found ${adminSnapshot.docs.length} global admins`);

        // Note: We cannot query for company admins using dynamic field names in Firestore
        // (e.g., `companyRoles.${companyId}` as a field path doesn't work for queries)
        // In the future, this should be handled by a Cloud Function with admin SDK

        const adminIds = new Set<string>();
        adminSnapshot.docs.forEach(doc => {
            adminIds.add(doc.id);
        });

        // Send notification to each admin
        for (const adminId of adminIds) {
            await notificationService.create({
                userId: adminId,
                companyId: companyId,
                title: "Novo usuário pendente",
                message: `${userName} solicitou acesso como ${requestedRole} na empresa ${companyName}.`,
                type: 'info',
                link: '/configuracoes/usuarios'
            });
        }
    }
};
