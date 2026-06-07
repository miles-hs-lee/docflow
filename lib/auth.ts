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

  const workspace = await getCurrentWorkspace(user.id);
  if (!workspace) {
    // Post-backfill every user has a personal workspace, so this only fires for
    // a brand-new account before its workspace exists — send to login (a future
    // onboarding flow can create one here).
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
