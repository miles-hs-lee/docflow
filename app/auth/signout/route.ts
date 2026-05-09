import { NextResponse } from 'next/server';

import { PASSWORD_RECOVERY_COOKIE } from '@/lib/password-recovery-cookie';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(`${requestUrl.origin}/login`, { status: 303 });
  // Clear any in-flight recovery cookie alongside the supabase session.
  // Without this, a recovery cookie issued in a previous session could
  // outlive its matching auth session for up to 5 minutes.
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
