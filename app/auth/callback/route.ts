import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Generic auth callback for Supabase magic links (signup confirm,
 * password recovery). The link sent in the email points here with a
 * `code` param; we exchange it for a session and forward the user to
 * the page named in `next` (defaults to /dashboard).
 *
 * Recovery flow: resetPasswordForEmail({
 *   redirectTo: `${origin}/auth/callback?next=/reset-password`
 * }) lands here with a recovery session attached, then hands off to
 * /reset-password where the user picks a new password.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/dashboard';

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

  return NextResponse.redirect(new URL(next, request.url));
}
