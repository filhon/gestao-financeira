// Types for bulk import functionality

export interface ImportedRow {
    rowNumber: number;
    id: string; // UUID for UI management
    description: string;
    amount: string | number;
    dueDate: string;
    supplierOrClient: string;
    costCenterCode?: string;
    costCenterId?: string; // Resolved from costCenterCode or bulk assignment
    paymentMethod?: string;
    notes?: string;
    // Validation state
    errors: ValidationError[];
    warnings: ValidationWarning[];
    isValid: boolean;
}

export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationWarning {
    field: string;
    message: string;
}

export interface ImportResult {
    success: number;
    failed: number;
    errors: { row: number; message: string }[];
}

export type ImportStep = 'upload' | 'processing' | 'preview' | 'importing' | 'result';

export interface ImportState {
    step: ImportStep;
    rows: ImportedRow[];
    selectedIds: Set<string>;
    defaultCostCenterId: string | null;
    progress: number;
    result: ImportResult | null;
}

// Column mapping from spreadsheet headers to internal fields
export const COLUMN_MAP: Record<string, keyof ImportedRow> = {
    'descrição': 'description',
    'descricao': 'description',
    'description': 'description',
    'valor': 'amount',
    'value': 'amount',
    'amount': 'amount',
    'vencimento': 'dueDate',
    'data de vencimento': 'dueDate',
    'due date': 'dueDate',
    'duedate': 'dueDate',
    'fornecedor': 'supplierOrClient',
    'cliente': 'supplierOrClient',
    'fornecedor/cliente': 'supplierOrClient',
    'supplier': 'supplierOrClient',
    'client': 'supplierOrClient',
    'entidade': 'supplierOrClient',
    'entity': 'supplierOrClient',
    'centro de custo': 'costCenterCode',
    'centro custo': 'costCenterCode',
    'cost center': 'costCenterCode',
    'costcenter': 'costCenterCode',
    'cc': 'costCenterCode',
    'forma de pagamento': 'paymentMethod',
    'payment method': 'paymentMethod',
    'pagamento': 'paymentMethod',
    'observações': 'notes',
    'observacoes': 'notes',
    'notas': 'notes',
    'notes': 'notes',
    'obs': 'notes',
};

// Payment method mapping
export const PAYMENT_METHOD_MAP: Record<string, string> = {
    'pix': 'pix',
    'boleto': 'boleto',
    'transferência': 'transfer',
    'transferencia': 'transfer',
    'transfer': 'transfer',
    'ted': 'transfer',
    'doc': 'transfer',
    'cartão de crédito': 'credit_card',
    'cartao de credito': 'credit_card',
    'cartão': 'credit_card',
    'cartao': 'credit_card',
    'credit card': 'credit_card',
    'credit_card': 'credit_card',
    'dinheiro': 'cash',
    'espécie': 'cash',
    'cash': 'cash',
};
