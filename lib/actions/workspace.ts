'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { WORKSPACE_COOKIE, listUserWorkspaces, requireOwner, requireWorkspace } from '@/lib/auth';
import { countWorkspaceOwners } from '@/lib/data-workspace';
import { notifyMemberEvent } from '@/lib/notify/workspace-events';
import { generateShareToken } from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WorkspaceRole } from '@/lib/types';

const TEAM = '/dashboard/team';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 365 };

function buildRedirectPath(path: string, query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}
function redirectWithError(path: string, message: string): never {
  redirect(buildRedirectPath(path, { error: message }));
}
function redirectWithSuccess(path: string, message: string): never {
  redirect(buildRedirectPath(path, { success: message }));
}
function isAdmin(role: WorkspaceRole) {
  return role === 'owner' || role === 'admin';
}
function normalizeRole(raw: unknown): WorkspaceRole {
  return raw === 'owner' ? 'owner' : raw === 'admin' ? 'admin' : 'member';
}

async function setWorkspaceCookie(workspaceId: string) {
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTS);
}

// Switch the current workspace (validates membership), then reload the dashboard.
export async function setWorkspaceAction(formData: FormData) {
  const { user } = await requireOwner();
  const target = ((formData.get('workspaceId') as string | null) || '').trim();
  const workspaces = await listUserWorkspaces(user.id);
  if (!workspaces.some((w) => w.id === target)) {
    redirect('/dashboard');
  }
  await setWorkspaceCookie(target);
  redirect('/dashboard');
}

// Create a new workspace; creator becomes owner and it becomes current.
export async function createWorkspaceAction(formData: FormData) {
  const { user } = await requireOwner();
  const name = ((formData.get('name') as string | null) || '').trim().slice(0, 80);
  if (!name) {
    redirectWithError(TEAM, '워크스페이스 이름을 입력해주세요.');
  }

  const admin = createAdminClient();
  const { data: ws, error } = await admin
    .from('workspaces')
    .insert({ name, created_by: user.id })
    .select('id')
    .maybeSingle();
  if (error || !ws) {
    redirectWithError(TEAM, '워크스페이스 생성에 실패했습니다.');
  }

  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({ workspace_id: ws!.id, user_id: user.id, role: 'owner' });
  if (memberError) {
    redirectWithError(TEAM, '워크스페이스 생성에 실패했습니다.');
  }

  await setWorkspaceCookie(ws!.id);
  redirectWithSuccess('/dashboard', '새 워크스페이스를 만들었습니다.');
}

// Rename the current workspace (admin+).
export async function renameWorkspaceAction(formData: FormData) {
  const { workspace, role } = await requireWorkspace();
  if (!isAdmin(role)) {
    redirectWithError(TEAM, '권한이 없습니다.');
  }
  const name = ((formData.get('name') as string | null) || '').trim().slice(0, 80);
  if (!name) {
    redirectWithError(TEAM, '워크스페이스 이름을 입력해주세요.');
  }
  const admin = createAdminClient();
  await admin.from('workspaces').update({ name }).eq('id', workspace.id);
  revalidatePath(TEAM);
  revalidatePath('/dashboard');
  redirectWithSuccess(TEAM, '워크스페이스 이름을 변경했습니다.');
}

// Create a token invite link for the current workspace (admin+).
export async function createInviteAction(formData: FormData) {
  const { user, workspace, role } = await requireWorkspace();
  if (!isAdmin(role)) {
    redirectWithError(TEAM, '초대 권한이 없습니다.');
  }
  const email = ((formData.get('email') as string | null) || '').trim().toLowerCase().slice(0, 254);
  if (!email || !email.includes('@')) {
    redirectWithError(TEAM, '유효한 이메일을 입력해주세요.');
  }
  const inviteRole = normalizeRole((formData.get('role') as string | null)?.trim());
  // Only an owner may invite another owner.
  if (inviteRole === 'owner' && role !== 'owner') {
    redirectWithError(TEAM, '소유자만 다른 소유자를 초대할 수 있습니다.');
  }

  const admin = createAdminClient();
  const token = generateShareToken();
  const { error } = await admin.from('workspace_invitations').insert({
    workspace_id: workspace.id,
    email,
    role: inviteRole,
    token,
    invited_by: user.id,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
  });
  if (error) {
    redirectWithError(TEAM, '초대 생성에 실패했습니다.');
  }
  revalidatePath(TEAM);
  await notifyMemberEvent({
    actorId: user.id,
    workspaceId: workspace.id,
    eventType: 'member_invited',
    memberEmail: email,
    actorEmail: user.email ?? null,
    createdAt: new Date().toISOString()
  });
  redirectWithSuccess(buildRedirectPath(TEAM, { invited: token }), '초대 링크를 만들었습니다. 아래에서 복사해 전달하세요.');
}

// Revoke a pending invitation (admin+).
export async function revokeInviteAction(formData: FormData) {
  const { workspace, role } = await requireWorkspace();
  if (!isAdmin(role)) {
    redirectWithError(TEAM, '권한이 없습니다.');
  }
  const id = ((formData.get('invitationId') as string | null) || '').trim();
  const admin = createAdminClient();
  await admin
    .from('workspace_invitations')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .eq('status', 'pending');
  revalidatePath(TEAM);
  redirectWithSuccess(TEAM, '초대를 취소했습니다.');
}

