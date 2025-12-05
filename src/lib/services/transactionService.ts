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
import { auditService } from "@/lib/services/auditService";
import { emailService } from "@/lib/services/emailService";

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

// Helper to remove undefined values for Firestore
const stripUndefined = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => stripUndefined(v));
    } else if (obj !== null && typeof obj === 'object') {
        // Handle Date objects correctly - return as is
        if (obj instanceof Date || obj instanceof Timestamp) return obj;

        return Object.entries(obj).reduce((acc, [key, value]) => {
            if (value !== undefined) {
                acc[key] = stripUndefined(value);
            }
            return acc;
        }, {} as any);
    }
    return obj;
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

    getByCostCenter: async (costCenterId: string, companyId: string): Promise<Transaction[]> => {
        // Since we can't easily query array of objects in Firestore without a specific index structure,
        // we'll fetch company transactions and filter. 
        // Optimization: In a real app, we should maintain a 'relatedCostCenterIds' array field on the transaction.
        const all = await transactionService.getAll({ companyId });
        return all.filter(t => t.costCenterAllocation?.some(a => a.costCenterId === costCenterId));
    },

    create: async (data: TransactionFormData, user: { uid: string; email: string }, companyId: string) => {
        const cleanData = stripUndefined(data); // Clean data on create too
        const { useInstallments, installmentsCount, ...transactionData } = cleanData;
        const userId = user.uid;

        const status = cleanData.status || "draft";

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
                    if (costCenter?.approverEmail) {
                        // Generate token for the first installment to allow approval start
                        // Ideally we would have a "Group Approval" but for now let's link the first one.
                        const token = crypto.randomUUID();
                        const expiresAt = new Date();
                        expiresAt.setDate(expiresAt.getDate() + 7);

                        // Update the first installment with the token
                        await updateDoc(refs[0], {
                            approvalToken: token,
                            approvalTokenExpiresAt: expiresAt
                        });

                        // Send Email
                        await emailService.sendApprovalRequest({
                            id: refs[0].id,
                            ...transactionData,
                            amount: totalAmount, // Show total amount in email
                            approvalToken: token,
                            requestOrigin: transactionData.requestOrigin
                        } as any, costCenter.approverEmail);
                    }
                }
            }

            return refs[0];
        }

        // Single Create
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
                if (costCenter?.approverEmail) {
                    // We need to ensure the transaction has a token if we want magic links.
                    // But `addDoc` above didn't add a token.
                    // We should probably update the doc with a token OR generate it before adding.
                    // Let's generate it before adding.
                    // But I can't change the `addDoc` call easily without a huge replace.
                    // For now, let's just send the email. If the token is missing, the email service might fail or send a broken link?
                    // `emailService` uses `transaction.approvalToken`.
                    // So we MUST generate a token.

                    // Strategy: Update the transaction with a token immediately.
                    const token = crypto.randomUUID();
                    const expiresAt = new Date();
                    expiresAt.setDate(expiresAt.getDate() + 7);

                    await updateDoc(docRef, {
                        approvalToken: token,
                        approvalTokenExpiresAt: expiresAt
                    });

                    await emailService.sendApprovalRequest({
                        id: docRef.id,
                        ...transactionData,
                        amount: transactionData.amount,
                        approvalToken: token,
                        requestOrigin: transactionData.requestOrigin // Ensure this is passed
                    } as any, costCenter.approverEmail);
                }
            }
        }

        // Log Audit
        await auditService.log({
            companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'create',
            entity: 'transaction',
            entityId: docRef.id,
            details: { amount: transactionData.amount, description: transactionData.description }
        });

        return docRef;
    },

    update: async (id: string, data: Partial<TransactionFormData>, user: { uid: string; email: string }, companyId: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const cleanData = stripUndefined(data); // Sanitize data

        await updateDoc(docRef, {
            ...cleanData,
            updatedAt: serverTimestamp(),
        });

        await auditService.log({
            companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'update',
            entity: 'transaction',
            entityId: id,
            details: cleanData
        });
    },

    updateRecurrence: async (
        originalTransaction: Transaction,
        data: Partial<TransactionFormData>,
        scope: "single" | "series",
        user: { uid: string; email: string },
        companyId: string
    ) => {
        if (scope === "single" || !originalTransaction.installments?.groupId) {
            await transactionService.update(originalTransaction.id, data, user, companyId);
            return;
        }

        // Scope: Series (This and Future)
        if (scope === "series") {
            const q = query(
                collection(db, COLLECTION_NAME),
                where("installments.groupId", "==", originalTransaction.installments.groupId),
                where("dueDate", ">=", originalTransaction.dueDate) // Filter for this and future
            );

            const snapshot = await getDocs(q);
            const promises = snapshot.docs.map(async (docSnapshot) => {
                const t = docSnapshot.data();
                // Avoid updating 'dueDate' relative to each other if it's not a generic update
                // For simplified 'Edit', we might replace description, amount, category, etc.
                // We typically DO NOT update 'dueDate' in batch because each installment has its own month.
                // If user changed Date in Form, it's ambiguous if they mean "Shift all by X days" or "Set all to Date Y".
                // For MVP, let's exclude 'dueDate' from batch updates or handle explicitly.
                // Let's exclude 'dueDate' and 'installments' data from batch to be safe, unless needed.

                const { dueDate, installments, ...safeData } = data as any;
                const cleanData = stripUndefined(safeData); // Sanitize data

                const updateData = {
                    ...cleanData,
                    updatedAt: serverTimestamp()
                };

                return updateDoc(docSnapshot.ref, updateData);
            });

            await Promise.all(promises);

            await auditService.log({
                companyId,
                userId: user.uid,
                userEmail: user.email,
                action: 'update',
                entity: 'transaction',
                entityId: originalTransaction.installments.groupId,
                details: { ...data, scope, count: snapshot.size, isRecurrenceUpdate: true }
            });
        }
    },

    settle: async (id: string, data: { paymentDate: Date; finalAmount: number; discount: number; interest: number }, user: { uid: string, email: string }, companyId: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);

        // Audit Log
        await auditService.log({
            companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'update',
            entity: 'transaction',
            entityId: id,
            details: { status: 'paid', ...data }
        });

        return updateDoc(docRef, {
            status: 'paid',
            paymentDate: Timestamp.fromDate(data.paymentDate),
            finalAmount: data.finalAmount,
            discount: data.discount,
            interest: data.interest,
            releasedBy: user.uid,
            releasedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    },

    updateStatus: async (id: string, status: TransactionStatus, user: { uid: string; email: string }, companyId: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const updateData: any = { status, updatedAt: serverTimestamp() };
        const userId = user.uid;

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

        await updateDoc(docRef, updateData);

        await auditService.log({
            companyId,
            userId: user.uid,
            userEmail: user.email,
            action: status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'update',
            entity: 'transaction',
            entityId: id,
            details: { status }
        });
    },

    delete: async (id: string, user: { uid: string; email: string }, companyId: string) => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await deleteDoc(docRef);

        await auditService.log({
            companyId,
            userId: user.uid,
            userEmail: user.email,
            action: 'delete',
            entity: 'transaction',
            entityId: id,
            details: {}
        });
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
            // Determine date and amount to use
            let dateToUse = t.dueDate;
            let amountToUse = t.amount;

            if (t.status === 'paid') {
                if (t.paymentDate) {
                    dateToUse = t.paymentDate;
                }
                if (t.finalAmount !== undefined) {
                    amountToUse = t.finalAmount;
                }
            }

            // Calculate totals based on status 'paid'/'received' (mapped to 'paid' in types)
            // For balance, we consider paid transactions
            if (t.status === 'paid') {
                if (t.type === 'receivable') {
                    totalBalance += amountToUse;
                } else {
                    totalBalance -= amountToUse;
                }
            }

            // Monthly stats
            const tDate = dateToUse;
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
                monthStats.income += amountToUse;
            } else {
                monthStats.expense += amountToUse;
            }

            // Current Month Stats (for cards)
            if (tMonth === currentMonth && tYear === currentYear) {
                if (t.type === 'receivable') {
                    monthlyIncome += amountToUse;
                } else {
                    monthlyExpense += amountToUse;
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
    },

    getUpcomingByUser: async (userId: string, companyId: string, days: number = 7): Promise<Transaction[]> => {
        // Calculate date range
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        // Query: status != 'paid' (we want open bills), type == 'payable', companyId == companyId
        // We can't easily filter by date AND multiple fields without composite indexes in Firestore sometimes.
        // Let's query by company and filter in memory since dataset per company isn't huge yet for MVP, 
        // OR better: query by status and type, then filter by date.

        const q = query(
            collection(db, COLLECTION_NAME),
            where("companyId", "==", companyId),
            where("type", "==", "payable"),
            where("status", "in", ["draft", "pending_approval", "approved"]) // Open statuses
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs
            .map((doc) => convertDates({ id: doc.id, ...doc.data() }))
            .filter(t => {
                // Filter by Date
                if (!t.dueDate) return false;
                return t.dueDate >= startDate && t.dueDate <= endDate;
            })
            .filter(t => {
                // Filter by User relevance: createdBy or (if generic visibility needed, maybe skip this?)
                // The requirement says "próximas contas a serem pagas ... podendo ver detalhes".
                // Usually "my dashboard" implies things I need to act on or I created.
                // Admin sees all. User sees createdBy? 
                // Plan said: "created by or relevant to the user".
                // For simplicity/MVP: show ALL upcoming payables if Admin/Manager, or createdBy if User?
                // Actually, the request said "Should be accessible ... for any user".
                // If I click my profile, I expect to see actions *I* need to take or *my* requests.
                // Let's prioritize: Transactions I created.
                return t.createdBy === userId;
            });

        // Sort: Payment Date (closest first) -> Amount (highest first)
        transactions.sort((a, b) => {
            const dateA = a.paymentDate || a.dueDate;
            const dateB = b.paymentDate || b.dueDate;

            const diffTime = dateA.getTime() - dateB.getTime();
            if (diffTime !== 0) return diffTime;

            return b.amount - a.amount; // Descending amount
        });

        return transactions;
    }
};
