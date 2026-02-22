import { NextRequest, NextResponse } from 'next/server';

import { parseBearerToken } from '@/lib/agent-auth';
import { signWebhookPayload, timingSafeEqualString } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';

const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200];
const MAX_ATTEMPTS = 10;

type OutboxJob = {
  id: number;
  owner_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

type SubscriptionRow = {
  id: string;
  owner_id: string;
  webhook_url: string;
  signing_secret: string | null;
  event_types: string[];
  is_active: boolean;
};

function truncate(value: string, length = 500) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

function getExpectedDispatcherToken() {
  return process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET || '';
}

function isDispatcherAuthorized(request: NextRequest) {
  const expected = getExpectedDispatcherToken();
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token) {
    return false;
  }

  return timingSafeEqualString(token, expected);
}

function computeNextAttemptAt(attempts: number) {
  const delay = RETRY_DELAYS_SECONDS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_SECONDS.length - 1)];
  return new Date(Date.now() + delay * 1000).toISOString();
}

async function runDispatch(limit: number) {
  const admin = createAdminClient();
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const { data: claimedRows, error: claimError } = await admin.rpc('claim_event_outbox_jobs', {
    p_limit: safeLimit
  });

  if (claimError) {
    throw claimError;
  }

  const jobs = ((claimedRows ?? []) as OutboxJob[]).map((job) => ({
    ...job,
    payload: typeof job.payload === 'object' && job.payload !== null ? job.payload : {}
  }));

  if (jobs.length === 0) {
    return {
      claimed: 0,
      delivered: 0,
      failed: 0,
      dead: 0
    };
  }

  const ownerIds = Array.from(new Set(jobs.map((job) => job.owner_id)));
  const { data: subscriptionsData, error: subscriptionsError } = await admin
    .from('automation_subscriptions')
    .select('id, owner_id, webhook_url, signing_secret, event_types, is_active')
    .in('owner_id', ownerIds)
    .eq('is_active', true);

  if (subscriptionsError) {
    throw subscriptionsError;
  }

  const subscriptions = (subscriptionsData ?? []) as SubscriptionRow[];
  const subscriptionsByOwner = new Map<string, SubscriptionRow[]>();
  subscriptions.forEach((subscription) => {
    const existing = subscriptionsByOwner.get(subscription.owner_id) ?? [];
    existing.push(subscription);
    subscriptionsByOwner.set(subscription.owner_id, existing);
  });

  let delivered = 0;
  let failed = 0;
  let dead = 0;

  for (const job of jobs) {
    try {
      const ownerSubscriptions = (subscriptionsByOwner.get(job.owner_id) ?? []).filter((subscription) =>
        subscription.event_types.includes(job.event_type)
      );

      if (ownerSubscriptions.length === 0) {
        await admin
          .from('automation_event_outbox')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            locked_at: null,
            last_error: null
          })
          .eq('id', job.id);
        delivered += 1;
        continue;
      }

      const { data: existingDeliveries, error: existingError } = await admin
        .from('automation_deliveries')
        .select('subscription_id, status')
        .eq('outbox_id', job.id)
        .eq('status', 'delivered');
      if (existingError) {
        throw existingError;
      }

      const deliveredSubscriptionIds = new Set((existingDeliveries ?? []).map((item) => item.subscription_id));
      const pendingSubscriptions = ownerSubscriptions.filter((subscription) => !deliveredSubscriptionIds.has(subscription.id));

      if (pendingSubscriptions.length === 0) {
        await admin
          .from('automation_event_outbox')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            locked_at: null,
            last_error: null
          })
          .eq('id', job.id);
        delivered += 1;
        continue;
      }

      let hasFailure = false;
      let failureMessage = '';

      for (const subscription of pendingSubscriptions) {
        const body = JSON.stringify({
          ownerId: job.owner_id,
          subscriptionId: subscription.id,
          event: job.payload
        });

        const timestamp = new Date().toISOString();
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-docflow-event-type': job.event_type,
          'x-docflow-event-id': String(job.payload.eventId ?? ''),
          'x-docflow-timestamp': timestamp
        };

        if (subscription.signing_secret) {
          headers['x-docflow-signature'] = signWebhookPayload(body, subscription.signing_secret, timestamp);
        }

        try {
          const response = await fetch(subscription.webhook_url, {
            method: 'POST',
            headers,
            body
          });
          const responseText = truncate(await response.text());

          if (!response.ok) {
            hasFailure = true;
            failureMessage = `subscription ${subscription.id} responded ${response.status}`;
            await admin.from('automation_deliveries').upsert(
              {
                outbox_id: job.id,
                subscription_id: subscription.id,
                status: 'failed',
                attempt_no: job.attempts,
                http_status: response.status,
                error: failureMessage,
                response_body: responseText
              },
              { onConflict: 'outbox_id,subscription_id' }
            );

            await admin
              .from('automation_subscriptions')
              .update({
                last_error: truncate(failureMessage, 200)
              })
              .eq('id', subscription.id)
              .eq('owner_id', job.owner_id);
          } else {
            await admin.from('automation_deliveries').upsert(
              {
                outbox_id: job.id,
                subscription_id: subscription.id,
                status: 'delivered',
                attempt_no: job.attempts,
                http_status: response.status,
                error: null,
                response_body: responseText
              },
              { onConflict: 'outbox_id,subscription_id' }
            );

            await admin
              .from('automation_subscriptions')
              .update({
                last_delivery_at: new Date().toISOString(),
                last_error: null
              })
              .eq('id', subscription.id)
              .eq('owner_id', job.owner_id);
          }
        } catch (error) {
          hasFailure = true;
          failureMessage = `subscription ${subscription.id} network_error`;
          await admin.from('automation_deliveries').upsert(
            {
              outbox_id: job.id,
              subscription_id: subscription.id,
              status: 'failed',
              attempt_no: job.attempts,
              http_status: null,
              error: error instanceof Error ? truncate(error.message, 300) : 'network_error',
              response_body: null
            },
            { onConflict: 'outbox_id,subscription_id' }
          );

          await admin
            .from('automation_subscriptions')
            .update({
              last_error: truncate(error instanceof Error ? error.message : 'network_error', 200)
            })
            .eq('id', subscription.id)
            .eq('owner_id', job.owner_id);
        }
      }

      if (!hasFailure) {
        await admin
          .from('automation_event_outbox')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            locked_at: null,
            last_error: null
          })
          .eq('id', job.id);
        delivered += 1;
      } else {
        const isDead = job.attempts >= MAX_ATTEMPTS;
        await admin
          .from('automation_event_outbox')
          .update({
            status: isDead ? 'dead' : 'failed',
            locked_at: null,
            next_attempt_at: isDead ? new Date().toISOString() : computeNextAttemptAt(job.attempts),
            last_error: truncate(failureMessage || 'delivery_failed', 300)
          })
          .eq('id', job.id);

        if (isDead) {
          dead += 1;
        } else {
          failed += 1;
        }
      }
    } catch (error) {
      const isDead = job.attempts >= MAX_ATTEMPTS;
      await admin
        .from('automation_event_outbox')
        .update({
          status: isDead ? 'dead' : 'failed',
          locked_at: null,
          next_attempt_at: isDead ? new Date().toISOString() : computeNextAttemptAt(job.attempts),
          last_error: truncate(error instanceof Error ? error.message : 'dispatch_failed', 300)
        })
        .eq('id', job.id);

      if (isDead) {
        dead += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    claimed: jobs.length,
    delivered,
    failed,
    dead
  };
}

async function handler(request: NextRequest) {
  const expectedToken = getExpectedDispatcherToken();
  if (!expectedToken) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason: 'AUTOMATION_CRON_SECRET or CRON_SECRET is not set. Event delivery is paused.'
    });
  }

  if (!isDispatcherAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);

  try {
    const result = await runDispatch(Number.isNaN(limit) ? 20 : limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'dispatch_failed'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
