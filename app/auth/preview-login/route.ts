import { NextResponse } from 'next/server';

import { serverEnv } from '@/lib/env-server';
import { canUsePreviewTestLogin } from '@/lib/preview-login';
import { ensurePreviewTestUser } from '@/lib/preview-auth';
import { normalizeEmail } from '@/lib/security';
import { createClient } from '@/lib/supabase/server';

function redirectWithMessage(url: URL, type: 'error' | 'success', message: string) {
  return NextResponse.redirect(`${url.origin}/login?${type}=${encodeURIComponent(message)}`);
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (!canUsePreviewTestLogin()) {
    return redirectWithMessage(url, 'error', 'Preview 테스트 로그인이 비활성화되어 있습니다.');
  }

  const formData = await request.formData();
  const enteredEmail = normalizeEmail(((formData.get('email') as string | null) || '').trim());
  const enteredPassword = ((formData.get('password') as string | null) || '').trim();

  const expectedEmail = normalizeEmail(serverEnv.previewTestEmail);
  const expectedPassword = serverEnv.previewTestPassword;

  if (!enteredEmail || !enteredPassword || enteredEmail !== expectedEmail || enteredPassword !== expectedPassword) {
    return redirectWithMessage(url, 'error', '테스트 계정 정보가 일치하지 않습니다.');
  }

  try {
    await ensurePreviewTestUser(expectedEmail, expectedPassword);
  } catch {
    return redirectWithMessage(url, 'error', '테스트 계정 준비에 실패했습니다.');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: expectedEmail,
    password: expectedPassword
  });

  if (error) {
    return redirectWithMessage(url, 'error', '테스트 로그인에 실패했습니다.');
  }

  return NextResponse.redirect(
    `${url.origin}/dashboard?success=${encodeURIComponent('Preview 테스트 계정으로 로그인되었습니다.')}`
  );
}
