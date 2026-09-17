import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  addDoc,
  updateDoc,
  deleteField,
  limit,
  DocumentData,
} from "firebase/firestore";
import { RecurringTransactionTemplate } from "@/lib/types";
import { stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "recurring_templates";

const toTemplate = (
  id: string,
  data: DocumentData,
): RecurringTransactionTemplate =>
  ({
    id,
    ...data,
    nextDueDate: (data.nextDueDate as Timestamp)?.toDate(),
    endDate: (data.endDate as Timestamp)?.toDate(),
    lastGeneratedAt: (data.lastGeneratedAt as Timestamp)?.toDate(),
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  }) as RecurringTransactionTemplate;

export const recurrenceService = {
  createTemplate: async (
    data: Omit<
      RecurringTransactionTemplate,
      "id" | "createdAt" | "updatedAt" | "lastGeneratedAt"
    >,
  ): Promise<string> => {
    // Campos opcionais do formulário (entidade, forma de pagamento…) chegam
    // como `undefined`, e o Firestore recusa a gravação inteira por isso.
    const docRef = await addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        active: true,
      }),
    );
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
    return snapshot.docs.map((doc) => toTemplate(doc.id, doc.data()));
  },

  updateTemplate: async (
    id: string,
    companyId: string,
    data: Partial<RecurringTransactionTemplate>,
  ): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error("Recorrência não encontrada");
    }
    if (docSnap.data().companyId !== companyId) {
      throw new Error("Recorrência não pertence a esta empresa");
    }

    // Chave presente com `undefined` = "apague este campo" (ex.: tirar a
    // data final). O Firestore recusa `undefined`; `deleteField()` é o jeito
    // de dizer isso. Dentro de objetos aninhados só se pode omitir a chave.
    const payload = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value === undefined ? deleteField() : stripUndefined(value),
      ]),
    );

    await updateDoc(docRef, { ...payload, updatedAt: Timestamp.now() });
  },
};
