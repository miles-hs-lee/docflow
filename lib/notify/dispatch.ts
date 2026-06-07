import { publicEnv } from '@/lib/env-public';
import { formatTeamsMessage } from '@/lib/notify/teams';
import { signWebhookPayload } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertSafePublicUrl, SAFE_FETCH_TIMEOUT_MS } from '@/lib/url-safety';

type SubscriptionRow = {
  id: string;
  webhook_url: string;
  signing_secret: string | null;
  destination_type: 'webhook' | 'teams';
  event_types: string[];
};

// Direct (non-outbox) dispatch for events that aren't link_events — file-request
// uploads + data-room questions — and so have no link_event_id to ride the
// automation outbox. Fetches the owner's active subscriptions for `eventType`;
// only if any match does it run `build()` to assemble the payloads (so a
// per-event DB lookup like the room name is skipped when nobody is listening).
// Reuses the same Teams formatter + webhook signing + SSRF guard as the
// link-event dispatcher. Best-effort by contract: every failure is swallowed so
// a slow/broken webhook never blocks or fails the caller. NO retry / NO
// automation_deliveries audit row (v1).
export async function dispatchDirectNotification(opts: {
  ownerId: string;
  eventType: string;
  /** Becomes the Teams card's '방문자' fact; null → 익명. */
  viewerEmail: string | null;
  createdAt: string;
  /** Built lazily — invoked only when ≥1 subscription matches `eventType`. */
  build: () =>
    | Promise<{ teamsReason: string; webhookEvent: Record<string, unknown> }>
    | { teamsReason: string; webhookEvent: Record<string, unknown> };
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('automation_subscriptions')
      .select('id, webhook_url, signing_secret, destination_type, event_types')
      .eq('owner_id', opts.ownerId)
      .eq('is_active', true);
    if (error || !data) return;

    const subs = (data as SubscriptionRow[]).filter(
      (sub) => Array.isArray(sub.event_types) && sub.event_types.includes(opts.eventType)
    );
    if (subs.length === 0) return;

    const { teamsReason, webhookEvent } = await opts.build();
    // linkId is null — these events have no link analytics page, so the Teams
    // formatter cleanly omits the deep-link action button.
    const teamsPayload = {
      eventType: opts.eventType,
      linkId: null,
      viewerEmail: opts.viewerEmail,
      reason: teamsReason,
      createdAt: opts.createdAt
    };

    await Promise.all(
      subs.map(async (sub) => {
        try {
          const isTeams = sub.destination_type === 'teams';
          const body = isTeams
            ? JSON.stringify(formatTeamsMessage(opts.eventType, teamsPayload, publicEnv.appUrl))
            : JSON.stringify({ ownerId: opts.ownerId, subscriptionId: sub.id, event: webhookEvent });

          const timestamp = new Date().toISOString();
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-docflow-event-type': opts.eventType,
            'x-docflow-timestamp': timestamp
          };
          if (!isTeams && sub.signing_secret) {
            headers['x-docflow-signature'] = signWebhookPayload(body, sub.signing_secret, timestamp);
          }

          // Re-validate at send time (DNS-rebinding/SSRF), like the dispatcher.
          await assertSafePublicUrl(sub.webhook_url);
          await fetch(sub.webhook_url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(SAFE_FETCH_TIMEOUT_MS),
            redirect: 'manual'
          });
        } catch {
          // Best-effort per subscription — swallow.
        }
      })
    );
  } catch {
    // Never throw — notification must not affect the caller's response.
  }
}
