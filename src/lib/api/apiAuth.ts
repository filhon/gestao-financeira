/**
 * API Externa — Middleware de Autenticação
 *
 * Implementa o fluxo completo de autenticação por request:
 *   1. Valida headers obrigatórios
 *   2. Valida janela de timestamp (anti-replay ±5min)
 *   3. Busca e valida a API Key
 *   4. Valida IP (se configurado)
 *   5. Verifica permissão para o endpoint
 *   6. Valida HMAC-SHA256 com timing-safe comparison
 *   7. Aplica rate limiting
 *   8. Retorna contexto autenticado
 */
import * as crypto from "crypto";
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { findApiKeyByValue } from "./apiKeyService";
import { checkApiRateLimit } from "./apiRateLimit";
import { ApiErrors, generateRequestId } from "./apiResponse";
import type { ApiKeyPermission, AuthenticatedApiContext } from "./types";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Janela de tolerância de timestamp: ±5 minutos em segundos */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

// ── Funções auxiliares ───────────────────────────────────────────────────────

function getClientIp(request: NextRequest): string {
  // Confia no header x-forwarded-for apenas para o primeiro IP (proxy mais próximo)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "127.0.0.1";
}

function hashBody(body: string): string {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

function buildSignaturePayload(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
): string {
  return `${method}\n${path}\n${timestamp}\n${bodyHash}`;
}

function computeHmac(secretKey: string, payload: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(payload, "utf8")
    .digest("hex");
}

/** Comparação timing-safe para strings de mesmo comprimento */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Executa comparação fake para manter timing constante
    crypto.timingSafeEqual(
      Buffer.from(a.padEnd(64, "0"), "hex"),
      Buffer.from(a.padEnd(64, "0"), "hex"),
    );
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ── Autenticação principal ───────────────────────────────────────────────────

export type AuthResult =
  | { success: true; context: AuthenticatedApiContext }
  | { success: false; response: NextResponse };

/**
 * Autentica um request e retorna o contexto ou uma resposta de erro.
 *
 * @param request - NextRequest da rota
 * @param requiredPermission - Permissão necessária para este endpoint
 * @param bodyText - Body do request como string (use "" para GET)
 */
export async function authenticateApiRequest(
  request: NextRequest,
  requiredPermission: ApiKeyPermission,
  bodyText = "",
): Promise<AuthResult> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // 1. Extrair headers obrigatórios
  const apiKey = request.headers.get("x-api-key");
  const timestamp = request.headers.get("x-timestamp");
  const signature = request.headers.get("x-signature");

  if (!apiKey || !timestamp || !signature) {
    return { success: false, response: ApiErrors.missingHeaders() };
  }

  // 2. Validar janela de timestamp (anti-replay)
  const tsNumber = parseInt(timestamp, 10);
  if (isNaN(tsNumber)) {
    return { success: false, response: ApiErrors.timestampExpired() };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = Math.abs(nowSeconds - tsNumber);

  if (diff > TIMESTAMP_TOLERANCE_SECONDS) {
    return { success: false, response: ApiErrors.timestampExpired() };
  }

  // 3. Buscar e validar API Key
  const keyDoc = await findApiKeyByValue(apiKey);
  if (!keyDoc) {
    return { success: false, response: ApiErrors.invalidKey() };
  }

  // 4. Validar IP (se configurado)
  const clientIp = getClientIp(request);
  if (keyDoc.allowedIPs.length > 0) {
    const isAllowed = keyDoc.allowedIPs.some((allowed) => {
      // Suporte básico a CIDR /32 e IPs exatos
      return allowed === clientIp || allowed === `${clientIp}/32`;
    });
    if (!isAllowed) {
      return { success: false, response: ApiErrors.ipNotAllowed() };
    }
  }

  // 5. Verificar permissão para o endpoint
  if (!keyDoc.permissions[requiredPermission]) {
    return {
      success: false,
      response: ApiErrors.forbidden(requiredPermission),
    };
  }

  // 6. Validar HMAC-SHA256
  const { pathname } = new URL(request.url);
  const body = bodyText || "";
  const bodyHash = hashBody(body);
  const signaturePayload = buildSignaturePayload(
    request.method,
    pathname,
    timestamp,
    bodyHash,
  );
  const expectedSignature = computeHmac(keyDoc.secretKey, signaturePayload);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return { success: false, response: ApiErrors.signatureInvalid() };
  }

  // 7. Rate limiting
  const { pathname: endpoint } = new URL(request.url);
  const rateLimitResult = checkApiRateLimit(
    clientIp,
    keyDoc.id,
    endpoint,
    keyDoc.rateLimitPerMinute,
  );

  if (!rateLimitResult.allowed) {
    return {
      success: false,
      response: ApiErrors.rateLimited(rateLimitResult.resetAt),
    };
  }

  // 8. Contexto autenticado
  const context: AuthenticatedApiContext = {
    companyId: keyDoc.companyId,
    apiKeyId: keyDoc.id,
    apiKeyName: keyDoc.name,
    permissions: keyDoc.permissions,
    requestId,
    startTime,
  };

  return { success: true, context };
}

/**
 * Retorna os headers de rate limit para incluir nas respostas.
 */
export function getRateLimitHeaders(
  ip: string,
  apiKeyId: string,
  endpoint: string,
  keyRateLimit: number,
): import("./apiResponse").RateLimitHeaders {
  const result = checkApiRateLimit(ip, apiKeyId, endpoint, keyRateLimit);
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
  };
}
