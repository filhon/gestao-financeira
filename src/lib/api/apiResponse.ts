/**
 * API Externa — Helpers de resposta padronizada
 */
import { NextResponse } from "next/server";
import type { PaginationMeta } from "./types";

// ── Request ID ───────────────────────────────────────────────────────────────

export function generateRequestId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const random = Array.from(
    { length: 16 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return `req_${random}`;
}

// ── Rate Limit Headers ───────────────────────────────────────────────────────

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
}

// ── Success Responses ────────────────────────────────────────────────────────

interface SuccessOptions {
  requestId: string;
  companyId: string;
  extra?: Record<string, unknown>;
  rateLimitHeaders?: RateLimitHeaders;
  cacheControl?: string;
}

export function apiSuccess(
  data: unknown,
  options: SuccessOptions,
): NextResponse {
  const { requestId, companyId, extra, rateLimitHeaders, cacheControl } =
    options;

  const headers: Record<string, string> = {
    "X-Request-ID": requestId,
    "X-Content-Type-Options": "nosniff",
    ...(rateLimitHeaders ?? {}),
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
  };

  return NextResponse.json(
    {
      data,
      meta: { companyId, requestId, ...extra },
    },
    { status: 200, headers },
  );
}

export function apiSuccessPaginated(
  data: unknown,
  pagination: PaginationMeta,
  options: SuccessOptions,
): NextResponse {
  const { requestId, companyId, extra, rateLimitHeaders } = options;

  const headers: Record<string, string> = {
    "X-Request-ID": requestId,
    "X-Content-Type-Options": "nosniff",
    ...(rateLimitHeaders ?? {}),
  };

  return NextResponse.json(
    {
      data,
      pagination,
      meta: { companyId, requestId, ...extra },
    },
    { status: 200, headers },
  );
}

// ── Error Responses ──────────────────────────────────────────────────────────

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: {
    requestId?: string;
    retryAfter?: number;
    details?: unknown;
  },
): NextResponse {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
  };

  if (extra?.requestId) {
    headers["X-Request-ID"] = extra.requestId;
  }
  if (extra?.retryAfter) {
    headers["Retry-After"] = String(extra.retryAfter);
  }

  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra?.details ? { details: extra.details } : {}),
      },
    },
    { status, headers },
  );
}

// ── Erros pré-definidos ──────────────────────────────────────────────────────

export const ApiErrors = {
  missingHeaders: () =>
    apiError(401, "UNAUTHORIZED", "Missing required authentication headers"),

  invalidKey: () => apiError(401, "UNAUTHORIZED", "Invalid or expired API key"),

  signatureInvalid: () =>
    apiError(401, "SIGNATURE_INVALID", "Request signature is invalid"),

  timestampExpired: () =>
    apiError(
      401,
      "TIMESTAMP_EXPIRED",
      "Request timestamp is outside the allowed ±5 minute window",
    ),

  forbidden: (permission: string) =>
    apiError(
      403,
      "FORBIDDEN",
      `This API key does not have '${permission}' permission`,
    ),

  ipNotAllowed: () =>
    apiError(403, "IP_NOT_ALLOWED", "Your IP address is not whitelisted"),

  notFound: (resource = "Resource") =>
    apiError(404, "NOT_FOUND", `${resource} not found`),

  rateLimited: (resetAt: number) =>
    apiError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please retry after the reset time.",
      { retryAfter: Math.ceil((resetAt - Date.now()) / 1000) },
    ),

  internalError: (requestId?: string) =>
    apiError(500, "INTERNAL_ERROR", "An internal server error occurred", {
      requestId,
    }),

  badRequest: (message: string) => apiError(400, "BAD_REQUEST", message),
};
