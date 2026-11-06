import {
  DocumentData,
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import currency from "currency.js";
import { batchFingerprint } from "@/lib/email/replyApproval";
import { withPayeeAccount } from "@/lib/entityBankAccounts";
import { adminDb } from "@/lib/firebase/admin";
import { splitDescription } from "@/lib/transactionTabs";

const TRANSACTIONS = "transactions";
const ENTITIES = "entities";
const AUDIT_LOGS = "audit_logs";
/** Sem regra própria nas rules: cai no default deny, só o Admin SDK lê. */
export const CODES = "batch_approval_codes";

/** writeBatch aceita 500 operações: lote + código consumido + 498 transações. */
export const MAX_TRANSACTIONS = 498;

export type ApprovalAlert =
  | "budget_exceeded"
  | "first_payment"
  | "above_history"
  | "entity_changed"
  | "bank_changed"
  | "no_payment_data";

export const effectiveAmount = (td: DocumentData) =>
  (td.batchAdjustedAmount ?? td.amount ?? 0) as number;

export async function logAudit(entry: {
  companyId: string;
  userId: string;
  userEmail: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await adminDb.collection(AUDIT_LOGS).add({
      ...entry,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[batch-approval] audit log failed:", err);
  }
}

/** Onde o dinheiro vai cair, como o aprovador precisa conferir. */
function payTo(td: DocumentData, entity: DocumentData | undefined) {
  const barcode = (td.barcode as string | undefined)?.replace(/\D/g, "");
  if (td.paymentMethod === "boleto" || (!td.paymentMethod && barcode)) {
    return barcode ? `Boleto · final ${barcode.slice(-6)}` : null;
  }
  if (entity?.pixKey && td.paymentMethod !== "transfer") {
    return `Pix ${entity.pixKey}`;
  }
  if (entity?.account) {
    return [
      entity.bankName,
      entity.agency && `ag. ${entity.agency}`,
      `c/c ${entity.account}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (td.paymentMethod === "cash") return "Dinheiro";
  if (td.paymentMethod === "credit_card") return "Cartão de crédito";
  return null;
}

/** Descrição sem o sufixo "(Recorrência)"/"(3/12)", em minúsculas: a chave do histórico. */
const descriptionKey = (description: unknown) =>
  splitDescription(String(description ?? ""))
    .text.trim()
    .toLowerCase();

/**
 * Histórico pago do fornecedor, para os alertas de primeiro pagamento e de
 * valor acima do padrão.
 * ponytail: lê até 200 transações do fornecedor sem ordenar; se o histórico
 * passar disso, trocar por índice entityId+dueDate e pegar as mais recentes.
 */
async function paidHistory(companyId: string, entityId: string) {
  const snap = await adminDb
    .collection(TRANSACTIONS)
    .where("entityId", "==", entityId)
    .limit(200)
    .get();
  return snap.docs
    .map((d) => d.data())
    .filter((d) => d.companyId === companyId && d.status === "paid");
}

/**
 * Média do que já foi pago ao fornecedor pelo mesmo motivo (mesma conta do
 * plano ou, sem ela, mesma descrição). Por fornecedor só, a Receita Federal
 * misturava DARF, DAS e retenções numa média que não dizia nada.
 */
function comparableAverage(paid: DocumentData[], td: DocumentData) {
  const same = td.accountId
    ? (d: DocumentData) => d.accountId === td.accountId
    : (d: DocumentData) =>
        descriptionKey(d.description) === descriptionKey(td.description);
  const peers = paid.filter(same);
  // Três pagamentos dão uma média minimamente confiável
  if (peers.length < 3) return null;
  return peers
    .reduce((acc, d) => acc.add(effectiveAmount(d)), currency(0))
    .divide(peers.length).value;
}

/** Fornecedor, destino do dinheiro e alertas de cada transação do lote. */
export async function reviewTransactions(
  companyId: string,
  docs: QueryDocumentSnapshot[],
) {
  // Fornecedores do lote: cadastro e histórico, uma leitura por fornecedor
  const entityIds = [
    ...new Set(
      docs
        .map((d) => d.data().entityId as string | undefined)
        .filter((id): id is string => !!id),
    ),
  ];
  const [entitySnaps, histories] = await Promise.all([
    entityIds.length
      ? adminDb.getAll(
          ...entityIds.map((id) => adminDb.collection(ENTITIES).doc(id)),
        )
      : Promise.resolve([]),
    Promise.all(entityIds.map((id) => paidHistory(companyId, id))),
  ]);
  const entities = new Map(
    entitySnaps
      .filter((s) => s.exists && s.data()?.companyId === companyId)
      .map((s) => [s.id, s.data()!]),
  );
  const history = new Map(entityIds.map((id, i) => [id, histories[i]]));

  const now = Date.now();
  const DAY = 86_400_000;

  return docs.map((d) => {
    const td = d.data();
    const entity = td.entityId ? entities.get(td.entityId) : undefined;
    const hist = td.entityId ? history.get(td.entityId) : undefined;
    const amount = effectiveAmount(td);
    const destination = payTo(
      td,
      entity && withPayeeAccount(entity, td.entityBankAccountId),
    );
    const average = hist ? comparableAverage(hist, td) : null;
    const supplier: string | null = entity?.name ?? td.supplierOrClient ?? null;

    const alerts: ApprovalAlert[] = [];
    if (td.budgetExceeded) alerts.push("budget_exceeded");
    if (hist && hist.length === 0) alerts.push("first_payment");
    if (average !== null && amount > average * 1.5) {
      alerts.push("above_history");
    }
    const updatedAt = (entity?.updatedAt as Timestamp | undefined)?.toMillis();
    const createdAt = (entity?.createdAt as Timestamp | undefined)?.toMillis();
    const bankChangedAt = (
      entity?.bankDetailsChangedAt as Timestamp | undefined
    )?.toMillis();
    if (bankChangedAt && now - bankChangedAt <= 30 * DAY) {
      // Troca de conta recente é o padrão da fraude por e-mail falso
      alerts.push("bank_changed");
    } else if (
      updatedAt &&
      createdAt &&
      updatedAt - createdAt > DAY &&
      now - updatedAt <= 30 * DAY
    ) {
      alerts.push("entity_changed");
    }
    if (!destination) alerts.push("no_payment_data");

    return { doc: d, td, entity, supplier, amount, destination, average, alerts };
  });
}

const BR = "America/Sao_Paulo";
const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BR,
  day: "2-digit",
  month: "2-digit",
});
const fullDate = new Intl.DateTimeFormat("pt-BR", { timeZone: BR });
const isoDay = new Intl.DateTimeFormat("sv-SE", { timeZone: BR });
const time = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BR,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );

export type BatchReview = {
  firstDueDate?: string;
  overdueCount: number;
  budgetExceededCount: number;
  topItems: { supplier: string; amount: string; dueDate: string }[];
  alertCount: number;
  fingerprint: string;
  total: number;
  tooLarge: boolean;
};

/** Resumo do e-mail e dados da aprovação por resposta, sempre lidos do banco. */
export async function reviewBatch(
  batchId: string,
  companyId: string,
): Promise<BatchReview> {
  const snap = await adminDb
    .collection(TRANSACTIONS)
    .where("batchId", "==", batchId)
    .limit(MAX_TRANSACTIONS + 1)
    .get();
  const reviewed = await reviewTransactions(companyId, snap.docs);

  const due = (td: DocumentData) => (td.dueDate as Timestamp | undefined)?.toDate();
  const dueDates = reviewed
    .map((r) => due(r.td))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  const today = isoDay.format(new Date());

  return {
    firstDueDate: dueDates[0] ? fullDate.format(dueDates[0]) : undefined,
    overdueCount: dueDates.filter((d) => isoDay.format(d) < today).length,
    budgetExceededCount: reviewed.filter((r) => r.td.budgetExceeded).length,
    topItems: [...reviewed]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((r) => {
        const d = due(r.td);
        return {
          supplier: r.supplier || String(r.td.description ?? ""),
          amount: brl(r.amount),
          dueDate: d ? dayMonth.format(d) : "",
        };
      }),
    alertCount: reviewed.filter((r) => r.alerts.length > 0).length,
    fingerprint: batchFingerprint(
      reviewed.map((r) => ({ id: r.doc.id, amount: r.amount })),
    ),
    total: reviewed.reduce((sum, r) => sum.add(r.amount), currency(0)).value,
    tooLarge: snap.size > MAX_TRANSACTIONS,
  };
}

export const expiryLabel = (expiresAt: Date) =>
  `${dayMonth.format(expiresAt)} às ${time.format(expiresAt)}`;

/**
 * Grava a aprovação: link com código ou resposta por e-mail passam por aqui.
 * Só vale se ninguém mexeu no lote desde a leitura (`batchDoc.updateTime`).
 */
export async function commitBatchApproval({
  batchDoc,
  batchData,
  txDocs,
  tokenHash,
  rejected = new Map(),
  adjusted = new Map(),
  comment,
  via,
  auditDetails,
}: {
  batchDoc: QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot;
  batchData: DocumentData;
  txDocs: QueryDocumentSnapshot[];
  tokenHash: string;
  rejected?: Map<string, string>;
  adjusted?: Map<string, { to: number; reason: string }>;
  comment?: string;
  via: "magic-link" | "email-reply";
  auditDetails?: Record<string, unknown>;
}) {
  const approverId = (batchData.approverId as string) ?? "magic-link";
  const approverEmail =
    (batchData.approverEmail as string) ?? "magic-link@system";
  const approverLabel =
    (batchData.approverName as string | null) || approverEmail;
  const currentById = new Map(
    txDocs.map((d) => [d.id, effectiveAmount(d.data())]),
  );

  const fsWriteBatch = adminDb.batch();
  let total = currency(0);

  txDocs.forEach((tDoc) => {
    const reason = rejected.get(tDoc.id);
    if (reason) {
      fsWriteBatch.update(tDoc.ref, {
        batchId: null,
        batchRejectionReason: reason,
        status: "draft",
      });
      return;
    }
    const adj = adjusted.get(tDoc.id);
    total = total.add(adj?.to ?? currentById.get(tDoc.id)!);
    // Já paga (baixa avulsa, conciliação) fica como está: aprovar não desfaz pagamento
    if (tDoc.data().status === "paid") return;
    fsWriteBatch.update(tDoc.ref, {
      status: "approved",
      approvedBy: approverId,
      approvedAt: FieldValue.serverTimestamp(),
      ...(adj
        ? { batchAdjustedAmount: adj.to, batchAdjustmentReason: adj.reason }
        : {}),
    });
  });

  fsWriteBatch.update(
    batchDoc.ref,
    {
      status: "approved",
      approvedBy: approverId,
      approvedAt: FieldValue.serverTimestamp(),
      approvalTokenHash: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
      usedApprovalTokenHash: tokenHash,
      usedApprovalTokenBy: approverLabel,
      usedApprovalTokenAction: "approved",
      totalAmount: total.value,
      transactionIds: (
        (batchData.transactionIds as string[] | undefined) ?? []
      ).filter((id) => !rejected.has(id)),
      rejectedTransactionIds: [
        ...((batchData.rejectedTransactionIds as string[] | undefined) ?? []),
        ...rejected.keys(),
      ],
      // Sem comentário, apaga o de uma devolução anterior
      approverComment: comment ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { lastUpdateTime: batchDoc.updateTime },
  );
  fsWriteBatch.delete(adminDb.collection(CODES).doc(batchDoc.id));

  await fsWriteBatch.commit();

  await logAudit({
    companyId: batchData.companyId as string,
    userId: approverId,
    userEmail: approverEmail,
    action: "approve",
    entity: "batch",
    entityId: batchDoc.id,
    details: {
      via,
      transactionCount: currentById.size - rejected.size,
      totalAmount: total.value,
      adjustments: [...adjusted].map(([id, a]) => ({
        transactionId: id,
        from: currentById.get(id),
        to: a.to,
        reason: a.reason,
      })),
      rejections: [...rejected].map(([id, reason]) => ({
        transactionId: id,
        reason,
      })),
      ...(comment ? { comment } : {}),
      ...auditDetails,
    },
  });

  return {
    approvedCount: currentById.size - rejected.size,
    rejectedCount: rejected.size,
    totalAmount: total.value,
  };
}
