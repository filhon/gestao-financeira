/**
 * Saldo da empresa (`company_stats.currentBalance`) = Σ receitas pagas − Σ
 * despesas pagas, pelo valor final.
 *
 * O trigger aplica só a diferença de cada escrita, e o Firebase pode entregar
 * o mesmo evento mais de uma vez ou fora de ordem. Por isso cada lançamento tem
 * um marcador em `company_stats/{empresa}/applied/{lançamento}` com quanto ele
 * já soma ao saldo (centavos) e a hora do evento que gravou isso:
 *   • evento repetido ou mais velho que o marcador → ignorado;
 *   • saldo e marcador mudam na mesma transação, então Σ marcadores = saldo.
 * Falha relança o erro e o Firebase tenta de novo (failurePolicy), em vez de
 * perder a atualização calada.
 *
 * A conferência noturna refaz a conta do zero, corrige o que divergir (evento
 * perdido depois de dias de tentativa, escrita manual) e avisa os gestores.
 */
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { assertCanManageBudget, formatBRL, toCents } from "./costCenterLedger";
import { notifyBudgetExceeded } from "./transactionLedger";

const db = () => admin.firestore();
const PAID = ["paid", "received"];

/** Quanto o lançamento soma ao saldo, em centavos (0 se não está pago). */
export function contribution(data?: admin.firestore.DocumentData | null) {
  if (!data || !PAID.includes(data.status)) return 0;
  const cents = toCents(data.finalAmount ?? data.amount);
  return data.type === "receivable" ? cents : -cents;
}

const statsRef = (companyId: string) =>
  db().collection("company_stats").doc(companyId);
const markRef = (companyId: string, txId: string) =>
  statsRef(companyId).collection("applied").doc(txId);

/** Grava saldo em centavos e o espelho em reais que as telas leem. */
const balanceFields = (cents: number) => ({
  balanceCents: cents,
  currentBalance: cents / 100,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});

/**
 * Leva o marcador do lançamento a `target` e o saldo junto, numa transação.
 * `at` é a hora do estado aplicado; um evento mais velho que o marcador não
 * mexe em nada. Devolve a diferença aplicada.
 */
async function applyContribution(
  companyId: string,
  txId: string,
  target: (current: number) => number,
  at: admin.firestore.Timestamp,
  updatedBy: string,
) {
  return db().runTransaction(async (t) => {
    const [stats, mark] = await Promise.all([
      t.get(statsRef(companyId)),
      t.get(markRef(companyId, txId)),
    ]);
    const markAt = mark.get("at") as admin.firestore.Timestamp | undefined;
    if (markAt && markAt.toMillis() >= at.toMillis()) return 0;

    const applied = Number(mark.get("cents")) || 0;
    const next = target(applied);
    t.set(markRef(companyId, txId), { cents: next, at });
    const delta = next - applied;
    if (delta === 0) return 0;

    const base =
      typeof stats.get("balanceCents") === "number"
        ? (stats.get("balanceCents") as number)
        : toCents(stats.get("currentBalance"));
    t.set(
      statsRef(companyId),
      { ...balanceFields(base + delta), updatedBy },
      { merge: true },
    );
    return delta;
  });
}

/** Dia (yyyy-MM-dd) no fuso da empresa; a função roda em UTC. */
const dayKeyBrt = (d: Date) =>
  d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/**
 * Valor previsto (linha de base da Análise): o valor com que o lançamento
 * nasceu. Edição posterior de `amount` é revisão, não muda a previsão.
 * Não previsto = nasceu já pago ou depois do vencimento: entrou no caixa sem
 * ter sido planejado, e a Análise o soma à parte em vez de chamá-lo de
 * previsto igual ao pago. Mesma regra no backfill
 * (scripts/backfill-planned-amount.mjs), que só não sabe o status de origem.
 */
