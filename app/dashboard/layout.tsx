import { Navbar, NavbarActions, NavbarBrand, NavbarNav } from '@polaris/ui';
import { PolarisLogo } from '@polaris/ui/logos';
import Link from 'next/link';

import { DashboardNav } from '@/components/dashboard-nav';
import { FlashToast } from '@/components/flash-toast';
import { PolarisProvider } from '@/components/polaris-provider';
import { UserMenu } from '@/components/user-menu';
import { requireOwner } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOwner();

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
          <UserMenu email={user.email ?? ''} />
        </NavbarActions>
      </Navbar>
      <main className="dashboard-content">{children}</main>
      <FlashToast />
    </div>
    </PolarisProvider>
  );
}
