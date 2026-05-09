import { getViewerCookieSecret } from '@/lib/env-server';
import { signViewerGrant, verifyViewerGrant } from '@/lib/security';
import type { ViewerGrantPayload } from '@/lib/types';

// Re-export from edge-safe module so older import paths keep working
// while the middleware can pull the constant alone without security.ts.
export { VIEWER_SESSION_COOKIE } from '@/lib/viewer-session';

export function getGrantCookieName(linkId: string) {
  return `docflow_grant_${linkId.replace(/-/g, '')}`;
}

export function encodeGrantCookie(payload: ViewerGrantPayload) {
  return signViewerGrant(payload, getViewerCookieSecret());
}

export function decodeGrantCookie(raw: string | null | undefined, linkId: string) {
  if (!raw) return null;
  const payload = verifyViewerGrant(raw, getViewerCookieSecret());
  if (!payload || payload.linkId !== linkId) return null;
  return payload;
}
