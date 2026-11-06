import {
  ApprovalRequestEmail,
  StatusUpdateEmail,
  BatchApprovalEmail,
  BatchAuthorizationEmail,
  BatchNewTransactionsEmail,
  FeedbackNotificationEmail,
  ReimbursementApprovalEmail,
  ReimbursementApprovedEmail,
} from "@/components/emails/EmailTemplates";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  resolveEmail,
  type EmailLoaders,
  type EmailType,
} from "@/lib/email/resolveEmail";
import { replyAddress } from "@/lib/email/replyApproval";
import { emailDomain, sendEmail } from "@/lib/email/sendEmail";
import {
  expiryLabel,
  reviewBatch,
} from "@/lib/api/batchApprovalAdmin";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { createElement, type ComponentType } from "react";

const REPLY_APPROVALS = "batch_reply_approvals";

const TEMPLATES = {
  approval_request: ApprovalRequestEmail,
  status_update: StatusUpdateEmail,
  batch_approval_request: BatchApprovalEmail,
  batch_authorization_request: BatchAuthorizationEmail,
  batch_new_transactions: BatchNewTransactionsEmail,
  feedback_notification: FeedbackNotificationEmail,
  reimbursement_approval: ReimbursementApprovalEmail,
  reimbursement_approved: ReimbursementApprovedEmail,
} as unknown as Record<EmailType, ComponentType<Record<string, unknown>>>;

const read = (collection: string) => async (id: string) =>
  (await adminDb.collection(collection).doc(id).get()).data() ?? null;

const loaders: EmailLoaders = {
  transaction: read("transactions"),
  batch: read("payment_batches"),
  batchReview: (id, companyId) =>
    reviewBatch(id, companyId).catch((error) => {
      logger.error("Email API: resumo do lote:", error);
      return null;
    }),
  expiryLabel,
  replyApprovalEnabled: () =>
    !!process.env.RESEND_WEBHOOK_SECRET && !!process.env.RESEND_API_KEY,
  report: read("reimbursement_reports"),
  costCenter: read("cost_centers") as EmailLoaders["costCenter"],
  companyName: async (id) => (await read("companies")(id))?.name ?? null,
  userEmail: async (uid) => (await read("users")(uid))?.email ?? null,
  isGlobalAdmin: async (email) =>
    !(
      await adminDb
        .collection("users")
        .where("email", "==", email)
        .where("role", "==", "admin")
        .limit(1)
        .get()
    ).empty,
  installmentAmounts: async (companyId, groupId) =>
    (
      await adminDb
        .collection("transactions")
        .where("companyId", "==", companyId)
        .where("installments.groupId", "==", groupId)
        .select("amount")
        .get()
    ).docs.map((d) => d.get("amount") as number),
  users: async () =>
    (
      await adminDb
        .collection("users")
        .select("email", "companyRoles", "status", "active")
        .get()
    ).docs.map((d) => d.data() as Awaited<ReturnType<EmailLoaders["users"]>>[0]),
};

export async function POST(request: Request) {
  // Get IP address for rate limiting
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0] : "127.0.0.1";

  // Check rate limit: 10 emails per minute per IP
  const rateLimitResult = checkRateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    identifier: `email:${ip}`,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        error: "Too many requests. Please try again later.",
        resetAt: new Date(rateLimitResult.reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rateLimitResult.reset - new Date().getTime()) / 1000),
          ),
        },
      },
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    // Token ruim é do usuário; credencial do Admin SDK faltando é do servidor.
    if (String((error as { code?: unknown }).code).startsWith("auth/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error("Email API: Admin SDK indisponível:", error);
    return NextResponse.json(
      { error: "Admin SDK indisponível no servidor" },
      { status: 500 },
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const profile = await read("users")(decoded.uid);
    const email = await resolveEmail(
      body,
      {
        email: decoded.email ?? profile?.email,
        displayName: profile?.displayName,
        role: profile?.role,
        companyRoles: profile?.companyRoles,
      },
      new URL(request.url).origin,
      loaders,
    );

    if ("error" in email) {
      return NextResponse.json({ error: email.error }, { status: email.status });
    }

    // Só o Admin SDK lê esta coleção: quem envia o lote não altera o que foi
    // mostrado ao aprovador. Sem regra própria, cai no default deny.
    if (email.replyApproval) {
      const { key, ...record } = email.replyApproval;
      await adminDb
        .collection(REPLY_APPROVALS)
        .doc(key)
        .set({ ...record, createdAt: FieldValue.serverTimestamp() });
    }

    const result = await sendEmail({
      to: email.to,
      subject: email.subject,
      react: createElement(TEMPLATES[email.type], email.props),
      sender: email.sender,
      // A resposta vai para quem fez o pedido, nunca para um endereço fixo:
      // cada empresa fala com a própria equipe.
      replyTo: email.replyApproval
        ? replyAddress(email.replyApproval.key, emailDomain())
        : (decoded.email ?? profile?.email),
      fromName: email.fromName,
    });

    if (result.simulated) {
      return NextResponse.json({
        success: true,
        message: result.message,
        simulated: true,
      });
    }

    if (result.error) {
      logger.error("Resend API Error:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(result.data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.error("Email API Internal Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
