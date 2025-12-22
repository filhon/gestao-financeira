import { db } from "@/lib/firebase/client";
import { collection, doc, getDocs, query, where, Timestamp, addDoc, updateDoc } from "firebase/firestore";
import { RecurringTransactionTemplate } from "@/lib/types";
import { transactionService } from "./transactionService";
import { addDays, addWeeks, addMonths, addYears, isBefore, isSameDay } from "date-fns";

const COLLECTION_NAME = "recurring_templates";

export const recurrenceService = {
    createTemplate: async (data: Omit<RecurringTransactionTemplate, "id" | "createdAt" | "updatedAt" | "lastGeneratedAt">): Promise<string> => {
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            active: true
        });
        return docRef.id;
    },

    getTemplates: async (companyId: string): Promise<RecurringTransactionTemplate[]> => {
        const q = query(collection(db, COLLECTION_NAME), where("companyId", "==", companyId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => {
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

    updateTemplate: async (id: string, data: Partial<RecurringTransactionTemplate>): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, {
            ...data,
            updatedAt: Timestamp.now()
        });
    },

    deleteTemplate: async (id: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, { active: false }); // Soft delete
    },

    processDueTemplates: async (companyId: string, user: { uid: string; email: string }): Promise<number> => {
        // 1. Get active templates for company
        const q = query(
            collection(db, COLLECTION_NAME),
            where("companyId", "==", companyId),
            where("active", "==", true)
        );
        const snapshot = await getDocs(q);
        const templates = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            nextDueDate: doc.data().nextDueDate.toDate(),
            endDate: doc.data().endDate?.toDate(),
        } as RecurringTransactionTemplate));

        let generatedCount = 0;
        const today = new Date();

        for (const template of templates) {
            // Check if due
            if (isBefore(template.nextDueDate, today) || isSameDay(template.nextDueDate, today)) {

                // Check end date
                if (template.endDate && isBefore(template.endDate, today)) {
                    await recurrenceService.updateTemplate(template.id, { active: false });
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
                    status: 'draft', // Created as draft for review? Or pending? Let's say draft for safety.
                    recurrence: {
                        isRecurring: true,
                        frequency: template.frequency,
                        currentInstallment: 0, // Infinite recurrence doesn't have fixed installments usually, or we track count?
                        // For now, let's just mark it as recurring source.
                    }
                };

                // Create Transaction
                await transactionService.create(newTransactionData, user, companyId);

                // Calculate Next Due Date
                let nextDate = template.nextDueDate;
                const interval = template.interval || 1;

                switch (template.frequency) {
                    case 'daily': nextDate = addDays(nextDate, interval); break;
                    case 'weekly': nextDate = addWeeks(nextDate, interval); break;
                    case 'monthly': nextDate = addMonths(nextDate, interval); break;
                    case 'yearly': nextDate = addYears(nextDate, interval); break;
                }

                // Update Template
                await recurrenceService.updateTemplate(template.id, {
                    nextDueDate: nextDate,
                    lastGeneratedAt: new Date()
                });

                generatedCount++;
            }
        }

        return generatedCount;
    }
};
