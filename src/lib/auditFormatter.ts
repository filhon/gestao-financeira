/**
 * Audit Log Formatter
 * Provides utilities for formatting audit log details in natural language (Portuguese)
 */

import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

// Field name translations (technical -> Portuguese)
export const FIELD_LABELS: Record<string, string> = {
  // Transaction fields
  amount: "Valor",
  finalAmount: "Valor Final",
  description: "Descrição",
  status: "Status",
  type: "Tipo",
  dueDate: "Data de Vencimento",
  paymentDate: "Data de Pagamento",
  paymentMethod: "Forma de Pagamento",
  bankAccountId: "Conta Bancária",
  accountId: "Conta Contábil",
  supplierOrClient: "Fornecedor/Cliente",
  entityId: "Fornecedor/Cliente (cadastro)",
  costCenterId: "Centro de Custo",
  costCenterAllocation: "Alocação de Centros de Custo",
  details: "Detalhes",
  notes: "Observações",
  discount: "Desconto",
  interest: "Juros",
  attachments: "Anexos",
  barcode: "Linha Digitável",
  documentNumber: "Nº do Documento",
  competence: "Competência",
  requestOrigin: "Área Solicitante",
  installments: "Parcelas",
  recurrence: "Recorrência",

  // User fields
  role: "Perfil",
  displayName: "Nome",
  email: "E-mail",
  department: "Departamento",
  active: "Ativo",
  companyId: "Empresa",

  // Company fields
  name: "Nome",
  cnpj: "CNPJ",
  phone: "Telefone",
  address: "Endereço",
  logoUrl: "Logo",

  // Entity fields
  document: "Documento",
  category: "Categoria",
  bankName: "Banco",
  agency: "Agência",
  account: "Conta",
  accountType: "Tipo de Conta",
  pixKeyType: "Tipo de Chave PIX",
  pixKey: "Chave PIX",
  lateFeePercent: "Multa por Atraso (%)",
  monthlyInterestPercent: "Juros de Mora (% a.m.)",
  relatedParty: "Parte Relacionada",
  autoConfirmReceipts: "Confirmar Comprovantes Automaticamente",
  paymentHold: "Bloqueio de Pagamento",
  paymentPromise: "Promessa de Pagamento",
  reason: "Motivo",

  // Common
  createdAt: "Criado em",
  updatedAt: "Atualizado em",
  createdBy: "Criado por",
  approvedBy: "Aprovado por",
  approvedAt: "Aprovado em",
  releasedBy: "Liberado por",
  releasedAt: "Liberado em",

  // Audit specific
  scope: "Escopo",
  count: "Quantidade",
  isRecurrenceUpdate: "Atualização em Série",
  transactionIds: "Transações",
  externalId: "ID no extrato",
  score: "Confiança",
  via: "Via",
  through: "Conciliado até",
  balance: "Saldo",
  pattern: "Padrão",
  code: "Código",
  previousCode: "Código anterior",
  archived: "Arquivada",
  year: "Exercício",
  previousAmount: "Valor anterior",
  newAmount: "Novo valor",
  costCenterName: "Centro de Custo",
  budgetExceededReason: "Justificativa de estouro",
  removed: "Removida",
  date: "Data",
  note: "Nota",
  rows: "Linhas",
  filters: "Filtros",
  ipAddress: "IP",
  userAgent: "Navegador",
  method: "Método",
};

