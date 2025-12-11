/**
 * Audit Log Formatter
 * Provides utilities for formatting audit log details in natural language (Portuguese)
 */

import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Field name translations (technical -> Portuguese)
export const FIELD_LABELS: Record<string, string> = {
    // Transaction fields
    amount: 'Valor',
    finalAmount: 'Valor Final',
    description: 'Descrição',
    status: 'Status',
    type: 'Tipo',
    dueDate: 'Data de Vencimento',
    paymentDate: 'Data de Pagamento',
    paymentMethod: 'Forma de Pagamento',
    supplierOrClient: 'Fornecedor/Cliente',
    entityId: 'Entidade',
    costCenterId: 'Centro de Custo',
    costCenterAllocation: 'Alocação de Centros de Custo',
    notes: 'Observações',
    discount: 'Desconto',
    interest: 'Juros',
    attachments: 'Anexos',
    requestOrigin: 'Origem da Solicitação',
    installments: 'Parcelas',
    recurrence: 'Recorrência',

    // User fields
    role: 'Perfil',
    displayName: 'Nome',
    email: 'E-mail',
    department: 'Departamento',
    active: 'Ativo',
    companyId: 'Empresa',

    // Company fields
    name: 'Nome',
    cnpj: 'CNPJ',
    phone: 'Telefone',
    address: 'Endereço',
    logoUrl: 'Logo',

    // Entity fields
    document: 'Documento',
    category: 'Categoria',
    bankName: 'Banco',
    agency: 'Agência',
    account: 'Conta',
    accountType: 'Tipo de Conta',
    pixKeyType: 'Tipo de Chave PIX',
    pixKey: 'Chave PIX',

    // Common
    createdAt: 'Criado em',
    updatedAt: 'Atualizado em',
    createdBy: 'Criado por',
    approvedBy: 'Aprovado por',
    approvedAt: 'Aprovado em',
    releasedBy: 'Liberado por',
    releasedAt: 'Liberado em',

    // Audit specific
    scope: 'Escopo',
    count: 'Quantidade',
    isRecurrenceUpdate: 'Atualização em Série',
};

// Value translations (technical -> Portuguese)
export const VALUE_LABELS: Record<string, Record<string, string>> = {
    status: {
        draft: 'Rascunho',
        pending_approval: 'Pendente de Aprovação',
        approved: 'Aprovado',
        paid: 'Pago',
        rejected: 'Rejeitado',
    },
    type: {
        payable: 'Contas a Pagar',
        receivable: 'Contas a Receber',
    },
    paymentMethod: {
        pix: 'PIX',
        boleto: 'Boleto',
        transfer: 'Transferência',
        credit_card: 'Cartão de Crédito',
        cash: 'Dinheiro',
    },
    role: {
        admin: 'Administrador',
        financial_manager: 'Gestor Financeiro',
        approver: 'Aprovador',
        releaser: 'Liberador',
        auditor: 'Auditor',
        user: 'Usuário',
    },
    category: {
        supplier: 'Fornecedor',
        client: 'Cliente',
        both: 'Ambos',
    },
    accountType: {
        checking: 'Conta Corrente',
        savings: 'Poupança',
    },
    pixKeyType: {
        cpf: 'CPF',
        cnpj: 'CNPJ',
        email: 'E-mail',
        phone: 'Telefone',
        random: 'Chave Aleatória',
    },
    entityType: {
        individual: 'Pessoa Física',
        company: 'Pessoa Jurídica',
    },
    scope: {
        single: 'Único',
        series: 'Série',
    },
    userStatus: {
        pending_company_setup: 'Aguardando Empresa',
        pending_approval: 'Aguardando Aprovação',
        active: 'Ativo',
        rejected: 'Rejeitado',
    }
};

// Action translations
export const ACTION_LABELS: Record<string, string> = {
    create: 'criou',
    update: 'atualizou',
    delete: 'excluiu',
    approve: 'aprovou',
    reject: 'rejeitou',
    login: 'fez login',
};

// Entity translations
export const ENTITY_LABELS: Record<string, string> = {
    transaction: 'Transação',
    user: 'Usuário',
    company: 'Empresa',
    cost_center: 'Centro de Custo',
    entity: 'Entidade',
};

/**
 * Format a currency value
 */
export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

/**
 * Get the translated label for a field name
 */
export function getFieldLabel(field: string): string {
    return FIELD_LABELS[field] || field;
}

/**
 * Get the translated value for a field
 */
export function getValueLabel(field: string, value: unknown): string {
    if (value === null || value === undefined) {
        return '(vazio)';
    }

    // Check if there's a translation map for this field
    const fieldValues = VALUE_LABELS[field];
    if (fieldValues && typeof value === 'string' && fieldValues[value]) {
        return fieldValues[value];
    }

    // Handle specific types
    if (typeof value === 'boolean') {
        return value ? 'Sim' : 'Não';
    }

    if (typeof value === 'number') {
        // Check if it looks like a currency field
        if (field.toLowerCase().includes('amount') || 
            field.toLowerCase().includes('value') || 
            field === 'discount' || 
            field === 'interest' ||
            field === 'budget' ||
            field === 'budgetLimit') {
            return formatCurrency(value);
        }
        return value.toLocaleString('pt-BR');
    }

    if (value instanceof Date) {
        return format(value, 'dd/MM/yyyy', { locale: ptBR });
    }

    if (typeof value === 'object') {
        // Arrays
        if (Array.isArray(value)) {
            if (value.length === 0) return '(vazio)';
            return `${value.length} item(s)`;
        }
        // Objects - just indicate it's complex
        return '(objeto complexo)';
    }

    return String(value);
}

