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
import { randomUUID } from "crypto";
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
  ledgerAppliedAt?: admin.firestore.Timestamp;
}

/**
 * A escrita veio de um callable que já ajustou o razão na mesma operação?
 *
 * O carimbo muda a cada gravação validada, então serve tanto para a criação
 * quanto para a edição — a flag booleana sozinha só distinguia a criação, e
 * deixava a edição contar em dobro.
 */
function alreadyApplied(before: TxShape | null, after: TxShape | null) {
  const stamp = after?.ledgerAppliedAt;
  if (!stamp) return false;
  const previous = before?.ledgerAppliedAt;
  return !previous || !previous.isEqual(stamp);
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
 * Quanto uma receita credita no razão, e em qual exercício.
 *
 * Toda receita credita o centro de custo **raiz**, seja qual for o centro que a
 * alocação nomeie: no modelo de envelope o recurso entra por cima e desce por
 * distribuição explícita. Rejeitada não credita, pelo mesmo motivo que despesa
 * rejeitada não consome.
 *
 * O total segue a mesma conta do `verify:ledger`: a soma da alocação quando ela
 * existe, e o valor da transação quando não — inclusive receita sem centro de
 * custo nenhum, que também é dinheiro que entrou.
 */
function revenueEffect(
  tx: TxShape | null,
): { year: number; cents: number } | null {
  if (!tx || tx.type !== "receivable" || !CONSUMES_BUDGET(tx.status)) {
    return null;
  }

  const year = effectiveYear(tx);
  if (year === null) return null;

  const fromAllocations = allocationsOf(tx).reduce((s, a) => s + a.cents, 0);
  const cents = fromAllocations || toCents(tx.finalAmount ?? tx.amount);
  return cents === 0 ? null : { year, cents };
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
 * Aplica um delta ao razão: `spentDirect` na folha, `subtreeSpent` em toda a
 * cadeia até o raiz, e `received` no raiz quando o delta é de receita. Sem
 * varrer a árvore, porque cada ancestral carrega o agregado da própria
 * subárvore.
 */
async function applyDeltas(
  companyId: string,
  deltas: LedgerDelta[],
  hierarchy: { parentIdOf: (id: string) => string | null; rootId: string },
) {
  if (deltas.length === 0) return;
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
      received: number;
    }
  >();

  const bump = (
    costCenterId: string,
    year: number,
    direct: [number, number],
    subtree: [number, number],
    received: number,
  ) => {
    const key = `${costCenterId}_${year}`;
    const cur = writes.get(key) || {
      costCenterId,
      year,
      direct: [0, 0] as [number, number],
      subtree: [0, 0] as [number, number],
      received: 0,
    };
    cur.direct[0] += direct[0];
    cur.direct[1] += direct[1];
    cur.subtree[0] += subtree[0];
    cur.subtree[1] += subtree[1];
    cur.received += received;
    writes.set(key, cur);
  };

  for (const d of deltas) {
    bump(d.ccId, d.year, [d.spent, d.paid], [d.spent, d.paid], d.received);
    // Receita só toca o raiz, que não tem ancestral; a cadeia é do gasto.
    if (d.spent !== 0 || d.paid !== 0) {
      for (const ancestor of ancestorsOf(d.ccId, parentIdOf)) {
        bump(ancestor, d.year, [0, 0], [d.spent, d.paid], 0);
      }
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
        received: admin.firestore.FieldValue.increment(toReais(w.received)),
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
 * para cada caso — e vale igualmente para o gasto da despesa e para o crédito
 * da receita no raiz.
 *
 * É o único caminho que mantém a receita: ela não passa por callable porque não
 * consome envelope, não tem o que ser recusado, e portanto não precisa da
 * atomicidade que o bloqueio de saldo exige.
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
    if (alreadyApplied(before, after)) return null;

    let index;
    try {
      index = await loadCcIndex(companyId);
    } catch (err) {
      console.error("Hierarquia inválida; razão não atualizado.", err);
      return null;
    }

    const deltas = deltasFor(before || {}, after || {}, index.rootId);
    if (deltas.length === 0) return null;

    try {
      await applyDeltas(companyId, deltas, index);
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
        // Carimbo que diz ao trigger que o razão desta escrita já foi ajustado.
        ledgerAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
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

/**
 * Verifica se uma despesa caberia no envelope, sem gravar nada.
 *
 * Serve às recorrências, que são geradas por um job noturno sem ninguém na
 * tela para ler uma recusa. Ali a despesa é criada de todo jeito — um aluguel
 * vencendo não deixa de existir por falta de orçamento — mas nasce marcada, e
 * o gestor é avisado. Por isso a leitura roda fora de transação: o resultado
 * informa, não bloqueia.
 */
export async function checkBudgetFit(
  companyId: string,
  tx: TxShape,
): Promise<{ fits: boolean; message: string | null }> {
  const effect = ledgerEffect(tx);
  if (effect.size === 0) return { fits: true, message: null };

  const ccSnap = await db()
    .collection("cost_centers")
    .where("companyId", "==", companyId)
    .get();
  const ccs = ccSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
    id: string;
    name?: string;
    parentId?: string;
  }>;

  let hierarchy;
  try {
    hierarchy = indexHierarchy(ccs);
  } catch {
    // Sem hierarquia válida não há como julgar; não é papel deste caminho
    // interromper a recorrência por isso.
    return { fits: true, message: null };
  }
  const { byId, rootId } = hierarchy;

  for (const [ccId, e] of effect) {
    const ledgerSnap = await db()
      .collection(LEDGER)
      .doc(ledgerDocId(companyId, ccId, e.year))
      .get();
    const l = ledgerSnap.exists
      ? (ledgerSnap.data() as Record<string, unknown>)
      : {};

    let carry = 0;
    if (ccId === rootId) {
      for (let y = e.year - 10; y < e.year; y++) {
        const prev = await db()
          .collection(LEDGER)
          .doc(ledgerDocId(companyId, rootId, y))
          .get();
        if (!prev.exists) continue;
        const p = prev.data() as Record<string, unknown>;
        carry = toCents(p.received) + carry - toCents(p.subtreeSpent);
      }
    }

    const available =
      toCents(l.received) +
      carry -
      toCents(l.allocatedToChildren) -
      toCents(l.spentDirect);

    if (e.spent > available) {
      return {
        fits: false,
        message:
          `${byId.get(ccId)?.name || "Centro de custo"}: disponível ` +
          `${formatBRL(available)}, necessário ${formatBRL(e.spent)}.`,
      };
    }
  }

  return { fits: true, message: null };
}

/**
 * Cria um parcelamento validando a soma, não cada parcela isolada.
 *
 * Doze parcelas de R$ 10 mil cabem uma a uma num envelope de R$ 15 mil, e
 * juntas não cabem. Como parcelas caem em exercícios diferentes, o total é
 * agrupado por (centro de custo, ano) antes de ser conferido — o que também
 * faz o parcelamento que atravessa a virada do ano ser validado contra o
 * orçamento certo de cada lado.
 */
export const createPayableInstallments = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { companyId, transactions } = data as {
      companyId?: string;
      transactions?: Array<Record<string, unknown>>;
    };

    if (
      !companyId ||
      !Array.isArray(transactions) ||
      transactions.length === 0
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "companyId e transactions são obrigatórios.",
      );
    }
    // O schema do formulário limita em 120 parcelas; o teto aqui protege o
    // limite de operações de uma transação do Firestore.
    if (transactions.length > 120) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Um parcelamento não pode ter mais de 120 parcelas.",
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

    // Soma o efeito de todas as parcelas por (centro, exercício).
    const totals = new Map<
      string,
      { ccId: string; year: number; spent: number; paid: number }
    >();

    for (const raw of transactions) {
      const tx = raw as TxShape;
      if (tx.type !== "payable") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Esta função valida apenas despesas.",
        );
      }
      const effect = ledgerEffect(tx);
      if (effect.size === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Toda parcela precisa de centro de custo e data de vencimento.",
        );
      }
      for (const [ccId, e] of effect) {
        if (!byId.has(ccId)) {
          throw new functions.https.HttpsError(
            "not-found",
            "Centro de custo não encontrado nesta empresa.",
          );
        }
        if (hasChildren.has(ccId)) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `${byId.get(ccId)?.name || "O centro de custo"} possui filhos. ` +
              "Despesas só podem ser lançadas em centros de custo de último grau.",
          );
        }
        const key = `${ccId}_${e.year}`;
        const cur = totals.get(key) || {
          ccId,
          year: e.year,
          spent: 0,
          paid: 0,
        };
        cur.spent += e.spent;
        cur.paid += e.paid;
        totals.set(key, cur);
      }
    }

    const grouped = [...totals.values()];
    const refs = transactions.map(() => db().collection("transactions").doc());

    await db().runTransaction(async (trx) => {
      const years = [...new Set(grouped.map((g) => g.year))];
      const carryByYear = new Map<number, number>();
      for (const y of years) {
        carryByYear.set(y, await readCarryIn(trx, companyId, rootId, y));
      }

      const chain = new Map<string, string[]>();
      const refKeys: Array<{ ccId: string; year: number }> = [];
      const seen = new Set<string>();
      for (const g of grouped) {
        const ancestors = ancestorsOf(g.ccId, parentIdOf);
        chain.set(g.ccId, ancestors);
        for (const id of [g.ccId, ...ancestors]) {
          const key = `${id}_${g.year}`;
          if (seen.has(key)) continue;
          seen.add(key);
          refKeys.push({ ccId: id, year: g.year });
        }
      }

      const snaps = await trx.getAll(
        ...refKeys.map((k) =>
          db()
            .collection(LEDGER)
            .doc(ledgerDocId(companyId, k.ccId, k.year)),
        ),
      );
      const ledgers = new Map<string, Record<string, unknown>>();
      refKeys.forEach((k, i) => {
        ledgers.set(
          `${k.ccId}_${k.year}`,
          snaps[i].exists ? (snaps[i].data() as Record<string, unknown>) : {},
        );
      });

      const availableOf = (ccId: string, year: number) => {
        const l = ledgers.get(`${ccId}_${year}`) || {};
        return (
          toCents(l.received) +
          (ccId === rootId ? carryByYear.get(year) || 0 : 0) -
          toCents(l.allocatedToChildren) -
          toCents(l.spentDirect)
        );
      };

      for (const g of grouped) {
        const available = availableOf(g.ccId, g.year);
        if (g.spent > available) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Saldo insuficiente em ${byId.get(g.ccId)?.name || "centro de custo"} ` +
              `para o exercício ${g.year}: disponível ${formatBRL(available)}, ` +
              `necessário ${formatBRL(g.spent)} somando as parcelas.`,
          );
        }
        for (const ancestorId of chain.get(g.ccId) || []) {
          if (availableOf(ancestorId, g.year) < 0) {
            throw new functions.https.HttpsError(
              "failed-precondition",
              `${byId.get(ancestorId)?.name || "Um centro de custo superior"} está ` +
                "com saldo negativo. Regularize a distribuição antes de lançar novas despesas.",
            );
          }
        }
      }

      transactions.forEach((raw, i) => {
        const tx = raw as TxShape;
        const dueDate = asDate(tx.dueDate);
        const paymentDate = asDate(tx.paymentDate);
        const ids = (tx.costCenterAllocation || [])
          .filter((a) => a?.costCenterId)
          .map((a) => a.costCenterId);

        trx.set(refs[i], {
          ...raw,
          companyId,
          costCenterIds: ids,
          costCenterId: ids[0],
          createdBy: context.auth!.uid,
          batchId: null,
          ledgerApplied: true,
          ledgerAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(dueDate
            ? { dueDate: admin.firestore.Timestamp.fromDate(dueDate) }
            : {}),
          ...(paymentDate
            ? { paymentDate: admin.firestore.Timestamp.fromDate(paymentDate) }
            : {}),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      for (const g of grouped) {
        const targets: Array<[string, boolean]> = [
          [g.ccId, true],
          ...(chain.get(g.ccId) || []).map(
            (a) => [a, false] as [string, boolean],
          ),
        ];
        for (const [id, isLeaf] of targets) {
          trx.set(
            db()
              .collection(LEDGER)
              .doc(ledgerDocId(companyId, id, g.year)),
            {
              companyId,
              costCenterId: id,
              year: g.year,
              parentId: parentIdOf(id),
              isRoot: id === rootId,
              ...(isLeaf
                ? {
                    spentDirect: admin.firestore.FieldValue.increment(
                      toReais(g.spent),
                    ),
                    spentDirectPaid: admin.firestore.FieldValue.increment(
                      toReais(g.paid),
                    ),
                  }
                : {}),
              subtreeSpent: admin.firestore.FieldValue.increment(
                toReais(g.spent),
              ),
              subtreeSpentPaid: admin.firestore.FieldValue.increment(
                toReais(g.paid),
              ),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
    });

    return { success: true, ids: refs.map((r) => r.id) };
  },
);

/** Hierarquia de centros de custo da empresa, montada uma vez por chamada. */
async function loadCcIndex(companyId: string) {
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
  return { byId, parentIdOf, rootId, hasChildren };
}

interface LedgerDelta {
  ccId: string;
  year: number;
  spent: number;
  paid: number;
  /** Crédito de receita. Só aparece no raiz. */
  received: number;
}

/**
 * Delta por (centro, exercício) entre a transação atual e o que o patch produz.
 *
 * Trocar de ano vira estorno num exercício e lançamento no outro, que é
 * exatamente o que o modelo espera. Vale igualmente para receita: mudar a data
 * de uma receita a transfere de um exercício para o outro no raiz.
 */
function deltasFor(
  current: TxShape,
  merged: TxShape,
  rootId: string,
): LedgerDelta[] {
  const deltas = new Map<string, LedgerDelta>();
  const bump = (
    ccId: string,
    year: number,
    spent: number,
    paid: number,
    received: number,
  ) => {
    const key = `${ccId}_${year}`;
    const cur = deltas.get(key) || {
      ccId,
      year,
      spent: 0,
      paid: 0,
      received: 0,
    };
    cur.spent += spent;
    cur.paid += paid;
    cur.received += received;
    deltas.set(key, cur);
  };

  for (const [ccId, e] of ledgerEffect(current)) {
    bump(ccId, e.year, -e.spent, -e.paid, 0);
  }
  for (const [ccId, e] of ledgerEffect(merged)) {
    bump(ccId, e.year, e.spent, e.paid, 0);
  }

  const revenueBefore = revenueEffect(current);
  if (revenueBefore)
    bump(rootId, revenueBefore.year, 0, 0, -revenueBefore.cents);
  const revenueAfter = revenueEffect(merged);
  if (revenueAfter) bump(rootId, revenueAfter.year, 0, 0, revenueAfter.cents);

  return [...deltas.values()].filter(
    (d) => d.spent !== 0 || d.paid !== 0 || d.received !== 0,
  );
}

interface PatchOutcome {
  budgetChanged: boolean;
  budgetExceeded: boolean;
  budgetExceededReason: string | null;
}

/**
 * Grava um patch numa transação revalidando o orçamento pelo delta antes→depois.
 *
 * Trabalha por delta, de modo que reduzir valor, trocar de centro de custo,
 * mudar de exercício, rejeitar ou baixar sejam todos o mesmo caminho.
 *
 * `enforce` decide a reação quando o aumento não cabe:
 *
 *   • `true` — recusa. É o caso de quem cria ou revive um compromisso: editar
 *     valor para cima, trocar de centro, tirar uma despesa de `rejected`.
 *   • `false` — grava assim mesmo, marcada com `budgetExceeded`. É o caso da
 *     baixa: o compromisso já foi validado quando a despesa foi criada e a
 *     conta já é devida, então recusar o pagamento não desfaz a dívida — só
 *     trava o financeiro. O razão registra o estouro e a árvore trava para
 *     novos lançamentos, que é o efeito pretendido pela regra do envelope.
 */
async function commitValidatedPatch(
  companyId: string,
  txRef: admin.firestore.DocumentReference,
  current: TxShape,
  patch: Record<string, unknown>,
  opts: { enforce: boolean },
): Promise<PatchOutcome> {
  const { byId, parentIdOf, rootId, hasChildren } =
    await loadCcIndex(companyId);

  const merged: TxShape = { ...current, ...(patch as TxShape) };

  for (const ccId of ledgerEffect(merged).keys()) {
    if (!byId.has(ccId)) {
      throw new functions.https.HttpsError(
        "not-found",
        "Centro de custo não encontrado nesta empresa.",
      );
    }
    if (hasChildren.has(ccId)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `${byId.get(ccId)?.name || "O centro de custo"} possui filhos. ` +
          "Despesas só podem ser lançadas em centros de custo de último grau.",
      );
    }
  }

  const effective = deltasFor(current, merged, rootId);

  const dueDate = asDate(merged.dueDate);
  const paymentDate = asDate(merged.paymentDate);
  const patchWrite: Record<string, unknown> = {
    ...patch,
    ...(dueDate
      ? { dueDate: admin.firestore.Timestamp.fromDate(dueDate) }
      : {}),
    ...(paymentDate
      ? { paymentDate: admin.firestore.Timestamp.fromDate(paymentDate) }
      : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (patch.costCenterAllocation && merged.costCenterAllocation) {
    const ids = merged.costCenterAllocation
      .filter((a) => a?.costCenterId)
      .map((a) => a.costCenterId);
    patchWrite.costCenterIds = ids;
    patchWrite.costCenterId = ids[0];
  }

  if (effective.length === 0) {
    // Nada que toque orçamento mudou (descrição, anexo, observação). Grava
    // sem carimbo: não há razão a ajustar e o trigger não encontrará delta.
    await txRef.update(patchWrite);
    return {
      budgetChanged: false,
      budgetExceeded: false,
      budgetExceededReason: null,
    };
  }

  // A transação devolve o estouro encontrado para que o valor sobreviva a um
  // retry do Firestore — reatribuir uma variável de fora da closure não.
  const shortfall = await db().runTransaction<string | null>(async (trx) => {
    const years = [...new Set(effective.map((d) => d.year))];
    const carryByYear = new Map<number, number>();
    for (const y of years) {
      carryByYear.set(y, await readCarryIn(trx, companyId, rootId, y));
    }

    const chain = new Map<string, string[]>();
    const refKeys: Array<{ ccId: string; year: number }> = [];
    const seen = new Set<string>();
    for (const d of effective) {
      const ancestors = ancestorsOf(d.ccId, parentIdOf);
      chain.set(d.ccId, ancestors);
      for (const id of [d.ccId, ...ancestors]) {
        const key = `${id}_${d.year}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refKeys.push({ ccId: id, year: d.year });
      }
    }

    const snaps = await trx.getAll(
      ...refKeys.map((k) =>
        db()
          .collection(LEDGER)
          .doc(ledgerDocId(companyId, k.ccId, k.year)),
      ),
    );
    const ledgers = new Map<string, Record<string, unknown>>();
    refKeys.forEach((k, i) => {
      ledgers.set(
        `${k.ccId}_${k.year}`,
        snaps[i].exists ? (snaps[i].data() as Record<string, unknown>) : {},
      );
    });

    const availableOf = (ccId: string, year: number) => {
      const l = ledgers.get(`${ccId}_${year}`) || {};
      return (
        toCents(l.received) +
        (ccId === rootId ? carryByYear.get(year) || 0 : 0) -
        toCents(l.allocatedToChildren) -
        toCents(l.spentDirect)
      );
    };

    // Só aumentos precisam caber; devolver recurso é sempre permitido.
    let found: string | null = null;
    for (const d of effective) {
      if (d.spent <= 0) continue;
      const available = availableOf(d.ccId, d.year);
      if (d.spent > available) {
        found =
          `Saldo insuficiente em ${byId.get(d.ccId)?.name || "centro de custo"} ` +
          `no exercício ${d.year}: disponível ${formatBRL(available)}, ` +
          `necessário ${formatBRL(d.spent)}.`;
        break;
      }
      for (const ancestorId of chain.get(d.ccId) || []) {
        if (availableOf(ancestorId, d.year) < 0) {
          found =
            `${byId.get(ancestorId)?.name || "Um centro de custo superior"} está ` +
            "com saldo negativo. Regularize a distribuição antes de aumentar despesas.";
          break;
        }
      }
      if (found) break;
    }

    if (found && opts.enforce) {
      throw new functions.https.HttpsError("failed-precondition", found);
    }

    // A marca só se mexe quando algum aumento foi de fato conferido. Num delta
    // puramente de redução não há veredicto novo a registrar.
    const checkedIncrease = effective.some((d) => d.spent > 0);

    trx.update(txRef, {
      ...patchWrite,
      ...(checkedIncrease
        ? found
          ? { budgetExceeded: true, budgetExceededReason: found }
          : {
              budgetExceeded: false,
              budgetExceededReason:
                admin.firestore.FieldValue.delete() as unknown as string,
            }
        : {}),
      ledgerApplied: true,
      ledgerAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    for (const d of effective) {
      const hasSpend = d.spent !== 0 || d.paid !== 0;
      // Receita credita o raiz e para por aí; a cadeia de ancestrais é do gasto.
      const ancestors = hasSpend ? chain.get(d.ccId) || [] : [];

      const base = (id: string) => ({
        companyId,
        costCenterId: id,
        year: d.year,
        parentId: parentIdOf(id),
        isRoot: id === rootId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      trx.set(
        db()
          .collection(LEDGER)
          .doc(ledgerDocId(companyId, d.ccId, d.year)),
        {
          ...base(d.ccId),
          ...(d.received !== 0
            ? {
                received: admin.firestore.FieldValue.increment(
                  toReais(d.received),
                ),
              }
            : {}),
          ...(hasSpend
            ? {
                spentDirect: admin.firestore.FieldValue.increment(
                  toReais(d.spent),
                ),
                spentDirectPaid: admin.firestore.FieldValue.increment(
                  toReais(d.paid),
                ),
                subtreeSpent: admin.firestore.FieldValue.increment(
                  toReais(d.spent),
                ),
                subtreeSpentPaid: admin.firestore.FieldValue.increment(
                  toReais(d.paid),
                ),
              }
            : {}),
        },
        { merge: true },
      );

      for (const id of ancestors) {
        trx.set(
          db()
            .collection(LEDGER)
            .doc(ledgerDocId(companyId, id, d.year)),
          {
            ...base(id),
            subtreeSpent: admin.firestore.FieldValue.increment(
              toReais(d.spent),
            ),
            subtreeSpentPaid: admin.firestore.FieldValue.increment(
              toReais(d.paid),
            ),
          },
          { merge: true },
        );
      }
    }

    return found;
  });

  return {
    budgetChanged: true,
    budgetExceeded: shortfall !== null,
    budgetExceededReason: shortfall,
  };
}

/**
 * Edita uma despesa validando o efeito da mudança sobre o orçamento.
 *
 * Sem isto o bloqueio da criação seria contornável em dois passos: lançar um
 * valor que cabe e depois editá-lo para um que não cabe.
 */
export const updatePayableTransaction = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { transactionId, patch } = data as {
      transactionId?: string;
      patch?: Record<string, unknown>;
    };

    if (!transactionId || !patch) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "transactionId e patch são obrigatórios.",
      );
    }

    const txRef = db().collection("transactions").doc(transactionId);
    const snap = await txRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Transação não encontrada.",
      );
    }

    const current = snap.data() as TxShape;
    const companyId = current.companyId;
    if (!companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Transação sem empresa associada.",
      );
    }

    const outcome = await commitValidatedPatch(
      companyId,
      txRef,
      current,
      patch,
      { enforce: true },
    );

    return { success: true, budgetChanged: outcome.budgetChanged };
  },
);

