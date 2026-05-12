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
  DocumentData,
  startAfter,
  limit,
  QueryDocumentSnapshot,
  writeBatch,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Comprovante, ComprovanteMatchStatus } from "@/lib/types";

const COLLECTION = "comprovantes";

const convertDates = (data: DocumentData): Comprovante => ({
  ...(data as Comprovante),
  uploadedAt: (data.uploadedAt as Timestamp)?.toDate?.() ?? new Date(),
  reviewedAt: (data.reviewedAt as Timestamp)?.toDate?.(),
  matchedDate: (data.matchedDate as Timestamp)?.toDate?.(),
  createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
  updatedAt: (data.updatedAt as Timestamp)?.toDate?.() ?? new Date(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj !== null && typeof obj === "object") {
    if (obj instanceof Date || obj instanceof Timestamp) return obj;
    return Object.entries(obj).reduce(
      (acc, [k, v]) => {
        if (v !== undefined) acc[k] = stripUndefined(v);
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }
  return obj;
};

export type ComprovanteFilter = {
  matchStatus?: ComprovanteMatchStatus | "all";
  startDate?: Date;
  endDate?: Date;
  uploadBatchId?: string;
};

export const comprovanteService = {
  // ── Create ───────────────────────────────────────────────────────────────────

  async create(
    data: Omit<Comprovante, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const docRef = await addDoc(
      collection(db, COLLECTION),
      stripUndefined({
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    return docRef.id;
  },

  // ── Read (paginated) ─────────────────────────────────────────────────────────

  async getPaginated(
    companyId: string,
    pageSize: number,
    lastDoc?: QueryDocumentSnapshot | null,
    filters?: ComprovanteFilter,
  ): Promise<{
    items: Comprovante[];
    lastDoc: QueryDocumentSnapshot | null;
    hasMore: boolean;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constraints: any[] = [where("companyId", "==", companyId)];

    if (filters?.matchStatus && filters.matchStatus !== "all") {
      constraints.push(where("matchStatus", "==", filters.matchStatus));
    }
    if (filters?.uploadBatchId) {
      constraints.push(where("uploadBatchId", "==", filters.uploadBatchId));
    }
    if (filters?.startDate) {
      constraints.push(
        where("createdAt", ">=", Timestamp.fromDate(filters.startDate)),
      );
    }
    if (filters?.endDate) {
      constraints.push(
        where("createdAt", "<=", Timestamp.fromDate(filters.endDate)),
      );
    }

    constraints.push(orderBy("createdAt", "desc"));
    if (lastDoc != null) constraints.push(startAfter(lastDoc));
    constraints.push(limit(pageSize));

    const snap = await getDocs(
      query(collection(db, COLLECTION), ...constraints),
    );
    return {
      items: snap.docs.map((d) => convertDates({ id: d.id, ...d.data() })),
      lastDoc: snap.docs[snap.docs.length - 1] ?? null,
      hasMore: snap.docs.length === pageSize,
    };
  },

  // ── Pending review list ──────────────────────────────────────────────────────

  async getPendingReview(companyId: string): Promise<Comprovante[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("companyId", "==", companyId),
        where("matchStatus", "==", "pending_review"),
        orderBy("createdAt", "desc"),
      ),
    );
    return snap.docs.map((d) => convertDates({ id: d.id, ...d.data() }));
  },

  // ── By transaction ───────────────────────────────────────────────────────────

  async getByTransactionId(transactionId: string): Promise<Comprovante | null> {
    // Check primary transactionId first (single or legacy matches)
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("transactionId", "==", transactionId),
        limit(1),
      ),
    );
    if (!snap.empty) {
      const d = snap.docs[0];
      return convertDates({ id: d.id, ...d.data() });
    }

    // Also check the transactionIds array (consolidated matches)
    const snap2 = await getDocs(
      query(
        collection(db, COLLECTION),
        where("transactionIds", "array-contains", transactionId),
        limit(1),
      ),
    );
    if (snap2.empty) return null;
    const d = snap2.docs[0];
    return convertDates({ id: d.id, ...d.data() });
  },

  // ── Stats ────────────────────────────────────────────────────────────────────

  async getStats(companyId: string) {
    const base = query(
      collection(db, COLLECTION),
      where("companyId", "==", companyId),
    );

    const [total, matched, pendingReview, unmatched, rejected] =
      await Promise.all([
        getCountFromServer(base),
        getCountFromServer(query(base, where("matchStatus", "==", "matched"))),
        getCountFromServer(
          query(base, where("matchStatus", "==", "pending_review")),
        ),
        getCountFromServer(
          query(base, where("matchStatus", "==", "unmatched")),
        ),
        getCountFromServer(
          query(base, where("matchStatus", "==", "rejected_match")),
        ),
      ]);

    return {
      total: total.data().count,
      matched: matched.data().count,
      pendingReview: pendingReview.data().count,
      unmatched: unmatched.data().count,
      rejectedMatch: rejected.data().count,
    };
  },

  // ── Match actions ────────────────────────────────────────────────────────────

  async confirmMatch(
    comprovanteId: string,
    transactionIds: string[],
    storageUrl: string,
    reviewedBy: string,
  ): Promise<void> {
    const batch = writeBatch(db);
    const primaryId = transactionIds[0];

    batch.update(doc(db, COLLECTION, comprovanteId), {
      matchStatus: "matched",
      transactionId: primaryId,
      transactionIds,
      isConsolidated: transactionIds.length > 1,
      reviewedBy,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const txId of transactionIds) {
      batch.update(doc(db, "transactions", txId), {
        comprovanteId,
        comprovanteUrl: storageUrl,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  },

  async rejectMatch(comprovanteId: string, reviewedBy: string): Promise<void> {
    await updateDoc(doc(db, COLLECTION, comprovanteId), {
      matchStatus: "rejected_match",
      transactionId: null,
      transactionIds: null,
      reviewedBy,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  async removeMatch(
    comprovanteId: string,
    transactionIds: string[],
  ): Promise<void> {
    const batch = writeBatch(db);

    batch.update(doc(db, COLLECTION, comprovanteId), {
      matchStatus: "unmatched",
      transactionId: null,
      transactionIds: null,
      isConsolidated: false,
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: serverTimestamp(),
    });

    for (const txId of transactionIds) {
      batch.update(doc(db, "transactions", txId), {
        comprovanteId: null,
        comprovanteUrl: null,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  },

  async update(
    id: string,
    data: Partial<
      Pick<
        Comprovante,
        | "matchStatus"
        | "transactionId"
        | "transactionIds"
        | "notes"
        | "reviewedBy"
        | "reviewedAt"
      >
    >,
  ): Promise<void> {
    await updateDoc(
      doc(db, COLLECTION, id),
      stripUndefined({ ...data, updatedAt: serverTimestamp() }),
    );
  },

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTION, id));
  },

  // ── Deduplication ────────────────────────────────────────────────────────────

  async findByHash(
    companyId: string,
    fileHash: string,
  ): Promise<Comprovante | null> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("companyId", "==", companyId),
        where("fileHash", "==", fileHash),
        limit(1),
      ),
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return convertDates({ id: d.id, ...d.data() });
  },
};
