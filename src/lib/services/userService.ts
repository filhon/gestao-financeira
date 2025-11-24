import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, updateDoc, query, orderBy } from "firebase/firestore";
import { UserRole, UserProfile } from "@/lib/types";

const COLLECTION_NAME = "users";

export const userService = {
    getAll: async (companyId?: string): Promise<UserProfile[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy("displayName", "asc"));
        const snapshot = await getDocs(q);
        const users = snapshot.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        } as UserProfile));

        if (companyId) {
            return users.filter(u => u.companyRoles && u.companyRoles[companyId]);
        }
        return users;
    },

    updateRole: async (uid: string, role: UserRole, companyId?: string) => {
        const docRef = doc(db, COLLECTION_NAME, uid);

        if (companyId) {
            // Update role for specific company
            await updateDoc(docRef, {
                [`companyRoles.${companyId}`]: role,
                updatedAt: serverTimestamp()
            });
        } else {
            // Legacy/Global fallback
            await updateDoc(docRef, { role, updatedAt: serverTimestamp() });
        }
    },

    updateStatus: async (uid: string, status: 'pending' | 'active' | 'rejected') => {
        const docRef = doc(db, COLLECTION_NAME, uid);
        await updateDoc(docRef, {
            status,
            active: status === 'active', // Sync legacy field
            updatedAt: serverTimestamp()
        });
    }
};
