// Connectivity smoke test for Upstash Redis.
//   node scripts/check-redis.mjs
// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the env
// (load .env.local first, e.g. `set -a && source .env.local && set +a`).

import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error('✗ Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in the environment.');
  process.exit(1);
}

const redis = new Redis({ url, token });
const key = `docflow:smoketest:${Date.now()}`;

try {
  await redis.set(key, 'ok', { ex: 30 });
  const value = await redis.get(key);
  await redis.del(key);
  if (value !== 'ok') {
    console.error(`✗ Round-trip mismatch: wrote "ok", read "${value}".`);
    process.exit(1);
  }
  console.log('✓ Upstash Redis reachable — set/get/del round-trip OK.');
  console.log(`  URL host: ${new URL(url).host}`);
} catch (err) {
  console.error('✗ Upstash Redis call failed:', err?.message ?? err);
  process.exit(1);
}
