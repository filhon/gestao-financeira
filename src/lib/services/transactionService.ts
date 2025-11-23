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
    Timestamp,
    DocumentData
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Transaction, TransactionStatus } from "@/lib/types";
import { TransactionFormData } from "@/lib/validations/transaction";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const COLLECTION_NAME = "transactions";

const convertDates = (data: DocumentData): Transaction => {
    return {
        id: data.id,
        ...data,
        dueDate: (data.dueDate as Timestamp)?.toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
        approvedAt: (data.approvedAt as Timestamp)?.toDate(),
        releasedAt: (data.releasedAt as Timestamp)?.toDate(),
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    } as Transaction;
};

export const transactionService = {
    getAll: async (filter?: { type?: string; status?: string }): Promise<Transaction[]> => {
        let q = query(collection(db, COLLECTION_NAME), orderBy("dueDate", "desc"));

        if (filter?.type) {
            q = query(q, where("type", "==", filter.type));
        }
        if (filter?.status) {
            q = query(q, where("status", "==", filter.status));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    create: async (data: TransactionFormData, userId: string) => {
        return addDoc(collection(db, COLLECTION_NAME), {
            ...data,
            createdBy: userId,
            status: "draft", // Always start as draft or pending based on logic
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    },

    update: async (id: string, data: Partial<TransactionFormData>) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
    },

    updateStatus: async (id: string, status: TransactionStatus, userId: string, role: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const updateData: any = { status, updatedAt: serverTimestamp() };

        if (status === 'approved') {
            updateData.approvedBy = userId;
            updateData.approvedAt = serverTimestamp();
        } else if (status === 'paid') {
            updateData.releasedBy = userId;
            updateData.releasedAt = serverTimestamp();
        }

        return updateDoc(docRef, updateData);
    },

    delete: async (id: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return deleteDoc(docRef);
    },

    getDashboardStats: async () => {
        const q = query(collection(db, COLLECTION_NAME), orderBy("dueDate", "asc"));
        const snapshot = await getDocs(q);
        const transactions = snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalBalance = 0;
        let monthlyIncome = 0;
        let monthlyExpense = 0;

        // Group by month for chart
        const monthlyData = new Map<string, { name: string; income: number; expense: number }>();

        transactions.forEach(t => {
            // Calculate totals based on status 'paid'/'received' (mapped to 'paid' in types)
            // For balance, we consider paid transactions
            if (t.status === 'paid') {
                if (t.type === 'receivable') {
                    totalBalance += t.amount;
                } else {
                    totalBalance -= t.amount;
                }
            }

            // Monthly stats (based on Due Date for projection or Payment Date for realized? Let's use Due Date for Cash Flow View)
            const tDate = t.dueDate;
            const tMonth = tDate.getMonth();
            const tYear = tDate.getFullYear();
            const monthKey = `${tYear}-${tMonth}`;

            // Initialize month data if needed
            if (!monthlyData.has(monthKey)) {
                monthlyData.set(monthKey, {
                    name: format(tDate, 'MMM', { locale: ptBR }),
                    income: 0,
                    expense: 0
                });
            }

            const monthStats = monthlyData.get(monthKey)!;

            if (t.type === 'receivable') {
                monthStats.income += t.amount;
                if (tMonth === currentMonth && tYear === currentYear) {
                    monthlyIncome += t.amount;
                }
            } else {
                monthStats.expense += t.amount;
                if (tMonth === currentMonth && tYear === currentYear) {
                    monthlyExpense += t.amount;
                }
            }
        });

        // Convert map to array and take last 6 months
        const chartData = Array.from(monthlyData.values()).slice(-6);

        return {
            totalBalance,
            monthlyIncome,
            monthlyExpense,
            chartData,
            recentTransactions: transactions.reverse().slice(0, 5)
        };
    }
};
