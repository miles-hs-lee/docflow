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
        <section className="hero-card">
          <p className="eyebrow">DocFlow</p>
          <h1>이미 로그인되어 있습니다.</h1>
          <p>관리 화면으로 이동해 파일과 공유 링크를 관리하세요.</p>
          <Link href="/dashboard" className="button button-primary">
            대시보드로 이동
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="center-layout">
      <section className="hero-card login-card-single">
        <p className="eyebrow">DocFlow</p>
        <h1>로그인</h1>
        <Flash error={error} success={success} />
        <p className="muted">이메일과 비밀번호로 로그인해 문서 공유를 시작하세요.</p>

        <form action="/auth/login" method="post" className="form-grid">
          <label>
            이메일
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            비밀번호
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="button button-primary">
            로그인
          </button>
        </form>

        <div className="auth-subsection">
          <p className="muted small">아직 계정이 없으신가요?</p>
          <Link href="/signup" className="button button-ghost">
            회원가입
          </Link>
        </div>
      </section>
    </main>
  );
}
