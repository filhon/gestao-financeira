import { Transaction } from "@/lib/types";

interface EmailResponse {
    success?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error?: any;
    id?: string;
}

export const emailService = {
    sendApprovalRequest: async (transaction: Transaction, approverEmail: string): Promise<EmailResponse> => {
        try {
            const response = await fetch('/api/email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'approval_request',
                    to: [approverEmail],
                    data: {
                        transactionId: transaction.id,
                        description: transaction.description,
                        amount: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(transaction.amount),
                        requesterName: transaction.requestOrigin?.name || "Solicitante",
                        link: `${window.location.origin}/approve/${transaction.approvalToken}`,
                    },
                }),
            });
            return await response.json();
        } catch (error) {
            console.error("Error sending approval email:", error);
            return { error };
        }
    },

    sendStatusUpdate: async (transaction: Transaction, recipientEmail: string, updatedBy: string): Promise<EmailResponse> => {
        try {
            const response = await fetch('/api/email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'status_update',
                    to: [recipientEmail],
                    data: {
                        transactionId: transaction.id,
                        description: transaction.description,
                        status: transaction.status,
                        updatedBy: updatedBy,
                        link: `${window.location.origin}/financeiro/${transaction.type === 'payable' ? 'contas-pagar' : 'contas-receber'}`,
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
            const response = await fetch('/api/email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'batch_approval_request',
                    to: [approverEmail],
                    data: {
                        batchName,
                        batchId,
                        transactionCount,
                        totalAmount: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalAmount),
                        senderName,
                        link: `${window.location.origin}/approve-batch/${token}`,
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
            const response = await fetch('/api/email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'batch_authorization_request',
                    to: [authorizerEmail],
                    data: {
                        batchName,
                        batchId,
                        transactionCount,
                        totalAmount: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalAmount),
                        senderName,
                        link: `${window.location.origin}/authorize-batch/${token}`,
                    },
                }),
            });
            return await response.json();
        } catch (error) {
            console.error("Error sending batch authorization email:", error);
            return { error };
        }
    }
};
