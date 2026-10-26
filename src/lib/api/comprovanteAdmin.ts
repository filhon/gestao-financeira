/**
 * Operações server-side (Admin SDK) de comprovantes, compartilhadas pelo
 * pipeline de upload e pela confirmação automática do acumulado.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { Entity, Transaction } from "@/lib/types";
import { autoConfirmReason, type MatchScore } from "@/lib/matching";

interface RawTransaction {
  companyId: string;
  type: string;
  status: string;
  amount: number;
  finalAmount?: number;
  discount?: number;
  interest?: number;
  description: string;
  notes?: string;
  details?: string;
  barcode?: string;
  paymentMethod?: Transaction["paymentMethod"];
  supplierOrClient?: string;
  entityId?: string;
  comprovanteId?: string;
  paymentDate?: FirebaseFirestore.Timestamp;
  dueDate?: FirebaseFirestore.Timestamp;
}

/**
 * Candidatos ao match: pagáveis já pagos ou autorizados.
 *
 * Traz todos os campos que o motor usa como evidência — `barcode` (linha
 * digitável), `notes`/`details` (nº de NF), juros/desconto (o valor do
 * comprovante costuma ser o ajustado) e `comprovanteId` (para despriorizar
 * transações já conciliadas).
 */
export async function fetchCandidateTransactions(
  companyId: string,
): Promise<Transaction[]> {
  const snap = await adminDb
    .collection("transactions")
    .where("companyId", "==", companyId)
    .where("type", "==", "payable")
    .where("status", "in", ["paid", "authorized"])
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as RawTransaction;
    return {
      id: d.id,
      companyId: data.companyId,
      type: "payable",
      status: data.status as Transaction["status"],
      amount: data.amount,
      finalAmount: data.finalAmount,
      discount: data.discount,
      interest: data.interest,
      description: data.description,
      notes: data.notes,
      details: data.details,
      barcode: data.barcode,
      paymentMethod: data.paymentMethod,
      supplierOrClient: data.supplierOrClient,
      entityId: data.entityId,
      comprovanteId: data.comprovanteId,
      paymentDate: data.paymentDate?.toDate(),
      dueDate: data.dueDate?.toDate() ?? new Date(),
      createdBy: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Transaction;
  });
}

/**
 * Cadastro de entidades da empresa — habilita o match por CNPJ/CPF,
 * chave Pix e agência/conta, que são os sinais decisivos num comprovante.
 */
export async function fetchEntities(companyId: string): Promise<Entity[]> {
  const snap = await adminDb
    .collection("entities")
    .where("companyId", "==", companyId)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      companyId: data.companyId,
      name: data.name ?? "",
      type: data.type ?? "company",
      document: data.document,
      category: data.category ?? "supplier",
      bankName: data.bankName,
      agency: data.agency,
      account: data.account,
      pixKey: data.pixKey,
      pixKeyType: data.pixKeyType,
      autoConfirmReceipts: data.autoConfirmReceipts === true,
      receiptAliases: data.receiptAliases,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Entity;
  });
}

/** Evidência que fica no documento para a UI explicar a sugestão. */
export function signalsForStorage(best: MatchScore) {
  return {
    entityEvidence: best.signals.entityEvidence,
    penalties: best.signals.penalties,
    ...(best.signals.amountDelta != null && {
      amountDelta: best.signals.amountDelta,
    }),
  };
}

/**
 * Outro comprovante com o mesmo valor, data e beneficiário lidos.
 * Só igualdades: o Firestore resolve com os índices simples, sem composto.
 */
export async function findPossibleDuplicate(
  companyId: string,
  best: MatchScore,
  excludeId?: string,
): Promise<{ id: string; createdAt?: Date } | null> {
  if (best.matchedAmount == null || !best.matchedDate) return null;
  const snap = await adminDb
    .collection("comprovantes")
    .where("companyId", "==", companyId)
    .where("matchedAmount", "==", best.matchedAmount)
    .where("matchedDate", "==", Timestamp.fromDate(best.matchedDate))
    .limit(5)
    .get();
  const same = snap.docs.find((d) => {
    if (d.id === excludeId) return false;
    const data = d.data();
    const ids: string[] =
      data.transactionIds ?? data.suggestedTransactionIds ?? [];
    return (
      ids.some((id) => best.transactionIds.includes(id)) ||
      (!!best.matchedEntity && data.matchedEntity === best.matchedEntity)
    );
  });
  return same
    ? { id: same.id, createdAt: (same.get("createdAt") as Timestamp)?.toDate() }
    : null;
}

/** A regra estrita, com o cadastro do fornecedor e transações já usadas. */
export function evaluateAutoConfirm(
  best: MatchScore,
  candidates: Transaction[],
  entities: Entity[],
  opts: { possibleDuplicate: boolean; usedTransactionIds?: Set<string> },
): string | null {
  const members = best.transactionIds.map((id) =>
    candidates.find((t) => t.id === id),
  );
  // Título que já tem comprovante, ou que outro comprovante desta mesma
  // rodada acabou de pegar, sempre passa por um humano.
  if (
    members.some(
      (t) => !t || !!t.comprovanteId || opts.usedTransactionIds?.has(t.id),
    )
  ) {
    return null;
  }
  const entityIds = new Set(members.map((t) => t!.entityId));
  const trustedSupplier =
    entityIds.size === 1 &&
    entities.some(
      (e) => e.id === members[0]!.entityId && e.autoConfirmReceipts === true,
    );
  return autoConfirmReason(best, {
    trustedSupplier,
    possibleDuplicate: opts.possibleDuplicate,
  });
}

/**
 * Grava a associação feita pela regra automática: comprovante, títulos e
 * auditoria no mesmo batch. A sugestão fica guardada para o "desfazer"
 * conseguir devolver o comprovante à fila.
 */
export async function commitAutoConfirm(params: {
  companyId: string;
  comprovanteRef: FirebaseFirestore.DocumentReference;
  best: MatchScore;
  storagePath: string;
  reason: string;
  actorUid: string;
  actorEmail: string;
  /** Campos extras do comprovante (ex.: searchText atualizado). */
  extra?: Record<string, unknown>;
}) {
  const { best, comprovanteRef } = params;
  const batch = adminDb.batch();

  batch.update(comprovanteRef, {
    matchStatus: "matched",
    transactionId: best.transactionId,
    transactionIds: best.transactionIds,
    isConsolidated: best.transactionIds.length > 1,
    autoConfirmed: true,
    autoConfirmReason: params.reason,
    reviewedBy: "auto",
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...params.extra,
  });

  for (const txId of best.transactionIds) {
    batch.update(adminDb.collection("transactions").doc(txId), {
      comprovanteId: comprovanteRef.id,
      comprovanteStoragePath: params.storagePath,
      comprovanteUrl: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  batch.set(adminDb.collection("audit_logs").doc(), {
    companyId: params.companyId,
    userId: params.actorUid,
    userEmail: params.actorEmail,
    action: "auto_confirm_match",
    entity: "comprovante",
    entityId: comprovanteRef.id,
    details: {
      transactionIds: best.transactionIds,
      storagePath: params.storagePath,
      reason: params.reason,
      score: best.score,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}
