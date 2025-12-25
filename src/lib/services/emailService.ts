import { Transaction } from "@/lib/types";

interface EmailResponse {
  success?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: any;
  id?: string;
}

export const emailService = {
  sendApprovalRequest: async (
    transaction: Transaction,
    approverEmail: string
  ): Promise<EmailResponse> => {
    try {
      // Use environment variable for app domain, fallback to window.location.origin
      const appDomain =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

      const response = await fetch("/api/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "approval_request",
          to: [approverEmail],
          data: {
            transactionId: transaction.id,
            description: transaction.description,
            amount: new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(transaction.amount),
            requesterName: transaction.requestOrigin?.name || "Solicitante",
            link: `${appDomain}/approve/${transaction.approvalToken}`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending approval email:", error);
      return { error };
    }
  },

  sendStatusUpdate: async (
    transaction: Transaction,
    recipientEmail: string,
    updatedBy: string
  ): Promise<EmailResponse> => {
    try {
      const appDomain =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

      const response = await fetch("/api/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "status_update",
          to: [recipientEmail],
          data: {
            transactionId: transaction.id,
            description: transaction.description,
            status: transaction.status,
            updatedBy: updatedBy,
            link: `${appDomain}/financeiro/${transaction.type === "payable" ? "contas-pagar" : "contas-receber"}`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending status update email:", error);
      return { error };
    }
  },

  // ============================================
  // Batch Approval Emails
  // ============================================

  sendBatchApprovalRequest: async (
    batchName: string,
    batchId: string,
    token: string,
    transactionCount: number,
    totalAmount: number,
    senderName: string,
    approverEmail: string
  ): Promise<EmailResponse> => {
    try {
      const appDomain =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

      const response = await fetch("/api/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "batch_approval_request",
          to: [approverEmail],
          data: {
            batchName,
            batchId,
            transactionCount,
            totalAmount: new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(totalAmount),
            senderName,
            link: `${appDomain}/approve-batch/${token}`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending batch approval email:", error);
      return { error };
    }
  },

  sendBatchAuthorizationRequest: async (
    batchName: string,
    batchId: string,
    token: string,
    transactionCount: number,
    totalAmount: number,
    senderName: string,
    authorizerEmail: string
  ): Promise<EmailResponse> => {
    try {
      const appDomain =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

      const response = await fetch("/api/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "batch_authorization_request",
          to: [authorizerEmail],
          data: {
            batchName,
            batchId,
            transactionCount,
            totalAmount: new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(totalAmount),
            senderName,
            link: `${appDomain}/authorize-batch/${token}`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending batch authorization email:", error);
      return { error };
    }
  },

  // ============================================
  // Feedback Email
  // ============================================

  sendFeedbackNotification: async (
    adminEmails: string[],
    feedbackData: {
      userName: string;
      userEmail: string;
      feedbackType: "bug" | "improvement" | "question" | "praise";
      title: string;
      description: string;
    }
  ): Promise<EmailResponse[]> => {
    const appDomain =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "https://fincontrol.ia.br");

    const typeLabels = {
      bug: "Bug",
      improvement: "Sugestão",
      question: "Dúvida",
      praise: "Elogio",
    };

    const results = await Promise.all(
      adminEmails.map(async (email) => {
        try {
          const response = await fetch("/api/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "feedback_notification",
              to: [email],
              data: {
                ...feedbackData,
                feedbackTypeLabel: typeLabels[feedbackData.feedbackType],
                link: `${appDomain}/configuracoes/feedbacks`,
              },
            }),
          });
          return await response.json();
        } catch (error) {
          console.error(
            `Error sending feedback notification to ${email}:`,
            error
          );
          return { error };
        }
      })
    );

    return results;
  },
};
