import Link from 'next/link';

import { Flash } from '@/components/flash';
import { previewTestLoginAction } from '@/lib/actions/auth';
import { getOwner } from '@/lib/auth';
import { canUsePreviewTestLogin } from '@/lib/preview-login';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const { user } = await getOwner();
  const previewTestLoginEnabled = canUsePreviewTestLogin();
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

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
      <section className="hero-card">
        <p className="eyebrow">DocFlow</p>
        <h1>정책 기반 PDF 공유</h1>
        <Flash error={error} />
        <p>
          Microsoft 365(Entra ID) 계정으로 로그인해 PDF를 업로드하고, 링크마다 이메일/비밀번호/만료/조회수
          정책을 독립적으로 설정하세요.
        </p>
        <a href="/auth/signin" className="button button-primary">
          Microsoft 365로 로그인
        </a>

        {previewTestLoginEnabled ? (
          <div className="preview-login-box">
            <h3>Preview 테스트 로그인</h3>
            <p className="muted small">
              이 폼은 Vercel Preview 환경에서만 노출됩니다. 등록된 테스트 계정 정보로 로그인할 수 있습니다.
            </p>
            <form action={previewTestLoginAction} className="form-grid">
              <label>
                테스트 이메일
                <input type="email" name="email" required />
              </label>
              <label>
                테스트 비밀번호
                <input type="password" name="password" required />
              </label>
              <button type="submit" className="button button-ghost">
                테스트 계정으로 로그인
              </button>
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
}
