/**
 * Fase 2 — bloqueio duro de saldo nas despesas.
 *
 * O desenho tem duas peças que se complementam:
 *
 *   • `syncCostCenterLedger` (trigger) mantém o razão a partir do delta entre
 *     o antes e o depois de QUALQUER escrita em `transactions`. Cobre também
 *     os caminhos ainda não convertidos — conciliação, importação, recorrências
 *     — para que o razão nunca fique defasado durante a migração por etapas.
 *
 *   • `createPayableTransaction` (callable) valida o saldo e grava a despesa e
 *     o razão na mesma transação atômica. É o que fecha a corrida entre duas
 *     pessoas lançando ao mesmo tempo, coisa que um trigger jamais poderia
 *     fazer: ele roda depois da escrita, quando o estouro já aconteceu.
 *
 * Para o trigger não contar duas vezes o que o callable já aplicou, a despesa
 * criada pelo callable nasce com `ledgerApplied: true` e o trigger ignora a
 * criação desses documentos. Alterações posteriores seguem passando pelo delta
 * normalmente, venham de onde vierem.
 */
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import {
  formatBRL,
  indexHierarchy,
  ledgerDocId,
  LEDGER,
  readCarryIn,
  toCents,
  toReais,
} from "./costCenterLedger";

const db = () => admin.firestore();

/** Rejeitadas não reservam recurso; todo o resto sim, inclusive rascunho. */
const CONSUMES_BUDGET = (status?: string) => status !== "rejected";

interface Allocation {
  costCenterId: string;
  amount: number;
}

interface TxShape {
  companyId?: string;
  type?: string;
  status?: string;
  amount?: number;
  finalAmount?: number;
  dueDate?: unknown;
  paymentDate?: unknown;
  costCenterId?: string;
  costCenterAllocation?: Allocation[];
  ledgerApplied?: boolean;
}

/**
 * Datas chegam como Timestamp quando vêm do trigger e como string ISO quando
 * vêm do callable, que trafega JSON. Normaliza os dois.
 */
function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof (v as admin.firestore.Timestamp).toDate === "function") {
    return (v as admin.firestore.Timestamp).toDate();
  }
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  const seconds = (v as { _seconds?: number })._seconds;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/** Exercício ao qual a transação pertence: pagamento se paga, senão vencimento. */
function effectiveYear(tx: TxShape): number | null {
  const raw =
    tx.status === "paid" && tx.paymentDate ? tx.paymentDate : tx.dueDate;
  return asDate(raw)?.getFullYear() ?? null;
}

/** Normaliza alocação multi-CC e o campo legado `costCenterId`. */
function allocationsOf(tx: TxShape): Array<{ id: string; cents: number }> {
  const list = Array.isArray(tx.costCenterAllocation)
    ? tx.costCenterAllocation
    : [];
  if (list.length > 0) {
    return list
      .filter((a) => a?.costCenterId)
      .map((a) => ({ id: a.costCenterId, cents: toCents(a.amount) }));
  }
  if (tx.costCenterId) {
    return [
      { id: tx.costCenterId, cents: toCents(tx.finalAmount ?? tx.amount) },
    ];
  }
  return [];
}

/**
 * Efeito de uma transação no razão: quanto cada centro consome, em que ano.
 * Um mapa vazio significa que ela não toca orçamento nenhum.
 */
function ledgerEffect(
  tx: TxShape | null,
): Map<string, { spent: number; paid: number; year: number }> {
  const effect = new Map<
    string,
    { spent: number; paid: number; year: number }
  >();
  if (!tx || tx.type !== "payable" || !CONSUMES_BUDGET(tx.status))
    return effect;

  const year = effectiveYear(tx);
  if (year === null) return effect;

  const isPaid = tx.status === "paid";
  for (const alloc of allocationsOf(tx)) {
    const prev = effect.get(alloc.id);
    effect.set(alloc.id, {
      spent: (prev?.spent || 0) + alloc.cents,
      paid: (prev?.paid || 0) + (isPaid ? alloc.cents : 0),
      year,
    });
  }
  return effect;
}

/** Ancestrais de um centro de custo, do pai imediato até o raiz. */
function ancestorsOf(
  id: string,
  parentIdOf: (id: string) => string | null,
): string[] {
  const chain: string[] = [];
  const seen = new Set([id]);
  let cur = parentIdOf(id);
  while (cur && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = parentIdOf(cur);
  }
  return chain;
}

/**
 * Aplica um delta ao razão: `spentDirect` na folha e `subtreeSpent` em toda a
 * cadeia até o raiz. Sem varrer a árvore, porque cada ancestral carrega o
 * agregado da própria subárvore.
 */
