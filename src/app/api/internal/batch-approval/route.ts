/**
 * POST /api/internal/batch-approval
 * GET  /api/internal/batch-approval?token=...
 *
 * Server-side handler for the approve-batch magic-link page.
 * Uses Admin SDK so Firestore rules are bypassed — the token IS the credential.
 * Token is validated (SHA-256 hash + expiration) server-side on every request.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  DocumentData,
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createElement } from "react";
import currency from "currency.js";
import { readLedgerBalances } from "@/lib/api/costCenterLedgerAdmin";
import { sendEmail } from "@/lib/email/sendEmail";
import { checkRateLimit } from "@/lib/rateLimit";
import { ApprovalCodeEmail } from "@/components/emails/EmailTemplates";
import {
  EnvelopeSnapshot,
  envelopeSnapshot,
} from "@/components/features/finance/EnvelopeLine";
import { CostCenter } from "@/lib/types";
import { withPayeeAccount } from "@/lib/entityBankAccounts";
import { splitDescription } from "@/lib/transactionTabs";
import { formatCnpj } from "@/lib/validations/cnpj";

const BATCHES = "payment_batches";
const TRANSACTIONS = "transactions";
const COST_CENTERS = "cost_centers";
const ENTITIES = "entities";
const AUDIT_LOGS = "audit_logs";
/** Sem regra própria nas rules: cai no default deny, só o Admin SDK lê. */
const CODES = "batch_approval_codes";

/** writeBatch aceita 500 operações: lote + código consumido + 498 transações. */
const MAX_TRANSACTIONS = 498;

const CODE_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;

type ApprovalAlert =
  | "budget_exceeded"
  | "first_payment"
  | "above_history"
  | "entity_changed"
  | "bank_changed"
  | "no_payment_data";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const toIso = (v: unknown) =>
  (v as Timestamp | undefined)?.toDate().toISOString() ?? null;

const effectiveAmount = (td: DocumentData) =>
  (td.batchAdjustedAmount ?? td.amount ?? 0) as number;

async function logAudit(entry: {
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

type LoadResult =
  | { doc: QueryDocumentSnapshot; data: DocumentData }
  | { error: string; status: number; code: string; extra?: object };

/** Lote em pending_approval cujo token é este; senão, o motivo de não ser. */
async function loadPendingBatch(token: string): Promise<LoadResult> {
  const hash = hashToken(token);
  const snap = await adminDb
    .collection(BATCHES)
    .where("approvalTokenHash", "==", hash)
    .limit(1)
    .get();

  if (snap.empty) {
    // Link já usado: aprovar/devolver apaga o hash, mas guarda o último usado
    const used = await adminDb
      .collection(BATCHES)
      .where("usedApprovalTokenHash", "==", hash)
      .limit(1)
      .get();
    if (!used.empty) {
      const d = used.docs[0].data();
      const returned = d.usedApprovalTokenAction === "returned";
      return {
        error: returned
          ? "Este lote foi devolvido ao gestor financeiro."
          : "Este lote já foi aprovado.",
        status: 409,
        code: returned ? "returned" : "approved",
        extra: {
          batchName: d.name ?? "",
          at: toIso(returned ? d.returnedAt : d.approvedAt),
          by: d.usedApprovalTokenBy ?? null,
        },
      };
    }
    return {
      error:
        "Este link não é mais válido. Ele pode ter sido substituído por um envio mais recente ou recolhido pelo gestor.",
      status: 404,
      code: "invalid",
    };
  }

  const batchDoc = snap.docs[0];
  const data = batchDoc.data();

  const expiresAt = data.approvalTokenExpiresAt as Timestamp | undefined;
  if (expiresAt && expiresAt.toDate() < new Date()) {
    return {
      error: "Link expirado. Peça ao gestor financeiro para reenviar o lote.",
      status: 410,
      code: "expired",
      extra: { batchName: data.name ?? "", at: toIso(expiresAt) },
    };
  }

  if (data.status !== "pending_approval") {
    return {
      error:
        "Este lote não está mais aguardando aprovação. Verifique com o gestor financeiro.",
      status: 409,
      code: "invalid",
    };
  }

  return { doc: batchDoc, data };
}

const codeHash = (batchId: string, code: string) =>
  createHash("sha256").update(`${batchId}:${code}`, "utf8").digest();

/** "fcbfilipe@gmail.com" → "fc•••@gmail.com" */
const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain ?? ""}`;
};

/**
 * Confere o código de confirmação. O documento fica preso ao token: reenviar o
 * lote gera outro link e invalida o código antigo.
 */
async function checkCode(
  batchId: string,
  tokenHash: string,
  code: unknown,
): Promise<string | null> {
  const ref = adminDb.collection(CODES).doc(batchId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (
      !d ||
      d.tokenHash !== tokenHash ||
      (d.expiresAt as Timestamp).toMillis() < Date.now()
    ) {
      return "Código expirado ou não solicitado. Peça um novo código.";
    }
    if (d.attempts >= CODE_MAX_ATTEMPTS) {
      return "Muitas tentativas erradas. Peça um novo código.";
    }
    const ok =
      typeof code === "string" &&
      /^\d{6}$/.test(code) &&
      timingSafeEqual(codeHash(batchId, code), Buffer.from(d.codeHash, "hex"));
    if (!ok) {
      tx.update(ref, { attempts: FieldValue.increment(1) });
      const left = CODE_MAX_ATTEMPTS - d.attempts - 1;
      return left > 0
        ? `Código incorreto. ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`}.`
        : "Código incorreto. Peça um novo código.";
    }
    return null;
  });
}

