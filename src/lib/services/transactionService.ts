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
import { format, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { costCenterService } from "@/lib/services/costCenterService";
import { notificationService } from "@/lib/services/notificationService";

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
    getAll: async (filter?: { type?: string; status?: string; companyId?: string; batchId?: string }): Promise<Transaction[]> => {
        let q = query(collection(db, COLLECTION_NAME), orderBy("dueDate", "desc"));

        if (filter?.companyId) {
            q = query(q, where("companyId", "==", filter.companyId));
        }
        if (filter?.type) {
            q = query(q, where("type", "==", filter.type));
        }
        if (filter?.status) {
            q = query(q, where("status", "==", filter.status));
        }
        if (filter?.batchId) {
            q = query(q, where("batchId", "==", filter.batchId));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => convertDates({ id: doc.id, ...doc.data() }));
    },

    create: async (data: TransactionFormData, userId: string, companyId: string) => {
        const { useInstallments, installmentsCount, ...transactionData } = data;

        const status = data.status || "draft";

        if (useInstallments && installmentsCount && installmentsCount > 1) {
            const groupId = crypto.randomUUID();
            const totalAmount = transactionData.amount;
            const baseAmount = Math.floor((totalAmount / installmentsCount) * 100) / 100;
            const remainder = Math.round((totalAmount - (baseAmount * installmentsCount)) * 100) / 100;

            const promises = [];
            for (let i = 1; i <= installmentsCount; i++) {
                const amount = i === installmentsCount ? baseAmount + remainder : baseAmount;
                const dueDate = i === 1 ? transactionData.dueDate : addMonths(transactionData.dueDate, i - 1);
                const description = `${transactionData.description} (${i}/${installmentsCount})`;

                promises.push(addDoc(collection(db, COLLECTION_NAME), {
                    ...transactionData,
                    description,
                    amount,
                    dueDate,
                    installments: {
                        current: i,
                        total: installmentsCount,
                        groupId
                    },
                    companyId,
                    createdBy: userId,
                    status: status,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }));
            }

            const refs = await Promise.all(promises);

            // Trigger Notification if pending approval
            if (status === 'pending_approval' && transactionData.costCenterAllocation) {
                for (const allocation of transactionData.costCenterAllocation) {
                    const costCenter = await costCenterService.getById(allocation.costCenterId);
                    if (costCenter?.approverId) {
                        await notificationService.create({
                            userId: costCenter.approverId,
                            companyId,
                            title: "Nova Despesa para Aprovar",
                            message: `Uma nova despesa de R$ ${totalAmount} requer sua aprovação.`,
                            type: "info",
                            link: "/financeiro/contas-pagar"
                        });
                    }
                }
            }

            return refs[0];
        }

        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...transactionData,
            companyId,
            createdBy: userId,
            status: status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Trigger Notification if pending approval
        if (status === 'pending_approval' && transactionData.costCenterAllocation) {
            for (const allocation of transactionData.costCenterAllocation) {
                const costCenter = await costCenterService.getById(allocation.costCenterId);
                if (costCenter?.approverId) {
                    await notificationService.create({
                        userId: costCenter.approverId,
                        companyId,
                        title: "Nova Despesa para Aprovar",
                        message: `Uma nova despesa de R$ ${transactionData.amount} requer sua aprovação.`,
                        type: "info",
                        link: "/financeiro/contas-pagar"
                    });
                }
            }
        }

        return docRef;
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
        } else if (status === 'pending_approval') {
            // Generate Magic Link Token
            updateData.approvalToken = crypto.randomUUID();
            // Set expiration for 7 days
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);
            updateData.approvalTokenExpiresAt = expiresAt;
        }

        return updateDoc(docRef, updateData);
    },

    delete: async (id: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        return deleteDoc(docRef);
    },

    approveByToken: async (token: string, userId: string) => {
        const q = query(collection(db, COLLECTION_NAME), where("approvalToken", "==", token));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            throw new Error("Token inválido ou não encontrado.");
        }

        const docSnapshot = snapshot.docs[0];
        const transaction = convertDates({ id: docSnapshot.id, ...docSnapshot.data() });

        if (transaction.approvalTokenExpiresAt && transaction.approvalTokenExpiresAt < new Date()) {
            throw new Error("Este link de aprovação expirou.");
        }

        if (transaction.status !== 'pending_approval') {
            throw new Error("Esta transação já foi processada.");
        }

        // Approve
        const docRef = doc(db, COLLECTION_NAME, transaction.id);
        await updateDoc(docRef, {
            status: 'approved',
            approvedBy: userId,
            approvedAt: serverTimestamp(),
            approvalToken: null, // Consume token
            approvalTokenExpiresAt: null
        });

        return transaction;
    },

    getDashboardStats: async (companyId?: string) => {
        let q = query(collection(db, COLLECTION_NAME), orderBy("dueDate", "asc"));

        if (companyId) {
            q = query(q, where("companyId", "==", companyId));
        }

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
