import { NextRequest, NextResponse } from 'next/server';

import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { claimViewCached, getViewerLinkByToken, recordLinkEvent, signedPdfObjectUrl } from '@/lib/data';
import { checkRateLimit } from '@/lib/rate-limit';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

// Large PDFs streamed to slow clients can exceed Vercel's default 10s
// function budget mid-stream, truncating the document (and burning a
// claim_view slot on one-time/max-views links the viewer never received).
// 60s is the Hobby ceiling; raise on Pro if very large PDFs are common.
export const maxDuration = 60;

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

  // Rate limit per viewer session + hashed IP (generous, see lib/rate-limit
  // — PDF.js Range bursts + NAT-shared IPs). Caps a single runaway client.
  const rlSession = normalizeViewerSessionId(request.cookies.get(VIEWER_SESSION_COOKIE)?.value);
  const rlIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit('viewerDocument', `${token}:${rlSession}:${hashIp(rlIp)}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const bundle = await getViewerLinkByToken(token);
  if (!bundle) {
    return buildDeniedResponse('file_missing', 404);
  }
  // A specific fileId must resolve within the (group-filtered) bundle. Do NOT
  // fall back to collection_files[0] when a requested fileId is absent — that
  // would serve a different document and silently mask an out-of-group request.
  // Only default to the first file when no fileId was requested at all.
  let targetFile = bundle.file ?? null;
  if (!targetFile) {
    targetFile = requestedFileId
      ? (bundle.collection_files.find((item) => item.id === requestedFileId) ?? null)
      : (bundle.collection_files[0] ?? null);
  }
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

  // Claim the view on EVERY byte-serving request, including Range
  // follow-ups. claim_view (migration 007) is session-deduped: the first
  // claim for this viewer session counts it, and subsequent calls (the
  // chunk-by-chunk Range requests PDF.js makes) return allowed=true with
  // no counter bump and no new event. Claiming only on a non-Range
  // "initial" request let an attacker send `Range: bytes=0-N` as the very
  // first request to read the whole document without ever consuming a
  // max_views / one_time slot — a policy bypass. The dedup makes the
  // per-chunk lock cheap (lock + one indexed existence check, no write)
  // for an already-claimed session.
  {
    let claim;
    try {
      claim = await claimViewCached({
        linkId: bundle.id,
        ownerId: bundle.owner_id,
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
