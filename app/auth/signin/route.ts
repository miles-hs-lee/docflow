import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = `${url.origin}/auth/callback`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo
    }
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${url.origin}/login?error=${encodeURIComponent('로그인 요청에 실패했습니다.')}`);
  }

  return NextResponse.redirect(data.url);
}
