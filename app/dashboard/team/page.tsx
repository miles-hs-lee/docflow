import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  SelectField,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';

import { HiddenInput } from '@/components/hidden-input';
import { InviteLinkCopy } from '@/components/invite-link-copy';
import {
  changeMemberRoleAction,
  createInviteAction,
  createWorkspaceAction,
  removeMemberAction,
  renameWorkspaceAction,
  revokeInviteAction,
  setWorkspaceAction
} from '@/lib/actions/workspace';
import { listUserWorkspaces, requireWorkspace } from '@/lib/auth';
import { listWorkspaceInvitations, listWorkspaceMembers } from '@/lib/data-workspace';
import { formatDateTime } from '@/lib/format';
import type { WorkspaceRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: '소유자', admin: '관리자', member: '멤버' };

function roleBadge(role: WorkspaceRole) {
  const variant = role === 'owner' ? 'warning' : role === 'admin' ? 'secondary' : 'neutral';
  return (
    <Badge variant={variant} tone="subtle">
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export default async function TeamPage({
  searchParams
}: {
  searchParams: Promise<{ invited?: string }>;
}) {
  const { user, workspace, role } = await requireWorkspace();
  const isAdmin = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';
  const { invited } = await searchParams;

  const [workspaces, members, invitations] = await Promise.all([
    listUserWorkspaces(user.id),
    listWorkspaceMembers(workspace.id),
    isAdmin ? listWorkspaceInvitations(workspace.id) : Promise.resolve([])
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={<Badge variant="secondary" tone="subtle">팀 · 워크스페이스</Badge>}
        title="팀 / 워크스페이스"
        description="멤버를 초대하고 역할을 관리하세요. 워크스페이스의 모든 콘텐츠·링크·분석은 멤버가 공유합니다."
      />

      {/* Current workspace + rename */}
      <Card>
        <CardHeader>
          <CardTitle>현재 워크스페이스</CardTitle>
        </CardHeader>
        <CardBody>
          <Stack direction="column" gap={3}>
            <Stack direction="row" gap={2} align="center">
              <strong className="ws-current-name">{workspace.name}</strong>
              {roleBadge(role)}
            </Stack>
            {isAdmin ? (
              <form action={renameWorkspaceAction} className="inline-form">
                <Stack direction="row" gap={2} align="center">
                  <Input name="name" defaultValue={workspace.name} maxLength={80} aria-label="워크스페이스 이름" />
                  <Button type="submit" variant="secondary">
                    이름 변경
                  </Button>
                </Stack>
              </form>
            ) : null}
          </Stack>
        </CardBody>
      </Card>

      {/* Switcher + create */}
      <Card>
        <CardHeader>
          <CardTitle>워크스페이스 전환</CardTitle>
        </CardHeader>
        <CardBody>
          <Stack direction="column" gap={3}>
            <Stack direction="column" gap={2}>
              {workspaces.map((w) => (
                <Stack key={w.id} direction="row" gap={2} align="center" justify="between" className="ws-switch-row">
                  <Stack direction="row" gap={2} align="center">
                    <span>{w.name}</span>
                    {roleBadge(w.role)}
                    {w.id === workspace.id ? (
                      <Badge variant="success" tone="subtle">
                        현재
                      </Badge>
                    ) : null}
                  </Stack>
                  {w.id === workspace.id ? null : (
                    <form action={setWorkspaceAction}>
                      <HiddenInput name="workspaceId" value={w.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        전환
                      </Button>
                    </form>
                  )}
                </Stack>
              ))}
            </Stack>
            <form action={createWorkspaceAction} className="inline-form">
              <Stack direction="row" gap={2} align="center">
                <Input name="name" placeholder="새 워크스페이스 이름" maxLength={80} aria-label="새 워크스페이스 이름" />
                <Button type="submit" variant="secondary">
                  새 워크스페이스
                </Button>
              </Stack>
            </form>
          </Stack>
        </CardBody>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>멤버 ({members.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>멤버</TableHead>
                <TableHead nowrap>역할</TableHead>
                <TableHead nowrap>참여일</TableHead>
                <TableHead nowrap>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.user_id === user.id;
                return (
                  <TableRow key={m.user_id}>
                    <TableCell>
                      {m.email ?? m.user_id}
                      {isSelf ? <span className="muted"> (나)</span> : null}
                    </TableCell>
                    <TableCell>{roleBadge(m.role)}</TableCell>
                    <TableCell nowrap>{formatDateTime(m.created_at)}</TableCell>
                    <TableCell nowrap>
                      <Stack direction="row" gap={2} align="center">
                        {isAdmin && !isSelf ? (
                          <form action={changeMemberRoleAction}>
                            <HiddenInput name="userId" value={m.user_id} />
                            <Stack direction="row" gap={1} align="center">
                              <SelectField
                                name="role"
                                defaultValue={m.role}
                                triggerClassName="form-select-trigger role-select"
                              >
                                <SelectItem value="member">멤버</SelectItem>
                                <SelectItem value="admin">관리자</SelectItem>
                                {isOwner ? <SelectItem value="owner">소유자</SelectItem> : null}
                              </SelectField>
                              <Button type="submit" variant="ghost" size="sm">
                                변경
                              </Button>
                            </Stack>
                          </form>
                        ) : null}
                        {isSelf ? (
                          <form action={removeMemberAction}>
                            <HiddenInput name="userId" value={m.user_id} />
                            <Button type="submit" variant="danger" size="sm">
                              나가기
                            </Button>
                          </form>
                        ) : isAdmin ? (
                          <form action={removeMemberAction}>
                            <HiddenInput name="userId" value={m.user_id} />
                            <Button type="submit" variant="danger" size="sm">
                              제거
                            </Button>
                          </form>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Invitations (admin only) */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>멤버 초대</CardTitle>
          </CardHeader>
          <CardBody>
            <Stack direction="column" gap={3}>
              <form action={createInviteAction} className="inline-form">
                <Stack direction="row" gap={2} align="center">
                  <Input name="email" type="email" placeholder="초대할 이메일" maxLength={254} aria-label="초대할 이메일" />
                  <SelectField name="role" defaultValue="member" triggerClassName="form-select-trigger">
                    <SelectItem value="member">멤버</SelectItem>
                    <SelectItem value="admin">관리자</SelectItem>
                    {isOwner ? <SelectItem value="owner">소유자</SelectItem> : null}
                  </SelectField>
                  <Button type="submit">초대 링크 만들기</Button>
                </Stack>
              </form>

              {invited ? (
                <Stack direction="column" gap={1} className="invite-new">
                  <span className="muted">새 초대 링크 — 복사해 전달하세요 (14일 후 만료):</span>
                  <InviteLinkCopy token={invited} />
                </Stack>
              ) : null}

              {invitations.length === 0 ? (
                <EmptyState title="대기 중인 초대가 없습니다" description="이메일과 역할을 입력해 초대 링크를 만드세요." />
              ) : (
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>이메일</TableHead>
                      <TableHead nowrap>역할</TableHead>
                      <TableHead nowrap>생성일</TableHead>
                      <TableHead nowrap>링크</TableHead>
                      <TableHead nowrap>작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.email}</TableCell>
                        <TableCell>{roleBadge(inv.role)}</TableCell>
                        <TableCell nowrap>{formatDateTime(inv.created_at)}</TableCell>
                        <TableCell>
                          <InviteLinkCopy token={inv.token} />
                        </TableCell>
                        <TableCell nowrap>
                          <form action={revokeInviteAction}>
                            <HiddenInput name="invitationId" value={inv.id} />
                            <Button type="submit" variant="danger" size="sm">
                              취소
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
