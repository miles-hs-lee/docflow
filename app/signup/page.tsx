import { Badge, Button, Card, Input } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Flash } from '@/components/flash';
import { getOwner } from '@/lib/auth';

type SignupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const { user } = await getOwner();
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;
  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;

  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="center-layout">
      <Card className="hero-card" variant="padded">
        <Link href="/" className="landing-brand" aria-label="Polaris Office DocFlow">
          <PolarisLogo variant="horizontal" size={24} aria-hidden />
          <span className="landing-brand-divider" aria-hidden />
          <span className="landing-brand-product">DocFlow</span>
        </Link>
        <Badge variant="info" tone="subtle">최소 정보 가입</Badge>
        <h1>회원가입</h1>
        <Flash error={error} success={success} />
        <p className="muted">이메일과 비밀번호만 입력하면 바로 계정을 만들 수 있습니다.</p>

        <form action="/auth/signup" method="post" className="form-grid">
          <Input type="email" name="email" autoComplete="email" required label="이메일" />
          <Input type="password" name="password" autoComplete="new-password" minLength={8} required label="비밀번호 (8자 이상)" />
          <Button type="submit">가입하기</Button>
        </form>

        <div className="auth-subsection row-actions">
          <p className="muted small">이미 계정이 있으신가요?</p>
          <Button asChild variant="secondary" size="sm">
            <Link href="/login">로그인으로 이동</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
