import { NextRequest, NextResponse } from 'next/server';

import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { claimView, getViewerLinkByToken, recordLinkEvent, signedPdfObjectUrl } from '@/lib/data';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

function buildDeniedResponse(reason: DeniedReason, status = 403) {
  return NextResponse.json(
    {
      error: deniedMessage(reason)
    },
    { status }
  );
}

async function logDenied(args: {
  reason: DeniedReason;
  linkId: string;
  fileId: string;
  ownerId: string;
  sessionId: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  await recordLinkEvent({
    linkId: args.linkId,
    fileId: args.fileId,
    ownerId: args.ownerId,
    eventType: 'denied',
    reason: args.reason,
    sessionId: args.sessionId,
    viewerEmail: args.viewerEmail,
    ipHash: args.ipHash,
    userAgent: args.userAgent
  });
}

async function safeLogDenied(args: {
  reason: DeniedReason;
  linkId: string;
  fileId: string;
  ownerId: string;
  sessionId: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  try {
    await logDenied(args);
  } catch {
    // Analytics write failures must not block document rendering.
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const requestedFileId = request.nextUrl.searchParams.get('fileId');

  const bundle = await getViewerLinkByToken(token);
  if (!bundle) {
    return buildDeniedResponse('file_missing', 404);
  }
  const targetFile =
    bundle.file ??
    (requestedFileId ? bundle.collection_files.find((item) => item.id === requestedFileId) : null) ??
    bundle.collection_files[0] ??
    null;
  if (!targetFile) {
    return buildDeniedResponse('file_missing', 404);
  }

  // Middleware guarantees the viewer session cookie on /v/* and the route
  // handler below proxies under that path; we just read the value here.
  const sessionId = normalizeViewerSessionId(request.cookies.get(VIEWER_SESSION_COOKIE)?.value);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = hashIp(ip);
  const userAgent = request.headers.get('user-agent');

  const rawGrant = request.cookies.get(getGrantCookieName(bundle.id))?.value;
  const grant = decodeGrantCookie(rawGrant, bundle.id);

  const baseDenied = evaluateBasePolicy({ link: bundle, grant });
  if (baseDenied) {
    await safeLogDenied({
      reason: baseDenied,
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });

    return buildDeniedResponse(baseDenied);
  }

  const grantDenied = evaluateGrantPolicy({ link: bundle, grant });
  if (grantDenied) {
    await safeLogDenied({
      reason: grantDenied,
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });

    return buildDeniedResponse(grantDenied);
  }

  // Sign a short-lived URL pointing at the storage object. The actual
  // bytes are streamed via fetch() below — Supabase's previous download()
  // path called .blob() internally and held the whole PDF in Node memory.
  // Signed-URL fetch lets us pipe upstream.body straight to the client
  // and pass through HTTP Range so PDF.js can grab only the trailer +
  // requested pages on initial load.
  const signedUrl = await signedPdfObjectUrl(targetFile.storage_path);
  if (!signedUrl) {
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }

  const rangeHeader = request.headers.get('range');
  // Treat anything other than "no header" or the trivial "from byte 0"
  // form as a follow-up partial fetch. Initial loads either omit Range
  // entirely or send `bytes=0-`; PDF.js's progressive trailer/page
  // requests come in as `bytes=N-M` and shouldn't burn a max_views slot
  // (the session was already claimed on the initial 200).
  const isPartialFollowUp = !!rangeHeader && rangeHeader.trim() !== 'bytes=0-';

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, {
      headers: rangeHeader ? { Range: rangeHeader } : undefined
    });
  } catch {
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }

  if (upstream.status !== 200 && upstream.status !== 206) {
    upstream.body?.cancel().catch(() => {});
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }

  // Atomically claim the view only on the initial fetch. claim_view
  // (migration 007) takes a SELECT … FOR UPDATE row lock, so doing it
  // on every Range follow-up would serialize all viewers and add a
  // round trip per byte chunk. Range requests reuse the cookie that
  // already passed policy above.
  if (!isPartialFollowUp) {
    let claim;
    try {
      claim = await claimView({
        linkId: bundle.id,
        fileId: targetFile.id,
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });
    } catch {
      upstream.body?.cancel().catch(() => {});
      return buildDeniedResponse('file_missing', 500);
    }

    if (!claim.allowed) {
      upstream.body?.cancel().catch(() => {});
      const reason = (claim.reason as DeniedReason) ?? 'file_missing';
      await safeLogDenied({
        reason,
        linkId: bundle.id,
        fileId: targetFile.id,
        ownerId: bundle.owner_id,
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });
      return buildDeniedResponse(reason);
    }
  }

  const safeName = targetFile.original_name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${safeName}"`,
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes'
  };
  const upstreamLen = upstream.headers.get('content-length');
  if (upstreamLen) responseHeaders['Content-Length'] = upstreamLen;
  const upstreamRange = upstream.headers.get('content-range');
  if (upstreamRange) responseHeaders['Content-Range'] = upstreamRange;

  // Viewer session cookie is guaranteed by middleware on every /v/* request,
  // so this route handler does not need to set it.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}
