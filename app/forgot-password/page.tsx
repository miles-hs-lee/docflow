import { Badge, Button, Card, Input } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import Link from 'next/link';

import { Flash } from '@/components/flash';

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;
  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;

  return (
    <main className="center-layout">
      <Card className="hero-card login-card-single" variant="padded">
        <Link href="/" className="landing-brand" aria-label="Polaris Office DocFlow">
          <PolarisLogo variant="horizontal" size={24} aria-hidden />
          <span className="landing-brand-divider" aria-hidden />
          <span className="landing-brand-product">DocFlow</span>
        </Link>
        <Badge variant="info" tone="subtle">비밀번호 재설정</Badge>
        <h1>비밀번호 찾기</h1>
        <Flash error={error} success={success} />
        <p className="muted">
          가입에 사용한 이메일을 입력하면 비밀번호를 재설정할 수 있는 링크를 보내드립니다.
          링크는 발송 후 1시간 동안 유효합니다.
        </p>

        <form action="/auth/forgot-password" method="post" className="form-grid">
          <Input type="email" name="email" autoComplete="email" required label="이메일" />
          <Button type="submit">재설정 링크 보내기</Button>
        </form>

        <div className="auth-subsection row-actions">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">로그인으로 돌아가기</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
