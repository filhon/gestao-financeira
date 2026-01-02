import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp,
  Timestamp,
  DocumentData,
  startAfter,
  limit,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Transaction, TransactionStatus } from "@/lib/types";
import { TransactionFormData } from "@/lib/validations/transaction";
import { format, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { costCenterService } from "@/lib/services/costCenterService";
import { auditService } from "@/lib/services/auditService";
import { emailService } from "@/lib/services/emailService";
import { generateChanges } from "@/lib/auditFormatter";
import { usageService } from "@/lib/services/usageService";

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
    approvalTokenExpiresAt: data.approvalTokenExpiresAt
      ? data.approvalTokenExpiresAt instanceof Date
        ? data.approvalTokenExpiresAt
        : (data.approvalTokenExpiresAt as Timestamp)?.toDate()
      : undefined,
  } as Transaction;
};

// Helper to remove undefined values for Firestore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map((v) => stripUndefined(v));
  } else if (obj !== null && typeof obj === "object") {
    // Handle Date objects correctly - return as is
    if (obj instanceof Date || obj instanceof Timestamp) return obj;

    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = stripUndefined(value);
      }
      return acc;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, {} as any);
  }
  return obj;
};

export const transactionService = {
  getAll: async (filter?: {
    type?: string;
    status?: string;
    companyId?: string;
    batchId?: string;
    createdBy?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Transaction[]> => {
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
    // Filter by createdBy - essential for 'user' role to match Firestore rules
    if (filter?.createdBy) {
      q = query(q, where("createdBy", "==", filter.createdBy));
    }
    if (filter?.startDate) {
      q = query(
        q,
        where("dueDate", ">=", Timestamp.fromDate(filter.startDate))
      );
    }
    if (filter?.endDate) {
      q = query(q, where("dueDate", "<=", Timestamp.fromDate(filter.endDate)));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
    filters?: {
      type?: string;
      status?: string;
      excludeStatus?: string[];
      startDate?: Date;
      endDate?: Date;
      createdBy?: string;
    }
  ): Promise<{
    transactions: Transaction[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId)
    );

    if (filters?.type) {
      q = query(q, where("type", "==", filters.type));
    }

    if (filters?.status) {
      q = query(q, where("status", "==", filters.status));
    } else if (filters?.excludeStatus && filters.excludeStatus.length > 0) {
      q = query(q, where("status", "not-in", filters.excludeStatus));
    }

    if (filters?.createdBy) {
      q = query(q, where("createdBy", "==", filters.createdBy));
    }

    if (filters?.startDate) {
      q = query(
        q,
        where("dueDate", ">=", Timestamp.fromDate(filters.startDate))
      );
    }
    if (filters?.endDate) {
      q = query(q, where("dueDate", "<=", Timestamp.fromDate(filters.endDate)));
    }

    // Default sort by dueDate
    q = query(q, orderBy("dueDate", "asc"));

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );

    return {
      transactions,
      lastDoc:
        snapshot.docs.length > 0
          ? snapshot.docs[snapshot.docs.length - 1]
          : null,
    };
  },

  getByCostCenter: async (
    costCenterId: string,
    companyId: string,
    userId?: string
  ): Promise<Transaction[]> => {
    // Since we can't easily query array of objects in Firestore without a specific index structure,
    // we'll fetch company transactions and filter.
    // Optimization: In a real app, we should maintain a 'relatedCostCenterIds' array field on the transaction.
    // For 'user' role, filter by createdBy to match Firestore rules
    const filter: { companyId: string; createdBy?: string } = { companyId };
    if (userId) {
      filter.createdBy = userId;
    }
    const all = await transactionService.getAll(filter);
    return all.filter((t) =>
      t.costCenterAllocation?.some((a) => a.costCenterId === costCenterId)
    );
  },

  create: async (
    data: TransactionFormData,
    user: { uid: string; email: string },
    companyId: string
  ) => {
    const cleanData = stripUndefined(data); // Clean data on create too
    const { useInstallments, installmentsCount, ...transactionData } =
      cleanData;
    const userId = user.uid;

    // Receivables start as 'approved' (already projected/accounted), payables start as 'draft'
    const status =
      cleanData.status ||
      (transactionData.type === "receivable" ? "approved" : "draft");

    if (useInstallments && installmentsCount && installmentsCount > 1) {
      const groupId = crypto.randomUUID();
      const totalAmount = transactionData.amount;
      const baseAmount =
        Math.floor((totalAmount / installmentsCount) * 100) / 100;
      const remainder =
        Math.round((totalAmount - baseAmount * installmentsCount) * 100) / 100;

      const promises = [];
      for (let i = 1; i <= installmentsCount; i++) {
        const installmentAmount =
          i === installmentsCount ? baseAmount + remainder : baseAmount;
        const dueDate =
          i === 1
            ? transactionData.dueDate
            : addMonths(transactionData.dueDate, i - 1);
        const description = `${transactionData.description} (${i}/${installmentsCount})`;

        // Recalculate costCenterAllocation amounts for this installment
        const installmentAllocations =
          transactionData.costCenterAllocation?.map(
            (alloc: {
              costCenterId: string;
              percentage: number;
              amount: number;
            }) => ({
              ...alloc,
              amount: (installmentAmount * alloc.percentage) / 100,
            })
          );

        const txData = {
          ...transactionData,
          description,
          amount: installmentAmount,
          costCenterAllocation: installmentAllocations,
          dueDate,
          installments: {
            current: i,
            total: installmentsCount,
            groupId,
          },
          companyId,
          createdBy: userId,
          status: status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        promises.push(
          addDoc(collection(db, COLLECTION_NAME), txData).then(async (ref) => {
            await usageService.updateUsage(
              { ...txData, id: ref.id } as unknown as Transaction,
              1
            );
            return ref;
          })
        );
      }

      const refs = await Promise.all(promises);

      // Trigger Notification if pending approval
      if (
        status === "pending_approval" &&
        transactionData.costCenterAllocation
      ) {
        for (const allocation of transactionData.costCenterAllocation) {
          const costCenter = await costCenterService.getById(
            allocation.costCenterId
          );
          if (costCenter?.approverEmail) {
            // Generate token for the first installment to allow approval start
            // Ideally we would have a "Group Approval" but for now let's link the first one.
            const token = crypto.randomUUID();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            // Update the first installment with the token
            await updateDoc(refs[0], {
              approvalToken: token,
              approvalTokenExpiresAt: Timestamp.fromDate(expiresAt),
            });

            // Send Email
            await emailService.sendApprovalRequest(
              {
                id: refs[0].id,
                ...transactionData,
                amount: totalAmount, // Show total amount in email
                approvalToken: token,
                requestOrigin: transactionData.requestOrigin,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
              costCenter.approverEmail
            );
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

    // Update Cost Center Usage
    await usageService.updateUsage(
      {
        ...transactionData,
        id: docRef.id,
        companyId,
        createdBy: userId,
        status: status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      1
    );

    // Trigger Notification if pending approval
    if (status === "pending_approval" && transactionData.costCenterAllocation) {
      for (const allocation of transactionData.costCenterAllocation) {
        const costCenter = await costCenterService.getById(
          allocation.costCenterId
        );
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
            approvalTokenExpiresAt: Timestamp.fromDate(expiresAt),
          });

          await emailService.sendApprovalRequest(
            {
              id: docRef.id,
              ...transactionData,
              amount: transactionData.amount,
              approvalToken: token,
              requestOrigin: transactionData.requestOrigin, // Ensure this is passed
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            costCenter.approverEmail
          );
        }
      }
    }

    // Log Audit
    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "create",
      entity: "transaction",
      entityId: docRef.id,
      details: {
        amount: transactionData.amount,
        description: transactionData.description,
      },
    });

    return docRef;
  },

  update: async (
    id: string,
    data: Partial<TransactionFormData>,
    user: { uid: string; email: string },
    companyId: string
  ) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const cleanData = stripUndefined(data); // Sanitize data

    // Fetch current document to generate diff
    const currentDoc = await getDoc(docRef);
    if (!currentDoc.exists()) throw new Error("Transaction not found");

    const currentData = currentDoc.data();
    const oldTransaction = convertDates({ id: currentDoc.id, ...currentData });

    await updateDoc(docRef, {
      ...cleanData,
      updatedAt: serverTimestamp(),
    });

    // Update Usage
    await usageService.updateUsage(oldTransaction, -1);

    const newTransaction = {
      ...oldTransaction,
      ...cleanData,
    } as Transaction;
    await usageService.updateUsage(newTransaction, 1);

    // Generate changes for audit log
    const changes = generateChanges(
      currentData as Record<string, unknown>,
      cleanData as Record<string, unknown>
    );

    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "update",
      entity: "transaction",
      entityId: id,
      details: { changes },
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
      await transactionService.update(
        originalTransaction.id,
        data,
        user,
        companyId
      );
      return;
    }

    // Scope: Series (This and Future)
    if (scope === "series") {
      const q = query(
        collection(db, COLLECTION_NAME),
        where(
          "installments.groupId",
          "==",
          originalTransaction.installments.groupId
        ),
        where("dueDate", ">=", originalTransaction.dueDate) // Filter for this and future
      );

      const snapshot = await getDocs(q);
      const promises = snapshot.docs.map(async (docSnapshot) => {
        // Avoid updating 'dueDate' relative to each other if it's not a generic update
        // For simplified 'Edit', we might replace description, amount, category, etc.
        // We typically DO NOT update 'dueDate' in batch because each installment has its own month.
        // If user changed Date in Form, it's ambiguous if they mean "Shift all by X days" or "Set all to Date Y".
        // For MVP, let's exclude 'dueDate' from batch updates or handle explicitly.
        // Let's exclude 'dueDate' and 'installments' data from batch to be safe, unless needed.

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = data as any;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { dueDate, installments: _installments, ...safeData } = payload;
        const cleanData = stripUndefined(safeData); // Sanitize data

        const updateData = {
          ...cleanData,
          updatedAt: serverTimestamp(),
        };

        return updateDoc(docSnapshot.ref, updateData);
      });

      await Promise.all(promises);

      await auditService.log({
        companyId,
        userId: user.uid,
        userEmail: user.email,
        action: "update",
        entity: "transaction",
        entityId: originalTransaction.installments.groupId,
        details: {
          ...data,
          scope,
          count: snapshot.size,
          isRecurrenceUpdate: true,
        },
      });
    }
  },

  settle: async (
    id: string,
    data: {
      paymentDate: Date;
      finalAmount: number;
      discount: number;
      interest: number;
    },
    user: { uid: string; email: string },
    companyId: string
  ) => {
    const docRef = doc(db, COLLECTION_NAME, id);

    // Audit Log
    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "update",
      entity: "transaction",
      entityId: id,
      details: { status: "paid", ...data },
    });

    return updateDoc(docRef, {
      status: "paid",
      paymentDate: Timestamp.fromDate(data.paymentDate),
      finalAmount: data.finalAmount,
      discount: data.discount,
      interest: data.interest,
      releasedBy: user.uid,
      releasedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  updateStatus: async (
    id: string,
    status: TransactionStatus,
    user: { uid: string; email: string },
    companyId: string
  ): Promise<Transaction> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { status, updatedAt: serverTimestamp() };
    const userId = user.uid;

    if (status === "approved") {
      updateData.approvedBy = userId;
      updateData.approvedAt = serverTimestamp();
    } else if (status === "paid") {
      updateData.releasedBy = userId;
      updateData.releasedAt = serverTimestamp();
    } else if (status === "pending_approval") {
      // Generate Magic Link Token
      updateData.approvalToken = crypto.randomUUID();
      // Set expiration for 7 days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      updateData.approvalTokenExpiresAt = Timestamp.fromDate(expiresAt);
    }

    await updateDoc(docRef, updateData);

    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action:
        status === "approved"
          ? "approve"
          : status === "rejected"
            ? "reject"
            : "update",
      entity: "transaction",
      entityId: id,
      details: { status },
    });

    // Fetch and return updated transaction
    const updatedDoc = await getDoc(docRef);
    if (!updatedDoc.exists()) {
      throw new Error("Transaction not found after update");
    }
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Transaction;
  },

  delete: async (
    id: string,
    user: { uid: string; email: string },
    companyId: string
  ) => {
    const docRef = doc(db, COLLECTION_NAME, id);

    // Fetch before delete to update usage
    const currentDoc = await getDoc(docRef);
    if (currentDoc.exists()) {
      const currentData = currentDoc.data();
      const oldTransaction = convertDates({
        id: currentDoc.id,
        ...currentData,
      });
      await usageService.updateUsage(oldTransaction, -1);
    }

    await deleteDoc(docRef);

    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "delete",
      entity: "transaction",
      entityId: id,
      details: {},
    });
  },

  approveByToken: async (
    token: string,
    userId: string,
    comment?: string,
    adjustedAmount?: number
  ) => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      throw new Error("Token inválido ou não encontrado.");
    }

    const docSnapshot = snapshot.docs[0];
    const transaction = convertDates({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    });

    if (
      transaction.approvalTokenExpiresAt &&
      transaction.approvalTokenExpiresAt < new Date()
    ) {
      throw new Error("Este link de aprovação expirou.");
    }

    if (transaction.status !== "pending_approval") {
      throw new Error("Esta transação já foi processada.");
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {
      status: "approved",
      approvedBy: userId,
      approvedAt: serverTimestamp(),
      approvalToken: null, // Consume token
      approvalTokenExpiresAt: null,
    };

    // Add comment if provided
    if (comment) {
      updateData.approvalComment = comment;
    }

    // Add adjusted amount if provided
    if (adjustedAmount !== undefined && adjustedAmount !== transaction.amount) {
      updateData.amount = adjustedAmount;
      updateData.originalAmount = transaction.amount;
    }

    // Approve
    const docRef = doc(db, COLLECTION_NAME, transaction.id);
    await updateDoc(docRef, updateData);

    // Log audit
    await auditService.log({
      companyId: transaction.companyId,
      userId: userId,
      userEmail: "magic-link-approval@system",
      action: "approve",
      entity: "transaction",
      entityId: transaction.id,
      details: {
        via: "magic_link",
        originalAmount: transaction.amount,
        adjustedAmount: adjustedAmount,
        comment: comment,
      },
    });

    return transaction;
  },

  getByApprovalToken: async (token: string): Promise<Transaction | null> => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    const docSnapshot = snapshot.docs[0];
    return convertDates({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    });
  },

  rejectByToken: async (token: string, userId: string, reason: string) => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      throw new Error("Token inválido ou não encontrado.");
    }

    const docSnapshot = snapshot.docs[0];
    const transaction = convertDates({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    });

    if (
      transaction.approvalTokenExpiresAt &&
      transaction.approvalTokenExpiresAt < new Date()
    ) {
      throw new Error("Este link de aprovação expirou.");
    }

    if (transaction.status !== "pending_approval") {
      throw new Error("Esta transação já foi processada.");
    }

    // Reject
    const docRef = doc(db, COLLECTION_NAME, transaction.id);
    await updateDoc(docRef, {
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason,
      approvalToken: null, // Consume token
      approvalTokenExpiresAt: null,
    });

    // Log audit
    await auditService.log({
      companyId: transaction.companyId,
      userId: userId,
      userEmail: "magic-link-approval@system",
      action: "reject",
      entity: "transaction",
      entityId: transaction.id,
      details: {
        via: "magic_link",
        reason: reason,
      },
    });

    return transaction;
  },

  getDashboardStats: async (companyId?: string) => {
    let q = query(collection(db, COLLECTION_NAME), orderBy("dueDate", "asc"));

    if (companyId) {
      q = query(q, where("companyId", "==", companyId));
    }

    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalBalance = 0;
    let monthlyIncome = 0;
    let monthlyExpense = 0;

    // Group by month for chart
    const monthlyData = new Map<
      string,
      { name: string; income: number; expense: number }
    >();

    transactions.forEach((t) => {
      // Determine date and amount to use
      let dateToUse = t.dueDate;
      let amountToUse = t.amount;

      if (t.status === "paid") {
        if (t.paymentDate) {
          dateToUse = t.paymentDate;
        }
        if (t.finalAmount !== undefined) {
          amountToUse = t.finalAmount;
        }
      }

      // Calculate totals based on status 'paid'/'received' (mapped to 'paid' in types)
      // For balance, we consider paid transactions
      if (t.status === "paid") {
        if (t.type === "receivable") {
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
          name: format(tDate, "MMM", { locale: ptBR }),
          income: 0,
          expense: 0,
        });
      }

      const monthStats = monthlyData.get(monthKey)!;

      if (t.type === "receivable") {
        monthStats.income += amountToUse;
      } else {
        monthStats.expense += amountToUse;
      }

      // Current Month Stats (for cards)
      if (tMonth === currentMonth && tYear === currentYear) {
        if (t.type === "receivable") {
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
      recentTransactions: transactions.reverse().slice(0, 5),
    };
  },

  getUpcomingByUser: async (
    userId: string,
    userEmail: string | null | undefined,
    companyId: string,
    days: number = 7
  ): Promise<Transaction[]> => {
    // Calculate date range
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    endDate.setHours(23, 59, 59, 999);

    // Fetch Cost Centers to know responsibilities
    const costCenters = await costCenterService.getAll(companyId);

    // Map Cost Center IDs to responsibilities
    const approverCcIds = new Set<string>();
    const releaserCcIds = new Set<string>();

    if (userEmail) {
      costCenters.forEach((cc) => {
        if (cc.approverEmail === userEmail) approverCcIds.add(cc.id);
        if (cc.releaserEmail === userEmail) releaserCcIds.add(cc.id);
      });
    }

    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
      where("status", "in", ["draft", "pending_approval", "approved"])
    );

    const snapshot = await getDocs(q);
    const transactions = snapshot.docs
      .map((doc) => convertDates({ id: doc.id, ...doc.data() }))
      .filter((t) => {
        // Filter by Date
        if (!t.dueDate) return false;
        if (t.dueDate < startDate || t.dueDate > endDate) return false;

        // 1. I created it
        if (t.createdBy === userId) return true;

        // 2. I need to approve it
        if (t.status === "pending_approval" && t.costCenterAllocation) {
          const needsMyApproval = t.costCenterAllocation.some((alloc) =>
            approverCcIds.has(alloc.costCenterId)
          );
          if (needsMyApproval) return true;
        }

        // 3. I need to release (pay) it
        if (t.status === "approved" && t.costCenterAllocation) {
          const needsMyRelease = t.costCenterAllocation.some((alloc) =>
            releaserCcIds.has(alloc.costCenterId)
          );
          if (needsMyRelease) return true;
        }

        return false;
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
  },
};
