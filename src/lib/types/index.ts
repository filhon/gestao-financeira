export type UserRole = 'admin' | 'financial_manager' | 'approver' | 'releaser' | 'auditor';

export type TransactionType = 'payable' | 'receivable';

export type TransactionStatus = 'draft' | 'pending_approval' | 'approved' | 'paid' | 'rejected';

export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'credit_card' | 'cash';

export type AttachmentType = 'invoice' | 'demand_proof' | 'other';

export type RequestOriginType = 'director' | 'department' | 'sector';

export interface Company {
    id: string;
    name: string;
    cnpj?: string;
    logoUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;

    // Legacy role (kept for backward compatibility or global admin)
    role: UserRole;

    // Multi-Company Roles
    companyRoles?: Record<string, UserRole>;

    department?: string;
    createdAt: Date;
    updatedAt: Date;
    active: boolean; // Deprecated in favor of status, but kept for sync
    status: 'pending' | 'active' | 'rejected';
}

export interface CostCenter {
    id: string;
    companyId: string; // Tenant Isolation
    parentId?: string; // Hierarchy
    name: string;
    code: string;
    description?: string;
    budget?: number;

    // Permissions
    allowedUserIds?: string[]; // Users allowed to create expenses
    approverId?: string;       // User responsible for approval
    releaserId?: string;       // User responsible for releasing payment
    budgetLimit?: number;      // Monthly budget limit

    createdAt: Date;
    updatedAt: Date;
}

export interface CostCenterAllocation {
    costCenterId: string;
    percentage: number;
    amount: number;
}

// Alias for backward compatibility
export type TransactionAllocation = CostCenterAllocation;

export interface Attachment {
    id: string;
    url: string;
    name: string;
    type: string;
    category: AttachmentType;
}

// Alias for backward compatibility
export type TransactionAttachment = Attachment;

export interface TransactionRecurrence {
    isRecurring: boolean;
    frequency?: "daily" | "weekly" | "monthly" | "yearly" | "custom";
    interval?: number; // e.g., every 2 weeks
    intervalUnit?: "days" | "weeks" | "months" | "years";
    endDate?: Date;
}

export interface TransactionInstallments {
    current: number;
    total: number;
    groupId: string; // ID linking all installments
}

export interface RequestOrigin {
    type: RequestOriginType;
    name: string;
}

export interface ApprovalStep {
    approverId: string;
    status: 'pending' | 'approved' | 'rejected';
    approvedAt?: Date;
    comment?: string;
}

export interface Entity {
    id: string;
    companyId: string;
    name: string;
    type: 'individual' | 'company';
    document?: string; // CPF or CNPJ
    email?: string;
    phone?: string;
    address?: string;
    category: 'supplier' | 'client' | 'both';
    createdAt: Date;
    updatedAt: Date;
}

export interface Transaction {
    id: string;
    companyId: string;
    description: string;
    amount: number;
    type: 'payable' | 'receivable';
    status: TransactionStatus;
    dueDate: Date;
    paymentDate?: Date;
    supplierOrClient?: string; // Legacy or fallback name
    entityId?: string; // Link to Entity
    costCenterId?: string;
    costCenterAllocation?: CostCenterAllocation[];
    recurrence?: TransactionRecurrence;
    installments?: TransactionInstallments;

    // Attachments
    attachments?: string[]; // URLs

    // Metadata
    createdBy: string;
    approvedBy?: string;
    approvedAt?: Date;
    releasedBy?: string;
    releasedAt?: Date;

    // Approval Token for Magic Links
    approvalToken?: string | null;
    approvalTokenExpiresAt?: Date | null;

    createdAt: Date;
    updatedAt: Date;
    batchId?: string;
}

export type PaymentBatchStatus = 'open' | 'pending_approval' | 'approved' | 'paid' | 'rejected';

export interface PaymentBatch {
    id: string;
    companyId: string;
    status: PaymentBatchStatus;
    name: string; // e.g., "Pagamentos Semana 42"

    transactionIds: string[];
    totalAmount: number;

    createdBy: string;
    approvedBy?: string;
    approvedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

export interface Notification {
    id: string;
    userId: string;
    companyId: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error';
    link?: string;
    read: boolean;
    createdAt: Date;
}
