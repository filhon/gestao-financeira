import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, getDoc, setDoc, query, orderBy, where, limit, Timestamp } from "firebase/firestore";
import { Company } from "@/lib/types";
import { auditService } from "@/lib/services/auditService";

const COLLECTION_NAME = "companies";

// Normalize company name: lowercase, remove accents, trim
const normalizeName = (name: string): string => {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .trim();
};

// Normalize CNPJ: remove all non-digits
const normalizeCnpj = (cnpj: string): string => {
    return cnpj.replace(/\D/g, "");
};

export const companyService = {
    /**
     * Find company by CNPJ (primary) or normalized name (fallback)
     * Optimized for minimal reads
     */
    findByIdentifier: async (cnpj: string, name: string): Promise<Company | null> => {
        const normalizedCnpj = normalizeCnpj(cnpj);
        const normalizedNameValue = normalizeName(name);

        // First try: exact CNPJ match (most specific, indexed)
        if (normalizedCnpj) {
            const cnpjQuery = query(
                collection(db, COLLECTION_NAME),
                where("normalizedCnpj", "==", normalizedCnpj),
                limit(1)
            );
            const cnpjSnapshot = await getDocs(cnpjQuery);
            
            if (!cnpjSnapshot.empty) {
                const docData = cnpjSnapshot.docs[0];
                const data = docData.data();
                return {
                    id: docData.id,
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    updatedAt: data.updatedAt?.toDate(),
                } as Company;
            }
        }

        // Second try: normalized name match (fallback)
        if (normalizedNameValue) {
            const nameQuery = query(
                collection(db, COLLECTION_NAME),
                where("normalizedName", "==", normalizedNameValue),
                limit(1)
            );
            const nameSnapshot = await getDocs(nameQuery);
            
            if (!nameSnapshot.empty) {
                const docData = nameSnapshot.docs[0];
                const data = docData.data();
                return {
                    id: docData.id,
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    updatedAt: data.updatedAt?.toDate(),
                } as Company;
            }
        }

        return null;
    },

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

    getByIds: async (ids: string[]): Promise<Company[]> => {
        if (ids.length === 0) return [];

        // Firestore 'in' query limits to 30 items. If we ever exceed this, we need to batch.
        // For now, simple implementation.
        const { documentId, where: whereClause } = await import("firebase/firestore");
        const q = query(collection(db, COLLECTION_NAME), whereClause(documentId(), 'in', ids));
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

    create: async (data: Omit<Company, "id" | "createdAt" | "updatedAt">, adminUser: { uid: string; email: string }): Promise<Company> => {
        const docRef = doc(collection(db, COLLECTION_NAME));
        const now = new Date();

        // Create normalized fields for efficient querying
        const normalizedName = normalizeName(data.name);
        const normalizedCnpj = data.cnpj ? normalizeCnpj(data.cnpj) : null;

        const company: Company = {
            id: docRef.id,
            ...data,
            createdAt: now,
            updatedAt: now,
        };

        await setDoc(docRef, {
            ...data,
            normalizedName,
            ...(normalizedCnpj && { normalizedCnpj }),
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
        });

        await auditService.log({
            companyId: docRef.id,
            userId: adminUser.uid,
            userEmail: adminUser.email,
            action: 'create',
            entity: 'company',
            entityId: docRef.id,
            details: data
        });

        return company;
    },

    update: async (id: string, data: Partial<Omit<Company, "id" | "createdAt" | "updatedAt">>, adminUser: { uid: string; email: string }): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const now = new Date();

        await setDoc(docRef, {
            ...data,
            updatedAt: Timestamp.fromDate(now),
        }, { merge: true });

        await auditService.log({
            companyId: id,
            userId: adminUser.uid,
            userEmail: adminUser.email,
            action: 'update',
            entity: 'company',
            entityId: id,
            details: data
        });
    },

    delete: async (id: string, adminUser: { uid: string; email: string }): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        // Ideally we should check for related data (users, transactions) before deleting
        // For now, we just delete the company document
        const { deleteDoc } = await import("firebase/firestore");
        await deleteDoc(docRef);

        await auditService.log({
            companyId: id,
            userId: adminUser.uid,
            userEmail: adminUser.email,
            action: 'delete',
            entity: 'company',
            entityId: id,
            details: {}
        });
    }
};
