import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, updateDoc, query, orderBy } from "firebase/firestore";
import { UserRole, UserProfile } from "@/lib/types";

const COLLECTION_NAME = "users";

export const userService = {
    getAll: async (): Promise<UserProfile[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy("displayName", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        } as UserProfile));
    },

    updateRole: async (uid: string, role: UserRole, companyId?: string) => {
        const docRef = doc(db, COLLECTION_NAME, uid);

        if (companyId) {
            // Update role for specific company
            await updateDoc(docRef, {
                [`companyRoles.${companyId}`]: role
            });
        } else {
            // Legacy/Global fallback
            await updateDoc(docRef, { role });
        }
    }
};
