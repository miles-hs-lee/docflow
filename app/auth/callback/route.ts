import { NextResponse } from 'next/server';

import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_TTL_SECONDS,
  signRecoveryToken
} from '@/lib/password-recovery-cookie';
import { createClient } from '@/lib/supabase/server';

/**
 * Generic auth callback for Supabase magic links (signup confirm,
 * password recovery). The link sent in the email points here with a
 * `code` param; we exchange it for a session and forward the user to
 * the page named in `next`.
 *
 * Recovery flow: resetPasswordForEmail({
 *   redirectTo: `${origin}/auth/callback?next=/reset-password`
 * }) lands here with a recovery session attached, then hands off to
 * /reset-password where the user picks a new password.
 */

const ALLOWED_NEXT_PATHS = new Set(['/dashboard', '/reset-password']);

function safeNext(raw: string | null): string {
  // Open-redirect defense:
  //   - must start with a single '/'
  //   - reject protocol-relative ('//evil.com') and backslash variants
  //     ('/\\evil.com' which some browsers normalize to a host)
  //   - allowlist the only paths the callback legitimately hands off to
  const fallback = '/dashboard';
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  return ALLOWED_NEXT_PATHS.has(raw) ? raw : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (!code) {
    const errorUrl = new URL('/login', request.url);
    errorUrl.searchParams.set('error', '인증 링크가 유효하지 않습니다.');
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorUrl = new URL('/login', request.url);
    errorUrl.searchParams.set('error', '인증 링크가 유효하지 않거나 만료되었습니다. 다시 요청해주세요.');
    return NextResponse.redirect(errorUrl);
  }

  const response = NextResponse.redirect(new URL(next, request.url));

  // Recovery-only marker pinned to the user this code resolved to.
  // /reset-password (page + POST) compares the cookie's HMAC signature
  // against the CURRENT supabase user, so a cookie left over from
  // another user / stale session cannot grant reset access.
  if (next === '/reset-password') {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      response.cookies.set(PASSWORD_RECOVERY_COOKIE, signRecoveryToken(user.id), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: PASSWORD_RECOVERY_TTL_SECONDS
      });
    }
  }

  return response;
}
