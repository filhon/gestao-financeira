/**
 * Rate Limiter Utility
 * Simple in-memory rate limiting for API routes
 * For production, consider using Redis-based solution like @upstash/ratelimit
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (will reset on server restart)
// For production with multiple instances, use Redis
const store = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number;
  
  /**
   * Time window in seconds
   */
  windowSeconds: number;
  
  /**
   * Optional identifier key (default: IP address)
   */
  identifier?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

/**
 * Check if a request should be rate limited
 */
export function checkRateLimit(config: RateLimitConfig): RateLimitResult {
  const { maxRequests, windowSeconds, identifier = 'default' } = config;
  
  const now = Date.now();
  const entry = store.get(identifier);
  
  // No entry or expired entry
  if (!entry || now > entry.resetTime) {
    const resetTime = now + (windowSeconds * 1000);
    store.set(identifier, {
      count: 1,
      resetTime
    });
    
    return {
      success: true,
      remaining: maxRequests - 1,
      reset: resetTime
    };
  }
  
  // Entry exists and is valid
  if (entry.count < maxRequests) {
    entry.count++;
    store.set(identifier, entry);
    
    return {
      success: true,
      remaining: maxRequests - entry.count,
      reset: entry.resetTime
    };
  }
  
  // Rate limit exceeded
  return {
    success: false,
    remaining: 0,
    reset: entry.resetTime
  };
}

/**
 * Clean up expired entries (call periodically)
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}

/**
 * Reset rate limit for a specific identifier
 */
export function resetRateLimit(identifier: string): void {
  store.delete(identifier);
}

// Cleanup expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}
