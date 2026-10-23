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
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { CostCenter } from "@/lib/types";
import { CostCenterFormData } from "@/lib/validations/costCenter";
import { stripUndefined } from "@/lib/utils";

const COLLECTION_NAME = "cost_centers";

/** Um centro sem pai é raiz. `"none"` é o valor que o formulário usa. */
const isRootData = (parentId?: string | null) =>
  !parentId || parentId === "none";

const parentKey = (parentId?: string | null) =>
  isRootData(parentId) ? null : (parentId as string);

/** Campos do razão que, diferentes de zero, significam histórico gravado. */
const LEDGER_VALUE_FIELDS = [
  "received",
  "allocatedToChildren",
  "spentDirect",
  "subtreeSpent",
];

// As guardas de estrutura abaixo vivem aqui, e não nas rules, pelo mesmo
// motivo da raiz única: todas exigem consultar outras coleções, e regra
// nenhuma faz consulta. O risco é gestor errando, não atacante — criar ou
// mover centro de custo não move dinheiro.

async function companyCostCenters(companyId: string): Promise<CostCenter[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTION_NAME), where("companyId", "==", companyId)),
  );
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as CostCenter);
}

/**
 * O que ainda aponta para um centro de custo.
 *
 * Transação conta em qualquer status: toda mudança numa despesa passa pelo
 * callable, que recusa centro inexistente ou com filhos. Uma única conta basta
 * para que excluir o centro, ou dar filhos a ele, a trave de vez — sem aprovar,
 * pagar nem editar.
 *
 * O razão só conta com valor: o backfill criou documento zerado para todos os
 * centros, e esse não é histórico.
 */
async function referencesTo(companyId: string, id: string) {
  const transactions = collection(db, "transactions");
  const [byIds, byLegacyId, ledger, templates] = await Promise.all([
    getDocs(
      query(
        transactions,
        where("companyId", "==", companyId),
        where("costCenterIds", "array-contains", id),
        limit(1),
      ),
    ),
    getDocs(
      query(
        transactions,
        where("companyId", "==", companyId),
        where("costCenterId", "==", id),
        limit(1),
      ),
    ),
    getDocs(
      query(
        collection(db, "cost_center_ledger"),
        where("companyId", "==", companyId),
        where("costCenterId", "==", id),
      ),
    ),
    getDocs(
      query(
        collection(db, "recurring_templates"),
        where("companyId", "==", companyId),
        where("active", "==", true),
      ),
    ),
  ]);

  return {
    transactions: !byIds.empty || !byLegacyId.empty,
    ledger: ledger.docs.some((d) =>
      LEDGER_VALUE_FIELDS.some((f) => Number(d.data()[f] || 0) !== 0),
    ),
    recurrences: templates.docs
      .filter((d) => {
        const base = d.data().baseTransactionData || {};
        return (
          base.costCenterId === id ||
          (base.costCenterAllocation || []).some(
            (a: { costCenterId?: string }) => a?.costCenterId === id,
          )
        );
      })
      .map((d) => (d.data().description as string) || d.id),
  };
}

/**
 * Impede o segundo centro de custo raiz.
 *
 * Raiz única é regra de negócio, não convenção: é ela que recebe as receitas do
 * exercício e consolida a sobra do anterior. Com duas, `buildCostCenterTree`
 * recusa a árvore e todas as telas de saldo perdem os números ao mesmo tempo —
 * e o trigger do razão para de creditar receita em silêncio, o que faz a
 * invariante do `verify:ledger` divergir sem ninguém perceber.
 *
 * Bloquear raiz sempre também não serve — a primeira de cada empresa nasce por
 * este mesmo caminho.
 */
function assertSingleRoot(all: CostCenter[], selfId?: string) {
  const existingRoot = all.find(
    (cc) => cc.id !== selfId && isRootData(cc.parentId),
  );

  if (existingRoot) {
    throw new Error(
      `Já existe um centro de custo raiz: ${existingRoot.name}. ` +
        "A empresa precisa ter exatamente um, que é quem recebe as receitas e " +
        "distribui o envelope para os demais. Escolha um centro de custo pai.",
    );
  }
}

/**
 * Recusa pendurar um filho num centro que não pode virar nó interno.
 *
 * Uma folha com despesas que ganha filho passa a ser intermediária, e despesa
 * só existe em último grau: as contas que já estão nela deixariam de poder ser
 * aprovadas, pagas ou editadas. Recorrência ativa conta pelo mesmo motivo — a
 * próxima geração cairia num nó interno.
 */
async function assertCanBeParent(
  companyId: string,
  all: CostCenter[],
  parentId: string,
) {
  const parent = all.find((cc) => cc.id === parentId);
  if (!parent) throw new Error("Centro de custo pai não encontrado.");

  if (parent.archived) {
    throw new Error(
      `${parent.name} está arquivado e não pode receber novos filhos.`,
    );
  }

  const isLeaf = !all.some((cc) => parentKey(cc.parentId) === parentId);
  if (!isLeaf) return;

  const refs = await referencesTo(companyId, parentId);
  if (refs.transactions || refs.recurrences.length > 0) {
    throw new Error(
      `${parent.name} tem despesas ou recorrências lançadas e deixaria de ser ` +
        "centro de último grau — essas contas não poderiam mais ser aprovadas, " +
        "pagas ou editadas. Crie o novo centro em outro ponto da árvore, ou " +
        "arquive este e crie a nova estrutura ao lado dele.",
    );
  }
}

