import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env-public';
import type { Database } from '@/lib/supabase/database.types';
import { VIEWER_SESSION_COOKIE, normalizeViewerSessionId } from '@/lib/viewer-session';

export async function middleware(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  // Ensure /v/* viewers always carry a stable viewer session id. Mutating
  // cookies in a Server Component throws under Next 15 RSC; the middleware is
  // the right place to guarantee the cookie before the page renders.
  if (request.nextUrl.pathname.startsWith('/v/')) {
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
    // Keep public routes reachable even if auth backends are temporarily unavailable.
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
};
