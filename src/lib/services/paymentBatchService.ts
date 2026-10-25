import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
  orderBy,
  addDoc,
  Timestamp,
  DocumentData,
  DocumentReference,
  QueryDocumentSnapshot,
  deleteField,
  startAfter,
  limit,
  runTransaction,
  getAggregateFromServer,
  count,
  sum,
} from "firebase/firestore";
import currency from "currency.js";
import { format, startOfDay } from "date-fns";
import { PaymentBatch, PaymentBatchStatus, Transaction } from "@/lib/types";
import { auditService } from "@/lib/services/auditService";

const COLLECTION_NAME = "payment_batches";
const TRANSACTIONS_COLLECTION = "transactions";

/** Quem executa a ação: vai para o log de auditoria e para a segregação de funções. */
export interface BatchActor {
  uid: string;
  email: string;
}

export const BATCH_STATUSES: PaymentBatchStatus[] = [
  "open",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "paid",
  "rejected",
];

/** Lotes que ainda têm etapa pela frente. */
export const ACTIVE_STATUSES: PaymentBatchStatus[] = [
  "open",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
];
export const ACTIVE_BATCH_LIMIT = 500;

const STATUS_NAMES: Record<PaymentBatchStatus, string> = {
  open: "Aberto",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovado",
  pending_authorization: "Aguardando autorização",
  authorized: "Autorizado",
  paid: "Pago",
  rejected: "Rejeitado",
};

/** Valor que o lote de fato paga: o ajustado pelo aprovador, se houver. */
export const effectiveAmount = (
  t: Pick<Transaction, "amount" | "batchAdjustedAmount">,
) => t.batchAdjustedAmount ?? t.amount;

const sameEmail = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Segregação de funções: só a pessoa designada aprova/autoriza, e nunca quem
 * criou o lote. As regras do Firestore repetem a mesma checagem.
 */
export function canActOnBatch(
  batch: Pick<
    PaymentBatch,
    "status" | "createdBy" | "approverEmail" | "authorizerEmail"
  >,
  actor: BatchActor,
): boolean {
  if (actor.uid === batch.createdBy) return false;
  if (batch.status === "pending_approval")
    return sameEmail(batch.approverEmail, actor.email);
  if (batch.status === "pending_authorization")
    return sameEmail(batch.authorizerEmail, actor.email);
  return false;
}

function assertStatus(data: DocumentData, allowed: PaymentBatchStatus[]): void {
  if (!allowed.includes(data.status)) {
    throw new Error(
      `O lote está "${STATUS_NAMES[data.status as PaymentBatchStatus] ?? data.status}" e não aceita esta ação. Atualize a página.`,
    );
  }
}

/** writeBatch aceita até 500 operações; lotes grandes vão em partes. */
async function commitInChunks(
  updates: Array<[DocumentReference, DocumentData]>,
): Promise<void> {
  for (let i = 0; i < updates.length; i += 500) {
    const wb = writeBatch(db);
    updates.slice(i, i + 500).forEach(([ref, data]) => wb.update(ref, data));
    await wb.commit();
  }
}

/**
 * Troca o status do lote só se ele ainda estiver num dos `from`. Roda em
 * transação: dois cliques (ou duas abas) não executam a mesma etapa duas vezes.
 */
async function transitionBatch(
  batchId: string,
  from: PaymentBatchStatus[],
  update: (data: DocumentData) => DocumentData,
): Promise<DocumentData> {
  const ref = doc(db, COLLECTION_NAME, batchId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Lote não encontrado.");
    const data = snap.data();
    assertStatus(data, from);
    tx.update(ref, { ...update(data), updatedAt: serverTimestamp() });
    return data;
  });
}

async function loadBatch(batchId: string): Promise<DocumentData> {
  const snap = await getDoc(doc(db, COLLECTION_NAME, batchId));
  if (!snap.exists()) throw new Error("Lote não encontrado.");
  return snap.data();
}

const batchTransactions = (batchId: string) =>
  getDocs(
    query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    ),
  );

const logBatch = (
  companyId: string,
  actor: BatchActor,
  action: Parameters<typeof auditService.log>[0]["action"],
  batchId: string,
  details: Record<string, unknown>,
) =>
  auditService.log({
    companyId,
    userId: actor.uid,
    userEmail: actor.email,
    action,
    entity: "batch",
    entityId: batchId,
    details,
  });

