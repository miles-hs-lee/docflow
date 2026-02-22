import { NextResponse } from 'next/server';

import { normalizeEmail } from '@/lib/security';
import { createClient } from '@/lib/supabase/server';

function redirectWithMessage(requestUrl: string, type: 'error' | 'success', message: string) {
  const url = new URL('/login', requestUrl);
  url.searchParams.set(type, message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = normalizeEmail(((formData.get('email') as string | null) || '').trim());
  const password = ((formData.get('password') as string | null) || '').trim();

  if (!email || !password) {
    return redirectWithMessage(request.url, 'error', '이메일과 비밀번호를 입력해주세요.');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    const message = error.message.toLowerCase();

    if (message.includes('invalid login credentials')) {
      return redirectWithMessage(request.url, 'error', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    if (message.includes('email not confirmed')) {
      return redirectWithMessage(request.url, 'error', '이메일 인증이 필요합니다. 인증 후 다시 로그인해주세요.');
    }

    if (message.includes('too many requests')) {
      return redirectWithMessage(request.url, 'error', '요청이 많습니다. 잠시 후 다시 시도해주세요.');
    }

    return redirectWithMessage(request.url, 'error', '로그인에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  return NextResponse.redirect(new URL('/dashboard', request.url), { status: 303 });
}
