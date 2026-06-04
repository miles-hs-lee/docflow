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
import { ExpandIcon, SettingsIcon } from '@polaris/ui/icons';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
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
        {/* Do NOT use `asChild` here. v0.8 DropdownMenuItem always renders
            children as a 2-element array `[icon, children]`; under asChild
            that array is handed to a Radix Slot whose React.Children.only
            requires exactly one child → crash, even when no icon is passed.
            So we navigate via onSelect + router instead of wrapping a Link,
            which also lets the `icon` slot work normally. */}
        <DropdownMenuItem
          icon={<SettingsIcon size={16} />}
          onSelect={() => router.push('/dashboard/settings')}
        >
          계정 설정
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={isDark} onCheckedChange={handleThemeChange}>
          다크 모드
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuFormItem
          action="/auth/signout"
          method="post"
          destructive
          icon={<ExpandIcon size={16} />}
        >
          로그아웃
        </DropdownMenuFormItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
