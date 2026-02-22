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
      <section className="hero-card">
        <p className="eyebrow">DocFlow</p>
        <h1>회원가입</h1>
        <Flash error={error} success={success} />
        <p>최소 정보(이메일, 비밀번호)만 입력하면 바로 계정을 만들 수 있습니다.</p>

        <form action="/auth/signup" method="post" className="form-grid">
          <label>
            이메일
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            비밀번호 (8자 이상)
            <input type="password" name="password" autoComplete="new-password" minLength={8} required />
          </label>
          <button type="submit" className="button button-primary">
            가입하기
          </button>
        </form>

        <div className="auth-subsection">
          <p className="muted small">이미 계정이 있으신가요?</p>
          <Link href="/login" className="button button-ghost">
            로그인으로 이동
          </Link>
        </div>
      </section>
    </main>
  );
}
