import { getViewerCookieSecret } from '@/lib/env-server';
import { signViewerGrant, verifyViewerGrant } from '@/lib/security';
import type { ViewerGrantPayload } from '@/lib/types';

// Re-export from edge-safe module so older import paths keep working
// while the middleware can pull the constant alone without security.ts.
export { VIEWER_SESSION_COOKIE } from '@/lib/viewer-session';

// Must match the grant cookie maxAge in lib/actions/viewer.ts (6h).
// Browsers honor maxAge and drop the cookie, but a copied/replayed
// cookie value bypasses that — so the server must independently enforce
// the age window against the signed `grantedAt`.
const GRANT_TTL_MS = 60 * 60 * 6 * 1000;
// Tolerate small clock skew between issue and verify hosts.
const GRANT_SKEW_MS = 60 * 1000;

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
  // Server-side age enforcement — a replayed cookie can outlive the
  // browser maxAge otherwise. Reject expired grants and grants stamped
  // in the future (tampered / bad clock beyond skew tolerance).
  const age = Date.now() - payload.grantedAt;
  if (age > GRANT_TTL_MS || age < -GRANT_SKEW_MS) return null;
  return payload;
}
