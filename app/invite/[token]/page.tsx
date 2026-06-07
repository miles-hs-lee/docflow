import { Badge, Button, Card } from '@polaris/ui';
import Link from 'next/link';

import { HiddenInput } from '@/components/hidden-input';
import { acceptInviteAction } from '@/lib/actions/workspace';
import { getOwner } from '@/lib/auth';
import { getInvitationByToken } from '@/lib/data-workspace';
import type { WorkspaceRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: '소유자', admin: '관리자', member: '멤버' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, { user }] = await Promise.all([getInvitationByToken(token), getOwner()]);

  const expired = invite?.expires_at ? new Date(invite.expires_at) < new Date() : false;
  const valid = Boolean(invite && invite.status === 'pending' && !expired);

  if (!valid || !invite) {
    return (
      <main className="center-layout">
        <Card className="hero-card" variant="padded">
          <Badge variant="secondary" tone="subtle">DocFlow</Badge>
          <h1>유효하지 않은 초대</h1>
          <p className="muted">
            이 초대 링크는 만료되었거나 이미 사용·취소되었습니다. 워크스페이스 관리자에게 새 링크를 요청하세요.
          </p>
          <Button asChild variant="secondary">
            <Link href="/dashboard">대시보드로</Link>
          </Button>
        </Card>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="center-layout">
        <Card className="hero-card" variant="padded">
          <Badge variant="info" tone="subtle">팀 초대</Badge>
          <h1>{invite.workspace_name} 워크스페이스에 초대되었습니다</h1>
          <p className="muted">{ROLE_LABEL[invite.role]} 역할로 참여하려면 먼저 로그인하세요.</p>
          <Button asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>로그인하고 참여하기</Link>
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="center-layout">
      <Card className="hero-card" variant="padded">
        <Badge variant="info" tone="subtle">팀 초대</Badge>
        <h1>{invite.workspace_name} 워크스페이스에 참여</h1>
        <p className="muted">
          {ROLE_LABEL[invite.role]} 역할로 참여합니다. 참여하면 이 워크스페이스의 문서·공유 링크·분석을 멤버들과 함께
          사용합니다.
        </p>
        <form action={acceptInviteAction}>
          <HiddenInput name="token" value={token} />
          <Button type="submit">참여하기</Button>
        </form>
        <Button asChild variant="ghost">
          <Link href="/dashboard">나중에</Link>
        </Button>
      </Card>
    </main>
  );
}
