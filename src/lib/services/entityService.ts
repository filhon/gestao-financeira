import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Entity } from "@/lib/types";
import { auditService } from "./auditService";
import { generateChanges } from "@/lib/auditFormatter";

const COLLECTION_NAME = "entities";

// Simple in-memory cache
const cache: Record<string, { data: Entity[]; timestamp: number }> = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const convertDates = (data: DocumentData): Entity => {
  return {
    id: data.id,
    ...data,
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  } as Entity;
};

export const entityService = {
  getAll: async (
    companyId: string,
    category?: "supplier" | "client"
  ): Promise<Entity[]> => {
    const cacheKey = `${companyId}_${category || "all"}`;
    const now = Date.now();

    if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_DURATION) {
      return cache[cacheKey].data;
    }

    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("name", "asc")
    );

    if (category) {
      // If category is specified, we want entities that match the category OR are 'both'
      // Firestore doesn't support logical OR in simple queries easily without multiple queries or "in" array.
      // Since 'both' is a valid value for any category search, we can use "in"
      q = query(q, where("category", "in", [category, "both"]));
    }

    const snapshot = await getDocs(q);
    const entities = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );

    cache[cacheKey] = { data: entities, timestamp: now };
    return entities;
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: DocumentData | null,
    filters?: {
      category?: "supplier" | "client";
      search?: string;
    }
  ): Promise<{
    entities: Entity[];
    lastDoc: DocumentData | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId)
    );

    if (filters?.category) {
      q = query(q, where("category", "in", [filters.category, "both"]));
    }

    if (filters?.search) {
      // Simple prefix search for name or exact match for document (CNPJ/CPF)
      // Note: Firestore doesn't support OR queries with different fields easily in this context without multiple queries.
      // We will prioritize name search if it looks like a name, or document search if it looks like a number.
      const cleanSearch = filters.search.replace(/\D/g, "");
      const isNumeric = cleanSearch.length > 0 && /^\d+$/.test(cleanSearch);

      if (isNumeric) {
        q = query(
          q,
          where("document", ">=", cleanSearch),
          where("document", "<=", cleanSearch + "\uf8ff")
        );
      } else {
        q = query(
          q,
          where("name", ">=", filters.search),
          where("name", "<=", filters.search + "\uf8ff")
        );
      }
    }

    q = query(q, orderBy("name", "asc"), limit(pageSize));

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);
    const entities = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );

    return {
      entities,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  },

  checkCnpjExists: async (
    companyId: string,
    cnpj: string,
    excludeId?: string
  ): Promise<boolean> => {
    // Strip non-digits to ensure consistent comparison
    const cleanCnpj = cnpj.replace(/\D/g, "");
    if (!cleanCnpj) return false;

    // We need to check against stored documents.
    // Assuming stored documents are also stripped or we need to handle formatting.
    // If stored documents have formatting, this query might fail if we don't match the format.
    // Best practice: Store stripped, format on display.
    // If current data is mixed, we might need to check both formatted and unformatted or fix data.
    // For now, assuming we search for the exact string provided (or stripped if that's the convention).
    // Let's try to match the exact string first, as the user input might be formatted.
    // Actually, the requirement says "sensitive", implying we should handle the check smartly.

    // Strategy: Check for the clean version (assuming we start storing clean) AND the formatted version if possible.
    // But Firestore queries are exact.
    // Let's query for the clean version. If the system stores formatted, this will fail unless we change storage.
    // Let's assume we should check for the value as entered (cleaned) against the 'document' field.

    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      where("document", "==", cleanCnpj)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) return false;

    // If we are editing, exclude the current entity
    if (excludeId) {
      return snapshot.docs.some((doc) => doc.id !== excludeId);
    }

    return !snapshot.empty;
  },

  invalidateCache: (companyId: string) => {
    Object.keys(cache).forEach((key) => {
      if (key.startsWith(companyId)) {
        delete cache[key];
      }
    });
  },

  create: async (
    data: Omit<Entity, "id" | "createdAt" | "updatedAt">,
    user: { uid: string; email: string }
  ): Promise<Entity> => {
    entityService.invalidateCache(data.companyId);
    const now = new Date();

    // Remove undefined values (Firestore doesn't accept them)
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    // Ensure document is stripped of non-digits if it exists
    if (cleanData.document && typeof cleanData.document === "string") {
      cleanData.document = cleanData.document.replace(/\D/g, "");
    }

    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      ...cleanData,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });

    await auditService.log({
      companyId: data.companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "create",
      entity: "entity",
      entityId: docRef.id,
      details: { name: data.name, type: data.type },
    });

    return {
      id: docRef.id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
  },

  update: async (
    id: string,
    data: Partial<Omit<Entity, "id" | "createdAt" | "updatedAt">>,
    user: { uid: string; email: string },
    companyId: string
  ): Promise<void> => {
    entityService.invalidateCache(companyId);
    const docRef = doc(db, COLLECTION_NAME, id);
    const now = new Date();

    // Fetch current document to generate diff
    const currentDoc = await getDoc(docRef);
    const currentData = currentDoc.exists() ? currentDoc.data() : {};

    // Remove undefined values (Firestore doesn't accept them)
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined)
    );

    // Ensure document is stripped of non-digits if it exists
    if (cleanData.document && typeof cleanData.document === "string") {
      cleanData.document = cleanData.document.replace(/\D/g, "");
    }

    await updateDoc(docRef, {
      ...cleanData,
      updatedAt: Timestamp.fromDate(now),
    });

    // Generate changes for audit log
    const changes = generateChanges(
      currentData as Record<string, unknown>,
      cleanData as Record<string, unknown>
    );

    await auditService.log({
      companyId: companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "update",
      entity: "entity",
      entityId: id,
      details: { changes },
    });
  },

  delete: async (
    id: string,
    user: { uid: string; email: string },
    companyId: string
  ): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await deleteDoc(docRef);

    await auditService.log({
      companyId: companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "delete",
      entity: "entity",
      entityId: id,
      details: {},
    });
  },
};
