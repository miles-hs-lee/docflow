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
