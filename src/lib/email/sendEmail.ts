import type { ReactElement } from "react";
import { Resend } from "resend";
import { logger } from "@/lib/logger";
import type { EmailSender } from "@/lib/email/resolveEmail";

export type SendEmailResult =
  | { simulated: true; message: string }
  | { simulated: false; data?: unknown; error?: unknown };

export const emailDomain = () =>
  process.env.EMAIL_FROM_DOMAIN || "fincontrol.ia.br";

/**
 * Envio pelo Resend, só no servidor. Em desenvolvimento com
 * NEXT_PUBLIC_DEV_FALLBACK_EMAIL, redireciona tudo para esse endereço.
 */
export async function sendEmail({
  to,
  subject,
  react,
  sender,
  replyTo,
  fromName = "FinControl",
}: {
  to: string | string[];
  subject: string;
  react: ReactElement;
  /** Parte antes do @: separa por finalidade, para filtros e para quem confere. */
  sender: EmailSender;
  /** Quem recebe a resposta: nunca fixo, para não misturar empresas. */
  replyTo?: string;
  /** Nome do remetente na caixa de entrada, ex.: "FinControl · Hebron". */
  fromName?: string;
}): Promise<SendEmailResult> {
  if (process.env.EMAIL_ENABLED === "false" || !process.env.RESEND_API_KEY) {
    const message =
      process.env.EMAIL_ENABLED === "false"
        ? "Email disabled (EMAIL_ENABLED=false)"
        : "Email simulated (API Key missing)";
    logger.warn(`${message}. Email simulation:`);
    logger.log("To:", to);
    logger.log("Subject:", subject);
    return { simulated: true, message };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const isDev = process.env.NODE_ENV === "development";
  const fallbackEmail = process.env.NEXT_PUBLIC_DEV_FALLBACK_EMAIL;
  const redirect = isDev && !!fallbackEmail;
  if (redirect && to !== fallbackEmail) {
    logger.log(`[DEV] Redirecting email from ${to} to ${fallbackEmail}`);
  }

  const { data, error } = await resend.emails.send({
    from: `"${fromName.replace(/["\\]/g, "")}" <${sender}@${emailDomain()}>`,
    replyTo,
    to: redirect ? fallbackEmail! : to,
    subject: redirect ? `[TESTE - Original: ${to}] ${subject}` : subject,
    react,
  });

  return { simulated: false, data, error };
}
