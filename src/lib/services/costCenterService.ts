import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    orderBy,
    where,
    serverTimestamp,
    Timestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { CostCenter } from "@/lib/types";
import { CostCenterFormData } from "@/lib/validations/costCenter";

const COLLECTION_NAME = "cost_centers";

export const costCenterService = {
    getAll: async (companyId?: string): Promise<CostCenter[]> => {
        let q = query(collection(db, COLLECTION_NAME), orderBy("name"));

        if (companyId) {
            q = query(q, where("companyId", "==", companyId));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate(),
            } as CostCenter;
        });
    },

    create: async (data: CostCenterFormData, companyId: string) => {
        return addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            companyId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    },

    update: async (id: string, data: CostCenterFormData) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    delete: async (id: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return deleteDoc(docRef);
    },
};

export const getHierarchicalCostCenters = (items: CostCenter[]) => {
    const roots = items.filter(i => !i.parentId);
    const childrenMap = new Map<string, CostCenter[]>();

    items.forEach(item => {
        if (item.parentId) {
            const existing = childrenMap.get(item.parentId) || [];
            existing.push(item);
            childrenMap.set(item.parentId, existing);
        }
    });

    const result: (CostCenter & { level: number })[] = [];

    const traverse = (nodes: CostCenter[], level: number) => {
        nodes.forEach(node => {
            result.push({ ...node, level });
            const children = childrenMap.get(node.id) || [];
            traverse(children, level + 1);
        });
    };

    traverse(roots, 0);
    return result;
};
