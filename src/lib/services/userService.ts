import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, updateDoc, query, orderBy, serverTimestamp } from "firebase/firestore";
import { UserRole, UserProfile } from "@/lib/types";
import { auditService } from "@/lib/services/auditService";

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

    updateRole: async (uid: string, role: UserRole, adminUser: { uid: string; email: string }, companyId?: string) => {
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

        await auditService.log({
            companyId: companyId || 'global',
            userId: adminUser.uid,
            userEmail: adminUser.email,
            action: 'update',
            entity: 'user',
            entityId: uid,
            details: { role, companyId }
        });
    },

    updateStatus: async (uid: string, status: 'pending' | 'active' | 'rejected', adminUser: { uid: string; email: string }) => {
        const docRef = doc(db, COLLECTION_NAME, uid);
        await updateDoc(docRef, {
            status,
            active: status === 'active', // Sync legacy field
            updatedAt: serverTimestamp()
        });

        await auditService.log({
            companyId: 'global', // User status is global usually
            userId: adminUser.uid,
            userEmail: adminUser.email,
            action: status === 'active' ? 'approve' : status === 'rejected' ? 'reject' : 'update',
            entity: 'user',
            entityId: uid,
            details: { status }
        });
    }
};
