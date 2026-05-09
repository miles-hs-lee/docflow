import { NextRequest, NextResponse } from 'next/server';

import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import { claimView, downloadPdfObject, getViewerLinkByToken, recordLinkEvent } from '@/lib/data';
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

  const existingSession = request.cookies.get(VIEWER_SESSION_COOKIE)?.value;
  const sessionId = normalizeViewerSessionId(existingSession);
  const shouldRefreshViewerCookie = !existingSession || existingSession !== sessionId;

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

  // Atomic view claim: re-checks active/expired/deleted/max_views inside a
  // SELECT ... FOR UPDATE so two concurrent requests against a max_views=1
  // link cannot both pass. The view event is inserted as part of the same
  // transaction (so the bump_link_counters trigger increments inline).
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
    return buildDeniedResponse('file_missing', 500);
  }

  if (!claim.allowed) {
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

  let pdfBlob: Blob;
  try {
    pdfBlob = await downloadPdfObject(targetFile.storage_path);
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

  const buffer = await pdfBlob.arrayBuffer();
  const safeName = targetFile.original_name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  const response = new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store'
    }
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
