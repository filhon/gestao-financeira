/**
 * POST /api/webhooks/resend
 *
 * Recebe o aviso `email.received`. O Resend só manda os metadados: corpo, headers
 * e o resultado de SPF/DKIM/DMARC vêm de uma segunda chamada, feita aqui.
 * A autenticidade vem da assinatura do webhook, não de sessão.
 */
import { createElement } from "react";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";
import { BatchReplyResultEmail } from "@/components/emails/EmailTemplates";
import { commitBatchApproval, reviewBatch } from "@/lib/api/batchApprovalAdmin";
import {
  decideReply,
  findReplyKey,
  type ReplyRecord,
} from "@/lib/email/replyApproval";
import { sendEmail } from "@/lib/email/sendEmail";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

const REPLY_APPROVALS = "batch_reply_approvals";
/** Sem regra própria nas rules: default deny. O Resend reenvia o mesmo evento. */
const PROCESSED = "inbound_email_events";

type ReceivedEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string[] | null;
    cc?: string[] | null;
    bcc?: string[] | null;
    received_for?: string | string[] | null;
  };
};

/** O SDK instalado não traz `authentication`: a chamada direta traz. */
async function fetchReceived(id: string, apiKey: string) {
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) {
    throw new Error(`Resend respondeu ${response.status} ao ler o e-mail`);
  }
  return (await response.json()) as {
    from: string;
    message_id?: string;
    text?: string | null;
    headers?: Record<string, string> | null;
    authentication?: { spf?: unknown; dkim?: unknown; dmarc?: unknown } | null;
  };
}

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );

async function handleReply(
  emailId: string,
  record: ReplyRecord,
  apiKey: string,
) {
  const email = await fetchReceived(emailId, apiKey);

  const batchRef = adminDb.collection("payment_batches").doc(record.batchId);
  const batchDoc = await batchRef.get();
  const batch = batchDoc.data() ?? null;
  const expiresAt = batch?.approvalTokenExpiresAt?.toDate?.() as
    | Date
    | undefined;

  const review =
    batch?.companyId === record.companyId
      ? await reviewBatch(record.batchId, record.companyId)
      : null;

  let decision = decideReply({
    record,
    from: email.from,
    dmarc: email.authentication?.dmarc,
    headers: email.headers,
    text: email.text,
    batch: batch && { ...batch, expiresAtMillis: expiresAt?.getTime() },
    now: Date.now(),
    review,
  });
  if (decision.kind === "ignore") return;

  let approved: Awaited<ReturnType<typeof commitBatchApproval>> | null = null;
  if (decision.kind === "approve") {
    const txSnap = await adminDb
      .collection("transactions")
      .where("batchId", "==", record.batchId)
      .get();
    try {
      approved = await commitBatchApproval({
        batchDoc,
        batchData: batch!,
        txDocs: txSnap.docs,
        tokenHash: record.tokenHash,
        comment: `Aprovado por resposta de e-mail: "${decision.phrase}"`,
        via: "email-reply",
        auditDetails: {
          emailId,
          messageId: email.message_id ?? null,
          from: email.from,
          authentication: email.authentication ?? null,
        },
      });
    } catch (error) {
      // Precondição lastUpdateTime falhou: alguém mexeu no lote neste instante
      if ((error as { code?: number }).code !== 9) throw error;
      decision = {
        kind: "refuse",
        reason: "o lote mudou enquanto a resposta era processada",
        tellApprover: true,
      };
    }
  }

  const company = batch?.companyId
    ? await adminDb.collection("companies").doc(batch.companyId).get()
    : null;
  const shared = {
    batchName: (batch?.name as string) ?? "lote de pagamentos",
    companyName: company?.get("name") ?? null,
    approverLabel: (batch?.approverName as string) || record.approverEmail,
    approved: !!approved,
    reason: decision.kind === "refuse" ? decision.reason : undefined,
    transactionCount: approved?.approvedCount,
    totalAmount: approved ? brl(approved.totalAmount) : undefined,
  };
  const subject = approved
    ? `Lote aprovado por resposta: ${shared.batchName}`
    : `Resposta não aprovou: ${shared.batchName}`;

  const sends = [
    sendEmail({
      to: record.senderEmail,
      subject,
      sender: "notificacoes",
      replyTo: record.approverEmail,
      react: createElement(BatchReplyResultEmail, {
        ...shared,
        audience: "sender",
        replyText: (email.text ?? "").slice(0, 2000),
      }),
    }),
  ];
  // Com a identidade confirmada, o aprovador sabe o que aconteceu.
  if (decision.kind === "approve" || decision.tellApprover) {
    sends.push(
      sendEmail({
        to: record.approverEmail,
        subject,
        sender: "notificacoes",
        replyTo: record.senderEmail,
        react: createElement(BatchReplyResultEmail, {
          ...shared,
          audience: "approver",
        }),
      }),
    );
  }
  // A decisão já está gravada: falha no aviso não pode reprocessar o evento.
  const results = await Promise.allSettled(sends);
  results.forEach((r) => {
    if (r.status === "rejected") {
      logger.error("[resend-webhook] aviso:", r.reason);
    } else if (!r.value.simulated && r.value.error) {
      logger.error("[resend-webhook] aviso:", r.value.error);
    }
  });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) {
    return NextResponse.json(
      { error: "Recebimento não configurado." },
      { status: 503 },
    );
  }

  // A assinatura é sobre o corpo cru: não passar por JSON antes.
  const payload = await request.text();
  let event: ReceivedEvent;
  try {
    event = new Resend(apiKey).webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    }) as ReceivedEvent;
  } catch {
    return NextResponse.json(
      { error: "Assinatura inválida." },
      { status: 401 },
    );
  }

  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId) {
    return NextResponse.json({ ok: true });
  }

  const key = findReplyKey([
    ...(event.data?.to ?? []),
    ...(event.data?.cc ?? []),
    ...(event.data?.bcc ?? []),
    ...[event.data?.received_for ?? []].flat(),
  ]);
  if (!key) return NextResponse.json({ ok: true });

  const recordSnap = await adminDb.collection(REPLY_APPROVALS).doc(key).get();
  if (!recordSnap.exists) return NextResponse.json({ ok: true });

  const marker = adminDb.collection(PROCESSED).doc(emailId);
  try {
    await marker.create({ createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    // Já existe (6): evento reenviado, a primeira entrega cuidou dele.
    if ((error as { code?: number }).code === 6) {
      return NextResponse.json({ ok: true });
    }
    throw error;
  }

  try {
    await handleReply(emailId, recordSnap.data() as ReplyRecord, apiKey);
  } catch (error) {
    logger.error("[resend-webhook] processamento:", error);
    // Libera para o Resend tentar de novo.
    await marker.delete().catch(() => {});
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
