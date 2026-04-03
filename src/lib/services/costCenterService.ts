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
  getDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { CostCenter } from "@/lib/types";
import { CostCenterFormData } from "@/lib/validations/costCenter";
import { budgetService } from "@/lib/services/budgetService";

const COLLECTION_NAME = "cost_centers";

export const costCenterService = {
  getAll: async (
    companyId?: string,
    forUserId?: string,
  ): Promise<CostCenter[]> => {
    let q = query(collection(db, COLLECTION_NAME), orderBy("name"));

    if (companyId) {
      q = query(q, where("companyId", "==", companyId));
    }

    // For 'user' role, filter to only cost centers where they are in allowedUserIds
    // This matches the Firestore rules and prevents permission errors
    if (forUserId) {
      q = query(q, where("allowedUserIds", "array-contains", forUserId));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
      } as CostCenter;
    });
  },

  getById: async (id: string): Promise<CostCenter | null> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
      } as CostCenter;
    }
    return null;
  },

  create: async (data: CostCenterFormData, companyId: string) => {
    return addDoc(collection(db, COLLECTION_NAME), {
      ...data,
      companyId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  update: async (id: string, data: CostCenterFormData) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    return updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  delete: async (id: string) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    return deleteDoc(docRef);
  },

  getChildren: async (parentId: string): Promise<CostCenter[]> => {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("parentId", "==", parentId),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate(),
      } as CostCenter;
    });
  },

  /**
   * Calculate effective balance for a cost center for a specific year
   * Balance = (approved receivables) + (parent allocation) - (allocated to children) - (payables)
   * Only includes transactions with dueDate in the specified year
   */
  getEffectiveBalance: async (
    costCenterId: string,
    companyId: string,
    year?: number,
    userId?: string,
  ): Promise<{
    fromReceivables: number;
    fromParent: number;
    allocatedToChildren: number;
    spentOnPayables: number;
    available: number;
  }> => {
    const targetYear = year || new Date().getFullYear();
    const yearStart = new Date(targetYear, 0, 1); // Jan 1
    const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59); // Dec 31

    // Expand query window ±90 days to capture transactions paid outside the strict year boundary.
    // effectiveDate (paymentDate if paid, else dueDate) is applied in memory.
    const queryStart = new Date(yearStart);
    queryStart.setDate(queryStart.getDate() - 90);
    const queryEnd = new Date(yearEnd);
    queryEnd.setDate(queryEnd.getDate() + 90);

    // Get the cost center
    const costCenter = await costCenterService.getById(costCenterId);
    if (!costCenter) {
      return {
        fromReceivables: 0,
        fromParent: 0,
        allocatedToChildren: 0,
        spentOnPayables: 0,
        available: 0,
      };
    }

    // Get all non-rejected receivables allocated to this cost center
    // Include all positive statuses (draft, pending_approval, approved, pending_authorization, authorized, paid) for projected revenue
    // For 'user' role, filter by createdBy to match Firestore rules
    let receivablesQuery = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId),
      where("type", "==", "receivable"),
      where("status", "in", [
        "draft",
        "pending_approval",
        "approved",
        "pending_authorization",
        "authorized",
        "paid",
      ]),
      where("dueDate", ">=", queryStart),
      where("dueDate", "<=", queryEnd),
    );

    if (userId) {
      receivablesQuery = query(
        receivablesQuery,
        where("createdBy", "==", userId),
      );
    }
    const receivablesSnapshot = await getDocs(receivablesQuery);
    let fromReceivables = 0;
    receivablesSnapshot.docs.forEach((docSnap) => {
      const tx = docSnap.data();
      // Use effectiveDate to determine if this transaction belongs to the target year
      const effDate: Date = tx.status === "paid" && tx.paymentDate
        ? (tx.paymentDate as Timestamp).toDate()
        : (tx.dueDate as Timestamp).toDate();
      if (effDate < yearStart || effDate > yearEnd) return;
      const allocations = tx.costCenterAllocation || [];
      if (allocations.length > 0) {
        allocations.forEach(
          (alloc: { costCenterId: string; amount: number }) => {
            if (alloc.costCenterId === costCenterId) {
              fromReceivables += alloc.amount || 0;
            }
          },
        );
      } else if (tx.costCenterId === costCenterId) {
        fromReceivables += Number(tx.finalAmount || tx.amount || 0);
      }
    });

    // Get payables (non-rejected) allocated to this cost center
    // For 'user' role, filter by createdBy to match Firestore rules
    let payablesQuery = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
      where("status", "in", [
        "draft",
        "pending_approval",
        "approved",
        "pending_authorization",
        "authorized",
        "paid",
      ]),
      where("dueDate", ">=", queryStart),
      where("dueDate", "<=", queryEnd),
    );

    if (userId) {
      payablesQuery = query(payablesQuery, where("createdBy", "==", userId));
    }
    const payablesSnapshot = await getDocs(payablesQuery);
    let spentOnPayables = 0;
    payablesSnapshot.docs.forEach((docSnap) => {
      const tx = docSnap.data();
      // Use effectiveDate to determine if this transaction belongs to the target year
      const effDate: Date = tx.status === "paid" && tx.paymentDate
        ? (tx.paymentDate as Timestamp).toDate()
        : (tx.dueDate as Timestamp).toDate();
      if (effDate < yearStart || effDate > yearEnd) return;
      const allocations = tx.costCenterAllocation || [];
      if (allocations.length > 0) {
        allocations.forEach(
          (alloc: { costCenterId: string; amount: number }) => {
            if (alloc.costCenterId === costCenterId) {
              spentOnPayables += alloc.amount || 0;
            }
          },
        );
      } else if (tx.costCenterId === costCenterId) {
        spentOnPayables += Number(tx.finalAmount || tx.amount || 0);
      }
    });

    const fromParent = costCenter.allocatedFromParent || 0;
    const allocatedToChildren = costCenter.allocatedToChildren || 0;

    // Fetch budget for the year
    const budget = await budgetService.getByCostCenterAndYear(
      costCenterId,
      targetYear,
      companyId,
    );
    const budgetAmount = budget?.amount || 0;

    let available = 0;
    if (budgetAmount > 0) {
      // If budget is set, it overrides the "cash flow" logic for availability
      available = budgetAmount - allocatedToChildren - spentOnPayables;
    } else {
      // Fallback to cash flow logic
      available =
        fromReceivables + fromParent - allocatedToChildren - spentOnPayables;
    }

    return {
      fromReceivables,
      fromParent,
      allocatedToChildren,
      spentOnPayables,
      available,
    };
  },

  /**
   * Optimized method to get balances for all cost centers at once
   * Reduces database reads by fetching transactions only once
   */
  getAllBalances: async (
    companyId: string,
    costCenters: CostCenter[],
    year?: number,
    userId?: string,
  ): Promise<Record<string, number>> => {
    const targetYear = year || new Date().getFullYear();
    const yearStart = new Date(targetYear, 0, 1);
    const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59);

    // Expand query window ±90 days; effectiveDate filtering happens in memory below.
    const queryStart = new Date(yearStart);
    queryStart.setDate(queryStart.getDate() - 90);
    const queryEnd = new Date(yearEnd);
    queryEnd.setDate(queryEnd.getDate() + 90);

    // 1. Fetch all relevant transactions for the company/year ONCE
    let transactionsQuery = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId),
      where("status", "in", [
        "draft",
        "pending_approval",
        "approved",
        "pending_authorization",
        "authorized",
        "paid",
      ]),
      where("dueDate", ">=", queryStart),
      where("dueDate", "<=", queryEnd),
    );

    if (userId) {
      transactionsQuery = query(
        transactionsQuery,
        where("createdBy", "==", userId),
      );
    }

    const transactionsSnapshot = await getDocs(transactionsQuery);
    // Pre-filter by effectiveDate: paymentDate if paid, else dueDate — must fall in target year
    const transactions = transactionsSnapshot.docs
      .map((doc) => doc.data())
      .filter((tx) => {
        const effDate: Date = tx.status === "paid" && tx.paymentDate
          ? (tx.paymentDate as Timestamp).toDate()
          : (tx.dueDate as Timestamp).toDate();
        return effDate >= yearStart && effDate <= yearEnd;
      });

    // 2. Fetch budgets for all cost centers (batching to avoid 30 limits and multiple calls)
    const costCenterIds = costCenters.map((cc) => cc.id);
    const budgets = await budgetService.getAllBalancesBatch(
      costCenterIds,
      targetYear,
      companyId,
    );

    const budgetMap = new Map(budgets.map((b) => [b.costCenterId, b.amount]));

    // 3. Calculate balances in memory
    const balances: Record<string, number> = {};

    for (const cc of costCenters) {
      let fromReceivables = 0;
      let spentOnPayables = 0;

      // Aggregate from loaded transactions
      for (const tx of transactions) {
        const allocations = tx.costCenterAllocation || [];
        if (allocations.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          allocations.forEach((alloc: any) => {
            if (alloc.costCenterId === cc.id) {
              if (tx.type === "receivable") {
                fromReceivables += alloc.amount || 0;
              } else if (tx.type === "payable") {
                spentOnPayables += alloc.amount || 0;
              }
            }
          });
        } else if (tx.costCenterId === cc.id) {
          if (tx.type === "receivable") {
            fromReceivables += Number(tx.finalAmount || tx.amount || 0);
          } else if (tx.type === "payable") {
            spentOnPayables += Number(tx.finalAmount || tx.amount || 0);
          }
        }
      }
      const fromParent = cc.allocatedFromParent || 0;
      const allocatedToChildren = cc.allocatedToChildren || 0;
      const budgetAmount = budgetMap.get(cc.id) || 0;

      let available = 0;
      if (budgetAmount > 0) {
        available = budgetAmount - allocatedToChildren - spentOnPayables;
      } else {
        available =
          fromReceivables + fromParent - allocatedToChildren - spentOnPayables;
      }

      balances[cc.id] = Math.max(0, available);
    }

    return balances;
  },

  /**
   * Update the manual balance allocation from parent to child
   */
  allocateToChild: async (
    parentId: string,
    childId: string,
    amount: number,
  ) => {
    const parentRef = doc(db, COLLECTION_NAME, parentId);
    const childRef = doc(db, COLLECTION_NAME, childId);

    const parent = await costCenterService.getById(parentId);
    const child = await costCenterService.getById(childId);

    if (!parent || !child) throw new Error("Cost center not found");

    const batch = writeBatch(db);

    // Update parent's allocatedToChildren
    const newParentAllocated = (parent.allocatedToChildren || 0) + amount;
    batch.update(parentRef, {
      allocatedToChildren: newParentAllocated,
      updatedAt: serverTimestamp(),
    });

    // Update child's allocatedFromParent
    const newChildAllocated = (child.allocatedFromParent || 0) + amount;
    batch.update(childRef, {
      allocatedFromParent: newChildAllocated,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },

  /**
   * Update the available balance directly (manual adjustment)
   */
};

export const getHierarchicalCostCenters = (items: CostCenter[]) => {
  const roots = items.filter((i) => !i.parentId || i.parentId === "none");
  const childrenMap = new Map<string, CostCenter[]>();

  items.forEach((item) => {
    if (item.parentId) {
      const existing = childrenMap.get(item.parentId) || [];
      existing.push(item);
      childrenMap.set(item.parentId, existing);
    }
  });

  const result: (CostCenter & { level: number })[] = [];

  const traverse = (nodes: CostCenter[], level: number) => {
    nodes.forEach((node) => {
      result.push({ ...node, level });
      const children = childrenMap.get(node.id) || [];
      traverse(children, level + 1);
    });
  };

  traverse(roots, 0);
  return result;
};
