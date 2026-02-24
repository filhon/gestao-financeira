/**
 * API Externa — Tipos compartilhados
 */
import type { firestore } from "firebase-admin";

// ── API Key ──────────────────────────────────────────────────────────────────

export interface ApiKeyPermissions {
  balance: boolean;
  transactions: boolean;
  budgets: boolean;
  costCenters: boolean;
  financialSummary: boolean;
}

export type ApiKeyPermission = keyof ApiKeyPermissions;

/**
 * Documento armazenado no Firestore (coleção `api_keys`).
 * A API Key real NUNCA é armazenada — apenas seu SHA-256.
 * A Secret Key é armazenada criptografada com AES-256-GCM.
 */
export interface ApiKeyDocument {
  id: string;
  /** SHA-256 da API Key completa */
  hashedKey: string;
  /** Primeiros 14 chars da key — para exibição no admin (ex: "gf_live_a1b2c3") */
  prefix: string;
  /** Empresa vinculada (tenant isolation) */
  companyId: string;
  /** Secret Key criptografada com AES-256-GCM: "iv_hex:tag_hex:cipher_hex" */
  encryptedSecretKey: string;
  /** Nome descritivo da integração */
  name: string;
  permissions: ApiKeyPermissions;
  /** Lista de IPs permitidos. Array vazio = qualquer IP */
  allowedIPs: string[];
  /** Máximo de requisições por minuto para esta key */
  rateLimitPerMinute: number;
  active: boolean;
  expiresAt?: firestore.Timestamp;
  lastUsedAt?: firestore.Timestamp;
  createdBy: string;
  createdAt: firestore.Timestamp;
  updatedAt: firestore.Timestamp;
}

// ── Audit Log ────────────────────────────────────────────────────────────────

export interface ApiAuditLogDocument {
  apiKeyId: string;
  apiKeyName: string;
  companyId: string;
  endpoint: string;
  method: string;
  queryParams: Record<string, string>;
  statusCode: number;
  responseTimeMs: number;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  createdAt: firestore.FieldValue;
}

// ── Contexto de request autenticado ─────────────────────────────────────────

export interface AuthenticatedApiContext {
  companyId: string;
  apiKeyId: string;
  apiKeyName: string;
  permissions: ApiKeyPermissions;
  requestId: string;
  startTime: number;
}

// ── Respostas paginadas ──────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
