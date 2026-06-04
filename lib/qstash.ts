import { Client } from '@upstash/qstash';

import { publicEnv } from '@/lib/env-public';
import { getRedis, isRedisConfigured, withRedisTimeout } from '@/lib/redis';

// Near-real-time webhook delivery trigger.
//
// The outbox is populated by a Postgres trigger and drained by
// /api/automation/dispatch. The Vercel cron only fires daily (Hobby
// limit), so without this a webhook could sit up to 24h. kickWebhookDispatch
// publishes a QStash message that calls /dispatch within seconds of an
// eligible event — the automation feature becomes real-time while the
// daily cron stays as a retry/backstop.
//
// Coalescing: a Redis NX lock means a burst of events produces at most
// one QStash message per window, so we stay well within the free tier
// and never publish when there's no work. Fully best-effort — every
// failure path falls back to the daily cron drain and never throws into
// the caller's request path.

const token = process.env.QSTASH_TOKEN;

// QStash runs two INDEPENDENT regions (separate infra + tokens), not a
// single anycast endpoint:
//   EU  → https://qstash.upstash.io  (the SDK default)
//   US  → https://qstash-us-east-1.upstash.io
// Our account + tokens are in US-east-1 (co-located with the Vercel
// functions and the Upstash Redis DB), so we must target the US base
// URL — the EU default returns "user not found in region". Override via
// QSTASH_URL if the account ever moves.
const baseUrl = process.env.QSTASH_URL || 'https://qstash-us-east-1.upstash.io';

let client: Client | null = null;

export function isQstashConfigured(): boolean {
  return Boolean(token);
}

function getClient(): Client {
  if (!token) throw new Error('Missing QSTASH_TOKEN');
  // retries: 1 (not the SDK default of 5) so a publish failure trips fast
  // instead of stalling the viewer request path; the daily cron backstop
  // covers anything that doesn't get published.
  if (!client) client = new Client({ token, baseUrl, retry: { retries: 1 } });
  return client;
}

const COALESCE_TTL_SECONDS = 20;
// Small delay so a burst of events accumulates in the outbox before the
// single coalesced dispatch run.
const DISPATCH_DELAY = '5s';
// Hard ceiling — this runs awaited in the viewer request path, so a hung
// Redis/QStash socket must not stall the response. On timeout we just
// skip; the daily cron backstop still drains the outbox.
const KICK_TIMEOUT_MS = 1500;

// Per-owner coalesce key: a burst from one owner produces at most one
// QStash message per window, but a different owner's event in the same
// window still schedules its own near-real-time run (a single global key
// would suppress it until the next event or the daily cron).
function coalesceKey(ownerId: string) {
  return `qstash:dispatch:pending:${ownerId}`;
}

export async function kickWebhookDispatch(ownerId: string): Promise<void> {
  if (!isQstashConfigured() || !isRedisConfigured() || !ownerId) return;

  // QStash calls us from its own servers, so the callback must be a
  // publicly reachable URL — skip localhost (dev).
  const appUrl = publicEnv.appUrl;
  if (!/^https:\/\//i.test(appUrl)) return;

  // Reuse the dispatcher's existing bearer auth. If no secret is set the
  // dispatcher is disabled, so there's nothing to trigger.
  const cronSecret = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!cronSecret) return;

  await withRedisTimeout(doKick(ownerId, appUrl, cronSecret), KICK_TIMEOUT_MS, undefined).catch(() => {
    // Best-effort — daily cron backstop still delivers.
  });
}

async function doKick(ownerId: string, appUrl: string, cronSecret: string): Promise<void> {
  try {
    // NX coalesce — only the first event in the window schedules a run.
    const acquired = await getRedis().set(coalesceKey(ownerId), '1', {
      nx: true,
      ex: COALESCE_TTL_SECONDS
    });
    if (!acquired) return;
  } catch {
    return; // Redis hiccup — daily cron backstop still delivers.
  }

  try {
    await getClient().publishJSON({
      url: `${appUrl}/api/automation/dispatch`,
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
      delay: DISPATCH_DELAY,
      body: { trigger: 'event' },
      retries: 1
    });
  } catch {
    // Publish failed — daily cron backstop still drains the outbox.
  }
}
