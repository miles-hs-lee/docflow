import { publicEnv } from '@/lib/env-public';

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

export const serverEnv = {
  ...publicEnv,
  supabaseServiceRoleKey,
  viewerCookieSecret: process.env.VIEWER_COOKIE_SECRET || 'replace-me-in-production'
};