// Value translations (technical -> Portuguese)
export const VALUE_LABELS: Record<string, Record<string, string>> = {
  status: {
    draft: "Rascunho",
    pending_approval: "Pendente de Aprovação",
    approved: "Aprovado",
    pending_authorization: "Pendente de Autorização",
    authorized: "Autorizado",
    paid: "Pago",
    rejected: "Rejeitado",
  },
  type: {
    payable: "Contas a Pagar",
    receivable: "Contas a Receber",
  },
  paymentMethod: {
    pix: "PIX",
    boleto: "Boleto",
    transfer: "Transferência",
    credit_card: "Cartão de Crédito",
    cash: "Dinheiro",
  },
  role: {
    admin: "Administrador",
    financial_manager: "Gestor Financeiro",
    approver: "Aprovador",
    releaser: "Liberador",
    auditor: "Auditor",
    user: "Usuário",
  },
  category: {
    supplier: "Fornecedor",
    client: "Cliente",
    both: "Ambos",
  },
  accountType: {
    checking: "Conta Corrente",
    savings: "Poupança",
  },
  pixKeyType: {
    cpf: "CPF",
    cnpj: "CNPJ",
    email: "E-mail",
    phone: "Telefone",
    random: "Chave Aleatória",
  },
  entityType: {
    individual: "Pessoa Física",
    company: "Pessoa Jurídica",
  },
  scope: {
    single: "Único",
    series: "Série",
  },
  userStatus: {
    pending_company_setup: "Aguardando Empresa",
    pending_approval: "Aguardando Aprovação",
    active: "Ativo",
    rejected: "Rejeitado",
  },
};

// Action translations
export const ACTION_LABELS: Record<string, string> = {
  create: "criou",
  update: "atualizou",
  delete: "excluiu",
  approve: "aprovou",
  reject: "rejeitou",
  login: "fez login",
  pay: "pagou",
  authorize: "autorizou",
  release: "liberou",
  hold: "bloqueou o pagamento de",
  release_hold: "desbloqueou o pagamento de",
  promise: "registrou promessa de pagamento em",
  confirm_match: "conciliou",
  auto_confirm_match: "conciliou automaticamente",
  reject_match: "rejeitou a sugestão de",
  remove_match: "desfez a conciliação de",
  delete_comprovante: "excluiu",
  close_period: "fechou a conciliação de",
  reopen_period: "reabriu a conciliação de",
  export: "exportou",
};

/** Substantivo da ação, usado no badge e nos filtros. */
export const ACTION_NOUNS: Record<string, string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  approve: "Aprovação",
  reject: "Rejeição",
  login: "Login",
  pay: "Pagamento",
  authorize: "Autorização",
  release: "Liberação",
  hold: "Bloqueio",
  release_hold: "Desbloqueio",
  promise: "Promessa",
  confirm_match: "Conciliação",
  auto_confirm_match: "Conciliação automática",
  reject_match: "Sugestão recusada",
  remove_match: "Conciliação desfeita",
  delete_comprovante: "Exclusão",
  close_period: "Fechamento",
  reopen_period: "Reabertura",
  export: "Exportação",
};

/**
 * Campos cuja alteração merece atenção de quem audita: mexem em quanto se
 * paga, para quem, ou em quem pode fazer o quê.
 */
export const SENSITIVE_FIELDS = new Set([
  "amount",
  "finalAmount",
  "discount",
  "interest",
  "bankAccountId",
  "bankName",
  "agency",
  "account",
  "accountType",
  "pixKey",
  "pixKeyType",
  "barcode",
  "entityId",
  "document",
  "role",
  "paymentHold",
  "autoConfirmReceipts",
]);

const SENSITIVE_ACTIONS = new Set([
  "delete",
  "delete_comprovante",
  "reject",
  "remove_match",
  "reopen_period",
  "release_hold",
]);

/** Visões prontas: atalhos para as perguntas que auditor faz toda semana. */
export const AUDIT_VIEWS: Record<
  string,
  { label: string; fields?: string[]; action?: string; entity?: string }
> = {
  bank: {
    label: "Dados bancários alterados",
    fields: [
      "bankName",
      "agency",
      "account",
      "accountType",
      "pixKey",
      "pixKeyType",
      "bankAccountId",
    ],
  },
  amounts: {
    label: "Valores alterados",
    fields: ["amount", "finalAmount", "discount", "interest"],
  },
  roles: { label: "Perfis de acesso alterados", fields: ["role"] },
  deletes: { label: "Exclusões", action: "delete" },
  rejects: { label: "Rejeições", action: "reject" },
};

