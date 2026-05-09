import { Badge, Button, Card, Input } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Flash } from '@/components/flash';
import { getOwner } from '@/lib/auth';
import { PASSWORD_RECOVERY_COOKIE, verifyRecoveryToken } from '@/lib/password-recovery-cookie';

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;
  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;

  // Recovery-only access: an active user session by itself is NOT enough.
  // The cookie set by /auth/callback is HMAC-signed with the user.id this
  // recovery flow was issued for. We compare against the CURRENT supabase
  // user here — a stale cookie left over from another user / another
  // session does not let them through.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value ?? null;
  const { user } = await getOwner();
  if (!user || !verifyRecoveryToken(cookieValue, user.id)) {
    redirect(
      '/forgot-password?error=' +
        encodeURIComponent('재설정 링크가 만료되었거나 유효하지 않습니다. 다시 요청해주세요.')
    );
  }

  return (
    <main className="center-layout">
      <Card className="hero-card login-card-single" variant="padded">
        <Link href="/" className="landing-brand" aria-label="Polaris Office DocFlow">
          <PolarisLogo variant="horizontal" size={24} aria-hidden />
          <span className="landing-brand-divider" aria-hidden />
          <span className="landing-brand-product">DocFlow</span>
        </Link>
        <Badge variant="primary" tone="subtle">새 비밀번호 설정</Badge>
        <h1>비밀번호 재설정</h1>
        <Flash error={error} success={success} />
        <p className="muted">
          새 비밀번호를 설정하세요. 8자 이상, 다른 사이트와 다른 값을 권장합니다.
        </p>

        <form action="/auth/reset-password" method="post" className="form-grid">
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            label="새 비밀번호 (8자 이상)"
          />
          <Input
            type="password"
            name="passwordConfirm"
            autoComplete="new-password"
            minLength={8}
            required
            label="새 비밀번호 확인"
          />
          <Button type="submit">비밀번호 변경</Button>
        </form>
      </Card>
    </main>
  );
}
