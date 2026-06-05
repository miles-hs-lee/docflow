import { publicEnv } from '@/lib/env-public';
import { formatTeamsMessage } from '@/lib/notify/teams';
import { signWebhookPayload } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertSafePublicUrl, SAFE_FETCH_TIMEOUT_MS } from '@/lib/url-safety';

export type QuestionNotification = {
  ownerId: string;
  collectionId: string;
  questionId: string;
  body: string;
  askerEmail: string | null;
  createdAt: string;
};

type SubscriptionRow = {
  id: string;
  webhook_url: string;
  signing_secret: string | null;
  destination_type: 'webhook' | 'teams';
  event_types: string[];
};

// Direct (non-outbox) dispatch for data-room Q&A questions. Like file uploads, a
// question has no link_event_id, so it can't ride the automation outbox — we
// notify inline here, reusing the same Teams formatter + webhook signing + SSRF
// guard as the link-event dispatcher.
//
// Best-effort by contract: every failure is swallowed so a slow or broken
// webhook never blocks or fails the viewer's submission. Each POST is capped at
// SAFE_FETCH_TIMEOUT_MS. NO retry / NO automation_deliveries audit row (v1).
export async function notifyQuestion(input: QuestionNotification): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('automation_subscriptions')
      .select('id, webhook_url, signing_secret, destination_type, event_types')
      .eq('owner_id', input.ownerId)
      .eq('is_active', true);
    if (error || !data) return;

    const subs = (data as SubscriptionRow[]).filter(
      (sub) => Array.isArray(sub.event_types) && sub.event_types.includes('question_asked')
    );
    if (subs.length === 0) return;

    // Only look up the room name once we know someone is subscribed.
    const { data: room } = await admin
      .from('collections')
      .select('name')
      .eq('id', input.collectionId)
      .maybeSingle();
    const collectionName = (room as { name: string } | null)?.name ?? '데이터룸';

    // Trim the body for the notification card (the full text lives in the
    // dashboard). linkId is null — a question has no link analytics page.
    const preview = input.body.length > 280 ? `${input.body.slice(0, 277)}…` : input.body;
    const teamsPayload = {
      eventType: 'question_asked',
      linkId: null,
      viewerEmail: input.askerEmail,
      reason: `${collectionName}: ${preview}`,
      createdAt: input.createdAt
    };

    await Promise.all(
      subs.map(async (sub) => {
        try {
          const isTeams = sub.destination_type === 'teams';
          const body = isTeams
            ? JSON.stringify(formatTeamsMessage('question_asked', teamsPayload, publicEnv.appUrl))
            : JSON.stringify({
                ownerId: input.ownerId,
                subscriptionId: sub.id,
                event: {
                  eventType: 'question_asked',
                  collectionId: input.collectionId,
                  collectionName,
                  questionId: input.questionId,
                  body: input.body,
                  askerEmail: input.askerEmail,
                  createdAt: input.createdAt
                }
              });

          const timestamp = new Date().toISOString();
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-docflow-event-type': 'question_asked',
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
    // Never throw — notification must not affect the submit response.
  }
}
