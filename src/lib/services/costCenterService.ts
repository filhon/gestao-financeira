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
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { CostCenter } from "@/lib/types";
import { CostCenterFormData } from "@/lib/validations/costCenter";

const COLLECTION_NAME = "cost_centers";

export const costCenterService = {
  getAll: async (
    companyId?: string,
    forUserId?: string
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
      where("parentId", "==", parentId)
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
    userId?: string
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
    // Include all statuses (draft, pending_approval, approved, paid) for projected revenue
    // For 'user' role, filter by createdBy to match Firestore rules
    let receivablesQuery = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId),
      where("type", "==", "receivable"),
      where("status", "in", ["draft", "pending_approval", "approved", "paid"]),
      where("dueDate", ">=", yearStart),
      where("dueDate", "<=", yearEnd)
    );

    if (userId) {
      receivablesQuery = query(
        receivablesQuery,
        where("createdBy", "==", userId)
      );
    }
    const receivablesSnapshot = await getDocs(receivablesQuery);
    let fromReceivables = 0;
    receivablesSnapshot.docs.forEach((docSnap) => {
      const tx = docSnap.data();
      const allocations = tx.costCenterAllocation || [];
      allocations.forEach((alloc: { costCenterId: string; amount: number }) => {
        if (alloc.costCenterId === costCenterId) {
          fromReceivables += alloc.amount || 0;
        }
      });
    });

    // Get payables (non-rejected) allocated to this cost center
    // For 'user' role, filter by createdBy to match Firestore rules
    let payablesQuery = query(
      collection(db, "transactions"),
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
      where("status", "in", ["draft", "pending_approval", "approved", "paid"]),
      where("dueDate", ">=", yearStart),
      where("dueDate", "<=", yearEnd)
    );

    if (userId) {
      payablesQuery = query(payablesQuery, where("createdBy", "==", userId));
    }
    const payablesSnapshot = await getDocs(payablesQuery);
    let spentOnPayables = 0;
    payablesSnapshot.docs.forEach((docSnap) => {
      const tx = docSnap.data();
      const allocations = tx.costCenterAllocation || [];
      allocations.forEach((alloc: { costCenterId: string; amount: number }) => {
        if (alloc.costCenterId === costCenterId) {
          spentOnPayables += alloc.amount || 0;
        }
      });
    });

    const fromParent = costCenter.allocatedFromParent || 0;
    const allocatedToChildren = costCenter.allocatedToChildren || 0;

    const available =
      fromReceivables + fromParent - allocatedToChildren - spentOnPayables;

    return {
      fromReceivables,
      fromParent,
      allocatedToChildren,
      spentOnPayables,
      available: Math.max(0, available),
    };
  },

  /**
   * Update the manual balance allocation from parent to child
   */
  allocateToChild: async (
    parentId: string,
    childId: string,
    amount: number
  ) => {
    const parentRef = doc(db, COLLECTION_NAME, parentId);
    const childRef = doc(db, COLLECTION_NAME, childId);

    const parent = await costCenterService.getById(parentId);
    const child = await costCenterService.getById(childId);

    if (!parent || !child) throw new Error("Cost center not found");

    // Update parent's allocatedToChildren
    const newParentAllocated = (parent.allocatedToChildren || 0) + amount;
    await updateDoc(parentRef, {
      allocatedToChildren: newParentAllocated,
      updatedAt: serverTimestamp(),
    });

    // Update child's allocatedFromParent
    const newChildAllocated = (child.allocatedFromParent || 0) + amount;
    await updateDoc(childRef, {
      allocatedFromParent: newChildAllocated,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Update the available balance directly (manual adjustment)
   */
  updateBalance: async (id: string, availableBalance: number) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    return updateDoc(docRef, {
      availableBalance,
      updatedAt: serverTimestamp(),
    });
  },
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
