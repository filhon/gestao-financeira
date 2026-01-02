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
  DocumentData,
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
    approvalTokenExpiresAt: (
      data.approvalTokenExpiresAt as Timestamp
    )?.toDate(),
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
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );
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

    const newIds = transactions.map((t) => t.id);
    const additionalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

    // Update Batch
    batch.update(batchRef, {
      transactionIds: [...batchData.transactionIds, ...newIds],
      totalAmount: batchData.totalAmount + additionalAmount,
      updatedAt: serverTimestamp(),
    });

    // Update Transactions
    transactions.forEach((t) => {
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

    const idsToRemove = new Set(transactions.map((t) => t.id));
    const newIds = batchData.transactionIds.filter(
      (id) => !idsToRemove.has(id)
    );
    const amountToRemove = transactions.reduce((sum, t) => sum + t.amount, 0);

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
    userId: string
  ) => {
    const batch = writeBatch(db);
    const batchRef = doc(db, COLLECTION_NAME, batchId);

    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

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
      batchData.transactionIds.forEach((tId) => {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, tId);
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
    approverEmail: string
  ): Promise<string> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    // Generate token with 48h expiration
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "pending_approval",
      approverId,
      approverEmail,
      approvalToken: token,
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
    transactionUpdates?: Array<{ id: string; adjustedAmount?: number }>
  ) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

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
      // Approve all transactions in batch
      for (const tId of batchData.transactionIds) {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, tId);
        batch.update(tRef, {
          status: "approved",
          approvedBy: userId,
          approvedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  },

  /**
   * Reject a single transaction from batch - marks it rejected and returns to open status
   */
  rejectTransaction: async (
    batchId: string,
    transactionId: string,
    reason: string
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
      (id) => id !== transactionId
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
    authorizerEmail: string
  ): Promise<string> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");

    // Generate token with 48h expiration
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "pending_authorization",
      authorizerId,
      authorizerEmail,
      approvalToken: token,
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
    const batchData = batchSnap.data() as PaymentBatch;

    const batch = writeBatch(db);
    batch.update(batchRef, {
      status: "paid",
      paidBy: userId,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Mark all transactions as paid
    for (const tId of batchData.transactionIds) {
      const tRef = doc(db, TRANSACTIONS_COLLECTION, tId);
      batch.update(tRef, {
        status: "paid",
        releasedBy: userId,
        releasedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  },

  /**
   * Update transaction amount within batch
   */
  updateTransactionAmount: async (
    batchId: string,
    transactionId: string,
    newAmount: number
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
    const q = query(
      collection(db, COLLECTION_NAME),
      where("approvalToken", "==", token)
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
        "Link expirado. Solicite um novo link ao gestor financeiro."
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
    transactionUpdates?: Array<{ id: string; adjustedAmount?: number }>
  ): Promise<void> => {
    const paymentBatch = await paymentBatchService.getByApprovalToken(token);
    if (!paymentBatch) {
      throw new Error("Link inválido ou expirado.");
    }

    if (paymentBatch.status !== "pending_approval") {
      throw new Error(
        `Este lote não está aguardando aprovação (status: ${paymentBatch.status}).`
      );
    }

    const batchRef = doc(db, COLLECTION_NAME, paymentBatch.id);
    const batch = writeBatch(db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchUpdate: any = {
      status: "approved",
      approvedBy: "magic-link",
      approvedAt: serverTimestamp(),
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
      // Approve all transactions
      for (const tId of paymentBatch.transactionIds) {
        const tRef = doc(db, TRANSACTIONS_COLLECTION, tId);
        batch.update(tRef, {
          status: "approved",
          approvedBy: "magic-link",
          approvedAt: serverTimestamp(),
        });
      }
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
        `Este lote não está aguardando autorização (status: ${paymentBatch.status}).`
      );
    }

    const batchRef = doc(db, COLLECTION_NAME, paymentBatch.id);
    const batch = writeBatch(db);

    batch.update(batchRef, {
      status: "authorized",
      authorizedBy: "magic-link",
      authorizedAt: serverTimestamp(),
      approvalToken: null,
      approvalTokenExpiresAt: null,
      updatedAt: serverTimestamp(),
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
