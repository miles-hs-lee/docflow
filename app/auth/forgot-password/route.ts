import { NextResponse } from 'next/server';

import { publicEnv } from '@/lib/env-public';
import { checkRateLimit } from '@/lib/rate-limit';
import { hashIp } from '@/lib/security';
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

  // Throttle per hashed IP — this endpoint sends emails, so it's an
  // email-bombing / enumeration vector if left open.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit('authLogin', `forgot:${hashIp(ip) ?? 'unknown'}`);
  if (!rl.allowed) {
    return redirectWithMessage(request.url, 'error', '요청이 많습니다. 잠시 후 다시 시도해주세요.');
  }

  const supabase = await createClient();

  // Always return the success message — even if the email is not registered.
  // Disclosing whether an address exists in our user table would let an
  // attacker enumerate accounts via this form.
  await supabase.auth.resetPasswordForEmail(email, {
    // Configured app URL, not the request host — the reset link must point
    // at the real domain (an allowed Supabase redirect), never an
    // attacker-set X-Forwarded-Host.
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password`
  });

  return redirectWithMessage(
    request.url,
    'success',
    '입력한 이메일이 등록되어 있다면 재설정 링크가 발송됩니다. 메일함을 확인해주세요.'
  );
}
