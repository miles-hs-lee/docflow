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

  // Fetch the PDF FIRST so a missing storage object (drift between DB and
  // storage) doesn't burn a max_views slot on a doc the viewer never saw.
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

  // Now atomically claim the view. claim_view (migration 007) dedups by
  // (link_id, session_id), so a collection viewer that opens 5 files in
  // one browser session only consumes one slot of max_views/one_time.
  // SELECT ... FOR UPDATE serializes concurrent requests on the same link.
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

  const safeName = targetFile.original_name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  // Pass the Blob to NextResponse directly — Next.js handles streaming
  // and Content-Length without an explicit arrayBuffer() copy. This was
  // briefly using pdfBlob.stream() but Vercel's serverless runtime
  // returned a truncated body, breaking react-pdf with the generic
  // "PDF를 표시할 수 없습니다." error.
  // Viewer session cookie is guaranteed by middleware on every /v/* request,
  // so this route handler does not need to set it.
  return new NextResponse(pdfBlob, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
