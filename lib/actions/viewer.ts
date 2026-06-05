'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import {
  getLinkForQuestion,
  getViewerLinkByToken,
  insertDataRoomQuestion,
  recordLinkEvent
} from '@/lib/data';
import { notifyQuestion } from '@/lib/notify/question';
import { evaluateBasePolicy } from '@/lib/policy';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getEmailDomain,
  hashIp,
  normalizeEmail,
  normalizeViewerSessionId,
  verifyPassword
} from '@/lib/security';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, encodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

async function getRequestContext() {
  const cookieStore = await cookies();
  const headersList = await headers();

  const rawSessionId = cookieStore.get(VIEWER_SESSION_COOKIE)?.value;
  const sessionId = normalizeViewerSessionId(rawSessionId);
  if (!rawSessionId || rawSessionId !== sessionId) {
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

  if (!bundle) {
    redirect(`/v/${token}?denied=file_missing`);
  }
  const eventFileId = bundle.file?.id ?? bundle.collection_files[0]?.id;
  if (!eventFileId) {
    redirect(`/v/${token}?denied=file_missing`);
  }

  const ctx = await getRequestContext();
  const baseDenied = evaluateBasePolicy({ link: bundle, grant: null });
  if (baseDenied) {
    await recordDeniedEvent({
      reason: baseDenied,
      linkId: bundle.id,
      fileId: eventFileId,
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
        fileId: eventFileId,
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
      fileId: eventFileId,
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
          fileId: eventFileId,
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
    // Brute-force guard: cap password submissions per link + hashed IP.
    // Keyed on the hashed IP (not session) so an attacker can't reset the
    // counter by rotating the viewer-session cookie.
    const pwLimit = await checkRateLimit('viewerPassword', `${bundle.id}:${ctx.ipHash ?? 'unknown'}`);
    if (!pwLimit.allowed) {
      await recordDeniedEvent({
        reason: 'too_many_attempts',
        linkId: bundle.id,
        fileId: eventFileId,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });
      redirect(`/v/${token}?denied=too_many_attempts`);
    }

    if (!rawPassword) {
      await recordDeniedEvent({
        reason: 'password_required',
        linkId: bundle.id,
        fileId: eventFileId,
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
        fileId: eventFileId,
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
        fileId: eventFileId,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      redirect(`/v/${token}?denied=wrong_password`);
    }
  }

  // Clickwrap NDA gate. Evaluated last so the agreement is only recorded
  // once email + password checks pass and we're about to issue the grant.
  let agreedAt: number | undefined;
  let agreementName: string | undefined;
  if (bundle.require_agreement) {
    const rawAgree = ((formData.get('agree') as string | null) || '').trim();
    const agreed = rawAgree === 'on' || rawAgree === 'true' || rawAgree === '1';
    const rawName = ((formData.get('agreementName') as string | null) || '').trim();

    if (!agreed || !rawName) {
      await recordDeniedEvent({
        reason: 'agreement_required',
        linkId: bundle.id,
        fileId: eventFileId,
        ownerId: bundle.owner_id,
        sessionId: ctx.sessionId,
        viewerEmail: normalizedEmail,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent
      });

      redirect(`/v/${token}?denied=agreement_required`);
    }

    agreementName = rawName.slice(0, 200);
    agreedAt = Date.now();
    // Durable assent record (the legally meaningful part of a clickwrap):
    // who, when, what name they signed, from which hashed IP/session.
    await recordLinkEvent({
      linkId: bundle.id,
      fileId: eventFileId,
      ownerId: bundle.owner_id,
      eventType: 'agreement',
      sessionId: ctx.sessionId,
      viewerEmail: normalizedEmail,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      agreementName
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(getGrantCookieName(bundle.id), encodeGrantCookie({
    linkId: bundle.id,
    policyVersion: bundle.policy_version,
    email: normalizedEmail,
    grantedAt: Date.now(),
    agreedAt
  }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 6
  });

  redirect(`/v/${token}`);
}

// Data room Phase 4: a viewer submits a question on a data-room link. Anonymous
// (service-role write). Gated on the link being a live data-room link; rate-
// limited per (link + hashed IP). The owner is notified best-effort after the
// response. Questions are private — only the asker (by session) + owner see them.
export async function submitViewerQuestionAction(token: string, formData: FormData) {
  const link = await getLinkForQuestion(token);
  // Only data-room links have Q&A. A missing/file link → just bounce back.
  if (!link || !link.collection_id) {
    redirect(`/v/${token}`);
  }
  // Capture now, while collection_id is narrowed to string — the awaits below
  // would otherwise let TS widen the property back to string | null.
  const collectionId = link.collection_id;
  const ownerId = link.owner_id;
  const linkId = link.id;

  const expired = link.expires_at ? new Date(link.expires_at) < new Date() : false;
  if (!link.is_active || expired || link.deleted_at) {
    redirect(`/v/${token}?denied=inactive`);
  }

  const body = ((formData.get('question') as string | null) || '').trim();
  if (!body) {
    redirect(`/v/${token}?qa=empty`);
  }

  const ctx = await getRequestContext();

  // Spam guard: cap submissions per (link + hashed IP), like the upload route.
  const limit = await checkRateLimit('viewerQuestion', `${link.id}:${ctx.ipHash ?? 'unknown'}`);
  if (!limit.allowed) {
    redirect(`/v/${token}?qa=rate`);
  }

  // Attribute the email only if the link already collected one (grant cookie).
  const cookieStore = await cookies();
  const grant = decodeGrantCookie(cookieStore.get(getGrantCookieName(link.id))?.value, link.id);
  const askerEmail = grant?.email ?? null;

  const trimmedBody = body.slice(0, 2000);
  const inserted = await insertDataRoomQuestion({
    collectionId,
    linkId,
    ownerId,
    sessionId: ctx.sessionId,
    askerEmail,
    body: trimmedBody,
    ipHash: ctx.ipHash
  });

  if (!inserted) {
    redirect(`/v/${token}?qa=error`);
  }

  // Best-effort owner notification, AFTER the response (never blocks the viewer).
  after(() =>
    notifyQuestion({
      ownerId,
      collectionId,
      questionId: inserted.id,
      body: trimmedBody,
      askerEmail,
      createdAt: new Date().toISOString()
    })
  );

  redirect(`/v/${token}?qa=sent`);
}
