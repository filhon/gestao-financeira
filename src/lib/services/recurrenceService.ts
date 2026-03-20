import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  Timestamp,
  addDoc,
  updateDoc,
  orderBy,
  startAfter,
  limit,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { RecurringTransactionTemplate } from "@/lib/types";


const COLLECTION_NAME = "recurring_templates";

export const recurrenceService = {
  createTemplate: async (
    data: Omit<
      RecurringTransactionTemplate,
      "id" | "createdAt" | "updatedAt" | "lastGeneratedAt"
    >,
  ): Promise<string> => {
    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      active: true,
    });
    return docRef.id;
  },

  getTemplates: async (
    companyId: string,
    filter?: { active?: boolean; limit?: number },
  ): Promise<RecurringTransactionTemplate[]> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
    );

    if (filter?.active !== undefined) {
      q = query(q, where("active", "==", filter.active));
    }

    if (filter?.limit) {
      q = query(q, limit(filter.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        nextDueDate: data.nextDueDate.toDate(),
        endDate: data.endDate?.toDate(),
        lastGeneratedAt: data.lastGeneratedAt?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
      } as RecurringTransactionTemplate;
    });
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
    filters?: {
      active?: boolean;
      searchTerm?: string;
    },
  ): Promise<{
    templates: RecurringTransactionTemplate[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
    );

    if (filters?.active !== undefined) {
      q = query(q, where("active", "==", filters.active));
    }

    if (filters?.searchTerm) {
      q = query(q, where("description", "==", filters.searchTerm));
    }

    q = query(q, orderBy("nextDueDate", "asc"));

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const templates = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        nextDueDate: data.nextDueDate.toDate(),
        endDate: data.endDate?.toDate(),
        lastGeneratedAt: data.lastGeneratedAt?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
      } as RecurringTransactionTemplate;
    });

    return {
      templates,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  },

  updateTemplate: async (
    id: string,
    data: Partial<RecurringTransactionTemplate>,
  ): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: Timestamp.now(),
    });
  },

  deleteTemplate: async (id: string): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, { active: false }); // Soft delete
  },
};
