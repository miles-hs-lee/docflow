import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { PASSWORD_RECOVERY_COOKIE } from '@/lib/password-recovery-cookie';
import { createClient } from '@/lib/supabase/server';

function redirectToReset(requestUrl: string, key: 'error' | 'success', message: string) {
  const url = new URL('/reset-password', requestUrl);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  // Gate on the recovery cookie set by /auth/callback (see route.ts).
  // This prevents an already-logged-in normal session from POSTing here
  // and changing its password without re-entering the current one.
  const cookieStore = await cookies();
  if (!cookieStore.get(PASSWORD_RECOVERY_COOKIE)) {
    const url = new URL('/forgot-password', request.url);
    url.searchParams.set('error', '재설정 세션이 만료되었습니다. 다시 요청해주세요.');
    return NextResponse.redirect(url, { status: 303 });
  }

  const formData = await request.formData();
  const password = ((formData.get('password') as string | null) || '').trim();
  const confirm = ((formData.get('passwordConfirm') as string | null) || '').trim();

  if (password.length < 8) {
    return redirectToReset(request.url, 'error', '비밀번호는 8자 이상이어야 합니다.');
  }
  if (password !== confirm) {
    return redirectToReset(request.url, 'error', '두 비밀번호가 일치하지 않습니다.');
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    // Recovery session expired or never existed — punt back to the
    // request flow so the user can re-issue a reset email.
    const url = new URL('/forgot-password', request.url);
    url.searchParams.set('error', '재설정 링크가 만료되었습니다. 다시 요청해주세요.');
    return NextResponse.redirect(url, { status: 303 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('same') || message.includes('different')) {
      return redirectToReset(request.url, 'error', '이전 비밀번호와 다른 값을 사용해주세요.');
    }
    return redirectToReset(request.url, 'error', '비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  // Consume the recovery cookie so it cannot be reused. The recovery
  // session is now a normal session, so the user is already logged in.
  const url = new URL('/dashboard', request.url);
  url.searchParams.set('success', '비밀번호가 변경되었습니다.');
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
