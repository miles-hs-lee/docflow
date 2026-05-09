import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordLinkEvent } from '@/lib/data';
import { evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ShareLinkRow } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

const SinglePageEventSchema = z.object({
  fileId: z.string().uuid().optional(),
  pageNumber: z.number().int().min(1).max(10_000),
  dwellMs: z.number().int().min(0).max(60 * 60 * 1000)
});

const BatchPageEventsSchema = z.object({
  fileId: z.string().uuid().optional(),
  events: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(10_000),
        dwellMs: z.number().int().min(0).max(60 * 60 * 1000)
      })
    )
    .min(1)
    .max(64)
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

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
  let events: { pageNumber: number; dwellMs: number }[];
  if (batch.success) {
    requestFileId = batch.data.fileId;
    events = batch.data.events;
  } else {
    const single = SinglePageEventSchema.safeParse(body);
    if (!single.success) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    requestFileId = single.data.fileId;
    events = [{ pageNumber: single.data.pageNumber, dwellMs: single.data.dwellMs }];
  }

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
  // collection-attached link checks membership via RPC (one cheap query).
  let targetFileId: string | null = link.file_id;
  if (!targetFileId && link.collection_id && requestFileId) {
    const { data: contained, error: containsError } = await admin.rpc('collection_contains_file', {
      p_collection_id: link.collection_id,
      p_file_id: requestFileId,
      p_owner_id: link.owner_id
    });
    if (containsError || !contained) {
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

  // Insert the batch in parallel — each row is a separate INSERT in
  // recordLinkEvent. Per-page analytics must never break the viewer,
  // so swallow individual failures inside the batch.
  await Promise.all(
    events.map((event) =>
      recordLinkEvent({
        linkId: link.id,
        fileId: targetFileId,
        ownerId: link.owner_id,
        eventType: 'page_view',
        sessionId,
        viewerEmail,
        ipHash,
        userAgent,
        pageNumber: event.pageNumber,
        dwellMs: event.dwellMs
      }).catch(() => {
        // Swallow ingest failures per event.
      })
    )
  );

  return NextResponse.json({ ok: true, accepted: events.length });
}
