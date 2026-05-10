'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Polaris Navbar* primitives are pure structural containers — they do
// not track active state. We mark the active nav link via aria-current
// so AT users get the standard "current page" announcement and CSS can
// style it via the [aria-current="page"] selector. Each item's
// `activePrefixes` covers the deeper routes that conceptually belong to
// the same tab (e.g. /dashboard/files/[id] still highlights "파일").
type NavItem = {
  href: string;
  label: string;
  activePrefixes?: string[];
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: '/dashboard',
    label: '파일',
    activePrefixes: [
      '/dashboard/files',
      '/dashboard/collections',
      '/dashboard/links',
      '/dashboard/upload'
    ]
  },
  { href: '/dashboard/automations', label: '자동화' },
  { href: '/dashboard/trash', label: '휴지통' }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === item.href) return true;
  if (item.activePrefixes?.some((p) => pathname.startsWith(p))) return true;
  // Deeper own-prefix (e.g. /dashboard/automations/foo if we ever add).
  if (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)) return true;
  return false;
}

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