export function plannedStamp(
  data: admin.firestore.DocumentData,
  createdAt: Date,
) {
  const due = data.dueDate?.toDate?.() as Date | undefined;
  return {
    plannedAmount: Number(data.amount) || 0,
    plannedSource: "create",
    unplanned:
      PAID.includes(data.status) ||
      (!!due && dayKeyBrt(createdAt) > dayKeyBrt(due)),
  };
}

export const onTransactionWrite = functions
  .runWith({ failurePolicy: true })
  .firestore.document("transactions/{transactionId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    const companyId = after?.companyId || before?.companyId;
    if (!companyId) return null;

    // Criação: carimba o valor previsto a partir do próprio evento de criação,
    // então uma edição que chegue antes deste trigger não vira a previsão.
    // Este é o único lugar que grava os três campos (as rules barram o
    // cliente e `commitValidatedPatch` os descarta). Repetir o evento grava
    // o mesmo valor. Lançamento já apagado: nada a carimbar.
    if (!before && after) {
      const createdAt =
        (after.createdAt?.toDate?.() as Date | undefined) ??
        new Date(context.timestamp);
      try {
        await change.after.ref.update(plannedStamp(after, createdAt));
      } catch (err) {
        if ((err as { code?: number }).code !== 5) throw err; // 5 = NOT_FOUND
      }
    }

    // Escrita que não mexe no saldo (rascunho editado, descrição de paga).
    const target = contribution(after);
    if (target === contribution(before)) return null;

    // Eventos velhos demais não são reenviados: a conferência noturna cobre.
    const at = admin.firestore.Timestamp.fromDate(new Date(context.timestamp));
    if (Date.now() - at.toMillis() > 3 * 86_400_000) {
      console.error(`Evento antigo descartado: ${context.eventId}`);
      return null;
    }

    await applyContribution(
      companyId,
      context.params.transactionId,
      () => target,
      at,
      "trigger",
    );
    return null;
  });

interface ReconcileResult {
  previous: number;
  balance: number;
  fixedTransactions: number;
  rebuilt: boolean;
  paidCount: number;
}

/**
 * Refaz o saldo do zero e corrige o que não bater: primeiro cada marcador
 * (lido de novo dentro da transação, junto com o lançamento), depois o saldo
 * contra a soma dos marcadores. Na primeira vez numa empresa (sem
 * `markersReady`), cria os marcadores em lote e grava o saldo absoluto.
 */
