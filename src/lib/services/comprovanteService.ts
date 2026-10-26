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
  writeBatch,
  getCountFromServer,
} from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import { Comprovante, ComprovanteMatchStatus } from "@/lib/types";
import { auditService } from "@/lib/services/auditService";

const COLLECTION = "comprovantes";

const normalizeSearch = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const tokenize = (text: string): string[] => {
  const normalized = normalizeSearch(text);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);
  const tokens = new Set<string>(words);
  // Add all prefix substrings of length ≥ 2 for each word (prefix search)
  for (const word of words) {
    for (let i = 2; i <= word.length; i++) {
      tokens.add(word.slice(0, i));
    }
  }
  return [...tokens];
};

const buildSearchText = (fields: {
  matchedEntity?: string;
  extractedText?: string;
  transactionDescriptions?: (string | undefined)[];
  transactionEntities?: (string | undefined)[];
}): string => {
  return [
    fields.matchedEntity ?? "",
    fields.extractedText ?? "",
    ...(fields.transactionDescriptions ?? []),
    ...(fields.transactionEntities ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000); // guard against very large extractedText
};

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
  /** Vazio = todos os status. */
  statuses?: ComprovanteMatchStatus[];
  /** Data de envio (createdAt). */
  startDate?: Date;
  endDate?: Date;
  uploadBatchId?: string;
  searchText?: string;
};

// Mesmos filtros para a página e para a contagem: o total exibido é o real.
const filterConstraints = (companyId: string, filters?: ComprovanteFilter) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const constraints: any[] = [where("companyId", "==", companyId)];

  const statuses = filters?.statuses ?? [];
  if (statuses.length === 1) {
    constraints.push(where("matchStatus", "==", statuses[0]));
  } else if (statuses.length > 1) {
    constraints.push(where("matchStatus", "in", statuses));
  }
  if (filters?.uploadBatchId) {
    constraints.push(where("uploadBatchId", "==", filters.uploadBatchId));
  }
  if (filters?.searchText) {
    // Multi-word queries: pick the longest word for best precision.
    // Composite index (companyId + searchTokens + createdAt) supports
    // array-contains combined with the date range below.
    const words = normalizeSearch(filters.searchText)
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const primaryToken =
      words.sort((a, b) => b.length - a.length)[0] ??
      normalizeSearch(filters.searchText);
    constraints.push(where("searchTokens", "array-contains", primaryToken));
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
  return constraints;
};

