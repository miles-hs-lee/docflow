'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env-public';
import type { Database } from '@/lib/supabase/database.types';

export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
