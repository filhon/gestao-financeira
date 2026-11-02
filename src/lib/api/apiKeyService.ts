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

  // Menor privilégio: o que não for pedido explicitamente fica negado.
  const defaultPermissions: ApiKeyPermissions = {
    balance: params.permissions?.balance ?? false,
    transactions: params.permissions?.transactions ?? false,
    budgets: params.permissions?.budgets ?? false,
    costCenters: params.permissions?.costCenters ?? false,
    financialSummary: params.permissions?.financialSummary ?? false,
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

  return {
    id: doc.id,
    ...data,
    secretKey,
  };
}

/**
 * Registra o uso da chave. Chamar só depois de validar IP, permissão e
 * assinatura: quem tem apenas a API Key (sem o segredo) não pode manter a
 * data "viva". Fire-and-forget.
 */
export function touchApiKeyLastUsed(keyId: string): void {
  adminDb
    .collection(COLLECTION)
    .doc(keyId)
    .update({ lastUsedAt: FieldValue.serverTimestamp() })
    .catch(() => {});
}

/**
 * Lista todas as API Keys de uma empresa (sem expor hashes e secrets).
 * `createdByName` / `revokedByName` são resolvidos a partir de `users`.
 */
export async function listApiKeys(companyId: string): Promise<
  Array<
    Omit<ApiKeyDocument, "hashedKey" | "encryptedSecretKey"> & {
      id: string;
      createdByName?: string;
      revokedByName?: string;
    }
  >
> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("companyId", "==", companyId)
    .orderBy("createdAt", "desc")
    .get();

  const keys = snapshot.docs.map((doc) => {
    const data = doc.data() as Omit<ApiKeyDocument, "id">;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hashedKey, encryptedSecretKey, ...safe } = data;
    return { id: doc.id, ...safe };
  });

  const uids = [
    ...new Set(keys.flatMap((k) => [k.createdBy, k.revokedBy]).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (uids.length > 0) {
    const userDocs = await adminDb.getAll(
      ...uids.map((uid) => adminDb.collection("users").doc(uid)),
    );
    for (const u of userDocs) {
      const name = u.data()?.displayName as string | undefined;
      if (name) names.set(u.id, name);
    }
  }

  return keys.map((k) => ({
    ...k,
    createdByName: names.get(k.createdBy),
    revokedByName: k.revokedBy ? names.get(k.revokedBy) : undefined,
  }));
}

/**
 * Revoga uma API Key (marca como inativa e registra quem/quando).
 */
export async function revokeApiKey(
  keyId: string,
  companyId: string,
  revokedBy: string,
): Promise<void> {
  const doc = await adminDb.collection(COLLECTION).doc(keyId).get();
  if (!doc.exists) throw new Error("API Key not found");

  const data = doc.data() as ApiKeyDocument;
  if (data.companyId !== companyId) throw new Error("Unauthorized");

  await doc.ref.update({
    active: false,
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy,
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
