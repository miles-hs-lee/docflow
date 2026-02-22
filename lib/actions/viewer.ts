'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getViewerLinkByToken, recordLinkEvent } from '@/lib/data';
import { evaluateBasePolicy } from '@/lib/policy';
import { createViewerSessionId, getEmailDomain, hashIp, normalizeEmail, verifyPassword } from '@/lib/security';
import type { DeniedReason } from '@/lib/types';
import { encodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

async function getRequestContext() {
  const cookieStore = await cookies();
  const headersList = await headers();

  let sessionId = cookieStore.get(VIEWER_SESSION_COOKIE)?.value;
  if (!sessionId) {
    sessionId = createViewerSessionId();
    cookieStore.set(VIEWER_SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30
    });
  }

  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = headersList.get('user-agent');

  return {
    sessionId,
    ipHash: hashIp(ip),
    userAgent
  };
}

async function recordDeniedEvent(input: {
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
    linkId: input.linkId,
    fileId: input.fileId,
    ownerId: input.ownerId,
    eventType: 'denied',
    reason: input.reason,
    sessionId: input.sessionId,
    viewerEmail: input.viewerEmail,
    ipHash: input.ipHash,
    userAgent: input.userAgent
  });
}

export async function submitViewerAccessAction(token: string, formData: FormData) {
  const bundle = await getViewerLinkByToken(token);

  if (!bundle || !bundle.file) {
    redirect(`/v/${token}?denied=file_missing`);
  }

  const ctx = await getRequestContext();
  const baseDenied = evaluateBasePolicy({ link: bundle, grant: null });
  if (baseDenied) {
    await recordDeniedEvent({
      reason: baseDenied,
      linkId: bundle.id,
      fileId: bundle.file.id,
      ownerId: bundle.owner_id,
      sessionId: ctx.sessionId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent
    });

    redirect(`/v/${token}?denied=${baseDenied}`);
  }

  const rawEmail = ((formData.get('email') as string | null) || '').trim();
  const rawPassword = ((formData.get('password') as string | null) || '').trim();

  let normalizedEmail: string | undefined;
  const requiresEmail = bundle.require_email || bundle.allowed_domains.length > 0;

  if (requiresEmail) {
    if (!rawEmail) {
      await recordDeniedEvent({
        reason: 'email_required',
        linkId: bundle.id,
        fileId: bundle.file.id,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      redirect(`/v/${token}?denied=email_required`);
    }

    normalizedEmail = normalizeEmail(rawEmail);
    await recordLinkEvent({
      linkId: bundle.id,
      fileId: bundle.file.id,
      ownerId: bundle.owner_id,
      eventType: 'email_submitted',
      sessionId: ctx.sessionId,
      viewerEmail: normalizedEmail,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent
    });

    if (bundle.allowed_domains.length > 0) {
      const emailDomain = getEmailDomain(normalizedEmail);

      if (!emailDomain || !bundle.allowed_domains.includes(emailDomain)) {
        await recordDeniedEvent({
          reason: 'domain_not_allowed',
          linkId: bundle.id,
          fileId: bundle.file.id,
          ownerId: bundle.owner_id,
          sessionId: ctx.sessionId,
          viewerEmail: normalizedEmail,
          ipHash: ctx.ipHash,
          userAgent: ctx.userAgent
        });

        redirect(`/v/${token}?denied=domain_not_allowed`);
      }
    }
  }

  if (bundle.password_hash) {
    if (!rawPassword) {
      await recordDeniedEvent({
        reason: 'password_required',
        linkId: bundle.id,
        fileId: bundle.file.id,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      redirect(`/v/${token}?denied=password_required`);
    }

    const passwordValid = await verifyPassword(rawPassword, bundle.password_hash);
    if (!passwordValid) {
      await recordLinkEvent({
        linkId: bundle.id,
        fileId: bundle.file.id,
        ownerId: bundle.owner_id,
        eventType: 'password_failed',
        reason: 'wrong_password',
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      await recordDeniedEvent({
        reason: 'wrong_password',
        linkId: bundle.id,
        fileId: bundle.file.id,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      redirect(`/v/${token}?denied=wrong_password`);
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(getGrantCookieName(bundle.id), encodeGrantCookie({
    linkId: bundle.id,
    email: normalizedEmail,
    grantedAt: Date.now()
  }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 6
  });

  redirect(`/v/${token}`);
}
