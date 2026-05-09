import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewerLinkByToken, recordLinkEvent } from '@/lib/data';
import { evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

const PageEventSchema = z.object({
  fileId: z.string().uuid().optional(),
  pageNumber: z.number().int().min(1).max(10_000),
  dwellMs: z.number().int().min(0).max(60 * 60 * 1000)
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const parsed = PageEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const bundle = await getViewerLinkByToken(token);
  if (!bundle) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const targetFile =
    bundle.file ??
    (parsed.data.fileId
      ? bundle.collection_files.find((item) => item.id === parsed.data.fileId)
      : null) ??
    bundle.collection_files[0] ??
    null;

  if (!targetFile) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 });
  }

  const rawGrant = request.cookies.get(getGrantCookieName(bundle.id))?.value;
  const grant = decodeGrantCookie(rawGrant, bundle.id);

  if (evaluateBasePolicy({ link: bundle, grant }) || evaluateGrantPolicy({ link: bundle, grant })) {
    return NextResponse.json({ error: 'access_not_granted' }, { status: 403 });
  }

  const sessionId = normalizeViewerSessionId(request.cookies.get(VIEWER_SESSION_COOKIE)?.value);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  try {
    await recordLinkEvent({
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      eventType: 'page_view',
      sessionId,
      viewerEmail: grant?.email,
      ipHash: hashIp(ip),
      userAgent: request.headers.get('user-agent'),
      pageNumber: parsed.data.pageNumber,
      dwellMs: parsed.data.dwellMs
    });
  } catch {
    // Per-page analytics must never break the viewer; swallow ingest failures.
  }

  return NextResponse.json({ ok: true });
}
