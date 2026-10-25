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
import { sendEmail } from "@/lib/email/sendEmail";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { cookies } from "next/headers";

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
  const token = cookieStore.get("auth_token");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type, to, data } = await request.json();

  let emailComponent;
  let subject = "";
  let fromName: string | undefined;
  // Quem atende várias empresas precisa saber de qual é o pedido. Vai no
  // remetente e com o nome curto: a razão social inteira no assunto escondia
  // o lote e o valor na caixa de entrada do celular.
  const shortCompany = (data?.companyName as string | undefined)
    ?.split(/\s+[-–]\s+/)[0]
    .trim();
  const companyFrom = shortCompany ? `FinControl · ${shortCompany}` : undefined;

  if (type === "approval_request") {
    emailComponent = <ApprovalRequestEmail {...data} />;
    subject = `Aprovação Necessária: ${data.description}`;
  } else if (type === "status_update") {
    emailComponent = <StatusUpdateEmail {...data} />;
    subject = `Atualização de Status: ${data.description}`;
  } else if (type === "batch_approval_request") {
    emailComponent = <BatchApprovalEmail {...data} />;
    subject = `Aprovar: ${data.batchName} · ${data.totalAmount}`;
    fromName = companyFrom;
  } else if (type === "batch_authorization_request") {
    emailComponent = <BatchAuthorizationEmail {...data} />;
    subject = `Autorizar: ${data.batchName}`;
    fromName = companyFrom;
  } else if (type === "batch_new_transactions") {
    emailComponent = <BatchNewTransactionsEmail {...data} />;
    subject = `Novas transações adicionadas ao lote: ${data.batchName}`;
  } else if (type === "feedback_notification") {
    emailComponent = <FeedbackNotificationEmail {...data} />;
    subject = `Novo Feedback: ${data.feedbackTypeLabel} - ${data.title}`;
  } else if (type === "reimbursement_approval") {
    emailComponent = <ReimbursementApprovalEmail {...data} />;
    subject = `Aprovação Necessária: ${data.rdNumber} — ${data.employeeName}`;
  } else if (type === "reimbursement_approved") {
    emailComponent = <ReimbursementApprovedEmail {...data} />;
    subject = `Reembolso Aprovado: ${data.rdNumber}`;
  } else {
    return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
  }

  try {
    const result = await sendEmail({
      to,
      subject,
      react: emailComponent,
      fromName,
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