export function isSensitive(
  action: string,
  details: AuditDetails | undefined,
): boolean {
  if (SENSITIVE_ACTIONS.has(action)) return true;
  return changedFieldsOf(details).some((f) => SENSITIVE_FIELDS.has(f));
}

/** Campos tocados por um log, no formato novo (changes) ou legado (chaves). */
export function changedFieldsOf(details: AuditDetails | undefined): string[] {
  if (!details) return [];
  if (Array.isArray(details.changes))
    return details.changes.map((c) => c.field);
  return Object.keys(details).filter((k) => !LEGACY_SKIP.includes(k));
}

const LEGACY_SKIP = [
  "id",
  "createdAt",
  "updatedAt",
  "companyId",
  "createdBy",
  "updatedBy",
  "storagePath",
];

export type ActorKind = "user" | "automation" | "magic_link" | "api";

/** Quem fez: pessoa, automação, link de aprovação ou integração. */
export function actorKind(log: {
  userId: string;
  action: string;
  details?: Record<string, unknown>;
}): ActorKind {
  if (log.userId === "magic-link" || log.details?.via === "magic_link")
    return "magic_link";
  if (log.details?.via === "api" || log.userId.startsWith("api:")) return "api";
  if (log.action.startsWith("auto_") || log.userId === "trigger")
    return "automation";
  return "user";
}

export const ACTOR_KIND_LABELS: Record<ActorKind, string> = {
  user: "Usuário",
  automation: "Automação",
  magic_link: "Link de aprovação",
  api: "API",
};

// Entity translations
export const ENTITY_LABELS: Record<string, string> = {
  transaction: "Transação",
  user: "Usuário",
  company: "Empresa",
  cost_center: "Centro de Custo",
  entity: "Entidade",
  batch: "Lote de Pagamento",
  recurrence: "Recorrência",
  budget: "Orçamento",
  chart_account: "Plano de Contas",
  bank_account: "Conta Bancária",
  reconciliation_rule: "Regra de Conciliação",
  comprovante: "Comprovante",
  audit_log: "Log de Auditoria",
};

/** Nomes de registros por ID (contas, centros, usuários…) para trocar IDs crus. */
export type NameResolver = ReadonlyMap<string, string>;

const ID_FIELDS = new Set([
  "bankAccountId",
  "accountId",
  "costCenterId",
  "entityId",
  "approvedBy",
  "releasedBy",
  "createdBy",
]);

function isTimestampLike(value: unknown): value is { toDate(): Date } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
}

/** Timestamp serializado ({seconds, nanoseconds}) que perdeu o protótipo. */
function asRawTimestamp(value: unknown): Date | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  const seconds = v.seconds ?? v._seconds;
  if (keys.length === 2 && typeof seconds === "number") {
    return new Date(seconds * 1000);
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (isTimestampLike(value)) return value.toDate();
  return asRawTimestamp(value);
}

/**
 * Forma canônica para comparar antes/depois: o documento lido vem com
 * Timestamp, o formulário manda Date; objetos chegam com chaves em ordem
 * diferente; "" e ausente significam o mesmo vazio. Datas comparam pelo dia,
 * que é a granularidade de todo campo de data do lançamento.
 */
