import { Badge, Button, Card, Input } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import Link from 'next/link';

import { Flash } from '@/components/flash';
import { getOwner } from '@/lib/auth';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const { user } = await getOwner();
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;
  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;

  if (user) {
    return (
      <main className="center-layout">
        <Card className="hero-card" variant="padded">
          <Badge variant="info" tone="subtle">DocFlow</Badge>
          <h1>이미 로그인되어 있습니다.</h1>
          <p className="muted">관리 화면으로 이동해 파일과 공유 링크를 관리하세요.</p>
          <Button asChild>
            <Link href="/dashboard">대시보드로 이동</Link>
          </Button>
        </Card>
      </main>
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
        <Badge variant="primary" tone="subtle">Polaris secure workspace</Badge>
        <h1>로그인</h1>
        <Flash error={error} success={success} />
        <p className="muted">이메일과 비밀번호로 로그인해 문서 공유를 시작하세요.</p>

        <form action="/auth/login" method="post" className="form-grid">
          <Input type="email" name="email" autoComplete="email" required label="이메일" />
          <Input type="password" name="password" autoComplete="current-password" required label="비밀번호" />
          <Button type="submit">로그인</Button>
        </form>

        <div className="auth-subsection row-actions">
          <p className="muted small">아직 계정이 없으신가요?</p>
          <Button asChild variant="secondary" size="sm">
            <Link href="/signup">회원가입</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/forgot-password">비밀번호 찾기</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
