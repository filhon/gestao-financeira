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
import { transactionService } from "./transactionService";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isBefore,
  isSameDay,
} from "date-fns";

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

  processDueTemplates: async (
    companyId: string,
    user: { uid: string; email: string },
  ): Promise<number> => {
    // 1. Get active templates for company
    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("active", "==", true),
    );
    const snapshot = await getDocs(q);
    const templates = snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
          nextDueDate: doc.data().nextDueDate.toDate(),
          endDate: doc.data().endDate?.toDate(),
        }) as RecurringTransactionTemplate,
    );

    let generatedCount = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const template of templates) {
      // Determine the threshold date based on transaction type
      // For payables, we generate 7 days in advance
      const thresholdDate =
        template.type === "payable" ? addDays(today, 7) : today;

      // Check if due
      if (
        isBefore(template.nextDueDate, thresholdDate) ||
        isSameDay(template.nextDueDate, thresholdDate)
      ) {
        // Check end date
        if (template.endDate && isBefore(template.endDate, today)) {
          await recurrenceService.updateTemplate(template.id, {
            active: false,
          });
          continue;
        }

        // Generate Transaction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newTransactionData: any = {
          ...template.baseTransactionData,
          description: `${template.description} (Recorrência)`,
          amount: template.amount,
          type: template.type,
          dueDate: template.nextDueDate,
          status: "draft", // Created as draft for review? Or pending? Let's say draft for safety.
          recurrence: {
            isRecurring: true,
            frequency: template.frequency,
            currentInstallment: 0, // Infinite recurrence doesn't have fixed installments usually, or we track count?
            // For now, let's just mark it as recurring source.
          },
        };

        // Create Transaction
        await transactionService.create(newTransactionData, user, companyId);

        // Calculate Next Due Date
        let nextDate = template.nextDueDate;
        const interval = template.interval || 1;

        switch (template.frequency) {
          case "daily":
            nextDate = addDays(nextDate, interval);
            break;
          case "weekly":
            nextDate = addWeeks(nextDate, interval);
            break;
          case "monthly":
            nextDate = addMonths(nextDate, interval);
            break;
          case "yearly":
            nextDate = addYears(nextDate, interval);
            break;
        }

        // Update Template
        await recurrenceService.updateTemplate(template.id, {
          nextDueDate: nextDate,
          lastGeneratedAt: new Date(),
        });

        generatedCount++;
      }
    }

    return generatedCount;
  },
};