/**
 * Format a single field change
 */
export function formatFieldChange(field: string, oldValue: unknown, newValue: unknown): string {
    const fieldLabel = getFieldLabel(field);
    const oldLabel = getValueLabel(field, oldValue);
    const newLabel = getValueLabel(field, newValue);

    return `O campo **${fieldLabel}** foi alterado de **${oldLabel}** para **${newLabel}**`;
}

/**
 * Interface for change tracking
 */
export interface FieldChange {
    field: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface AuditDetails {
    changes?: FieldChange[];
    // Legacy format support
    [key: string]: unknown;
}

/**
 * Format audit details into natural language descriptions
 */
export function formatAuditDetails(
    action: string,
    entity: string,
    details: AuditDetails
): string[] {
    const descriptions: string[] = [];

    // Handle new format with changes array
    if (details.changes && Array.isArray(details.changes)) {
        for (const change of details.changes) {
            descriptions.push(formatFieldChange(change.field, change.oldValue, change.newValue));
        }
        return descriptions;
    }

    // Handle legacy format (direct key-value pairs)
    const skipFields = ['id', 'createdAt', 'updatedAt', 'companyId', 'createdBy'];

    for (const [key, value] of Object.entries(details)) {
        if (skipFields.includes(key)) continue;
        if (value === undefined) continue;

        const fieldLabel = getFieldLabel(key);
        const valueLabel = getValueLabel(key, value);

        if (action === 'create') {
            descriptions.push(`**${fieldLabel}**: ${valueLabel}`);
        } else if (action === 'update') {
            descriptions.push(`**${fieldLabel}** alterado para **${valueLabel}**`);
        } else {
            descriptions.push(`**${fieldLabel}**: ${valueLabel}`);
        }
    }

    return descriptions;
}

/**
 * Get a summary description for the audit action
 */
export function getActionSummary(action: string, entity: string, details: AuditDetails): string {
    const entityLabel = ENTITY_LABELS[entity] || entity;
    const actionLabel = ACTION_LABELS[action] || action;

    switch (action) {
        case 'create':
            if (entity === 'transaction' && details.amount) {
                return `${entityLabel} criada com valor de ${formatCurrency(details.amount as number)}`;
            }
            if (details.name) {
                return `${entityLabel} "${details.name}" criado(a)`;
            }
            return `${entityLabel} criado(a)`;

        case 'update':
            if (details.changes && Array.isArray(details.changes)) {
                const count = details.changes.length;
                return `${entityLabel} atualizado(a) - ${count} campo(s) alterado(s)`;
            }
            if (details.status) {
                const statusLabel = VALUE_LABELS.status?.[details.status as string] || details.status;
                return `Status da ${entityLabel.toLowerCase()} alterado para ${statusLabel}`;
            }
            return `${entityLabel} atualizado(a)`;

        case 'delete':
            return `${entityLabel} excluído(a)`;

        case 'approve':
            return `${entityLabel} aprovado(a)`;

        case 'reject':
            return `${entityLabel} rejeitado(a)`;

        case 'login':
            return 'Login realizado';

        default:
            return `${actionLabel} ${entityLabel.toLowerCase()}`;
    }
}

/**
 * Format a date to relative time ("há 5 minutos") or absolute format
 */
export function formatRelativeTime(date: Date): string {
    if (isToday(date)) {
        return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
    }

    if (isYesterday(date)) {
        return `ontem às ${format(date, 'HH:mm', { locale: ptBR })}`;
    }

    // More than a day ago
    return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/**
 * Get icon name for value change indicator
 */
export function getChangeIcon(field: string, oldValue: unknown, newValue: unknown): 'increase' | 'decrease' | 'change' | null {
    // For numeric fields, show increase/decrease
    if (typeof oldValue === 'number' && typeof newValue === 'number') {
        if (newValue > oldValue) return 'increase';
        if (newValue < oldValue) return 'decrease';
    }

    // For status changes, just indicate change
    if (field === 'status') {
        return 'change';
    }

    return null;
}

/**
 * Compare two objects and generate changes array
 */
export function generateChanges(
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>
): FieldChange[] {
    const changes: FieldChange[] = [];
    const skipFields = ['id', 'createdAt', 'updatedAt', 'companyId', 'updatedBy'];

    for (const key of Object.keys(newData)) {
        if (skipFields.includes(key)) continue;

        const oldValue = oldData[key];
        const newValue = newData[key];

        // Skip if values are equal
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;

        // Skip undefined new values
        if (newValue === undefined) continue;

        changes.push({
            field: key,
            oldValue: oldValue ?? null,
            newValue: newValue
        });
    }

    return changes;
}

/**
 * Get link URL for an entity
 */
export function getEntityLink(entity: string, entityId: string): string | null {
    switch (entity) {
        case 'transaction':
            // Would need to know the transaction type to link correctly
            // For now, return null or a generic search link
            return null;
        case 'cost_center':
            return `/centros-custo/${entityId}`;
        case 'entity':
            return `/cadastros/entidades/${entityId}`;
        case 'user':
            return `/configuracoes/usuarios`;
        case 'company':
            return `/configuracoes/empresas`;
        default:
            return null;
    }
}
