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
export async function assertCanManageBudget(
  uid: string,
  companyId: string,
  message = "Apenas administradores e gestores financeiros podem alocar recursos.",
) {
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
    throw new functions.https.HttpsError("permission-denied", message);
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

/** Hierarquia de uma empresa, lida fora de transação: não muda na operação. */
async function loadHierarchy(companyId: string) {
  const ccSnap = await db()
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  const ccs = ccSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as CostCenterDoc[];
  return indexHierarchy(ccs);
}

type Hierarchy = ReturnType<typeof indexHierarchy>;

interface EnvelopeResult {
  changed: boolean;
  previous: number;
  next: number;
  parentId: string;
  parentAvailableAfter?: number;
}

/** Teto de envelopes por lote: 2 documentos cada, longe das 500 escritas. */
const MAX_ENVELOPES_PER_BATCH = 200;

/**
 * Núcleo do envelope: lê todos os centros envolvidos e seus pais numa leitura
 * só, aplica as mudanças em memória, valida o estado final e grava tudo. Faz
 * só leituras antes das escritas, então quem chama pode ler os próprios
 * documentos antes e gravar depois na mesma transação.
 *
 * O lote é validado pelo resultado, não passo a passo: tirar R$ 10 mil de A e
 * dar a B, irmãos, é válido em conjunto mesmo que o pai não tenha folga para
 * B sozinho. Cada nó tocado precisa terminar com disponível ≥ 0, ou ao menos
 * não piorar (um nó que já estava negativo pode ser corrigido aos poucos).
 *
 * `nextEnvelope` recebe o envelope atual em centavos: definir um valor e
 * somar a ele (suplementação) passam pelo mesmo caminho.
 */
async function applyEnvelopesInTx(
  tx: admin.firestore.Transaction,
  h: Hierarchy,
  companyId: string,
  year: number,
  changes: Array<{
    costCenterId: string;
    nextEnvelope: (previousCents: number) => number;
  }>,
): Promise<EnvelopeResult[]> {
  const { byId, parentIdOf, rootId } = h;

  const parentOf = new Map<string, string>();
  for (const { costCenterId } of changes) {
    if (parentOf.has(costCenterId)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "O mesmo centro de custo aparece duas vezes no lote.",
      );
    }
    if (!byId.has(costCenterId)) {
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
    parentOf.set(costCenterId, parentId);
  }

  const touched = [
    ...new Set(
      changes.flatMap((c) => [c.costCenterId, parentOf.get(c.costCenterId)!]),
    ),
  ];
  const refOf = (id: string) =>
    db()
      .collection(LEDGER_COLLECTION)
      .doc(ledgerDocId(companyId, id, year));

  // Todas as leituras antes de qualquer escrita.
  const carryIn = touched.includes(rootId)
    ? await readCarryIn(tx, companyId, rootId, year)
    : 0;
  const snaps = await tx.getAll(...touched.map(refOf));

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

  const docs = new Map<string, Record<string, unknown>>();
  const state = new Map<
    string,
    { received: number; allocated: number; spent: number }
  >();
  touched.forEach((id, i) => {
    const data = snaps[i].exists
      ? (snaps[i].data() as Record<string, unknown>)
      : (blank(id) as unknown as Record<string, unknown>);
    docs.set(id, data);
    state.set(id, {
      received: toCents(data.received),
      allocated: toCents(data.allocatedToChildren),
      spent: toCents(data.spentDirect),
    });
  });

  const availableOf = (id: string) => {
    const s = state.get(id)!;
    return s.received + (id === rootId ? carryIn : 0) - s.allocated - s.spent;
  };
  const before = new Map(touched.map((id) => [id, availableOf(id)]));

  const results: EnvelopeResult[] = [];
  for (const { costCenterId, nextEnvelope } of changes) {
    const parentId = parentOf.get(costCenterId)!;
    const child = state.get(costCenterId)!;
    const previous = child.received;
    const next = nextEnvelope(previous);
    if (!Number.isFinite(next) || next < 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "O envelope não pode ser negativo.",
      );
    }
    child.received = next;
    state.get(parentId)!.allocated += next - previous;
    results.push({
      changed: next !== previous,
      previous: toReais(previous),
      next: toReais(next),
      parentId,
    });
  }

  const ownEnvelopeChanged = new Set(
    changes.filter((_, i) => results[i].changed).map((c) => c.costCenterId),
  );
  for (const id of touched) {
    const after = availableOf(id);
    const was = before.get(id)!;
    if (after >= 0 || after >= was) continue;

    const name = byId.get(id)?.name || "Centro de custo";
    const s = state.get(id)!;
    // O filho não pode devolver recurso que já comprometeu.
    if (ownEnvelopeChanged.has(id) && s.received < s.allocated + s.spent) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `${name} já comprometeu ${formatBRL(s.allocated + s.spent)}; ` +
          `o envelope não pode ficar abaixo disso.`,
      );
    }
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Saldo insuficiente em ${name}: disponível ${formatBRL(was)}, ` +
        `necessário ${formatBRL(was - after)}.`,
    );
  }

  for (const id of touched) {
    const s = state.get(id)!;
    const data = docs.get(id)!;
    if (
      s.received === toCents(data.received) &&
      s.allocated === toCents(data.allocatedToChildren)
    ) {
      continue;
    }
    tx.set(
      refOf(id),
      {
        ...data,
        received: toReais(s.received),
        allocatedToChildren: toReais(s.allocated),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return results.map((r) => ({
    ...r,
    parentAvailableAfter: r.changed
      ? toReais(availableOf(r.parentId))
      : undefined,
  }));
}

async function auditEnvelope(
  auth: NonNullable<functions.https.CallableContext["auth"]>,
  h: Hierarchy,
  companyId: string,
  costCenterId: string,
  year: number,
  result: EnvelopeResult,
  extra: Record<string, unknown> = {},
) {
  const target = h.byId.get(costCenterId);
  await db()
    .collection("audit_logs")
    .add({
      companyId,
      userId: auth.uid,
      userEmail: auth.token.email || "",
      action: "update",
      entity: "budget",
      entityId: ledgerDocId(companyId, costCenterId, year),
      details: {
        costCenterId,
        costCenterName: target?.name || null,
        costCenterCode: target?.code || null,
        year,
        previousAmount: result.previous,
        newAmount: result.next,
        parentId: result.parentId,
        ...extra,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
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

    const h = await loadHierarchy(companyId);
    const [result] = await db().runTransaction((tx) =>
      applyEnvelopesInTx(tx, h, companyId, year, [
        { costCenterId, nextEnvelope: () => toCents(amount) },
      ]),
    );

    if (result.changed) {
      await auditEnvelope(
        context.auth,
        h,
        companyId,
        costCenterId,
        year,
        result,
      );
    }

    return {
      success: true,
      changed: result.changed,
      previous: result.previous,
      parentAvailableAfter: result.parentAvailableAfter,
    };
  },
);

/**
 * Aplica uma distribuição inteira num commit só: ou todos os envelopes mudam,
 * ou nenhum. Gravar um a um deixava a árvore pela metade quando o terceiro de
 * cinco falhava, e o gestor tinha de reconciliar à mão o que já tinha descido.
 */
export const setCostCenterEnvelopes = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }
    const auth = context.auth;

    const { companyId, year, changes } = data as {
      companyId?: string;
      year?: number;
      changes?: Array<{ costCenterId?: string; amount?: number }>;
    };

    if (
      !companyId ||
      !year ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "companyId, year e changes são obrigatórios.",
      );
    }
    if (changes.length > MAX_ENVELOPES_PER_BATCH) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `No máximo ${MAX_ENVELOPES_PER_BATCH} envelopes por vez.`,
      );
    }
    for (const c of changes) {
      if (
        !c?.costCenterId ||
        typeof c.amount !== "number" ||
        !Number.isFinite(c.amount) ||
        c.amount < 0
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Cada envelope precisa de centro de custo e valor não negativo.",
        );
      }
    }

    await assertCanManageBudget(auth.uid, companyId);

    const h = await loadHierarchy(companyId);
    const results = await db().runTransaction((tx) =>
      applyEnvelopesInTx(
        tx,
        h,
        companyId,
        year,
        changes.map((c) => ({
          costCenterId: c.costCenterId!,
          nextEnvelope: () => toCents(c.amount),
        })),
      ),
    );

    await Promise.all(
      results.map((result, i) =>
        result.changed
          ? auditEnvelope(
              auth,
              h,
              companyId,
              changes[i].costCenterId!,
              year,
              result,
            )
          : null,
      ),
    );

    return {
      success: true,
      changed: results.filter((r) => r.changed).length,
    };
  },
);

/**
 * Decide um pedido de suplementação. Aprovar soma o valor pedido ao envelope
 * do centro, tirando do pai, no mesmo commit que fecha o pedido: não há como
 * o pedido ficar aprovado sem o recurso ter descido, nem o contrário. Se o pai
 * não tem folga, a aprovação é recusada com a mesma mensagem da distribuição.
 */
export const decideBudgetRequest = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }
    const auth = context.auth;

    const { requestId, approve, note } = data as {
      requestId?: string;
      approve?: boolean;
      note?: string;
    };
    if (!requestId || typeof approve !== "boolean") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "requestId e approve são obrigatórios.",
      );
    }
    const decisionNote = note?.trim() || null;
    if (!approve && !decisionNote) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Informe o motivo da recusa.",
      );
    }

    const requestRef = db().collection("budget_requests").doc(requestId);
    const initial = await requestRef.get();
    if (!initial.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Pedido não encontrado.",
      );
    }
    const req = initial.data() as {
      companyId: string;
      costCenterId: string;
      year: number;
      amount: number;
      requestedBy: string;
    };

    await assertCanManageBudget(
      auth.uid,
      req.companyId,
      "Apenas administradores e gestores financeiros decidem pedidos de suplementação.",
    );

    const h = await loadHierarchy(req.companyId);
    const deciderName = (auth.token.name as string) || auth.token.email || "";

    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (snap.get("status") !== "pending") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Este pedido já foi decidido.",
        );
      }

      const envelope = approve
        ? (
            await applyEnvelopesInTx(tx, h, req.companyId, req.year, [
              {
                costCenterId: req.costCenterId,
                nextEnvelope: (previous) => previous + toCents(req.amount),
              },
            ])
          )[0]
        : null;

      tx.update(requestRef, {
        status: approve ? "approved" : "rejected",
        decidedBy: auth.uid,
        decidedByName: deciderName,
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        decisionNote,
      });
      return envelope;
    });

    if (result?.changed) {
      await auditEnvelope(
        auth,
        h,
        req.companyId,
        req.costCenterId,
        req.year,
        result,
        { budgetRequestId: requestId },
      );
    }

    const ccName = h.byId.get(req.costCenterId)?.name || "centro de custo";
    try {
      await db()
        .collection("notifications")
        .add({
          userId: req.requestedBy,
          companyId: req.companyId,
          title: approve ? "Suplementação aprovada" : "Suplementação recusada",
          message: approve
            ? `${formatBRL(toCents(req.amount))} a mais no envelope de ${ccName}.`
            : `O pedido para ${ccName} foi recusado: ${decisionNote}`,
          type: approve ? "success" : "warning",
          link: `/centros-custo/${req.costCenterId}`,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
      // O aviso não pode desfazer a decisão já gravada.
      console.error("Falha ao notificar decisão de suplementação:", err);
    }

    return { success: true };
  },
);