/**
 * Avisa administradores e gestores financeiros de que algo furou o envelope.
 *
 * Usado nos dois caminhos que gravam sem bloquear — a recorrência noturna e a
 * baixa que muda de exercício — porque em ambos não há ninguém na tela para ler
 * uma recusa e o estouro precisa chegar a quem redistribui.
 */
export async function notifyBudgetExceeded(
  companyId: string,
  title: string,
  message: string,
) {
  try {
    const usersSnap = await db()
      .collection("users")
      .where(`companyRoles.${companyId}`, "in", ["admin", "financial_manager"])
      .get();

    if (usersSnap.empty) return;

    const batch = db().batch();
    for (const userDoc of usersSnap.docs) {
      batch.set(db().collection("notifications").doc(), {
        userId: userDoc.id,
        companyId,
        title,
        message,
        type: "warning",
        link: "/centros-custo/distribuicao",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    // Falhar o aviso não pode derrubar a operação que o disparou.
    console.error("Falha ao notificar estouro de orçamento:", err);
  }
}

/**
 * Sobra dos exercícios anteriores lida fora de transação, para a conferência
 * prévia do lote. A versão transacional continua sendo a que vale na gravação.
 */
async function carryInLoose(companyId: string, rootId: string, year: number) {
  let carry = 0;
  for (let y = year - 10; y < year; y++) {
    const snap = await db()
      .collection(LEDGER)
      .doc(ledgerDocId(companyId, rootId, y))
      .get();
    if (!snap.exists) continue;
    const d = snap.data() as Record<string, unknown>;
    carry = toCents(d.received) + carry - toCents(d.subtreeSpent);
  }
  return carry;
}

/**
 * Aplica um patch a várias transações de uma vez.
 *
 * Existe porque três telas editam despesas em bloco — a baixa em lote, a edição
 * de uma série recorrente e o backfill de `costCenterIds` — e as rules já não
 * deixam nenhuma delas escrever valor, centro de custo ou data direto.
 *
 * A conferência do orçamento é feita **antes** de gravar qualquer documento,
 * somando o efeito de todos os patches por (centro, exercício). Validar um a um
 * deixaria metade da série editada quando o envelope acabasse no meio do
 * caminho — o mesmo motivo pelo qual o parcelamento é validado pela soma.
 *
 * Cada documento é gravado com o razão na sua própria transação atômica, então
 * uma falha tardia (uma corrida com outro lançamento) nunca deixa o razão
 * inconsistente: deixa parte do lote por aplicar, e o retorno diz quais.
 */
export const applyTransactionPatches = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { patches, enforce = true } = data as {
      patches?: Array<{
        transactionId?: string;
        patch?: Record<string, unknown>;
      }>;
      enforce?: boolean;
    };

    if (!Array.isArray(patches) || patches.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "patches é obrigatório.",
      );
    }
    // Teto alinhado ao limite de um writeBatch do Firestore; acima disso a tela
    // precisa dividir o lote.
    if (patches.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Um lote não pode ter mais de 500 transações.",
      );
    }

    const loaded: Array<{
      ref: admin.firestore.DocumentReference;
      current: TxShape;
      patch: Record<string, unknown>;
    }> = [];

    for (const item of patches) {
      if (!item?.transactionId || !item.patch) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Cada item precisa de transactionId e patch.",
        );
      }
      const ref = db().collection("transactions").doc(item.transactionId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          `Transação ${item.transactionId} não encontrada.`,
        );
      }
      loaded.push({ ref, current: snap.data() as TxShape, patch: item.patch });
    }

    const companyIds = new Set(
      loaded.map((l) => l.current.companyId).filter(Boolean) as string[],
    );
    if (companyIds.size !== 1) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Um lote só pode conter transações de uma mesma empresa.",
      );
    }
    const companyId = [...companyIds][0];

    // ── Conferência agregada, antes de gravar ────────────────────────────────
    const { byId, rootId } = await loadCcIndex(companyId);

    const totals = new Map<
      string,
      { ccId: string; year: number; spent: number }
    >();
    for (const l of loaded) {
      const merged: TxShape = { ...l.current, ...(l.patch as TxShape) };
      for (const d of deltasFor(l.current, merged, rootId)) {
        const key = `${d.ccId}_${d.year}`;
        const cur = totals.get(key) || { ccId: d.ccId, year: d.year, spent: 0 };
        cur.spent += d.spent;
        totals.set(key, cur);
      }
    }

    // Só o gasto precisa caber; crédito de receita nunca é recusado.
    const increases = [...totals.values()].filter((t) => t.spent > 0);
    if (increases.length > 0) {
      const carry = new Map<number, number>();

      for (const t of increases) {
        if (t.ccId === rootId && !carry.has(t.year)) {
          carry.set(t.year, await carryInLoose(companyId, rootId, t.year));
        }
        const snap = await db()
          .collection(LEDGER)
          .doc(ledgerDocId(companyId, t.ccId, t.year))
          .get();
        const l = snap.exists ? (snap.data() as Record<string, unknown>) : {};
        const available =
          toCents(l.received) +
          (t.ccId === rootId ? carry.get(t.year) || 0 : 0) -
          toCents(l.allocatedToChildren) -
          toCents(l.spentDirect);

        if (t.spent > available && enforce) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Saldo insuficiente em ${byId.get(t.ccId)?.name || "centro de custo"} ` +
              `no exercício ${t.year}: disponível ${formatBRL(available)}, ` +
              `necessário ${formatBRL(t.spent)} somando o lote.`,
          );
        }
      }
    }

    // ── Gravação ────────────────────────────────────────────────────────────
    const applied: string[] = [];
    const exceeded: string[] = [];
    for (const l of loaded) {
      const outcome = await commitValidatedPatch(
        companyId,
        l.ref,
        l.current,
        l.patch,
        { enforce },
      );
      applied.push(l.ref.id);
      if (outcome.budgetExceeded) exceeded.push(l.ref.id);
    }

    if (exceeded.length > 0) {
      await notifyBudgetExceeded(
        companyId,
        "Baixa em lote sem saldo no centro de custo",
        `${exceeded.length} lançamento(s) foram registrados em exercício sem ` +
          "orçamento suficiente. Regularize a distribuição.",
      );
    }

    return { success: true, applied, exceeded };
  });

/**
 * Localiza a despesa de um magic link e confere que o link ainda vale.
 *
 * O token é a credencial: estas duas chamadas não exigem autenticação, porque
 * quem aprova por e-mail não tem sessão no sistema. Por isso a conferência é
 * feita no servidor — o cliente não pode ser quem decide que o link expirou.
 */
async function resolveApprovalToken(token: string) {
  const snap = await db()
    .collection("transactions")
    .where("approvalToken", "==", token)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError(
      "not-found",
      "Token inválido ou não encontrado.",
    );
  }

  const docSnap = snap.docs[0];
  const current = docSnap.data() as TxShape & {
    approvalTokenExpiresAt?: admin.firestore.Timestamp;
    amount?: number;
    description?: string;
  };

  const expiresAt = asDate(current.approvalTokenExpiresAt);
  if (expiresAt && expiresAt < new Date()) {
    throw new functions.https.HttpsError(
      "deadline-exceeded",
      "Este link de aprovação expirou.",
    );
  }

  if (current.status !== "pending_approval") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Esta transação já foi processada.",
    );
  }

  if (!current.companyId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Transação sem empresa associada.",
    );
  }

  return { ref: docSnap.ref, id: docSnap.id, current };
}

/**
 * Registra a decisão tomada pelo magic link.
 *
 * O log saiu do cliente junto com a escrita: a página de aprovação é anônima e
 * não deveria conseguir gravar em `audit_logs` por conta própria.
 */
async function logMagicLinkDecision(
  companyId: string,
  transactionId: string,
  action: "approve" | "reject",
  details: Record<string, unknown>,
) {
  try {
    await db()
      .collection("audit_logs")
      .add({
        companyId,
        userId: "magic-link",
        userEmail: "magic-link-approval@system",
        action,
        entity: "transaction",
        entityId: transactionId,
        details: { via: "magic_link", ...details },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    // Auditoria não pode derrubar a decisão que ela registra.
    console.error("Falha ao registrar decisão do magic link:", err);
  }
}

/**
 * Aprova uma despesa pelo magic link, sem sessão, validando o token no servidor.
 *
 * O aprovador pode ajustar o valor, e um ajuste para cima ocupa envelope que
 * ninguém conferiu quando a despesa foi criada — por isso passa pela mesma
 * validação de saldo das demais edições.
 */
export const approveTransactionByToken = functions.https.onCall(
  async (data) => {
    const { token, comment, adjustedAmount } = data as {
      token?: string;
      comment?: string;
      adjustedAmount?: number;
    };

    if (!token) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "token é obrigatório.",
      );
    }

    const { ref, id, current } = await resolveApprovalToken(token);

    const patch: Record<string, unknown> = {
      status: "approved",
      approvedBy: "magic-link",
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvalToken: null,
      approvalTokenExpiresAt: null,
    };
    if (comment) patch.approvalComment = comment;
    if (
      typeof adjustedAmount === "number" &&
      adjustedAmount !== current.amount
    ) {
      patch.amount = adjustedAmount;
      patch.originalAmount = current.amount;
    }

    await commitValidatedPatch(current.companyId!, ref, current, patch, {
      enforce: true,
    });

    await logMagicLinkDecision(current.companyId!, id, "approve", {
      originalAmount: current.amount ?? null,
      adjustedAmount: adjustedAmount ?? null,
      comment: comment ?? null,
    });

    return { success: true, id, companyId: current.companyId };
  },
);

/** Rejeita uma despesa pelo magic link. Rejeitar sempre libera envelope. */
export const rejectTransactionByToken = functions.https.onCall(async (data) => {
  const { token, reason } = data as { token?: string; reason?: string };

  if (!token) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "token é obrigatório.",
    );
  }

  const { ref, id, current } = await resolveApprovalToken(token);

  await commitValidatedPatch(
    current.companyId!,
    ref,
    current,
    {
      status: "rejected",
      rejectedBy: "magic-link",
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason || null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
    },
    { enforce: true },
  );

  await logMagicLinkDecision(current.companyId!, id, "reject", {
    reason: reason || null,
  });

  return { success: true, id, companyId: current.companyId };
});

const TRANSACTION_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "paid",
  "received",
  "rejected",
]);

/**
 * Muda o status de uma transação — inclusive a baixa — pelo servidor.
 *
 * Era o último contorno aberto do bloqueio: uma despesa recusada libera o
 * envelope, e voltá-la de `rejected` para o fluxo reocupava esse espaço sem
 * ninguém conferir se ele ainda existia. A baixa tinha um furo próprio: ao
 * gravar `paymentDate`, ela muda o exercício da despesa, e o consumo migrava
 * para um ano que podia não ter envelope nenhum.
 *
 * Os campos de fluxo são preenchidos aqui, não pelo cliente: `approvedBy` e
 * `releasedBy` saem do token de autenticação, e o `approvalToken` do magic link
 * é gerado no servidor — quem aprova não deveria poder escolher o próprio
 * crachá nem o próprio token.
 *
 * A baixa grava mesmo sem saldo (`enforce: false`): a conta já é devida e
 * recusar o pagamento não desfaz a dívida. Ela nasce marcada e os gestores são
 * avisados, do mesmo jeito que a recorrência noturna.
 */
export const setTransactionStatus = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }

    const { transactionId, status, settlement } = data as {
      transactionId?: string;
      status?: string;
      settlement?: {
        paymentDate?: string;
        finalAmount?: number;
        discount?: number;
        interest?: number;
      };
    };

    if (!transactionId || !status) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "transactionId e status são obrigatórios.",
      );
    }
    if (!TRANSACTION_STATUSES.has(status)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Status inválido: ${status}.`,
      );
    }

    const txRef = db().collection("transactions").doc(transactionId);
    const snap = await txRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Transação não encontrada.",
      );
    }

    const current = snap.data() as TxShape;
    const companyId = current.companyId;
    if (!companyId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Transação sem empresa associada.",
      );
    }

    const uid = context.auth.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = { status };

    if (status === "approved") {
      patch.approvedBy = uid;
      patch.approvedAt = now;
    } else if (status === "paid" || status === "received") {
      patch.releasedBy = uid;
      patch.releasedAt = now;
    } else if (status === "pending_approval") {
      // Token do magic link: gerado no servidor e com validade de 7 dias.
      patch.approvalToken = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      patch.approvalTokenExpiresAt =
        admin.firestore.Timestamp.fromDate(expiresAt);
    }

    if (settlement) {
      const paymentDate = asDate(settlement.paymentDate);
      if (!paymentDate) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "A baixa precisa de data de pagamento.",
        );
      }
      patch.paymentDate = paymentDate.toISOString();
      patch.finalAmount = settlement.finalAmount;
      patch.discount = settlement.discount;
      patch.interest = settlement.interest;
    }

    const outcome = await commitValidatedPatch(
      companyId,
      txRef,
      current,
      patch,
      // A baixa realiza um compromisso já validado; qualquer outra mudança de
      // status que reocupe envelope precisa caber.
      { enforce: !settlement },
    );

    if (outcome.budgetExceeded) {
      await notifyBudgetExceeded(
        companyId,
        "Baixa sem saldo no centro de custo",
        `A baixa de "${(current as { description?: string }).description || "uma despesa"}" ` +
          `foi registrada em exercício sem orçamento suficiente. ${outcome.budgetExceededReason || ""}`,
      );
    }

    return {
      success: true,
      budgetChanged: outcome.budgetChanged,
      budgetExceeded: outcome.budgetExceeded,
      budgetExceededReason: outcome.budgetExceededReason,
    };
  },
);
