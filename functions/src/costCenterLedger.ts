/**
 * Orçamento por envelope — mutação do `cost_center_ledger`.
 *
 * A coleção é somente-leitura para clientes (ver firestore.rules). Toda
 * mutação passa por aqui, porque a invariante do envelope — a soma dos
 * envelopes dos filhos nunca ultrapassar o disponível do pai — não é
 * expressável em regras do Firestore, que não somam agregados.
 */
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const LEDGER_COLLECTION = "cost_center_ledger";

/** Quantos exercícios anteriores o carry-over percorre. */
const MAX_CARRY_LOOKBACK = 10;

// `admin.initializeApp()` roda no index; resolver o Firestore preguiçosamente
// evita depender da ordem de importação dos módulos.
const db = () => admin.firestore();

export const ledgerDocId = (
  companyId: string,
  costCenterId: string,
  year: number,
) => `${companyId}_${costCenterId}_${year}`;

// Valores circulam em reais mas são calculados em centavos, para que somas e
// comparações não sofram com ponto flutuante.
export const toCents = (v: unknown) => Math.round(Number(v || 0) * 100);
export const toReais = (c: number) => Math.round(c) / 100;
export const formatBRL = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const LEDGER = LEDGER_COLLECTION;

export interface LedgerDoc {
  companyId: string;
  costCenterId: string;
  year: number;
  parentId: string | null;
  isRoot: boolean;
  received: number;
  allocatedToChildren: number;
  spentDirect: number;
  spentDirectPaid: number;
  subtreeSpent: number;
  subtreeSpentPaid: number;
}

interface CostCenterDoc {
  id: string;
  name?: string;
  code?: string;
  parentId?: string;
}

/** Admin global, ou admin/gestor financeiro na empresa em questão. */
async function assertCanManageBudget(uid: string, companyId: string) {
  const userSnap = await db().collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Usuário não encontrado.",
    );
  }
  const user = userSnap.data() as {
    role?: string;
    companyRoles?: Record<string, string>;
  };
  const companyRole = user.companyRoles?.[companyId];
  const allowed =
    user.role === "admin" ||
    companyRole === "admin" ||
    companyRole === "financial_manager";

  if (!allowed) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Apenas administradores e gestores financeiros podem alocar recursos.",
    );
  }
}

