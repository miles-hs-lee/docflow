import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center-layout">
      <section className="hero-card">
        <h1>페이지를 찾을 수 없습니다.</h1>
        <p>요청한 주소가 잘못되었거나 삭제되었습니다.</p>
        <Link href="/dashboard" className="button button-primary">
          대시보드로 이동
        </Link>
      </section>
    </main>
  );
}
