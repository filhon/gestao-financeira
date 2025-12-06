import { db } from "@/lib/firebase/client";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
    serverTimestamp,
    orderBy,
    addDoc,
    Timestamp,
    DocumentData
} from "firebase/firestore";
import { PaymentBatch, PaymentBatchStatus, Transaction } from "@/lib/types";

const COLLECTION_NAME = "payment_batches";
const TRANSACTIONS_COLLECTION = "transactions";

const convertDates = (data: DocumentData): PaymentBatch => {
    return {
        id: data.id,
        ...data,
        approvedAt: (data.approvedAt as Timestamp)?.toDate(),
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    } as PaymentBatch;
};

export const paymentBatchService = {
    getAll: async (companyId: string): Promise<PaymentBatch[]> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where("companyId", "==", companyId),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => convertDates({ id: doc.id, ...doc.data() }));
    },

    getById: async (id: string): Promise<PaymentBatch | null> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) return null;
        return convertDates({ id: snapshot.id, ...snapshot.data() });
    },

    create: async (name: string, companyId: string, createdBy: string) => {
        return addDoc(collection(db, COLLECTION_NAME), {
            name,
            companyId,
            createdBy,
            status: "open",
            transactionIds: [],
            totalAmount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    },

    addTransactions: async (batchId: string, transactions: Transaction[]) => {
        const batch = writeBatch(db);
        const batchRef = doc(db, COLLECTION_NAME, batchId);

        // Get current batch to calculate new total
        const batchSnap = await getDoc(batchRef);
        if (!batchSnap.exists()) throw new Error("Batch not found");
        const batchData = batchSnap.data() as PaymentBatch;

        const newIds = transactions.map(t => t.id);
        const additionalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

        // Update Batch
        batch.update(batchRef, {
            transactionIds: [...batchData.transactionIds, ...newIds],
            totalAmount: batchData.totalAmount + additionalAmount,
            updatedAt: serverTimestamp()
        });

        // Update Transactions
        transactions.forEach(t => {
            const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
            batch.update(tRef, { batchId: batchId });
        });

        await batch.commit();
    },

    removeTransactions: async (batchId: string, transactions: Transaction[]) => {
        const batch = writeBatch(db);
        const batchRef = doc(db, COLLECTION_NAME, batchId);

        const batchSnap = await getDoc(batchRef);
        if (!batchSnap.exists()) throw new Error("Batch not found");
        const batchData = batchSnap.data() as PaymentBatch;

        const idsToRemove = new Set(transactions.map(t => t.id));
        const newIds = batchData.transactionIds.filter(id => !idsToRemove.has(id));
        const amountToRemove = transactions.reduce((sum, t) => sum + t.amount, 0);

        batch.update(batchRef, {
            transactionIds: newIds,
            totalAmount: Math.max(0, batchData.totalAmount - amountToRemove),
            updatedAt: serverTimestamp()
        });

        transactions.forEach(t => {
            const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
            batch.update(tRef, { batchId: null }); // Or delete field
        });

        await batch.commit();
    },

    updateStatus: async (batchId: string, status: PaymentBatchStatus, userId: string) => {
        const batch = writeBatch(db);
        const batchRef = doc(db, COLLECTION_NAME, batchId);

        const batchSnap = await getDoc(batchRef);
        if (!batchSnap.exists()) throw new Error("Batch not found");
        const batchData = batchSnap.data() as PaymentBatch;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = { status, updatedAt: serverTimestamp() };
        if (status === 'approved') {
            updateData.approvedBy = userId;
            updateData.approvedAt = serverTimestamp();
        }

        batch.update(batchRef, updateData);

        // Propagate status to transactions if needed
        // If batch is approved, transactions become approved?
        // If batch is paid, transactions become paid?
        let transactionStatus: string | null = null;
        if (status === 'approved') transactionStatus = 'approved';
        if (status === 'paid') transactionStatus = 'paid';
        if (status === 'rejected') transactionStatus = 'rejected';

        if (transactionStatus) {
            batchData.transactionIds.forEach(tId => {
                const tRef = doc(db, TRANSACTIONS_COLLECTION, tId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const tUpdate: any = { status: transactionStatus };
                if (status === 'approved') {
                    tUpdate.approvedBy = userId;
                    tUpdate.approvedAt = serverTimestamp();
                }
                if (status === 'paid') {
                    tUpdate.releasedBy = userId;
                    tUpdate.releasedAt = serverTimestamp();
                }
                batch.update(tRef, tUpdate);
            });
        }

        await batch.commit();
    }
};