/**
 * Recusa mudar o pai de um centro com histórico no razão.
 *
 * A hierarquia não tem ano, mas o razão tem: cada exercício guarda o envelope
 * que o pai entregou (`allocatedToChildren`) e o gasto somado nos ancestrais
 * (`subtreeSpent`), calculados com a árvore da época. Mover o centro deixa
 * esses números presos na cadeia antiga, e a próxima edição de qualquer conta
 * dele aplica o delta na cadeia nova. O `subtreeSpent` do próprio centro já
 * cobre o gasto dos descendentes, então a checagem vale para a subárvore toda.
 */
async function assertCanMove(
  companyId: string,
  all: CostCenter[],
  id: string,
  newParentId: string,
) {
  // Ciclo: o novo pai não pode ser o próprio centro nem um descendente dele.
  const byId = new Map(all.map((cc) => [cc.id, cc]));
  const seen = new Set<string>();
  for (
    let cur: string | null = newParentId;
    cur && !seen.has(cur);
    cur = parentKey(byId.get(cur)?.parentId)
  ) {
    if (cur === id) {
      throw new Error(
        "Um centro de custo não pode ficar abaixo de si mesmo ou de um descendente.",
      );
    }
    seen.add(cur);
  }

  const refs = await referencesTo(companyId, id);
  if (refs.transactions || refs.ledger) {
    throw new Error(
      `${byId.get(id)?.name || "Este centro de custo"} já tem lançamentos ou ` +
        "envelope registrados e não pode mudar de pai: os valores de cada " +
        "exercício ficariam somados nos ancestrais antigos. Arquive-o e crie " +
        "um centro novo na posição desejada.",
    );
  }
}

/**
 * Arquivar tira o centro dos formulários sem tocar no histórico: as contas que
 * já estão nele continuam podendo ser aprovadas, pagas e editadas, e ele segue
 * podendo receber envelope (a conta de dezembro paga em janeiro consome o
 * exercício novo).
 */
async function assertCanArchive(
  companyId: string,
  all: CostCenter[],
  self: CostCenter,
) {
  if (isRootData(self.parentId)) {
    throw new Error("O centro de custo raiz não pode ser arquivado.");
  }

  const activeChild = all.find(
    (cc) => parentKey(cc.parentId) === self.id && !cc.archived,
  );
  if (activeChild) {
    throw new Error(
      `Arquive antes os filhos de ${self.name} (${activeChild.name} está ativo).`,
    );
  }

  const { recurrences } = await referencesTo(companyId, self.id);
  if (recurrences.length > 0) {
    throw new Error(
      `${self.name} tem recorrências ativas: ${recurrences.join(", ")}. ` +
        "Aponte-as para outro centro de custo antes de arquivar.",
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
    const all = await companyCostCenters(companyId);
    const parentId = parentKey(data.parentId);

    if (!parentId) assertSingleRoot(all);
    else await assertCanBeParent(companyId, all, parentId);

    return addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...data,
        archived: false,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  },

  update: async (id: string, data: CostCenterFormData) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const current = await getDoc(docRef);
    const companyId = current.data()?.companyId as string | undefined;
    if (!companyId) throw new Error("Centro de custo não encontrado.");

    const all = await companyCostCenters(companyId);
    const self = all.find((cc) => cc.id === id)!;

    const from = parentKey(self.parentId);
    const to = parentKey(data.parentId);
    if (to !== from) {
      // Promover um centro a raiz vale a mesma checagem que criar um: o
      // caminho é diferente, o estrago é o mesmo.
      if (!to) assertSingleRoot(all, id);
      else {
        await assertCanMove(companyId, all, id, to);
        await assertCanBeParent(companyId, all, to);
      }
    }

    if (data.archived && !self.archived) {
      await assertCanArchive(companyId, all, self);
    }
    if (data.archived === false && self.archived) {
      const parent = all.find((cc) => cc.id === to);
      if (parent?.archived) {
        throw new Error(`Desarquive antes o centro pai, ${parent.name}.`);
      }
    }

    return updateDoc(
      docRef,
      stripUndefined({
        ...data,
        updatedAt: serverTimestamp(),
      }),
    );
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
    const current = await getDoc(docRef);
    const companyId = current.data()?.companyId as string | undefined;
    if (!companyId) throw new Error("Centro de custo não encontrado.");

    // Transação apontando para um centro inexistente fica travada (o callable
    // recusa "centro não encontrado"), e o envelope entregue a ele fica preso
    // no `allocatedToChildren` do pai. Arquivar resolve sem nenhum dos dois.
    const refs = await referencesTo(companyId, id);
    const reasons = [
      refs.transactions && "transações lançadas",
      refs.ledger && "envelope ou gasto registrado no razão",
      refs.recurrences.length > 0 &&
        `recorrências ativas (${refs.recurrences.join(", ")})`,
    ].filter(Boolean);
    if (reasons.length > 0) {
      throw new Error(
        `Não é possível excluir: este centro de custo tem ${reasons.join(", ")}. ` +
          "Arquive-o em vez de excluir — ele sai dos formulários e o histórico " +
          "continua íntegro.",
      );
    }

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
