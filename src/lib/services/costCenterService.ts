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

const COLLECTION_NAME = "cost_centers";

/** Um centro sem pai é raiz. `"none"` é o valor que o formulário usa. */
const isRootData = (parentId?: string | null) =>
  !parentId || parentId === "none";

/**
 * Impede o segundo centro de custo raiz.
 *
 * Raiz única é regra de negócio, não convenção: é ela que recebe as receitas do
 * exercício e consolida a sobra do anterior. Com duas, `buildCostCenterTree`
 * recusa a árvore e todas as telas de saldo perdem os números ao mesmo tempo —
 * e o trigger do razão para de creditar receita em silêncio, o que faz a
 * invariante do `verify:ledger` divergir sem ninguém perceber.
 *
 * A checagem vive aqui e no formulário porque as rules do Firestore não
 * conseguem expressá-la: saber se já existe raiz exige consultar a coleção, e
 * regra nenhuma faz consulta. Bloquear raiz sempre também não serve — a
 * primeira de cada empresa nasce por este mesmo caminho.
 */
async function assertSingleRoot(companyId: string, selfId?: string) {
  const snapshot = await getDocs(
    query(collection(db, COLLECTION_NAME), where("companyId", "==", companyId)),
  );

  const existingRoot = snapshot.docs.find(
    (d) => d.id !== selfId && isRootData(d.data().parentId),
  );

  if (existingRoot) {
    throw new Error(
      `Já existe um centro de custo raiz: ${existingRoot.data().name}. ` +
        "A empresa precisa ter exatamente um, que é quem recebe as receitas e " +
        "distribui o envelope para os demais. Escolha um centro de custo pai.",
    );
  }
}

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
    if (isRootData(data.parentId)) {
      await assertSingleRoot(companyId);
    }

    return addDoc(collection(db, COLLECTION_NAME), {
      ...data,
      companyId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  update: async (id: string, data: CostCenterFormData) => {
    const docRef = doc(db, COLLECTION_NAME, id);

    // Promover um centro a raiz vale a mesma checagem que criar um: o caminho
    // é diferente, o estrago é o mesmo.
    if (isRootData(data.parentId)) {
      const current = await getDoc(docRef);
      const companyId = current.data()?.companyId as string | undefined;
      if (companyId) await assertSingleRoot(companyId, id);
    }

    return updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  delete: async (id: string) => {
    // Apagar um centro com filhos os deixa órfãos, e órfão sem pai conhecido é
    // lido como raiz — o mesmo estrago de criar uma segunda raiz, por outra
    // porta. Fica aqui, junto das demais invariantes de estrutura, e não só na
    // tela que hoje chama.
    const children = await costCenterService.getChildren(id);
    if (children.length > 0) {
      throw new Error(
        "Não é possível excluir: este centro de custo possui filhos. " +
          "Remova-os primeiro.",
      );
    }

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
