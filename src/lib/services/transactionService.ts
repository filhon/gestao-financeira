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
  getCountFromServer,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import currency from "currency.js";
import { Transaction, TransactionStatus } from "@/lib/types";
import { TransactionFormData } from "@/lib/validations/transaction";
import { format, addMonths, addDays, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { costCenterService } from "@/lib/services/costCenterService";
import { auditService } from "@/lib/services/auditService";
import { emailService } from "@/lib/services/emailService";
import { generateChanges } from "@/lib/auditFormatter";
import { paymentBatchService } from "@/lib/services/paymentBatchService";

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
  getByIds: async (ids: string[]): Promise<Transaction[]> => {
    if (!ids.length) return [];
    const snaps = await Promise.all(
      ids.map((id) => getDoc(doc(db, COLLECTION_NAME, id))),
    );
    return snaps
      .filter((s) => s.exists())
      .map((s) => convertDates({ id: s.id, ...s.data()! }));
  },

  getAll: async (filter?: {
    type?: string;
    status?: string;
    companyId?: string;
    batchId?: string | null;
    createdBy?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    costCenterId?: string;
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
    if (filter?.batchId !== undefined) {
      q = query(q, where("batchId", "==", filter.batchId));
    }
    if (filter?.costCenterId) {
      q = query(
        q,
        where("costCenterIds", "array-contains", filter.costCenterId),
      );
    }
    // Filter by createdBy - essential for 'user' role to match Firestore rules
    if (filter?.createdBy) {
      q = query(q, where("createdBy", "==", filter.createdBy));
    }
    if (filter?.startDate) {
      q = query(
        q,
        where("dueDate", ">=", Timestamp.fromDate(filter.startDate)),
      );
    }
    if (filter?.endDate) {
      q = query(q, where("dueDate", "<=", Timestamp.fromDate(filter.endDate)));
    }

    if (filter?.limit) {
      q = query(q, limit(filter.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );
  },

  getCount: async (filter?: {
    type?: string;
    status?: string;
    companyId?: string;
    batchId?: string;
    createdBy?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number> => {
    let q = query(collection(db, COLLECTION_NAME));

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
    if (filter?.createdBy) {
      q = query(q, where("createdBy", "==", filter.createdBy));
    }
    if (filter?.startDate) {
      q = query(
        q,
        where("dueDate", ">=", Timestamp.fromDate(filter.startDate)),
      );
    }
    if (filter?.endDate) {
      q = query(q, where("dueDate", "<=", Timestamp.fromDate(filter.endDate)));
    }

    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
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
      costCenterIds?: string[];
      sortField?: string;
      sortDirection?: "asc" | "desc";
    },
  ): Promise<{
    transactions: Transaction[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
    );

    if (filters?.type) {
      q = query(q, where("type", "==", filters.type));
    }

    let hasInFilter = false;

    if (filters?.costCenterIds && filters.costCenterIds.length > 0) {
      if (filters.costCenterIds.length === 1) {
        q = query(
          q,
          where("costCenterIds", "array-contains", filters.costCenterIds[0]),
        );
      } else {
        // Split into chunks if > 10 (Firestore limit for 'array-contains-any')
        const limit = 10;
        if (filters.costCenterIds.length <= limit) {
          q = query(
            q,
            where("costCenterIds", "array-contains-any", filters.costCenterIds),
          );
          hasInFilter = true;
        } else {
          console.warn(
            `Too many cost centers selected for filter, truncating to ${limit}`,
          );
          q = query(
            q,
            where(
              "costCenterIds",
              "array-contains-any",
              filters.costCenterIds.slice(0, limit),
            ),
          );
          hasInFilter = true;
        }
      }
    }

    let clientSideStatusFilter: string[] | null = null;

    if (filters?.status) {
      q = query(q, where("status", "==", filters.status));
    } else if (filters?.excludeStatus && filters.excludeStatus.length > 0) {
      // Cannot combine 'in' (from costCenterIds) with 'not-in' (status)
      if (hasInFilter) {
        // Defer to client-side filtering
        clientSideStatusFilter = filters.excludeStatus;
      } else {
        q = query(q, where("status", "not-in", filters.excludeStatus));
      }
    }

    if (filters?.createdBy) {
      q = query(q, where("createdBy", "==", filters.createdBy));
    }

    if (filters?.startDate) {
      q = query(
        q,
        where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
      );
    }
    if (filters?.endDate) {
      q = query(q, where("dueDate", "<=", Timestamp.fromDate(filters.endDate)));
    }

    // Dynamic sort — uses sortField/sortDirection when provided, else defaults to dueDate asc
    const sortField = filters?.sortField ?? "dueDate";
    const sortDirection = filters?.sortDirection ?? "asc";
    q = query(q, orderBy(sortField, sortDirection));

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    // When client-side filtering is needed, over-fetch to ensure full pages
    const fetchSize = clientSideStatusFilter ? pageSize * 2 : pageSize;
    q = query(q, limit(fetchSize));

    const snapshot = await getDocs(q);
    let transactions = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );

    // Apply client-side filtering if needed
    if (clientSideStatusFilter) {
      transactions = transactions.filter(
        (t) => !clientSideStatusFilter!.includes(t.status),
      );
    }

    // Truncate to pageSize after client-side filtering
    const truncated = transactions.slice(0, pageSize);

    return {
      transactions: truncated,
      lastDoc:
        snapshot.docs.length > 0
          ? snapshot.docs[snapshot.docs.length - 1]
          : null,
    };
  },

  getByCostCenter: async (
    costCenterId: string,
    companyId: string,
    userId?: string,
  ): Promise<Transaction[]> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("costCenterIds", "array-contains", costCenterId),
    );

    if (userId) {
      q = query(q, where("createdBy", "==", userId));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );
  },

  create: async (
    data: TransactionFormData,
    user: { uid: string; email: string },
    companyId: string,
  ) => {
    const cleanData = stripUndefined(data) as TransactionFormData; // Clean data on create too
    const { useInstallments, installmentsCount, ...transactionData } =
      cleanData;
    const userId = user.uid;

    // Receivables start as 'approved' (already projected/accounted), payables start as 'draft'
    const status =
      cleanData.status ||
      (transactionData.type === "receivable" ? "approved" : "draft");

    if (useInstallments && installmentsCount && installmentsCount > 1) {
      const groupId = crypto.randomUUID();
      const totalAmountCurrency = currency(transactionData.amount);
      const installmentAmounts =
        totalAmountCurrency.distribute(installmentsCount);

      const promises = [];
      for (let i = 1; i <= installmentsCount; i++) {
        const installmentAmount = installmentAmounts[i - 1].value;
        const dueDate =
          i === 1
            ? transactionData.dueDate
            : addMonths(transactionData.dueDate, i - 1);
        const description = `${transactionData.description} (${i}/${installmentsCount})`;

        // Recalculate costCenterAllocation amounts for this installment
        const instAmountCurrency = currency(installmentAmount);
        let rem = instAmountCurrency;

        const installmentAllocations =
          transactionData.costCenterAllocation?.map(
            (
              alloc: {
                costCenterId: string;
                percentage: number;
                amount: number;
              },
              index: number,
              array: {
                costCenterId: string;
                percentage: number;
                amount: number;
              }[],
            ) => {
              if (index === array.length - 1) {
                return { ...alloc, amount: rem.value };
              }
              const amt = instAmountCurrency
                .multiply(alloc.percentage)
                .divide(100);
              rem = rem.subtract(amt);
              return { ...alloc, amount: amt.value };
            },
          );

        const costCenterIds =
          installmentAllocations?.map((a) => a.costCenterId) || [];
        const costCenterId = costCenterIds[0];

        const txData = {
          ...transactionData,
          description,
          amount: installmentAmount,
          costCenterAllocation: installmentAllocations,
          costCenterIds,
          costCenterId,
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

        promises.push(addDoc(collection(db, COLLECTION_NAME), txData));
      }

      const refs = await Promise.all(promises);

      // Trigger Notification if pending approval
      if (
        status === "pending_approval" &&
        transactionData.costCenterAllocation
      ) {
        for (const allocation of transactionData.costCenterAllocation) {
          const costCenter = await costCenterService.getById(
            allocation.costCenterId,
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
                amount: transactionData.amount, // Show total amount in email
                approvalToken: token,
                requestOrigin: transactionData.requestOrigin,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
              costCenter.approverEmail,
            );
          }
        }
      }

      return refs[0];
    }

    // Single Create
    const costCenterIds =
      transactionData.costCenterAllocation?.map((a) => a.costCenterId) || [];
    const costCenterId = costCenterIds[0];

    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      ...transactionData,
      costCenterIds,
      costCenterId,
      companyId,
      createdBy: userId,
      status: status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Trigger Notification if pending approval
    if (status === "pending_approval" && transactionData.costCenterAllocation) {
      for (const allocation of transactionData.costCenterAllocation) {
        const costCenter = await costCenterService.getById(
          allocation.costCenterId,
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
            costCenter.approverEmail,
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
    companyId: string,
  ) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const cleanData = stripUndefined(data) as Partial<TransactionFormData>; // Sanitize data

    // Fetch current document to generate diff
    const currentDoc = await getDoc(docRef);
    if (!currentDoc.exists()) throw new Error("Transaction not found");

    const currentData = currentDoc.data();

    const updatePayload: DocumentData = {
      ...cleanData,
      updatedAt: serverTimestamp(),
    };

    if (cleanData.costCenterAllocation) {
      const costCenterIds = cleanData.costCenterAllocation.map(
        (a) => a.costCenterId,
      );
      updatePayload.costCenterIds = costCenterIds;
      updatePayload.costCenterId = costCenterIds[0];
    }

    // If the amount changed and the transaction belongs to a batch,
    // update the batch totalAmount atomically with the diff.
    const batchId = currentData.batchId as string | undefined;
    const oldAmount = currentData.amount as number | undefined;
    const newAmount = cleanData.amount;
    if (
      batchId &&
      typeof newAmount === "number" &&
      typeof oldAmount === "number" &&
      newAmount !== oldAmount
    ) {
      const amountDiff = newAmount - oldAmount;
      const PAYMENT_BATCHES = "payment_batches";
      const batchDocRef = doc(db, PAYMENT_BATCHES, batchId);
      const batchSnap = await getDoc(batchDocRef);
      if (batchSnap.exists()) {
        const currentBatchTotal = (batchSnap.data().totalAmount as number) ?? 0;
        const firestoreBatch = writeBatch(db);
        firestoreBatch.update(docRef, updatePayload);
        firestoreBatch.update(batchDocRef, {
          totalAmount: Math.max(0, currentBatchTotal + amountDiff),
          updatedAt: serverTimestamp(),
        });
        await firestoreBatch.commit();
      } else {
        await updateDoc(docRef, updatePayload);
      }
    } else {
      await updateDoc(docRef, updatePayload);
    }

    // Generate changes for audit log
    const changes = generateChanges(
      currentData as Record<string, unknown>,
      cleanData as Record<string, unknown>,
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

  reconcile: async (
    transactionId: string,
    data: { externalId: string; reconciledBy: string },
  ) => {
    const docRef = doc(db, COLLECTION_NAME, transactionId);
    return updateDoc(docRef, {
      reconciled: true,
      reconciledAt: serverTimestamp(),
      externalId: data.externalId,
      reconciledBy: data.reconciledBy,
      updatedAt: serverTimestamp(),
    });
  },

  updateRecurrence: async (
    originalTransaction: Transaction,
    data: Partial<TransactionFormData>,
    scope: "single" | "series",
    user: { uid: string; email: string },
    companyId: string,
  ) => {
    if (scope === "single" || !originalTransaction.installments?.groupId) {
      await transactionService.update(
        originalTransaction.id,
        data,
        user,
        companyId,
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
          originalTransaction.installments.groupId,
        ),
        where("dueDate", ">=", originalTransaction.dueDate), // Filter for this and future
      );

      // Calculate shift if date changed
      let daysDiff = 0;
      if (data.dueDate && originalTransaction.dueDate) {
        daysDiff = differenceInCalendarDays(
          data.dueDate,
          originalTransaction.dueDate,
        );
      }

      const snapshot = await getDocs(q);

      let batch = writeBatch(db);
      let operationCount = 0;
      const batchPromises: Promise<void>[] = [];

      for (const docSnapshot of snapshot.docs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = data as any;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { dueDate, installments: _installments, ...safeData } = payload;
        const cleanData = stripUndefined(safeData); // Sanitize data

        const updateData: DocumentData = {
          ...cleanData,
          updatedAt: serverTimestamp(),
        };

        // Update costCenterIds when costCenterAllocation changes
        if (cleanData.costCenterAllocation) {
          const costCenterIds = cleanData.costCenterAllocation.map(
            (a: { costCenterId: string }) => a.costCenterId,
          );
          updateData.costCenterIds = costCenterIds;
          updateData.costCenterId = costCenterIds[0];
        }

        // If shifting dates, calculate for this instance
        if (daysDiff !== 0) {
          const currentDocData = docSnapshot.data();
          const currentDueDate = (currentDocData.dueDate as Timestamp).toDate();
          updateData.dueDate = addDays(currentDueDate, daysDiff);
        }

        // Handle description update for installments
        if (cleanData.description && docSnapshot.data().installments) {
          const installments = docSnapshot.data().installments;
          const baseDescription = cleanData.description.replace(
            /\s\(\d+\/\d+\)$/,
            "",
          );
          updateData.description = `${baseDescription} (${installments.current}/${installments.total})`;
        }

        batch.update(docSnapshot.ref, updateData);
        operationCount++;

        if (operationCount === 500) {
          batchPromises.push(batch.commit());
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        batchPromises.push(batch.commit());
      }

      await Promise.all(batchPromises);

      await auditService.log({
        companyId,
        userId: user.uid,
        userEmail: user.email,
        action: "update",
        entity: "transaction",
        entityId: originalTransaction.installments.groupId,
        details: stripUndefined({
          ...data,
          scope,
          count: snapshot.size,
          isRecurrenceUpdate: true,
        }),
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
    companyId: string,
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
      details: stripUndefined({ status: "paid", ...data }),
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
    companyId: string,
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
    companyId: string,
  ) => {
    const docRef = doc(db, COLLECTION_NAME, id);

    // Fetch before delete to update usage and check batch membership
    const currentDoc = await getDoc(docRef);
    if (currentDoc.exists()) {
      const currentData = currentDoc.data();
      const oldTransaction = convertDates({
        id: currentDoc.id,
        ...currentData,
      });
      // If transaction belongs to a batch, remove it atomically before deleting.
      // This keeps the batch totalAmount and transactionIds consistent.
      if (currentData.batchId) {
        try {
          await paymentBatchService.removeTransactions(currentData.batchId, [
            oldTransaction,
          ]);
        } catch (err) {
          // Log but don't block deletion — the transaction may have an orphan batchId
          console.warn(
            `Could not remove transaction ${id} from batch ${currentData.batchId}:`,
            err,
          );
        }
      }
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
    adjustedAmount?: number,
  ) => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token),
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
      details: stripUndefined({
        via: "magic_link",
        originalAmount: transaction.amount,
        adjustedAmount: adjustedAmount,
        comment: comment,
      }),
    });

    return transaction;
  },

  getByApprovalToken: async (token: string): Promise<Transaction | null> => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token),
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
      where("approvalToken", "==", token),
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
      convertDates({ id: doc.id, ...doc.data() }),
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
    days: number = 7,
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
      where("status", "in", ["draft", "pending_approval", "approved"]),
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
            approverCcIds.has(alloc.costCenterId),
          );
          if (needsMyApproval) return true;
        }

        // 3. I need to release (pay) it
        if (t.status === "approved" && t.costCenterAllocation) {
          const needsMyRelease = t.costCenterAllocation.some((alloc) =>
            releaserCcIds.has(alloc.costCenterId),
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

  /**
   * Migração: Preenche o campo `costCenterIds` em todas as transações
   * que possuem `costCenterAllocation` mas não possuem `costCenterIds`
   * (ou o array está vazio). Isso corrige o filtro por centro de custo.
   */
  backfillCostCenterIds: async (
    companyId: string,
  ): Promise<{ updated: number; total: number }> => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
    );

    const snapshot = await getDocs(q);
    let updated = 0;

    let batch = writeBatch(db);
    let batchCount = 0;
    const MAX_BATCH = 500; // Firestore batch limit

    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data();
      const allocation = data.costCenterAllocation as
        | { costCenterId: string }[]
        | undefined;

      if (!allocation || allocation.length === 0) continue;

      const expectedIds = allocation.map((a) => a.costCenterId);
      const currentIds = (data.costCenterIds as string[] | undefined) ?? [];

      // Check if costCenterIds is missing or doesn't match the allocation
      const isMissing =
        currentIds.length === 0 ||
        expectedIds.length !== currentIds.length ||
        expectedIds.some((id) => !currentIds.includes(id));

      if (isMissing) {
        batch.update(docSnapshot.ref, {
          costCenterIds: expectedIds,
          costCenterId: expectedIds[0],
        });
        updated++;
        batchCount++;

        // Commit in chunks of 500 and create a new batch
        if (batchCount >= MAX_BATCH) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
    }

    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
    }

    return { updated, total: snapshot.size };
  },

  /**
   * Atualiza múltiplas transações atomicamente usando writeBatch do Firestore.
   *
   * Garante que todos os documentos sejam processados juntos ou falhem juntos.
   * Chunks de 500 operações respeitam o limite do Firestore por batch.
   *
   * Não realiza audit por documento individual (overhead desnecessário
   * para operações em lote); um único registro de auditoria resume a operação.
   */
  updateBatch: async (
    ids: string[],
    data: Partial<TransactionFormData>,
    user: { uid: string; email: string },
    companyId: string,
  ): Promise<void> => {
    if (ids.length === 0) return;

    const cleanData = stripUndefined(data) as Partial<TransactionFormData>;

    const updatePayload: DocumentData = {
      ...cleanData,
      updatedAt: serverTimestamp(),
    };

    if (cleanData.costCenterAllocation) {
      const costCenterIds = cleanData.costCenterAllocation.map(
        (a) => a.costCenterId,
      );
      updatePayload.costCenterIds = costCenterIds;
      updatePayload.costCenterId = costCenterIds[0];
    }

    // Firestore suporta no máximo 500 operações por writeBatch
    const CHUNK_SIZE = 500;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      for (const id of chunk) {
        const docRef = doc(db, COLLECTION_NAME, id);
        batch.update(docRef, updatePayload);
      }

      await batch.commit();
    }

    // Audit único para toda a operação em lote
    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "update",
      entity: "transaction",
      entityId: `batch:${ids.length}`,
      details: stripUndefined({ ...cleanData, count: ids.length }),
    });
  },
};
