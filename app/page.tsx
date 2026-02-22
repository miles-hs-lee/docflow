import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOwner } from '@/lib/auth';

export default async function HomePage() {
  const { user } = await getOwner();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="landing-home-layout">
      <section className="landing-home-card">
        <p className="eyebrow">DocFlow</p>
        <h1>PDF 공유를 더 간단하고 안전하게</h1>
        <p className="landing-subtitle">
          문서를 올리고 공유 링크를 만든 뒤, 조회 현황까지 쉽게 확인할 수 있는 문서 공유 서비스입니다.
        </p>

        <div className="landing-point-grid">
          <article className="landing-point">
            <h3>누구나 쉽게</h3>
            <p>복잡한 설정 없이 문서를 올리고 링크를 바로 만들 수 있어요.</p>
          </article>
          <article className="landing-point">
            <h3>필요한 보안만 적용</h3>
            <p>만료일, 비밀번호, 이메일 입력 등 원하는 조건을 선택해 보호할 수 있어요.</p>
          </article>
          <article className="landing-point">
            <h3>반응 확인</h3>
            <p>누가 얼마나 열람했는지 링크별로 확인해 다음 커뮤니케이션에 활용할 수 있어요.</p>
          </article>
        </div>

        <div className="landing-cta-row">
          <Link href="/login" className="button button-primary">
            시작하기
          </Link>
          <Link href="/signup" className="button button-ghost">
            회원가입
          </Link>
        </div>
      </section>
    </main>
  );
}
