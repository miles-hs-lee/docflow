import { serverEnv } from '@/lib/env-server';
import { signViewerGrant, verifyViewerGrant } from '@/lib/security';
import type { ViewerGrantPayload } from '@/lib/types';

export const VIEWER_SESSION_COOKIE = 'docflow_vid';

export function getGrantCookieName(linkId: string) {
  return `docflow_grant_${linkId.replace(/-/g, '')}`;
}

export function encodeGrantCookie(payload: ViewerGrantPayload) {
  return signViewerGrant(payload, serverEnv.viewerCookieSecret);
}

export function decodeGrantCookie(raw: string | null | undefined, linkId: string) {
  if (!raw) return null;
  const payload = verifyViewerGrant(raw, serverEnv.viewerCookieSecret);
  if (!payload || payload.linkId !== linkId) return null;
  return payload;
}
