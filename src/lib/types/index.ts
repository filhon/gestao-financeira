export type UserRole = 'admin' | 'financial_manager' | 'approver' | 'releaser' | 'auditor' | 'user';

export type TransactionType = 'payable' | 'receivable';

export type TransactionStatus = 'draft' | 'pending_approval' | 'approved' | 'paid' | 'rejected';

export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'credit_card' | 'cash';

export type AttachmentType = 'invoice' | 'demand_proof' | 'other';

export type RequestOriginType = 'director' | 'department' | 'sector';

export interface Company {
    id: string;
    name: string;
    cnpj?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
    createdAt: Date;
    updatedAt: Date;

    // Batch auto-creation settings
    batchFrequencyDays?: number;  // Default: 7
    lastBatchCreatedAt?: Date;
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
    status: 'pending_company_setup' | 'pending_approval' | 'active' | 'rejected';

    // Pending access request (before admin approval)
    pendingCompanyId?: string;
    pendingRole?: UserRole;

    // Future: Subscription support
    subscriptionStatus?: 'none' | 'trial' | 'active' | 'expired';
    subscriptionValidUntil?: Date;
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
    approverEmail?: string;    // Email of the person responsible for approval
    releaserEmail?: string;    // Email of the person responsible for releasing payment
    budgetLimit?: number;      // Monthly budget limit

    // Balance from projected receivables
    availableBalance?: number;      // Manually set or calculated from receivables
    allocatedToChildren?: number;   // Amount allocated to child cost centers
    allocatedFromParent?: number;   // Amount received from parent (for children)

    createdAt: Date;
    updatedAt: Date;
}

export interface Budget {
    id: string;
    costCenterId: string;
    year: number;
    amount: number;
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

    // Bank Details
    bankName?: string;
    agency?: string;
    account?: string;
    accountType?: 'checking' | 'savings';
    pixKeyType?: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
    pixKey?: string;

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
    finalAmount?: number;
    discount?: number;
    interest?: number;
    supplierOrClient?: string; // Legacy or fallback name
    entityId?: string; // Link to Entity
    costCenterId?: string;
    costCenterAllocation?: CostCenterAllocation[];
    recurrence?: TransactionRecurrence;
    installments?: TransactionInstallments;
    requestOrigin?: RequestOrigin;
    paymentMethod?: PaymentMethod;
    notes?: string;

    // Attachments
    // Attachments
    attachments?: Attachment[];

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

    // Batch approval tracking
    batchRejectionReason?: string;  // Why rejected from batch
    batchAdjustedAmount?: number;   // Approver-adjusted amount
}

export type PaymentBatchStatus = 
    | 'open'                  // Being assembled by manager
    | 'pending_approval'      // Sent to approver, awaiting review
    | 'approved'              // Approver approved, ready for bank export
    | 'pending_authorization' // Sent to releaser for bank confirmation
    | 'authorized'            // Releaser confirmed bank processing
    | 'paid'                  // Manager confirmed payments complete
    | 'rejected';             // Batch rejected

export interface PaymentBatch {
    id: string;
    companyId: string;
    status: PaymentBatchStatus;
    name: string; // e.g., "Pagamentos Semana 42"

    transactionIds: string[];
    totalAmount: number;

    // Creator
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;

    // Approval workflow
    approverId?: string;
    approverEmail?: string;
    approvedBy?: string;
    approvedAt?: Date;
    approverComment?: string;
    sentForApprovalAt?: Date;

    // Authorization workflow (releaser = authorizer)
    authorizerId?: string;
    authorizerEmail?: string;
    authorizedBy?: string;
    authorizedAt?: Date;
    sentForAuthorizationAt?: Date;

    // Payment confirmation
    paidAt?: Date;
    paidBy?: string;

    // Rejected transaction IDs (for audit)
    rejectedTransactionIds?: string[];

    // Magic Link tokens
    approvalToken?: string | null;
    approvalTokenExpiresAt?: Date | null;
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

export interface AuditLog {
    id: string;
    companyId: string;
    userId: string;
    userEmail: string;
    action: 'create' | 'update' | 'delete' | 'login' | 'approve' | 'reject';
    entity: 'transaction' | 'company' | 'user' | 'cost_center' | 'entity';
    entityId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    details: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
}

export interface RecurringTransactionTemplate {
    id: string;
    companyId: string;
    description: string;
    amount: number;
    type: 'payable' | 'receivable';
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number; // e.g. 1 = every month, 2 = every 2 months
    nextDueDate: Date;
    endDate?: Date;
    active: boolean;
    lastGeneratedAt?: Date;
    baseTransactionData: Partial<Transaction>; // Stores cost centers, category, etc.
    createdAt: Date;
    updatedAt: Date;
}

// Feedback System Types
export type FeedbackType = 'bug' | 'improvement' | 'question' | 'praise';
export type FeedbackStatus = 'pending' | 'in_review' | 'resolved' | 'wont_fix';
export type FeedbackPriority = 'low' | 'medium' | 'high' | 'critical';

export type SystemFeature = 
    | 'dashboard'
    | 'contas_pagar'
    | 'contas_receber'
    | 'centros_custo'
    | 'recorrencias'
    | 'lotes'
    | 'relatorios'
    | 'configuracoes'
    | 'cadastros'
    | 'outro';

export interface Feedback {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    
    // Content
    type: FeedbackType;
    priority: FeedbackPriority;
    relatedFeatures: SystemFeature[];
    title: string;
    description: string;
    screenshotUrl?: string;
    
    // Error context (when coming from ErrorBoundary)
    errorContext?: {
        message: string;
        url: string;
        timestamp: Date;
    };
    
    // Status
    status: FeedbackStatus;
    read: boolean;
    
    // Admin response
    adminResponse?: string;
    respondedBy?: string;
    respondedByEmail?: string;
    respondedAt?: Date;
    
    createdAt: Date;
    updatedAt: Date;
}
