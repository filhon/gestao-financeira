import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuditLog } from "@/lib/types";

const COLLECTION_NAME = "audit_logs";

const convertDates = (data: DocumentData): AuditLog => {
  return {
    id: data.id,
    ...data,
    createdAt: (data.createdAt as Timestamp)?.toDate(),
  } as AuditLog;
};

export const auditService = {
  log: async (data: Omit<AuditLog, "id" | "createdAt">): Promise<void> => {
    try {
      await addDoc(collection(db, COLLECTION_NAME), {
        ...data,
        createdAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Failed to create audit log:", error);
      // We don't throw here to avoid blocking the main action if logging fails
    }
  },

  getPaginated: async (
    companyId: string,
    pageSize: number,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null,
    filter?: {
      userId?: string;
      entity?: string;
      action?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<{
    logs: AuditLog[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc")
    );

    if (filter?.userId) {
      q = query(q, where("userId", "==", filter.userId));
    }
    if (filter?.entity) {
      q = query(q, where("entity", "==", filter.entity));
    }
    if (filter?.action) {
      q = query(q, where("action", "==", filter.action));
    }
    if (filter?.startDate) {
      q = query(
        q,
        where("createdAt", ">=", Timestamp.fromDate(filter.startDate))
      );
    }
    if (filter?.endDate) {
      q = query(
        q,
        where("createdAt", "<=", Timestamp.fromDate(filter.endDate))
      );
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );
    const newLastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

    return { logs, lastDoc: newLastDoc };
  },

  getAggregatedStats: async (companyId: string) => {
    // Note: In a real production app with millions of logs,
    // we should use aggregation queries or a separate stats collection.
    // For now, we'll fetch a reasonable amount of recent logs to build the filters.
    // Or better, we can just rely on the unique values found in the current view or fetch a larger batch for stats.

    // Let's fetch the last 1000 logs to build the filter options dynamically
    const q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc"),
      limit(1000)
    );

    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((d) => d.data());

    const userCounts = new Map<string, { name: string; count: number }>();
    const entityCounts = new Map<string, number>();
    const actionCounts = new Map<string, number>();

    logs.forEach((log) => {
      // User Stats
      if (log.userId && log.userEmail) {
        const current = userCounts.get(log.userId) || {
          name: log.userEmail,
          count: 0,
        };
        userCounts.set(log.userId, {
          name: current.name,
          count: current.count + 1,
        });
      }

      // Entity Stats
      if (log.entity) {
        entityCounts.set(log.entity, (entityCounts.get(log.entity) || 0) + 1);
      }

      // Action Stats
      if (log.action) {
        actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
      }
    });

    return {
      users: Array.from(userCounts.entries()).map(([id, { name, count }]) => ({
        id,
        name,
        count,
      })),
      entities: Array.from(entityCounts.entries()).map(([name, count]) => ({
        name,
        count,
      })),
      actions: Array.from(actionCounts.entries()).map(([name, count]) => ({
        name,
        count,
      })),
    };
  },

  getLogs: async (
    companyId: string,
    filter?: {
      userId?: string;
      entity?: string;
      action?: string;
      startDate?: Date;
      endDate?: Date;
    },
    limitCount = 50
  ): Promise<AuditLog[]> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc")
    );

    if (filter?.userId) {
      q = query(q, where("userId", "==", filter.userId));
    }
    if (filter?.entity) {
      q = query(q, where("entity", "==", filter.entity));
    }
    if (filter?.action) {
      q = query(q, where("action", "==", filter.action));
    }
    if (filter?.startDate) {
      q = query(
        q,
        where("createdAt", ">=", Timestamp.fromDate(filter.startDate))
      );
    }
    if (filter?.endDate) {
      q = query(
        q,
        where("createdAt", "<=", Timestamp.fromDate(filter.endDate))
      );
    }

    q = query(q, limit(limitCount));

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() })
    );
  },
};
