import { Ratelimit } from '@upstash/ratelimit';

import { getRedis, isRedisConfigured, withRedisTimeout } from '@/lib/redis';

// Centralized sliding-window rate limiting on Upstash Redis.
//
// Policy (Hybrid):
//   - Production MUST have Redis. The boot guard below throws at module
//     load if it's missing, so a misconfigured deploy fails loudly
//     instead of silently running unprotected.
//   - Local dev without Redis fails OPEN (checkRateLimit returns allowed)
//     so you can develop without standing up Redis.
//   - A transient Redis error at request time also fails OPEN — a rate
//     limiter outage must not take the whole service down — but is the
//     only path that bypasses limits once configured.
// Skip the guard during `next build` (NEXT_PHASE === 'phase-production-build'),
// which evaluates route modules with NODE_ENV=production but without
// runtime secrets in CI/Docker. The guard still fires at runtime module
// load in production, so a misconfigured deploy fails loudly on first hit.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  !isRedisConfigured()
) {
  throw new Error(
    'Rate limiting requires UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in production.'
  );
}

export type RateLimitKind =
  | 'viewerEvent' // per-page dwell ingest (cheap to spam)
  | 'viewerPassword' // share-link password gate (brute force)
  | 'viewerDocument' // PDF byte serving (Range-heavy; NAT-shared)
  | 'mcp' // agent API
  | 'authLogin'; // owner login

// limit = max requests per window. window is an @upstash/ratelimit Duration.
const DEFS: Record<RateLimitKind, { limit: number; window: `${number} ${'m' | 's' | 'h'}`; prefix: string }> = {
  viewerEvent: { limit: 60, window: '1 m', prefix: 'rl:event' },
  viewerPassword: { limit: 5, window: '10 m', prefix: 'rl:pw' },
  // Raised above the original 120 suggestion: PDF.js Range requests are
  // bursty and corporate viewers behind NAT share an IP, so a tight
  // per-IP cap would false-positive on legitimate fast scrolling. 300/m
  // still caps a single runaway client.
  viewerDocument: { limit: 300, window: '1 m', prefix: 'rl:doc' },
  mcp: { limit: 100, window: '1 m', prefix: 'rl:mcp' },
  authLogin: { limit: 10, window: '1 m', prefix: 'rl:login' }
};

const limiters = new Map<RateLimitKind, Ratelimit>();

function getLimiter(kind: RateLimitKind): Ratelimit | null {
  if (!isRedisConfigured()) return null; // dev fail-open
  let limiter = limiters.get(kind);
  if (!limiter) {
    const def = DEFS[kind];
    limiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(def.limit, def.window),
      prefix: def.prefix,
      analytics: false
    });
    limiters.set(kind, limiter);
  }
  return limiter;
}

export type RateLimitResult = {
  allowed: boolean;
  /** Remaining requests in the window, or -1 when not enforced. */
  remaining: number;
  /** Seconds until the window resets (for Retry-After), or 0 when not enforced. */
  retryAfterSeconds: number;
};

const ALLOW: RateLimitResult = { allowed: true, remaining: -1, retryAfterSeconds: 0 };

// Hard ceiling so a hung Redis socket can't stall the request before the
// retry/error path fires. On timeout we fail open (availability > limiting).
const LIMIT_TIMEOUT_MS = 1500;

/**
 * Consume one token for `identifier` under the given limit kind.
 * Returns `allowed: false` when the caller is over the limit.
 * `identifier` should already be non-sensitive (use a hashed IP / session
 * id / key id, never a raw IP or secret).
 */
export async function checkRateLimit(kind: RateLimitKind, identifier: string): Promise<RateLimitResult> {
  const limiter = getLimiter(kind);
  if (!limiter) return ALLOW; // dev fail-open (prod is guarded at boot)
  try {
    const outcome = await withRedisTimeout(limiter.limit(identifier), LIMIT_TIMEOUT_MS, null);
    if (!outcome) return ALLOW; // timed out → fail open fast
    const { success, remaining, reset } = outcome;
    return {
      allowed: success,
      remaining,
      retryAfterSeconds: Math.max(0, Math.ceil((reset - Date.now()) / 1000))
    };
  } catch {
    // Transient Redis failure: fail open so the limiter can't DoS us.
    return ALLOW;
  }
}
