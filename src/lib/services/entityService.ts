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
  QueryDocumentSnapshot,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { ENTITY_BANK_FIELDS, Entity, EntityBankDetails } from "@/lib/types";
import { auditService } from "./auditService";
import { formatAddress } from "./cnpjService";
import { generateChanges } from "@/lib/auditFormatter";
import { normalizeText, stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "entities";

const ADDRESS_FIELDS = [
  "zipCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
] as const;

type Actor = { uid: string; email: string };
type EntityInput = Partial<Omit<Entity, "id" | "createdAt" | "updatedAt">>;

/** Só os dados bancários preenchidos ("" e null contam como vazio). */
const bankDetailsOf = (data: Record<string, unknown>): EntityBankDetails =>
  Object.fromEntries(
    ENTITY_BANK_FIELDS.map((f) => [f, data[f]]).filter(([, v]) => v),
  );

const sameBankDetails = (a: EntityBankDetails, b: EntityBankDetails) =>
  ENTITY_BANK_FIELDS.every((f) => (a[f] ?? "") === (b[f] ?? ""));

/** Endereço em uma linha recalculado quando algum campo do endereço muda. */
const withAddressLine = (
  data: Record<string, unknown>,
  current: Record<string, unknown> = {},
) =>
  ADDRESS_FIELDS.some((f) => f in data)
    ? { ...data, address: formatAddress({ ...current, ...data }) }
    : data;

/**
 * Busca por nome (sem acento/caixa, substring) ou por documento
 * (dígitos ou como digitado). Termo vazio casa com tudo.
 */
export function matchesEntitySearch(entity: Entity, search: string): boolean {
  const term = search.trim();
  if (!term) return true;
  const cleanSearch = term.replace(/\D/g, "");
  const isNumeric = cleanSearch.length > 0 && /^\d+$/.test(cleanSearch);
  const normalizedSearch = normalizeText(term);

  if (isNumeric && entity.document) {
    if (entity.document.replace(/\D/g, "").includes(cleanSearch)) return true;
  }
  if (normalizeText(entity.name || "").includes(normalizedSearch)) return true;
  if (normalizeText(entity.tradeName || "").includes(normalizedSearch))
    return true;
  if (!isNumeric && entity.document) {
    if (normalizeText(entity.document).includes(normalizedSearch)) return true;
  }
  return false;
}

// Simple in-memory cache
const cache: Record<string, { data: Entity[]; timestamp: number }> = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const convertEntity = (data: DocumentData): Entity => {
  return {
    id: data.id,
    ...data,
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    bankDetailsChangedAt: (
      data.bankDetailsChangedAt as Timestamp | undefined
    )?.toDate(),
    pendingBankChange: data.pendingBankChange && {
      ...data.pendingBankChange,
      // serverTimestamp ainda não resolvido chega como null no cache local
      requestedAt:
        (data.pendingBankChange.requestedAt as Timestamp | null)?.toDate() ??
        new Date(),
    },
  } as Entity;
};
const convertDates = convertEntity;

export const entityService = {
  getAll: async (
    companyId: string,
    category?: "supplier" | "client",
  ): Promise<Entity[]> => {
    const cacheKey = `${companyId}_${category || "all"}`;
    const now = Date.now();

    if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_DURATION) {
      return cache[cacheKey].data;
    }

    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("name", "asc"),
    );

    if (category) {
      // If category is specified, we want entities that match the category OR are 'both'
      // Firestore doesn't support logical OR in simple queries easily without multiple queries or "in" array.
      // Since 'both' is a valid value for any category search, we can use "in"
      q = query(q, where("category", "in", [category, "both"]));
    }

    const snapshot = await getDocs(q);
    const entities = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );

    cache[cacheKey] = { data: entities, timestamp: now };
    return entities;
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
    filters?: {
      category?: "supplier" | "client";
      search?: string;
    },
  ): Promise<{
    entities: Entity[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    const search = filters?.search?.trim();

    // When a search term is provided, fetch all matching entities from Firestore
    // and filter client-side so we support: case-insensitive, accent-insensitive
    // and substring matching — things Firestore prefix queries cannot handle.
    if (search) {
      let q = query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        orderBy("name", "asc"),
      );

      if (filters?.category) {
        q = query(q, where("category", "in", [filters.category, "both"]));
      }

      const snapshot = await getDocs(q);
      const allEntities = snapshot.docs.map((doc) =>
        convertDates({ id: doc.id, ...doc.data() }),
      );

      const filtered = allEntities.filter((entity) =>
        matchesEntitySearch(entity, search),
      );

      // Apply client-side "pagination" offset based on lastDoc
      let startIndex = 0;
      if (lastDoc) {
        const lastId = (lastDoc as { id?: string }).id;
        const idx = filtered.findIndex((e) => e.id === lastId);
        if (idx !== -1) startIndex = idx + 1;
      }
      const page = filtered.slice(startIndex, startIndex + pageSize);
      const newLastDoc =
        page.length > 0
          ? snapshot.docs.find((d) => d.id === page[page.length - 1].id) || null
          : null;

      return { entities: page, lastDoc: newLastDoc };
    }

    // --- Normal paginated query (no search) ---
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("name", "asc"),
      limit(pageSize),
    );

    if (filters?.category) {
      q = query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        where("category", "in", [filters.category, "both"]),
        orderBy("name", "asc"),
        limit(pageSize),
      );
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);
    const entities = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );

    return {
      entities,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  },

  checkCnpjExists: async (
    companyId: string,
    cnpj: string,
    excludeId?: string,
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
      where("document", "==", cleanCnpj),
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
    user: { uid: string; email: string },
  ): Promise<Entity> => {
    entityService.invalidateCache(data.companyId);
    const now = new Date();

    // Remove undefined values (Firestore doesn't accept them)
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    // Ensure document is stripped of non-digits if it exists
    if (cleanData.document && typeof cleanData.document === "string") {
      cleanData.document = cleanData.document.replace(/\D/g, "");
    }

    delete cleanData.pendingBankChange;
    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      ...withAddressLine(cleanData),
      active: true,
      nameLower:
        typeof cleanData.name === "string" ? cleanData.name.toLowerCase() : "",
      nameNormalized:
        typeof cleanData.name === "string" ? normalizeText(cleanData.name) : "",
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

  /**
   * Edição comum grava direto. Dados bancários diferentes dos atuais não:
   * viram `pendingBankChange` e só valem depois que outra pessoa aprova.
   */
  update: async (
    id: string,
    data: EntityInput,
    user: Actor,
    companyId: string,
  ): Promise<{ bankChangePending: boolean }> => {
    entityService.invalidateCache(companyId);
    const docRef = doc(db, COLLECTION_NAME, id);
    const now = new Date();

    // Fetch current document to generate diff
    const currentDoc = await getDoc(docRef);
    const currentData = currentDoc.exists() ? currentDoc.data() : {};

    // Remove undefined values (Firestore doesn't accept them)
    const cleanData: Record<string, unknown> = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    // Ensure document is stripped of non-digits if it exists
    if (cleanData.document && typeof cleanData.document === "string") {
      cleanData.document = cleanData.document.replace(/\D/g, "");
    }

    const touchesBank = ENTITY_BANK_FIELDS.some((f) => f in cleanData);
    const proposed = bankDetailsOf({ ...currentData, ...cleanData });
    const bankChangePending =
      touchesBank && !sameBankDetails(bankDetailsOf(currentData), proposed);
    ENTITY_BANK_FIELDS.forEach((f) => delete cleanData[f]);

    await updateDoc(docRef, {
      ...withAddressLine(cleanData, currentData),
      ...(bankChangePending && {
        pendingBankChange: {
          ...proposed,
          requestedBy: user.uid,
          requestedByEmail: user.email,
          requestedAt: serverTimestamp(),
        },
      }),
      ...(typeof cleanData.name === "string" && {
        nameLower: cleanData.name.toLowerCase(),
        nameNormalized: normalizeText(cleanData.name),
      }),
      updatedAt: Timestamp.fromDate(now),
    });

    // Generate changes for audit log
    const changes = generateChanges(
      currentData as Record<string, unknown>,
      cleanData,
    );
    const subject = (cleanData.name ?? currentData.name) as string | undefined;

    if (changes.length > 0 || !bankChangePending) {
      await auditService.log({
        companyId: companyId,
        userId: user.uid,
        userEmail: user.email,
        action: "update",
        entity: "entity",
        entityId: id,
        subject,
        details: { changes },
      });
    }
    if (bankChangePending) {
      await auditService.log({
        companyId,
        userId: user.uid,
        userEmail: user.email,
        action: "request_bank_change",
        entity: "entity",
        entityId: id,
        subject,
        details: {
          changes: generateChanges(
            bankDetailsOf(currentData) as Record<string, unknown>,
            Object.fromEntries(
              ENTITY_BANK_FIELDS.map((f) => [f, proposed[f] ?? ""]),
            ),
          ),
        },
      });
    }
    return { bankChangePending };
  },

  /**
   * Aplica a troca pendente. Quem pediu não aprova: o serviço recusa aqui e as
   * rules recusam no servidor.
   */
  approveBankChange: async (entity: Entity, user: Actor, companyId: string) => {
    const pending = entity.pendingBankChange;
    if (!pending) throw new Error("Não há troca de dados bancários pendente.");
    if (pending.requestedBy === user.uid) {
      throw new Error("Quem pediu a troca não pode aprová-la.");
    }
    entityService.invalidateCache(companyId);
    await updateDoc(doc(db, COLLECTION_NAME, entity.id), {
      ...Object.fromEntries(
        ENTITY_BANK_FIELDS.map((f) => [f, pending[f] || deleteField()]),
      ),
      pendingBankChange: deleteField(),
      bankDetailsChangedAt: serverTimestamp(),
      updatedAt: Timestamp.now(),
    });
    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "approve_bank_change",
      entity: "entity",
      entityId: entity.id,
      subject: entity.name,
      details: {
        changes: generateChanges(
          bankDetailsOf(entity as unknown as Record<string, unknown>) as Record<
            string,
            unknown
          >,
          Object.fromEntries(
            ENTITY_BANK_FIELDS.map((f) => [f, pending[f] ?? ""]),
          ),
        ),
        requestedBy: pending.requestedByEmail,
      },
    });
  },

  /** Descarta a troca pendente; os dados atuais continuam valendo. */
  rejectBankChange: async (entity: Entity, user: Actor, companyId: string) => {
    entityService.invalidateCache(companyId);
    await updateDoc(doc(db, COLLECTION_NAME, entity.id), {
      pendingBankChange: deleteField(),
      updatedAt: Timestamp.now(),
    });
    await auditService.log({
      companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "reject_bank_change",
      entity: "entity",
      entityId: entity.id,
      subject: entity.name,
      details: stripUndefined({
        requestedBy: entity.pendingBankChange?.requestedByEmail,
      }),
    });
  },

  /** Inativo some dos formulários de lançamento; o histórico continua. */
  setActive: async (
    entities: Pick<Entity, "id" | "name">[],
    active: boolean,
    user: Actor,
    companyId: string,
  ) => {
    entityService.invalidateCache(companyId);
    await Promise.all(
      entities.map(async (e) => {
        await updateDoc(doc(db, COLLECTION_NAME, e.id), {
          active,
          updatedAt: Timestamp.now(),
        });
        await auditService.log({
          companyId,
          userId: user.uid,
          userEmail: user.email,
          action: active ? "reactivate" : "deactivate",
          entity: "entity",
          entityId: e.id,
          subject: e.name,
          details: {},
        });
      }),
    );
  },

  /** Algum lançamento aponta para a entidade (pelo cadastro ou pelo nome)? */
  hasTransactions: async (
    companyId: string,
    entity: Pick<Entity, "id" | "name">,
  ): Promise<boolean> => {
    const base = [where("companyId", "==", companyId), limit(1)];
    const [byId, byName] = await Promise.all([
      getDocs(
        query(
          collection(db, "transactions"),
          where("entityId", "==", entity.id),
          ...base,
        ),
      ),
      getDocs(
        query(
          collection(db, "transactions"),
          where("supplierOrClient", "==", entity.name),
          ...base,
        ),
      ),
    ]);
    return !byId.empty || !byName.empty;
  },

  /** Exclusão só para cadastro sem nenhum lançamento; com histórico, inative. */
  delete: async (
    id: string,
    user: { uid: string; email: string },
    companyId: string,
  ): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    // Depois de excluído, o log é o único lugar que guarda o nome.
    const snap = await getDoc(docRef);
    if (
      snap.exists() &&
      (await entityService.hasTransactions(companyId, {
        id,
        name: snap.data().name,
      }))
    ) {
      throw new Error(
        "Esta entidade tem lançamentos. Inative em vez de excluir para manter o histórico.",
      );
    }
    entityService.invalidateCache(companyId); // BUG-03: invalidate before delete
    await deleteDoc(docRef);

    await auditService.log({
      companyId: companyId,
      userId: user.uid,
      userEmail: user.email,
      action: "delete",
      entity: "entity",
      entityId: id,
      subject: snap.data()?.name,
      details: snap.exists()
        ? stripUndefined({ document: snap.data().document })
        : {},
    });
  },
};
