import { publicEnv } from '@/lib/env-public';
import { formatTeamsMessage } from '@/lib/notify/teams';
import { signWebhookPayload } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertSafePublicUrl, SAFE_FETCH_TIMEOUT_MS } from '@/lib/url-safety';

export type FileUploadNotification = {
  ownerId: string;
  requestId: string;
  requestTitle: string;
  uploadId: string;
  fileName: string;
  uploaderEmail: string | null;
  createdAt: string;
};

type SubscriptionRow = {
  id: string;
  webhook_url: string;
  signing_secret: string | null;
  destination_type: 'webhook' | 'teams';
  event_types: string[];
};

// Direct (non-outbox) dispatch for File Request uploads. The automation outbox
// is keyed on link_event_id, which a file upload has none of — so we notify
// inline here, reusing the same Teams formatter + webhook signing + SSRF guard
// as the link-event dispatcher.
//
// Best-effort by contract: every failure is swallowed so a slow or broken
// webhook never blocks or fails the visitor's upload. Each POST is capped at
// SAFE_FETCH_TIMEOUT_MS. Tradeoff vs the link-event pipeline: NO retry and NO
// automation_deliveries audit row (acceptable for v1; see roadmap D4).
export async function notifyFileUpload(input: FileUploadNotification): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('automation_subscriptions')
      .select('id, webhook_url, signing_secret, destination_type, event_types')
      .eq('owner_id', input.ownerId)
      .eq('is_active', true);
    if (error || !data) return;

    const subs = (data as SubscriptionRow[]).filter(
      (sub) => Array.isArray(sub.event_types) && sub.event_types.includes('file_uploaded')
    );
    if (subs.length === 0) return;

    // For Teams: linkId is null (a file upload has no link analytics page) so
    // formatTeamsMessage cleanly omits the action button. The request title +
    // file name ride along as the card's '사유' fact.
    const teamsPayload = {
      eventType: 'file_uploaded',
      linkId: null,
      viewerEmail: input.uploaderEmail,
      reason: `${input.requestTitle}: ${input.fileName}`,
      createdAt: input.createdAt
    };

    await Promise.all(
      subs.map(async (sub) => {
        try {
          const isTeams = sub.destination_type === 'teams';
          const body = isTeams
            ? JSON.stringify(formatTeamsMessage('file_uploaded', teamsPayload, publicEnv.appUrl))
            : JSON.stringify({
                ownerId: input.ownerId,
                subscriptionId: sub.id,
                event: {
                  eventType: 'file_uploaded',
                  requestId: input.requestId,
                  requestTitle: input.requestTitle,
                  uploadId: input.uploadId,
                  fileName: input.fileName,
                  uploaderEmail: input.uploaderEmail,
                  createdAt: input.createdAt
                }
              });

          const timestamp = new Date().toISOString();
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-docflow-event-type': 'file_uploaded',
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
    // Never throw — notification must not affect the upload response.
  }
}
