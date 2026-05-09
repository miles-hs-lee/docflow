import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

function redirectWithMessage(requestUrl: string, key: 'error' | 'success', message: string) {
  const url = new URL('/forgot-password', requestUrl);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = ((formData.get('email') as string | null) || '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return redirectWithMessage(request.url, 'error', '유효한 이메일을 입력해주세요.');
  }

  const supabase = await createClient();
  const origin = new URL(request.url).origin;

  // Always return the success message — even if the email is not registered.
  // Disclosing whether an address exists in our user table would let an
  // attacker enumerate accounts via this form.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`
  });

  return redirectWithMessage(
    request.url,
    'success',
    '입력한 이메일이 등록되어 있다면 재설정 링크가 발송됩니다. 메일함을 확인해주세요.'
  );
}
