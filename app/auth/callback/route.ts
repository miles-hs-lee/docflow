import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent('로그인 코드가 없습니다.')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent('세션 생성에 실패했습니다.')}`);
  }

  return NextResponse.redirect(`${requestUrl.origin}/dashboard`);
}
