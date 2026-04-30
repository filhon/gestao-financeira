import { Transaction, ReimbursementReport } from "@/lib/types";

interface EmailResponse {
  success?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: any;
  id?: string;
}

const getAppDomain = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
};

export const emailService = {
  sendApprovalRequest: async (
    transaction: Transaction,
    approverEmail: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();

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
    updatedBy: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();

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
    approverEmail: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();

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
    authorizerEmail: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();

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
  // Reimbursement Report Emails
  // ============================================

  sendReimbursementApprovalRequest: async (
    report: ReimbursementReport,
    approverEmail: string,
    senderName: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();
      const token = report.approvalToken;
      const period = `${new Intl.DateTimeFormat("pt-BR").format(report.periodStart)} — ${new Intl.DateTimeFormat("pt-BR").format(report.periodEnd)}`;
      const totalAmount = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(report.totalAmount);

      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reimbursement_approval",
          to: [approverEmail],
          data: {
            rdNumber: report.rdNumber,
            employeeName: report.employeeName,
            period,
            totalAmount,
            transactionCount: report.transactionIds.length,
            senderName,
            approveLink: `${appDomain}/approve-reimbursement/${token}?action=approve`,
            rejectLink: `${appDomain}/approve-reimbursement/${token}?action=reject`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending reimbursement approval email:", error);
      return { error };
    }
  },

  sendReimbursementApproved: async (
    report: ReimbursementReport,
    employeeEmail: string,
    approvedByName: string,
  ): Promise<EmailResponse> => {
    try {
      const appDomain = getAppDomain();
      const period = `${new Intl.DateTimeFormat("pt-BR").format(report.periodStart)} — ${new Intl.DateTimeFormat("pt-BR").format(report.periodEnd)}`;
      const totalAmount = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(report.totalAmount);

      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reimbursement_approved",
          to: [employeeEmail],
          data: {
            rdNumber: report.rdNumber,
            employeeName: report.employeeName,
            period,
            totalAmount,
            approvedBy: approvedByName,
            systemLink: `${appDomain}/financeiro/reembolsos`,
          },
        }),
      });
      return await response.json();
    } catch (error) {
      console.error("Error sending reimbursement approved email:", error);
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
    },
  ): Promise<EmailResponse[]> => {
    const appDomain = getAppDomain();

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
            error,
          );
          return { error };
        }
      }),
    );

    return results;
  },
};
