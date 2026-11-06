import { toast } from "sonner";

interface EmailResponse {
  success?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: any;
  id?: string;
}

/**
 * Recusa, erro do Resend e envio simulado viram `error` e aviso na tela: as
 * telas registram a ação antes do e-mail, e sem isso diziam que o link saiu.
 */
export async function readEmailResponse(
  response: Response,
): Promise<EmailResponse> {
  const body = await response.json().catch(() => ({}));
  const failure = !response.ok
    ? (body.error?.message ?? body.error ?? `HTTP ${response.status}`)
    : body.simulated
      ? body.message
      : null;
  if (!failure) return body;
  toast.warning(`Ação registrada, mas o e-mail não saiu: ${failure}`, {
    duration: 10_000,
  });
  return { error: failure };
}

/** O servidor confere o pedido e monta o e-mail a partir do registro. */
async function post(
  type: string,
  to: string,
  data: object,
  label: string,
): Promise<EmailResponse> {
  try {
    const response = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, to: [to], data }),
    });
    return await readEmailResponse(response);
  } catch (error) {
    console.error(`Error sending ${label} email:`, error);
    return { error };
  }
}

export const emailService = {
  sendApprovalRequest: (transactionId: string, approverEmail: string) =>
    post("approval_request", approverEmail, { transactionId }, "approval"),

  sendStatusUpdate: (transactionId: string, recipientEmail: string) =>
    post("status_update", recipientEmail, { transactionId }, "status update"),

  // ============================================
  // Batch Approval Emails
  // ============================================

  sendBatchApprovalRequest: (
    batchId: string,
    token: string,
    approverEmail: string,
  ) =>
    post(
      "batch_approval_request",
      approverEmail,
      { batchId, token },
      "batch approval",
    ),

  sendBatchAuthorizationRequest: (
    batchId: string,
    token: string,
    authorizerEmail: string,
  ) =>
    post(
      "batch_authorization_request",
      authorizerEmail,
      { batchId, token },
      "batch authorization",
    ),

  sendBatchNewTransactionsNotification: (
    batchId: string,
    token: string,
    newTransactionCount: number,
    additionalAmount: number,
    approverEmail: string,
  ) =>
    post(
      "batch_new_transactions",
      approverEmail,
      { batchId, token, newTransactionCount, additionalAmount },
      "batch new transactions",
    ),

  // ============================================
  // Reimbursement Report Emails
  // ============================================

  sendReimbursementApprovalRequest: (
    reportId: string,
    token: string,
    approverEmail: string,
  ) =>
    post(
      "reimbursement_approval",
      approverEmail,
      { reportId, token },
      "reimbursement approval",
    ),

  sendReimbursementApproved: (reportId: string, employeeEmail: string) =>
    post(
      "reimbursement_approved",
      employeeEmail,
      { reportId },
      "reimbursement approved",
    ),

  // ============================================
  // Feedback Email
  // ============================================

  sendFeedbackNotification: (
    adminEmails: string[],
    feedback: {
      feedbackType: "bug" | "improvement" | "question" | "praise";
      title: string;
      description: string;
    },
  ): Promise<EmailResponse[]> =>
    Promise.all(
      adminEmails.map((email) =>
        post("feedback_notification", email, feedback, "feedback"),
      ),
    ),
};
