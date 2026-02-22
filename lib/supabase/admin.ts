import { createClient } from '@supabase/supabase-js';

import { getServiceRoleKey, serverEnv } from '@/lib/env-server';
import type { Database } from '@/lib/supabase/database.types';

let cached: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  if (!cached) {
    cached = createClient<Database>(serverEnv.supabaseUrl, getServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return cached;
}