function comparable(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  const date = toDate(value);
  if (date) return format(date, "yyyy-MM-dd");
  if (Array.isArray(value)) {
    return value.length ? value.map(comparable) : null;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, comparable(v)] as const)
      .filter(([, v]) => v !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/**
 * Format a currency value
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
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
export function getValueLabel(
  field: string,
  value: unknown,
  names?: NameResolver,
): string {
  if (value === null || value === undefined || value === "") {
    return "(vazio)";
  }

  // Check if there's a translation map for this field
  const fieldValues = VALUE_LABELS[field];
  if (fieldValues && typeof value === "string" && fieldValues[value]) {
    return fieldValues[value];
  }

  if (typeof value === "string" && ID_FIELDS.has(field)) {
    return names?.get(value) ?? `registro ${value.slice(0, 6)}…`;
  }

  const date = toDate(value);
  if (date) return format(date, "dd/MM/yyyy", { locale: ptBR });

  // Handle specific types
  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    // Check if it looks like a currency field
    if (
      field.toLowerCase().includes("amount") ||
      field.toLowerCase().includes("value") ||
      field === "discount" ||
      field === "interest" ||
      field === "budget" ||
      field === "budgetLimit" ||
      field === "balance"
    ) {
      return formatCurrency(value);
    }
    return value.toLocaleString("pt-BR");
  }

  if (typeof value === "object") {
    // Arrays
    if (Array.isArray(value)) {
      if (value.length === 0) return "(vazio)";
      if (field === "costCenterAllocation") {
        return (value as { costCenterId?: string; percentage?: number }[])
          .map((a) => {
            const name =
              (a.costCenterId && names?.get(a.costCenterId)) || "Centro";
            return `${name} (${a.percentage ?? 0}%)`;
          })
          .join(", ");
      }
      if (value.every((v) => typeof v === "string")) {
        return (value as string[]).map((v) => names?.get(v) ?? v).join(", ");
      }
      // Array of attachment objects
      if (
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null &&
        ("name" in value[0] || "url" in value[0])
      ) {
        return value
          .map((a: { name?: string }) => a.name || "anexo")
          .join(", ");
      }
      return `${value.length} item(s)`;
    }

    // Known object fields with specific formatting
    if (field === "requestOrigin") {
      const name = (value as { name?: unknown }).name;
      if (typeof name === "string" && name) return name;
    }

    if (field === "installments") {
      const obj = value as Record<string, unknown>;
      const count = obj.count ?? obj.total ?? obj.installments;
      const freq =
        typeof obj.frequency === "string"
          ? ({ monthly: "mensais", weekly: "semanais", yearly: "anuais" }[
              obj.frequency
            ] ?? obj.frequency)
          : "";
      if (count) return `${count} parcela(s)${freq ? ` ${freq}` : ""}`;
    }

    if (field === "recurrence") {
      const obj = value as Record<string, unknown>;
      const freqMap: Record<string, string> = {
        daily: "diária",
        weekly: "semanal",
        monthly: "mensal",
        yearly: "anual",
      };
      const freq =
        typeof obj.frequency === "string"
          ? (freqMap[obj.frequency] ?? obj.frequency)
          : "";
      if (obj.isRecurring === false) return "Sem recorrência";
      if (freq) return `Recorrência ${freq}`;
    }

    if (field === "address") {
      const obj = value as Record<string, unknown>;
      const parts = [obj.street, obj.city, obj.state].filter(Boolean);
      if (parts.length > 0) return parts.join(", ");
    }

    // Fallback: "chave: valor" dos campos preenchidos, em vez de só contá-los
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${getFieldLabel(k)}: ${getValueLabel(k, v, names)}`);
    return parts.length ? parts.join("; ") : "(vazio)";
  }

  return String(value);
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

/** Uma linha da tabela de detalhes; `before` só existe quando houve diff. */
export interface DetailRow {
  field: string;
  label: string;
  before?: string;
  after: string;
  direction?: "up" | "down";
  sensitive: boolean;
}

/**
 * Linhas de detalhe de um log. Logs antigos gravaram mudanças fantasmas
 * (Timestamp × Date, objetos reordenados): essas saem aqui, na leitura.
 */
export function detailRows(
  details: AuditDetails | undefined,
  names?: NameResolver,
): DetailRow[] {
  if (!details) return [];
  if (Array.isArray(details.changes)) {
    return details.changes
      .filter((c) => !sameValue(c.oldValue, c.newValue))
      .map((c) => {
        const { oldValue: a, newValue: b } = c;
        const numeric = typeof a === "number" && typeof b === "number";
        return {
          field: c.field,
          label: getFieldLabel(c.field),
          before: getValueLabel(c.field, a, names),
          after: getValueLabel(c.field, b, names),
          direction: numeric ? (b > a ? "up" : "down") : undefined,
          sensitive: SENSITIVE_FIELDS.has(c.field),
        };
      });
  }
  return Object.entries(details)
    .filter(([k, v]) => !LEGACY_SKIP.includes(k) && v !== undefined)
    .map(([k, v]) => ({
      field: k,
      label: getFieldLabel(k),
      after: getValueLabel(k, v, names),
      sensitive: SENSITIVE_FIELDS.has(k),
    }));
}

/**
 * Resumo de uma linha. Ação e entidade já têm coluna própria, então o resumo
 * diz o que mudou, não repete "transação atualizada".
 */
export function getActionSummary(
  action: string,
  details: AuditDetails | undefined,
  names?: NameResolver,
): string {
  const d = details ?? {};
  if (
    (action === "create" || action === "delete") &&
    typeof d.amount === "number"
  ) {
    return `Valor ${formatCurrency(d.amount)}`;
  }
  if (typeof d.reason === "string" && d.reason) return `Motivo: ${d.reason}`;
  if (typeof d.ipAddress === "string") {
    return [d.method, `IP ${d.ipAddress}`].filter(Boolean).join(" · ");
  }
  if (Array.isArray(d.transactionIds)) {
    const n = d.transactionIds.length;
    return `${n} ${n === 1 ? "transação vinculada" : "transações vinculadas"}`;
  }

  const rows = detailRows(d, names);
  if (Array.isArray(d.changes) && rows.length === 0) {
    return "Nenhuma alteração efetiva";
  }
  if (rows.length === 1 && rows[0].before !== undefined) {
    return `${rows[0].label}: ${rows[0].before} → ${rows[0].after}`;
  }
  const labels = rows.slice(0, 3).map((r) => r.label);
  if (rows.length > 3) labels.push(`+${rows.length - 3}`);
  return labels.join(", ");
}

/** Cabeçalho de dia da lista: "Hoje", "Ontem", "sexta, 24 de outubro". */
export function dayLabel(date: Date): string {
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  const pattern =
    date.getFullYear() === new Date().getFullYear()
      ? "EEEE, d 'de' MMMM"
      : "EEEE, d 'de' MMMM 'de' yyyy";
  return format(date, pattern, { locale: ptBR });
}

/**
 * Compare two objects and generate changes array
 */
export function generateChanges(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const skipFields = ["id", "createdAt", "updatedAt", "companyId", "updatedBy"];

  for (const key of Object.keys(newData)) {
    if (skipFields.includes(key)) continue;

    const oldValue = oldData[key];
    const newValue = newData[key];

    // Skip undefined new values
    if (newValue === undefined) continue;

    if (sameValue(oldValue, newValue)) continue;

    changes.push({
      field: key,
      oldValue: oldValue ?? null,
      newValue: newValue,
    });
  }

  return changes;
}

/**
 * Get link URL for an entity
 */
export function getEntityLink(entity: string, entityId: string): string | null {
  switch (entity) {
    case "cost_center":
      return `/centros-custo/${entityId}`;
    case "entity":
      return `/cadastros/entidades/${entityId}`;
    case "user":
      return `/configuracoes/usuarios`;
    case "company":
      return `/configuracoes/empresas`;
    case "batch":
      return `/financeiro/lotes`;
    case "chart_account":
      return `/cadastros/plano-de-contas`;
    case "bank_account":
      return `/cadastros/contas-bancarias`;
    case "reconciliation_rule":
      return `/financeiro/conciliacao`;
    case "comprovante":
      return `/financeiro/comprovantes`;
    default:
      return null;
  }
}
