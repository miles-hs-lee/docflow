import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { WorkspaceInvitationRow, WorkspaceMemberWithUser, WorkspaceRole } from '@/lib/types';

// Roster for a workspace, joined with each member's email (resolved via the
// admin auth API — auth.users isn't exposed through PostgREST). Service-role.
export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workspace_members')
    .select('user_id, role, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  const rows = data as { user_id: string; role: WorkspaceRole; created_at: string }[];
  return Promise.all(
    rows.map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      return { user_id: m.user_id, role: m.role, created_at: m.created_at, email: u?.user?.email ?? null };
    })
  );
}

// Pending invitations for a workspace (newest first).
export async function listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitationRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workspace_invitations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as WorkspaceInvitationRow[];
}

// Resolve an invite token → the invitation plus its workspace name (for the
// accept page). Service-role: the invitee may not yet be a member.
export async function getInvitationByToken(
  token: string
): Promise<(WorkspaceInvitationRow & { workspace_name: string }) | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workspace_invitations')
    .select('*, workspaces ( name )')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as WorkspaceInvitationRow & { workspaces: { name: string } | null };
  return { ...row, workspace_name: row.workspaces?.name ?? '워크스페이스' };
}

// How many owners a workspace has — used to block removing/demoting the last one.
export async function countWorkspaceOwners(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('workspace_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner');
  return count ?? 0;
}
