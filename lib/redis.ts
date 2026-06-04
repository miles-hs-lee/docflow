import { Redis } from '@upstash/redis';

// Upstash Redis — REST/HTTP based, so it works in Vercel serverless/edge
// without a connection pool (no socket exhaustion). Used for rate
// limiting, the claim_view dedup cache, and (after the PO OAuth
// migration) the session store.
//
// Env (from the Upstash console → your DB → "REST API"):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Both are required together. We expose isRedisConfigured() so optional
// features can degrade gracefully when Redis isn't wired up (e.g. a
// fresh local checkout), while features that REQUIRE Redis call
// getRedis() and fail loudly.

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

let client: Redis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(url && token);
}

export function getRedis(): Redis {
  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — set both from the Upstash console.'
    );
  }
  if (!client) {
    // retries: 1 (not the SDK default of 5 ≈ 4.3s backoff) so that during
    // a Redis brownout the rate limiter / claim cache fail open FAST
    // instead of stalling each request for seconds before the catch trips.
    client = new Redis({ url, token, retry: { retries: 1 } });
  }
  return client;
}

// Run a Redis-backed op with a hard latency ceiling. Redis is on the
// viewer request hot path (rate limit, claim cache); a hung socket isn't
// bounded by retry config, so callers wrap with this and fall back to
// `onTimeout` (fail-open / skip) rather than block the response.
export async function withRedisTimeout<T, F>(op: Promise<T>, ms: number, onTimeout: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), ms);
  });
  try {
    return await Promise.race([op, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
