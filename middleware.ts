import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env-public';
import type { Database } from '@/lib/supabase/database.types';
import { VIEWER_SESSION_COOKIE, normalizeViewerSessionId } from '@/lib/viewer-session';

export async function middleware(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const response = NextResponse.next();

  // Viewer routes only need a stable session cookie — they don't have a
  // Supabase user session at all, so skip the auth refresh. Landing,
  // static, and the rest of the app are excluded by the matcher below.
  if (pathname.startsWith('/v/')) {
    const existing = request.cookies.get(VIEWER_SESSION_COOKIE)?.value;
    const normalized = normalizeViewerSessionId(existing);
    if (!existing || existing !== normalized) {
      response.cookies.set(VIEWER_SESSION_COOKIE, normalized, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 30
      });
    }
    return response;
  }

  type CookieToSet = {
    name: string;
    value: string;
    options?: Parameters<typeof response.cookies.set>[2];
  };

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Keep these routes reachable even if auth backends are temporarily unavailable.
  }

  return response;
}

// Narrow scope: middleware only runs on routes that actually need it.
// - /dashboard/*:      gated, needs Supabase session refresh.
// - /auth/*:           callbacks / signout — may set or rotate session.
// - /login, /signup,
//   /forgot-password,
//   /reset-password:   read user to redirect logged-in visitors and
//                      need session-cookie rotation under Next 15 RSC.
// - /v/*:              viewer routes need only the session cookie
//                      (handled above; supabase.auth call is skipped).
// Landing (/) is now static; api/* runs its own auth via createClient.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/auth/:path*',
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/v/:path*'
  ]
};
