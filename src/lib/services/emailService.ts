import { Transaction } from "@/lib/types";

interface EmailResponse {
    success?: boolean;
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
                        requesterName: transaction.requestOrigin.name,
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
    }
};