const errorResponse = (r: Extract<LoadResult, { error: string }>) =>
  NextResponse.json(
    { error: r.error, code: r.code, ...r.extra },
    { status: r.status },
  );

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

/** CNPJ/CPF com máscara; outro formato passa como veio. */
function formatDocument(doc: unknown) {
  if (typeof doc !== "string") return null;
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 14) return formatCnpj(digits);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return doc;
}

/** "Simples Nacional - DBM Consultoria Ltda" → "Simples Nacional", quando o fornecedor é a DBM. */
function withoutSupplier(text: string, supplier: string | null) {
  if (!supplier) return text;
  const name = supplier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = text
    .replace(new RegExp(`\\s*[-–·]\\s*${name}|${name}\\s*[-–·]\\s*`, "i"), "")
    .trim();
  return stripped || text;
}

/** Nome de arquivo gerado (UUID) não diz nada ao aprovador. */
const attachmentName = (name: unknown, i: number) =>
  typeof name === "string" &&
  name.trim() &&
  !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name)
    ? name
    : `Anexo ${i + 1}`;

// ---------------------------------------------------------------------------
// GET — load batch, transactions, and cost centers for the approval page
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Token é obrigatório.", code: "invalid" },
        { status: 400 },
      );
    }

    const result = await loadPendingBatch(token);
    if ("error" in result) return errorResponse(result);

    const { doc: batchDoc, data } = result;
    const companyId = data.companyId as string;

    const [txSnap, ccSnap, companySnap, creatorSnap] = await Promise.all([
      adminDb
        .collection(TRANSACTIONS)
        .where("batchId", "==", batchDoc.id)
        .limit(MAX_TRANSACTIONS + 1)
        .get(),
      adminDb
        .collection(COST_CENTERS)
        .where("companyId", "==", companyId)
        .select("name", "parentId")
        .get(),
      adminDb.collection("companies").doc(companyId).get(),
      data.createdBy
        ? adminDb
            .collection("users")
            .doc(data.createdBy as string)
            .get()
        : null,
    ]);

    // Fornecedores do lote: cadastro e histórico, uma leitura por fornecedor
    const entityIds = [
      ...new Set(
        txSnap.docs
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

    const transactions = txSnap.docs.map((d) => {
      const td = d.data();
      const entity = td.entityId ? entities.get(td.entityId) : undefined;
      const hist = td.entityId ? history.get(td.entityId) : undefined;
      const amount = effectiveAmount(td);
      const destination = payTo(
        td,
        entity && withPayeeAccount(entity, td.entityBankAccountId),
      );
      const average = hist ? comparableAverage(hist, td) : null;
      const supplier: string | null =
        entity?.name ?? td.supplierOrClient ?? null;

      const alerts: ApprovalAlert[] = [];
      if (td.budgetExceeded) alerts.push("budget_exceeded");
      if (hist && hist.length === 0) alerts.push("first_payment");
      if (average !== null && amount > average * 1.5) {
        alerts.push("above_history");
      }
      const updatedAt = (
        entity?.updatedAt as Timestamp | undefined
      )?.toMillis();
      const createdAt = (
        entity?.createdAt as Timestamp | undefined
      )?.toMillis();
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

      return {
        id: d.id,
        description: withoutSupplier(
          splitDescription(td.description ?? "").text,
          supplier,
        ),
        details: td.details ?? null,
        documentNumber: td.documentNumber ?? null,
        amount,
        dueDate: toIso(td.dueDate),
        costCenterId: td.costCenterId ?? null,
        supplier,
        supplierDocument: formatDocument(entity?.document),
        payTo: destination,
        attachments: ((td.attachments as DocumentData[] | undefined) ?? [])
          .filter((a) => a.url)
          .map((a, i) => ({
            name: attachmentName(a.name, i),
            url: a.url as string,
            type: (a.type as string | undefined) ?? null,
          })),
        historyAverage: average,
        entityUpdatedAt: alerts.includes("bank_changed")
          ? toIso(entity?.bankDetailsChangedAt)
          : alerts.includes("entity_changed")
            ? toIso(entity?.updatedAt)
            : null,
        alerts,
      };
    });

    const costCenters = ccSnap.docs.map((d) => {
      const cd = d.data();
      return {
        id: d.id,
        name: cd.name ?? "",
        parentId: cd.parentId ?? null,
      };
    });

    // Envelope de cada centro do lote, no exercício de cada vencimento
    const years = [
      ...new Set(
        transactions
          .map((t) => t.dueDate && new Date(t.dueDate).getFullYear())
          .filter((y): y is number => !!y),
      ),
    ];
    const batchCcIds = new Set(transactions.map((t) => t.costCenterId));
    const envelopes: Record<string, EnvelopeSnapshot[]> = {};
    try {
      const balancesByYear = await Promise.all(
        years.map((y) =>
          readLedgerBalances(
            companyId,
            costCenters as unknown as CostCenter[],
            y,
          ),
        ),
      );
      balancesByYear.forEach((balances, i) => {
        for (const ccId of batchCcIds) {
          const b = ccId ? balances[ccId] : undefined;
          if (b) {
            (envelopes[ccId!] ??= []).push(envelopeSnapshot(b, years[i]));
          }
        }
      });
    } catch (err) {
      // Árvore sem raiz única: o razão não fecha, a página segue sem envelope
      console.error("[batch-approval] envelope:", err);
    }

    const approverEmail = data.approverEmail as string | undefined;

    return NextResponse.json({
      batch: {
        id: batchDoc.id,
        name: data.name ?? "",
        companyName: companySnap.data()?.name ?? null,
        createdByName: creatorSnap?.data()?.displayName ?? null,
        sentAt: toIso(data.sentForApprovalAt),
        expiresAt: toIso(data.approvalTokenExpiresAt),
        tooLarge: txSnap.size > MAX_TRANSACTIONS,
        codeSentTo: approverEmail ? maskEmail(approverEmail) : null,
      },
      transactions: transactions.slice(0, MAX_TRANSACTIONS),
      costCenters,
      envelopes,
    });
  } catch (error) {
    console.error("[batch-approval] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — approve (com rejeições e reduções) | return
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, action } = body as { token?: string; action?: string };

    if (!token || !action) {
      return NextResponse.json(
        { error: "Token e ação são obrigatórios." },
        { status: 400 },
      );
    }

    const result = await loadPendingBatch(token);
    if ("error" in result) return errorResponse(result);

    const { doc: batchDoc, data: batchData } = result;

    const approverId: string = (batchData.approverId as string) ?? "magic-link";
    const approverEmail: string =
      (batchData.approverEmail as string) ?? "magic-link@system";
    const approverLabel =
      (batchData.approverName as string | null) || approverEmail;

    // Só passa se ninguém mexeu no lote desde a leitura (clique duplo, duas abas)
    const unchanged = { lastUpdateTime: batchDoc.updateTime };
    const tokenHash = hashToken(token);
    const codeRef = adminDb.collection(CODES).doc(batchDoc.id);

    // -----------------------------------------------------------------------
    // send-code — confirma que quem decide é o dono do e-mail, não quem
    // recebeu o link encaminhado
    // -----------------------------------------------------------------------
    if (action === "send-code") {
      const to = batchData.approverEmail as string | undefined;
      if (!to) {
        return NextResponse.json(
          {
            error:
              "Este lote não tem e-mail de aprovador. Peça ao gestor para reenviá-lo.",
          },
          { status: 400 },
        );
      }

      const prev = (await codeRef.get()).data();
      const tooSoon =
        prev?.tokenHash === tokenHash &&
        (prev.sentAt as Timestamp).toMillis() >
          Date.now() - CODE_RESEND_SECONDS * 1000;
      const limited = !checkRateLimit({
        maxRequests: 5,
        windowSeconds: 3600,
        identifier: `approval-code:${batchDoc.id}`,
      }).success;
      // O diálogo pede o código sozinho: se um acabou de sair, ele ainda vale
      if (tooSoon) {
        return NextResponse.json({
          sentTo: maskEmail(to),
          minutes: CODE_MINUTES,
          alreadySent: true,
        });
      }
      if (limited) {
        return NextResponse.json(
          { error: "Muitos códigos pedidos. Tente de novo mais tarde." },
          { status: 429 },
        );
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      await codeRef.set({
        companyId: batchData.companyId,
        tokenHash,
        codeHash: codeHash(batchDoc.id, code).toString("hex"),
        attempts: 0,
        sentAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + CODE_MINUTES * 60_000),
      });

      const company = await adminDb
        .collection("companies")
        .doc(batchData.companyId as string)
        .get();
      const sent = await sendEmail({
        to,
        subject: `Código de confirmação: ${batchData.name ?? "lote de pagamentos"}`,
        react: createElement(ApprovalCodeEmail, {
          code,
          batchName: (batchData.name as string) ?? "",
          companyName: company.data()?.name ?? null,
          minutes: CODE_MINUTES,
        }),
      });
      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.log(`[batch-approval] código simulado: ${code}`);
      }
      if (!sent.simulated && sent.error) {
        console.error("[batch-approval] envio do código:", sent.error);
        return NextResponse.json(
          { error: "Não foi possível enviar o código. Tente de novo." },
          { status: 502 },
        );
      }

      return NextResponse.json({
        sentTo: maskEmail(to),
        minutes: CODE_MINUTES,
      });
    }

    if (action !== "approve" && action !== "return") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const codeError = await checkCode(batchDoc.id, tokenHash, body.code);
    if (codeError) {
      return NextResponse.json(
        { error: codeError, codeError: true },
        { status: 401 },
      );
    }

    // -----------------------------------------------------------------------
    // approve
    // -----------------------------------------------------------------------
    if (action === "approve") {
      const comment: string | undefined = body.comment?.trim() || undefined;
      const adjustments: Array<{
        id: string;
        adjustedAmount: number;
        reason: string;
      }> = body.adjustments ?? [];
      const rejections: Array<{ id: string; reason: string }> =
        body.rejections ?? [];

      const allTxSnap = await adminDb
        .collection(TRANSACTIONS)
        .where("batchId", "==", batchDoc.id)
        .get();

      if (allTxSnap.size > MAX_TRANSACTIONS) {
        return NextResponse.json(
          {
            error: `Lotes com mais de ${MAX_TRANSACTIONS} transações precisam ser aprovados dentro do sistema.`,
          },
          { status: 400 },
        );
      }

      const currentById = new Map(
        allTxSnap.docs.map((d) => [d.id, effectiveAmount(d.data())]),
      );

      const rejected = new Map<string, string>();
      for (const r of rejections) {
        if (!currentById.has(r.id) || !r.reason?.trim()) {
          return NextResponse.json(
            { error: "Toda rejeição precisa de motivo." },
            { status: 400 },
          );
        }
        rejected.set(r.id, r.reason.trim());
      }
      if (rejected.size === currentById.size) {
        return NextResponse.json(
          {
            error:
              "Todas as transações foram rejeitadas. Use “Devolver ao gestor”.",
          },
          { status: 400 },
        );
      }

      // Redução só para baixo, com motivo, em transação deste lote
      const adjusted = new Map<string, { to: number; reason: string }>();
      for (const a of adjustments) {
        const current = currentById.get(a.id);
        if (
          current === undefined ||
          rejected.has(a.id) ||
          typeof a.adjustedAmount !== "number" ||
          !Number.isFinite(a.adjustedAmount) ||
          a.adjustedAmount <= 0 ||
          a.adjustedAmount > current ||
          !a.reason?.trim()
        ) {
          return NextResponse.json(
            { error: "Redução de valor inválida ou sem motivo." },
            { status: 400 },
          );
        }
        adjusted.set(a.id, { to: a.adjustedAmount, reason: a.reason.trim() });
      }

      const fsWriteBatch = adminDb.batch();
      let total = currency(0);

      allTxSnap.docs.forEach((tDoc) => {
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
          usedApprovalTokenHash: hashToken(token),
          usedApprovalTokenBy: approverLabel,
          usedApprovalTokenAction: "approved",
          totalAmount: total.value,
          transactionIds: (
            (batchData.transactionIds as string[] | undefined) ?? []
          ).filter((id) => !rejected.has(id)),
          rejectedTransactionIds: [
            ...((batchData.rejectedTransactionIds as string[] | undefined) ??
              []),
            ...rejected.keys(),
          ],
          // Sem comentário, apaga o de uma devolução anterior
          approverComment: comment ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        unchanged,
      );
      fsWriteBatch.delete(codeRef);

      await fsWriteBatch.commit();

      await logAudit({
        companyId: batchData.companyId as string,
        userId: approverId,
        userEmail: approverEmail,
        action: "approve",
        entity: "batch",
        entityId: batchDoc.id,
        details: {
          via: "magic-link",
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
        },
      });

      return NextResponse.json({
        success: true,
        approvedCount: currentById.size - rejected.size,
        rejectedCount: rejected.size,
        totalAmount: total.value,
      });
    }

    // -----------------------------------------------------------------------
    // return
    // -----------------------------------------------------------------------
    if (action === "return") {
      const reason: string | undefined = body.reason;

      if (!reason?.trim()) {
        return NextResponse.json(
          { error: "Informe o motivo da devolução." },
          { status: 400 },
        );
      }

      const fsWriteBatch = adminDb.batch();
      fsWriteBatch.update(
        batchDoc.ref,
        {
          status: "open",
          approvalTokenHash: null,
          approvalToken: null,
          approvalTokenExpiresAt: null,
          usedApprovalTokenHash: hashToken(token),
          usedApprovalTokenBy: approverLabel,
          usedApprovalTokenAction: "returned",
          approverId: null,
          approverEmail: null,
          approverComment: `Devolvido: ${reason.trim()}`,
          returnReason: reason.trim(),
          returnedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        unchanged,
      );
      fsWriteBatch.delete(codeRef);
      await fsWriteBatch.commit();

      await logAudit({
        companyId: batchData.companyId as string,
        userId: approverId,
        userEmail: approverEmail,
        action: "update",
        entity: "batch",
        entityId: batchDoc.id,
        details: {
          via: "magic-link",
          returnedToManager: true,
          reason: reason.trim(),
        },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    // Precondição lastUpdateTime falhou: alguém agiu no lote no meio do caminho
    if ((error as { code?: number }).code === 9) {
      return NextResponse.json(
        {
          error:
            "O lote mudou enquanto você revisava. Recarregue a página para ver a situação atual.",
        },
        { status: 409 },
      );
    }
    console.error("[batch-approval] POST Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
