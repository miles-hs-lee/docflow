import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { WorkspaceRole, WorkspaceWithRole } from '@/lib/types';

// Cookie that pins the user's CURRENT workspace (they may belong to several).
// Set by the workspace switcher (Phase D); defaults to the earliest membership.
export const WORKSPACE_COOKIE = 'docflow_ws';

async function getSafeUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      return null;
    }

    return user ?? null;
  } catch {
    return null;
  }
}

export async function requireOwner() {
  const supabase = await createClient();
  const user = await getSafeUser(supabase);

  if (!user) {
    redirect('/login');
  }

  return { user, supabase };
}

export async function getOwner() {
  const supabase = await createClient();
  const user = await getSafeUser(supabase);

  return { user, supabase };
}

// Every workspace the user belongs to, with their role, earliest first. Read via
// the service-role client (a trusted internal lookup, no RLS edge cases).
export const listUserWorkspaces = cache(async (userId: string): Promise<WorkspaceWithRole[]> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workspace_members')
    .select('role, workspaces ( id, name, created_by, created_at, updated_at )')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  // Cast through unknown: the embed resolves at runtime via the DB FK
  // (workspace_members.workspace_id → workspaces.id); the generated types just
  // don't declare that relationship.
  return (
    data as unknown as Array<{
      role: WorkspaceRole;
      workspaces: {
        id: string;
        name: string;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      } | null;
    }>
  )
    .filter((row) => row.workspaces)
    .map((row) => ({ ...(row.workspaces as NonNullable<typeof row.workspaces>), role: row.role }));
});

// Create a personal workspace + owner membership for a user who has none yet — a
// brand-new account that signed up AFTER migration 032's one-time backfill.
// cache()'d so the dashboard layout + page (which both call requireWorkspace in a
// single render) share ONE creation instead of racing to make two. Returns null
// only on a DB error, in which case the caller falls back to /login.
const ensurePersonalWorkspace = cache(async (userId: string): Promise<WorkspaceWithRole | null> => {
  const admin = createAdminClient();
  // Atomic + race-safe (per-user advisory lock + membership re-check, all in one
  // transaction — migration 037). Replaces the old 2-step insert that could make
  // duplicate personal workspaces on a concurrent first-load or orphan a
  // workspace if the membership insert failed.
  const { data, error } = await admin.rpc('ensure_personal_workspace', { p_user_id: userId });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;
  return {
    id: row.id,
    name: row.name,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role: row.role
  };
});

// The owner shell entry point: resolves the authed user AND their current
// workspace + role. The current workspace = the WORKSPACE_COOKIE value when it
// names one the user belongs to, else the earliest membership. Redirects to
// /login when unauthenticated or (defensively) when the user has no workspace.
export async function requireWorkspace(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getSafeUser>>>;
  supabase: Awaited<ReturnType<typeof createClient>>;
  workspace: WorkspaceWithRole;
  role: WorkspaceRole;
}> {
  const supabase = await createClient();
  const user = await getSafeUser(supabase);
  if (!user) {
    redirect('/login');
  }

  // A brand-new account (signed up after the 032 backfill) has no workspace yet —
  // lazily create a personal one so the dashboard is reachable, instead of looping
  // back to /login → "already logged in" → dashboard → /login forever.
  const workspace = (await getCurrentWorkspace(user.id)) ?? (await ensurePersonalWorkspace(user.id));
  if (!workspace) {
    redirect('/login');
  }

  return { user, supabase, workspace, role: workspace.role };
}

// The user's current workspace (WORKSPACE_COOKIE-pinned, else earliest), or null
// if they belong to none. Used by routes/actions that need the workspace without
// requireWorkspace's redirect (they handle auth themselves).
export async function getCurrentWorkspace(userId: string): Promise<WorkspaceWithRole | null> {
  const workspaces = await listUserWorkspaces(userId);
  if (workspaces.length === 0) return null;
  const cookieStore = await cookies();
  const pinned = cookieStore.get(WORKSPACE_COOKIE)?.value;
  return (pinned && workspaces.find((w) => w.id === pinned)) || workspaces[0];
}
