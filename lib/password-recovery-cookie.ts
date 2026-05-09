// Short-TTL HttpOnly cookie set by /auth/callback when the recovery
// link forwards to /reset-password. /reset-password (page + POST) gates
// on this cookie so an already-logged-in normal session cannot bypass
// current-password verification by navigating directly to the reset
// route.
//
// The cookie value is `${userId}.${HMAC(userId, secret)}` so a stale
// cookie left over from another session (or another user on the same
// device) cannot grant reset access to the wrong account — the verify
// step compares against the CURRENT supabase session's user.id.

import crypto from 'node:crypto';

import { getViewerCookieSecret } from '@/lib/env-server';

export const PASSWORD_RECOVERY_COOKIE = 'docflow_pw_recovery';
export const PASSWORD_RECOVERY_TTL_SECONDS = 5 * 60;

export function signRecoveryToken(userId: string): string {
  const sig = crypto.createHmac('sha256', getViewerCookieSecret()).update(userId).digest('hex');
  return `${userId}.${sig}`;
}

/**
 * Returns true only if `token` is a well-formed HMAC over `userId`
 * issued by signRecoveryToken(). Constant-time comparison via
 * crypto.timingSafeEqual to avoid leaking which user a stale cookie
 * was issued for.
 */
export function verifyRecoveryToken(token: string | null | undefined, userId: string): boolean {
  if (!token || !userId) return false;
  let expected: string;
  try {
    expected = signRecoveryToken(userId);
  } catch {
    // VIEWER_COOKIE_SECRET unset (the getter throws). Treat as invalid
    // — every recovery flow needs the secret to function.
    return false;
  }
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
