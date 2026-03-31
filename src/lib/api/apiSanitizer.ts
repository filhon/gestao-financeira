/**
 * API Externa — Sanitização de dados para responses
 *
 * Remove campos internos/sensíveis antes de expor para integrações externas.
 */
import type { Transaction, CostCenter } from "@/lib/types";

// Campos da Transaction que NUNCA devem ser expostos externamente
const TRANSACTION_BLOCKED_FIELDS = new Set([
  "approvalToken",
  "approvalTokenExpiresAt",
  "batchId",
  "batchRejectionReason",
  "batchAdjustedAmount",
  "createdBy",
  "approvedBy",
  "releasedBy",
  "reconciledBy",
  "externalId",
]);

// Campos do CostCenter que não são relevantes externamente
const COST_CENTER_BLOCKED_FIELDS = new Set([
  "allowedUserIds",
  "approverEmail",
  "releaserEmail",
]);

// ── Transaction ──────────────────────────────────────────────────────────────

export interface SanitizedTransaction {
  id: string;
  description: string;
  amount: number;
  finalAmount?: number;
  discount?: number;
  interest?: number;
  type: string;
  status: string;
  dueDate: string;
  paymentDate?: string;
  paymentMethod?: string;
  supplier?: string;
  entityId?: string;
  costCenter?: { id: string; name: string; code: string } | null;
  costCenterAllocations?: Array<{
    costCenterId: string;
    costCenterName?: string;
    percentage: number;
    amount: number;
  }>;
  installments?: {
    current: number;
    total: number;
    groupId: string;
  };
  recurrence?: {
    isRecurring: boolean;
    frequency?: string;
  };
  requestOrigin?: {
    type: string;
    name: string;
  };
  notes?: string;
  reconciled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export function sanitizeTransaction(
  txn: Transaction,
  costCenterMap?: Map<string, CostCenter>,
): SanitizedTransaction {
  // Resolve custo center principal
  let costCenter: SanitizedTransaction["costCenter"] = null;
  if (txn.costCenterId && costCenterMap?.has(txn.costCenterId)) {
    const cc = costCenterMap.get(txn.costCenterId)!;
    costCenter = { id: cc.id, name: cc.name, code: cc.code };
  }

  // Enriquece alocações com nome do centro de custo
  const costCenterAllocations = txn.costCenterAllocation?.map((alloc) => {
    const cc = costCenterMap?.get(alloc.costCenterId);
    return {
      costCenterId: alloc.costCenterId,
      costCenterName: cc?.name,
      percentage: alloc.percentage,
      amount: alloc.amount,
    };
  });

  // Remove campos bloqueados
  const sanitized: SanitizedTransaction = {
    id: txn.id,
    description: txn.description,
    amount: txn.amount,
    type: txn.type,
    status: txn.status,
    dueDate:
      txn.dueDate instanceof Date
        ? txn.dueDate.toISOString()
        : String(txn.dueDate),
    createdAt:
      txn.createdAt instanceof Date
        ? txn.createdAt.toISOString()
        : String(txn.createdAt),
    updatedAt:
      txn.updatedAt instanceof Date
        ? txn.updatedAt.toISOString()
        : String(txn.updatedAt),
  };

  // Campos opcionais
  if (txn.finalAmount !== undefined) sanitized.finalAmount = txn.finalAmount;
  if (txn.discount !== undefined) sanitized.discount = txn.discount;
  if (txn.interest !== undefined) sanitized.interest = txn.interest;
  if (txn.paymentDate) {
    sanitized.paymentDate =
      txn.paymentDate instanceof Date
        ? txn.paymentDate.toISOString()
        : String(txn.paymentDate);
  }
  if (txn.paymentMethod) sanitized.paymentMethod = txn.paymentMethod;
  if (txn.supplierOrClient) sanitized.supplier = txn.supplierOrClient;
  if (txn.entityId) sanitized.entityId = txn.entityId;
  if (costCenter) sanitized.costCenter = costCenter;
  if (costCenterAllocations?.length)
    sanitized.costCenterAllocations = costCenterAllocations;
  if (txn.installments) sanitized.installments = txn.installments;
  if (txn.recurrence) {
    sanitized.recurrence = {
      isRecurring: txn.recurrence.isRecurring,
      frequency: txn.recurrence.frequency,
    };
  }
  if (txn.requestOrigin) sanitized.requestOrigin = txn.requestOrigin;
  if (txn.notes) sanitized.notes = txn.notes;
  if (txn.reconciled !== undefined) sanitized.reconciled = txn.reconciled;

  // Garantia: nenhum campo bloqueado passou
  for (const field of TRANSACTION_BLOCKED_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (sanitized as any)[field];
  }

  return sanitized;
}

// ── CostCenter ───────────────────────────────────────────────────────────────

export interface SanitizedCostCenter {
  id: string;
  name: string;
  code: string;
  description?: string;
  parentId?: string;
  budget?: number;
  budgetYear?: number;
  availableBalance?: number;
  children?: SanitizedCostCenter[];
}

export function sanitizeCostCenter(
  cc: CostCenter,
  children?: SanitizedCostCenter[],
): SanitizedCostCenter {
  const sanitized: SanitizedCostCenter = {
    id: cc.id,
    name: cc.name,
    code: cc.code,
  };

  if (cc.description) sanitized.description = cc.description;
  if (cc.parentId) sanitized.parentId = cc.parentId;
  if (cc.budget !== undefined) sanitized.budget = cc.budget;
  if (cc.budgetYear !== undefined) sanitized.budgetYear = cc.budgetYear;
  const ccWithBalance = cc as CostCenter & { availableBalance?: number };
  if (ccWithBalance.availableBalance !== undefined)
    sanitized.availableBalance = ccWithBalance.availableBalance;
  if (children) sanitized.children = children;

  // Garantia: campos bloqueados não passam
  for (const field of COST_CENTER_BLOCKED_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (sanitized as any)[field];
  }

  return sanitized;
}
