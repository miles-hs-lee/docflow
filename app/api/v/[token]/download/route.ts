import { NextRequest, NextResponse } from 'next/server';

import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { claimView, getViewerLinkByToken, recordLinkEvent, signedPdfObjectUrl } from '@/lib/data';
import { verifyLinkPreviewToken } from '@/lib/preview-token';
import { checkRateLimit } from '@/lib/rate-limit';
import type { DeniedReason } from '@/lib/types';
import { isLikelyBotUserAgent } from '@/lib/ua';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type RouteContext = {
  params: Promise<{ token: string }>;
};

// Streaming a large PDF to a slow client can exceed Vercel's default 10s
// budget; 60s is the Hobby ceiling.
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
  workspaceId: string | null;
  sessionId: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  await recordLinkEvent({
    linkId: args.linkId,
    fileId: args.fileId,
    ownerId: args.ownerId,
    workspaceId: args.workspaceId,
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
  workspaceId: string | null;
  sessionId: string;
  viewerEmail?: string;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  try {
    await logDenied(args);
  } catch {
    // Analytics write failures must not block response.
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const requestedFileId = request.nextUrl.searchParams.get('fileId');

  // Same bot gate as /document: on an ungated allow_download link the viewer
  // HTML embeds this URL, so a crawler following it would pull the full PDF,
  // burn a claim_view slot (killing one_time links), and pollute download
  // analytics. Spoofing a bot UA only denies the spoofer — never a bypass.
  if (isLikelyBotUserAgent(request.headers.get('user-agent'))) {
    return buildDeniedResponse('access_not_granted', 403);
  }

  // Rate limit full-PDF downloads (shares the document-route budget). A
  // client rotating/omitting the session cookie re-claims per request, so
  // the hashed IP is the authoritative cap here.
  const rlIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit('viewerDocument', `dl:${token}:${hashIp(rlIp)}`);
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

  const existingSession = request.cookies.get(VIEWER_SESSION_COOKIE)?.value;
  const sessionId = normalizeViewerSessionId(existingSession);
  const shouldRefreshViewerCookie = !existingSession || existingSession !== sessionId;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = hashIp(ip);
  const userAgent = request.headers.get('user-agent');

  const rawGrant = request.cookies.get(getGrantCookieName(bundle.id))?.value;
  const grant = decodeGrantCookie(rawGrant, bundle.id);

  // Owner preview: bypass the gates and never claim/log, but KEEP the
  // allow_download check below — preview should show exactly what a real
  // viewer gets, and a blocked-download link must stay blocked in preview.
  const isOwnerPreview = verifyLinkPreviewToken(request.nextUrl.searchParams.get('preview'), bundle.id);

  if (!isOwnerPreview) {
    const baseDenied = evaluateBasePolicy({ link: bundle, grant });
    if (baseDenied) {
      await safeLogDenied({
        reason: baseDenied,
        linkId: bundle.id,
        fileId: targetFile.id,
        ownerId: bundle.owner_id,
        workspaceId: bundle.workspace_id,
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
        workspaceId: bundle.workspace_id,
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });

      return buildDeniedResponse(grantDenied);
    }
  }

  if (!bundle.allow_download) {
    // Parity in preview too (a blocked download stays blocked), but only a
    // real viewer's attempt is worth a denied event.
    if (!isOwnerPreview) {
      await safeLogDenied({
        reason: 'access_not_granted',
        linkId: bundle.id,
        fileId: targetFile.id,
        ownerId: bundle.owner_id,
        workspaceId: bundle.workspace_id,
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });
    }

    return buildDeniedResponse('access_not_granted');
  }

  // Stream from a short-lived signed URL — see /document/route.ts for the
  // same memory rationale (download() materialized the whole PDF in Node).
  const signedUrl = await signedPdfObjectUrl(targetFile.storage_path);
  if (!signedUrl) {
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      workspaceId: bundle.workspace_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl);
  } catch {
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      workspaceId: bundle.workspace_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }
  if (!upstream.ok) {
    upstream.body?.cancel().catch(() => {});
    await safeLogDenied({
      reason: 'file_missing',
      linkId: bundle.id,
      fileId: targetFile.id,
      ownerId: bundle.owner_id,
      workspaceId: bundle.workspace_id,
      sessionId,
      viewerEmail: grant?.email,
      ipHash,
      userAgent
    });
    return buildDeniedResponse('file_missing', 404);
  }

  // A direct download bypasses the viewer, so it must consume a view
  // slot just like /document does — otherwise a one_time / max_views
  // link could be downloaded directly (and repeatedly) without ever
  // being counted. claim_view is session-deduped, so a viewer who
  // already loaded the doc and then downloads it in the same session is
  // not double-counted. Claim after confirming the bytes exist upstream
  // so a missing storage object doesn't burn a slot. Owner previews
  // never claim and never record a download event.
  if (!isOwnerPreview) {
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
        workspaceId: bundle.workspace_id,
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });
      return buildDeniedResponse(reason);
    }

    try {
      await recordLinkEvent({
        linkId: bundle.id,
        fileId: targetFile.id,
        ownerId: bundle.owner_id,
        workspaceId: bundle.workspace_id,
        eventType: 'download',
        sessionId,
        viewerEmail: grant?.email,
        ipHash,
        userAgent
      });
    } catch {
      // Keep download working even if analytics logging fails.
    }
  }

  const safeName = targetFile.original_name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'private, no-store'
  };
  const upstreamLen = upstream.headers.get('content-length');
  if (upstreamLen) responseHeaders['Content-Length'] = upstreamLen;
  const response = new NextResponse(upstream.body, {
    status: 200,
    headers: responseHeaders
  });

  if (shouldRefreshViewerCookie) {
    response.cookies.set(VIEWER_SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30
    });
  }

  return response;
}
