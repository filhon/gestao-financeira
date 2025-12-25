import {
  ApprovalRequestEmail,
  StatusUpdateEmail,
  BatchApprovalEmail,
  BatchAuthorizationEmail,
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
  } else {
    return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
  }

  try {
    if (!process.env.RESEND_API_KEY) {
      logger.warn("RESEND_API_KEY is missing. Email simulation:");
      logger.log("To:", to);
      logger.log("Type:", type);
      logger.log("Data:", data);
      return NextResponse.json({
        success: true,
        message: "Email simulated (API Key missing)",
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    // Resend Free Tier Restriction: Can only send to verified email.
    // We redirect to the developer's email in dev mode.
    const isDev = process.env.NODE_ENV === "development";
    const verifiedEmail =
      process.env.NEXT_PUBLIC_DEV_FALLBACK_EMAIL || "noreply@example.com";
    const recipient = isDev ? verifiedEmail : to;

    if (isDev && to !== verifiedEmail) {
      logger.log(`[DEV] Redirecting email from ${to} to ${verifiedEmail}`);
    }

    const { data: result, error } = await resend.emails.send({
      from: "Fin Control <onboarding@resend.dev>",
      to: recipient,
      subject: isDev ? `[TESTE - Original: ${to}] ${subject}` : subject,
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
