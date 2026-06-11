import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { hasViewForSession, maybeSetFilePageCount, recordPageViewBatch } from '@/lib/data';
import { evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { verifyLinkPreviewToken } from '@/lib/preview-token';
import { checkRateLimit } from '@/lib/rate-limit';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ShareLinkRow } from '@/lib/types';
import { isLikelyBotUserAgent } from '@/lib/ua';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

// Per-segment dwell is capped at 10 minutes (matches the viewer's
// SEGMENT_MAX_DWELL_MS): an idle tab left open must not credit an hour of
// "reading" to one page. Pre-cap viewer builds may still send up to the old
// 60-minute ceiling; clamp rather than reject so their batches aren't lost.
const DWELL_SEGMENT_CAP_MS = 10 * 60 * 1000;
const DWELL_ACCEPT_MAX_MS = 60 * 60 * 1000;

// numPages: the viewer reports the document's total page count alongside
// dwell batches; the server keeps the first non-null value per file
// (maybeSetFilePageCount) to power completion metrics.
const SinglePageEventSchema = z.object({
  fileId: z.string().uuid().optional(),
  numPages: z.number().int().min(1).max(10_000).optional(),
  pageNumber: z.number().int().min(1).max(10_000),
  dwellMs: z.number().int().min(0).max(DWELL_ACCEPT_MAX_MS)
});

const BatchPageEventsSchema = z.object({
  fileId: z.string().uuid().optional(),
  numPages: z.number().int().min(1).max(10_000).optional(),
  events: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(10_000),
        dwellMs: z.number().int().min(0).max(DWELL_ACCEPT_MAX_MS)
      })
    )
    .min(1)
    .max(64)
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  // Crawlers don't run the viewer JS, so anything bot-flagged POSTing here
  // is synthetic. Accept-and-drop (rather than 403) so a misbehaving client
  // doesn't retry-loop.
  if (isLikelyBotUserAgent(request.headers.get('user-agent'))) {
    return NextResponse.json({ ok: true, accepted: 0 });
  }

  // Rate limit early — page_view ingest is the cheapest endpoint to spam.
  // Key on token + hashed IP only (NOT the session cookie, which is
  // attacker-rotatable — including it would let a flooder mint a fresh
  // bucket per request). IP is the authoritative cap for this spam vector.
  const rlIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit('viewerEvent', `${token}:${hashIp(rlIp)}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Accept both shapes so the viewer can roll out batching without a
  // route version bump and so a single-event sender still works.
  const batch = BatchPageEventsSchema.safeParse(body);
  let requestFileId: string | undefined;
  let reportedNumPages: number | undefined;
  let events: { pageNumber: number; dwellMs: number }[];
  if (batch.success) {
    requestFileId = batch.data.fileId;
    reportedNumPages = batch.data.numPages;
    events = batch.data.events;
  } else {
    const single = SinglePageEventSchema.safeParse(body);
    if (!single.success) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    requestFileId = single.data.fileId;
    reportedNumPages = single.data.numPages;
    events = [{ pageNumber: single.data.pageNumber, dwellMs: single.data.dwellMs }];
  }
  events = events.map((event) => ({
    pageNumber: event.pageNumber,
    dwellMs: Math.min(event.dwellMs, DWELL_SEGMENT_CAP_MS)
  }));

  // page_view events are per-scroll high-volume. Skip the heavy
  // getViewerLinkByToken (which loads file/collection/files mappings)
  // and use get_link_for_event (migration 013) — one share_links row,
  // one round trip. File-id membership for collection links is checked
  // separately via collection_contains_file when needed.
  const admin = createAdminClient();
  const { data: linkRows, error: linkError } = await admin.rpc('get_link_for_event', { p_token: token });
  const linkRow = Array.isArray(linkRows) ? linkRows[0] : null;
  if (linkError || !linkRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Owner preview: accept-and-drop. Without this, an owner whose session
  // once legitimately claimed a view would have their preview scrolling
  // ingested as real page dwell (the claim check below would pass).
  if (verifyLinkPreviewToken(request.nextUrl.searchParams.get('preview'), linkRow.id)) {
    return NextResponse.json({ ok: true, accepted: 0 });
  }

  // Build a partial ShareLinkRow good enough for evaluateBasePolicy /
  // evaluateGrantPolicy. The unused counters default to 0 because base
  // policy here checks deleted/inactive/expired — max_views is the
  // claim_view RPC's job, not the event endpoint's.
  const link = {
    ...linkRow,
    label: '',
    token: '',
    download_count: 0,
    denied_count: 0,
    one_time: false,
    allow_download: false,
    created_at: '',
    updated_at: ''
  } as unknown as ShareLinkRow;

  // Resolve target file: file-attached link uses link.file_id directly;
  // collection-attached link checks membership via link_can_view_file, which is
  // viewer-group aware (Phase 3) — it rejects a file outside the link's group
  // closure, matching the bundle filter the document/download routes rely on.
  let targetFileId: string | null = link.file_id;
  if (!targetFileId && link.collection_id && requestFileId) {
    const { data: canView, error: canViewError } = await admin.rpc('link_can_view_file', {
      p_link_id: link.id,
      p_file_id: requestFileId
    });
    if (canViewError || !canView) {
      return NextResponse.json({ error: 'file_missing' }, { status: 404 });
    }
    targetFileId = requestFileId;
  }
  if (!targetFileId) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 });
  }

  const rawGrant = request.cookies.get(getGrantCookieName(link.id))?.value;
  const grant = decodeGrantCookie(rawGrant, link.id);

  if (evaluateBasePolicy({ link, grant }) || evaluateGrantPolicy({ link, grant })) {
    return NextResponse.json({ error: 'access_not_granted' }, { status: 403 });
  }

  const sessionId = normalizeViewerSessionId(request.cookies.get(VIEWER_SESSION_COOKIE)?.value);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = hashIp(ip);
  const userAgent = request.headers.get('user-agent');
  const viewerEmail = grant?.email;

  // Only record page dwell for a session that actually claimed a view of
  // this link (the document/download claim path inserts the 'view' event).
  // Without this a token holder could POST page_view events to pollute the
  // owner's per-page analytics without ever opening the document.
  if (!(await hasViewForSession(link.id, sessionId))) {
    return NextResponse.json({ error: 'view_not_claimed' }, { status: 409 });
  }

  // First viewer to report the document's page count fills files.page_count
  // (only while NULL — see maybeSetFilePageCount). Gated behind the
  // view-claim check above, so a token holder who never opened the document
  // can't write it.
  if (reportedNumPages) {
    await maybeSetFilePageCount(targetFileId, reportedNumPages);
  }

  // One multi-row INSERT for the whole batch instead of N round trips.
  // Per-page analytics must never break the viewer, so swallow failures.
  try {
    await recordPageViewBatch({
      linkId: link.id,
      fileId: targetFileId,
      ownerId: link.owner_id,
      workspaceId: link.workspace_id,
      sessionId,
      viewerEmail,
      ipHash,
      userAgent,
      events
    });
  } catch {
    // Swallow ingest failures — never block the viewer on analytics.
  }

  return NextResponse.json({ ok: true, accepted: events.length });
}
