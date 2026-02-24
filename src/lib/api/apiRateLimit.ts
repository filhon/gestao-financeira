/**
 * API Externa — Rate Limiting dedicado
 *
 * Usa in-memory store (adequado para instância única / dev).
 * Para produção com múltiplas instâncias: migrar para Redis (Upstash).
 *
 * Camadas:
 *   1. Global por IP — 120 req/min
 *   2. Por API Key   — configurable (default: 60 req/min)
 *   3. Por Endpoint  — limits específicos por rota
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

export interface ApiRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

function check(
  identifier: string,
  maxRequests: number,
  windowMs: number,
): ApiRateLimitResult {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || now > entry.resetTime) {
    const resetTime = now + windowMs;
    store.set(identifier, { count: 1, resetTime });
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
      resetAt: resetTime,
    };
  }

  if (entry.count < maxRequests) {
    entry.count++;
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetTime,
    };
  }

  return {
    allowed: false,
    limit: maxRequests,
    remaining: 0,
    resetAt: entry.resetTime,
  };
}

// Limites por endpoint (req/min)
const ENDPOINT_LIMITS: Record<string, number> = {
  "/api/v1/balance": 60,
  "/api/v1/transactions": 30,
  "/api/v1/budgets": 30,
  "/api/v1/cost-centers": 30,
  "/api/v1/financial-summary": 30,
};

const GLOBAL_IP_LIMIT = 120;
const WINDOW_MS = 60_000; // 1 minute

export function checkApiRateLimit(
  ip: string,
  apiKeyId: string,
  endpoint: string,
  keyRateLimit: number,
): ApiRateLimitResult {
  // Camada 1: Global por IP
  const ipResult = check(`ip:${ip}`, GLOBAL_IP_LIMIT, WINDOW_MS);
  if (!ipResult.allowed) return ipResult;

  // Camada 2: Por API Key
  const keyResult = check(`key:${apiKeyId}`, keyRateLimit, WINDOW_MS);
  if (!keyResult.allowed) return keyResult;

  // Camada 3: Por Endpoint
  const endpointLimit = ENDPOINT_LIMITS[endpoint] ?? 60;
  const endpointResult = check(
    `endpoint:${apiKeyId}:${endpoint}`,
    endpointLimit,
    WINDOW_MS,
  );
  if (!endpointResult.allowed) return endpointResult;

  // Retorna o mais restritivo entre key e endpoint
  const remaining = Math.min(keyResult.remaining, endpointResult.remaining);
  const limit = Math.min(keyResult.limit, endpointResult.limit);
  const resetAt = Math.max(keyResult.resetAt, endpointResult.resetAt);

  return { allowed: true, limit, remaining, resetAt };
}

// Cleanup a cada 5 minutos
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetTime) store.delete(key);
    }
  }, 5 * 60_000);
}
