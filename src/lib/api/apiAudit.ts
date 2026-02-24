/**
 * API Externa — Audit Logging
 *
 * Registra toda requisição à API externa na coleção `api_audit_logs`.
 * Escrita assíncrona (fire-and-forget) para não impactar latência.
 */
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ApiAuditLogDocument, AuthenticatedApiContext } from "./types";
import { logger } from "@/lib/logger";

const COLLECTION = "api_audit_logs";

export async function writeApiAuditLog(
  context: AuthenticatedApiContext,
  options: {
    endpoint: string;
    method: string;
    queryParams: Record<string, string>;
    statusCode: number;
    ipAddress: string;
    userAgent: string;
  },
): Promise<void> {
  const responseTimeMs = Date.now() - context.startTime;

  const log: ApiAuditLogDocument = {
    apiKeyId: context.apiKeyId,
    apiKeyName: context.apiKeyName,
    companyId: context.companyId,
    endpoint: options.endpoint,
    method: options.method,
    queryParams: options.queryParams,
    statusCode: options.statusCode,
    responseTimeMs,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    requestId: context.requestId,
    createdAt:
      FieldValue.serverTimestamp() as unknown as import("firebase-admin").firestore.FieldValue,
  };

  try {
    // Fire-and-forget: não boquear a resposta
    adminDb
      .collection(COLLECTION)
      .add(log)
      .catch((err) => {
        logger.error("Failed to write API audit log", {
          error: err,
          requestId: context.requestId,
        });
      });
  } catch (err) {
    logger.error("Failed to initiate API audit log write", { error: err });
  }
}

/**
 * Extrai query params de uma URL para logar.
 * Remove parâmetros sensíveis caso existam.
 */
export function extractQueryParams(url: string): Record<string, string> {
  const sensitiveParams = new Set([
    "apiKey",
    "key",
    "secret",
    "token",
    "password",
  ]);
  const result: Record<string, string> = {};

  try {
    const urlObj = new URL(url);
    urlObj.searchParams.forEach((value, key) => {
      if (!sensitiveParams.has(key.toLowerCase())) {
        result[key] = value;
      }
    });
  } catch {
    // URL inválida — retorna vazio
  }

  return result;
}
