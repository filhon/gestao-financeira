import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, getDoc, updateDoc, query, orderBy, serverTimestamp } from "firebase/firestore";
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

    getById: async (uid: string): Promise<UserProfile | null> => {
        const docRef = doc(db, COLLECTION_NAME, uid);
        const docSnap = await getDoc(docRef); // Requires getDoc import

        if (docSnap.exists()) {
            return {
                uid: docSnap.id,
                ...docSnap.data()
            } as UserProfile;
        }
        return null;
    },

    updateRole: async (uid: string, role: UserRole, adminUser: { uid: string; email: string }, companyId?: string) => {
        const docRef = doc(db, COLLECTION_NAME, uid);

        // Fetch current document to get old role
        const currentDoc = await getDoc(docRef);
        const currentData = currentDoc.exists() ? currentDoc.data() : {};
        const oldRole = companyId 
            ? currentData?.companyRoles?.[companyId] 
            : currentData?.role;

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
            details: { 
                changes: [{ field: 'role', oldValue: oldRole, newValue: role }],
                companyId 
            }
        });
    },

    updateStatus: async (uid: string, status: 'pending_company_setup' | 'pending_approval' | 'active' | 'rejected', adminUser: { uid: string; email: string }) => {
        const docRef = doc(db, COLLECTION_NAME, uid);

        // Fetch current document to get old status
        const currentDoc = await getDoc(docRef);
        const currentData = currentDoc.exists() ? currentDoc.data() : {};
        const oldStatus = currentData?.status;

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
            details: { 
                changes: [{ field: 'status', oldValue: oldStatus, newValue: status }]
            }
        });
    },

    setPendingCompanyAccess: async (uid: string, companyId: string, role: UserRole) => {
        const docRef = doc(db, COLLECTION_NAME, uid);
        await updateDoc(docRef, {
            pendingCompanyId: companyId,
            pendingRole: role,
            status: 'pending_approval',
            updatedAt: serverTimestamp()
        });
    },

    clearPendingAccess: async (uid: string) => {
        const docRef = doc(db, COLLECTION_NAME, uid);
        const { deleteField } = await import("firebase/firestore");
        await updateDoc(docRef, {
            pendingCompanyId: deleteField(),
            pendingRole: deleteField(),
            updatedAt: serverTimestamp()
        });
    },

    /**
     * Get users by role for a specific company
     * Useful for selecting approvers or authorizers
     */
    getUsersByRole: async (companyId: string, roles: UserRole[]): Promise<UserProfile[]> => {
        const allUsers = await userService.getAll(companyId);
        return allUsers.filter(user => {
            const companyRole = user.companyRoles?.[companyId];
            return companyRole && roles.includes(companyRole);
        });
    }
};