/** Índice da hierarquia, com validação de raiz única. */
export function indexHierarchy(costCenters: CostCenterDoc[]) {
  const byId = new Map(costCenters.map((c) => [c.id, c]));

  const parentIdOf = (id: string) => {
    const cc = byId.get(id);
    return cc?.parentId && cc.parentId !== "none" && byId.has(cc.parentId)
      ? cc.parentId
      : null;
  };

  const roots = costCenters.filter((c) => !parentIdOf(c.id));
  if (roots.length !== 1) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Hierarquia inválida: esperado 1 centro de custo raiz, encontrado ${roots.length}.`,
    );
  }

  return { byId, parentIdOf, rootId: roots[0].id };
}

/**
 * Sobra consolidada dos exercícios anteriores, lida dentro da transação.
 *
 * Alocações internas são transferência, não consumo — por isso a sobra da
 * árvore inteira sai de `received − subtreeSpent` no raiz, sem varrer filhos.
 */
export async function readCarryIn(
  tx: admin.firestore.Transaction,
  companyId: string,
  rootId: string,
  year: number,
): Promise<number> {
  const refs = [];
  for (let y = year - MAX_CARRY_LOOKBACK; y < year; y++) {
    refs.push(
      db()
        .collection(LEDGER_COLLECTION)
        .doc(ledgerDocId(companyId, rootId, y)),
    );
  }
  const snaps = await tx.getAll(...refs);

  let carry = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const d = snap.data() as Record<string, unknown>;
    carry = toCents(d.received) + carry - toCents(d.subtreeSpent);
  }
  return carry;
}

/**
 * Define o envelope anual de um centro de custo, movendo recurso do pai.
 *
 * Transacional porque duas alocações simultâneas sobre o mesmo pai poderiam,
 * cada uma válida isoladamente, somar mais do que ele tem.
 */
export const setCostCenterEnvelope = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { companyId, costCenterId, year, amount } = data as {
      companyId?: string;
      costCenterId?: string;
      year?: number;
      amount?: number;
    };

    if (!companyId || !costCenterId || !year || amount === undefined) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "companyId, costCenterId, year e amount são obrigatórios.",
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "O envelope não pode ser negativo.",
      );
    }

    await assertCanManageBudget(context.auth.uid, companyId);

    // Hierarquia lida fora da transação: não muda durante a operação.
    const ccSnap = await db()
      .collection("cost_centers")
      .where("companyId", "==", companyId)
      .get();
    const ccs = ccSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as CostCenterDoc[];

    const { byId, parentIdOf, rootId } = indexHierarchy(ccs);

    const target = byId.get(costCenterId);
    if (!target) {
      throw new functions.https.HttpsError(
        "not-found",
        "Centro de custo não encontrado nesta empresa.",
      );
    }

    const parentId = parentIdOf(costCenterId);
    if (!parentId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "O centro de custo raiz é financiado pelas receitas, não por alocação.",
      );
    }

    const newEnvelope = toCents(amount);
    const parentRef = db()
      .collection(LEDGER_COLLECTION)
      .doc(ledgerDocId(companyId, parentId, year));
    const childRef = db()
      .collection(LEDGER_COLLECTION)
      .doc(ledgerDocId(companyId, costCenterId, year));

    const result = await db().runTransaction(async (tx) => {
      // Todas as leituras antes de qualquer escrita.
      const carryIn =
        parentId === rootId
          ? await readCarryIn(tx, companyId, rootId, year)
          : 0;
      const [parentSnap, childSnap] = await tx.getAll(parentRef, childRef);

      const blank = (id: string): LedgerDoc => ({
        companyId,
        costCenterId: id,
        year,
        parentId: parentIdOf(id),
        isRoot: id === rootId,
        received: 0,
        allocatedToChildren: 0,
        spentDirect: 0,
        spentDirectPaid: 0,
        subtreeSpent: 0,
        subtreeSpentPaid: 0,
      });

      const parent = parentSnap.exists
        ? (parentSnap.data() as Record<string, unknown>)
        : (blank(parentId) as unknown as Record<string, unknown>);
      const child = childSnap.exists
        ? (childSnap.data() as Record<string, unknown>)
        : (blank(costCenterId) as unknown as Record<string, unknown>);

      const previous = toCents(child.received);
      const delta = newEnvelope - previous;
      if (delta === 0) {
        return { changed: false, previous: toReais(previous) };
      }

      // O pai precisa ter folga para o aumento.
      const parentAvailable =
        toCents(parent.received) +
        carryIn -
        toCents(parent.allocatedToChildren) -
        toCents(parent.spentDirect);

      if (delta > parentAvailable) {
        const parentName = byId.get(parentId)?.name || "centro de custo pai";
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Saldo insuficiente em ${parentName}: disponível ${formatBRL(parentAvailable)}, ` +
            `necessário ${formatBRL(delta)}.`,
        );
      }

      // O filho não pode devolver recurso que já comprometeu.
      const childCommitted =
        toCents(child.allocatedToChildren) + toCents(child.spentDirect);
      if (newEnvelope < childCommitted) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `${target.name || "Centro de custo"} já comprometeu ${formatBRL(childCommitted)}; ` +
            `o envelope não pode ficar abaixo disso.`,
        );
      }

      tx.set(
        parentRef,
        {
          ...parent,
          allocatedToChildren: toReais(
            toCents(parent.allocatedToChildren) + delta,
          ),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        childRef,
        {
          ...child,
          received: toReais(newEnvelope),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        changed: true,
        previous: toReais(previous),
        parentAvailableAfter: toReais(parentAvailable - delta),
      };
    });

    if (result.changed) {
      await db()
        .collection("audit_logs")
        .add({
          companyId,
          userId: context.auth.uid,
          userEmail: context.auth.token.email || "",
          action: "update",
          entity: "budget",
          entityId: ledgerDocId(companyId, costCenterId, year),
          details: {
            costCenterId,
            costCenterName: target.name || null,
            costCenterCode: target.code || null,
            year,
            previousAmount: result.previous,
            newAmount: toReais(newEnvelope),
            parentId,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    return { success: true, ...result };
  },
);
