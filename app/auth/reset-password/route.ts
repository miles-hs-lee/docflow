import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

function redirectToReset(requestUrl: string, key: 'error' | 'success', message: string) {
  const url = new URL('/reset-password', requestUrl);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
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

  // Success — recovery session is now a normal session, so the user is
  // already logged in. Send them straight to the dashboard.
  const url = new URL('/dashboard', request.url);
  url.searchParams.set('success', '비밀번호가 변경되었습니다.');
  return NextResponse.redirect(url, { status: 303 });
}