// Accept an invite (from /invite/[token]): join the workspace + switch to it.
export async function acceptInviteAction(formData: FormData) {
  const { user } = await requireOwner();
  const token = ((formData.get('token') as string | null) || '').trim();

  // accept_workspace_invitation locks the invite row and validates pending +
  // not-expired + email-match, then inserts membership + consumes the invite in
  // ONE transaction — so token possession alone can't join, the invite is
  // single-use, and concurrent accepts can't double-consume it.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('accept_workspace_invitation', {
    p_token: token,
    p_user_id: user.id,
    p_user_email: user.email ?? ''
  });
  const result = (Array.isArray(data) ? data[0] : null) as { workspace_id: string | null; outcome: string } | null;

  if (error || !result || result.outcome !== 'ok' || !result.workspace_id) {
    const message =
      result?.outcome === 'email_mismatch'
        ? '이 초대는 다른 이메일 주소로 발급되었습니다. 초대받은 이메일로 로그인 후 다시 시도해주세요.'
        : result?.outcome === 'expired'
          ? '만료된 초대입니다.'
          : '유효하지 않은 초대입니다.';
    redirectWithError('/dashboard', message);
  }

  await setWorkspaceCookie(result!.workspace_id!);
  await notifyMemberEvent({
    actorId: user.id,
    workspaceId: result!.workspace_id!,
    eventType: 'member_joined',
    memberEmail: user.email ?? null,
    actorEmail: user.email ?? null,
    createdAt: new Date().toISOString()
  });
  redirectWithSuccess('/dashboard', '워크스페이스에 참여했습니다.');
}

// Change a member's role (admin+; only owners touch the owner role; never strand
// the last owner).
export async function changeMemberRoleAction(formData: FormData) {
  const { workspace, role } = await requireWorkspace();
  if (!isAdmin(role)) {
    redirectWithError(TEAM, '권한이 없습니다.');
  }
  const targetUserId = ((formData.get('userId') as string | null) || '').trim();
  const newRole = normalizeRole((formData.get('role') as string | null)?.trim());
  if (newRole === 'owner' && role !== 'owner') {
    redirectWithError(TEAM, '소유자 권한은 소유자만 부여할 수 있습니다.');
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace.id)
    .eq('user_id', targetUserId)
    .maybeSingle();
  const currentRole = (current as { role: WorkspaceRole } | null)?.role;
  if (!currentRole) {
    redirectWithError(TEAM, '멤버를 찾을 수 없습니다.');
  }
  // Only an owner may change ANOTHER owner's role (admins must not touch owners).
  if (currentRole === 'owner' && role !== 'owner') {
    redirectWithError(TEAM, '소유자의 역할은 소유자만 변경할 수 있습니다.');
  }
  if (currentRole === 'owner' && newRole !== 'owner' && (await countWorkspaceOwners(workspace.id)) <= 1) {
    redirectWithError(TEAM, '마지막 소유자의 권한은 변경할 수 없습니다.');
  }

  await admin
    .from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', workspace.id)
    .eq('user_id', targetUserId);
  revalidatePath(TEAM);
  redirectWithSuccess(TEAM, '역할을 변경했습니다.');
}

// Remove a member (admin+ removes others; anyone may leave). Never strand the
// last owner.
export async function removeMemberAction(formData: FormData) {
  const { user, workspace, role } = await requireWorkspace();
  const targetUserId = ((formData.get('userId') as string | null) || '').trim();
  const isSelf = targetUserId === user.id;
  if (!isSelf && !isAdmin(role)) {
    redirectWithError(TEAM, '권한이 없습니다.');
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace.id)
    .eq('user_id', targetUserId)
    .maybeSingle();
  const currentRole = (current as { role: WorkspaceRole } | null)?.role;
  // Only an owner may remove another owner (admins must not evict owners).
  if (currentRole === 'owner' && !isSelf && role !== 'owner') {
    redirectWithError(TEAM, '소유자는 소유자만 제거할 수 있습니다.');
  }
  if (currentRole === 'owner' && (await countWorkspaceOwners(workspace.id)) <= 1) {
    redirectWithError(TEAM, '마지막 소유자는 제거할 수 없습니다.');
  }

  await admin
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspace.id)
    .eq('user_id', targetUserId);
  revalidatePath(TEAM);
  await notifyMemberEvent({
    actorId: user.id,
    workspaceId: workspace.id,
    eventType: 'member_removed',
    memberUserId: targetUserId,
    actorEmail: user.email ?? null,
    createdAt: new Date().toISOString()
  });

  if (isSelf) {
    // Left the workspace — clear the cookie so the next request picks another.
    (await cookies()).delete(WORKSPACE_COOKIE);
    redirectWithSuccess('/dashboard', '워크스페이스에서 나갔습니다.');
  }
  redirectWithSuccess(TEAM, '멤버를 제거했습니다.');
}