async function applyDeltas(
  companyId: string,
  deltas: Array<{
    costCenterId: string;
    year: number;
    spent: number;
    paid: number;
  }>,
) {
  if (deltas.length === 0) return;

  const ccSnap = await db()
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
    id: string;
    parentId?: string;
  }>;

  let hierarchy;
  try {
    hierarchy = indexHierarchy(ccs);
  } catch (err) {
    console.error("Hierarquia inválida; razão não atualizado.", err);
    return;
  }
  const { parentIdOf, rootId } = hierarchy;

  // Consolida por (centro, ano) antes de escrever, para que uma transação com
  // várias alocações no mesmo ramo produza uma escrita só por documento.
  const writes = new Map<
    string,
    {
      costCenterId: string;
      year: number;
      direct: [number, number];
      subtree: [number, number];
    }
  >();

  const bump = (
    costCenterId: string,
    year: number,
    direct: [number, number],
    subtree: [number, number],
  ) => {
    const key = `${costCenterId}_${year}`;
    const cur = writes.get(key) || {
      costCenterId,
      year,
      direct: [0, 0] as [number, number],
      subtree: [0, 0] as [number, number],
    };
    cur.direct[0] += direct[0];
    cur.direct[1] += direct[1];
    cur.subtree[0] += subtree[0];
    cur.subtree[1] += subtree[1];
    writes.set(key, cur);
  };

  for (const d of deltas) {
    bump(d.costCenterId, d.year, [d.spent, d.paid], [d.spent, d.paid]);
    for (const ancestor of ancestorsOf(d.costCenterId, parentIdOf)) {
      bump(ancestor, d.year, [0, 0], [d.spent, d.paid]);
    }
  }

  const batch = db().batch();
  for (const w of writes.values()) {
    const ref = db()
      .collection(LEDGER)
      .doc(ledgerDocId(companyId, w.costCenterId, w.year));
    batch.set(
      ref,
      {
        companyId,
        costCenterId: w.costCenterId,
        year: w.year,
        parentId: parentIdOf(w.costCenterId),
        isRoot: w.costCenterId === rootId,
        spentDirect: admin.firestore.FieldValue.increment(toReais(w.direct[0])),
        spentDirectPaid: admin.firestore.FieldValue.increment(
          toReais(w.direct[1]),
        ),
        subtreeSpent: admin.firestore.FieldValue.increment(
          toReais(w.subtree[0]),
        ),
        subtreeSpentPaid: admin.firestore.FieldValue.increment(
          toReais(w.subtree[1]),
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
}

/**
 * Mantém o razão sincronizado com qualquer escrita em `transactions`.
 *
 * Trabalha por delta (antes → depois), então cobre criação, edição de valor,
 * mudança de status, troca de centro de custo e exclusão sem lógica especial
 * para cada caso.
 */
export const syncCostCenterLedger = functions.firestore
  .document("transactions/{transactionId}")
  .onWrite(async (change) => {
    const before = (
      change.before.exists ? change.before.data() : null
    ) as TxShape | null;
    const after = (
      change.after.exists ? change.after.data() : null
    ) as TxShape | null;

    const companyId = after?.companyId || before?.companyId;
    if (!companyId) return null;

    // O callable já gravou razão e transação atomicamente; contar de novo aqui
    // dobraria o consumo.
    if (!before && after?.ledgerApplied) return null;

    const prev = ledgerEffect(before);
    const next = ledgerEffect(after);

    const touched = new Set([...prev.keys(), ...next.keys()]);
    const deltas: Array<{
      costCenterId: string;
      year: number;
      spent: number;
      paid: number;
    }> = [];

    for (const ccId of touched) {
      const a = prev.get(ccId);
      const b = next.get(ccId);

      // Ano diferente entre antes e depois: estorna num exercício, lança noutro.
      if (a && b && a.year !== b.year) {
        deltas.push({
          costCenterId: ccId,
          year: a.year,
          spent: -a.spent,
          paid: -a.paid,
        });
        deltas.push({
          costCenterId: ccId,
          year: b.year,
          spent: b.spent,
          paid: b.paid,
        });
        continue;
      }

      const year = b?.year ?? a?.year;
      if (year === undefined) continue;
      const spent = (b?.spent || 0) - (a?.spent || 0);
      const paid = (b?.paid || 0) - (a?.paid || 0);
      if (spent === 0 && paid === 0) continue;
      deltas.push({ costCenterId: ccId, year, spent, paid });
    }

    if (deltas.length === 0) return null;

    try {
      await applyDeltas(companyId, deltas);
    } catch (err) {
      console.error("Falha ao sincronizar cost_center_ledger:", err);
    }
    return null;
  });

/**
 * Cria uma despesa validando o saldo na mesma transação atômica em que grava.
 *
 * As regras impostas aqui, todas do modelo de envelope:
 *   • despesa só em centro de custo folha;
 *   • a folha precisa ter disponível suficiente;
 *   • nenhum ancestral pode estar negativo — se a receita prevista não entrou,
 *     a árvore trava até o gestor realocar.
 */
export const createPayableTransaction = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { companyId, transaction } = data as {
      companyId?: string;
      transaction?: Record<string, unknown>;
    };

    if (!companyId || !transaction) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "companyId e transaction são obrigatórios.",
      );
    }

    const tx = transaction as TxShape;
    if (tx.type !== "payable") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Esta função valida apenas despesas.",
      );
    }

    const year = effectiveYear(tx);
    if (year === null) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A despesa precisa de data de vencimento.",
      );
    }

    const allocations = allocationsOf(tx);
    if (allocations.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Toda despesa precisa de ao menos um centro de custo.",
      );
    }

    const ccSnap = await db()
      .collection("cost_centers")
      .where("companyId", "==", companyId)
      .get();
    const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      name?: string;
      parentId?: string;
    }>;
    const { byId, parentIdOf, rootId } = indexHierarchy(ccs);

    const hasChildren = new Set(
      ccs.map((c) => parentIdOf(c.id)).filter(Boolean) as string[],
    );

    // Consolida alocações repetidas no mesmo centro antes de validar.
    const perCc = new Map<string, number>();
    for (const alloc of allocations) {
      if (!byId.has(alloc.id)) {
        throw new functions.https.HttpsError(
          "not-found",
          "Centro de custo não encontrado nesta empresa.",
        );
      }
      if (hasChildren.has(alloc.id)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `${byId.get(alloc.id)?.name || "O centro de custo"} possui filhos. ` +
            "Despesas só podem ser lançadas em centros de custo de último grau.",
        );
      }
      perCc.set(alloc.id, (perCc.get(alloc.id) || 0) + alloc.cents);
    }

    const txRef = db().collection("transactions").doc();

    await db().runTransaction(async (trx) => {
      // Cadeia completa que a despesa afeta: cada folha e todos os ancestrais.
      const chain = new Map<string, string[]>();
      const needed = new Set<string>();
      for (const ccId of perCc.keys()) {
        const ancestors = ancestorsOf(ccId, parentIdOf);
        chain.set(ccId, ancestors);
        needed.add(ccId);
        ancestors.forEach((a) => needed.add(a));
      }

      const ids = [...needed];
      const carryIn = await readCarryIn(trx, companyId, rootId, year);
      const snaps = await trx.getAll(
        ...ids.map((id) =>
          db()
            .collection(LEDGER)
            .doc(ledgerDocId(companyId, id, year)),
        ),
      );

      const ledgers = new Map<string, Record<string, unknown>>();
      ids.forEach((id, i) => {
        const snap = snaps[i];
        ledgers.set(
          id,
          snap.exists ? (snap.data() as Record<string, unknown>) : {},
        );
      });

      const availableOf = (id: string) => {
        const l = ledgers.get(id) || {};
        return (
          toCents(l.received) +
          (id === rootId ? carryIn : 0) -
          toCents(l.allocatedToChildren) -
          toCents(l.spentDirect)
        );
      };

      for (const [ccId, cents] of perCc) {
        const available = availableOf(ccId);
        if (cents > available) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Saldo insuficiente em ${byId.get(ccId)?.name || "centro de custo"}: ` +
              `disponível ${formatBRL(available)}, necessário ${formatBRL(cents)}.`,
          );
        }

        // Um ancestral negativo significa que o recurso prometido não existe.
        for (const ancestorId of chain.get(ccId) || []) {
          if (availableOf(ancestorId) < 0) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              `${byId.get(ancestorId)?.name || "Um centro de custo superior"} está ` +
                "com saldo negativo. Regularize a distribuição antes de lançar novas despesas.",
            );
          }
        }
      }

      const isPaid = tx.status === "paid";
      const costCenterIds = [...perCc.keys()];

      // Datas voltam a ser Timestamp: o resto do sistema lê `.toDate()`.
      const dueDate = asDate(tx.dueDate);
      const paymentDate = asDate(tx.paymentDate);

      trx.set(txRef, {
        ...transaction,
        companyId,
        costCenterIds,
        costCenterId: costCenterIds[0],
        createdBy: context.auth!.uid,
        batchId: null,
        ledgerApplied: true,
        ...(dueDate
          ? { dueDate: admin.firestore.Timestamp.fromDate(dueDate) }
          : {}),
        ...(paymentDate
          ? { paymentDate: admin.firestore.Timestamp.fromDate(paymentDate) }
          : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      for (const [ccId, cents] of perCc) {
        const targets: Array<[string, boolean]> = [
          [ccId, true],
          ...(chain.get(ccId) || []).map(
            (a) => [a, false] as [string, boolean],
          ),
        ];
        for (const [id, isLeaf] of targets) {
          trx.set(
            db()
              .collection(LEDGER)
              .doc(ledgerDocId(companyId, id, year)),
            {
              companyId,
              costCenterId: id,
              year,
              parentId: parentIdOf(id),
              isRoot: id === rootId,
              ...(isLeaf
                ? {
                    spentDirect: admin.firestore.FieldValue.increment(
                      toReais(cents),
                    ),
                    spentDirectPaid: admin.firestore.FieldValue.increment(
                      isPaid ? toReais(cents) : 0,
                    ),
                  }
                : {}),
              subtreeSpent: admin.firestore.FieldValue.increment(
                toReais(cents),
              ),
              subtreeSpentPaid: admin.firestore.FieldValue.increment(
                isPaid ? toReais(cents) : 0,
              ),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
    });

    return { success: true, id: txRef.id };
  },
);
