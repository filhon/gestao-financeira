import {
  ApprovalRequestEmail,
  StatusUpdateEmail,
  BatchApprovalEmail,
  BatchAuthorizationEmail,
  FeedbackNotificationEmail,
} from "@/components/emails/EmailTemplates";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

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
            Math.ceil((rateLimitResult.reset - Date.now()) / 1000)
          ),
        },
      }
    );
  }

  const { type, to, data } = await request.json();

  let emailComponent;
  let subject = "";

  if (type === "approval_request") {
    emailComponent = <ApprovalRequestEmail {...data} />;
    subject = `Aprovação Necessária: ${data.description}`;
  } else if (type === "status_update") {
    emailComponent = <StatusUpdateEmail {...data} />;
    subject = `Atualização de Status: ${data.description}`;
  } else if (type === "batch_approval_request") {
    emailComponent = <BatchApprovalEmail {...data} />;
    subject = `Lote Aguardando Aprovação: ${data.batchName}`;
  } else if (type === "batch_authorization_request") {
    emailComponent = <BatchAuthorizationEmail {...data} />;
    subject = `Autorização Necessária: ${data.batchName}`;
  } else if (type === "feedback_notification") {
    emailComponent = <FeedbackNotificationEmail {...data} />;
    subject = `Novo Feedback: ${data.feedbackTypeLabel} - ${data.title}`;
  } else {
    return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
  }

  try {
    // Check if email sending is enabled
    const isEmailEnabled = process.env.EMAIL_ENABLED !== "false";

    if (!isEmailEnabled) {
      logger.warn(
        "Email sending is disabled (EMAIL_ENABLED=false). Email simulation:"
      );
      logger.log("To:", to);
      logger.log("Subject:", subject);
      logger.log("Type:", type);
      return NextResponse.json({
        success: true,
        message: "Email disabled (EMAIL_ENABLED=false)",
        simulated: true,
      });
    }

    if (!process.env.RESEND_API_KEY) {
      logger.warn("RESEND_API_KEY is missing. Email simulation:");
      logger.log("To:", to);
      logger.log("Subject:", subject);
      logger.log("Type:", type);
      return NextResponse.json({
        success: true,
        message: "Email simulated (API Key missing)",
        simulated: true,
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    // In development, redirect emails to fallback email for testing
    const isDev = process.env.NODE_ENV === "development";
    const fallbackEmail = process.env.NEXT_PUBLIC_DEV_FALLBACK_EMAIL;
    const recipient = isDev && fallbackEmail ? fallbackEmail : to;

    if (isDev && fallbackEmail && to !== fallbackEmail) {
      logger.log(`[DEV] Redirecting email from ${to} to ${fallbackEmail}`);
    }

    // Use configured domain or fallback to Resend's default
    const fromDomain =
      process.env.EMAIL_FROM_DOMAIN || "updates.fincontrol.ia.br";
    const fromEmail = `Fin Control <noreply@${fromDomain}>`;

    const { data: result, error } = await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject:
        isDev && fallbackEmail
          ? `[TESTE - Original: ${to}] ${subject}`
          : subject,
      react: emailComponent,
    });

    if (error) {
      logger.error("Resend API Error:", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.error("Email API Internal Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