export const comprovanteService = {
  // ── Create ───────────────────────────────────────────────────────────────────

  async create(
    data: Omit<Comprovante, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const searchText = buildSearchText({
      matchedEntity: data.matchedEntity,
      extractedText: data.extractedText,
    });
    const docRef = await addDoc(
      collection(db, COLLECTION),
      stripUndefined({
        ...data,
        searchText,
        searchTokens: tokenize(searchText),
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
    const constraints = filterConstraints(companyId, filters);
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

  async count(companyId: string, filters?: ComprovanteFilter): Promise<number> {
    const snap = await getCountFromServer(
      query(
        collection(db, COLLECTION),
        ...filterConstraints(companyId, filters),
      ),
    );
    return snap.data().count;
  },

  /**
   * Corrige a leitura (beneficiário, valor, data) e refaz a sugestão no
   * servidor. O beneficiário informado também ensina a entidade.
   */
  async calibrate(
    companyId: string,
    body: {
      comprovanteId: string;
      entityId?: string;
      amount?: number;
      date?: string; // yyyy-MM-dd
      learnOnly?: boolean;
    },
  ): Promise<{
    patch: Partial<Comprovante>;
    learned: { documents: string[]; pixKeys: string[]; names: string[] };
  }> {
    const res = await fetch("/api/internal/comprovantes/calibrate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-company-id": companyId,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? "Erro ao recalcular a sugestão.");
    }
    // null do servidor = campo limpo; no client isso é undefined.
    const patch = Object.fromEntries(
      Object.entries(data.patch ?? {}).map(([k, v]) => [k, v ?? undefined]),
    ) as Partial<Comprovante> & { matchedDate?: string | Date };
    if (typeof patch.matchedDate === "string") {
      patch.matchedDate = new Date(patch.matchedDate);
    }
    if (patch.manualFields) {
      const m = patch.manualFields as unknown as Record<string, unknown>;
      patch.manualFields = {
        ...patch.manualFields,
        date: m.date ? new Date(m.date as string) : undefined,
        at: new Date((m.at as string) ?? Date.now()),
      };
    }
    return { patch: patch as Partial<Comprovante>, learned: data.learned };
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

  async getByTransactionId(
    companyId: string,
    transactionId: string,
  ): Promise<Comprovante | null> {
    // Check primary transactionId first (single or legacy matches)
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("companyId", "==", companyId),
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
        where("companyId", "==", companyId),
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

    const byStatus = (s: ComprovanteMatchStatus) =>
      getCountFromServer(query(base, where("matchStatus", "==", s)));

    const [total, matched, pendingReview, unmatched, rejected, needsManual] =
      await Promise.all([
        getCountFromServer(base),
        byStatus("matched"),
        byStatus("pending_review"),
        byStatus("unmatched"),
        byStatus("rejected_match"),
        byStatus("needs_manual"),
      ]);

    return {
      total: total.data().count,
      matched: matched.data().count,
      pendingReview: pendingReview.data().count,
      unmatched: unmatched.data().count,
      rejectedMatch: rejected.data().count,
      needsManual: needsManual.data().count,
    };
  },

  // ── Match actions ────────────────────────────────────────────────────────────

  async confirmMatch(
    comprovanteId: string,
    transactionIds: string[],
    transactions: Array<{
      id: string;
      description?: string;
      supplierOrClient?: string;
    }>,
    reviewedBy: string,
    storagePath: string,
    actor?: { companyId: string; userEmail: string },
  ): Promise<void> {
    const batch = writeBatch(db);
    const primaryId = transactionIds[0];

    // Preserve the original OCR text so searches by content still work after matching
    const existingSnap = await getDoc(doc(db, COLLECTION, comprovanteId));
    const existingData = existingSnap.data();
    const searchText = buildSearchText({
      matchedEntity: existingData?.matchedEntity,
      extractedText: existingData?.extractedText,
      transactionDescriptions: transactions.map((t) => t.description),
      transactionEntities: transactions.map((t) => t.supplierOrClient),
    });

    // A sugestão fica guardada: é o que permite "desfazer" voltar para a fila.
    batch.update(doc(db, COLLECTION, comprovanteId), {
      matchStatus: "matched",
      transactionId: primaryId,
      transactionIds,
      isConsolidated: transactionIds.length > 1,
      reviewedBy,
      reviewedAt: serverTimestamp(),
      searchText,
      searchTokens: tokenize(searchText),
      updatedAt: serverTimestamp(),
    });

    for (const txId of transactionIds) {
      batch.update(doc(db, "transactions", txId), {
        comprovanteId,
        comprovanteStoragePath: storagePath,
        comprovanteUrl: null, // limpar URL pública legada
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: reviewedBy,
        userEmail: actor.userEmail,
        action: "confirm_match",
        entity: "comprovante",
        entityId: comprovanteId,
        details: { transactionIds, storagePath },
      });
    }
  },

  async rejectMatch(
    comprovanteId: string,
    reviewedBy: string,
    actor?: { companyId: string; userEmail: string },
  ): Promise<void> {
    await updateDoc(doc(db, COLLECTION, comprovanteId), {
      matchStatus: "rejected_match",
      transactionId: null,
      transactionIds: null,
      isConsolidated: false,
      suggestedTransactionId: null,
      suggestedTransactionIds: null,
      reviewedBy,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: reviewedBy,
        userEmail: actor.userEmail,
        action: "reject_match",
        entity: "comprovante",
        entityId: comprovanteId,
        details: {},
      });
    }
  },

  /**
   * Desfaz uma associação. `restoreTo: "pending_review"` é o "desfazer" logo
   * após confirmar: devolve à fila mantendo a sugestão original.
   */
  async removeMatch(
    comprovanteId: string,
    transactionIds: string[],
    removedBy?: string,
    actor?: { companyId: string; userEmail: string },
    restoreTo: Exclude<ComprovanteMatchStatus, "matched"> = "unmatched",
  ): Promise<void> {
    const batch = writeBatch(db);

    batch.update(doc(db, COLLECTION, comprovanteId), {
      matchStatus: restoreTo,
      transactionId: null,
      transactionIds: null,
      isConsolidated: false,
      autoConfirmed: false,
      ...(restoreTo === "unmatched" && {
        suggestedTransactionId: null,
        suggestedTransactionIds: null,
      }),
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: serverTimestamp(),
    });

    for (const txId of transactionIds) {
      batch.update(doc(db, "transactions", txId), {
        comprovanteId: null,
        comprovanteUrl: null,
        comprovanteStoragePath: null,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (removedBy && actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: removedBy,
        userEmail: actor.userEmail,
        action: "remove_match",
        entity: "comprovante",
        entityId: comprovanteId,
        details: { transactionIds },
      });
    }
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
      >
    >,
  ): Promise<void> {
    await updateDoc(
      doc(db, COLLECTION, id),
      stripUndefined({ ...data, updatedAt: serverTimestamp() }),
    );
  },

  async delete(
    id: string,
    storagePath?: string,
    actor?: { companyId: string; userId: string; userEmail: string },
  ): Promise<void> {
    await deleteDoc(doc(db, COLLECTION, id));
    if (storagePath) {
      await deleteObject(ref(storage, storagePath)).catch(() => {});
    }
    if (actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "delete_comprovante",
        entity: "comprovante",
        entityId: id,
        details: { storagePath },
      });
    }
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

  // Returns the set of hashes that already exist for the company (batch dedup)
  async findExistingHashes(
    companyId: string,
    fileHashes: string[],
  ): Promise<Set<string>> {
    if (fileHashes.length === 0) return new Set();
    const existing = new Set<string>();
    // Firestore `in` operator supports up to 30 values per query
    const BATCH = 30;
    for (let i = 0; i < fileHashes.length; i += BATCH) {
      const chunk = fileHashes.slice(i, i + BATCH);
      const snap = await getDocs(
        query(
          collection(db, COLLECTION),
          where("companyId", "==", companyId),
          where("fileHash", "in", chunk),
        ),
      );
      snap.docs.forEach((d) => {
        const h = d.data().fileHash as string | undefined;
        if (h) existing.add(h);
      });
    }
    return existing;
  },
};
