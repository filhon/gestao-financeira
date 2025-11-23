export type UserRole = 'admin' | 'financial_manager' | 'approver' | 'releaser' | 'auditor';

export type TransactionType = 'payable' | 'receivable';

export type TransactionStatus = 'draft' | 'pending_approval' | 'approved' | 'paid' | 'rejected';

export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'credit_card' | 'cash';

export type AttachmentType = 'invoice' | 'demand_proof' | 'other';

export type RequestOriginType = 'director' | 'department' | 'sector';

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    role: UserRole;
    department?: string;
    createdAt: Date;
    updatedAt: Date;
    active: boolean;
}

export interface CostCenter {
    id: string;
    name: string;
    code: string;
    description?: string;
    budget?: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface TransactionAllocation {
    costCenterId: string;
    percentage: number;
    amount: number;
}

export interface TransactionAttachment {
    id: string;
    url: string;
    name: string;
    type: string;
    category: AttachmentType;
}

export interface TransactionRecurrence {
    isRecurring: boolean;
    frequency?: 'monthly' | 'weekly' | 'yearly';
    currentInstallment: number;
    totalInstallments?: number;
    groupId?: string;
}

export interface Transaction {
    id: string;
    type: TransactionType;
    description: string;
    amount: number;
    dueDate: Date;
    paymentDate?: Date;
    status: TransactionStatus;

    supplierOrClient: string;
    createdBy: string;

    approvedBy?: string;
    approvedAt?: Date;
    releasedBy?: string;
    releasedAt?: Date;

    requestOrigin: {
        type: RequestOriginType;
        name: string;
    };

    recurrence?: TransactionRecurrence;

    costCenterAllocation: TransactionAllocation[];

    attachments: TransactionAttachment[];

    paymentMethod?: PaymentMethod;
    notes?: string;

    // Magic Link
    approvalToken?: string;
    approvalTokenExpiresAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}
