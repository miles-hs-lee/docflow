import { Button, Card } from '@polaris/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center-layout">
      <Card className="hero-card" variant="padded">
        <p className="eyebrow">404</p>
        <h1>페이지를 찾을 수 없습니다.</h1>
        <p className="muted">요청한 주소가 변경되었거나 삭제되었습니다.</p>
        <Button asChild>
          <Link href="/dashboard">대시보드로 이동</Link>
        </Button>
      </Card>
    </main>
  );
}
