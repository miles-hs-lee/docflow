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
      </section>
    </main>
  );
}
