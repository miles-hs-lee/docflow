import { createClient } from '@supabase/supabase-js';

import { serverEnv } from '@/lib/env-server';

let cached: ReturnType<typeof createClient> | null = null;

export function createAdminClient() {
  if (!cached) {
    cached = createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return cached;
}
