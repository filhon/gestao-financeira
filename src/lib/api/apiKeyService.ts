/**
 * API Externa — Gerenciamento de API Keys
 *
 * - API Keys são geradas com 48 chars (prefixo "gf_live_" + 40 hex chars)
 * - Secret Keys são geradas com 67 chars (prefixo "sk_" + 64 hex chars)
 * - A API Key real é hashed (SHA-256) antes de armazenar
 * - A Secret Key é criptografada (AES-256-GCM) antes de armazenar
 * - Ambas são exibidas UMA ÚNICA VEZ na criação
 */
import * as crypto from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import type { ApiKeyDocument, ApiKeyPermissions } from "./types";
import { FieldValue } from "firebase-admin/firestore";

const COLLECTION = "api_keys";

// ── Criptografia ─────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const envKey = process.env.API_HMAC_ENCRYPTION_KEY;
  if (!envKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("API_HMAC_ENCRYPTION_KEY is required in production");
    }
    // Dev fallback — 32 bytes em hex (64 chars hexadecimais válidos)
    return Buffer.from(
      "0000000000000000000000000000000000000000000000000000000000000000",
      "hex",
    );
  }
  const buf = Buffer.from(envKey, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "API_HMAC_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)",
    );
  }
  return buf;
}

function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

// ── Hashing ──────────────────────────────────────────────────────────────────

export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// ── Geração ──────────────────────────────────────────────────────────────────

function generateRawApiKey(): string {
  return `gf_live_${crypto.randomBytes(20).toString("hex")}`;
}

function generateRawSecretKey(): string {
  return `sk_${crypto.randomBytes(32).toString("hex")}`;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateApiKeyParams {
  name: string;
  companyId: string;
  createdBy: string;
  permissions?: Partial<ApiKeyPermissions>;
  allowedIPs?: string[];
  rateLimitPerMinute?: number;
  expiresAt?: Date;
}

export interface CreateApiKeyResult {
  /** ID do documento no Firestore */
  id: string;
  /** API Key — exibida UMA ÚNICA VEZ */
  apiKey: string;
  /** Secret Key — exibida UMA ÚNICA VEZ */
  secretKey: string;
  /** Prefix para exibição no dashboard */
  prefix: string;
  name: string;
  companyId: string;
  permissions: ApiKeyPermissions;
}

export async function createApiKey(
  params: CreateApiKeyParams,
): Promise<CreateApiKeyResult> {
  const rawApiKey = generateRawApiKey();
  const rawSecretKey = generateRawSecretKey();

  const defaultPermissions: ApiKeyPermissions = {
    balance: params.permissions?.balance ?? true,
    transactions: params.permissions?.transactions ?? true,
    budgets: params.permissions?.budgets ?? true,
    costCenters: params.permissions?.costCenters ?? true,
    financialSummary: params.permissions?.financialSummary ?? true,
  };

  const docData: Omit<ApiKeyDocument, "id"> = {
    hashedKey: hashApiKey(rawApiKey),
    prefix: rawApiKey.substring(0, 14), // "gf_live_abcdef"
    companyId: params.companyId,
    encryptedSecretKey: encryptSecret(rawSecretKey),
    name: params.name,
    permissions: defaultPermissions,
    allowedIPs: params.allowedIPs ?? [],
    rateLimitPerMinute: params.rateLimitPerMinute ?? 60,
    active: true,
    createdBy: params.createdBy,
    createdAt:
      FieldValue.serverTimestamp() as unknown as import("firebase-admin").firestore.Timestamp,
    updatedAt:
      FieldValue.serverTimestamp() as unknown as import("firebase-admin").firestore.Timestamp,
    ...(params.expiresAt
      ? {
          expiresAt:
            params.expiresAt as unknown as import("firebase-admin").firestore.Timestamp,
        }
      : {}),
  };

  const ref = await adminDb.collection(COLLECTION).add(docData);

  return {
    id: ref.id,
    apiKey: rawApiKey,
    secretKey: rawSecretKey,
    prefix: docData.prefix,
    name: params.name,
    companyId: params.companyId,
    permissions: defaultPermissions,
  };
}

/**
 * Busca uma API Key pelo valor completo (usando o hash como índice).
 * Retorna null se não encontrada, inativa ou expirada.
 */
export async function findApiKeyByValue(
  rawApiKey: string,
): Promise<(ApiKeyDocument & { id: string; secretKey: string }) | null> {
  const hashed = hashApiKey(rawApiKey);

  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("hashedKey", "==", hashed)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const data = doc.data() as Omit<ApiKeyDocument, "id">;

  // Chave inativa
  if (!data.active) return null;

  // Chave expirada
  if (data.expiresAt) {
    const expiry = data.expiresAt.toDate();
    if (expiry < new Date()) return null;
  }

  // Descriptografa a secret key
  let secretKey: string;
  try {
    secretKey = decryptSecret(data.encryptedSecretKey);
  } catch {
    return null;
  }

  // Atualiza lastUsedAt (fire-and-forget)
  doc.ref
    .update({
      lastUsedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});

  return {
    id: doc.id,
    ...data,
    secretKey,
  };
}

/**
 * Lista todas as API Keys de uma empresa (sem expor hashes e secrets).
 */
export async function listApiKeys(
  companyId: string,
): Promise<
  Array<
    Omit<ApiKeyDocument, "hashedKey" | "encryptedSecretKey"> & { id: string }
  >
> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("companyId", "==", companyId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as Omit<ApiKeyDocument, "id">;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hashedKey, encryptedSecretKey, ...safe } = data;
    return { id: doc.id, ...safe };
  });
}

/**
 * Revoga uma API Key (marca como inativa).
 */
export async function revokeApiKey(
  keyId: string,
  companyId: string,
): Promise<void> {
  const doc = await adminDb.collection(COLLECTION).doc(keyId).get();
  if (!doc.exists) throw new Error("API Key not found");

  const data = doc.data() as ApiKeyDocument;
  if (data.companyId !== companyId) throw new Error("Unauthorized");

  await doc.ref.update({
    active: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Atualiza permissões e configurações de uma API Key.
 */
export async function updateApiKey(
  keyId: string,
  companyId: string,
  updates: {
    name?: string;
    permissions?: Partial<ApiKeyPermissions>;
    allowedIPs?: string[];
    rateLimitPerMinute?: number;
    expiresAt?: Date | null;
  },
): Promise<void> {
  const doc = await adminDb.collection(COLLECTION).doc(keyId).get();
  if (!doc.exists) throw new Error("API Key not found");

  const data = doc.data() as ApiKeyDocument;
  if (data.companyId !== companyId) throw new Error("Unauthorized");

  const payload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.permissions !== undefined) {
    payload.permissions = { ...data.permissions, ...updates.permissions };
  }
  if (updates.allowedIPs !== undefined) payload.allowedIPs = updates.allowedIPs;
  if (updates.rateLimitPerMinute !== undefined)
    payload.rateLimitPerMinute = updates.rateLimitPerMinute;
  if (updates.expiresAt !== undefined) {
    payload.expiresAt = updates.expiresAt ?? FieldValue.delete();
  }

  await doc.ref.update(payload);
}