export async function reconcileCompanyBalance(
  companyId: string,
): Promise<ReconcileResult> {
  const [txSnap, markSnap, statsSnap] = await Promise.all([
    db().collection("transactions").where("companyId", "==", companyId).get(),
    statsRef(companyId).collection("applied").get(),
    statsRef(companyId).get(),
  ]);
  const previous =
    typeof statsSnap.get("balanceCents") === "number"
      ? (statsSnap.get("balanceCents") as number)
      : toCents(statsSnap.get("currentBalance"));
  const marks = new Map(
    markSnap.docs.map((d) => [d.id, Number(d.get("cents")) || 0]),
  );
  const truth = new Map(txSnap.docs.map((d) => [d.id, contribution(d.data())]));
  for (const id of marks.keys()) if (!truth.has(id)) truth.set(id, 0);
  const now = admin.firestore.Timestamp.now();
  let fixedTransactions = 0;

  const init = statsSnap.get("markersReady") !== true;
  if (init) {
    // Inicialização: marcadores de todos os pagos, depois o saldo absoluto.
    const writes = [...truth].filter(
      ([id, cents]) => (marks.get(id) ?? 0) !== cents,
    );
    for (let i = 0; i < writes.length; i += 450) {
      const batch = db().batch();
      for (const [id, cents] of writes.slice(i, i + 450))
        batch.set(markRef(companyId, id), { cents, at: now });
      await batch.commit();
    }
  } else {
    for (const [id, cents] of truth) {
      if ((marks.get(id) ?? 0) === cents) continue;
      // Relê o lançamento na transação: ele pode ter mudado desde a leitura.
      const txRef = db().collection("transactions").doc(id);
      const delta = await db().runTransaction(async (t) => {
        const [tx, stats, mark] = await Promise.all([
          t.get(txRef),
          t.get(statsRef(companyId)),
          t.get(markRef(companyId, id)),
        ]);
        const applied = Number(mark.get("cents")) || 0;
        const actual = contribution(tx.data());
        if (applied === actual) return 0;
        t.set(markRef(companyId, id), { cents: actual, at: now });
        const base = Number(stats.get("balanceCents")) || 0;
        t.set(
          statsRef(companyId),
          { ...balanceFields(base + actual - applied), updatedBy: "reconcile" },
          { merge: true },
        );
        return actual - applied;
      });
      if (delta !== 0) fixedTransactions++;
    }
  }

  // Saldo × Σ marcadores, lidos juntos na mesma transação.
  const { balance, rebuilt } = await db().runTransaction(async (t) => {
    const [stats, all] = await Promise.all([
      t.get(statsRef(companyId)),
      t.get(statsRef(companyId).collection("applied")),
    ]);
    const sum = all.docs.reduce((s, d) => s + (Number(d.get("cents")) || 0), 0);
    if (stats.get("balanceCents") === sum && !init)
      return { balance: sum, rebuilt: false };
    t.set(
      statsRef(companyId),
      {
        ...balanceFields(sum),
        updatedBy: "reconcile",
        markersReady: true,
        lastRecalculation: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { balance: sum, rebuilt: true };
  });

  const paidCount = [...truth.values()].filter((c) => c !== 0).length;
  return { previous, balance, fixedTransactions, rebuilt, paidCount };
}

/** Recálculo pedido pelo gestor na tela. */
export const recalculateCompanyBalance = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado.",
      );
    }
    const companyId = data?.companyId;
    if (!companyId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Company ID é obrigatório.",
      );
    }
    await assertCanManageBudget(
      context.auth.uid,
      companyId,
      "Apenas administradores e gestores financeiros podem recalcular o saldo.",
    );
    const result = await reconcileCompanyBalance(companyId);
    if (result.previous !== result.balance)
      await logCorrection(companyId, result, context.auth.uid);
    return {
      success: true,
      newBalance: result.balance / 100,
      transactionCount: result.paidCount,
    };
  });

async function logCorrection(
  companyId: string,
  r: ReconcileResult,
  userId = "system",
) {
  await db()
    .collection("audit_logs")
    .add({
      companyId,
      userId,
      userEmail: userId === "system" ? "conferencia-diaria" : "",
      action: "update",
      entity: "company_stats",
      entityId: companyId,
      subject: "Saldo da empresa recalculado",
      details: {
        changes: [
          {
            field: "currentBalance",
            oldValue: r.previous / 100,
            newValue: r.balance / 100,
          },
        ],
        fixedTransactions: r.fixedTransactions,
      },
      changedFields: ["currentBalance"],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/** Conferência diária às 02:30: corrige e avisa quem gere o caixa. */
export const checkCompanyBalances = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.schedule("30 2 * * *")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    const companies = await db().collection("companies").get();
    for (const company of companies.docs) {
      try {
        const r = await reconcileCompanyBalance(company.id);
        if (r.previous === r.balance) continue;
        console.warn(`Saldo de ${company.id} corrigido`, r);
        await logCorrection(company.id, r);
        await notifyBudgetExceeded(
          company.id,
          "Saldo corrigido pela conferência diária",
          `O saldo estava ${formatBRL(r.previous)} e foi corrigido para ` +
            `${formatBRL(r.balance)} (diferença ${formatBRL(r.balance - r.previous)}).`,
          "/dashboard",
        );
      } catch (error) {
        console.error(`Conferência do saldo de ${company.id} falhou:`, error);
      }
    }
    return null;
  });
