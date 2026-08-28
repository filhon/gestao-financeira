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
  getAggregateFromServer,
  sum,
  writeBatch,
  runTransaction,
  deleteField,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions as fbFunctions } from "@/lib/firebase/client";
import currency from "currency.js";
import { Transaction, TransactionStatus } from "@/lib/types";
import { TransactionFormData } from "@/lib/validations/transaction";
import {
  format,
  addMonths,
  addDays,
  differenceInCalendarDays,
  endOfDay,
} from "date-fns";
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

/** Datas viram ISO e `undefined` some: o callable trafega JSON puro. */
const serializeForCallable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeForCallable);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [k, v]) => {
        if (v !== undefined) acc[k] = serializeForCallable(v);
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }
  return value;
};

/**
 * Edita uma despesa através da Cloud Function, que revalida o saldo com o
 * delta da alteração antes de gravar.
 */
async function updatePayableViaLedger(
  transactionId: string,
  patch: Record<string, unknown>,
) {
  const call = httpsCallable<
    { transactionId: string; patch: unknown },
    { success: boolean; budgetChanged: boolean }
  >(fbFunctions, "updatePayableTransaction");

  await call({
    transactionId,
    patch: serializeForCallable(patch),
  });
}

/**
 * Cria um parcelamento de despesa pela Cloud Function, que valida a soma das
 * parcelas por centro de custo e exercício antes de gravar qualquer uma.
 */
async function createPayableInstallmentsViaLedger(
  installments: Array<Record<string, unknown>>,
  companyId: string,
) {
  const call = httpsCallable<
    { companyId: string; transactions: unknown },
    { success: boolean; ids: string[] }
  >(fbFunctions, "createPayableInstallments");

  const { data } = await call({
    companyId,
    transactions: serializeForCallable(installments),
  });

  return data.ids.map((id) => doc(db, COLLECTION_NAME, id));
}

/**
 * Cria uma despesa avulsa pela Cloud Function, que valida o saldo do centro de
 * custo e grava transação e razão na mesma operação atômica.
 *
 * Devolve uma DocumentReference para o restante do fluxo (token de aprovação,
 * e-mail, log de auditoria) continuar funcionando sem saber da diferença.
 */
