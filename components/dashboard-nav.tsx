'use client';

import { NavbarItem } from '@polaris/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// v0.7.7: NavbarItem ships active state + asChild + aria-current built
// in. We just feed it the boolean from usePathname() — Polaris owns the
// brand-tint styling. activePrefixes covers deeper routes that
// conceptually belong to the same tab (file/collection/link detail
// pages still highlight "파일").
type NavItem = {
  href: string;
  label: string;
  activePrefixes?: string[];
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: '대시보드' },
  {
    href: '/dashboard/files',
    label: '콘텐츠',
    activePrefixes: ['/dashboard/files', '/dashboard/links', '/dashboard/upload']
  },
  { href: '/dashboard/collections', label: '데이터룸', activePrefixes: ['/dashboard/collections'] },
  { href: '/dashboard/contacts', label: '연락처' },
  { href: '/dashboard/requests', label: '파일요청', activePrefixes: ['/dashboard/requests'] },
  { href: '/dashboard/automations', label: '자동화' },
  { href: '/dashboard/team', label: '팀', activePrefixes: ['/dashboard/team'] },
  { href: '/dashboard/trash', label: '휴지통' }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === item.href) return true;
  if (item.activePrefixes?.some((p) => pathname.startsWith(p))) return true;
  if (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)) return true;
  return false;
}

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavbarItem key={item.href} asChild active={isActive(pathname, item)}>
          <Link href={item.href}>{item.label}</Link>
        </NavbarItem>
      ))}
    </>
  );
}
