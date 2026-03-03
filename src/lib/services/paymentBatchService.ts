import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
  orderBy,
  addDoc,
  Timestamp,
  DocumentData,
  deleteField,
  startAfter,
  limit,
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
    sentForApprovalAt: (data.sentForApprovalAt as Timestamp)?.toDate(),
    sentForAuthorizationAt: (
      data.sentForAuthorizationAt as Timestamp
    )?.toDate(),
    authorizedAt: (data.authorizedAt as Timestamp)?.toDate(),
    paidAt: (data.paidAt as Timestamp)?.toDate(),
    revertedAt: (data.revertedAt as Timestamp)?.toDate(),
    approvalTokenExpiresAt: (
      data.approvalTokenExpiresAt as Timestamp
    )?.toDate(),
    startDate: (data.startDate as Timestamp)?.toDate(),
    endDate: (data.endDate as Timestamp)?.toDate(),
  } as PaymentBatch;
};

const hashToken = async (token: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const paymentBatchService = {
  checkAndFinalizeBatch: async (batchId: string, userId: string) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) return;

    const batchData = batchSnap.data() as PaymentBatch;
    if (batchData.status === "paid") return; // Already paid

    // Check all transactions
    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    );
    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Transaction,
    );

    const allPaid = transactions.every((t) => t.status === "paid");

    if (allPaid && transactions.length > 0) {
      // Auto-close batch
      const batch = writeBatch(db);
      batch.update(batchRef, {
        status: "paid",
        paidBy: userId,
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
  },

  getAll: async (
    companyId: string,
    pageSize: number = 20,
    lastDoc: DocumentData | null = null,
    filterStatus?: string,
  ): Promise<{ batches: PaymentBatch[]; lastDoc: DocumentData | null }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc"),
    );

    if (filterStatus && filterStatus !== "all") {
      q = query(q, where("status", "==", filterStatus));
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const batches = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );

    return {
      batches,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  },

  getById: async (id: string): Promise<PaymentBatch | null> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    return convertDates({ id: snapshot.id, ...snapshot.data() });
  },

  create: async (
    name: string,
    companyId: string,
    createdBy: string,
    startDate?: Date,
    endDate?: Date,
  ) => {
    // Create the batch
    const batchRef = await addDoc(collection(db, COLLECTION_NAME), {
      name,
      companyId,
      createdBy,
      status: "open",
      transactionIds: [],
      totalAmount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      startDate: startDate || null,
      endDate: endDate || null,
    });

    // If dates are provided, auto-add draft transactions
    if (startDate && endDate) {
      try {
        const q = query(
          collection(db, TRANSACTIONS_COLLECTION),
          where("companyId", "==", companyId),
          where("type", "==", "payable"),
          where("status", "==", "draft"),
          where("dueDate", ">=", startDate),
          where("dueDate", "<=", endDate),
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction)
          .filter((t) => !t.batchId); // Only add if not already in a batch

        if (transactions.length > 0) {
          await paymentBatchService.addTransactions(batchRef.id, transactions);
        }
      } catch (error) {
        console.error("Error auto-adding transactions to batch:", error);
        // We don't fail the batch creation if auto-add fails,
        // but maybe we should notify/throw?
        // For now logging is safer to avoid breaking the main flow.
      }
    }

    return batchRef;
  },

  update: async (id: string, data: Partial<PaymentBatch>) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
      ...data,
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

    // Filter out transactions that are already in the batch
    const existingIds = new Set(batchData.transactionIds);
    const uniqueTransactions = transactions.filter(
      (t) => !existingIds.has(t.id),
    );

    if (uniqueTransactions.length === 0) {
      return; // All transactions are already in the batch
    }

    const newIds = uniqueTransactions.map((t) => t.id);
    const additionalAmount = uniqueTransactions.reduce(
      (sum, t) => sum + t.amount,
      0,
    );

    // Update Batch
    batch.update(batchRef, {
      transactionIds: [...batchData.transactionIds, ...newIds],
      totalAmount: batchData.totalAmount + additionalAmount,
      updatedAt: serverTimestamp(),
    });

    // Update Transactions
    uniqueTransactions.forEach((t) => {
      const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
      batch.update(tRef, { batchId: batchId });
    });

    await batch.commit();
  },

  delete: async (batchId: string) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);

    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    if (batchData.status !== "open") {
      throw new Error("Apenas lotes com status 'Aberto' podem ser excluídos");
    }

    const batchWrite = writeBatch(db);

    // 1. Find all transactions in this batch
    // We trust the transaction collection query more than the array for mass updates
    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    );
    const transactionsSnap = await getDocs(q);

    // 2. Remove batchId from them
    transactionsSnap.docs.forEach((tDoc) => {
      batchWrite.update(tDoc.ref, { batchId: deleteField() });
    });

    // 3. Delete the batch document
    batchWrite.delete(batchRef);

    await batchWrite.commit();
  },

  removeTransactions: async (batchId: string, transactions: Transaction[]) => {
    const batch = writeBatch(db);
    const batchRef = doc(db, COLLECTION_NAME, batchId);

    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    const idsToRemove = new Set(transactions.map((t) => t.id));
    const newIds = batchData.transactionIds.filter(
      (id) => !idsToRemove.has(id),
    );
    // Use batchAdjustedAmount when present so the subtracted value matches what
    // was actually added to totalAmount (which was bumped by updateTransactionAmount).
    const amountToRemove = transactions.reduce(
      (sum, t) =>
        sum +
        ((t as Transaction & { batchAdjustedAmount?: number })
          .batchAdjustedAmount ?? t.amount),
      0,
    );

    batch.update(batchRef, {
      transactionIds: newIds,
      totalAmount: Math.max(0, batchData.totalAmount - amountToRemove),
      updatedAt: serverTimestamp(),
    });

    transactions.forEach((t) => {
      const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
      batch.update(tRef, { batchId: null }); // Or delete field
    });

    await batch.commit();
  },

  updateStatus: async (
    batchId: string,
    status: PaymentBatchStatus,
    userId: string,
  ) => {
    const batch = writeBatch(db);
    const batchRef = doc(db, COLLECTION_NAME, batchId);

    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { status, updatedAt: serverTimestamp() };
    if (status === "approved") {
      updateData.approvedBy = userId;
      updateData.approvedAt = serverTimestamp();
    }

    batch.update(batchRef, updateData);

    // Propagate status to transactions if needed
    // If batch is approved, transactions become approved?
    // If batch is paid, transactions become paid?
    let transactionStatus: string | null = null;
    if (status === "approved") transactionStatus = "approved";
    if (status === "paid") transactionStatus = "paid";
    if (status === "rejected") transactionStatus = "rejected";

    if (transactionStatus) {
      // Fetch all batch transactions first to ensure they exist
      const q = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("batchId", "==", batchId),
      );
      const snapshot = await getDocs(q);

      snapshot.docs.forEach((docSnap) => {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, docSnap.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tUpdate: any = { status: transactionStatus };
        if (status === "approved") {
          tUpdate.approvedBy = userId;
          tUpdate.approvedAt = serverTimestamp();
        }
        if (status === "paid") {
          tUpdate.releasedBy = userId;
          tUpdate.releasedAt = serverTimestamp();
        }
        batch.update(tRef, tUpdate);
      });
    }

    await batch.commit();
  },

  /**
   * Send batch for approval - assigns approver, generates token, changes status
   */
  sendForApproval: async (
    batchId: string,
    approverId: string,
    approverEmail: string,
  ): Promise<string> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    // Generate token with 48h expiration
    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "pending_approval",
      approverId,
      approverEmail,
      approvalTokenHash: tokenHash,
      approvalToken: null, // Clear plain token if it existed
      approvalTokenExpiresAt: expiresAt,
      sentForApprovalAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return token;
  },

  /**
   * Approve batch with optional comment and transaction adjustments
   */
  approveWithDetails: async (
    batchId: string,
    userId: string,
    comment?: string,
    transactionUpdates?: Array<{ id: string; adjustedAmount?: number }>,
  ) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    const batch = writeBatch(db);

    // Update batch status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchUpdate: any = {
      status: "approved",
      approvedBy: userId,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (comment) {
      batchUpdate.approverComment = comment;
    }
    batch.update(batchRef, batchUpdate);

    // Apply transaction adjustments
    if (transactionUpdates) {
      for (const update of transactionUpdates) {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, update.id);
        if (update.adjustedAmount !== undefined) {
          batch.update(tRef, {
            batchAdjustedAmount: update.adjustedAmount,
            status: "approved",
            approvedBy: userId,
            approvedAt: serverTimestamp(),
          });
        } else {
          batch.update(tRef, {
            status: "approved",
            approvedBy: userId,
            approvedAt: serverTimestamp(),
          });
        }
      }
    } else {
      // Approve all transactions — query by batchId so orphan IDs in the array are ignored
      const tQuery = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("batchId", "==", batchId),
      );
      const tSnap = await getDocs(tQuery);
      tSnap.docs.forEach((tDoc) => {
        batch.update(tDoc.ref, {
          status: "approved",
          approvedBy: userId,
          approvedAt: serverTimestamp(),
        });
      });
    }

    await batch.commit();
  },

  /**
   * Reject a single transaction from batch - marks it rejected and returns to open status
   */
  rejectTransaction: async (
    batchId: string,
    transactionId: string,
    reason: string,
  ) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    // Get transaction to know the amount to subtract
    const tRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);
    const tSnap = await getDoc(tRef);
    if (!tSnap.exists()) throw new Error("Transaction not found");
    const tData = tSnap.data() as Transaction;

    const batch = writeBatch(db);

    // Remove from transactionIds, add to rejectedTransactionIds
    const newTransactionIds = batchData.transactionIds.filter(
      (id) => id !== transactionId,
    );
    const rejectedIds = [
      ...(batchData.rejectedTransactionIds || []),
      transactionId,
    ];

    batch.update(batchRef, {
      transactionIds: newTransactionIds,
      rejectedTransactionIds: rejectedIds,
      totalAmount: Math.max(0, batchData.totalAmount - tData.amount),
      updatedAt: serverTimestamp(),
    });

    // Mark transaction with rejection reason and return to draft status
    batch.update(tRef, {
      batchId: null,
      batchRejectionReason: reason,
      status: "draft",
    });

    await batch.commit();
  },

  /**
   * Send batch for authorization - assigns releaser, generates token, changes status
   */
  sendForAuthorization: async (
    batchId: string,
    authorizerId: string,
    authorizerEmail: string,
  ): Promise<string> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    // Generate token with 48h expiration
    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "pending_authorization",
      authorizerId,
      authorizerEmail,
      approvalTokenHash: tokenHash,
      approvalToken: null,
      approvalTokenExpiresAt: expiresAt,
      sentForAuthorizationAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return token;
  },

  /**
   * Confirm authorization - releaser confirms bank processing
   */
  confirmAuthorization: async (batchId: string, userId: string) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "authorized",
      authorizedBy: userId,
      authorizedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },

  /**
   * Confirm payments - manager confirms all payments complete
   */
  confirmPayments: async (batchId: string, userId: string) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "paid",
      paidBy: userId,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Mark all existing transactions as paid — query by batchId so orphan IDs are ignored
    const tQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    );
    const tSnap = await getDocs(tQuery);
    tSnap.docs.forEach((tDoc) => {
      batch.update(tDoc.ref, {
        status: "paid",
        releasedBy: userId,
        releasedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  },

  /**
   * Update transaction amount within batch
   */
  updateTransactionAmount: async (
    batchId: string,
    transactionId: string,
    newAmount: number,
  ) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    const tRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);
    const tSnap = await getDoc(tRef);
    if (!tSnap.exists()) throw new Error("Transaction not found");
    const tData = tSnap.data() as Transaction;

    const amountDiff = newAmount - tData.amount;

    const batch = writeBatch(db);

    // Update batch total
    batch.update(batchRef, {
      totalAmount: batchData.totalAmount + amountDiff,
      updatedAt: serverTimestamp(),
    });

    // Update transaction with adjusted amount
    batch.update(tRef, {
      batchAdjustedAmount: newAmount,
    });

    await batch.commit();
  },

  // ============================================
  // Magic Link Methods
  // ============================================

  /**
   * Get batch by approval token with validation
   */
  getByApprovalToken: async (token: string): Promise<PaymentBatch | null> => {
    const tokenHash = await hashToken(token);
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalTokenHash", "==", tokenHash),
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    const batch = convertDates({
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data(),
    });

    // Check token expiration
    if (
      batch.approvalTokenExpiresAt &&
      batch.approvalTokenExpiresAt < new Date()
    ) {
      throw new Error(
        "Link expirado. Solicite um novo link ao gestor financeiro.",
      );
    }

    return batch;
  },

  /**
   * Approve batch via Magic Link token
   */
  approveByToken: async (
    token: string,
    comment?: string,
    transactionUpdates?: Array<{ id: string; adjustedAmount?: number }>,
  ): Promise<void> => {
    const paymentBatch = await paymentBatchService.getByApprovalToken(token);
    if (!paymentBatch) {
      throw new Error("Link inválido ou expirado.");
    }

    if (paymentBatch.status !== "pending_approval") {
      throw new Error(
        `Este lote não está aguardando aprovação (status: ${paymentBatch.status}).`,
      );
    }

    const batchRef = doc(db, COLLECTION_NAME, paymentBatch.id);
    const batch = writeBatch(db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchUpdate: any = {
      status: "approved",
      approvedBy: "magic-link",
      approvedAt: serverTimestamp(),
      approvalTokenHash: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
      updatedAt: serverTimestamp(),
    };
    if (comment) {
      batchUpdate.approverComment = comment;
    }
    batch.update(batchRef, batchUpdate);

    // Apply transaction adjustments if any
    if (transactionUpdates) {
      for (const update of transactionUpdates) {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, update.id);
        if (update.adjustedAmount !== undefined) {
          batch.update(tRef, {
            batchAdjustedAmount: update.adjustedAmount,
            status: "approved",
            approvedBy: "magic-link",
            approvedAt: serverTimestamp(),
          });
        } else {
          batch.update(tRef, {
            status: "approved",
            approvedBy: "magic-link",
            approvedAt: serverTimestamp(),
          });
        }
      }
    } else {
      // Approve all transactions — query by batchId so orphan IDs in the array are ignored
      const tQuery = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("batchId", "==", paymentBatch.id),
      );
      const tSnap = await getDocs(tQuery);
      tSnap.docs.forEach((tDoc) => {
        batch.update(tDoc.ref, {
          status: "approved",
          approvedBy: "magic-link",
          approvedAt: serverTimestamp(),
        });
      });
    }

    await batch.commit();
  },

  /**
   * Authorize batch via Magic Link token
   */
  authorizeByToken: async (token: string): Promise<void> => {
    const paymentBatch = await paymentBatchService.getByApprovalToken(token);
    if (!paymentBatch) {
      throw new Error("Link inválido ou expirado.");
    }

    if (paymentBatch.status !== "pending_authorization") {
      throw new Error(
        `Este lote não está aguardando autorização (status: ${paymentBatch.status}).`,
      );
    }

    const batchRef = doc(db, COLLECTION_NAME, paymentBatch.id);
    const batch = writeBatch(db);

    batch.update(batchRef, {
      status: "authorized",
      authorizedBy: "magic-link",
      authorizedAt: serverTimestamp(),
      approvalTokenHash: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },

  /**
   * Revert paid batch back to open status
   * Reverts batch status from 'paid' to 'open' and all transactions from 'paid' to 'draft'
   */
  revertToOpen: async (batchId: string, userId: string): Promise<void> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    if (batchData.status !== "paid") {
      throw new Error(
        "Apenas lotes com status 'Pago' podem ser revertidos para Aberto.",
      );
    }

    const batch = writeBatch(db);

    batch.update(batchRef, {
      status: "open",
      paidBy: deleteField(),
      paidAt: deleteField(),
      revertedBy: userId,
      revertedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Revert all transactions back to draft
    const tQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    );
    const tSnap = await getDocs(tQuery);
    tSnap.docs.forEach((tDoc) => {
      batch.update(tDoc.ref, {
        status: "draft",
        releasedBy: deleteField(),
        releasedAt: deleteField(),
      });
    });

    await batch.commit();
  },

  /**
   * Return batch to manager for adjustments
   */
  returnToManager: async (batchId: string, reason: string): Promise<void> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "open",
      approvalTokenHash: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
      approverId: null,
      approverEmail: null,
      approverComment: `Devolvido: ${reason}`,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },
};
