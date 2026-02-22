import Link from 'next/link';

import { requireOwner } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOwner();

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <Link href="/dashboard" className="brand-link">
            DocFlow
          </Link>
          <p className="muted small">{user.email}</p>
        </div>
        <nav className="dashboard-nav">
          <Link href="/dashboard" className="nav-link">
            파일
          </Link>
          <Link href="/dashboard/automations" className="nav-link">
            자동화
          </Link>
          <Link href="/dashboard/trash" className="nav-link">
            휴지통
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="button button-ghost">
              로그아웃
            </button>
          </form>
        </nav>
      </header>
      <main className="dashboard-content">{children}</main>
    </div>
  );
}