async function createPayableViaLedger(
  transactionData: Record<string, unknown>,
  costCenterIds: string[],
  companyId: string,
  status: TransactionStatus,
) {
  const call = httpsCallable<
    { companyId: string; transaction: unknown },
    { success: boolean; id: string }
  >(fbFunctions, "createPayableTransaction");

  const { data } = await call({
    companyId,
    transaction: serializeForCallable({
      ...transactionData,
      costCenterIds,
      costCenterId: costCenterIds[0],
      status,
    }),
  });

  return doc(db, COLLECTION_NAME, data.id);
}

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
    /** Filter by multiple statuses using Firestore `in` (max 30). Takes precedence over `status`. */
    statuses?: string[];
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
    if (filter?.statuses && filter.statuses.length > 0) {
      q = query(q, where("status", "in", filter.statuses));
    } else if (filter?.status) {
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
      q = query(
        q,
        where("dueDate", "<=", Timestamp.fromDate(endOfDay(filter.endDate))),
      );
    }

    if (filter?.limit) {
      q = query(q, limit(filter.limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );
  },

  /**
   * Busca transações pagas (status === "paid") filtrando pelo campo paymentDate.
   * Usado em conjunto com getAll (que filtra por dueDate) para garantir que
   * transações pagas dentro do período sejam incluídas nos relatórios mesmo
   * quando o vencimento cai fora do período solicitado.
   */
  getByPaymentDate: async (filter: {
    companyId: string;
    startDate: Date;
    endDate: Date;
    createdBy?: string;
    costCenterId?: string;
  }): Promise<Transaction[]> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", filter.companyId),
      where("status", "==", "paid"),
      orderBy("paymentDate", "asc"),
      where("paymentDate", ">=", Timestamp.fromDate(filter.startDate)),
      where("paymentDate", "<=", Timestamp.fromDate(endOfDay(filter.endDate))),
    );

    if (filter.createdBy) {
      q = query(q, where("createdBy", "==", filter.createdBy));
    }
    if (filter.costCenterId) {
      q = query(
        q,
        where("costCenterIds", "array-contains", filter.costCenterId),
      );
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
      q = query(
        q,
        where("dueDate", "<=", Timestamp.fromDate(endOfDay(filter.endDate))),
      );
    }

    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  },

  /**
   * Aggregate KPIs for the payables page using server-side aggregation.
   * Returns accurate totals independent of how many pages have been loaded.
   *
   * When multiple cost center IDs are selected, Firestore prohibits combining
   * `array-contains-any` with `in`/`not-in`. In that case we fall back to:
   *   - paidAmount via aggregate (status equality is OK with array-contains-any)
   *   - pendingAmount = totalAmount − paidAmount (avoids `in`)
   *   - overdue/dueSoon via a small doc fetch (narrow date ranges)
   */
  getPayableKpis: async (
    companyId: string,
    filters: {
      startDate?: Date;
      endDate?: Date;
      costCenterIds?: string[];
      createdBy?: string;
    },
  ): Promise<{
    pendingAmount: number;
    overdueCount: number;
    overdueAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    paidAmount: number;
  }> => {
    const UNPAID = [
      "draft",
      "pending_approval",
      "approved",
      "pending_authorization",
      "authorized",
      "rejected",
    ];

    const hasMultipleCostCenters = (filters.costCenterIds?.length ?? 0) > 1;

    // Normalize to end-of-day so a same-day endDate includes transactions
    // due later that day (e.g. AI-extracted boletos, stamped at noon).
    const normalizedEndDate = filters.endDate
      ? endOfDay(filters.endDate)
      : undefined;

    // Base query: payable transactions in the selected company
    const baseConstraints = [
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
    ];

    if (filters.createdBy) {
      baseConstraints.push(where("createdBy", "==", filters.createdBy));
    }

    // Cost center filter (Firestore limits array-contains-any to 10 items)
    if (filters.costCenterIds && filters.costCenterIds.length > 0) {
      if (filters.costCenterIds.length === 1) {
        baseConstraints.push(
          where("costCenterIds", "array-contains", filters.costCenterIds[0]),
        );
      } else {
        baseConstraints.push(
          where(
            "costCenterIds",
            "array-contains-any",
            filters.costCenterIds.slice(0, 10),
          ),
        );
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    // ── Paid in date range (works in all cases — equality status) ──────
    const paidConstraints = [...baseConstraints, where("status", "==", "paid")];
    if (filters.startDate) {
      paidConstraints.push(
        where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
      );
    }
    if (normalizedEndDate) {
      paidConstraints.push(
        where("dueDate", "<=", Timestamp.fromDate(normalizedEndDate)),
      );
    }
    const paidQuery = query(
      collection(db, COLLECTION_NAME),
      ...paidConstraints,
    );

    // ── Branch: array-contains-any can't combine with `in` ─────────────
    if (hasMultipleCostCenters) {
      // Total amount in date range (no status filter → no `in` conflict)
      const totalConstraints = [...baseConstraints];
      if (filters.startDate) {
        totalConstraints.push(
          where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
        );
      }
      if (normalizedEndDate) {
        totalConstraints.push(
          where("dueDate", "<=", Timestamp.fromDate(normalizedEndDate)),
        );
      }
      const totalQuery = query(
        collection(db, COLLECTION_NAME),
        ...totalConstraints,
      );

      // Overdue docs: narrow range (startDate..today), fetch docs & filter status in memory
      const overdueConstraints = [
        ...baseConstraints,
        where("dueDate", "<", Timestamp.fromDate(today)),
      ];
      if (filters.startDate) {
        overdueConstraints.push(
          where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
        );
      }
      const overdueDocsQuery = query(
        collection(db, COLLECTION_NAME),
        ...overdueConstraints,
        limit(2000),
      );

      // Due soon docs: today..dayAfterTomorrow (very narrow)
      const dueSoonDocsQuery = query(
        collection(db, COLLECTION_NAME),
        ...baseConstraints,
        where("dueDate", ">=", Timestamp.fromDate(today)),
        where("dueDate", "<", Timestamp.fromDate(dayAfterTomorrow)),
        limit(500),
      );

      const [totalSnap, paidSnap, overdueDocs, dueSoonDocs] = await Promise.all(
        [
          getAggregateFromServer(totalQuery, { total: sum("amount") }),
          getAggregateFromServer(paidQuery, { total: sum("amount") }),
          getDocs(overdueDocsQuery),
          getDocs(dueSoonDocsQuery),
        ],
      );

      const totalAmount = totalSnap.data().total || 0;
      const paidAmount = paidSnap.data().total || 0;

      // Filter unpaid statuses in memory
      const overdueItems = overdueDocs.docs
        .map((d) => d.data())
        .filter((d) => UNPAID.includes(d.status));
      const dueSoonItems = dueSoonDocs.docs
        .map((d) => d.data())
        .filter((d) => UNPAID.includes(d.status));

      return {
        pendingAmount: totalAmount - paidAmount,
        overdueCount: overdueItems.length,
        overdueAmount: overdueItems.reduce(
          (acc, d) => acc + (d.amount || 0),
          0,
        ),
        dueSoonCount: dueSoonItems.length,
        dueSoonAmount: dueSoonItems.reduce(
          (acc, d) => acc + (d.amount || 0),
          0,
        ),
        paidAmount,
      };
    }

    // ── Standard path: array-contains (single) or no CC filter ─────────
    // `status in [...]` is safe here.
    const pendingConstraints = [
      ...baseConstraints,
      where("status", "in", UNPAID),
    ];
    if (filters.startDate) {
      pendingConstraints.push(
        where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
      );
    }
    if (normalizedEndDate) {
      pendingConstraints.push(
        where("dueDate", "<=", Timestamp.fromDate(normalizedEndDate)),
      );
    }
    const pendingQuery = query(
      collection(db, COLLECTION_NAME),
      ...pendingConstraints,
    );

    const overdueConstraints = [
      ...baseConstraints,
      where("status", "in", UNPAID),
      where("dueDate", "<", Timestamp.fromDate(today)),
    ];
    if (filters.startDate) {
      overdueConstraints.push(
        where("dueDate", ">=", Timestamp.fromDate(filters.startDate)),
      );
    }
    const overdueQuery = query(
      collection(db, COLLECTION_NAME),
      ...overdueConstraints,
    );

    const dueSoonQuery = query(
      collection(db, COLLECTION_NAME),
      ...baseConstraints,
      where("status", "in", UNPAID),
      where("dueDate", ">=", Timestamp.fromDate(today)),
      where("dueDate", "<", Timestamp.fromDate(dayAfterTomorrow)),
    );

    // Run all aggregations in parallel (sums + counts)
    const [
      pendingSnap,
      overdueSnap,
      overdueCountSnap,
      dueSoonSnap,
      dueSoonCountSnap,
      paidSnap,
    ] = await Promise.all([
      getAggregateFromServer(pendingQuery, { total: sum("amount") }),
      getAggregateFromServer(overdueQuery, { total: sum("amount") }),
      getCountFromServer(overdueQuery),
      getAggregateFromServer(dueSoonQuery, { total: sum("amount") }),
      getCountFromServer(dueSoonQuery),
      getAggregateFromServer(paidQuery, { total: sum("amount") }),
    ]);

    return {
      pendingAmount: pendingSnap.data().total || 0,
      overdueCount: overdueCountSnap.data().count,
      overdueAmount: overdueSnap.data().total || 0,
      dueSoonCount: dueSoonCountSnap.data().count,
      dueSoonAmount: dueSoonSnap.data().total || 0,
      paidAmount: paidSnap.data().total || 0,
    };
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
      q = query(
        q,
        where("dueDate", "<=", Timestamp.fromDate(endOfDay(filters.endDate))),
      );
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

    // Keep doc references paired with their transactions for correct cursor tracking
    const docsWithData = snapshot.docs.map((snapshotDoc) => ({
      doc: snapshotDoc,
      transaction: convertDates({ id: snapshotDoc.id, ...snapshotDoc.data() }),
    }));

    // Apply client-side filtering if needed
    const filtered = clientSideStatusFilter
      ? docsWithData.filter(
          ({ transaction }) =>
            !clientSideStatusFilter!.includes(transaction.status),
        )
      : docsWithData;

    // Truncate to pageSize after client-side filtering
    const truncated = filtered.slice(0, pageSize);

    // Cursor must point to the last doc we actually included so the next page
    // starts right after it. When all fetched docs were filtered out, advance
    // past them so the next page doesn't re-fetch the same batch.
    const cursorDoc =
      truncated.length > 0
        ? truncated[truncated.length - 1].doc
        : snapshot.docs.length > 0
          ? snapshot.docs[snapshot.docs.length - 1]
          : null;

    return {
      transactions: truncated.map(({ transaction }) => transaction),
      lastDoc: cursorDoc,
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

      const installmentPayloads = [];
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
          batchId: null,
        };

        installmentPayloads.push(txData);
      }

      // Um parcelamento é validado pela soma, não parcela a parcela: doze
      // parcelas de R$ 10 mil cabem uma a uma num envelope de R$ 15 mil e
      // juntas não cabem. A função grava as N parcelas e o razão numa só
      // operação atômica.
      const refs =
        transactionData.type === "payable"
          ? await createPayableInstallmentsViaLedger(
              installmentPayloads,
              companyId,
            )
          : await Promise.all(
              installmentPayloads.map((txData) =>
                addDoc(collection(db, COLLECTION_NAME), {
                  ...txData,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }),
              ),
            );

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

    // Despesa avulsa passa pela Cloud Function, que valida o saldo do centro de
    // custo e grava transação e razão na mesma operação atômica. Escrever daqui
    // direto no Firestore deixaria duas pessoas lançarem sobre o mesmo saldo.
    // Parceladas e receitas seguem o caminho antigo por enquanto; o razão delas
    // é mantido pelo trigger `syncCostCenterLedger`.
    const docRef =
      transactionData.type === "payable"
        ? await createPayableViaLedger(
            transactionData,
            costCenterIds,
            companyId,
            status,
          )
        : await addDoc(collection(db, COLLECTION_NAME), {
            ...transactionData,
            costCenterIds,
            costCenterId,
            companyId,
            createdBy: userId,
            status: status,
            batchId: null,
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
    const batchNeedsAdjustment =
      !!batchId &&
      typeof newAmount === "number" &&
      typeof oldAmount === "number" &&
      newAmount !== oldAmount;

    // Despesa passa pela Cloud Function, que revalida o saldo com o delta da
    // edição. Sem isso o bloqueio da criação seria contornável em dois passos:
    // lançar um valor que cabe e depois editá-lo para um que não cabe.
    const isPayable = currentData.type === "payable";
    if (isPayable) {
      await updatePayableViaLedger(id, cleanData);
    }

    if (batchNeedsAdjustment) {
      const amountDiff = newAmount! - oldAmount!;
      const PAYMENT_BATCHES = "payment_batches";
      const batchDocRef = doc(db, PAYMENT_BATCHES, batchId!);
      const batchSnap = await getDoc(batchDocRef);
      if (batchSnap.exists()) {
        const currentBatchTotal = (batchSnap.data().totalAmount as number) ?? 0;
        const batchUpdate = {
          totalAmount: Math.max(0, currentBatchTotal + amountDiff),
          updatedAt: serverTimestamp(),
        };
        if (isPayable) {
          // A transação já foi gravada pela função; resta o total do lote, que
          // é um valor derivado e recalculável.
          await updateDoc(batchDocRef, batchUpdate);
        } else {
          const firestoreBatch = writeBatch(db);
          firestoreBatch.update(docRef, updatePayload);
          firestoreBatch.update(batchDocRef, batchUpdate);
          await firestoreBatch.commit();
        }
      } else if (!isPayable) {
        await updateDoc(docRef, updatePayload);
      }
    } else if (!isPayable) {
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
    actor?: { companyId: string; userEmail: string },
  ) => {
    const docRef = doc(db, COLLECTION_NAME, transactionId);

    // Atomic read-then-write: prevents a bank line from silently overwriting
    // a reconciliation that another bank line/user already placed on this
    // transaction (two statement lines racing to claim the same transaction).
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists()) {
        throw new Error("Transação não encontrada.");
      }
      const current = snap.data();
      if (current.reconciled && current.externalId !== data.externalId) {
        throw new Error(
          "Esta transação já foi conciliada com outro lançamento do extrato.",
        );
      }

      tx.update(docRef, {
        reconciled: true,
        reconciledAt: serverTimestamp(),
        externalId: data.externalId,
        reconciledBy: data.reconciledBy,
        updatedAt: serverTimestamp(),
      });
    });

    if (actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: data.reconciledBy,
        userEmail: actor.userEmail,
        action: "confirm_match",
        entity: "transaction",
        entityId: transactionId,
        details: { externalId: data.externalId },
      });
    }
  },

  /** Reverses `reconcile()` — frees the transaction so it can be matched again. */
  unreconcile: async (
    transactionId: string,
    actor?: { companyId: string; userId: string; userEmail: string },
  ) => {
    const docRef = doc(db, COLLECTION_NAME, transactionId);
    await updateDoc(docRef, {
      reconciled: false,
      reconciledAt: deleteField(),
      externalId: deleteField(),
      reconciledBy: deleteField(),
      updatedAt: serverTimestamp(),
    });

    if (actor) {
      await auditService.log({
        companyId: actor.companyId,
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "remove_match",
        entity: "transaction",
        entityId: transactionId,
        details: {},
      });
    }
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
