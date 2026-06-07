import { Navbar, NavbarActions, NavbarBrand, NavbarNav } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import Link from 'next/link';

import { DashboardNav } from '@/components/dashboard-nav';
import { FlashToast } from '@/components/flash-toast';
import { PolarisProvider } from '@/components/polaris-provider';
import { UserMenu } from '@/components/user-menu';
import { requireWorkspace } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();

  return (
    <PolarisProvider>
    <div className="dashboard-shell">
      <Navbar className="dashboard-header">
        <NavbarBrand asChild>
          <Link href="/dashboard" className="landing-brand">
            <PolarisLogo variant="horizontal" size={24} aria-hidden />
            <span className="landing-brand-divider" aria-hidden />
            <span className="landing-brand-product">DocFlow</span>
          </Link>
        </NavbarBrand>
        <NavbarNav className="dashboard-nav">
          <DashboardNav />
        </NavbarNav>
        <NavbarActions className="dashboard-actions">
          <Link href="/dashboard/team" className="ws-indicator" title="팀 / 워크스페이스 관리">
            {workspace.name}
          </Link>
          <UserMenu email={user.email ?? ''} />
        </NavbarActions>
      </Navbar>
      <main className="dashboard-content">{children}</main>
      <FlashToast />
    </div>
    </PolarisProvider>
  );
}
