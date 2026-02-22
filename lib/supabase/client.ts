'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env-public';

export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