const convertDates = (data: DocumentData): PaymentBatch => {
  return {
    id: data.id,
    ...data,
    approvedAt: (data.approvedAt as Timestamp)?.toDate(),
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
    sentForApprovalAt: (data.sentForApprovalAt as Timestamp)?.toDate(),
    sentForAuthorizationAt: (
      data.sentForAuthorizationAt as Timestamp
    )?.toDate(),
    authorizedAt: (data.authorizedAt as Timestamp)?.toDate(),
    paidAt: (data.paidAt as Timestamp)?.toDate(),
    revertedAt: (data.revertedAt as Timestamp)?.toDate(),
    returnedAt: (data.returnedAt as Timestamp)?.toDate(),
    approvalTokenExpiresAt: (
      data.approvalTokenExpiresAt as Timestamp
    )?.toDate(),
    startDate: (data.startDate as Timestamp)?.toDate(),
    endDate: (data.endDate as Timestamp)?.toDate(),
  } as PaymentBatch;
};

const hashToken = async (token: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const paymentBatchService = {
  checkAndFinalizeBatch: async (batchId: string, userId: string) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) return;

    const batchData = batchSnap.data() as PaymentBatch;
    if (batchData.status === "paid") return; // Already paid

    // Check all transactions
    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("batchId", "==", batchId),
    );
    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Transaction,
    );

    const allPaid = transactions.every((t) => t.status === "paid");

    if (allPaid && transactions.length > 0) {
      // Auto-close batch
      const batch = writeBatch(db);
      batch.update(batchRef, {
        status: "paid",
        paidBy: userId,
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
  },

  getAll: async (
    companyId: string,
    pageSize: number = 20,
    lastDoc: QueryDocumentSnapshot<DocumentData> | null = null,
    statuses: PaymentBatchStatus[] = [],
  ): Promise<{
    batches: PaymentBatch[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    let q = query(
      collection(db, COLLECTION_NAME),
      where("companyId", "==", companyId),
      orderBy("createdAt", "desc"),
    );

    if (statuses.length === 1) {
      q = query(q, where("status", "==", statuses[0]));
    } else if (statuses.length > 1) {
      q = query(q, where("status", "in", statuses));
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    q = query(q, limit(pageSize));

    const snapshot = await getDocs(q);
    const batches = snapshot.docs.map((doc) =>
      convertDates({ id: doc.id, ...doc.data() }),
    );

    return {
      batches,
      lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  },

  /**
   * Todos os lotes ainda em andamento (abertos até autorizados). A tela divide
   * entre "com você" e "aguardando" e ordena por vencimento no cliente, então
   * precisa do conjunto inteiro, não de uma página.
   */
  getActive: async (companyId: string): Promise<PaymentBatch[]> => {
    // ponytail: teto de ACTIVE_BATCH_LIMIT lotes ativos; acima disso, paginar com orderBy("startDate")
    const snapshot = await getDocs(
      query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        where("status", "in", ACTIVE_STATUSES),
        limit(ACTIVE_BATCH_LIMIT),
      ),
    );
    return snapshot.docs.map((d) => convertDates({ id: d.id, ...d.data() }));
  },

  /**
   * Quantidade e total por status, de todos os lotes da empresa (não só da
   * página carregada). Agregação no servidor; sem o índice publicado, soma em
   * memória.
   */
  getStatusSummary: async (
    companyId: string,
  ): Promise<Record<PaymentBatchStatus, { count: number; total: number }>> => {
    const entries = await Promise.all(
      BATCH_STATUSES.map(async (status) => {
        const q = query(
          collection(db, COLLECTION_NAME),
          where("companyId", "==", companyId),
          where("status", "==", status),
        );
        try {
          const snap = await getAggregateFromServer(q, {
            count: count(),
            total: sum("totalAmount"),
          });
          return [
            status,
            {
              count: snap.data().count,
              total: currency(snap.data().total || 0).value,
            },
          ] as const;
        } catch (error) {
          console.warn(
            "Agregação de lotes indisponível; somando em memória.",
            error,
          );
          const snap = await getDocs(query(q, limit(2000)));
          return [
            status,
            {
              count: snap.size,
              total: snap.docs.reduce(
                (acc, d) => acc.add(d.data().totalAmount || 0),
                currency(0),
              ).value,
            },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(entries) as Record<
      PaymentBatchStatus,
      { count: number; total: number }
    >;
  },

  getById: async (id: string): Promise<PaymentBatch | null> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    return convertDates({ id: snapshot.id, ...snapshot.data() });
  },

  create: async (
    name: string,
    companyId: string,
    createdBy: string,
    startDate?: Date,
    endDate?: Date,
  ) => {
    // Create the batch
    const batchRef = await addDoc(collection(db, COLLECTION_NAME), {
      name,
      companyId,
      createdBy,
      status: "open",
      transactionIds: [],
      totalAmount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      startDate: startDate || null,
      endDate: endDate || null,
    });

    // If dates are provided, auto-add draft transactions
    if (startDate && endDate) {
      try {
        const q = query(
          collection(db, TRANSACTIONS_COLLECTION),
          where("companyId", "==", companyId),
          where("type", "==", "payable"),
          where("status", "==", "draft"),
          where("dueDate", ">=", startDate),
          where("dueDate", "<=", endDate),
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction)
          .filter((t) => !t.batchId); // Only add if not already in a batch

        if (transactions.length > 0) {
          await paymentBatchService.addTransactions(batchRef.id, transactions);
        }
      } catch (error) {
        console.error("Error auto-adding transactions to batch:", error);
        // We don't fail the batch creation if auto-add fails,
        // but maybe we should notify/throw?
        // For now logging is safer to avoid breaking the main flow.
      }
    }

    return batchRef;
  },

  update: async (id: string, data: Partial<PaymentBatch>) => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Add transactions with automatic re-approval flow for approved batches.
   *
   * When the batch is already "approved" and has an approverEmail, this reverts
   * it to "pending_approval" with a new token so the original approver must
   * review and re-approve. Returns the token and approver info so the caller
   * can send the notification email.
   *
   * If the batch is already "pending_approval" (e.g., a previous addition
   * already triggered this flow), transactions are added silently — no new
   * token or email is needed since the existing link still covers everything.
   */
  addTransactionsWithApprovalCheck: async (
    batchId: string,
    transactions: Transaction[],
  ): Promise<{
    token?: string;
    approverEmail?: string;
    batchName?: string;
    additionalAmount: number;
    newTransactionCount: number;
  }> => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    const existingIds = new Set(batchData.transactionIds);
    const uniqueTransactions = transactions.filter(
      (t) => !existingIds.has(t.id),
    );

    if (uniqueTransactions.length === 0) {
      return { newTransactionCount: 0, additionalAmount: 0 };
    }

    const newIds = uniqueTransactions.map((t) => t.id);
    const additionalAmount = uniqueTransactions.reduce(
      (acc, t) => acc.add(t.amount),
      currency(0),
    ).value;

    const shouldRevert =
      batchData.status === "approved" && !!batchData.approverEmail;

    let token: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchUpdate: any = {
      transactionIds: [...batchData.transactionIds, ...newIds],
      totalAmount: currency(batchData.totalAmount).add(additionalAmount).value,
      updatedAt: serverTimestamp(),
    };

    if (shouldRevert) {
      token = crypto.randomUUID();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48);

      batchUpdate.status = "pending_approval";
      batchUpdate.approvalTokenHash = tokenHash;
      batchUpdate.approvalToken = null;
      batchUpdate.approvalTokenExpiresAt = expiresAt;
      batchUpdate.sentForApprovalAt = serverTimestamp();
    }

    const wb = writeBatch(db);
    wb.update(batchRef, batchUpdate);
    uniqueTransactions.forEach((t) => {
      wb.update(doc(db, TRANSACTIONS_COLLECTION, t.id), { batchId });
    });
    await wb.commit();

    return {
      token,
      approverEmail: shouldRevert ? batchData.approverEmail : undefined,
      batchName: shouldRevert ? batchData.name : undefined,
      additionalAmount,
      newTransactionCount: uniqueTransactions.length,
    };
  },

  addTransactions: async (batchId: string, transactions: Transaction[]) => {
    const held = transactions.filter((t) => t.paymentHold);
    if (held.length > 0) {
      throw new Error(
        `${held.length} conta(s) com pagamento bloqueado não podem entrar em lote.`,
      );
    }

    const batch = writeBatch(db);
    const batchRef = doc(db, COLLECTION_NAME, batchId);

    // Get current batch to calculate new total
    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    // Filter out transactions that are already in the batch
    const existingIds = new Set(batchData.transactionIds);
    const uniqueTransactions = transactions.filter(
      (t) => !existingIds.has(t.id),
    );

    if (uniqueTransactions.length === 0) {
      return; // All transactions are already in the batch
    }

    const newIds = uniqueTransactions.map((t) => t.id);
    const additionalAmount = uniqueTransactions.reduce(
      (acc, t) => acc.add(t.amount),
      currency(0),
    ).value;

    // Update Batch
    batch.update(batchRef, {
      transactionIds: [...batchData.transactionIds, ...newIds],
      totalAmount: currency(batchData.totalAmount).add(additionalAmount).value,
      updatedAt: serverTimestamp(),
    });

    // Update Transactions
    uniqueTransactions.forEach((t) => {
      const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
      batch.update(tRef, { batchId: batchId });
    });

    await batch.commit();
  },

  delete: async (batchId: string, actor: BatchActor) => {
    const batchRef = doc(db, COLLECTION_NAME, batchId);
    const batchData = await loadBatch(batchId);
    assertStatus(batchData, ["open"]);

    // A consulta por batchId é mais confiável que o array para desvincular
    const transactionsSnap = await batchTransactions(batchId);
    await commitInChunks(
      transactionsSnap.docs.map((tDoc) => [
        tDoc.ref,
        { batchId: deleteField() },
      ]),
    );

    const wb = writeBatch(db);
    wb.delete(batchRef);
    await wb.commit();

    logBatch(batchData.companyId, actor, "delete", batchId, {
      name: batchData.name,
      transactionCount: transactionsSnap.size,
      totalAmount: batchData.totalAmount,
    });
  },

  removeTransactions: async (batchId: string, transactions: Transaction[]) => {
    const batch = writeBatch(db);
    const batchRef = doc(db, COLLECTION_NAME, batchId);

    const batchSnap = await getDoc(batchRef);
    if (!batchSnap.exists()) throw new Error("Batch not found");
    const batchData = batchSnap.data() as PaymentBatch;

    const idsToRemove = new Set(transactions.map((t) => t.id));
    const newIds = batchData.transactionIds.filter(
      (id) => !idsToRemove.has(id),
    );
    const amountToRemove = transactions.reduce(
      (acc, t) => acc.add(effectiveAmount(t)),
      currency(0),
    );

    batch.update(batchRef, {
      transactionIds: newIds,
      totalAmount: Math.max(
        0,
        currency(batchData.totalAmount).subtract(amountToRemove).value,
      ),
      updatedAt: serverTimestamp(),
    });

    transactions.forEach((t) => {
      const tRef = doc(db, TRANSACTIONS_COLLECTION, t.id);
      batch.update(tRef, { batchId: null }); // Or delete field
    });

    await batch.commit();
  },

  /**
   * Envia (ou reenvia, com link novo) o lote ao aprovador.
   */
  sendForApproval: async (
    batchId: string,
    approver: { email: string; name?: string },
    actor: BatchActor,
  ): Promise<string> => {
    if (sameEmail(approver.email, actor.email)) {
      throw new Error("Você não pode ser o aprovador de um lote que enviou.");
    }

    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const data = await transitionBatch(
      batchId,
      ["open", "pending_approval"],
      () => ({
        status: "pending_approval",
        approverId: approver.email,
        approverEmail: approver.email,
        approverName: approver.name || null,
        approvalTokenHash: tokenHash,
        approvalToken: null,
        approvalTokenExpiresAt: expiresAt,
        sentForApprovalAt: serverTimestamp(),
        returnReason: null,
      }),
    );

    logBatch(data.companyId, actor, "update", batchId, {
      sentForApproval: true,
      approverEmail: approver.email,
      resent: data.status === "pending_approval",
    });
    return token;
  },

  /** Primeiro vencimento, alertas e os 3 maiores itens, para o e-mail ao aprovador. */
  approvalEmailContext: async (batchId: string) => {
    const txs = (await batchTransactions(batchId)).docs.map(
      (d) => d.data() as Transaction,
    );
    const due = (t: Transaction) =>
      (t.dueDate as unknown as Timestamp)?.toDate();
    const dueDates = txs
      .map(due)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    const brl = (v: number) =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(v);

    const today = startOfDay(new Date());

    return {
      firstDueDate: dueDates[0] ? format(dueDates[0], "dd/MM/yyyy") : undefined,
      overdueCount: dueDates.filter((d) => d < today).length,
      budgetExceededCount: txs.filter((t) => t.budgetExceeded).length,
      topItems: [...txs]
        .sort((a, b) => effectiveAmount(b) - effectiveAmount(a))
        .slice(0, 3)
        .map((t) => {
          const d = due(t);
          return {
            supplier: t.supplierOrClient || t.description,
            amount: brl(effectiveAmount(t)),
            dueDate: d ? format(d, "dd/MM") : "",
          };
        }),
    };
  },

  /**
   * Gestor recolhe um envio: o link deixa de valer e o lote volta à etapa
   * anterior (aprovação → Aberto, autorização → Aprovado).
   */
  recall: async (batchId: string, actor: BatchActor) => {
    const data = await transitionBatch(
      batchId,
      ["pending_approval", "pending_authorization"],
      (current) => ({
        status: current.status === "pending_approval" ? "open" : "approved",
        approvalTokenHash: null,
        approvalToken: null,
        approvalTokenExpiresAt: null,
      }),
    );
    logBatch(data.companyId, actor, "update", batchId, {
      recalledFrom: data.status,
    });
  },

  /**
   * Aprovador devolve o lote inteiro ao gestor, com motivo. Mesmo efeito da
   * devolução pelo magic link.
   */
  returnToManager: async (
    batchId: string,
    actor: BatchActor,
    reason: string,
  ) => {
    if (!reason.trim()) throw new Error("Informe o motivo da devolução.");
    const data = await transitionBatch(
      batchId,
      ["pending_approval"],
      (current) => {
        if (!canActOnBatch(current as PaymentBatch, actor)) {
          throw new Error(
            "Só o aprovador designado pode devolver este lote, e nunca quem o criou.",
          );
        }
        return {
          status: "open",
          approvalTokenHash: null,
          approvalToken: null,
          approvalTokenExpiresAt: null,
          approverId: null,
          approverEmail: null,
          approverComment: `Devolvido: ${reason.trim()}`,
          returnReason: reason.trim(),
          returnedAt: serverTimestamp(),
        };
      },
    );
    logBatch(data.companyId, actor, "update", batchId, {
      returnedToManager: true,
      reason: reason.trim(),
    });
  },

  /**
   * Aprova o lote. Ajustes de valor e rejeições de itens só são gravados aqui,
   * junto com a aprovação: fechar o diálogo sem aprovar não deixa rastro.
   */
  approveWithDetails: async (
    batchId: string,
    actor: BatchActor,
    comment?: string,
    adjustments: Array<{
      id: string;
      adjustedAmount: number;
      reason: string;
    }> = [],
    rejections: Array<{ id: string; reason: string }> = [],
  ) => {
    const before = await loadBatch(batchId);
    assertStatus(before, ["pending_approval"]);
    if (!canActOnBatch(before as PaymentBatch, actor)) {
      throw new Error(
        "Só o aprovador designado pode aprovar este lote, e nunca quem o criou.",
      );
    }

    const adjusted = new Map(adjustments.map((a) => [a.id, a]));
    const rejected = new Map(rejections.map((r) => [r.id, r.reason]));

    const tSnap = await batchTransactions(batchId);
    let total = currency(0);
    const updates: Array<[DocumentReference, DocumentData]> = [];
    const adjustmentLog: Array<Record<string, unknown>> = [];
    tSnap.docs.forEach((tDoc) => {
      const t = tDoc.data() as Transaction;
      const reason = rejected.get(tDoc.id);
      if (reason) {
        updates.push([
          tDoc.ref,
          { batchId: null, batchRejectionReason: reason, status: "draft" },
        ]);
        return;
      }
      const adj = adjusted.get(tDoc.id);
      // Aprovador só reduz, e diz por quê (mesma regra do link mágico)
      if (
        adj &&
        (!(adj.adjustedAmount > 0) ||
          adj.adjustedAmount > effectiveAmount(t) ||
          !adj.reason?.trim())
      ) {
        throw new Error(
          `Redução inválida em "${t.description}": o valor só pode diminuir e precisa de motivo.`,
        );
      }
      const amount = adj?.adjustedAmount ?? effectiveAmount(t);
      total = total.add(amount);
      if (adj) {
        adjustmentLog.push({
          transactionId: tDoc.id,
          from: effectiveAmount(t),
          to: amount,
          reason: adj.reason.trim(),
        });
      }
      updates.push([
        tDoc.ref,
        {
          status: "approved",
          approvedBy: actor.uid,
          approvedAt: serverTimestamp(),
          ...(adj
            ? {
                batchAdjustedAmount: amount,
                batchAdjustmentReason: adj.reason.trim(),
              }
            : {}),
        },
      ]);
    });

    await commitInChunks(updates);

    await transitionBatch(batchId, ["pending_approval"], (data) => ({
      status: "approved",
      approvedBy: actor.uid,
      approvedAt: serverTimestamp(),
      approvalTokenHash: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
      totalAmount: total.value,
      transactionIds: (data.transactionIds as string[]).filter(
        (id) => !rejected.has(id),
      ),
      rejectedTransactionIds: [
        ...(data.rejectedTransactionIds ?? []),
        ...rejected.keys(),
      ],
      // Sem comentário, apaga o de uma devolução anterior
      approverComment: comment ?? null,
    }));

    logBatch(before.companyId, actor, "approve", batchId, {
      totalAmount: total.value,
      adjustments: adjustmentLog,
      rejections: [...rejected].map(([transactionId, reason]) => ({
        transactionId,
        reason,
      })),
      ...(comment ? { comment } : {}),
    });
  },

  /**
   * Envia (ou reenvia, com link novo) o lote para autorização.
   */
  sendForAuthorization: async (
    batchId: string,
    authorizer: { email: string; name?: string },
    actor: BatchActor,
  ): Promise<string> => {
    if (sameEmail(authorizer.email, actor.email)) {
      throw new Error("Você não pode ser o autorizador de um lote que enviou.");
    }

    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const data = await transitionBatch(
      batchId,
      ["approved", "pending_authorization"],
      () => ({
        status: "pending_authorization",
        authorizerId: authorizer.email,
        authorizerEmail: authorizer.email,
        authorizerName: authorizer.name || null,
        approvalTokenHash: tokenHash,
        approvalToken: null,
        approvalTokenExpiresAt: expiresAt,
        sentForAuthorizationAt: serverTimestamp(),
      }),
    );

    logBatch(data.companyId, actor, "update", batchId, {
      sentForAuthorization: true,
      authorizerEmail: authorizer.email,
      resent: data.status === "pending_authorization",
    });
    return token;
  },

  /**
   * Autorizador confirma que o lote foi liberado no banco.
   */
  confirmAuthorization: async (batchId: string, actor: BatchActor) => {
    const data = await transitionBatch(
      batchId,
      ["pending_authorization"],
      (current) => {
        if (!canActOnBatch(current as PaymentBatch, actor)) {
          throw new Error(
            "Só o autorizador designado pode autorizar este lote, e nunca quem o criou.",
          );
        }
        return {
          status: "authorized",
          authorizedBy: actor.uid,
          authorizedAt: serverTimestamp(),
          approvalTokenHash: null,
          approvalToken: null,
          approvalTokenExpiresAt: null,
        };
      },
    );

    logBatch(data.companyId, actor, "authorize", batchId, {
      totalAmount: data.totalAmount,
    });
  },

  /**
   * Gestor confirma que todos os pagamentos do lote saíram. As transações vão
   * primeiro (idempotente, em partes); a troca de status do lote vem por
   * último e só acontece uma vez.
   */
  confirmPayments: async (
    batchId: string,
    actor: BatchActor,
  ): Promise<{ count: number; total: number }> => {
    assertStatus(await loadBatch(batchId), ["authorized"]);

    const tSnap = await batchTransactions(batchId);
    await commitInChunks(
      tSnap.docs.map((tDoc) => [
        tDoc.ref,
        {
          status: "paid",
          releasedBy: actor.uid,
          releasedAt: serverTimestamp(),
        },
      ]),
    );

    const data = await transitionBatch(batchId, ["authorized"], () => ({
      status: "paid",
      paidBy: actor.uid,
      paidAt: serverTimestamp(),
    }));

    logBatch(data.companyId, actor, "pay", batchId, {
      transactionCount: tSnap.size,
      totalAmount: data.totalAmount,
    });
    return { count: tSnap.size, total: data.totalAmount };
  },

  /**
   * Desfaz uma confirmação de pagamento errada: lote volta a Aberto e as
   * transações a Rascunho. O motivo e o histórico ficam no log de auditoria.
   */
  revertToOpen: async (
    batchId: string,
    actor: BatchActor,
    reason: string,
  ): Promise<void> => {
    if (!reason.trim()) throw new Error("Informe o motivo da reversão.");
    const before = await loadBatch(batchId);
    assertStatus(before, ["paid"]);

    const tSnap = await batchTransactions(batchId);
    await commitInChunks(
      tSnap.docs.map((tDoc) => [
        tDoc.ref,
        {
          status: "draft",
          releasedBy: deleteField(),
          releasedAt: deleteField(),
        },
      ]),
    );

    await transitionBatch(batchId, ["paid"], () => ({
      status: "open",
      paidBy: deleteField(),
      paidAt: deleteField(),
      revertedBy: actor.uid,
      revertedAt: serverTimestamp(),
      revertReason: reason.trim(),
    }));

    logBatch(before.companyId, actor, "update", batchId, {
      revertedFromPaid: true,
      reason: reason.trim(),
      paidBy: before.paidBy,
      paidAt: (before.paidAt as Timestamp)?.toDate().toISOString(),
      approvedBy: before.approvedBy,
      authorizedBy: before.authorizedBy,
      transactionCount: tSnap.size,
      totalAmount: before.totalAmount,
    });
  },

  /**
   * Aceita uma sugestão automática de lote gerada pela Cloud Function noturna.
   *
   * Cria o PaymentBatch oficial e vincula as transações sugeridas
   * de forma atômica (writeBatch), sem download individual de cada
   * documento de transação.
   *
   * Retorna a referência do PaymentBatch criado para redirect.
   */
  acceptSuggested: async (
    name: string,
    companyId: string,
    createdBy: string,
    transactionIds: string[],
  ): Promise<{ id: string }> => {
    if (transactionIds.length === 0) {
      throw new Error("A sugestão não contém transações.");
    }

    // 1 — Cria o PaymentBatch
    const batchDocRef = await addDoc(collection(db, COLLECTION_NAME), {
      name,
      companyId,
      createdBy,
      status: "open",
      transactionIds,
      totalAmount: 0, // será recalculado abaixo
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      startDate: null,
      endDate: null,
    });

    // 2 — Vincula as transações e soma o totalAmount atomicamente
    // Firestore writeBatch suporta até 500 ops; sugestões normalmente têm << 500 itens.
    const CHUNK_SIZE = 499; // 1 slot reservado para a atualização do batch doc

    let totalAmount = 0;

    for (let i = 0; i < transactionIds.length; i += CHUNK_SIZE) {
      const chunk = transactionIds.slice(i, i + CHUNK_SIZE);
      const wb = writeBatch(db);

      // Busca os amounts deste chunk em paralelo (leitura, não escrita)
      const snapshots = await Promise.all(
        chunk.map((id) => getDoc(doc(db, TRANSACTIONS_COLLECTION, id))),
      );

      let chunkAmount = 0;
      snapshots.forEach((snap, idx) => {
        if (!snap.exists()) return;
        const amount = Number(snap.data().amount ?? 0);
        chunkAmount += amount;
        wb.update(doc(db, TRANSACTIONS_COLLECTION, chunk[idx]), {
          batchId: batchDocRef.id,
        });
      });

      totalAmount += chunkAmount;
      await wb.commit();
    }

    // 3 — Atualiza o totalAmount real no batch doc
    await updateDoc(batchDocRef, {
      totalAmount,
      updatedAt: serverTimestamp(),
    });

    return { id: batchDocRef.id };
  },
};
