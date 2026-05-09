'use client';

import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuFormItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@polaris/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'docflow-theme';

function readStoredTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  const current = document.documentElement.dataset.theme;
  return current === 'dark' ? 'dark' : 'light';
}

function applyTheme(next: 'light' | 'dark') {
  document.documentElement.dataset.theme = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // localStorage may be unavailable (private mode); falling back to in-memory only.
  }
}

export function UserMenu({ email }: { email: string }) {
  const initial = (email.trim()[0] ?? '?').toUpperCase();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(readStoredTheme() === 'dark');
  }, []);

  const handleThemeChange = (checked: boolean) => {
    const next = checked ? 'dark' : 'light';
    applyTheme(next);
    setIsDark(checked);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="user-menu-trigger" aria-label="사용자 메뉴">
          <Avatar size="sm">
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="user-menu-content">
        <DropdownMenuLabel className="user-menu-email" title={email}>
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">계정 설정</Link>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={isDark} onCheckedChange={handleThemeChange}>
          다크 모드
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuFormItem action="/auth/signout" method="post" destructive>
          로그아웃
        </DropdownMenuFormItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
