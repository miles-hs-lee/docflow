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
    client = new Redis({ url, token });
  }
  return client;
}
