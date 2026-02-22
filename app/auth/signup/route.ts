import { NextResponse } from 'next/server';

import { normalizeEmail } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

function redirectWithMessage(requestUrl: string, type: 'error' | 'success', message: string) {
  const url = new URL('/signup', requestUrl);
  url.searchParams.set(type, message);
  return NextResponse.redirect(url, { status: 303 });
}

function isAlreadyRegisteredError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('already registered') ||
    normalized.includes('already been registered') ||
    normalized.includes('already exists')
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = normalizeEmail(((formData.get('email') as string | null) || '').trim());
  const password = ((formData.get('password') as string | null) || '').trim();

  if (!email || !password) {
    return redirectWithMessage(request.url, 'error', '이메일과 비밀번호를 입력해주세요.');
  }

  if (password.length < 8) {
    return redirectWithMessage(request.url, 'error', '비밀번호는 8자 이상이어야 합니다.');
  }

  let createdNewUser = false;

  try {
    const admin = createAdminClient();
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (createError && !isAlreadyRegisteredError(createError.message)) {
      return redirectWithMessage(request.url, 'error', '가입에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    createdNewUser = !createError;
  } catch {
    return redirectWithMessage(request.url, 'error', '가입 처리 중 오류가 발생했습니다.');
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (signInError) {
    if (signInError.message.toLowerCase().includes('invalid login credentials')) {
      return redirectWithMessage(request.url, 'error', '이미 가입된 이메일입니다. 비밀번호를 확인해주세요.');
    }

    return redirectWithMessage(request.url, 'error', '가입 후 로그인에 실패했습니다. 다시 시도해주세요.');
  }

  const successMessage = createdNewUser ? '가입이 완료되었습니다.' : '이미 가입된 계정으로 로그인되었습니다.';
  return NextResponse.redirect(new URL(`/dashboard?success=${encodeURIComponent(successMessage)}`, request.url), {
    status: 303
  });
}
