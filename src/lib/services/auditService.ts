import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  DocumentData,
  Query,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuditLog } from "@/lib/types";
import { stripUndefined } from "@/lib/utils";
import { changedFieldsOf } from "@/lib/auditFormatter";

const COLLECTION_NAME = "audit_logs";

export interface AuditFilter {
  userId?: string;
  entity?: string;
  action?: string;
  /** Histórico de um registro só. */
  entityId?: string;
  /** Algum destes campos foi alterado (só logs gravados com `changedFields`). */
  fields?: string[];
  startDate?: Date;
  endDate?: Date;
}

const convertDates = (data: DocumentData): AuditLog => {
  return {
    id: data.id,
    ...data,
    // serverTimestamp ainda pendente (escrita local) chega como null
    createdAt: (data.createdAt as Timestamp | null)?.toDate() ?? new Date(),
  } as AuditLog;
};

function buildQuery(companyId: string, filter?: AuditFilter) {
  let q: Query<DocumentData> = query(
    collection(db, COLLECTION_NAME),
    where("companyId", "==", companyId),
  );
  if (filter?.userId) q = query(q, where("userId", "==", filter.userId));
  if (filter?.entity) q = query(q, where("entity", "==", filter.entity));
  if (filter?.action) q = query(q, where("action", "==", filter.action));
  if (filter?.entityId) q = query(q, where("entityId", "==", filter.entityId));
  if (filter?.fields?.length) {
    q = query(q, where("changedFields", "array-contains-any", filter.fields));
  }
  if (filter?.startDate) {
    q = query(
      q,
      where("createdAt", ">=", Timestamp.fromDate(filter.startDate)),
    );
  }
  if (filter?.endDate) {
    q = query(q, where("createdAt", "<=", Timestamp.fromDate(filter.endDate)));
  }
  return query(q, orderBy("createdAt", "desc"));
}

function transactionLabel(data: DocumentData): string {
  return [data.description, data.supplierOrClient].filter(Boolean).join(" · ");
}

export const auditService = {
  /**
   * Não espera o servidor confirmar: com o cache persistente do Firestore a
   * escrita entra na fila local (IndexedDB) na hora e sincroniza sozinha,
   * inclusive depois de recarregar a página. Assim nenhuma ação do usuário
   * espera uma ida e volta só para registrar o log.
   *
   * `createdAt` é do servidor: as rules exigem `request.time`, então ninguém
   * grava um log com data retroativa.
   */
  log: async (
    data: Omit<AuditLog, "id" | "createdAt" | "changedFields">,
  ): Promise<void> => {
    const txIds = data.details?.transactionIds;
    addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...data,
        changedFields: changedFieldsOf(data.details),
        relatedIds:
          data.relatedIds ?? (Array.isArray(txIds) ? txIds : undefined),
        createdAt: serverTimestamp(),
      }),
    ).catch((error) => {
      // Falha no log nunca bloqueia nem desfaz a ação principal
      console.error("Failed to create audit log:", error);
    });
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
    filter?: AuditFilter,
  ): Promise<{
    logs: AuditLog[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = buildQuery(companyId, filter);
    if (lastDoc) q = query(q, startAfter(lastDoc));
    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((d) =>
      convertDates({ id: d.id, ...d.data() }),
    );
    return { logs, lastDoc: snapshot.docs[snapshot.docs.length - 1] || null };
  },

  count: async (companyId: string, filter?: AuditFilter): Promise<number> => {
    const snap = await getCountFromServer(buildQuery(companyId, filter));
    return snap.data().count;
  },

  /** Tudo o que casa com o filtro, para exportar. Para no teto. */
  getAll: async (
    companyId: string,
    filter: AuditFilter | undefined,
    max: number,
  ): Promise<AuditLog[]> => {
    const all: AuditLog[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
    while (all.length < max) {
      const page = await auditService.getPaginated(
        companyId,
        Math.min(500, max - all.length),
        cursor,
        filter,
      );
      all.push(...page.logs);
      if (!page.lastDoc || page.logs.length === 0) break;
      cursor = page.lastDoc;
    }
    return all;
  },

  /**
   * Histórico de um registro: o que foi feito nele e o que o afetou de fora
   * (lote, comprovante, edição em massa).
   */
  getForRecord: async (
    companyId: string,
    recordId: string,
  ): Promise<AuditLog[]> => {
    const base = collection(db, COLLECTION_NAME);
    const [own, related] = await Promise.all([
      getDocs(
        query(
          base,
          where("companyId", "==", companyId),
          where("entityId", "==", recordId),
          orderBy("createdAt", "desc"),
          limit(100),
        ),
      ),
      getDocs(
        query(
          base,
          where("companyId", "==", companyId),
          where("relatedIds", "array-contains", recordId),
          orderBy("createdAt", "desc"),
          limit(100),
        ),
      ),
    ]);
    const byId = new Map<string, AuditLog>();
    for (const d of [...own.docs, ...related.docs]) {
      byId.set(d.id, convertDates({ id: d.id, ...d.data() }));
    }
    return [...byId.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  },

  /**
   * Nome dos registros de logs antigos, gravados antes de `subject` existir.
   * Registro excluído ou sem permissão de leitura fica de fora.
   */
  resolveSubjects: async (
    logs: AuditLog[],
  ): Promise<Record<string, string>> => {
    const wanted = new Map<string, "transactions" | "entities">();
    for (const log of logs) {
      if (log.subject) continue;
      if (log.entity === "transaction")
        wanted.set(log.entityId, "transactions");
      if (log.entity === "entity") wanted.set(log.entityId, "entities");
    }
    const entries = await Promise.all(
      [...wanted].map(async ([id, col]) => {
        try {
          const snap = await getDoc(doc(db, col, id));
          if (!snap.exists()) return null;
          const data = snap.data();
          const label =
            col === "transactions" ? transactionLabel(data) : data.name;
          return label ? ([id, label as string] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(entries.filter((e) => e !== null));
  },
};
