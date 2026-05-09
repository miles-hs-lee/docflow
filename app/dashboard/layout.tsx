import { Button, Navbar, NavbarActions, NavbarBrand, NavbarNav } from '@polaris/ui';
import Link from 'next/link';

import { requireOwner } from '@/lib/auth';
import { PolarisLogo } from '@polaris/ui/logos';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOwner();

  return (
    <div className="dashboard-shell">
      <Navbar className="dashboard-header">
        <div>
          <NavbarBrand asChild>
            <Link href="/dashboard" className="landing-brand">
              <PolarisLogo variant="horizontal" size={24} aria-hidden />
              <span className="landing-brand-divider" aria-hidden />
              <span className="landing-brand-product">DocFlow</span>
            </Link>
          </NavbarBrand>
          <p className="muted small">{user.email}</p>
        </div>
        <NavbarNav className="dashboard-nav">
          <Link href="/dashboard" className="nav-link">
            파일
          </Link>
          <Link href="/dashboard/automations" className="nav-link">
            자동화
          </Link>
          <Link href="/dashboard/trash" className="nav-link">
            휴지통
          </Link>
        </NavbarNav>
        <NavbarActions>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              로그아웃
            </Button>
          </form>
        </NavbarActions>
      </Navbar>
      <main className="dashboard-content">{children}</main>
    </div>
  );
}
