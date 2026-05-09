import { publicEnv } from '@/lib/env-public';

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const viewerCookieSecret = process.env.VIEWER_COOKIE_SECRET || '';

export function getServiceRoleKey() {
  if (!supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  }

  return supabaseServiceRoleKey;
}

export function getViewerCookieSecret() {
  if (!viewerCookieSecret) {
    throw new Error('Missing VIEWER_COOKIE_SECRET — set a long random string in the environment.');
  }

  return viewerCookieSecret;
}

export const serverEnv = {
  ...publicEnv,
  supabaseServiceRoleKey
};
